using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.RegularExpressions;

namespace LoanMS.API.Controllers;

/// <summary>
/// Handles full wizard submission — creates Customer + Loan + References in one transaction.
/// </summary>
[Authorize]
public class WizardController : BaseController
{
    private readonly AppDbContext _db;
    private readonly ILogger<WizardController> _logger;
    private readonly LoanMS.API.Services.IRolePermissionService _rolePerm;
    private readonly LoanMS.API.Services.ILoginUserAssignmentService _loginAssign;
    // Central rules (shared with every other create/reactivate path): global
    // customer identification and the duplicate-application + 45-day guard.
    private readonly ICustomerService _customerService;
    private readonly ILoanService _loanService;

    public WizardController(AppDbContext db, ILogger<WizardController> logger, LoanMS.API.Services.IRolePermissionService rolePerm, LoanMS.API.Services.ILoginUserAssignmentService loginAssign,
        ICustomerService customerService, ILoanService loanService)
    {
        _db     = db;
        _logger = logger;
        _rolePerm = rolePerm;
        _loginAssign = loginAssign;
        _customerService = customerService;
        _loanService = loanService;
    }

    // NOTE: the wizard frontend sends short keys (new_car, used_car, education, lap)
    // while some legacy callers send the longer *_loan form (new_car_loan,
    // used_car_loan, education_loan, loan_against_property). Both are mapped here
    // so neither one silently falls back to LoanType.Personal.
    private static readonly Dictionary<string, LoanType> _loanTypeMap = new(StringComparer.OrdinalIgnoreCase)
    {
        ["personal_loan"]         = LoanType.Personal,
        ["business_loan"]         = LoanType.Business,
        ["home_loan"]             = LoanType.Home,
        ["new_car_loan"]          = LoanType.Car,
        ["new_car"]               = LoanType.Car,
        ["used_car_loan"]         = LoanType.Car,
        ["used_car"]              = LoanType.Car,
        ["education_loan"]        = LoanType.Education,
        ["education"]             = LoanType.Education,
        ["loan_against_property"] = LoanType.LAP,
        ["lap"]                   = LoanType.LAP,
        ["over_draft"]            = LoanType.Overdraft,
        ["overdraft"]             = LoanType.Overdraft,
        // Insurance keeps its own LoanType now (was folded into Personal) so the
        // loan-detail/Timeline can show the insurance-labelled actions. The
        // policy fields still persist via loan.ProductDataJson (ApplyMapping).
        ["insurance"]             = LoanType.Insurance,
    };

    // ── Field-format validation ──────────────────────────────────────────────
    // Mirrors the frontend's input rules exactly, so a request that bypasses
    // the UI (curl/Postman/a modified client) can never slip malformed data
    // past the API. Digits-only, exact-length patterns for mobile/PIN/Aadhaar;
    // a standard local@domain.tld shape for email; the usual PAN format.
    private static readonly Regex MobileRegex = new(@"^\d{10}$", RegexOptions.Compiled);
    private static readonly Regex ZipRegex    = new(@"^\d{6}$", RegexOptions.Compiled);
    private static readonly Regex AadharRegex = new(@"^\d{12}$", RegexOptions.Compiled);
    private static readonly Regex EmailRegex  = new(@"^[^\s@]+@[^\s@]+\.[^\s@]+$", RegexOptions.Compiled);
    private static readonly Regex PanRegex    = new(@"^[A-Z]{5}\d{4}[A-Z]$", RegexOptions.Compiled);

    /// <summary>
    /// Validates the *format* of whichever fields were actually supplied —
    /// it never enforces required-ness (that differs by wizard step and by
    /// whether this is a draft autosave or a final submit; callers add their
    /// own required-field checks on top of this). Shared by Submit and
    /// Validate so the two can never drift apart on what counts as valid.
    /// </summary>
    private static List<string> ValidateFieldFormats(WizardSubmitDto dto)
    {
        var errors = new List<string>();

        if (!string.IsNullOrWhiteSpace(dto.Mobile) && !MobileRegex.IsMatch(dto.Mobile.Trim()))
            errors.Add("Mobile number must be exactly 10 digits.");

        if (!string.IsNullOrWhiteSpace(dto.Pan) && !PanRegex.IsMatch(dto.Pan.Trim().ToUpperInvariant()))
            errors.Add("PAN number format is invalid (expected format: ABCDE1234F).");

        if (!string.IsNullOrWhiteSpace(dto.Email) && !EmailRegex.IsMatch(dto.Email.Trim()))
            errors.Add("Email address format is invalid.");

        if (!string.IsNullOrWhiteSpace(dto.OfficeEmail) && !EmailRegex.IsMatch(dto.OfficeEmail.Trim()))
            errors.Add("Official email address format is invalid.");

        if (!string.IsNullOrWhiteSpace(dto.Aadhar) && !AadharRegex.IsMatch(dto.Aadhar.Trim()))
            errors.Add("Aadhaar number must be exactly 12 digits.");

        if (!string.IsNullOrWhiteSpace(dto.Zip) && !ZipRegex.IsMatch(dto.Zip.Trim()))
            errors.Add("PIN code must be exactly 6 digits.");

        if (!string.IsNullOrWhiteSpace(dto.R1Mobile) && !MobileRegex.IsMatch(dto.R1Mobile.Trim()))
            errors.Add("Reference 1 mobile number must be exactly 10 digits.");

        if (!string.IsNullOrWhiteSpace(dto.R2Mobile) && !MobileRegex.IsMatch(dto.R2Mobile.Trim()))
            errors.Add("Reference 2 mobile number must be exactly 10 digits.");

        // Server-side mirror of the frontend's own check (NewApplicationPage validate()) —
        // a request that bypasses the UI must not be able to slip a negative obligations
        // value past the API.
        if (dto.Obligations < 0)
            errors.Add("Existing EMI obligations cannot be negative.");

        return errors;
    }

    /// <summary>
    /// Final-submit completeness — the rules every product shares in Vanilla's
    /// validateStep (efin-app.js:8324): Step 1 PAN + Location, Step 3 date of
    /// birth / gender / Aadhaar / email, Step 7 both references complete, and
    /// Step 9 one to laMaxBanks lenders (2 for Personal Loan, 3 otherwise —
    /// efin-app.js:15835). They were enforced only in the browser, so a request
    /// that bypassed the wizard could create an application the later stages
    /// cannot process (no Location → never routed to a Credit Evaluation
    /// Officer; no bank → Underwriting impossible). Formats stay in
    /// ValidateFieldFormats; drafts (autosave) are not held to these rules.
    /// Shared by Submit and Validate so the two cannot drift apart.
    /// </summary>
    private static List<string> ValidateFinalSubmitCompleteness(WizardSubmitDto dto)
    {
        static bool Blank(string? s) => string.IsNullOrWhiteSpace(s);
        var errors = new List<string>();

        if (Blank(dto.Pan))           errors.Add("PAN is required.");
        if (!dto.LocationId.HasValue) errors.Add("Location is required.");
        if (Blank(dto.Dob))           errors.Add("Date of birth is required.");
        if (Blank(dto.Gender))        errors.Add("Gender is required.");
        if (Blank(dto.Aadhar))        errors.Add("Aadhaar number is required.");
        if (Blank(dto.Email))         errors.Add("Email address is required.");
        if (Blank(dto.R1Name) || Blank(dto.R1Mobile) || Blank(dto.R1Relation))
            errors.Add("Reference 1 name, mobile and relationship are required.");
        if (Blank(dto.R2Name) || Blank(dto.R2Mobile) || Blank(dto.R2Relation))
            errors.Add("Reference 2 name, mobile and relationship are required.");

        var banks = dto.SelectedBanks?.Count(b => !Blank(b.BankName)) ?? 0;
        var maxBanks = string.Equals(dto.LoanType, "personal_loan", StringComparison.OrdinalIgnoreCase) ? 2 : 3;
        if (banks < 1)
            errors.Add("Select at least 1 bank on Loan Analytics before submitting.");
        else if (banks > maxBanks)
            errors.Add($"Maximum {maxBanks} banks allowed for this loan type.");

        return errors;
    }

    /// <summary>
    /// Validates DsaId / PartnerId / LocationId mapping (Phase 2A). Ownership,
    /// visibility, and document-security checks are explicitly out of scope for
    /// this phase — this only confirms the ids exist, are not deleted, and point
    /// at the correct record type:
    ///   - DsaId must reference a DsaPartner with PartnerType = Dsa.
    ///   - PartnerId must reference a DsaPartner with PartnerType = Partner.
    ///   - LocationId must reference an existing, non-deleted Location.
    /// Shared by Submit, SaveDraft and Validate so all three enforce the same rule.
    /// </summary>
    private async Task<List<string>> ValidateMappingAsync(WizardSubmitDto dto)
    {
        var errors = new List<string>();

        if (dto.DsaId.HasValue)
        {
            var dsa = await _db.DsaPartners.FirstOrDefaultAsync(d => d.Id == dto.DsaId.Value && !d.IsDeleted);
            if (dsa == null)
                errors.Add("Selected DSA was not found.");
            else if (dsa.PartnerType != PartnerType.Dsa)
                errors.Add("Selected DSA is not a valid DSA record.");
        }

        if (dto.PartnerId.HasValue)
        {
            var partner = await _db.DsaPartners.FirstOrDefaultAsync(p => p.Id == dto.PartnerId.Value && !p.IsDeleted);
            if (partner == null)
                errors.Add("Selected Partner was not found.");
            else if (partner.PartnerType != PartnerType.Partner)
                errors.Add("Selected Partner is not a valid Partner record.");
        }

        if (dto.LocationId.HasValue)
        {
            var locationExists = await _db.Locations.AnyAsync(l => l.Id == dto.LocationId.Value && !l.IsDeleted);
            if (!locationExists)
                errors.Add("Selected Location was not found.");
        }

        return errors;
    }

