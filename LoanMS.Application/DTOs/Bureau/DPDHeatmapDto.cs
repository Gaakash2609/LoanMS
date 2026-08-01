using System;
using System.Collections.Generic;

namespace LoanMS.Application.DTOs;

public class DPDHeatmapDto
{
    public int Last3MonthsDPD { get; set; }
    public int Last6MonthsDPD { get; set; }
    public int Last12MonthsDPD { get; set; }
    public string? HealthStatus { get; set; } // Green, Yellow, Red
}
