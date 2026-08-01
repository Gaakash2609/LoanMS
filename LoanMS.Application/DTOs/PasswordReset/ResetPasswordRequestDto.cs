using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class ResetPasswordRequestDto
{
    [Required] public string Token { get; set; } = string.Empty;

    [Required] [EmailAddress]
    public string Email { get; set; } = string.Empty;

    [Required] [MinLength(8)]
    public string NewPassword { get; set; } = string.Empty;

    [Required] [Compare(nameof(NewPassword), ErrorMessage = "Passwords do not match.")]
    public string ConfirmPassword { get; set; } = string.Empty;
}
