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

    // Roles whose payout view is automatically scoped to their own claims only
    private static readonly HashSet<string> _selfOnlyRoles =
        new(StringComparer.OrdinalIgnoreCase) { "Sales", "partner", "dsa_user" };

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
                p.Id, p.Status, p.ClaimAmount, p.Month, p.Notes,
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
    /// Submit a payout claim.
    /// The claim amount is calculated server-side from the configured PayoutRule
    /// and must fall within the allowed band — it is NOT taken from the request body.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> Submit([FromBody] ClaimCreateDto dto)
    {
        var loan = await _db.Loans.FindAsync(dto.LoanId);
        if (loan == null) return BadRequest(ApiResponseDto<bool>.Fail("Loan not found."));

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

        // Server-side amount calculation — ignore user-submitted amount entirely
        var rule = await _db.Set<PayoutRule>()
            .FirstOrDefaultAsync(r => r.LoanType == loanTypeKey && r.IsActive && !r.IsDeleted);

        decimal serverAmount;
        if (rule != null)
        {
            serverAmount = Math.Round(loan.RequestedAmount * rule.Percentage / 100, 2);
            if (rule.MinPayout.HasValue) serverAmount = Math.Max(serverAmount, rule.MinPayout.Value);
            if (rule.MaxPayout.HasValue) serverAmount = Math.Min(serverAmount, rule.MaxPayout.Value);
        }
        else
        {
            // No rule configured — allow claim only if Admin/Manager
            if (CurrentUserRole is not ("Admin" or "Manager"))
                return BadRequest(ApiResponseDto<bool>.Fail("No payout rule configured for this loan type."));
            serverAmount = dto.ClaimAmount;
        }

        // Admin/Manager may adjust within rule bounds
        if (CurrentUserRole is "Admin" or "Manager" && dto.ClaimAmount > 0 && rule != null)
        {
            var minOk = !rule.MinPayout.HasValue || dto.ClaimAmount >= rule.MinPayout.Value;
            var maxOk = !rule.MaxPayout.HasValue || dto.ClaimAmount <= rule.MaxPayout.Value;
            if (minOk && maxOk) serverAmount = dto.ClaimAmount;
        }

        var claim = new PayoutClaim {
            LoanId          = dto.LoanId,
            ClaimAmount     = serverAmount,
            Month           = dto.Month ?? DateTime.UtcNow.ToString("MMM yyyy"),
            Notes           = dto.Notes,
            ClaimedByUserId = CurrentUserId,
            CreatedAt       = DateTime.UtcNow
        };
        _db.PayoutClaims.Add(claim);
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<object>.Ok(new { claim.Id, claimAmount = serverAmount }, "Claim submitted."));
    }

    [HttpPatch("{id:int}/status")]
    [Authorize(Roles = "Admin,Manager")]
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
}

public class ClaimCreateDto {
    public int     LoanId      { get; set; }
    public decimal ClaimAmount { get; set; }  // Used only by Admin/Manager within rule bounds
    public string? Month       { get; set; }
    public string? Notes       { get; set; }
}

public class ClaimStatusDto {
    public string Status { get; set; } = string.Empty;
}