    /// <summary>
    /// Applies DsaId / PartnerId / LocationId onto a Loan. Each field is only
    /// overwritten when the incoming dto actually supplied a value — an
    /// autosave/resume call that omits one of these must never null out or
    /// clobber a mapping that was already saved on a draft.
    /// </summary>
    private static void ApplyMapping(Loan loan, WizardSubmitDto dto)
    {
        if (dto.DsaId.HasValue)      loan.DsaId      = dto.DsaId;
        if (dto.PartnerId.HasValue)  loan.PartnerId  = dto.PartnerId;
        if (dto.LocationId.HasValue) loan.LocationId = dto.LocationId;
        // Product-specific fields (Insurance/Property/Vehicle/Education) —
        // confirmed real gap, previously never captured at all. Only
        // overwrite if this particular call actually included data, same
        // "don't clobber a value from an earlier save" rule as the fields
        // above.
        if (dto.ProductData != null && dto.ProductData.Count > 0)
            loan.ProductDataJson = System.Text.Json.JsonSerializer.Serialize(dto.ProductData);
    }

    /// <summary>
    /// Find the customer this application belongs to, or create a new one.
    /// Shared by Submit and SaveDraft. Identification is the global, normalised
    /// rule in CustomerService.ResolveIdentityAsync (PAN / mobile / email, soft-
    /// deleted customers included), run on EVERY save — not only the first — so
    /// an identifier typed later that belongs to an existing customer re-links
    /// the draft instead of silently leaving a duplicate customer behind.
    /// Returns (null, identity) when the details need admin review (conflicting
    /// matches or a deleted customer): nothing is merged, restored or created.
    /// Must run inside the caller's transaction (the identifier locks are
    /// transaction-scoped).
    /// </summary>
    private async Task<(Customer? Customer, CustomerIdentityMatchDto Identity)> ResolveCustomerForApplicationAsync(
        WizardSubmitDto dto, Loan? existingLoan)
    {
        var identity = await _customerService.ResolveIdentityAsync(dto.Pan, dto.Mobile, dto.Email,
            existingLoan?.CustomerId, existingLoan?.Id, lockIdentifiers: true);
        if (identity.NeedsReview) return (null, identity);

        Customer? customer = null;
        if (identity.CustomerId is int matchedId)
            customer = await _db.Customers.IgnoreQueryFilters().FirstOrDefaultAsync(c => c.Id == matchedId);

        if (customer == null)
        {
            // BUGFIX (wizard bug sweep): when Mobile is still blank (a very
            // early autosave — e.g. FullName typed but Mobile not yet valid,
            // now reachable even on a blocked forward-nav since the
            // autosave-on-validation-failure fix above), this used to fall
            // back to the literal "draft@efin.auto" for EVERY such customer.
            // Customer.Email has a unique index, so the second concurrent
            // draft anywhere in the whole system with no Mobile yet would
            // hit a DbUpdateException here — caught by SaveDraft's try/catch
            // below, surfaced as a 500 "Could not save draft." (indistinguishable
            // from the reported bug). A per-attempt GUID keeps every such
            // fallback address unique; once a real Mobile/Email is entered,
            // a later autosave/submit already treats this as an update to
            // the existing loan/customer (matched via LoanId — see the
            // existingLoan lookup above), so this placeholder is short-lived.
            var fallbackEmail = string.IsNullOrWhiteSpace(dto.Mobile)
                ? $"draft-{Guid.NewGuid():N}@efin.auto"
                : $"{dto.Mobile.Trim()}@efin.auto";

            customer = new Customer
            {
                FullName       = (dto.FullName ?? string.Empty).Trim(),
                Email          = string.IsNullOrWhiteSpace(dto.Email)
                                 ? fallbackEmail
                                 : dto.Email.ToLower().Trim(),
                Phone          = (dto.Mobile ?? string.Empty).Trim(),
                PanNumber      = string.IsNullOrWhiteSpace(dto.Pan) ? null : dto.Pan.ToUpper().Trim(),
                AadhaarNumber  = dto.Aadhar?.Trim(),
                DateOfBirth    = string.IsNullOrWhiteSpace(dto.Dob) ? null : DateTime.TryParse(dto.Dob, out var dob) ? DateTime.SpecifyKind(dob, DateTimeKind.Utc) : null,
                // House/Flat No. (Street1) and Street & Locality (Street2) are
                // two separate wizard fields — HouseNo/Address were previously
                // both fed from Street1 alone (Street2 wasn't even received),
                // which showed the house number under the "Street & Locality"
                // label on the Address tab and lost the real street text.
                HouseNo        = dto.Street1,
                Address        = dto.Street2,
                City           = dto.City,
                State          = dto.State,
                PinCode        = dto.Zip,
                MonthlyIncome  = dto.Salary > 0 ? dto.Salary : null,
                MonthlyObligations = dto.Obligations > 0 ? dto.Obligations : null,
                EmploymentType = MapEmpType(dto.EmpType),
                CompanyName    = dto.CompName,
                CibilScore     = dto.Cibil > 0 ? dto.Cibil : null,
                Gender         = NormalizeGender(dto.Gender),
                FatherName     = dto.FatherName?.Trim(),
                ResidenceType  = dto.HomeType,
                // Employment-tab fields the wizard already collects (Step 5:
                // Designation, Company Type, Official Email) but which were
                // never written onto the Customer record.
                Designation    = dto.Desig,
                CompanyType    = dto.CompType,
                OfficialEmail  = dto.OfficeEmail,
                CreatedAt      = DateTime.UtcNow
            };
            ApplyProductDataCustomerFields(customer, dto.ProductData, protectIdentity: false);
            _db.Customers.Add(customer);
        }
        else
        {
            // An EXISTING master record (a returning customer, or one another
            // application already uses) keeps its identity/KYC data: those
            // fields are only filled when blank, never overwritten by a new
            // application. The draft's own provisional record (created by this
            // same wizard session) keeps being refined as the user types.
            // Application-time data (address, employment, income, obligations,
            // CIBIL) still updates as before — the new application needs it.
            var protect = identity.IsExistingMaster;
            bool Fill(string? current) => !protect || string.IsNullOrWhiteSpace(current);

            if (!string.IsNullOrWhiteSpace(dto.FullName) && Fill(customer.FullName)) customer.FullName = dto.FullName.Trim();
            // Refresh Phone too (guarded). The customer is created on the FIRST
            // autosave, which can fire while the mobile is still mid-entry (a pause
            // longer than the ~800ms debounce), so the create branch may have stored
            // a partial number. Mobile is also what the customer lookup matches on,
            // so leaving a stale partial here breaks dedup on later saves — a second
            // application for the same person would miss this customer and insert a
            // duplicate. Phone has no unique index, so this refresh can't 500 on a
            // duplicate-key violation (unlike PAN/Email below).
            if (!string.IsNullOrWhiteSpace(dto.Mobile) && Fill(customer.Phone)) customer.Phone = dto.Mobile.Trim();
            // BUGFIX (wizard-to-detail-page linking sweep): the customer is
            // normally created on the very FIRST autosave (Step 1, as soon as
            // Mobile is valid) — well before Address (Step 4) or Employment
            // (Step 5) are ever filled in. Every later save for that same
            // application therefore goes through THIS update branch, which
            // previously never touched Address/HouseNo/PIN or the Employment-
            // tab extras below at all — so those fields stayed permanently
            // blank on the Loan Detail page for the vast majority of real
            // submissions, not just the rare draft-less direct-create path.
            if (!string.IsNullOrWhiteSpace(dto.Street1)) customer.HouseNo = dto.Street1.Trim();
            if (!string.IsNullOrWhiteSpace(dto.Street2)) customer.Address = dto.Street2.Trim();
            if (!string.IsNullOrWhiteSpace(dto.City))   customer.City   = dto.City;
            if (!string.IsNullOrWhiteSpace(dto.State))  customer.State  = dto.State;
            if (!string.IsNullOrWhiteSpace(dto.Zip))    customer.PinCode = dto.Zip.Trim();
            if (dto.Salary > 0)  customer.MonthlyIncome = dto.Salary;
            if (dto.Obligations > 0) customer.MonthlyObligations = dto.Obligations;
            if (dto.Cibil > 0)   customer.CibilScore    = dto.Cibil;
            if (!string.IsNullOrWhiteSpace(dto.CompName)) customer.CompanyName = dto.CompName;
            if (!string.IsNullOrWhiteSpace(dto.Gender) && Fill(customer.Gender))         customer.Gender     = NormalizeGender(dto.Gender);
            if (!string.IsNullOrWhiteSpace(dto.FatherName) && Fill(customer.FatherName)) customer.FatherName = dto.FatherName.Trim();
            if (!string.IsNullOrWhiteSpace(dto.HomeType))   customer.ResidenceType = dto.HomeType;
            if (!string.IsNullOrWhiteSpace(dto.Desig))       customer.Designation   = dto.Desig.Trim();
            if (!string.IsNullOrWhiteSpace(dto.CompType))    customer.CompanyType   = dto.CompType;
            if (!string.IsNullOrWhiteSpace(dto.OfficeEmail)) customer.OfficialEmail = dto.OfficeEmail.Trim();
            ApplyProductDataCustomerFields(customer, dto.ProductData, protect);
            // BUGFIX (draft-resume persistence): the update branch previously
            // dropped these KYC / employment fields. The Customer is created on
            // the FIRST autosave (Step 1, before they're entered), so every later
            // draft-save hit this branch and never persisted them — a resumed
            // draft came back with a blank Aadhaar, Date of Birth and Employment
            // Type, and the real email replaced by the "<mobile>@efin.auto"
            // placeholder. The create branch already stores them; mirror that here
            // (guarded, so a blank never wipes a stored value). Shared by Submit +
            // SaveDraft, so a submitted-via-draft loan is fixed too.
            if (!string.IsNullOrWhiteSpace(dto.Aadhar) && Fill(customer.AadhaarNumber)) customer.AadhaarNumber = dto.Aadhar.Trim();
            if (!string.IsNullOrWhiteSpace(dto.Dob) && DateTime.TryParse(dto.Dob, out var udob)
                && (!protect || customer.DateOfBirth == null))
                customer.DateOfBirth = DateTime.SpecifyKind(udob, DateTimeKind.Utc);
            if (!string.IsNullOrWhiteSpace(dto.EmpType)) customer.EmploymentType = MapEmpType(dto.EmpType);
            // BUGFIX (draft-resume persistence — same class as Aadhaar/DOB/EmpType
            // above, missed for PAN). The Customer is created on the FIRST autosave,
            // which normally fires once Mobile/Name are present but before the PAN
            // is fully entered — so the create branch stored no PAN, and this update
            // branch never wrote PanNumber either. Result: a PAN typed after that
            // first save was silently dropped — a resumed draft came back with a
            // blank PAN, and the completed application's Customer had a null (or
            // stale/partial) PAN even though the payload carried the correct value.
            // PanNumber has an UNFILTERED unique index (like Email), so guard it the
            // same way: only write when it actually changed and no other (incl.
            // soft-deleted) customer already holds it, rather than 500 the save on a
            // duplicate-key violation. A true PAN duplicate is still surfaced by the
            // Validate/Submit duplicate-application check.
            // On an existing master record a valid PAN already on file is never
            // replaced (a different PAN is refused upstream as a conflict).
            if (!string.IsNullOrWhiteSpace(dto.Pan) && (!protect || Customer.NormalizePan(customer.PanNumber) == null))
            {
                var realPan = dto.Pan.ToUpper().Trim();
                if (!string.Equals(customer.PanNumber, realPan, StringComparison.OrdinalIgnoreCase)
                    && !await _db.Customers.IgnoreQueryFilters().AnyAsync(c => c.Id != customer.Id && c.PanNumber == realPan))
                    customer.PanNumber = realPan;
            }
            // Customer.Email has an UNFILTERED unique index, so only take the real
            // address when it actually changed and no other (incl. soft-deleted)
            // customer holds it — otherwise keep the placeholder rather than 500
            // the save on a duplicate-key violation. On an existing master record
            // only a system placeholder (…@efin.auto) is ever replaced.
            if (!string.IsNullOrWhiteSpace(dto.Email) && (!protect || Customer.NormalizeEmail(customer.Email) == null))
            {
                var realEmail = dto.Email.ToLower().Trim();
                if (!string.Equals(customer.Email, realEmail, StringComparison.OrdinalIgnoreCase)
                    && !await _db.Customers.IgnoreQueryFilters().AnyAsync(c => c.Id != customer.Id && c.Email == realEmail))
                    customer.Email = realEmail;
            }
            customer.UpdatedAt = DateTime.UtcNow;
        }

        return (customer, identity);
    }

