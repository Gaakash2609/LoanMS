using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

// ── Perfios Report — persistence for the previously 100%-client-side
// bank-statement verification module (perfios-renderer.js's
// pfv9ConfirmAttachment). See PerfiosReport entity's own doc comment for
// the full "why" — the result used to live only in window._perfiosBankDoc
// and vanished on refresh. Same ownership/visibility convention as
// TrackingController/ObligationsController: every read/write is checked
// against ILoanService.GetByIdAsync's existing role-based visibility scope
// first, so a Perfios report can't be read or written for a loan outside
// the caller's scope even if the loanId is guessed directly.
[Authorize]
public class PerfiosController : BaseController
{
    private readonly ILoanService _loanService;
    private readonly AppDbContext _db;

    public PerfiosController(ILoanService loanService, AppDbContext db)
    {
        _loanService = loanService;
        _db = db;
    }

    /// <summary>Get the most recent Perfios report for a loan, if any.</summary>
    [HttpGet("/api/loans/{loanId:int}/perfios-report")]
    public async Task<IActionResult> GetLatest(int loanId)
    {
        var loan = await _loanService.GetByIdAsync(loanId, CurrentUserId, CurrentUserRole);
        if (!loan.Success) return NotFound(loan);

        var report = await _db.Set<PerfiosReport>()
            .Where(p => p.LoanId == loanId)
            .OrderByDescending(p => p.VerifiedAt)
            .FirstOrDefaultAsync();

        if (report == null)
            return Ok(ApiResponseDto<PerfiosReportDto>.Ok(null!));

        return Ok(ApiResponseDto<PerfiosReportDto>.Ok(new PerfiosReportDto
        {
            Id = report.Id,
            FileName = report.FileName,
            AverageBankBalance = report.AverageBankBalance,
            Span = report.Span,
            TotalTransactions = report.TotalTransactions,
            HasSalary = report.HasSalary,
            IsValid = report.IsValid,
            FirstTransactionDate = report.FirstTransactionDate,
            LastTransactionDate = report.LastTransactionDate,
            ManualReviewRequired = report.ManualReviewRequired,
            StaleDays = report.StaleDays,
            VerifiedAt = report.VerifiedAt
        }));
    }

    /// <summary>
    /// Save a new Perfios verification result for a loan (called once per
    /// successful "Confirm Attachment" in the Perfios popup). Deliberately
    /// always inserts a new row rather than updating an existing one — a
    /// bank statement can legitimately be re-verified (e.g. the "Additional
    /// Bank Statement" retry flow), and keeping every attempt is more
    /// useful/auditable than silently overwriting the previous one; GetLatest
    /// above always returns the newest by VerifiedAt regardless.
    /// </summary>
    [HttpPost("/api/loans/{loanId:int}/perfios-report")]
    public async Task<IActionResult> Save(int loanId, [FromBody] SavePerfiosReportRequestDto request)
    {
        var loan = await _loanService.GetByIdAsync(loanId, CurrentUserId, CurrentUserRole);
        if (!loan.Success) return NotFound(loan);

        var report = new PerfiosReport
        {
            LoanId = loanId,
            FileName = request.FileName,
            AverageBankBalance = request.AverageBankBalance,
            Span = request.Span,
            TotalTransactions = request.TotalTransactions,
            HasSalary = request.HasSalary,
            IsValid = request.IsValid,
            FirstTransactionDate = request.FirstTransactionDate,
            LastTransactionDate = request.LastTransactionDate,
            ManualReviewRequired = request.ManualReviewRequired,
            StaleDays = request.StaleDays,
            VerifiedAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        };
        _db.Set<PerfiosReport>().Add(report);
        await _db.SaveChangesAsync();

        return Ok(ApiResponseDto<object>.Ok(new { report.Id }, "Perfios report saved."));
    }
}
