namespace LoanMS.Application.DTOs;

public class LoanReferenceDto
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Mobile { get; set; } = string.Empty;
    public string Relation { get; set; } = string.Empty;
    public int RefNumber { get; set; }
}

public class UpdateLoanReferenceItemDto
{
    public string? Name { get; set; }
    public string? Mobile { get; set; }
    public string? Relation { get; set; }
    public int RefNumber { get; set; }
}

public class LoanSanctionDetailDto
{
    public string? StampDuty { get; set; }
    public decimal? Gst { get; set; }
    public decimal? Insurance { get; set; }
    public decimal? PfPercent { get; set; }
    public bool InsuranceInBundled { get; set; }
    public bool PfInBundled { get; set; }
    public bool IsBundled { get; set; }
    public bool IsBt { get; set; }
    public decimal? FlatRate { get; set; }
    public DateTime? EmiDate { get; set; }
}
