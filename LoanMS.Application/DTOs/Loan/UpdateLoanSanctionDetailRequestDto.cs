namespace LoanMS.Application.DTOs;

public class UpdateLoanSanctionDetailRequestDto
{
    public decimal? SanctionLoanAmt { get; set; }
    public int? SanctionTenureMonths { get; set; }
    public decimal? SanctionRoi { get; set; }
    public decimal? SanctionEmi { get; set; }
    public string? StampDuty { get; set; }
    public decimal? Gst { get; set; }
    public decimal? Insurance { get; set; }
    public decimal? PfPercent { get; set; }
    public bool? InsuranceInBundled { get; set; }
    public bool? PfInBundled { get; set; }
    public bool? IsBundled { get; set; }
    public bool? IsBt { get; set; }
    public decimal? FlatRate { get; set; }
    public DateTime? EmiDate { get; set; }
}
