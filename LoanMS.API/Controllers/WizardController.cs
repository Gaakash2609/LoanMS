using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

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

    private static readonly Dictionary<string, LoanType> _loanTypeMap = new(StringComparer.OrdinalIgnoreCase)
    {
        ["personal_loan"]  = LoanType.Personal,
        ["business_loan"]  = LoanType.Business,
        ["home_loan"]      = LoanType.Home,
        ["new_car_loan"]   = LoanType.Car,
        ["used_car_loan"]  = LoanType.Car,
        ["education_loan"] = LoanType.Education,
        ["insurance"]      = LoanType.Personal,
    };

    private static decimal CalcEmi(decimal principal, decimal ratePercent, int months)
    {
        if (ratePercent == 0) return Math.Round(principal / months, 2);
        var r   = ratePercent / 12 / 100;
        var pow = (decimal)Math.Pow((double)(1 + r), months);
        return Math.Round(principal * r * pow / (pow - 1), 2);
    }

    /// <summary>Submit full loan application from wizard.</summary>
    [HttpPost("submit")]
    public async Task<IActionResult> Submit([FromBody] WizardSubmitDto dto)
    {
        if (dto.Amount <= 0)
            return BadRequest(ApiResponseDto<WizardSubmitResponseDto>.Fail("Loan amount must be greater than 0."));
        if (string.IsNullOrWhiteSpace(dto.FullName))
            return BadRequest(ApiResponseDto<WizardSubmitResponseDto>.Fail("Applicant name is required."));
        if (string.IsNullOrWhiteSpace(dto.Mobile))
            return BadRequest(ApiResponseDto<WizardSubmitResponseDto>.Fail("Mobile number is required."));

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
                    return NotFound(ApiResponseDto<WizardSubmitResponseDto>.Fail("Draft application not found."));

                if (existingLoan.Status != LoanStatus.Draft)
                    return BadRequest(ApiResponseDto<WizardSubmitResponseDto>.Fail(
                        "This application has already been submitted."));
            }

            // ── 1. Find or create customer ────────────────────────────────────
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
                    FullName       = dto.FullName.Trim(),
                    Email          = string.IsNullOrWhiteSpace(dto.Email)
                                     ? $"{dto.Mobile.Trim()}@efin.auto"
                                     : dto.Email.ToLower().Trim(),
                    Phone          = dto.Mobile.Trim(),
                    PanNumber      = dto.Pan?.ToUpper().Trim(),
                    AadhaarNumber  = dto.Aadhar?.Trim(),
                    DateOfBirth    = string.IsNullOrWhiteSpace(dto.Dob) ? null : DateTime.TryParse(dto.Dob, out var dob) ? dob : null,
                    Address        = dto.Street1,
                    City           = dto.City,
                    State          = dto.State,
                    PinCode        = dto.Zip,
                    MonthlyIncome  = dto.Salary > 0 ? dto.Salary : null,
                    EmploymentType = dto.EmpType == "SALARIED" ? "Salaried"
                                   : dto.EmpType == "SELFEMP" ? "Self-Employed"
                                   : dto.EmpType == "PROFESSIONAL" ? "Professional" : dto.EmpType,
                    CompanyName    = dto.CompName,
                    CibilScore     = dto.Cibil > 0 ? dto.Cibil : null,
                    CreatedAt      = DateTime.UtcNow
                };
                _db.Customers.Add(customer);
                await _db.SaveChangesAsync();
            }
            else
            {
                if (!string.IsNullOrWhiteSpace(dto.City))   customer.City   = dto.City;
                if (!string.IsNullOrWhiteSpace(dto.State))  customer.State  = dto.State;
                if (dto.Salary > 0)  customer.MonthlyIncome = dto.Salary;
                if (dto.Cibil > 0)   customer.CibilScore    = dto.Cibil;
                if (!string.IsNullOrWhiteSpace(dto.CompName)) customer.CompanyName = dto.CompName;
                customer.UpdatedAt = DateTime.UtcNow;
                await _db.SaveChangesAsync();
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
                    CreatedByUserId = CurrentUserId,
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
            // Skip if a payout claim already exists for this loan (e.g. resuming a
            // draft that — under the old bug — had already produced one), so a
            // completed draft never ends up with duplicate payout claims either.
            var payoutAlreadyClaimed = existingLoan != null &&
                await _db.Set<PayoutClaim>().AnyAsync(p => p.LoanId == loan.Id);

            if (!payoutAlreadyClaimed)
            {
                var payoutRule = await _db.Set<PayoutRule>()
                    .FirstOrDefaultAsync(r => r.LoanType == dto.LoanType && r.IsActive && !r.IsDeleted);
                if (payoutRule != null)
                {
                    var claimAmt = Math.Round(dto.Amount * payoutRule.Percentage / 100, 2);
                    if (payoutRule.MinPayout.HasValue) claimAmt = Math.Max(claimAmt, payoutRule.MinPayout.Value);
                    if (payoutRule.MaxPayout.HasValue) claimAmt = Math.Min(claimAmt, payoutRule.MaxPayout.Value);
                    _db.Set<PayoutClaim>().Add(new PayoutClaim
                    {
                        LoanId = loan.Id, ClaimAmount = claimAmt,
                        Month  = DateTime.UtcNow.ToString("MMM yyyy"),
                        Notes  = $"Auto-generated from configured payout rule",   // no formula/rate disclosed
                        Status = "Pending", ClaimedByUserId = CurrentUserId, CreatedAt = DateTime.UtcNow
                    });
                }
            }

            await _db.SaveChangesAsync();
            await tx.CommitAsync();

            // Return only the opaque loan number — no internal DB IDs for external callers.
            // Internal roles (Admin/Manager) additionally receive LoanId for navigation.
            var isInternal = CurrentUserRole is "Admin" or "Manager";
            return Ok(ApiResponseDto<WizardSubmitResponseDto>.Ok(new WizardSubmitResponseDto
            {
                EfinId     = dto.EfinId ?? loanNum,
                LoanId     = isInternal ? loan.Id : 0,       // 0 = not disclosed
                CustomerId = isInternal ? customer.Id : 0,   // 0 = not disclosed
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
    }

    /// <summary>Validate wizard data before final submit.</summary>
    [HttpPost("validate")]
    public async Task<IActionResult> Validate([FromBody] WizardSubmitDto dto)
    {
        var errors = new List<string>();

        if (string.IsNullOrWhiteSpace(dto.FullName)) errors.Add("Full name is required.");
        if (string.IsNullOrWhiteSpace(dto.Mobile) || dto.Mobile.Length < 10) errors.Add("Valid mobile number is required.");
        if (dto.Amount <= 0) errors.Add("Loan amount must be greater than 0.");
        if (dto.Tenure <= 0 || dto.Tenure > 360) errors.Add("Tenure must be between 1-360 months.");
        if (dto.LoanRate <= 0) errors.Add("Interest rate must be greater than 0.");

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