    /// <summary>
    /// After the application row points at the resolved customer: remove the
    /// draft's superseded provisional customer (created by this same wizard
    /// session before the typed PAN/mobile/email identified an existing
    /// customer). Only ever a record no other application or bureau report uses
    /// (CustomerService re-checks that) — this is not a merge of two customers.
    /// </summary>
    private async Task RemoveSupersededProvisionalCustomerAsync(CustomerIdentityMatchDto identity)
    {
        if (identity.SupersededProvisionalCustomerId is not int provisionalId) return;
        var provisional = await _db.Customers.IgnoreQueryFilters().FirstOrDefaultAsync(c => c.Id == provisionalId);
        if (provisional == null) return;
        _db.Customers.Remove(provisional);
        await _db.SaveChangesAsync();
    }

    /// <summary>409 for a needs-review identity or a blocked application, with
    /// the message this caller may see.</summary>
    private ObjectResult BlockedResponse<T>(CustomerIdentityMatchDto? identity, ApplicationEligibilityDto? eligibility)
    {
        var body = identity is { NeedsReview: true }
            ? ApiResponseDto<T>.Fail(identity.Message!, ApiErrorCodes.CustomerNeedsReview)
            : ApiResponseDto<T>.Fail(
                LoanMS.Application.Services.LoanService.DescribeEligibilityForCaller(eligibility!, CurrentUserId, CurrentUserRole),
                eligibility!.Code!);
        return Conflict(body);
    }

    /// <summary>Audit trail for a refused final submit (the global AuditMiddleware
    /// only records successful writes). Identifiers are masked. Best-effort.
    /// Not written for background draft autosaves, which would flood the log.</summary>
    private async Task AuditBlockedSubmitAsync(WizardSubmitDto dto, CustomerIdentityMatchDto? identity, ApplicationEligibilityDto? eligibility)
    {
        try
        {
            _db.ChangeTracker.Clear();
            var needsReview = identity is { NeedsReview: true };
            var pan = Customer.NormalizePan(dto.Pan);
            var mobile = Customer.NormalizeMobile(dto.Mobile);
            AuditHelper.LogChange(_db, HttpContext,
                entityName: needsReview ? "Customers" : "Loans",
                entityId: needsReview
                    ? string.Join(",", identity!.MatchedCustomerIds)
                    : (eligibility?.BlockingLoanId?.ToString() ?? string.Empty),
                action: needsReview ? "CustomerNeedsReview" : "ApplicationBlocked",
                oldValues: null,
                newValues: $"wizard submit; PAN {(pan == null ? "-" : pan[..5] + "****" + pan[^1])}, " +
                           $"mobile {(mobile == null ? "-" : "******" + mobile[^4..])}" +
                           (dto.LoanId is > 0 ? $", draft {dto.LoanId}" : string.Empty),
                reason: needsReview ? $"{ApiErrorCodes.CustomerNeedsReview}: {identity!.Message}"
                                    : $"{eligibility!.Code}: {eligibility.Message}",
                userId: CurrentUserId, userName: CurrentUserEmail);
            await _db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not write the blocked-application audit entry.");
        }
    }

    // Defence-in-depth boundary check, not the primary fix (that is the
    // gender <select>'s options in NewApplicationPage.tsx, which now sends
    // 'M'/'F'/'O' -- exactly what legacy's own <option value="M">/"F"/"O">
    // sends, per app.css/efin-app.js:26108-26110). Customers.Gender is
    // varchar(1) (20260726010000_AddCustomerKycFields.cs) by design; this
    // exists so a cached pre-fix frontend bundle, or any future direct API
    // caller, can never again reproduce the 500 that hit production 225
    // times on 2026-08-24 ("value too long for type character varying(1)")
    // by sending the full word instead of the code.
    private static string? NormalizeGender(string? raw)
    {
        var g = raw?.Trim();
        if (string.IsNullOrEmpty(g)) return g;
        return g[0] is 'M' or 'm' ? "M" : g[0] is 'F' or 'f' ? "F" : "O";
    }

    // Wizard employment CODE (toEmploymentCode in the frontend: SALARIED /
    // SELFEMP / PROFESSIONAL) → the stored display value on Customer. Shared by
    // the create AND update branches of FindOrCreateCustomerAsync so a resumed
    // draft's EmploymentType round-trips instead of being dropped on update.
    private static string? MapEmpType(string? code) => code switch
    {
        "SALARIED"     => "Salaried",
        "SELFEMP"      => "Self-Employed",
        "PROFESSIONAL" => "Professional",
        _              => code,
    };

