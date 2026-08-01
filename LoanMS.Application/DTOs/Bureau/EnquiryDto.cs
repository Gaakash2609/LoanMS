using System;
using System.Collections.Generic;

namespace LoanMS.Application.DTOs;

public class EnquiryDto
{
    public DateTime EnquiryDate { get; set; }
    public string? EnquiryType { get; set; }
    public decimal RequestedAmount { get; set; }
    public string? Purpose { get; set; }
}
