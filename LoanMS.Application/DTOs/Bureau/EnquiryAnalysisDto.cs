using System;
using System.Collections.Generic;

namespace LoanMS.Application.DTOs;

public class EnquiryAnalysisDto
{
    public int Count30Days { get; set; }
    public int Count90Days { get; set; }
    public int Count12Months { get; set; }
    public int Count24Months { get; set; }
    
    public bool HighEnquiryFrequency { get; set; }
    public bool LoanShoppingDetected { get; set; }
    public bool CreditHungryCustomer { get; set; }
    
    public List<EnquiryDto> EnquiryDetails { get; set; } = new();
}
