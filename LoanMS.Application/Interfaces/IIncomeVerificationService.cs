using LoanMS.Application.DTOs;
using LoanMS.Application.DTOs.IncomeVerification;
using LoanMS.Domain.Enums;

namespace LoanMS.Application.Interfaces;

/// <summary>
/// Authoritative income-verification orchestration (Phase 5). Assembles the
/// engine's input ENTIRELY from persisted backend data (loan → salary-slip
/// extractions → normalized Perfios report), runs the canonical engine, and
/// PERSISTS the result + per-month evidence. The client can read/trigger but can
/// never assert the outcome — completion is derived from this record, not a flag.
/// </summary>
public interface IIncomeVerificationService
{
    /// <summary>Run (or re-run) verification for a loan's applicant and persist it.</summary>
    Task<ApiResponseDto<IncomeVerificationResultDto>> RunAsync(int loanId, RunIncomeVerificationRequestDto request, int userId);

    /// <summary>Latest persisted result for a loan's applicant (null-data response if none).</summary>
    Task<ApiResponseDto<IncomeVerificationResultDto>> GetLatestAsync(int loanId, ApplicantRole role, string? applicantKey);

    /// <summary>Append-only history of every verification run for the loan (newest first) — §14 audit.</summary>
    Task<ApiResponseDto<List<IncomeVerificationResultDto>>> GetHistoryAsync(int loanId);

    /// <summary>Authorized reviewer completes a manual review (approve/reject) with reason.</summary>
    Task<ApiResponseDto<IncomeVerificationResultDto>> SubmitManualReviewAsync(int loanId, int verificationId, ManualReviewRequestDto request, int reviewerId);

    /// <summary>Record a user salary override on a slip extraction — never overwrites the
    /// immutable original; the next run then routes to ManualReviewRequired (§4).</summary>
    Task<ApiResponseDto<object>> SetSalaryOverrideAsync(int loanId, int extractionId, SalaryOverrideRequestDto request, int userId);

    /// <summary>
    /// The AUTHORITATIVE trusted salaried income for lending calculations, per the
    /// locked Phase-7 rule: returns the bank-verified salary ONLY when the latest
    /// IncomeVerification is <c>AutoVerified</c>, or <c>ManualReviewCompleted</c>
    /// with an Approved decision. For every other state (Pending / ManualReviewRequired
    /// / Failed / LegacyUnverified) it returns null so the caller falls back to
    /// declared income — an unverified figure is never treated as verified. The state
    /// is read from the persisted backend result, never a client flag.
    /// </summary>
    Task<decimal?> GetTrustedVerifiedIncomeAsync(int loanId, ApplicantRole role = ApplicantRole.Applicant, string? applicantKey = null);
}
