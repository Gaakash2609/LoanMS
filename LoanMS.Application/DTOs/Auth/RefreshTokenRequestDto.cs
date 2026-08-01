using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class RefreshTokenRequestDto
{
    [Required] public string RefreshToken { get; set; } = string.Empty;
}
