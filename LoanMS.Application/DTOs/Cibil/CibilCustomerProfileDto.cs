using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class CibilCustomerProfileDto
{
    public string? FullName { get; set; }
    public DateTime DateOfBirth { get; set; }
    public string? Gender { get; set; }
    public string? PAN { get; set; }
    public string? AadhaarMasked { get; set; }
    public string? CKYCNumber { get; set; }
    public string? ControlNumber { get; set; }
    
    public List<string> MobileNumbers { get; set; } = new();
    public string? OfficeNumber { get; set; }
    public List<string> EmailAddresses { get; set; } = new();
    public List<CibilAddressDto> Addresses { get; set; } = new();
    public List<CibilEmploymentDto> EmploymentHistory { get; set; } = new();
    public string? OccupationType { get; set; }
    public decimal AnnualIncome { get; set; }
}
