using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class BulkUpdateStatusRequestDto
{
    [Required] public List<int> LoanIds { get; set; } = new();
    [Required] public LoanStatus NewStatus { get; set; }
    public string? Comment { get; set; }
}
