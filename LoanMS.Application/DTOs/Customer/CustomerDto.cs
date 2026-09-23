using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class CustomerDto
{
    public int Id { get; set; }
    public string FullName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
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
    public string? Gender { get; set; }
    public string? FatherName { get; set; }
    public string? ResidenceType { get; set; }
    // Applicant-tab parity fields — see Customer entity.
    public string? MotherName { get; set; }
    public string? AlternatePhone { get; set; }
    public string? HouseNo { get; set; }
    public string? PermanentHouseNo { get; set; }
    public string? PermanentAddress { get; set; }
    public string? PermanentCity { get; set; }
    public string? PermanentState { get; set; }
    public string? PermanentPinCode { get; set; }
    public string? PermanentResidenceType { get; set; }
    public string? Designation { get; set; }
    public string? CompanyType { get; set; }
    public string? OfficialEmail { get; set; }
    public string? OfficeAddress { get; set; }
    public string? OfficePinCode { get; set; }
    public int TotalLoans { get; set; }
    public DateTime CreatedAt { get; set; }
}
