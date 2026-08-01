using System;
using System.Collections.Generic;

namespace LoanMS.Application.DTOs;

public class DelinquencyTrackerDto
{
    public int TotalMissedPayments { get; set; }
    public int DelinquencyFrequency { get; set; }
    public int MaxDPDObserved { get; set; }
    public string? Pattern { get; set; } // Isolated, Frequent, Recent, None
}
