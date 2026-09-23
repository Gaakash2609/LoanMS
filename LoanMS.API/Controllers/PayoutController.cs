using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
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

    // Phase 2 RBAC — G-13 payout over-exposure fix. The ONLY roles allowed to
    // read every payout/commission claim in the system. Payout is finance data;
    // per the confirmed business rules Accounts has full Payout access and
    // Admin runs and configures payouts. Manager is deliberately NOT in this
    // set: in the Payout section Manager has exactly Sales-level rights
    // (own claims only, server-computed amount, no status changes, no rules).
    // Previously GetAll returned the
    // full claim list to ANY authenticated role that merely wasn't in
    // _selfOnlyRoles above — so LoginTeam / TeamLeader / LocationHead /
    // OperationManager / ProductTeam could list everyone's commissions. Now
    // every role outside this allow-list is scoped to its OWN claims only, so
    // no user receives all payout records just because they authenticated.
    private static readonly HashSet<string> _payoutAllAccessRoles =
        new(StringComparer.OrdinalIgnoreCase) { "Admin", "Accounts" };

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] string? status, [FromQuery] bool myOnly = false)
    {
        var q = _db.PayoutClaims
            .Include(p => p.Loan).ThenInclude(l => l.Customer)
            .Include(p => p.ClaimedBy)
            .Include(p => p.ProcessedBy)
            .AsQueryable();

        if (!string.IsNullOrEmpty(status)) q = q.Where(p => p.Status == status);

        // G-13 fix: only finance roles (Admin/Accounts) may see every
        // claim. Every other role — Manager/Sales/Dsa/Partner AND the internal
        // processing roles that used to fall through to "see all" — is scoped
        // to their own claims. `myOnly` still forces self-scope for anyone.
        if (myOnly || !_payoutAllAccessRoles.Contains(CurrentUserRole))
        {
            // Self-scope by default. EXCEPTION — a DSA user acts as the group
            // owner for the Partners mapped under them, so their "My Claims"
            // includes those Partners' claims too (legacy getVisiblePayoutClaims,
            // efin-app.js:4244 — DSA sees own + every mapped Partner's claims).
            var visibleUserIds = new HashSet<int> { CurrentUserId };
            if (string.Equals(CurrentUserRole, "Dsa", StringComparison.OrdinalIgnoreCase))
            {
                var dsaRecord = await _db.Set<DsaPartner>().FirstOrDefaultAsync(d =>
                    d.LinkedUserId == CurrentUserId && d.PartnerType == PartnerType.Dsa && !d.IsDeleted);
                if (dsaRecord != null)
                {
                    var mappedPartnerUserIds = await _db.Set<DsaPartner>()
                        .Where(p => p.MappedDsaId == dsaRecord.Id && p.PartnerType == PartnerType.Partner
                                    && p.LinkedUserId != null && !p.IsDeleted)
                        .Select(p => p.LinkedUserId!.Value)
                        .ToListAsync();
                    foreach (var uid in mappedPartnerUserIds) visibleUserIds.Add(uid);
                }
            }
            q = q.Where(p => visibleUserIds.Contains(p.ClaimedByUserId));
        }

        var claims = await q.OrderByDescending(p => p.CreatedAt)
            .Select(p => new {
                p.Id, p.Status, p.ClaimAmount, p.Month, p.Notes, p.ClaimType,
                p.CreatedAt, p.VerifiedAt, p.PaidAt,
                p.PaymentMode, p.PaymentReference, p.PaymentDate, p.BankAccountLast4,
                // Legacy CLAIMS-modal detail fields (now persisted + returned).
                p.UserType, p.DsaMobile, p.Contests, p.BankName, p.ProductName,
                p.FirstName, p.LastName, p.LoanNumberRef, p.ApacRef, p.CompanyName,
                p.DisbursementAmount, p.DisbursementDate, p.City, p.BusinessCategory,
                p.ConfirmationRequired, p.SplitCase,
                p.BankerEmail, p.BankerName, p.BankerMobile,
                p.AsmEmail, p.AsmName, p.AsmMobile,
                LoanNumber   = p.Loan.LoanNumber,
                CustomerName = p.Loan.Customer.FullName,
                ClaimedBy    = p.ClaimedBy.FullName,
                ProcessedBy  = p.ProcessedBy != null ? p.ProcessedBy.FullName : null,
                // Disbursed/approved loan amount (the money actually lent) — lets
                // the payout page show a real "Total Disbursed" like legacy
                // renderMyPayout's Σ disbAmount. Same base the payout % is taken
                // of (CalculatePayoutAmountAsync). Rate/percentage still withheld.
                DisbursedAmount = p.Loan.ApprovedAmount ?? p.Loan.RequestedAmount
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
            canOverride = CurrentUserRole is "Admin",
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

        // Payout is a post-disbursement activity. Legacy created/allowed claims
        // ONLY for disbursed loans — autoCreatePayoutClaim early-returns unless
        // status is 'disbursed', and the manual quick-claim "unclaimed" list is
        // filtered to disbursed loans — and a claim is a percentage of the
        // disbursed amount. DisbursedAt is set only on the Disburse transition
        // and persists through Closed, so it is the robust "has been disbursed"
        // signal regardless of a later status change.
        if (loan.DisbursedAt == null)
            return BadRequest(ApiResponseDto<bool>.Fail("Payout can only be claimed once the loan is disbursed."));

        // Server-side amount calculation — ignore user-submitted amount entirely
        var (serverAmount, rule, _) = await CalculatePayoutAmountAsync(loan);
        if (rule == null && CurrentUserRole is not "Admin")
            return BadRequest(ApiResponseDto<bool>.Fail("No payout rule configured for this loan type."));
        if (rule == null) serverAmount = dto.ClaimAmount; // Admin-only fallback when no rule exists

        // Only Admin may adjust within rule bounds (Manager = Sales-level: no override)
        if (CurrentUserRole is "Admin" && dto.ClaimAmount > 0 && rule != null)
        {
            var minOk = !rule.MinPayout.HasValue || dto.ClaimAmount >= rule.MinPayout.Value;
            var maxOk = !rule.MaxPayout.HasValue || dto.ClaimAmount <= rule.MaxPayout.Value;
            if (minOk && maxOk) serverAmount = dto.ClaimAmount;
        }

        // ClaimType is the capacity in which the caller is claiming (Sales/Dsa/
        // Partner/Login). It is derived from the caller's own authenticated role
        // by default; only Admin may pass an explicit type, and only when
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
        if (CurrentUserRole is "Admin" &&
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
            CreatedAt       = DateTime.UtcNow,
            // Legacy CLAIMS-modal detail fields — persisted verbatim (trimmed).
            UserType             = dto.UserType,
            DsaMobile            = dto.DsaMobile,
            Contests             = dto.Contests,
            BankName             = dto.BankName,
            ProductName          = dto.ProductName,
            FirstName            = dto.FirstName,
            LastName             = dto.LastName,
            LoanNumberRef        = dto.LoanNumberRef,
            ApacRef              = dto.ApacRef,
            CompanyName          = dto.CompanyName,
            DisbursementAmount   = dto.DisbursementAmount,
            DisbursementDate     = dto.DisbursementDate,
            City                 = dto.City,
            BusinessCategory     = dto.BusinessCategory,
            ConfirmationRequired = dto.ConfirmationRequired,
            SplitCase            = dto.SplitCase,
            BankerEmail          = dto.BankerEmail,
            BankerName           = dto.BankerName,
            BankerMobile         = dto.BankerMobile,
            AsmEmail             = dto.AsmEmail,
            AsmName              = dto.AsmName,
            AsmMobile            = dto.AsmMobile
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
    /// Verify/Pay/Reject/Hold a payout claim. Admin and Accounts only —
    /// Manager has Sales-level rights in Payout and cannot change status.
    /// Per the business owner, Accounts gets
    /// every right within the Payout section except Delete (see the
    /// Delete() action below, which is [Authorize(Roles = "Admin")] only —
    /// Accounts is deliberately excluded from it). Short of that one action,
    /// Accounts gets full Payout access: view all claims — Accounts is
    /// included in the class-level _payoutAllAccessRoles set above — submit
    /// claims, and change claim status.
    /// </summary>
    [HttpPatch("{id:int}/status")]
    [Authorize(Roles = "Admin,Accounts")]
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

        // G-22 — structured before/after audit for this financial mutation.
        var oldStatus = claim.Status;

        claim.Status            = dto.Status;
        claim.UpdatedAt         = DateTime.UtcNow;
        claim.ProcessedByUserId = CurrentUserId;
        if (dto.Notes != null) claim.Notes = dto.Notes;

        if (dto.Status == "Verified") claim.VerifiedAt = DateTime.UtcNow;
        else if (dto.Status == "Paid") claim.PaidAt    = DateTime.UtcNow;

        // Payment details — only assigned when actually supplied, same
        // null-guarded pattern as Notes above, so a Verified/Rejected
        // transition can never blank out a previously-recorded payment.
        if (dto.PaymentMode      != null) claim.PaymentMode      = dto.PaymentMode;
        if (dto.PaymentReference != null) claim.PaymentReference = dto.PaymentReference;
        if (dto.PaymentDate.HasValue)     claim.PaymentDate      = dto.PaymentDate.Value;
        if (dto.BankAccountLast4 != null) claim.BankAccountLast4 = dto.BankAccountLast4;

        AuditHelper.LogChange(_db, HttpContext, "PayoutClaim", id.ToString(), "PayoutStatusChanged",
            oldValues: oldStatus, newValues: dto.Status, reason: dto.Notes,
            userId: CurrentUserId, userName: CurrentUserEmail);

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

        // Base is the approved/disbursed amount — the money actually lent — not
        // the (possibly higher) requested amount. This matches the PayoutRule
        // contract ("% of approved/disbursed amount") and legacy
        // autoCreatePayoutClaim, which computed the claim on the disbursed
        // amount (efin-app.js). Falls back to RequestedAmount only before an
        // approval figure exists (defensive; claims are for disbursed loans).
        var baseAmount = loan.ApprovedAmount ?? loan.RequestedAmount;
        var amount = Math.Round(baseAmount * rule.Percentage / 100, 2);
        if (rule.MinPayout.HasValue) amount = Math.Max(amount, rule.MinPayout.Value);
        if (rule.MaxPayout.HasValue) amount = Math.Min(amount, rule.MaxPayout.Value);
        return (amount, rule, true);
    }
}

public class ClaimCreateDto {
    public int     LoanId      { get; set; }
    public decimal ClaimAmount { get; set; }  // Used only by Admin within rule bounds
    public string? Month       { get; set; }  // legacy cl-claim-month
    public string? Notes       { get; set; }  // legacy cl-vendor-remark
    /// <summary>Optional. Only honored for Admin callers reconciling on
    /// another eligible claimant's behalf; otherwise derived server-side from
    /// the caller's own role. See PayoutController.Submit.</summary>
    public string? ClaimType   { get; set; }

    // ── Legacy CLAIMS-modal detail fields (index.html cl-*), now persisted ──
    public string?   UserType             { get; set; }
    public string?   DsaMobile            { get; set; }
    public string?   Contests             { get; set; }
    public string?   BankName             { get; set; }
    public string?   ProductName          { get; set; }
    public string?   FirstName            { get; set; }
    public string?   LastName             { get; set; }
    public string?   LoanNumberRef        { get; set; }
    public string?   ApacRef              { get; set; }
    public string?   CompanyName          { get; set; }
    public decimal?  DisbursementAmount   { get; set; }
    public DateTime? DisbursementDate     { get; set; }
    public string?   City                 { get; set; }
    public string?   BusinessCategory     { get; set; }
    public bool      ConfirmationRequired { get; set; }
    public bool      SplitCase            { get; set; }
    public string?   BankerEmail          { get; set; }
    public string?   BankerName           { get; set; }
    public string?   BankerMobile         { get; set; }
    public string?   AsmEmail             { get; set; }
    public string?   AsmName              { get; set; }
    public string?   AsmMobile            { get; set; }
}

public class ClaimStatusDto {
    public string Status { get; set; } = string.Empty;
    public string? Notes { get; set; }

    // Payment details — only meaningful when Status == "Paid". Optional so
    // a plain Verified/Rejected/OnHold transition sends nothing extra.
    public string? PaymentMode { get; set; }
    public string? PaymentReference { get; set; }
    public DateTime? PaymentDate { get; set; }
    public string? BankAccountLast4 { get; set; }
}
