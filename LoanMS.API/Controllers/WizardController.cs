using LoanMS.Application.DTOs;
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

    public WizardController(AppDbContext db, ILogger<WizardController> logger)
    {
        _db     = db;
        _logger = logger;
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
        ["insurance"]             = LoanType.Personal,
    };

    private static decimal CalcEmi(decimal principal, decimal ratePercent, int months)
    {
        if (ratePercent == 0) return Math.Round(principal / months, 2);
        var r   = ratePercent / 12 / 100;
        var pow = (decimal)Math.Pow((double)(1 + r), months);
        return Math.Round(principal * r * pow / (pow - 1), 2);
    }

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
    }

    /// <summary>
    /// Find the customer this application belongs to (by existing loan, PAN, then
    /// mobile) or create a new one. Shared by Submit and SaveDraft so both follow
    /// the exact same matching rules instead of drifting apart.
    /// </summary>
    private async Task<Customer> FindOrCreateCustomerAsync(WizardSubmitDto dto, Loan? existingLoan)
    {
        Customer? customer = null;

        if (existingLoan != null)
            customer = await _db.Customers.FirstOrDefaultAsync(c => c.Id == existingLoan.CustomerId);

        if (customer == null && !string.IsNullOrWhiteSpace(dto.Pan))
            customer = await _db.Customers.FirstOrDefaultAsync(c =>
                c.PanNumber == dto.Pan.ToUpper().Trim() && !c.IsDeleted);

        if (customer == null && !string.IsNullOrWhiteSpace(dto.Mobile))
            customer = await _db.Customers.FirstOrDefaultAsync(c =>
                c.Phone == dto.Mobile.Trim() && !c.IsDeleted);

        if (customer == null)
        {
            customer = new Customer
            {
                FullName       = (dto.FullName ?? string.Empty).Trim(),
                Email          = string.IsNullOrWhiteSpace(dto.Email)
                                 ? $"{(dto.Mobile ?? "draft").Trim()}@efin.auto"
                                 : dto.Email.ToLower().Trim(),
                Phone          = (dto.Mobile ?? string.Empty).Trim(),
                PanNumber      = dto.Pan?.ToUpper().Trim(),
                AadhaarNumber  = dto.Aadhar?.Trim(),
                DateOfBirth    = string.IsNullOrWhiteSpace(dto.Dob) ? null : DateTime.TryParse(dto.Dob, out var dob) ? dob : null,
                Address        = dto.Street1,
                City           = dto.City,
                State          = dto.State,
                PinCode        = dto.Zip,
                MonthlyIncome  = dto.Salary > 0 ? dto.Salary : null,
                MonthlyObligations = dto.Obligations > 0 ? dto.Obligations : null,
                EmploymentType = dto.EmpType == "SALARIED" ? "Salaried"
                               : dto.EmpType == "SELFEMP" ? "Self-Employed"
                               : dto.EmpType == "PROFESSIONAL" ? "Professional" : dto.EmpType,
                CompanyName    = dto.CompName,
                CibilScore     = dto.Cibil > 0 ? dto.Cibil : null,
                Gender         = dto.Gender?.Trim(),
                FatherName     = dto.FatherName?.Trim(),
                ResidenceType  = dto.HomeType,
                CreatedAt      = DateTime.UtcNow
            };
            _db.Customers.Add(customer);
        }
        else
        {
            if (!string.IsNullOrWhiteSpace(dto.FullName)) customer.FullName = dto.FullName.Trim();
            if (!string.IsNullOrWhiteSpace(dto.City))   customer.City   = dto.City;
            if (!string.IsNullOrWhiteSpace(dto.State))  customer.State  = dto.State;
            if (dto.Salary > 0)  customer.MonthlyIncome = dto.Salary;
            if (dto.Obligations > 0) customer.MonthlyObligations = dto.Obligations;
            if (dto.Cibil > 0)   customer.CibilScore    = dto.Cibil;
            if (!string.IsNullOrWhiteSpace(dto.CompName)) customer.CompanyName = dto.CompName;
            if (!string.IsNullOrWhiteSpace(dto.Gender))     customer.Gender        = dto.Gender.Trim();
            if (!string.IsNullOrWhiteSpace(dto.FatherName)) customer.FatherName    = dto.FatherName.Trim();
            if (!string.IsNullOrWhiteSpace(dto.HomeType))   customer.ResidenceType = dto.HomeType;
            customer.UpdatedAt = DateTime.UtcNow;
        }

        return customer;
    }

    /// <summary>Submit full loan application from wizard.</summary>
    [HttpPost("submit")]
    public async Task<IActionResult> Submit([FromBody] WizardSubmitDto dto)
    {
        var errors = ValidateFieldFormats(dto);
        if (dto.Amount <= 0)
            errors.Add("Loan amount must be greater than 0.");
        if (string.IsNullOrWhiteSpace(dto.FullName))
            errors.Add("Applicant name is required.");
        if (string.IsNullOrWhiteSpace(dto.Mobile))
            errors.Add("Mobile number is required.");
        errors.AddRange(await ValidateMappingAsync(dto));
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
            }

            // ── 1. Find or create customer ────────────────────────────────────
            var customer = await FindOrCreateCustomerAsync(dto, existingLoan);
            await _db.SaveChangesAsync();

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
            var emi      = CalcEmi(dto.Amount, dto.LoanRate > 0 ? dto.LoanRate : 12, dto.Tenure > 0 ? dto.Tenure : 24);

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
                loan.Status          = LoanStatus.Submitted;
                loan.UpdatedAt       = DateTime.UtcNow;
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
                    CustomerId      = customer.Id,
                    // CreatedByUserId always comes from the authenticated JWT identity —
                    // never from the request body — so the request cannot spoof authorship.
                    CreatedByUserId = CurrentUserId,
                    DsaId           = dto.DsaId,
                    PartnerId       = dto.PartnerId,
                    LocationId      = dto.LocationId,
                    CreatedAt       = DateTime.UtcNow
                };
                _db.Loans.Add(loan);
            }
            await _db.SaveChangesAsync();

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

            // ── 5. References ─────────────────────────────────────────────────
            // Resuming a draft replaces any references captured earlier so the
            // final submission never ends up with duplicate reference rows.
            if (existingLoan != null)
            {
                var oldRefs = _db.Set<LoanReference>().Where(r => r.LoanId == loan.Id);
                _db.Set<LoanReference>().RemoveRange(oldRefs);
            }
            if (!string.IsNullOrWhiteSpace(dto.R1Name) && !string.IsNullOrWhiteSpace(dto.R1Mobile))
            {
                _db.Set<LoanReference>().Add(new LoanReference
                {
                    LoanId = loan.Id, RefNumber = 1,
                    Name = dto.R1Name, Mobile = dto.R1Mobile,
                    Relation = dto.R1Relation ?? "Other", CreatedAt = DateTime.UtcNow
                });
            }
            if (!string.IsNullOrWhiteSpace(dto.R2Name) && !string.IsNullOrWhiteSpace(dto.R2Mobile))
            {
                _db.Set<LoanReference>().Add(new LoanReference
                {
                    LoanId = loan.Id, RefNumber = 2,
                    Name = dto.R2Name, Mobile = dto.R2Mobile,
                    Relation = dto.R2Relation ?? "Other", CreatedAt = DateTime.UtcNow
                });
            }

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
            EfinId      = loan.LoanNumber,
        };

        return Ok(ApiResponseDto<WizardSubmitDto>.Ok(dto));
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
            }

            var customer = await FindOrCreateCustomerAsync(dto, existingLoan);
            await _db.SaveChangesAsync();

            var loanType = _loanTypeMap.TryGetValue(dto.LoanType ?? "personal_loan", out var lt) ? lt : LoanType.Personal;

            Loan loan;
            if (existingLoan != null)
            {
                loan = existingLoan;
                loan.LoanType        = loanType;
                loan.RequestedAmount = dto.Amount;
                loan.InterestRate    = dto.LoanRate > 0 ? dto.LoanRate : 12;
                loan.TenureMonths    = dto.Tenure > 0 ? dto.Tenure : 24;
                loan.Purpose         = dto.Purpose;
                loan.UpdatedAt       = DateTime.UtcNow;
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
                    CustomerId      = customer.Id,
                    // CreatedByUserId always comes from the authenticated JWT identity —
                    // never from the request body — so the request cannot spoof authorship.
                    CreatedByUserId = CurrentUserId,
                    DsaId           = dto.DsaId,
                    PartnerId       = dto.PartnerId,
                    LocationId      = dto.LocationId,
                    CreatedAt       = DateTime.UtcNow
                };
                _db.Loans.Add(loan);
            }

            await _db.SaveChangesAsync();
            await tx.CommitAsync();

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
        catch (Exception ex)
        {
            await tx.RollbackAsync();
            _logger.LogError(ex, "Wizard draft save failed for user {UserId}", CurrentUserId);
            return StatusCode(500, ApiResponseDto<WizardSubmitResponseDto>.Fail("Could not save draft."));
        }
        });
    }

    /// <summary>Validate wizard data before final submit.</summary>
    [HttpPost("validate")]
    public async Task<IActionResult> Validate([FromBody] WizardSubmitDto dto)
    {
        var errors = ValidateFieldFormats(dto);

        if (string.IsNullOrWhiteSpace(dto.FullName)) errors.Add("Full name is required.");
        if (string.IsNullOrWhiteSpace(dto.Mobile)) errors.Add("Mobile number is required.");
        if (dto.Amount <= 0) errors.Add("Loan amount must be greater than 0.");
        if (dto.Tenure <= 0 || dto.Tenure > 360) errors.Add("Tenure must be between 1-360 months.");
        if (dto.LoanRate <= 0) errors.Add("Interest rate must be greater than 0.");

        errors.AddRange(await ValidateMappingAsync(dto));

        // PAN duplicate check — message is intentionally vague for external roles
        if (!string.IsNullOrWhiteSpace(dto.Pan) && dto.Pan.Length == 10)
        {
            var isInternal = CurrentUserRole is "Admin" or "Manager";
            var panExists  = await _db.Customers.AnyAsync(c =>
                c.PanNumber == dto.Pan.ToUpper().Trim() && !c.IsDeleted);

            if (panExists)
            {
                var existingCustomer = await _db.Customers.FirstAsync(c =>
                    c.PanNumber == dto.Pan.ToUpper().Trim() && !c.IsDeleted);
                var activeLoans = await _db.Loans.CountAsync(l =>
                    l.CustomerId == existingCustomer.Id &&
                    l.Id != (dto.LoanId ?? 0) &&   // exclude the draft being resumed/completed right now
                    l.Status != LoanStatus.Rejected &&
                    l.Status != LoanStatus.Closed && !l.IsDeleted);

                if (activeLoans > 0)
                {
                    // Admin/Manager: full detail. External roles: generic message.
                    errors.Add(isInternal
                        ? $"PAN {dto.Pan.ToUpper()} already has {activeLoans} active loan(s)."
                        : "This customer already has an active application. Please contact your manager.");
                }
            }
        }

        if (errors.Any())
            return BadRequest(ApiResponseDto<object>.Fail(errors));

        var emi = CalcEmi(dto.Amount, dto.LoanRate, dto.Tenure);
        return Ok(ApiResponseDto<object>.Ok(new {
            valid        = true,
            emi          = emi,
            totalPayable = Math.Round(emi * dto.Tenure, 2),
            totalInterest= Math.Round(emi * dto.Tenure - dto.Amount, 2)
        }));
    }
}
