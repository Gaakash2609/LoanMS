using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class AdminResetPasswordRequestDto
{
    [Required] [MinLength(6)] public string NewPassword { get; set; } = string.Empty;
}
