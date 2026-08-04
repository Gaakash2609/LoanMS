namespace LoanMS.Application.DTOs;

public class ReportTargetDto
{
    public int Id { get; set; }
    public string TargetMonth { get; set; } = string.Empty;
    public int? UserId { get; set; }
    public int? TeamId { get; set; }
    public decimal DisbAmt { get; set; }
    public int LoginCount { get; set; }
    public int DisbCount { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}
