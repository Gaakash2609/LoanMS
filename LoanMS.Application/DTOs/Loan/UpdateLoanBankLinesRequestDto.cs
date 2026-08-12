namespace LoanMS.Application.DTOs;

/// <summary>
/// Whole-table replace for a loan's Bank Lines — matches the frontend's own
/// edit-mode UX (Edit → modify one or more rows → Save commits the whole
/// table at once; Cancel discards). Simpler and safer than trying to diff
/// individual row ids against a small, bounded per-loan list.
/// </summary>
public class UpdateLoanBankLinesRequestDto
{
    public List<BankLineItemDto> BankLines { get; set; } = new();
}

public class BankLineItemDto
{
    public string BankName { get; set; } = string.Empty;
    public string TempApplicationNumber { get; set; } = string.Empty;
    public string? ApplicationNumber { get; set; }
    public decimal? ApprovedLoan { get; set; }
    public string? Remarks { get; set; }
}
