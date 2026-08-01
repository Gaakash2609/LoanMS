using System;
using System.Collections.Generic;

namespace LoanMS.Application.DTOs;

public class RiskFactorDto
{
    public string? Factor { get; set; }
    public string? Impact { get; set; } // Positive, Negative, Neutral
    public int Weight { get; set; } // 0-100
    public string? Description { get; set; }
}
