using System.Text.Json;
using System.Text.RegularExpressions;
using LoanMS.Application.DTOs;
using LoanMS.Application.DTOs.IncomeVerification;
using LoanMS.Application.IncomeVerification;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using IncomeVerificationEntity = LoanMS.Domain.Entities.IncomeVerification;

namespace LoanMS.Infrastructure.Services;

// ── Income Verification Service (Phase 5) ─────────────────────────────────────
// The authoritative orchestration: builds the engine input from persisted data
// only, runs the canonical engine, persists the result + months, derives
// Loan.IncomeChecked from the result (never the client), and appends an audit
// entry. Also owns manual review and salary-override recording.
public sealed class IncomeVerificationService : IIncomeVerificationService
{
    private readonly AppDbContext _db;
    private readonly IIncomeVerificationEngine _engine;
    private readonly IPerfiosNormalizationService _normalizer;
    private readonly ITrustedSalaryExtractionService _extraction;
    private readonly ILogger<IncomeVerificationService> _log;

    private static readonly string[] Mon =
        { "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec" };
    private static readonly Regex SalarySlipDoc =
        new(@"salary.?slip|payslip|pay.?slip|salary", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public IncomeVerificationService(
        AppDbContext db,
        IIncomeVerificationEngine engine,
        IPerfiosNormalizationService normalizer,
        ITrustedSalaryExtractionService extraction,
        ILogger<IncomeVerificationService> log)
    {
        _db = db;
        _engine = engine;
        _normalizer = normalizer;
        _extraction = extraction;
        _log = log;
    }

    public async Task<ApiResponseDto<IncomeVerificationResultDto>> RunAsync(
        int loanId, RunIncomeVerificationRequestDto request, int userId)
    {
        var loan = await _db.Loans.Include(l => l.Customer).FirstOrDefaultAsync(l => l.Id == loanId);
        if (loan == null) return ApiResponseDto<IncomeVerificationResultDto>.Fail("Loan not found.");

        // Idempotency: same key ⇒ return the existing verification.
        if (!string.IsNullOrWhiteSpace(request.IdempotencyKey))
        {
            var dup = await _db.IncomeVerifications.Include(v => v.Months)
                .FirstOrDefaultAsync(v => v.IdempotencyKey == request.IdempotencyKey);
            if (dup != null) return ApiResponseDto<IncomeVerificationResultDto>.Ok(Map(dup), "Existing verification (idempotent).");
        }

        var role = request.ApplicantRole;
        var key = request.ApplicantKey;

        // 1) Ensure a SalarySlipExtraction exists for each salary-slip document
        //    (server-side re-extraction; untrusted fallback when vision is off).
        await EnsureExtractionsAsync(loanId, role, key);

        // 2) Build trusted inputs.
        var extractionRows = await _db.Set<SalarySlipExtraction>()
            .Where(s => s.LoanId == loanId && s.ApplicantRole == role && s.ApplicantKey == key && !s.IsDeleted)
            .ToListAsync();

        var slips = extractionRows
            .Where(s => s.Year.HasValue && s.Month.HasValue)
            .Select(s => new EngineSlip
            {
                ExtractionId = s.Id,
                Year = s.Year!.Value,
                Month = s.Month!.Value,
                OriginalNetSalary = s.OriginalNetSalary,
                UserEditedSalary = s.UserEditedSalary,
                IsTrustedOriginal = s.IsTrustedOriginal,
            })
            .ToList();

        var perfios = await _db.Set<PerfiosReport>()
            .Where(p => p.LoanId == loanId && !p.IsDeleted)
            .OrderByDescending(p => p.VerifiedAt)
            .FirstOrDefaultAsync();

        NormalizedBankStatement? statement = null;
        string? hash = null;
        if (!string.IsNullOrWhiteSpace(perfios?.ReportDataJson))
        {
            statement = _normalizer.Normalize(perfios!.ReportDataJson, perfios.Id);
            hash = _normalizer.ComputeReportHash(perfios.ReportDataJson!);
            // Gap-1: bank evidence is trusted for AutoVerify ONLY when server-derived.
            // No genuine server producer exists yet, so this is false in practice
            // (client-parsed) → the engine forces ManualReviewRequired.
            if (statement is not null)
                statement.IsTrustedEvidence = string.Equals(perfios.EvidenceSource, "ServerParsed", StringComparison.Ordinal);
        }

        // 3) Gap-3 (confirmed rule): the required-months reference date is the
        // EARLIEST actual submission event — the first LoanStatusHistory row whose
        // ToStatus == Submitted — else fall back to loan.CreatedAt. This is NOT the
        // earliest history row (that is the Draft→Draft "created" event) and NOT the
        // current date, so a re-run never drifts and creation-only/never-submitted
        // loans still resolve deterministically.
        var submitDate = await _db.LoanStatusHistories
            .Where(h => h.LoanId == loanId && h.ToStatus == LoanStatus.Submitted)
            .OrderBy(h => h.CreatedAt)
            .Select(h => (DateTime?)h.CreatedAt)
            .FirstOrDefaultAsync();
        var referenceDate = submitDate ?? loan.CreatedAt;

        var input = new IncomeVerificationEngineInput
        {
            LoanId = loanId,
            ApplicantRole = role,
            ApplicantKey = key,
            RequiredMonthsReferenceDate = referenceDate,
            DeclaredIncome = loan.Customer?.MonthlyIncome,
            Statement = statement,
            Slips = slips,
            RunByUserId = userId,
            RunAt = DateTime.UtcNow,
            PerfiosReportId = perfios?.Id,
            SourceReportHash = hash,
            IdempotencyKey = request.IdempotencyKey,
        };
        var iv = _engine.Run(input);

        _db.IncomeVerifications.Add(iv);
        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException) when (!string.IsNullOrWhiteSpace(request.IdempotencyKey))
        {
            // Lost an idempotency race — return the winner.
            _db.ChangeTracker.Clear();
            var winner = await _db.IncomeVerifications.Include(v => v.Months)
                .FirstOrDefaultAsync(v => v.IdempotencyKey == request.IdempotencyKey);
            if (winner != null) return ApiResponseDto<IncomeVerificationResultDto>.Ok(Map(winner), "Existing verification (idempotent).");
            throw;
        }

        // 4) Derive the (previously client-controlled) IncomeChecked flag from the
        //    authoritative result — never from the client.
        loan.IncomeChecked = iv.State == IncomeVerificationState.AutoVerified;
        loan.UpdatedAt = DateTime.UtcNow;

        _db.AuditLogs.Add(new AuditLog
        {
            EntityName = nameof(IncomeVerificationEntity),
            Action = "Run",
            EntityId = iv.Id.ToString(),
            NewValues = JsonSerializer.Serialize(new { iv.State, iv.VerifiedIncome, iv.LoanId, iv.ApplicantRole }),
            UserId = userId,
            CreatedAt = DateTime.UtcNow,
        });
        await _db.SaveChangesAsync();

        return ApiResponseDto<IncomeVerificationResultDto>.Ok(Map(iv), "Income verification completed.");
    }

