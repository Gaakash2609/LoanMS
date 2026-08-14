using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

// Minimal, non-sensitive projection of a user — safe for any authenticated
// role to see (no email, no isActive/createdAt admin-management fields).
// Used by the wizard's Sales Person dropdown so non-Admin roles don't need
// access to the full Admin-only user management endpoint.
public class UserLookupDto
{
    public int Id { get; set; }
    public string FullName { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public string? LocationName { get; set; }
}
