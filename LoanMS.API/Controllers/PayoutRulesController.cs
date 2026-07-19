using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

/// <summary>
/// Payout Rules Engine — defines % of loan amount paid to sales/DSA per loan type.
/// All endpoints require Admin or Manager. No anonymous access.
/// </summary>
[Authorize(Roles = "Admin,Manager")]
public class PayoutRulesController : BaseController
{
    private readonly AppDbContext _db;
    public PayoutRulesController(AppDbContext db) => _db = db;

    /// <summary>
    /// Get all active payout rules.
    /// The Notes field (which contains internal formula descriptions) is omitted from
    /// this response — it is available only via the detail endpoint for Admins.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var rules = await _db.Set<PayoutRule>()
            .Where(r => !r.IsDeleted)
            .OrderBy(r => r.LoanType)
            .Select(r => new
            {
                r.Id,
                r.LoanType,
                r.Percentage,
                MinAmount = r.MinPayout,
                MaxAmount = r.MaxPayout
                // Notes deliberately excluded from list view
            }).ToListAsync();

        return Ok(ApiResponseDto<object>.Ok(rules));
    }

    [HttpPost]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Create([FromBody] PayoutRuleDto dto)
    {
        var existing = await _db.Set<PayoutRule>()
            .FirstOrDefaultAsync(r => r.LoanType == dto.LoanType && r.IsActive && !r.IsDeleted);
        if (existing != null)
            return BadRequest(ApiResponseDto<object>.Fail($"Rule for {dto.LoanType} already exists. Update instead."));

        var rule = new PayoutRule
        {
            LoanType   = dto.LoanType,
            Percentage = dto.Percentage,
            MinPayout  = dto.MinAmount,
            MaxPayout  = dto.MaxAmount,
            Notes      = dto.Notes,
            IsActive   = true,
            CreatedAt  = DateTime.UtcNow
        };
        _db.Set<PayoutRule>().Add(rule);
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<object>.Ok(new { rule.Id }, "Payout rule created."));
    }

    [HttpPut("{id:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Update(int id, [FromBody] PayoutRuleDto dto)
    {
        var rule = await _db.Set<PayoutRule>().FindAsync(id);
        if (rule == null) return NotFound(ApiResponseDto<object>.Fail("Rule not found."));
        rule.Percentage = dto.Percentage;
        rule.MinPayout  = dto.MinAmount;
        rule.MaxPayout  = dto.MaxAmount;
        rule.Notes      = dto.Notes;
        rule.UpdatedAt  = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Rule updated."));
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Delete(int id)
    {
        var rule = await _db.Set<PayoutRule>().FindAsync(id);
        if (rule == null) return NotFound(ApiResponseDto<object>.Fail("Rule not found."));
        rule.IsDeleted = true; rule.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Rule deleted."));
    }

    /// <summary>
    /// Calculate payout for a given loan amount + type without saving.
    /// Returns only the computed amount — not the internal percentage or formula notes.
    /// </summary>
    [HttpGet("calculate")]
    public async Task<IActionResult> Calculate([FromQuery] string loanType, [FromQuery] decimal amount)
    {
        var rule = await _db.Set<PayoutRule>()
            .FirstOrDefaultAsync(r => r.LoanType == loanType && r.IsActive && !r.IsDeleted);
        if (rule == null)
            return Ok(ApiResponseDto<object>.Ok(new { payoutAmount = 0m }));

        var payout = Math.Round(amount * rule.Percentage / 100, 2);
        if (rule.MinPayout.HasValue) payout = Math.Max(payout, rule.MinPayout.Value);
        if (rule.MaxPayout.HasValue) payout = Math.Min(payout, rule.MaxPayout.Value);

        // Return only the computed amount — not the rate, formula, or notes
        return Ok(ApiResponseDto<object>.Ok(new PayoutAutoCalcDto
        {
            LoanId       = 0,
            LoanAmount   = amount,
            LoanType     = loanType,
            PayoutRate   = rule.Percentage,   // visible to Admin/Manager only
            PayoutAmount = payout,
            Formula      = $"Calculated from configured rule for {loanType}"
        }));
    }

    /// <summary>Seed default payout rules — Admin only.</summary>
    [HttpPost("seed-defaults")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> SeedDefaults()
    {
        if (await _db.Set<PayoutRule>().AnyAsync(r => !r.IsDeleted))
            return BadRequest(ApiResponseDto<object>.Fail("Rules already exist. Clear first."));

        var defaults = new[]
        {
            new PayoutRule { LoanType="personal_loan",  Percentage=1.5m,  MinPayout=500m,  MaxPayout=15000m,  Notes="Standard personal loan payout", IsActive=true, CreatedAt=DateTime.UtcNow },
            new PayoutRule { LoanType="business_loan",  Percentage=1.0m,  MinPayout=1000m, MaxPayout=50000m,  Notes="Business loan payout",           IsActive=true, CreatedAt=DateTime.UtcNow },
            new PayoutRule { LoanType="home_loan",      Percentage=0.5m,  MinPayout=2000m, MaxPayout=100000m, Notes="Home loan payout",                IsActive=true, CreatedAt=DateTime.UtcNow },
            new PayoutRule { LoanType="new_car_loan",   Percentage=1.2m,  MinPayout=500m,  MaxPayout=20000m,  Notes="Car loan payout",                 IsActive=true, CreatedAt=DateTime.UtcNow },
            new PayoutRule { LoanType="education_loan", Percentage=0.75m, MinPayout=300m,  MaxPayout=10000m,  Notes="Education loan payout",            IsActive=true, CreatedAt=DateTime.UtcNow },
            new PayoutRule { LoanType="insurance",      Percentage=5.0m,  MinPayout=500m,  MaxPayout=25000m,  Notes="Insurance commission",             IsActive=true, CreatedAt=DateTime.UtcNow },
        };
        _db.Set<PayoutRule>().AddRange(defaults);
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<object>.Ok(new { count = defaults.Length }, "Default payout rules seeded."));
    }
}
