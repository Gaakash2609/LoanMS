using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class CibilEnquiryDto
{
    public DateTime EnquiryDate { get; set; }
    public string? EnquiryType { get; set; }
    public decimal RequestedAmount { get; set; }
    public string? Purpose { get; set; }
    public string? MemberName { get; set; }
    public string? OwnershipType { get; set; }
}
