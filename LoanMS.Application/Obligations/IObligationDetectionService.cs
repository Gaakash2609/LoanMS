using LoanMS.Application.DTOs;

namespace LoanMS.Application.Obligations;

/// <summary>
/// Deterministic, server-side detection of running-loan obligations from a
/// persisted Perfios bank statement (PerfiosReport.ReportDataJson). Finds recurring
/// EMI / mandate DEBITS (ACH/NACH/ECS and Loan-EMI-categorised outflows) and groups
/// them into obligation candidates. Reuses the exact ReportDataJson contract the
/// income-verification normalizer already relies on. It NEVER invents outstanding
/// balance, tenure, interest rate, loan status, or an unsupported account number —
/// unknown fields stay null; only the recurring EMI amount and evidence-supported
/// lender narration are surfaced.
/// </summary>
public interface IObligationDetectionService
{
    List<DetectedObligationCandidateDto> Detect(string? reportDataJson);
}