    public async Task<ApiResponseDto<IncomeVerificationResultDto>> GetLatestAsync(int loanId, ApplicantRole role, string? applicantKey)
    {
        var iv = await _db.IncomeVerifications.Include(v => v.Months)
            .Where(v => v.LoanId == loanId && v.ApplicantRole == role && v.ApplicantKey == applicantKey)
            .OrderByDescending(v => v.RunAt)
            .FirstOrDefaultAsync();
        return ApiResponseDto<IncomeVerificationResultDto>.Ok(iv == null ? null! : Map(iv));
    }

    public async Task<ApiResponseDto<List<IncomeVerificationResultDto>>> GetHistoryAsync(int loanId)
    {
        var list = await _db.IncomeVerifications.Include(v => v.Months)
            .Where(v => v.LoanId == loanId)
            .OrderByDescending(v => v.RunAt)
            .ToListAsync();
        return ApiResponseDto<List<IncomeVerificationResultDto>>.Ok(list.Select(Map).ToList());
    }

    public async Task<ApiResponseDto<IncomeVerificationResultDto>> SubmitManualReviewAsync(
        int loanId, int verificationId, ManualReviewRequestDto request, int reviewerId)
    {
        var decision = (request.Decision ?? "").Trim();
        if (decision != "Approved" && decision != "Rejected")
            return ApiResponseDto<IncomeVerificationResultDto>.Fail("Decision must be 'Approved' or 'Rejected'.");
        if (string.IsNullOrWhiteSpace(request.Reason))
            return ApiResponseDto<IncomeVerificationResultDto>.Fail("A review reason is required.");

        var iv = await _db.IncomeVerifications.Include(v => v.Months)
            .FirstOrDefaultAsync(v => v.Id == verificationId && v.LoanId == loanId);
        if (iv == null) return ApiResponseDto<IncomeVerificationResultDto>.Fail("Verification not found.");
        if (iv.State != IncomeVerificationState.ManualReviewRequired)
            return ApiResponseDto<IncomeVerificationResultDto>.Fail($"Verification is not awaiting manual review (state: {iv.State}).");

        iv.State = IncomeVerificationState.ManualReviewCompleted;
        iv.ReviewedByUserId = reviewerId;
        iv.ReviewedAt = DateTime.UtcNow;
        iv.ReviewDecision = decision;
        iv.ReviewReason = request.Reason.Trim();
        iv.UpdatedAt = DateTime.UtcNow;
        // On approval the reviewer accepts the extracted income as verified.
        iv.VerifiedIncome = decision == "Approved" ? iv.ExtractedIncome : null;

        var loan = await _db.Loans.FirstOrDefaultAsync(l => l.Id == loanId);
        if (loan != null)
        {
            loan.IncomeChecked = decision == "Approved";
            loan.UpdatedAt = DateTime.UtcNow;
        }

        _db.AuditLogs.Add(new AuditLog
        {
            EntityName = nameof(IncomeVerificationEntity),
            Action = "ManualReview",
            EntityId = iv.Id.ToString(),
            NewValues = JsonSerializer.Serialize(new { decision, iv.VerifiedIncome }),
            Reason = iv.ReviewReason,
            UserId = reviewerId,
            CreatedAt = DateTime.UtcNow,
        });
        await _db.SaveChangesAsync();

        return ApiResponseDto<IncomeVerificationResultDto>.Ok(Map(iv), "Manual review recorded.");
    }

