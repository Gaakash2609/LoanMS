using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class CibilDPDHeatmapDto
{
    public int Last3MonthsDPD { get; set; }
    public int Last6MonthsDPD { get; set; }
    public int Last12MonthsDPD { get; set; }
    public string? HealthStatus { get; set; } // Green, Yellow, Red
}
