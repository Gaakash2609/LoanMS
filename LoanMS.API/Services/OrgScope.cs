using LoanMS.Infrastructure.Data;

namespace LoanMS.API.Services;

/// <summary>
/// Row scope for the Team / Users / Locations pages (master prompt Part 5):
/// the roles that configure the organisation (Admin, ProductTeam) read all of
/// it; a supervising role reads only its own slice. Uses the same links as
/// LoanRepository.ApplyVisibilityScope — UserLocations for Location mapping,
/// Team.TeamLeadUserId / active TeamMember rows for team membership.
/// </summary>
public static class OrgScope
{
    public static bool Is(string? role, string name) =>
        string.Equals(role, name, StringComparison.OrdinalIgnoreCase);

    /// <summary>Admin and ProductTeam manage Users, Teams and Locations org-wide.</summary>
    public static bool IsOrgWide(string? role) => Is(role, "Admin") || Is(role, "ProductTeam");

    /// <summary>Locations mapped to the user.</summary>
    public static IQueryable<int> LocationIdsOf(AppDbContext db, int userId) =>
        db.UserLocations.Where(ul => ul.UserId == userId && !ul.IsDeleted).Select(ul => ul.LocationId);

    /// <summary>Teams the user leads or is an active member of.</summary>
    public static IQueryable<int> TeamIdsOf(AppDbContext db, int userId) =>
        db.Teams.Where(t => t.TeamLeadUserId == userId ||
                            db.TeamMembers.Any(m => m.TeamId == t.Id && m.UserId == userId && !m.IsDeleted))
            .Select(t => t.Id);

    /// <summary>Users mapped to any of the given user's Locations (UserLocations or primary Location).</summary>
    public static IQueryable<int> UserIdsInLocationsOf(AppDbContext db, int userId)
    {
        var mine = LocationIdsOf(db, userId);
        return db.Users.Where(u =>
                (u.LocationId != null && mine.Contains(u.LocationId.Value)) ||
                db.UserLocations.Any(ul => ul.UserId == u.Id && !ul.IsDeleted && mine.Contains(ul.LocationId)))
            .Select(u => u.Id);
    }
}
