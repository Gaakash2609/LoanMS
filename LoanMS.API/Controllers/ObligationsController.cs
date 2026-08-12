using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

// ── RBAC note ─────────────────────────────────────────────────────────────
// Obligations are part of a loan application's detail view, so authorization
// here deliberately mirrors LoansController.Update exactly (per product
// instruction): Create/Update = "Admin,Manager,Sales"; Delete = "Admin" only
// (same destructive-action convention as LoansController.Delete). Every
// write is additionally checked against the caller's role-based loan
// visibility scope via ILoanService.GetByIdAsync — the same check
// LoansController itself uses — so an obligation cannot be read or written
// for a loan outside the caller's scope even if the loanId/obligation id is
// guessed directly.
[Authorize]
public class ObligationsController : BaseController
{
    private readonly ILoanService _loanService;
    private readonly AppDbContext _db;
    private readonly LoanMS.API.Services.IRolePermissionService _rolePerm;

    public ObligationsController(ILoanService loanService, AppDbContext db, LoanMS.API.Services.IRolePermissionService rolePerm)
    {
        _loanService = loanService;
        _db          = db;
        _rolePerm    = rolePerm;
    }

    /// <summary>Get all obligations for a loan application (FOIR tab).</summary>
    [HttpGet("/api/loans/{loanId:int}/obligations")]
    public async Task<IActionResult> GetByLoan(int loanId)
    {
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canViewObligations"))
            return Forbid();

        var loan = await _loanService.GetByIdAsync(loanId, CurrentUserId, CurrentUserRole);
        if (!loan.Success) return NotFound(loan);

        var entities = await _db.LoanObligations
            .Where(o => o.LoanApplicationId == loanId)
            .OrderBy(o => o.Id)
            .ToListAsync();
        var obligations = entities.Select(ToDto).ToList();

        return Ok(ApiResponseDto<List<LoanObligationDto>>.Ok(obligations));
    }

    /// <summary>Add a new obligation to a loan application.</summary>
    [HttpPost]
    [Authorize(Roles = "Admin,Manager,Sales")]
    public async Task<IActionResult> Create([FromBody] CreateLoanObligationRequestDto request)
    {
        if (!ModelState.IsValid)
            return BadRequest(ApiResponseDto<LoanObligationDto>.Fail(
                ModelState.Values.SelectMany(v => v.Errors.Select(e => e.ErrorMessage)).ToList()));

        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canEditObligations"))
            return Forbid();

        var loan = await _loanService.GetByIdAsync(request.LoanApplicationId, CurrentUserId, CurrentUserRole);
        if (!loan.Success) return NotFound(ApiResponseDto<LoanObligationDto>.Fail("Loan application not found."));

        var obligation = new LoanObligation
        {
            LoanApplicationId = request.LoanApplicationId,
            LoanType          = request.LoanType,
            SanctionAmount    = request.SanctionAmount,
            FinancerName      = request.FinancerName,
            LoanEmi           = request.LoanEmi,
            AmountOutstanding = request.AmountOutstanding,
            LoanClosureDate   = request.LoanClosureDate,
            LoanAccountNumber = request.LoanAccountNumber,
            SelectBT          = request.SelectBT,
            CreatedAt         = DateTime.UtcNow
        };
        _db.LoanObligations.Add(obligation);
        await _db.SaveChangesAsync();

        return CreatedAtAction(nameof(GetByLoan), new { loanId = obligation.LoanApplicationId },
            ApiResponseDto<LoanObligationDto>.Ok(ToDto(obligation), "Obligation added."));
    }

    /// <summary>Update an existing obligation.</summary>
    [HttpPut("{id:int}")]
    [Authorize(Roles = "Admin,Manager,Sales")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateLoanObligationRequestDto request)
    {
        if (!ModelState.IsValid)
            return BadRequest(ApiResponseDto<LoanObligationDto>.Fail(
                ModelState.Values.SelectMany(v => v.Errors.Select(e => e.ErrorMessage)).ToList()));

        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canEditObligations"))
            return Forbid();

        var obligation = await _db.LoanObligations.FindAsync(id);
        if (obligation == null) return NotFound(ApiResponseDto<LoanObligationDto>.Fail("Obligation not found."));

        var loan = await _loanService.GetByIdAsync(obligation.LoanApplicationId, CurrentUserId, CurrentUserRole);
        if (!loan.Success) return NotFound(ApiResponseDto<LoanObligationDto>.Fail("Loan application not found."));

        obligation.LoanType          = request.LoanType;
        obligation.SanctionAmount    = request.SanctionAmount;
        obligation.FinancerName      = request.FinancerName;
        obligation.LoanEmi           = request.LoanEmi;
        obligation.AmountOutstanding = request.AmountOutstanding;
        obligation.LoanClosureDate   = request.LoanClosureDate;
        obligation.LoanAccountNumber = request.LoanAccountNumber;
        obligation.SelectBT          = request.SelectBT;
        obligation.UpdatedAt         = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(ApiResponseDto<LoanObligationDto>.Ok(ToDto(obligation), "Obligation updated."));
    }

    /// <summary>Delete an obligation [Admin only] — same convention as LoansController.Delete.</summary>
    [HttpDelete("{id:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Delete(int id)
    {
        var obligation = await _db.LoanObligations.FindAsync(id);
        if (obligation == null) return NotFound(ApiResponseDto<bool>.Fail("Obligation not found."));

        var loan = await _loanService.GetByIdAsync(obligation.LoanApplicationId, CurrentUserId, CurrentUserRole);
        if (!loan.Success) return NotFound(ApiResponseDto<bool>.Fail("Loan application not found."));

        obligation.IsDeleted = true;
        obligation.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(ApiResponseDto<bool>.Ok(true, "Obligation deleted."));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static LoanObligationDto ToDto(LoanObligation o) => new()
    {
        Id                = o.Id,
        LoanApplicationId = o.LoanApplicationId,
        LoanType          = o.LoanType,
        SanctionAmount    = o.SanctionAmount,
        FinancerName      = o.FinancerName,
        LoanEmi           = o.LoanEmi,
        AmountOutstanding = o.AmountOutstanding,
        LoanClosureDate   = o.LoanClosureDate,
        LoanAccountNumber = o.LoanAccountNumber,
        SelectBT          = o.SelectBT,
        CreatedAt         = o.CreatedAt,
        UpdatedAt         = o.UpdatedAt
    };
}