    public async Task<ApiResponseDto<object>> SetSalaryOverrideAsync(
        int loanId, int extractionId, SalaryOverrideRequestDto request, int userId)
    {
        if (string.IsNullOrWhiteSpace(request.Reason))
            return ApiResponseDto<object>.Fail("An override reason is required.");
        if (request.UserEditedSalary <= 0m)
            return ApiResponseDto<object>.Fail("Edited salary must be greater than zero.");

        var ex = await _db.Set<SalarySlipExtraction>()
            .FirstOrDefaultAsync(s => s.Id == extractionId && s.LoanId == loanId && !s.IsDeleted);
        if (ex == null) return ApiResponseDto<object>.Fail("Salary-slip extraction not found.");

        // NEVER overwrite the immutable original — the override is a separate field.
        ex.UserEditedSalary = request.UserEditedSalary;
        ex.OverrideReason = request.Reason.Trim();
        ex.EditedByUserId = userId;
        ex.EditedAt = DateTime.UtcNow;
        ex.UpdatedAt = DateTime.UtcNow;

        _db.AuditLogs.Add(new AuditLog
        {
            EntityName = nameof(SalarySlipExtraction),
            Action = "SalaryOverride",
            EntityId = ex.Id.ToString(),
            OldValues = JsonSerializer.Serialize(new { ex.OriginalNetSalary }),
            NewValues = JsonSerializer.Serialize(new { ex.UserEditedSalary }),
            Reason = ex.OverrideReason,
            UserId = userId,
            CreatedAt = DateTime.UtcNow,
        });
        await _db.SaveChangesAsync();

        return ApiResponseDto<object>.Ok(new { ex.Id, ex.OriginalNetSalary, ex.UserEditedSalary },
            "Override recorded; re-run verification to apply (routes to manual review).");
    }

    public async Task<decimal?> GetTrustedVerifiedIncomeAsync(
        int loanId, ApplicantRole role = ApplicantRole.Applicant, string? applicantKey = null)
    {
        var iv = await _db.IncomeVerifications
            .Where(v => v.LoanId == loanId && v.ApplicantRole == role && v.ApplicantKey == applicantKey)
            .OrderByDescending(v => v.RunAt)
            .FirstOrDefaultAsync();
        if (iv == null) return null;

        // Locked Phase-7 rule: trusted ONLY when AutoVerified, or
        // ManualReviewCompleted + Approved. (VerifiedIncome is already null in
        // every other state by construction — this state check is the explicit,
        // belt-and-suspenders enforcement of the rule.)
        var trusted = iv.State == IncomeVerificationState.AutoVerified
            || (iv.State == IncomeVerificationState.ManualReviewCompleted && iv.ReviewDecision == "Approved");
        return trusted ? iv.VerifiedIncome : null;
    }

