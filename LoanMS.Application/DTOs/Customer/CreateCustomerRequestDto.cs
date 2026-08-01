using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class CreateCustomerRequestDto
{
    [Required] public string FullName { get; set; } = string.Empty;
    [Required] [EmailAddress] public string Email { get; set; } = string.Empty;
    [Required] [Phone] public string Phone { get; set; } = string.Empty;
    public string? PanNumber { get; set; }
    public string? AadhaarNumber { get; set; }
    public DateTime? DateOfBirth { get; set; }
    public string? Address { get; set; }
    public string? City { get; set; }
    public string? State { get; set; }
    public string? PinCode { get; set; }
    public decimal? MonthlyIncome { get; set; }
    public decimal? MonthlyObligations { get; set; }
    public string? EmploymentType { get; set; }
    public string? CompanyName { get; set; }
    public int? CibilScore { get; set; }
    /// <summary>Stored as entered (Male/Female/Other) — converted to InCred's M/F format only when building the InCred payload.</summary>
    public string? Gender { get; set; }
    public string? FatherName { get; set; }
    public string? ResidenceType { get; set; }
}
