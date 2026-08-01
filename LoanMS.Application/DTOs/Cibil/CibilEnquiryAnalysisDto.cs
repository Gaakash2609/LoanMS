using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class CibilEnquiryAnalysisDto
{
    public int Count30Days { get; set; }
    public int Count90Days { get; set; }
    public int Count12Months { get; set; }
    public int Count24Months { get; set; }
    // NEW: date of most recent enquiry
    public DateTime? MostRecentEnquiryDate { get; set; }
    
    public bool HighEnquiryFrequency { get; set; }
    public bool LoanShoppingDetected { get; set; }
    public bool CreditHungryCustomer { get; set; }
    
    public List<CibilEnquiryDto> EnquiryDetails { get; set; } = new();
}
