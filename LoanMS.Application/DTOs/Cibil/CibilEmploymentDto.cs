using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class CibilEmploymentDto
{
    public string? EmployerName { get; set; }
    public string? Occupation { get; set; }
    public string? EmploymentType { get; set; }
    public DateTime? StartDate { get; set; }
    public DateTime? EndDate { get; set; }
    public decimal MonthlyIncome { get; set; }
}
