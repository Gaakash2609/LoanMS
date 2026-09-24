namespace LoanMS.Application.DTOs;

/// <summary>
/// Distinct values for the Applications "Advanced Filter" dropdowns, taken
/// from every loan the caller can see (same visibility scope as the list) —
/// not just the rows on the current page.
/// </summary>
public class LoanFilterOptionsDto
{
    public List<string> SalesPeople { get; set; } = new();
    public List<string> Locations { get; set; } = new();
    public List<string> Channels { get; set; } = new();
    public List<string> Banks { get; set; } = new();
    public List<string> Purposes { get; set; } = new();
    public List<string> EmpTypes { get; set; } = new();
    public List<string> Cities { get; set; } = new();
    public List<string> States { get; set; } = new();
    public List<string> Genders { get; set; } = new();
    public List<string> DsaNames { get; set; } = new();
    public List<string> Partners { get; set; } = new();
    public List<string> Companies { get; set; } = new();
}
