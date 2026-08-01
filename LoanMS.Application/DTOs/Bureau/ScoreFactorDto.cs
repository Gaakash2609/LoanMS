using System;
using System.Collections.Generic;

namespace LoanMS.Application.DTOs;

public class ScoreFactorDto
{
    public string? Factor { get; set; }
    public int ImpactScore { get; set; }
    public string? Description { get; set; }
}
