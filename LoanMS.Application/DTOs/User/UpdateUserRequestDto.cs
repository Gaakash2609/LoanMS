using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class UpdateUserRequestDto
{
    [Required] public string FullName { get; set; } = string.Empty;
    public bool IsActive { get; set; }
    public UserRole Role { get; set; }
    public string? PhoneNumber { get; set; }
    public string? LocationName { get; set; }
    public string? SalesTeam { get; set; }
    public string? OpTeam { get; set; }
}
