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
    // Location FK — needed so the wizard's Sales Person dropdown can filter to
    // users at the selected branch (Vanilla parity: wLocationChange filters
    // sales persons by location, efin-app.js:6937-6955). Non-sensitive: it is
    // just the branch id, same value already exposed via LocationName on the
    // Locations list. Null for users with no branch assigned.
    public int? LocationId { get; set; }
}
