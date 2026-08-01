using System;
using System.Collections.Generic;

namespace LoanMS.Application.DTOs;

public class CustomerProfileDto
{
    public string? FullName { get; set; }
    public DateTime DateOfBirth { get; set; }
    public string? Gender { get; set; }
    public string? PAN { get; set; }
    public string? AadhaarMasked { get; set; } // Masked
    public string? CKYCNumber { get; set; }
    
    public List<string> MobileNumbers { get; set; } = new();
    public List<string> EmailAddresses { get; set; } = new();
    public List<AddressDto> Addresses { get; set; } = new();
    
    public List<EmploymentDto> EmploymentHistory { get; set; } = new();
    public string? OccupationType { get; set; }
    public decimal AnnualIncome { get; set; }
}
