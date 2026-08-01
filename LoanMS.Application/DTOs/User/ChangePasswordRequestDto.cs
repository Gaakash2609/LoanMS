using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class ChangePasswordRequestDto
{
    [Required] public string CurrentPassword { get; set; } = string.Empty;
    [Required] [MinLength(6)] public string NewPassword { get; set; } = string.Empty;
}
