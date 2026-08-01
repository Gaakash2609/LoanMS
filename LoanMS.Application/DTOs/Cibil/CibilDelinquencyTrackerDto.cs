using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class CibilDelinquencyTrackerDto
{
    public int TotalMissedPayments { get; set; }
    public int DelinquencyFrequency { get; set; }
    public int MaxDPDObserved { get; set; }
    public string? Pattern { get; set; } // Isolated, Frequent, Recent, None
}
