using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class AuditLogDto
{
    public int    Id         { get; set; }
    public string EntityName { get; set; } = string.Empty;
    public string Action     { get; set; } = string.Empty;
    public string? EntityId  { get; set; }
    public string? UserName  { get; set; }
    public string? OldValues { get; set; }
    public string? NewValues { get; set; }
    public DateTime CreatedAt { get; set; }
}
