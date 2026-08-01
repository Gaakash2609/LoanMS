using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class ForgotPasswordRequestDto
{
    [Required] [EmailAddress]
    public string Email { get; set; } = string.Empty;
}
