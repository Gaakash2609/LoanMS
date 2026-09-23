using LoanMS.Application.DTOs;

namespace LoanMS.Application.Interfaces;

/// <summary>
/// Authoritative orchestration for loan obligations (the FOIR / credit-review tab).
/// Assembles every figure from persisted data — the obligation rows, the customer's
/// income, the trusted income-verification result, the resolved lender/product FOIR
/// policy and the persisted Perfios statement — runs the server-side FOIR engine and
/// detection, and PERSISTS results. The client triggers and reads; it never computes
/// a business decision. Loan-visibility scope is enforced on every call via
/// ILoanService (same convention as the rest of the app), so an obligation can never
/// be read or written for a loan outside the caller's scope even by guessing an id.
/// </summary>
public interface IObligationService
{
    /// <summary>The whole Obligations tab in one authoritative payload: rows +
    /// summary + FOIR + reconciliation. <paramref name="whatIf"/> lets the caller
    /// pass an ephemeral proposed-EMI / co-applicant-income for the FOIR panel.</summary>
    Task<ApiResponseDto<ObligationWorkspaceDto>> GetWorkspaceAsync(int loanId, CalculateFoirRequestDto? whatIf, int userId, string userRole);

    /// <summary>Backward-compatible flat list for the existing GET route.</summary>
    Task<ApiResponseDto<List<LoanObligationDto>>> GetByLoanAsync(int loanId, int userId, string userRole);

    /// <summary>Authoritative FOIR for the loan (optionally with what-if inputs).</summary>
    Task<ApiResponseDto<ObligationFoirResultDto>> CalculateFoirAsync(int loanId, CalculateFoirRequestDto request, int userId, string userRole);

    /// <summary>Deterministically detect recurring EMI/mandate debits from the loan's
    /// persisted Perfios statement. A preview — nothing is written.</summary>
    Task<ApiResponseDto<DetectObligationsResultDto>> DetectAsync(int loanId, int userId, string userRole);

    /// <summary>Persist chosen detected candidates as ReviewRequired obligations
    /// (source = BankStatement), skipping any whose signature already exists.</summary>
    Task<ApiResponseDto<List<LoanObligationDto>>> ImportDetectedAsync(int loanId, ImportDetectedObligationsRequestDto request, int userId, string userRole);

    Task<ApiResponseDto<LoanObligationDto>> CreateAsync(CreateLoanObligationRequestDto request, int userId, string userRole);
    Task<ApiResponseDto<LoanObligationDto>> UpdateAsync(int id, UpdateLoanObligationRequestDto request, int userId, string userRole);
    Task<ApiResponseDto<bool>> DeleteAsync(int id, int userId, string userRole);

    /// <summary>Authorized reviewer confirms/rejects an obligation
    /// (Verified / Rejected / ReviewRequired) with an audit stamp.</summary>
    Task<ApiResponseDto<LoanObligationDto>> VerifyAsync(int id, VerifyObligationRequestDto request, int userId, string userRole);
}
