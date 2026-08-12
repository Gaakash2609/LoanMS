namespace LoanMS.Application.DTOs;

public class LoanBankLineDto
{
    public int Id { get; set; }
    public string BankName { get; set; } = string.Empty;
    public string TempApplicationNumber { get; set; } = string.Empty;
    public string? ApplicationNumber { get; set; }
    public decimal? ApprovedLoan { get; set; }
    public string? Remarks { get; set; }
}