    // Reads the Customer-facing fields that ride inside the wizard's free-form
    // ProductData bag (Mother's Name, structured Office Address lines, and the
    // full Permanent Address block) and writes them onto the Customer record.
    // These already have dedicated Customer/CustomerDto columns and a working
    // edit path (LoanApplicantTabs.tsx -> PUT /api/customers/{id}) — this only
    // closes the gap on the WIZARD SUBMIT path, which serialised ProductData
    // onto Loan.ProductDataJson (via ApplyMapping) but never read any of these
    // specific keys back out onto the Customer entity itself. Every write here
    // is guarded (only overwrites when the wizard actually sent that key), so a
    // save that omits, say, Office Address never blanks an existing value.
    private static void ApplyProductDataCustomerFields(Customer customer, Dictionary<string, object>? productData, bool protectIdentity)
    {
        if (productData == null || productData.Count == 0) return;

        var mother = GetProductDataString(productData, "mother");
        if (!string.IsNullOrWhiteSpace(mother) && (!protectIdentity || string.IsNullOrWhiteSpace(customer.MotherName))) customer.MotherName = mother.Trim();

        // Office address — Step 5 captures it as two lines + PIN (Vanilla
        // parity), but Customer has a single OfficeAddress column (the same
        // shape the Employment tab already renders as one field), so the two
        // lines are combined the same way House No. / Street & Locality are
        // split for the current address.
        var officeAddr1 = GetProductDataString(productData, "officeAddr1");
        var officeAddr2 = GetProductDataString(productData, "officeAddr2");
        var officeAddress = string.Join(", ", new[] { officeAddr1, officeAddr2 }
            .Where(s => !string.IsNullOrWhiteSpace(s)));
        if (!string.IsNullOrWhiteSpace(officeAddress)) customer.OfficeAddress = officeAddress;
        var officePin = GetProductDataString(productData, "officePin");
        if (!string.IsNullOrWhiteSpace(officePin)) customer.OfficePinCode = officePin.Trim();

        // Permanent address block (Step 4, second half) — the wizard requires
        // and validates all six of these whenever "Same as current" isn't
        // checked, but previously never sent them to the backend at all.
        var pStreet1 = GetProductDataString(productData, "pStreet1");
        if (!string.IsNullOrWhiteSpace(pStreet1)) customer.PermanentHouseNo = pStreet1.Trim();
        var pStreet2 = GetProductDataString(productData, "pStreet2");
        if (!string.IsNullOrWhiteSpace(pStreet2)) customer.PermanentAddress = pStreet2.Trim();
        var pCity = GetProductDataString(productData, "pCity");
        if (!string.IsNullOrWhiteSpace(pCity)) customer.PermanentCity = pCity;
        var pState = GetProductDataString(productData, "pState");
        if (!string.IsNullOrWhiteSpace(pState)) customer.PermanentState = pState;
        var pZip = GetProductDataString(productData, "pZip");
        if (!string.IsNullOrWhiteSpace(pZip)) customer.PermanentPinCode = pZip.Trim();
        var pHomeType = GetProductDataString(productData, "pHomeType");
        if (!string.IsNullOrWhiteSpace(pHomeType)) customer.PermanentResidenceType = pHomeType;
    }

    // ProductData binds as Dictionary<string, object>, so System.Text.Json
    // materialises every value as a boxed JsonElement rather than a plain
    // string — unwrap it the same way regardless of which shape arrives.
    private static string? GetProductDataString(Dictionary<string, object> productData, string key)
    {
        if (!productData.TryGetValue(key, out var raw) || raw == null) return null;
        if (raw is System.Text.Json.JsonElement je)
            return je.ValueKind == System.Text.Json.JsonValueKind.String ? je.GetString() : je.ToString();
        return raw.ToString();
    }

    // Persist the two wizard references (Step 7) onto the loan. Shared by Submit
    // AND SaveDraft so a resumed draft keeps its references instead of losing
    // them — SaveDraft previously never wrote LoanReference rows at all, so a
    // draft resumed before submission came back with empty Reference fields.
    // `replaceExisting` clears prior rows first (a resume/re-save), matching the
    // behaviour Submit already had, so a loan never accumulates duplicate refs.
    private async Task SyncReferencesAsync(Loan loan, WizardSubmitDto dto, bool replaceExisting)
    {
        if (replaceExisting)
        {
            var oldRefs = await _db.Set<LoanReference>().Where(r => r.LoanId == loan.Id).ToListAsync();
            if (oldRefs.Count > 0) _db.Set<LoanReference>().RemoveRange(oldRefs);
        }
        if (!string.IsNullOrWhiteSpace(dto.R1Name) && !string.IsNullOrWhiteSpace(dto.R1Mobile))
            _db.Set<LoanReference>().Add(new LoanReference
            {
                LoanId = loan.Id, RefNumber = 1,
                Name = dto.R1Name, Mobile = dto.R1Mobile,
                Relation = dto.R1Relation ?? "Other", CreatedAt = DateTime.UtcNow
            });
        if (!string.IsNullOrWhiteSpace(dto.R2Name) && !string.IsNullOrWhiteSpace(dto.R2Mobile))
            _db.Set<LoanReference>().Add(new LoanReference
            {
                LoanId = loan.Id, RefNumber = 2,
                Name = dto.R2Name, Mobile = dto.R2Mobile,
                Relation = dto.R2Relation ?? "Other", CreatedAt = DateTime.UtcNow
            });
    }

    // Persist the banks picked on Step 9's eligibility matcher — see
    // WizardSubmitDto.SelectedBanks for why this runs here rather than
    // through the separate bank-lines endpoint. Same whole-set soft-delete +
    // re-add convention as LoanRepository.ReplaceBankLinesAsync (the
    // production path other callers use), so a loan's bank-lines history
    // stays consistent regardless of which path wrote it. No-op when the
    // wizard sent no bank picks — never clears an already-saved set.
    private async Task SyncBankLinesAsync(Loan loan, WizardSubmitDto dto)
    {
        if (dto.SelectedBanks == null || dto.SelectedBanks.Count == 0) return;

        var existing = await _db.Set<LoanBankLine>()
            .Where(b => b.LoanId == loan.Id && !b.IsDeleted).ToListAsync();
        foreach (var line in existing)
        {
            line.IsDeleted = true;
            line.UpdatedAt = DateTime.UtcNow;
        }
        foreach (var b in dto.SelectedBanks)
        {
            if (string.IsNullOrWhiteSpace(b.BankName)) continue;
            _db.Set<LoanBankLine>().Add(new LoanBankLine
            {
                LoanId = loan.Id,
                BankName = b.BankName,
                TempApplicationNumber = b.TempApplicationNumber ?? string.Empty,
                ApplicationNumber = b.ApplicationNumber,
                ApprovedLoan = b.ApprovedLoan,
                Remarks = b.Remarks,
                CreatedAt = DateTime.UtcNow
            });
        }
    }

    /// <summary>
    /// Phase 2 (Wizard Sales Person Assignment) — resolves dto.SalesPerson
    /// (the sales user's FullName, exactly as sent by the wizard's Sales
    /// Person dropdown — see wSalesPersonChange/twUsers in efin-app.js) to an
    /// active User, reusing the existing User table/lookup — no new
    /// indirection or matching system. Shared error/resolution logic for both
    /// Submit() loan-creation branches (new loan and existing-draft resume).
    ///   missing SalesPerson -> reject
    ///   no matching User    -> reject
    ///   matching User inactive -> reject
    ///   valid active User   -> resolved, ready for Loan.AssignedToUserId
    /// </summary>
    private async Task<(List<string> Errors, User? SalesPersonUser)> ResolveSalesPersonAsync(WizardSubmitDto dto)
    {
        var errors = new List<string>();

        if (string.IsNullOrWhiteSpace(dto.SalesPerson))
        {
            errors.Add("Sales Person is required.");
            return (errors, null);
        }

        var salesPersonUser = await _db.Users.FirstOrDefaultAsync(u =>
            u.FullName == dto.SalesPerson.Trim() && !u.IsDeleted);

        if (salesPersonUser == null)
        {
            errors.Add("Selected Sales Person was not found.");
            return (errors, null);
        }

        if (!salesPersonUser.IsActive)
        {
            errors.Add("Selected Sales Person is inactive.");
            return (errors, null);
        }

        return (errors, salesPersonUser);
    }

