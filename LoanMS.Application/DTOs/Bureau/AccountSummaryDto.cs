using System;
using System.Collections.Generic;

namespace LoanMS.Application.DTOs;

public class AccountSummaryDto
{
    public int TotalAccounts { get; set; }
    public int ActiveAccounts { get; set; }
    public int ClosedAccounts { get; set; }
    
    public decimal TotalSanctionAmount { get; set; }
    public decimal CurrentOutstanding { get; set; }
    public decimal OverdueAmount { get; set; }
    
    public DateTime OldestAccountDate { get; set; }
    public DateTime LatestAccountDate { get; set; }
    
    public int SecuredLoanCount { get; set; }
    public int UnsecuredLoanCount { get; set; }
    
    public int AccountAgeMonths { get; set; }
}
