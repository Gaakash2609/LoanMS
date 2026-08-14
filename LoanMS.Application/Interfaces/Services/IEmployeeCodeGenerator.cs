using LoanMS.Domain.Enums;

namespace LoanMS.Application.Interfaces;

/// <summary>
/// Centralized Employee Code / User ID generator — MH-{ROLE}-{LOCATION}-
/// {RANDOM4} (e.g. "MH-ADM-HO-5832"). Single source of truth for the
/// role-code mapping and the generation algorithm, so no other file needs
/// to hardcode role/location abbreviations or duplicate the
/// random-4-digit + uniqueness-check logic.
/// </summary>
public interface IEmployeeCodeGenerator
{
    /// <summary>
    /// Generates a unique Employee Code for the given role and location
    /// name (matched case-insensitively against Location.Name to resolve
    /// its Code — resolution happens here, not in the caller, since this
    /// service has the DB access needed and UserService/IUnitOfWork
    /// doesn't expose Locations). locationName may be null/empty/
    /// unmatched — falls back to "HO".
    /// </summary>
    Task<string> GenerateAsync(UserRole role, string? locationName);

    /// <summary>Three-letter code for a role (e.g. Admin → "ADM"). Never throws — unmapped roles fall back to a safe, truncated default.</summary>
    string GetRoleCode(UserRole role);
}