    /// <summary>Submit full loan application from wizard.</summary>
    [HttpPost("submit")]
    public async Task<IActionResult> Submit([FromBody] WizardSubmitDto dto)
    {
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canCreateApp"))
            return Forbid();

        var errors = ValidateFieldFormats(dto);
        if (dto.Amount <= 0)
            errors.Add("Loan amount must be greater than 0.");
        if (string.IsNullOrWhiteSpace(dto.FullName))
            errors.Add("Applicant name is required.");
        if (string.IsNullOrWhiteSpace(dto.Mobile))
            errors.Add("Mobile number is required.");
        errors.AddRange(ValidateFinalSubmitCompleteness(dto));
        errors.AddRange(await ValidateMappingAsync(dto));

        // Phase 2 — resolved once, up front, so both the new-loan and
        // draft-resume branches below use the exact same validated User.
        var (salesPersonErrors, salesPersonUser) = await ResolveSalesPersonAsync(dto);
        errors.AddRange(salesPersonErrors);

        if (errors.Count > 0)
            return BadRequest(ApiResponseDto<WizardSubmitResponseDto>.Fail(errors));

        // NpgsqlRetryingExecutionStrategy (from EnableRetryOnFailure) does not allow a
        // manually-opened transaction to span retries on its own — the transaction and
        // every operation inside it must be run through CreateExecutionStrategy().ExecuteAsync
        // so that if a transient failure occurs, the whole unit (including opening a fresh
        // transaction) is retried atomically instead of throwing
        // "does not support user-initiated transactions".
        var strategy = _db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
        await using var tx = await _db.Database.BeginTransactionAsync();
        try
        {
            // ── 0. If resuming a draft, load the existing loan (and its customer) ──
            Loan? existingLoan = null;
            if (dto.LoanId.HasValue && dto.LoanId.Value > 0)
            {
                existingLoan = await _db.Loans
                    .FirstOrDefaultAsync(l => l.Id == dto.LoanId.Value && !l.IsDeleted);

                if (existingLoan == null)
                {
                    await tx.RollbackAsync();
                    return NotFound(ApiResponseDto<WizardSubmitResponseDto>.Fail("Draft application not found."));
                }

                if (existingLoan.Status != LoanStatus.Draft)
                {
                    await tx.RollbackAsync();
                    return BadRequest(ApiResponseDto<WizardSubmitResponseDto>.Fail(
                        "This application has already been submitted."));
                }

                // BUGFIX (confirmed real IDOR — Submit had no ownership check on
                // dto.LoanId): without this, any authenticated user could pass
                // another user's draft id and have Submit resume/finalize it as
                // their own — same visibility rule GetDraft already enforces
                // (only the draft's own creator, or Admin/Manager, may act on
                // it), and the same 404-not-2xx-error shape so a foreign draft
                // id doesn't leak its existence either.
                var isInternalSubmit = CurrentUserRole is "Admin" or "Manager";
                if (!isInternalSubmit && existingLoan.CreatedByUserId != CurrentUserId)
                {
                    await tx.RollbackAsync();
                    return NotFound(ApiResponseDto<WizardSubmitResponseDto>.Fail("Draft application not found."));
                }
            }

            // ── 1. Identify (global) or create the customer ─────────────────────
            var (resolvedCustomer, identity) = await ResolveCustomerForApplicationAsync(dto, existingLoan);
            if (resolvedCustomer == null)
            {
                await tx.RollbackAsync();
                await AuditBlockedSubmitAsync(dto, identity, null);
                return BlockedResponse<WizardSubmitResponseDto>(identity, null);
            }
            var customer = resolvedCustomer;
            await _db.SaveChangesAsync();

            // ── 1b. Central duplicate-application + 45-day guard ───────────────
            // Locked per customer inside this transaction, so two users
            // submitting for the same customer at the same moment are
            // serialised: the second sees the first's application and gets 409.
            // A resumed draft is excluded from "active" (it IS this application)
            // but is otherwise re-checked against today's state.
            var eligibility = await _loanService.GuardApplicationAsync(customer.Id, existingLoan?.Id);
            if (!eligibility.Allowed)
            {
                await tx.RollbackAsync();
                await AuditBlockedSubmitAsync(dto, null, eligibility);
                return BlockedResponse<WizardSubmitResponseDto>(null, eligibility);
            }

            // ── 2. Generate loan number (reuse existing one when resuming a draft) ──
            string loanNum;
            if (existingLoan != null)
            {
                loanNum = existingLoan.LoanNumber;
            }
            else
            {
                // EFIN + current year + 7-digit random (non-sequential) number.
                var year = DateTime.UtcNow.Year;
                do
                {
                    var suffix = System.Security.Cryptography.RandomNumberGenerator.GetInt32(1000000, 10000000).ToString();
                    loanNum = $"EFIN{year}{suffix}";
                }
                // Re-roll on collision to guarantee uniqueness across all statuses
                // (Draft, Processing, Completed, Rejected, Resumed all live in the same table).
                while (await _db.Loans.AnyAsync(l => l.LoanNumber == loanNum));
            }

            var loanType = _loanTypeMap.TryGetValue(dto.LoanType ?? "personal_loan", out var lt)
                           ? lt : LoanType.Personal;
            var emi      = LoanMS.Application.Services.EmiCalculator.ReducingBalance(dto.Amount, dto.LoanRate > 0 ? dto.LoanRate : 12, dto.Tenure > 0 ? dto.Tenure : 24);

            // ── 3. Create or update loan ─────────────────────────────────────────
            // Resuming a draft updates the SAME record (and clears the Draft status)
            // instead of inserting a duplicate — a draft must never outlive its
            // completed application.
            Loan loan;
            if (existingLoan != null)
            {
                loan = existingLoan;
                loan.LoanType        = loanType;
                loan.RequestedAmount = dto.Amount;
                loan.InterestRate    = dto.LoanRate > 0 ? dto.LoanRate : 12;
                loan.TenureMonths    = dto.Tenure > 0 ? dto.Tenure : 24;
                loan.MonthlyEmi      = emi;
                loan.Purpose         = dto.Purpose;
                loan.Remarks         = $"Source: {dto.Source ?? "Direct"} | Channel: {dto.Channel ?? "walk-in"}"
                                      + (dto.LenderName != null ? $" | Lender: {dto.LenderName}" : "");
                loan.SelectedLenderNames = dto.LenderName;
                loan.Status          = LoanStatus.Submitted;
                loan.UpdatedAt       = DateTime.UtcNow;
                // Re-link when the typed identifiers identified an existing
                // customer (see ResolveCustomerForApplicationAsync).
                loan.CustomerId      = customer.Id;
                // Phase 2 — Wizard Sales Person Assignment: resolved above
                // (never null past the error-check), so a draft resume can
                // reassign the loan the same way a fresh submission does.
                loan.AssignedToUserId = salesPersonUser!.Id;
                ApplyMapping(loan, dto);
            }
            else
            {
                loan = new Loan
                {
                    LoanNumber      = loanNum,
                    LoanType        = loanType,
                    // Completed in a single session — goes straight to Submitted.
                    // (No intermediate Draft row is created for a completed submission.)
                    Status          = LoanStatus.Submitted,
                    RequestedAmount = dto.Amount,
                    InterestRate    = dto.LoanRate > 0 ? dto.LoanRate : 12,
                    TenureMonths    = dto.Tenure > 0 ? dto.Tenure : 24,
                    MonthlyEmi      = emi,
                    Purpose         = dto.Purpose,
                    // Internal routing stored in Remarks — never returned to external callers
                    Remarks         = $"Source: {dto.Source ?? "Direct"} | Channel: {dto.Channel ?? "walk-in"}"
                                    + (dto.LenderName != null ? $" | Lender: {dto.LenderName}" : ""),
                    SelectedLenderNames = dto.LenderName,
                    CustomerId      = customer.Id,
                    // CreatedByUserId always comes from the authenticated JWT identity —
                    // never from the request body — so the request cannot spoof authorship.
                    CreatedByUserId = CurrentUserId,
                    // Phase 2 — Wizard Sales Person Assignment: resolved above
                    // (never null past the error-check).
                    AssignedToUserId = salesPersonUser!.Id,
                    DsaId           = dto.DsaId,
                    PartnerId       = dto.PartnerId,
                    LocationId      = dto.LocationId,
                    CreatedAt       = DateTime.UtcNow
                };
                // Persist product-specific / co-applicant / reference-address /
                // insurance fields on a FRESH direct submit too — the existing-
                // draft branch above already calls ApplyMapping, but this create
                // branch previously dropped ProductDataJson, so a submit that
                // never went through an autosaved draft lost all of it.
                ApplyMapping(loan, dto);
                _db.Loans.Add(loan);
            }
            await _db.SaveChangesAsync();
            await RemoveSupersededProvisionalCustomerAsync(identity);

            // ── 4. Status history ────────────────────────────────────────────────
            _db.Set<LoanStatusHistory>().Add(new LoanStatusHistory
            {
                LoanId          = loan.Id,
                FromStatus      = LoanStatus.Draft,
                ToStatus        = LoanStatus.Submitted,
                Comment         = existingLoan != null
                                  ? $"Draft application completed and submitted via EFIN Wizard by {CurrentUserRole}."
                                  : $"Application submitted via EFIN Wizard by {CurrentUserRole}.",
                ChangedByUserId = CurrentUserId,
                CreatedAt       = DateTime.UtcNow
            });

            // ── 4b. Login-User auto-assignment (Phase 2 RBAC — G-05) ─────────────
            // Route the freshly-submitted application to the least-loaded active
            // Login User at its Location. Sets loan.LoginUserId and adds an
            // AssignmentAuditLog row to this same context/transaction (no
            // SaveChanges of its own) — persisted by the SaveChanges below. A
            // no-op when the loan has no Location or already has a Login User, so
            // it never blocks a submission. Best-effort: a routing hiccup must
            // never fail an otherwise-valid application submission.
            try
            {
                await _loginAssign.AutoAssignLoginUserAsync(loan);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Login-User auto-assignment failed for loan {LoanId}; left unassigned.", loan.Id);
            }

            // ── 5. References ─────────────────────────────────────────────────
            // Resuming a draft replaces any references captured earlier so the
            // final submission never ends up with duplicate reference rows.
            // (Shared with SaveDraft via SyncReferencesAsync.)
            await SyncReferencesAsync(loan, dto, existingLoan != null);

            // ── 5b. Bank lines (Step 9) ───────────────────────────────────────
            await SyncBankLinesAsync(loan, dto);

            // ── 6. Auto-calculate payout (server-side only — not user-submitted) ──
            // Phase 3: generate one claim per eligible claimant tied to this loan —
            // the submitting user, plus the linked-user accounts (DsaPartner.
            // LinkedUserId) of any DSA/Partner mapped onto the loan — instead of a
            // single claim for whoever completed the wizard. Every ClaimedByUserId
            // here comes either from the authenticated JWT (CurrentUserId) or from
            // a server-validated FK already persisted on the loan (loan.DsaId /
            // loan.PartnerId, checked in ValidateDsaPartnerMapping above) — never
            // from a claimant list supplied in the request body.
            // Idempotent per (LoanId, ClaimedByUserId, ClaimType): resuming a draft,
            // or this step running more than once for any reason, can never produce
            // duplicate claims — enforced here and backed by a unique DB index.
            var payoutRule = await _db.Set<PayoutRule>()
                .FirstOrDefaultAsync(r => r.LoanType == dto.LoanType && r.IsActive && !r.IsDeleted);

            if (payoutRule != null)
            {
                var claimAmt = Math.Round(dto.Amount * payoutRule.Percentage / 100, 2);
                if (payoutRule.MinPayout.HasValue) claimAmt = Math.Max(claimAmt, payoutRule.MinPayout.Value);
                if (payoutRule.MaxPayout.HasValue) claimAmt = Math.Min(claimAmt, payoutRule.MaxPayout.Value);

                // Claimant list: (userId, claimType). Built entirely from
                // server-trusted identity/FKs, never client-supplied.
                var claimants = new List<(int UserId, string ClaimType)>();

                var submitterType = CurrentUserRole switch
                {
                    "Dsa"     => "Dsa",
                    "Partner" => "Partner",
                    _         => "Sales"   // Admin/Manager/Sales submitting on their own behalf
                };
                if (CurrentUserId > 0) claimants.Add((CurrentUserId, submitterType));

                if (loan.DsaId.HasValue)
                {
                    var dsaUserId = await _db.DsaPartners
                        .Where(d => d.Id == loan.DsaId.Value && !d.IsDeleted)
                        .Select(d => d.LinkedUserId).FirstOrDefaultAsync();
                    if (dsaUserId.HasValue && !claimants.Any(c => c.UserId == dsaUserId.Value && c.ClaimType == "Dsa"))
                        claimants.Add((dsaUserId.Value, "Dsa"));
                }
                if (loan.PartnerId.HasValue)
                {
                    var partnerUserId = await _db.DsaPartners
                        .Where(d => d.Id == loan.PartnerId.Value && !d.IsDeleted)
                        .Select(d => d.LinkedUserId).FirstOrDefaultAsync();
                    if (partnerUserId.HasValue && !claimants.Any(c => c.UserId == partnerUserId.Value && c.ClaimType == "Partner"))
                        claimants.Add((partnerUserId.Value, "Partner"));
                }

                // Claims already persisted for this loan (covers resuming a draft
                // where this step may have already partially run before).
                var existingClaimKeys = await _db.Set<PayoutClaim>()
                    .Where(p => p.LoanId == loan.Id)
                    .Select(p => new { p.ClaimedByUserId, p.ClaimType })
                    .ToListAsync();

                foreach (var (userId, claimType) in claimants)
                {
                    if (userId <= 0) continue;
                    if (existingClaimKeys.Any(k => k.ClaimedByUserId == userId && k.ClaimType == claimType)) continue;
                    _db.Set<PayoutClaim>().Add(new PayoutClaim
                    {
                        LoanId = loan.Id, ClaimAmount = claimAmt,
                        Month  = DateTime.UtcNow.ToString("MMM yyyy"),
                        Notes  = $"Auto-generated from configured payout rule",   // no formula/rate disclosed
                        Status = "Pending", ClaimedByUserId = userId, ClaimType = claimType,
                        CreatedAt = DateTime.UtcNow
                    });
                }
            }

            await _db.SaveChangesAsync();
            await tx.CommitAsync();

            // Phase 3 — no cache invalidation needed here anymore. This save goes
            // straight through AppDbContext (not ILoanService), but that no longer
            // matters: LoanService.GetAllAsync and GetDashboardStatsAsync both read
            // straight from the database on every call, so there's no "loans:list:"
            // or "dashboard:" cache left to go stale in the first place.

            // The loan/customer a user just created is theirs to know about —
            // returning its id here is what lets the wizard show a proper
            // "Application ID" confirmation and upload mandatory documents to
            // it immediately afterward, for every role (Admin/Manager/Sales).
            return Ok(ApiResponseDto<WizardSubmitResponseDto>.Ok(new WizardSubmitResponseDto
            {
                EfinId     = dto.EfinId ?? loanNum,
                LoanId     = loan.Id,
                CustomerId = customer.Id,
                LoanNumber = loanNum,
                MonthlyEmi = emi,
                Status     = loan.Status.ToString()
            }, $"Application {loanNum} submitted successfully."));
        }
        catch (Exception ex) when (DbConflicts.Classify(ex) is { } conflict)
        {
            // Lost a race against the one-active-application / customer unique
            // index (the DB-level backstop): a clean 409, never a raw DB error.
            await tx.RollbackAsync();
            _logger.LogWarning(ex, "Wizard submission hit a uniqueness guard for user {UserId}", CurrentUserId);
            return Conflict(ApiResponseDto<WizardSubmitResponseDto>.Fail(conflict.Message, conflict.Code));
        }
        catch (Exception ex)
        {
            await tx.RollbackAsync();
            _logger.LogError(ex, "Wizard submission failed for user {UserId}", CurrentUserId);
            // Never expose ex.Message — it may contain table names, column names, SQL fragments
            return StatusCode(500, ApiResponseDto<WizardSubmitResponseDto>.Fail(
                "Application submission failed. Please try again or contact support."));
        }
        });
    }

    /// <summary>
    /// Fetch a previously-autosaved Draft loan back out of the database so the
    /// wizard can be resumed with the full form state (PAN, Aadhar, address,
    /// employment, references, etc.) coming from the server — not from a copy
    /// cached in browser localStorage. Only the loan's own creator, or an
    /// Admin/Manager, may resume it; a foreign draft id returns 404 rather
    /// than leaking another user's in-progress PII.
    /// </summary>
    [HttpGet("draft/{loanId:int}")]
    public async Task<IActionResult> GetDraft(int loanId)
    {
        var loan = await _db.Loans
            .Include(l => l.Customer)
            .Include(l => l.AssignedTo)
            .Include(l => l.Dsa)
            .Include(l => l.Partner)
            .Include(l => l.Location)
            .FirstOrDefaultAsync(l => l.Id == loanId && !l.IsDeleted && l.Status == LoanStatus.Draft);

        if (loan == null)
            return NotFound(ApiResponseDto<WizardSubmitDto>.Fail("Draft not found."));

        var isInternal = CurrentUserRole is "Admin" or "Manager";
        if (!isInternal && loan.CreatedByUserId != CurrentUserId)
            return NotFound(ApiResponseDto<WizardSubmitDto>.Fail("Draft not found."));

        var refs = await _db.LoanReferences
            .Where(r => r.LoanId == loanId)
            .ToListAsync();
        var r1 = refs.FirstOrDefault(r => r.RefNumber == 1);
        var r2 = refs.FirstOrDefault(r => r.RefNumber == 2);
        var c  = loan.Customer;

        var dto = new WizardSubmitDto
        {
            LoanId      = loan.Id,
            Step        = loan.WizardStep,
            FullName    = c?.FullName ?? string.Empty,
            Mobile      = c?.Phone ?? string.Empty,
            Email       = c?.Email ?? string.Empty,
            Pan         = c?.PanNumber,
            Aadhar      = c?.AadhaarNumber,
            Dob         = c?.DateOfBirth?.ToString("yyyy-MM-dd"),
            Gender      = c?.Gender,
            FatherName  = c?.FatherName,
            Cibil       = c?.CibilScore,
            City        = c?.City,
            State       = c?.State,
            Street1     = c?.Address,
            Zip         = c?.PinCode,
            HomeType    = c?.ResidenceType,
            EmpType     = c?.EmploymentType,
            CompName    = c?.CompanyName,
            Salary      = c?.MonthlyIncome ?? 0,
            Obligations = c?.MonthlyObligations ?? 0,
            LoanType    = _loanTypeMap.FirstOrDefault(kv => kv.Value == loan.LoanType).Key ?? "personal_loan",
            Amount      = loan.RequestedAmount,
            LoanRate    = loan.InterestRate,
            Tenure      = loan.TenureMonths,
            Purpose     = loan.Purpose,
            R1Name      = r1?.Name,
            R1Mobile    = r1?.Mobile,
            R1Relation  = r1?.Relation,
            R2Name      = r2?.Name,
            R2Mobile    = r2?.Mobile,
            R2Relation  = r2?.Relation,
            DsaId       = loan.DsaId,
            PartnerId   = loan.PartnerId,
            LocationId  = loan.LocationId,
            DsaName       = loan.Dsa?.Name,
            PartnerName   = loan.Partner?.Name,
            LocationName  = loan.Location?.Name,
            EfinId      = loan.LoanNumber,
            // BUGFIX (confirmed real gap — draft resume losing Insurance/
            // Property/Vehicle/Education fields): Loan.ProductDataJson was
            // already correctly saved by ApplyMapping, but GetDraft never
            // read it back — the frontend's own restore path (see
            // _fetchWizardDraftFields in api-bridge.js) already spreads
            // dto.ProductData back onto individual app.insXxx/propXxx/
            // carXxx/eduXxx fields when present, so this alone completes
            // that round-trip.
            // Deserialize into string values (productData is always a flat
            // string map from the wizard), then box to object. Deserializing as
            // Dictionary<string,object> yields JsonElement values, which the
            // response serializer emits as {"valueKind":"String"} metadata
            // instead of the actual string — breaking the resume of every
            // productData field (mother / reference addresses / property /
            // vehicle / education / co-applicant / insurance / dsaLinkedPartner).
            ProductData = string.IsNullOrWhiteSpace(loan.ProductDataJson)
                ? null
                : System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, string>>(loan.ProductDataJson)
                    ?.ToDictionary(kv => kv.Key, kv => (object)kv.Value),
            // BUGFIX (confirmed real gap — draft resume losing Channel/
            // Source): both are saved, but only ever packed into Remarks
            // as "Source: X | Channel: Y" (see ApplyMapping/Submit's own
            // Remarks-construction, unchanged) — parsed back out with the
            // exact same fixed format, not guessed at. Correctly yields
            // null (not a wrong value) if Remarks doesn't match the
            // expected shape, e.g. an older draft saved before this
            // format existed.
            Source  = System.Text.RegularExpressions.Regex.Match(loan.Remarks ?? "", @"Source:\s*([^|]+?)\s*(\||$)").Groups[1].Value is { Length: > 0 } _src ? _src : null,
            Channel = System.Text.RegularExpressions.Regex.Match(loan.Remarks ?? "", @"Channel:\s*([^|]+?)\s*(\||$)").Groups[1].Value is { Length: > 0 } _chn ? _chn : null,
            // BUGFIX (confirmed real gap — draft resume losing Sales Person):
            // DsaId/PartnerId/LocationId were already correctly saved and
            // returned here, but SalesPerson never was, even though the
            // WizardSubmitDto property has existed all along — resolve it
            // from the same AssignedToUserId the rest of the app already
            // uses for "Sales Person" (see LoanDto's own Sales Person
            // resolution for the equivalent pattern).
            SalesPerson = loan.AssignedTo?.FullName,
            // Round-trips Step 9's previously-selected bank(s) back to the
            // wizard on resume — see Loan.SelectedLenderNames's own doc
            // comment for why this is a dedicated field rather than parsed
            // back out of Remarks.
            LenderName  = loan.SelectedLenderNames,
        };

        return Ok(ApiResponseDto<WizardSubmitDto>.Ok(dto));
    }

    /// <summary>
    /// List this user's in-progress wizard drafts, for the Applications → Drafts
    /// list. Replaces the old client-only localStorage index (draftStorage.ts) —
    /// the id/step/label/loanType/timestamps needed to render that list, and to
    /// resume a draft on any device, now come entirely from the database.
    /// Admin/Manager see every draft (same visibility rule as GetDraft); every
    /// other role only sees drafts they created.
    /// </summary>
    [HttpGet("drafts")]
    public async Task<IActionResult> ListDrafts()
    {
        var isInternal = CurrentUserRole is "Admin" or "Manager";

        var q = _db.Loans.IncludeDeletedUsers()
            .Include(l => l.Customer)
            .Where(l => !l.IsDeleted && l.Status == LoanStatus.Draft);

        if (!isInternal)
            q = q.Where(l => l.CreatedByUserId == CurrentUserId);

        var drafts = await q
            .OrderByDescending(l => l.UpdatedAt ?? l.CreatedAt)
            .Select(l => new
            {
                loanId             = l.Id,
                step               = l.WizardStep,
                loanType           = l.LoanType,
                fullName           = l.Customer.FullName,
                createdAt          = l.CreatedAt,
                updatedAt          = l.UpdatedAt ?? l.CreatedAt,
                // Real owner of the draft, independent of who is *viewing*
                // this list (Admin/Manager see every draft — see isInternal
                // above, untouched). Frontend needs this to tell "my draft"
                // apart from "someone else's draft I can merely see".
                createdByUserId    = l.CreatedByUserId,
                createdByUserEmail = l.CreatedBy.Email
            })
            .ToListAsync();

        // Map LoanType enum back to the short key the wizard/frontend uses
        // (e.g. LoanType.Car -> "new_car"), and build a small, generic label —
        // no PII beyond what a Draft/Applications-list entry already implies.
        var result = drafts.Select(d => new
        {
            loanId             = d.loanId,
            step               = d.step,
            loanType           = _loanTypeMap.FirstOrDefault(kv => kv.Value == d.loanType).Key ?? "personal_loan",
            label              = string.IsNullOrWhiteSpace(d.fullName)
                        ? "Untitled application"
                        : d.fullName,
            createdAt          = d.createdAt,
            updatedAt          = d.updatedAt,
            createdByUserId    = d.createdByUserId,
            createdByUserEmail = d.createdByUserEmail,
            // 🟡 Stale Draft Visibility (item #13) — days since last touched.
            // No draft-staleness threshold is defined anywhere else in this
            // project; 7 days is a reasonable default matching common
            // "abandoned form" conventions, not a confirmed business rule —
            // REQUIRES BUSINESS CONFIRMATION if a different value is wanted.
            // Purely informational: nothing here deletes or changes any
            // draft's lifecycle.
            daysSinceUpdate    = Math.Round((DateTime.UtcNow - (d.updatedAt)).TotalDays, 1),
            isStale            = (DateTime.UtcNow - (d.updatedAt)).TotalDays > 7
        });

        return Ok(ApiResponseDto<object>.Ok(result));
    }

    /// <summary>
    /// Persist wizard progress as a Draft-status Loan (+ Customer) so it can be
    /// resumed from the same database record rather than only from browser
    /// localStorage. Safe to call repeatedly while the user is filling out the
    /// wizard — pass the returned loanId back in on later calls (and in the
    /// final Submit) so they all keep updating the same record instead of
    /// creating duplicates.
    /// </summary>
    [HttpPost("draft")]
    public async Task<IActionResult> SaveDraft([FromBody] WizardSubmitDto dto)
    {
        // Same gate as Submit: a draft is a real application + customer row, so
        // a role that may not create applications must not create drafts either
        // (it could otherwise create customers and hold the 45-day slot).
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canCreateApp"))
            return Forbid();

        // Not enough entered yet to be worth persisting.
        if (string.IsNullOrWhiteSpace(dto.Mobile) && string.IsNullOrWhiteSpace(dto.FullName))
            return Ok(ApiResponseDto<WizardSubmitResponseDto>.Ok(new WizardSubmitResponseDto(), "Nothing to save yet."));

        var mappingErrors = await ValidateMappingAsync(dto);
        if (mappingErrors.Count > 0)
            return BadRequest(ApiResponseDto<WizardSubmitResponseDto>.Fail(mappingErrors));

        // See Submit() above — same NpgsqlRetryingExecutionStrategy compatibility fix:
        // the transaction must be opened and committed inside the strategy's retry
        // delegate, not around it.
        var strategy = _db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
        // Concurrency: two simultaneous NEW drafts for the same person both
        // pass FindOrCreateCustomerAsync's PAN/Email lookup (neither committed
        // yet), both INSERT a Customer, and the DB's unique index rejects the
        // loser — which previously surfaced as an unhandled 500. Retry ONCE:
        // on the retry the loser's FindOrCreate now finds the winner's
        // committed customer and reuses it. Any other error still returns 500
        // immediately. Bounded to a single retry (attempt 0 then 1).
        for (var attempt = 0; ; attempt++)
        {
        await using var tx = await _db.Database.BeginTransactionAsync();
        try
        {
            Loan? existingLoan = null;
            if (dto.LoanId.HasValue && dto.LoanId.Value > 0)
            {
                existingLoan = await _db.Loans.FirstOrDefaultAsync(l => l.Id == dto.LoanId.Value && !l.IsDeleted);
                // Only ever autosave into a record that's still a Draft — a
                // submitted application must never be silently rewritten by a
                // stale/late autosave call.
                if (existingLoan != null && existingLoan.Status != LoanStatus.Draft)
                    existingLoan = null;

                // BUGFIX (confirmed real IDOR — SaveDraft had no ownership check
                // on dto.LoanId): without this, any authenticated user could pass
                // another user's draft id and have their own autosave overwrite
                // that foreign draft's data. Same visibility rule GetDraft/Submit
                // already enforce (only the draft's own creator, or Admin/
                // Manager, may write into it). Unlike Submit/GetDraft this is a
                // silent background autosave, so a mismatch does not surface an
                // error — it just falls back to starting a brand-new draft,
                // exactly like the status-mismatch branch immediately above.
                if (existingLoan != null)
                {
                    var isInternalSaveDraft = CurrentUserRole is "Admin" or "Manager";
                    if (!isInternalSaveDraft && existingLoan.CreatedByUserId != CurrentUserId)
                        existingLoan = null;
                }
            }

            // Same global identification + central guard as Submit, on every
            // autosave: a draft (which counts as an active application) can
            // neither be started nor kept for a customer who already has an
            // active application or is inside the 45-day window. Blocks are not
            // audited here — autosave fires on every pause in typing; the final
            // Submit records them.
            var (resolvedCustomer, identity) = await ResolveCustomerForApplicationAsync(dto, existingLoan);
            if (resolvedCustomer == null)
            {
                await tx.RollbackAsync();
                return BlockedResponse<WizardSubmitResponseDto>(identity, null);
            }
            var customer = resolvedCustomer;
            await _db.SaveChangesAsync();

            var eligibility = await _loanService.GuardApplicationAsync(customer.Id, existingLoan?.Id);
            if (!eligibility.Allowed)
            {
                await tx.RollbackAsync();
                return BlockedResponse<WizardSubmitResponseDto>(null, eligibility);
            }

            var loanType = _loanTypeMap.TryGetValue(dto.LoanType ?? "personal_loan", out var lt) ? lt : LoanType.Personal;

            Loan loan;
            if (existingLoan != null)
            {
                loan = existingLoan;
                loan.CustomerId      = customer.Id;
                loan.LoanType        = loanType;
                loan.RequestedAmount = dto.Amount;
                loan.InterestRate    = dto.LoanRate > 0 ? dto.LoanRate : 12;
                loan.TenureMonths    = dto.Tenure > 0 ? dto.Tenure : 24;
                loan.Purpose         = dto.Purpose;
                // BUGFIX (Wizard forensic audit): SaveDraft never wrote
                // Remarks at all, unlike Submit() (see below) — so Step 9's
                // bank-eligibility selection (sent here as dto.LenderName,
                // same field Submit already uses) had nowhere to land during
                // autosave. A user who selected a bank then navigated away
                // instead of submitting would have that selection vanish
                // with no trace in the database. Same Remarks format Submit()
                // already uses, so a later real Submit's own Remarks write
                // simply overwrites this with the final, authoritative value.
                if (dto.LenderName != null)
                {
                    loan.Remarks = $"Source: {dto.Source ?? "Direct"} | Channel: {dto.Channel ?? "walk-in"} | Lender: {dto.LenderName}";
                    loan.SelectedLenderNames = dto.LenderName;
                }
                loan.UpdatedAt       = DateTime.UtcNow;
                if (dto.Step.HasValue) loan.WizardStep = dto.Step;
                ApplyMapping(loan, dto);
            }
            else
            {
                var year = DateTime.UtcNow.Year;
                string loanNum;
                do
                {
                    var suffix = System.Security.Cryptography.RandomNumberGenerator.GetInt32(1000000, 10000000).ToString();
                    loanNum = $"EFIN{year}{suffix}";
                }
                while (await _db.Loans.AnyAsync(l => l.LoanNumber == loanNum));

                loan = new Loan
                {
                    LoanNumber      = loanNum,
                    LoanType        = loanType,
                    Status          = LoanStatus.Draft,
                    RequestedAmount = dto.Amount,
                    InterestRate    = dto.LoanRate > 0 ? dto.LoanRate : 12,
                    TenureMonths    = dto.Tenure > 0 ? dto.Tenure : 24,
                    Purpose         = dto.Purpose,
                    // Same reasoning as the existingLoan branch above.
                    Remarks         = dto.LenderName != null
                                    ? $"Source: {dto.Source ?? "Direct"} | Channel: {dto.Channel ?? "walk-in"} | Lender: {dto.LenderName}"
                                    : null,
                    SelectedLenderNames = dto.LenderName,
                    WizardStep      = dto.Step,
                    CustomerId      = customer.Id,
                    // CreatedByUserId always comes from the authenticated JWT identity —
                    // never from the request body — so the request cannot spoof authorship.
                    CreatedByUserId = CurrentUserId,
                    DsaId           = dto.DsaId,
                    PartnerId       = dto.PartnerId,
                    LocationId      = dto.LocationId,
                    CreatedAt       = DateTime.UtcNow
                };
                // Persist product-specific / co-applicant / reference-address /
                // insurance fields on the FIRST draft-save too (this create
                // branch previously dropped ProductDataJson; only subsequent
                // updates re-applied it). Mirrors the Submit create-branch fix.
                ApplyMapping(loan, dto);
                _db.Loans.Add(loan);
            }

            await _db.SaveChangesAsync();
            await RemoveSupersededProvisionalCustomerAsync(identity);

            // Persist Step-7 references on the draft too (shared with Submit) so a
            // resumed draft keeps them — SaveDraft previously wrote no LoanReference
            // rows, so references entered before submission vanished on resume.
            // loan.Id is assigned by the SaveChangesAsync above, which the rows need.
            await SyncReferencesAsync(loan, dto, existingLoan != null);
            await _db.SaveChangesAsync();

            await tx.CommitAsync();

            // Same reasoning as Submit() above — no cache invalidation needed,
            // the list/dashboard endpoints always read live from the database.

            return Ok(ApiResponseDto<WizardSubmitResponseDto>.Ok(new WizardSubmitResponseDto
            {
                EfinId     = dto.EfinId ?? loan.LoanNumber,
                LoanId     = loan.Id,
                CustomerId = customer.Id,
                LoanNumber = loan.LoanNumber,
                MonthlyEmi = 0,
                Status     = loan.Status.ToString()
            }, "Draft saved."));
        }
        catch (Exception ex) when (attempt == 0 && IsCustomerUniqueViolation(ex))
        {
            // Lost the customer unique-constraint race to a concurrent request.
            // Roll back, drop the failed tracked INSERT from the change tracker
            // (so the retry re-runs cleanly), and loop to try exactly once more.
            await tx.RollbackAsync();
            _db.ChangeTracker.Clear();
        }
        catch (Exception ex) when (DbConflicts.Classify(ex) is { } conflict)
        {
            await tx.RollbackAsync();
            _logger.LogWarning(ex, "Wizard draft save hit a uniqueness guard for user {UserId}", CurrentUserId);
            return Conflict(ApiResponseDto<WizardSubmitResponseDto>.Fail(conflict.Message, conflict.Code));
        }
        catch (Exception ex)
        {
            await tx.RollbackAsync();
            _logger.LogError(ex, "Wizard draft save failed for user {UserId}", CurrentUserId);
            return StatusCode(500, ApiResponseDto<WizardSubmitResponseDto>.Fail("Could not save draft."));
        }
        }
        });
    }

    // True when `ex` (or an inner exception) is a unique-constraint violation on
    // the Customers table — SQLite ("UNIQUE constraint failed: Customers.*") or
    // PostgreSQL (SqlState 23505 on IX_Customers_*). Used to detect the
    // concurrent same-PAN/Email customer-insert race in SaveDraft and retry.
    private static bool IsCustomerUniqueViolation(Exception ex)
    {
        for (Exception? e = ex; e != null; e = e.InnerException)
        {
            var m = e.Message;
            if (m != null
                && m.IndexOf("Customers", StringComparison.OrdinalIgnoreCase) >= 0
                && (m.IndexOf("UNIQUE", StringComparison.OrdinalIgnoreCase) >= 0
                    || m.IndexOf("duplicate", StringComparison.OrdinalIgnoreCase) >= 0
                    || m.IndexOf("23505", StringComparison.Ordinal) >= 0))
                return true;
        }
        return false;
    }

    /// <summary>Validate wizard data before final submit.</summary>
    [HttpPost("validate")]
    public async Task<IActionResult> Validate([FromBody] WizardSubmitDto dto)
    {
        // Runs the global customer / duplicate-application lookup, so it is part
        // of creating an application — same gate as Submit and SaveDraft.
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canCreateApp"))
            return Forbid();

        var errors = ValidateFieldFormats(dto);

        if (string.IsNullOrWhiteSpace(dto.FullName)) errors.Add("Full name is required.");
        if (string.IsNullOrWhiteSpace(dto.Mobile)) errors.Add("Mobile number is required.");
        if (dto.Amount <= 0) errors.Add("Loan amount must be greater than 0.");
        if (dto.Tenure <= 0 || dto.Tenure > 360) errors.Add("Tenure must be between 1-360 months.");
        // No interest-rate rule: Vanilla validateStep(6) gates on amount + tenure
        // only, and Submit applies its 12 % default to a blank rate — requiring it
        // here blocked the final submit of a wizard the UI had accepted.
        errors.AddRange(ValidateFinalSubmitCompleteness(dto));

        errors.AddRange(await ValidateMappingAsync(dto));

        if (errors.Any())
            return BadRequest(ApiResponseDto<object>.Fail(errors));

        // Duplicate customer / application + 45-day check — the SAME central
        // rules Submit enforces (read-only here; Submit re-checks under lock).
        // Replaces the old PAN-only copy of the active-loan rule. The draft
        // being completed (dto.LoanId) counts only if the caller may resume it.
        int? ownLoanId = null, ownCustomerId = null;
        if (dto.LoanId is > 0)
        {
            var draft = await _db.Loans.AsNoTracking()
                .Where(l => l.Id == dto.LoanId.Value && l.Status == LoanStatus.Draft)
                .Select(l => new { l.Id, l.CustomerId, l.CreatedByUserId }).FirstOrDefaultAsync();
            if (draft != null && (CurrentUserRole is "Admin" or "Manager" || draft.CreatedByUserId == CurrentUserId))
            {
                ownLoanId = draft.Id;
                ownCustomerId = draft.CustomerId;
            }
        }
        var identity = await _customerService.ResolveIdentityAsync(dto.Pan, dto.Mobile, dto.Email, ownCustomerId, ownLoanId);
        if (identity.NeedsReview)
            return BlockedResponse<object>(identity, null);
        if (identity.CustomerId is int customerId)
        {
            var eligibility = await _loanService.CheckApplicationEligibilityAsync(customerId, ownLoanId);
            if (!eligibility.Allowed)
                return BlockedResponse<object>(null, eligibility);
        }

        var emi = LoanMS.Application.Services.EmiCalculator.ReducingBalance(dto.Amount, dto.LoanRate, dto.Tenure);
        return Ok(ApiResponseDto<object>.Ok(new {
            valid        = true,
            emi          = emi,
            totalPayable = Math.Round(emi * dto.Tenure, 2),
            totalInterest= Math.Round(emi * dto.Tenure - dto.Amount, 2)
        }));
    }
}
