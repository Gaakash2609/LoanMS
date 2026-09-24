using LoanMS.Application.DTOs;

namespace LoanMS.Application.Interfaces;

/// <summary>What a permanent customer delete removed (returned to the Admin).</summary>
public class CustomerDeletionResultDto
{
    public int CustomerId { get; set; }
    public int Loans { get; set; }
    public int Documents { get; set; }
    public int PayoutClaims { get; set; }
    public int BureauReports { get; set; }
    public int AuditEntries { get; set; }
    /// <summary>Document files that could not be removed from storage (S3) after the
    /// database delete committed — their DB rows are already gone; these keys need a retry.</summary>
    public List<string> StorageFailures { get; set; } = new();
}

/// <summary>
/// Permanent ("hard") delete of a customer and everything that belongs to them:
/// loans and every loan-level record, documents (DB rows and stored files),
/// bureau/CIBIL data, payout claims, tasks/tickets, notifications and the audit
/// entries that point at them. Nothing is soft-deleted; no orphan rows remain.
/// </summary>
public interface ICustomerDeletionService
{
    Task<ApiResponseDto<CustomerDeletionResultDto>> DeletePermanentlyAsync(int customerId, CancellationToken ct = default);
}