    // ── helpers ────────────────────────────────────────────────────────────────
    private async Task EnsureExtractionsAsync(int loanId, ApplicantRole role, string? applicantKey)
    {
        // Gap-2: select ONLY this applicant's documents — a Primary document can
        // never be picked up by a CoApplicant run (and vice versa).
        var docs = await _db.LoanDocuments
            .Where(d => d.LoanId == loanId && d.ApplicantRole == role && d.ApplicantKey == applicantKey && !d.IsDeleted)
            .ToListAsync();
        var slipDocs = docs.Where(d => SalarySlipDoc.IsMatch((d.DocumentType ?? "") + " " + (d.DocumentName ?? ""))).ToList();
        if (slipDocs.Count == 0) return;

        // Dedup is scoped to the SAME applicant, so Primary and CoApplicant
        // extraction dedup remain independent.
        var existing = await _db.Set<SalarySlipExtraction>()
            .Where(s => s.LoanId == loanId && s.ApplicantRole == role && s.ApplicantKey == applicantKey && !s.IsDeleted)
            .ToListAsync();

        var added = false;
        foreach (var doc in slipDocs)
        {
            if (existing.Any(e => e.DocumentId == doc.Id)) continue;
            TrustedSalaryExtractionResult ex;
            try { ex = await _extraction.ExtractAsync(doc.FilePath); }
            catch (Exception e)
            {
                _log.LogWarning(e, "Salary extraction threw for doc {DocId}", doc.Id);
                ex = new TrustedSalaryExtractionResult { IsTrusted = false, ExtractionMethod = "ClientReported", FallbackReason = "extraction error" };
            }

            var (yr, mo) = ParseMonthLabel(ex.MonthLabel);
            var row = new SalarySlipExtraction
            {
                LoanId = loanId,
                DocumentId = doc.Id,
                ApplicantRole = role,
                ApplicantKey = applicantKey,
                Year = yr,
                Month = mo,
                MonthLabel = ex.MonthLabel,
                OriginalNetSalary = ex.OriginalNetSalary,
                ExtractionMethod = ex.ExtractionMethod,
                IsTrustedOriginal = ex.IsTrusted,
                ContentHash = ex.ContentHash,
                CreatedAt = DateTime.UtcNow,
            };
            _db.Add(row);
            existing.Add(row);
            added = true;
        }
        if (added) await _db.SaveChangesAsync();
    }

    private static (int? Year, int? Month) ParseMonthLabel(string? label)
    {
        if (string.IsNullOrWhiteSpace(label)) return (null, null);
        var m = Regex.Match(label, @"([A-Za-z]{3,})\s+(\d{4})");
        if (!m.Success) return (null, null);
        var idx = Array.IndexOf(Mon, m.Groups[1].Value.Substring(0, 3).ToLowerInvariant());
        if (idx < 0) return (null, null);
        return (int.Parse(m.Groups[2].Value), idx + 1);
    }

    private static IncomeVerificationResultDto Map(IncomeVerificationEntity iv)
    {
        var reasons = new List<IncomeVerificationReasonDto>();
        if (!string.IsNullOrWhiteSpace(iv.ReasonCodesJson))
        {
            try
            {
                using var d = JsonDocument.Parse(iv.ReasonCodesJson);
                foreach (var r in d.RootElement.EnumerateArray())
                    reasons.Add(new IncomeVerificationReasonDto
                    {
                        Code = r.TryGetProperty("Code", out var c) ? c.GetString() ?? "" : "",
                        MonthLabel = r.TryGetProperty("MonthLabel", out var ml) && ml.ValueKind == JsonValueKind.String ? ml.GetString() : null,
                        Detail = r.TryGetProperty("Detail", out var dt) ? dt.GetString() ?? "" : "",
                    });
            }
            catch { /* tolerate legacy/blank */ }
        }

        return new IncomeVerificationResultDto
        {
            Id = iv.Id,
            LoanId = iv.LoanId,
            ApplicantRole = iv.ApplicantRole.ToString(),
            ApplicantKey = iv.ApplicantKey,
            State = iv.State.ToString(),
            RequiredMonthsReferenceDate = iv.RequiredMonthsReferenceDate,
            DeclaredIncome = iv.DeclaredIncome,
            ExtractedIncome = iv.ExtractedIncome,
            VerifiedIncome = iv.VerifiedIncome,
            PerfiosReportId = iv.PerfiosReportId,
            SourceReportHash = iv.SourceReportHash,
            RunByUserId = iv.RunByUserId,
            RunAt = iv.RunAt,
            ReviewedByUserId = iv.ReviewedByUserId,
            ReviewedAt = iv.ReviewedAt,
            ReviewDecision = iv.ReviewDecision,
            ReviewReason = iv.ReviewReason,
            Reasons = reasons,
            Months = iv.Months.OrderBy(m => m.Year).ThenBy(m => m.Month).Select(m => new IncomeVerificationMonthDto
            {
                Year = m.Year,
                Month = m.Month,
                MonthLabel = m.MonthLabel,
                SalarySlipExtractionId = m.SalarySlipExtractionId,
                OriginalExtractedSalary = m.OriginalExtractedSalary,
                EffectiveSalary = m.EffectiveSalary,
                MatchStatus = m.MatchStatus,
                ReasonCode = m.ReasonCode,
                MatchedTransactionRef = m.MatchedTransactionRef,
                MatchedTransactionDate = m.MatchedTransactionDate,
                MatchedAmount = m.MatchedAmount,
                WindowStart = m.WindowStart,
                WindowEnd = m.WindowEnd,
                VerificationMethod = m.VerificationMethod,
                BankAccountRef = m.BankAccountRef,
            }).ToList(),
        };
    }
}
