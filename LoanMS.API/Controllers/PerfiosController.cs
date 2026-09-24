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
//
// KNOWN ARCHITECTURAL LIMITATION: GetLatest below returns the single
// most-recent row for the loan — there is no per-doc-item discriminator
// (see PerfiosReport's own doc comment for the full detail and why this is
// deliberately unchanged in 7B-2). Preserved as-is; not a schema/contract
// change this phase.
[Authorize]
public class PerfiosController : BaseController
{
    private readonly ILoanService _loanService;
    private readonly AppDbContext _db;
    private readonly IFileStorageService _storage;

    public PerfiosController(ILoanService loanService, AppDbContext db, IFileStorageService storage)
    {
        _loanService = loanService;
        _db = db;
        _storage = storage;
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
            VerifiedAt = report.VerifiedAt,
            ReportDataJson = report.ReportDataJson
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

        // Gap-1: bind this report to the actual uploaded bank-statement document
        // (server-side) and hash its bytes. Resolve the explicit id if given (and
        // it belongs to this loan), else best-effort by matching the file name.
        var (docId, pdfHash) = await ResolveEvidenceAsync(loanId, request.BankStatementDocumentId, request.FileName);

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
            ReportDataJson = request.ReportDataJson,
            // Client-parsed evidence is UNTRUSTED (Gap-1). Never set ServerParsed here —
            // there is no server-authoritative producer. This blocks AutoVerify downstream.
            EvidenceSource = "ClientParsed",
            BankStatementDocumentId = docId,
            SourcePdfHash = pdfHash,
            VerifiedAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        };
        _db.Set<PerfiosReport>().Add(report);
        await _db.SaveChangesAsync();

        return Ok(ApiResponseDto<object>.Ok(new { report.Id, report.EvidenceSource, report.BankStatementDocumentId }, "Perfios report saved."));
    }

    // Resolve the bank-statement document (explicit id preferred, else file-name
    // match among this loan's live documents) and compute a server-side SHA-256 of
    // its bytes. Best-effort: binding/hash failures never fail the save.
    private async Task<(int? DocId, string? Hash)> ResolveEvidenceAsync(int loanId, int? explicitDocId, string? fileName)
    {
        LoanDocument? doc = null;
        if (explicitDocId is int id)
            doc = await _db.LoanDocuments.FirstOrDefaultAsync(d => d.Id == id && d.LoanId == loanId && !d.IsDeleted);
        if (doc is null && !string.IsNullOrWhiteSpace(fileName))
        {
            // The browser sends the original file name WITH its extension
            // ("HDFC_Statement.pdf"), but UploadDocument stores DocumentName
            // WITHOUT it ("HDFC_Statement") — match either, newest upload first,
            // otherwise wizard/loan-detail reports were never bound to evidence.
            var stem = Path.GetFileNameWithoutExtension(fileName);
            doc = await _db.LoanDocuments
                .Where(d => d.LoanId == loanId && !d.IsDeleted && (d.DocumentName == fileName || d.DocumentName == stem))
                .OrderByDescending(d => d.CreatedAt)
                .FirstOrDefaultAsync();
        }
        if (doc is null) return (null, null);

        string? hash = null;
        try
        {
            var obj = await _storage.GetAsync(DocumentStorageKeys.ForLoanDocument(doc.FilePath));
            if (obj is not null)
            {
                using var ms = new MemoryStream();
                await obj.Value.Content.CopyToAsync(ms);
                hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(ms.ToArray())).ToLowerInvariant();
            }
        }
        catch { /* best-effort binding — hash stays null on any storage error */ }
        return (doc.Id, hash);
    }
}
