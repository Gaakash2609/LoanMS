using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class CibilScoreFactorDto
{
    public string? Factor { get; set; }
    public int ImpactScore { get; set; }
    public string? Description { get; set; }
}
