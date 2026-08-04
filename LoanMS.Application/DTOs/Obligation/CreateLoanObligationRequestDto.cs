using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class CreateLoanObligationRequestDto
{
    [Required]
    public int LoanApplicationId { get; set; }

    [Required]
    public string LoanType { get; set; } = string.Empty;

    public decimal SanctionAmount { get; set; }
    public string? FinancerName { get; set; }
    public decimal LoanEmi { get; set; }
    public decimal AmountOutstanding { get; set; }
    public DateTime? LoanClosureDate { get; set; }
    public string? LoanAccountNumber { get; set; }
    public bool SelectBT { get; set; }
}
