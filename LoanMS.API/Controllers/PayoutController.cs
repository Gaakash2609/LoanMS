using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

[Authorize]
public class PayoutController : BaseController
{
    private readonly AppDbContext _db;
    public PayoutController(AppDbContext db) => _db = db;

    // Roles whose payout view is automatically scoped to their own claims only.
    // Phase 3B fix: was ["Sales", "partner", "dsa_user"] — those two never matched
    // the actual role claim value (User.Role.ToString() == "Dsa" / "Partner"), so
    // Dsa/Partner users were silently NOT scoped to their own claims unless the
    // caller happened to pass myOnly=true. Comparer is already OrdinalIgnoreCase.
    private static readonly HashSet<string> _selfOnlyRoles =
        new(StringComparer.OrdinalIgnoreCase) { "Sales", "Dsa", "Partner" };

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] string? status, [FromQuery] bool myOnly = false)
    {
        var q = _db.PayoutClaims
            .Include(p => p.Loan).ThenInclude(l => l.Customer)
            .Include(p => p.ClaimedBy)
            .Include(p => p.ProcessedBy)
            .AsQueryable();

        if (!string.IsNullOrEmpty(status)) q = q.Where(p => p.Status == status);

        // Partner / DSA / Sales always see only their own — backend-enforced
        if (myOnly || _selfOnlyRoles.Contains(CurrentUserRole))
            q = q.Where(p => p.ClaimedByUserId == CurrentUserId);

        var claims = await q.OrderByDescending(p => p.CreatedAt)
            .Select(p => new {
                p.Id, p.Status, p.ClaimAmount, p.Month, p.Notes, p.ClaimType,
                p.CreatedAt, p.VerifiedAt, p.PaidAt,
                LoanNumber   = p.Loan.LoanNumber,
                CustomerName = p.Loan.Customer.FullName,
                ClaimedBy    = p.ClaimedBy.FullName,
                ProcessedBy  = p.ProcessedBy != null ? p.ProcessedBy.FullName : null
                // Rate/percentage deliberately not returned
            }).ToListAsync();

        return Ok(ApiResponseDto<object>.Ok(claims));
    }

    /// <summary>
    /// 🔴 CRITICAL — Auto Payout Suggestion (preview). Read-only: computes and
    /// returns the SAME server-side amount Submit() would compute — reuses
    /// CalculatePayoutAmountAsync so there is exactly one calculation, not a
    /// duplicated one for "preview" vs "actual submit". No claim is created.
    /// </summary>
    [HttpGet("suggest/{loanId:int}")]
    public async Task<IActionResult> Suggest(int loanId)
    {
        var loan = await _db.Loans.FindAsync(loanId);
        if (loan == null) return NotFound(ApiResponseDto<object>.Fail("Loan not found."));

        var (amount, rule, ruleConfigured) = await CalculatePayoutAmountAsync(loan);
        return Ok(ApiResponseDto<object>.Ok(new
        {
            loanId = loan.Id,
            suggestedAmount = amount,
            ruleConfigured,
            // Rate/percentage deliberately not returned — same non-disclosure
            // convention already used in GetAll() above.
            canOverride = CurrentUserRole is "Admin" or "Manager",
            minPayout = rule?.MinPayout,
            maxPayout = rule?.MaxPayout
        }));
    }

    /// <summary>
    /// Submit a payout claim.
    /// The claim amount is calculated server-side from the configured PayoutRule
    /// and must fall within the allowed band — it is NOT taken from the request body.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> Submit([FromBody] ClaimCreateDto dto)
    {
        var loan = await _db.Loans.FindAsync(dto.LoanId);
        if (loan == null) return BadRequest(ApiResponseDto<bool>.Fail("Loan not found."));

        // Server-side amount calculation — ignore user-submitted amount entirely
        var (serverAmount, rule, _) = await CalculatePayoutAmountAsync(loan);
        if (rule == null && CurrentUserRole is not ("Admin" or "Manager"))
            return BadRequest(ApiResponseDto<bool>.Fail("No payout rule configured for this loan type."));
        if (rule == null) serverAmount = dto.ClaimAmount; // Admin/Manager fallback when no rule exists — unchanged from before

        // Admin/Manager may adjust within rule bounds
        if (CurrentUserRole is "Admin" or "Manager" && dto.ClaimAmount > 0 && rule != null)
        {
            var minOk = !rule.MinPayout.HasValue || dto.ClaimAmount >= rule.MinPayout.Value;
            var maxOk = !rule.MaxPayout.HasValue || dto.ClaimAmount <= rule.MaxPayout.Value;
            if (minOk && maxOk) serverAmount = dto.ClaimAmount;
        }

        // ClaimType is the capacity in which the caller is claiming (Sales/Dsa/
        // Partner/Login). It is derived from the caller's own authenticated role
        // by default; Admin/Manager may pass an explicit type only when
        // reconciling on another eligible claimant's behalf via a whitelisted
        // value. It is never trusted blindly from an arbitrary client value.
        var allowedClaimTypes = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            { "Sales", "Dsa", "Partner", "Login", "Manager", "Admin" };
        string claimType = CurrentUserRole switch
        {
            "Dsa"     => "Dsa",
            "Partner" => "Partner",
            _         => "Sales"
        };
        if (CurrentUserRole is "Admin" or "Manager" &&
            !string.IsNullOrWhiteSpace(dto.ClaimType) && allowedClaimTypes.Contains(dto.ClaimType))
        {
            claimType = dto.ClaimType;
        }

        // Idempotency / duplicate-claim guard: one claim per (loan, claimant,
        // capacity). Checked here for a friendly error, and backed by a unique
        // DB index for the race-condition case.
        var duplicate = await _db.PayoutClaims.AnyAsync(p =>
            p.LoanId == dto.LoanId && p.ClaimedByUserId == CurrentUserId && p.ClaimType == claimType);
        if (duplicate)
            return BadRequest(ApiResponseDto<bool>.Fail("A claim already exists for this loan in this capacity."));

        var claim = new PayoutClaim {
            LoanId          = dto.LoanId,
            ClaimAmount     = serverAmount,
            Month           = dto.Month ?? DateTime.UtcNow.ToString("MMM yyyy"),
            Notes           = dto.Notes,
            ClaimedByUserId = CurrentUserId,
            ClaimType       = claimType,
            CreatedAt       = DateTime.UtcNow
        };
        _db.PayoutClaims.Add(claim);
        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            // Unique-index race: another request created the same
            // (loan, claimant, type) claim between our check and this save.
            return BadRequest(ApiResponseDto<bool>.Fail("A claim already exists for this loan in this capacity."));
        }
        return Ok(ApiResponseDto<object>.Ok(new { claim.Id, claimAmount = serverAmount, claimType }, "Claim submitted."));
    }

    /// <summary>
    /// Verify/Pay/Reject/Hold a payout claim. Accounts is included here (in
    /// addition to Admin/Manager) — per the business owner, Accounts gets
    /// every right within the Payout section except Delete (and there is no
    /// Delete endpoint on this controller at all, so Accounts effectively
    /// gets full Payout access: view all claims — see the class-level
    /// _selfOnlyRoles set above, which deliberately does NOT include
    /// Accounts — submit claims, and change claim status).
    /// </summary>
    [HttpPatch("{id:int}/status")]
    [Authorize(Roles = "Admin,Manager,Accounts")]
    public async Task<IActionResult> UpdateStatus(int id, [FromBody] ClaimStatusDto dto)
    {
        var claim = await _db.PayoutClaims.FindAsync(id);
        if (claim == null) return NotFound(ApiResponseDto<bool>.Fail("Not found."));

        // Whitelist allowed status transitions — reject any arbitrary value
        var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            { "Pending", "Verified", "Paid", "Rejected", "OnHold" };
        if (!allowed.Contains(dto.Status))
            return BadRequest(ApiResponseDto<bool>.Fail(
                $"Invalid status '{dto.Status}'. Allowed values: {string.Join(", ", allowed)}."));

        claim.Status            = dto.Status;
        claim.UpdatedAt         = DateTime.UtcNow;
        claim.ProcessedByUserId = CurrentUserId;

        if (dto.Status == "Verified") claim.VerifiedAt = DateTime.UtcNow;
        else if (dto.Status == "Paid") claim.PaidAt    = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, $"Claim marked as {dto.Status}."));
    }

    [HttpGet("my-earnings")]
    public async Task<IActionResult> MyEarnings()
    {
        var claims = await _db.PayoutClaims
            .Where(p => p.ClaimedByUserId == CurrentUserId)
            .GroupBy(p => p.Status)
            .Select(g => new { Status = g.Key, Total = g.Sum(p => p.ClaimAmount), Count = g.Count() })
            .ToListAsync();
        return Ok(ApiResponseDto<object>.Ok(claims));
    }

    /// <summary>
    /// Delete a payout claim — Admin only. Soft-delete (same IsDeleted +
    /// HasQueryFilter(!IsDeleted) pattern already used everywhere else in
    /// this project — see AppDbContext's PayoutClaim configuration): the
    /// row is flagged, not physically removed, so it's recoverable/
    /// auditable, but it disappears from GetAll/MyEarnings/every other read
    /// immediately since the query filter excludes it automatically. This
    /// IS a real server-side delete from every user-facing point of view —
    /// the claim will not reappear on refresh, another device, or another
    /// user's session, which is what "delete se live server se bhi data
    /// delete ho" requires.
    /// </summary>
    [HttpDelete("{id:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Delete(int id)
    {
        var claim = await _db.PayoutClaims.FirstOrDefaultAsync(p => p.Id == id);
        if (claim == null) return NotFound(ApiResponseDto<bool>.Fail("Claim not found."));

        claim.IsDeleted = true;
        claim.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Claim deleted."));
    }

    /// <summary>
    /// Single source of truth for "what should this loan's payout claim
    /// amount be" — used by both Submit() (authoritative) and Suggest()
    /// (read-only preview), so the two can never drift apart. Decimal
    /// rounding: Math.Round to 2 places, matching the currency's natural
    /// precision — unchanged from the original inline logic this was
    /// extracted from.
    /// </summary>
    private async Task<(decimal Amount, PayoutRule? Rule, bool RuleConfigured)> CalculatePayoutAmountAsync(Loan loan)
    {
        // Convert the LoanType enum to the payout rule key format (e.g. Personal → personal_loan)
        var loanTypeKey = loan.LoanType.ToString().ToLowerInvariant() switch
        {
            "personal"  => "personal_loan",
            "business"  => "business_loan",
            "home"      => "home_loan",
            "car"       => "new_car_loan",
            "education" => "education_loan",
            _           => loan.LoanType.ToString().ToLowerInvariant()
        };

        var rule = await _db.Set<PayoutRule>()
            .FirstOrDefaultAsync(r => r.LoanType == loanTypeKey && r.IsActive && !r.IsDeleted);

        if (rule == null) return (0, null, false);

        var amount = Math.Round(loan.RequestedAmount * rule.Percentage / 100, 2);
        if (rule.MinPayout.HasValue) amount = Math.Max(amount, rule.MinPayout.Value);
        if (rule.MaxPayout.HasValue) amount = Math.Min(amount, rule.MaxPayout.Value);
        return (amount, rule, true);
    }
}

public class ClaimCreateDto {
    public int     LoanId      { get; set; }
    public decimal ClaimAmount { get; set; }  // Used only by Admin/Manager within rule bounds
    public string? Month       { get; set; }
    public string? Notes       { get; set; }
    /// <summary>Optional. Only honored for Admin/Manager callers reconciling on
    /// another eligible claimant's behalf; otherwise derived server-side from
    /// the caller's own role. See PayoutController.Submit.</summary>
    public string? ClaimType   { get; set; }
}

public class ClaimStatusDto {
    public string Status { get; set; } = string.Empty;
}
