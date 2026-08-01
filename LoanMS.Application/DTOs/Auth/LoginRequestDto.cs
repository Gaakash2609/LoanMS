using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class LoginRequestDto
{
    [Required] [EmailAddress]
    public string Email { get; set; } = string.Empty;

    [Required] [MinLength(6)]
    public string Password { get; set; } = string.Empty;
}
