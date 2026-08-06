using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class CreateUserRequestDto
{
    [Required] public string FullName { get; set; } = string.Empty;
    [Required] [EmailAddress] public string Email { get; set; } = string.Empty;
    [Required] [MinLength(6)] public string Password { get; set; } = string.Empty;
    [Required] public UserRole Role { get; set; }
    public string? PhoneNumber { get; set; }
    public string? LocationName { get; set; }
    public string? SalesTeam { get; set; }
    public string? OpTeam { get; set; }
}
