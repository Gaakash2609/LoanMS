using System.Security.Cryptography;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.Infrastructure.Services;

public class EmployeeCodeGenerator : IEmployeeCodeGenerator
{
    private readonly AppDbContext _db;
    public EmployeeCodeGenerator(AppDbContext db) => _db = db;

    // Centralized role → 3-letter code mapping. Extend here (only) when a
    // new role is added — every other file that needs a role-code should
    // call GetRoleCode() rather than hardcoding its own map.
    private static readonly Dictionary<UserRole, string> RoleCodes = new()
    {
        [UserRole.Admin]            = "ADM",
        [UserRole.Manager]          = "MGR",
        [UserRole.Sales]            = "SAL",
        [UserRole.Dsa]              = "DSA",
        [UserRole.Partner]          = "PAR",
        [UserRole.LoginTeam]        = "LOG",
        [UserRole.TeamLeader]       = "TLD",
        [UserRole.Accounts]         = "ACC",
        [UserRole.LocationHead]     = "LOH",
        [UserRole.OperationManager] = "OPS",
        [UserRole.ProductTeam]      = "PRT",
    };

    public string GetRoleCode(UserRole role) =>
        RoleCodes.TryGetValue(role, out var code) ? code : role.ToString().ToUpperInvariant().PadRight(3, 'X')[..3];

    public async Task<string> GenerateAsync(UserRole role, string? locationName)
    {
        var roleCode = GetRoleCode(role);

        string locCode;
        if (string.IsNullOrWhiteSpace(locationName))
        {
            locCode = "HO";
        }
        else
        {
            var trimmed = locationName.Trim();
            var matched = await _db.Locations
                .Where(l => l.Name.ToLower() == trimmed.ToLower())
                .Select(l => l.Code)
                .FirstOrDefaultAsync();
            locCode = string.IsNullOrWhiteSpace(matched)
                ? "HO" // no Location match, or matched Location has no Code set yet
                : matched.Trim().ToUpperInvariant();
        }

        // Retry loop with a hard cap — a collision is possible (though
        // increasingly unlikely with each retry, given ~9000 possible
        // 4-digit values per role+location combination) but should never
        // be able to loop forever. The database's own UNIQUE constraint
        // (see the migration) is the final, authoritative protection
        // against a race between two concurrent requests both passing this
        // check for the same code at the same instant — this loop handles
        // the common case; the DB constraint handles the rare race.
        for (var attempt = 0; attempt < 30; attempt++)
        {
            var candidate = $"MH-{roleCode}-{locCode}-{RandomFourDigits()}";
            var exists = await _db.Users.IgnoreQueryFilters()
                .AnyAsync(u => u.EmployeeCode == candidate);
            if (!exists) return candidate;
        }

        // Exceptionally unlikely fallback — every attempt collided. Widen
        // rather than fail outright: an 8-digit tail practically
        // guarantees uniqueness even if this path is ever hit.
        return $"MH-{roleCode}-{locCode}-{RandomFourDigits()}{RandomFourDigits()}";
    }

    // Cryptographically secure, per the requirement — not a predictable
    // Random()/DateTime-seeded generator. RandomNumberGenerator.GetInt32
    // is the standard .NET API for this.
    private static string RandomFourDigits() =>
        RandomNumberGenerator.GetInt32(1000, 10000).ToString();
}
