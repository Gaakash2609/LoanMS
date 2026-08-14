using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

[Authorize]
public class UsersController : BaseController
{
    private readonly IUserService _userService;
    // Direct AppDbContext access for the TeamMember auto-mapping below —
    // same pattern already used by DashboardController/LenderConfigController/
    // SearchController for cross-entity work that doesn't belong inside one
    // repository. IUserService/IUnitOfWork deliberately don't expose
    // Teams/TeamMembers (Application layer can't reference Infrastructure's
    // AppDbContext — see IUnitOfWork), so this stays at the controller level
    // rather than growing IUnitOfWork just for this one feature.
    private readonly AppDbContext _db;
    private readonly IEmailService _emailService;

    public UsersController(IUserService userService, AppDbContext db, IEmailService emailService)
    {
        _userService = userService;
        _db = db;
        _emailService = emailService;
    }

    /// <summary>Get all users [Admin only]</summary>
    [HttpGet]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> GetAll()
    {
        var result = await _userService.GetAllAsync();
        return ApiResult(result);
    }

    /// <summary>Get minimal active-user list (id, name, role) for dropdowns like the wizard's
    /// Sales Person selector. Available to any authenticated role — does not expose email,
    /// active status, or other Admin user-management fields. Phase 4: which USERS appear is
    /// now also role-scoped server-side (see IUserService.GetLookupAsync) — Admin/Manager get
    /// the full active-user list, every other role only sees active Sales-role users.</summary>
    [HttpGet("lookup")]
    public async Task<IActionResult> GetLookup()
    {
        var result = await _userService.GetLookupAsync(CurrentUserRole);
        return ApiResult(result);
    }

    /// <summary>Get user by ID [Admin only]</summary>
    [HttpGet("{id:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> GetById(int id)
    {
        var result = await _userService.GetByIdAsync(id);
        if (!result.Success) return NotFound(result);
        return Ok(result);
    }

    /// <summary>
    /// Returns this user's FULL set of assigned Locations, Sales Teams, and
    /// Operation Teams — the many-to-many data GetById's UserDto doesn't
    /// carry (UserService/IUnitOfWork doesn't expose UserLocations/
    /// TeamMembers, same reasoning as ApplyTeamMembershipAsync above), so
    /// the multi-select edit UI has what it needs to correctly populate
    /// every previously-saved chip, not just a single value.
    /// </summary>
    [HttpGet("{id:int}/locations-and-teams")]
    [Authorize(Roles = "Admin,ProductTeam")]
    public async Task<IActionResult> GetLocationsAndTeams(int id)
    {
        var locations = await _db.UserLocations
            .Where(ul => ul.UserId == id && !ul.IsDeleted)
            .Select(ul => new { ul.LocationId, Name = ul.Location.Name })
            .ToListAsync();
        var salesTeams = await _db.TeamMembers
            .Where(m => m.UserId == id && !m.IsDeleted && m.Team.Type == "Sales")
            .Select(m => new { TeamId = m.TeamId, Name = m.Team.Name })
            .ToListAsync();
        var opTeams = await _db.TeamMembers
            .Where(m => m.UserId == id && !m.IsDeleted && m.Team.Type == "Login")
            .Select(m => new { TeamId = m.TeamId, Name = m.Team.Name })
            .ToListAsync();

        return Ok(ApiResponseDto<object>.Ok(new { locations, salesTeams, opTeams }));
    }

    /// <summary>Get current user profile</summary>
    [HttpGet("profile")]
    public async Task<IActionResult> GetProfile()
    {
        var result = await _userService.GetByIdAsync(CurrentUserId);
        if (!result.Success) return NotFound(result);
        return Ok(result);
    }

    /// <summary>Update current user's own profile (PhoneNumber/PhotoData only).
    /// Self-service — no Admin role required, since `id` always comes from
    /// the caller's own JWT via CurrentUserId, never from the request body.
    /// Does not touch FullName/Role/IsActive; use the Admin-only PUT /{id}
    /// endpoint above for those.</summary>
    [HttpPut("profile")]
    public async Task<IActionResult> UpdateProfile([FromBody] UpdateProfileRequestDto request)
    {
        if (!ModelState.IsValid)
            return BadRequest(ApiResponseDto<UserDto>.Fail(
                ModelState.Values.SelectMany(v => v.Errors.Select(e => e.ErrorMessage)).ToList()));

        var result = await _userService.UpdateProfileAsync(CurrentUserId, request);
        return ApiResult(result);
    }

    /// <summary>Create new user [Admin only]</summary>
    [HttpPost]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Create([FromBody] CreateUserRequestDto request)
    {
        if (!ModelState.IsValid)
            return BadRequest(ApiResponseDto<UserDto>.Fail(
                ModelState.Values.SelectMany(v => v.Errors.Select(e => e.ErrorMessage)).ToList()));

        var result = await _userService.CreateAsync(request);
        if (!result.Success) return BadRequest(result);

        // Auto-map Sales/Login team membership (User Creation + Mapping
        // simplification — analysis approved). A brand-new user has no
        // previous team, so this is purely additive: if SalesTeam/OpTeam
        // was selected in the Create User form, the corresponding
        // TeamMember row is created here in the same request, using the
        // exact same add-if-not-already-a-member pattern as
        // TeamsController.AddMember — no new membership architecture.
        // Non-fatal by design: the user is already successfully created at
        // this point, so a team-mapping issue (e.g. team renamed/deleted in
        // the instant between the dropdown loading and this save) doesn't
        // roll back a perfectly valid user — it's surfaced in the response
        // message instead, and the existing manual Teams → Add Member flow
        // remains available to complete it.
        var mappingNote = await ApplyTeamMembershipAsync(result.Data!.Id, request.SalesTeam, request.OpTeam, null, null);

        // Users(role=Dsa/Partner) ↔ Partner Management linkage (confirmed
        // real gap — a user created here with role Dsa/Partner is a login
        // account only; it never showed up on the DSA/Partner Management
        // pages because those read from the separate DsaPartner table).
        // Non-fatal by design, same reasoning as team-mapping/invitation-
        // email above — a DsaPartner sync issue must never roll back an
        // otherwise-successful user creation.
        try
        {
            await SyncLinkedDsaPartnerAsync(result.Data!.Id, request.Role, result.Data!.FullName,
                result.Data!.Email, request.PhoneNumber);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[DsaPartner Sync] failed for user {result.Data!.Id}: {ex.Message}");
        }

        // BUGFIX (confirmed real gap — "Invitation emails not being sent"):
        // the "User Invitation" template existed and was fully editable in
        // Settings, but nothing on the backend ever actually called
        // IEmailService when a user was created — this is the missing
        // trigger. Non-fatal by design, same reasoning as the team-mapping
        // call just above: a failed/unconfigured email must never roll
        // back an otherwise-successful user creation.
        try
        {
            await SendInvitationEmailAsync(result.Data!, request.Password);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[Invitation Email] failed for user {result.Data!.Id}: {ex.Message}");
        }

        return CreatedAtAction(nameof(GetById), new { id = result.Data!.Id },
            string.IsNullOrEmpty(mappingNote) ? result : ApiResponseDto<UserDto>.Ok(result.Data, (result.Message ?? "User created.") + " " + mappingNote));
    }

    /// <summary>
    /// Loads the "invitation" template override from the database (Settings
    /// → All Email Templates → User Invitation), falling back to a built-in
    /// default if the Admin never customized it — the frontend's own
    /// default text isn't available to this server-side trigger, so this
    /// is a separate, backend-only fallback covering the same
    /// {{name}} {{email}} {{password}} {{uid}} {{role}} {{signature}}
    /// variables the frontend template editor documents.
    /// </summary>
    private async Task SendInvitationEmailAsync(UserDto user, string plainPassword)
    {
        var tpl = await _db.EmailTemplates.FirstOrDefaultAsync(t => t.TemplateKey == "invitation" && !t.IsDeleted);
        var subject = tpl?.Subject ?? "Welcome to LoanMS — Your Account Details";
        var body = tpl?.Body ?? """
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
              <h2 style="color:#0a589a">Welcome, {{name}}!</h2>
              <p>An account has been created for you on LoanMS.</p>
              <table style="border-collapse:collapse;margin:16px 0">
                <tr><td style="padding:4px 12px 4px 0;color:#6b7280">User ID</td><td><strong>{{uid}}</strong></td></tr>
                <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Email</td><td><strong>{{email}}</strong></td></tr>
                <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Temporary Password</td><td><strong>{{password}}</strong></td></tr>
                <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Role</td><td><strong>{{role}}</strong></td></tr>
              </table>
              <p style="color:#6b7280;font-size:13px">Please log in and change your password as soon as possible.</p>
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
              <p style="color:#9ca3af;font-size:12px">{{signature}}</p>
            </div>
            """;

        var vars = new Dictionary<string, string>
        {
            ["{{name}}"] = user.FullName ?? "",
            ["{{email}}"] = user.Email ?? "",
            ["{{password}}"] = plainPassword ?? "",
            ["{{uid}}"] = "USR-" + user.Id.ToString("D4"),
            ["{{role}}"] = user.Role ?? "",
            ["{{signature}}"] = "LoanMS Team"
        };
        foreach (var kv in vars) { subject = subject.Replace(kv.Key, kv.Value); body = body.Replace(kv.Key, kv.Value); }

        await _emailService.SendAsync(user.Email ?? "", user.FullName ?? "", subject, body);
    }

    /// <summary>Update user [Admin only]</summary>
    [HttpPut("{id:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateUserRequestDto request)
    {
        if (!ModelState.IsValid)
            return BadRequest(ApiResponseDto<UserDto>.Fail(
                ModelState.Values.SelectMany(v => v.Errors.Select(e => e.ErrorMessage)).ToList()));

        // Capture the CURRENT SalesTeam/OpTeam before the service call
        // overwrites them — needed to correctly diff old→new (remove the
        // stale membership, add the new one, no duplicates) rather than
        // blindly re-adding on every save. Read-only, no side effects.
        var existingUser = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id);
        var oldSalesTeam = existingUser?.SalesTeam;
        var oldOpTeam    = existingUser?.OpTeam;

        var result = await _userService.UpdateAsync(id, request);
        if (!result.Success) return ApiResult(result);

        var mappingNote = await ApplyTeamMembershipAsync(id, request.SalesTeam, request.OpTeam, oldSalesTeam, oldOpTeam);

        // Same Users ↔ Partner Management linkage as Create() above — also
        // needed here so that editing an existing user's role TO Dsa/Partner
        // (not just creating one that way) gets a DsaPartner record too, and
        // so a name/phone edit on an already-linked Dsa/Partner user stays
        // in sync on the Management page instead of drifting apart. Non-fatal,
        // same reasoning as Create().
        try
        {
            await SyncLinkedDsaPartnerAsync(id, request.Role, request.FullName,
                existingUser?.Email, request.PhoneNumber);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[DsaPartner Sync] failed for user {id}: {ex.Message}");
        }

        if (!string.IsNullOrEmpty(mappingNote))
            return Ok(ApiResponseDto<UserDto>.Ok(result.Data, (result.Message ?? "User updated.") + " " + mappingNote));

        return ApiResult(result);
    }

    /// <summary>
    /// Users(role=Dsa/Partner) ↔ Partner Management linkage. A user created
    /// or edited on this page with role Dsa/Partner is only ever a login
    /// account (Users table) — the DSA/Partner Management pages read from
    /// the separate DsaPartner table (see DsaController), and nothing
    /// previously bridged the two, so such a user never appeared there.
    /// DsaPartner.LinkedUserId already existed for exactly this purpose but
    /// was unused. Only fires for role Dsa/Partner — every other role is
    /// untouched, and switching a linked user's role AWAY from Dsa/Partner
    /// deliberately leaves the existing DsaPartner record alone (it may
    /// carry business data — commission history, DSA mapping — that
    /// shouldn't vanish just because the login role changed).
    /// </summary>
    private async Task SyncLinkedDsaPartnerAsync(int userId, LoanMS.Domain.Enums.UserRole role, string fullName, string? email, string? phone)
    {
        if (role != LoanMS.Domain.Enums.UserRole.Dsa && role != LoanMS.Domain.Enums.UserRole.Partner)
            return;

        var partnerType = role == LoanMS.Domain.Enums.UserRole.Dsa
            ? LoanMS.Domain.Enums.PartnerType.Dsa
            : LoanMS.Domain.Enums.PartnerType.Partner;

        var linked = await _db.DsaPartners.FirstOrDefaultAsync(d => d.LinkedUserId == userId);
        if (linked == null)
        {
            // "DSA-"/"PAR-" + userId — well under DsaPartner.Code's 20-char
            // limit (HasMaxLength(20), see AppDbContext), and unique because
            // userId is unique and each user links to at most one DsaPartner.
            var prefix = partnerType == LoanMS.Domain.Enums.PartnerType.Dsa ? "DSA-" : "PAR-";
            _db.DsaPartners.Add(new DsaPartner
            {
                Name = fullName, Code = prefix + userId, Email = email, Phone = phone,
                PartnerType = partnerType, LinkedUserId = userId, IsActive = true,
                CreatedAt = DateTime.UtcNow
            });
        }
        else
        {
            // Already linked — keep the record's display name/contact info
            // in sync with the user account (e.g. edited via Users page),
            // but never touch PartnerType/Code/DSA-mapping/business fields
            // that only the Partner Management page's own Edit form owns.
            linked.Name = fullName;
            linked.Email = email;
            linked.Phone = phone;
            linked.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();
    }

    /// <summary>
    /// Set another user's profile photo [Admin only]. Dedicated, minimal
    /// endpoint rather than reusing Update() above — Update()'s
    /// UpdateUserRequestDto requires FullName/Role/IsActive, and an Admin
    /// invitation-flow caller only ever has this one field to set safely,
    /// with no reliable local source for the others (frontend display-label
    /// vs backend enum mismatch risk for Role specifically). Touches only
    /// PhotoData, nothing else.
    /// </summary>
    [HttpPatch("{id:int}/photo")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> SetPhoto(int id, [FromBody] SetUserPhotoRequestDto request)
    {
        var user = await _db.Users.FindAsync(id);
        if (user == null) return NotFound(ApiResponseDto<bool>.Fail("User not found."));
        user.PhotoData = string.IsNullOrWhiteSpace(request.PhotoData) ? null : request.PhotoData;
        user.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Photo updated."));
    }

    /// <summary>
    /// Activate/Deactivate a user [Admin only]. Same reasoning as SetPhoto
    /// above — dedicated, minimal endpoint rather than reusing Update(),
    /// which requires FullName/Role and carries the same frontend
    /// display-label vs backend-enum Role risk. Touches only IsActive.
    /// A deactivated user's IsActive being local-only (confirmed real gap)
    /// meant they could still log in — this was a genuine security gap,
    /// not just a display inconsistency.
    /// </summary>
    [HttpPatch("{id:int}/status")]
    [Authorize(Roles = "Admin,ProductTeam")]
    public async Task<IActionResult> SetStatus(int id, [FromBody] SetUserStatusRequestDto request)
    {
        var user = await _db.Users.FindAsync(id);
        if (user == null) return NotFound(ApiResponseDto<bool>.Fail("User not found."));
        user.IsActive = request.IsActive;
        user.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Status updated."));
    }

    /// <summary>
    /// User Creation + Mapping simplification (analysis approved — see
    /// prior forensic report). Reconciles ONE team-type (Sales or Login)
    /// between an old and new team NAME (User.SalesTeam/OpTeam are already
    /// stored as team names, matching what the Create/Edit User dropdowns
    /// send — see CreateUserRequestDto). Only ever touches the ONE
    /// membership this specific field tracked previously — any OTHER
    /// membership a user has (added manually via Teams → Add Member, for a
    /// team unrelated to this field) is never read or modified here, so
    /// existing manual mappings are never silently altered.
    /// Returns a short user-facing note only when something couldn't be
    /// auto-applied (team not found) — empty string on full success, so
    /// callers can silently append it to their own success message.
    /// </summary>
    /// <summary>
    /// Sync a user's FULL set of assigned Locations (whole-replace — same
    /// convention as LoansController's bank-lines/references endpoints):
    /// removes memberships no longer in the list, adds newly-selected
    /// ones, leaves unchanged ones untouched. Confirmed real gap: no
    /// endpoint previously let a user be assigned to more than one
    /// Location at all (User.LocationId is a single FK) — this is the new
    /// source of truth via the UserLocations many-to-many table.
    /// </summary>
    [HttpPut("{id:int}/locations")]
    [Authorize(Roles = "Admin,ProductTeam")]
    public async Task<IActionResult> SetLocations(int id, [FromBody] List<int> locationIds)
    {
        var user = await _db.Users.FindAsync(id);
        if (user == null) return NotFound(ApiResponseDto<bool>.Fail("User not found."));

        locationIds = (locationIds ?? new List<int>()).Distinct().ToList();
        var existing = await _db.UserLocations.Where(ul => ul.UserId == id && !ul.IsDeleted).ToListAsync();

        foreach (var row in existing.Where(row => !locationIds.Contains(row.LocationId)))
        {
            row.IsDeleted = true; row.UpdatedAt = DateTime.UtcNow;
        }
        var existingLocationIds = existing.Select(row => row.LocationId).ToHashSet();
        foreach (var locId in locationIds.Where(locId => !existingLocationIds.Contains(locId)))
        {
            _db.UserLocations.Add(new UserLocation { UserId = id, LocationId = locId, CreatedAt = DateTime.UtcNow });
        }

        // Keep User.LocationId (the single "primary" Location every
        // existing single-location read-path still uses) pointed at one of
        // the assigned Locations — first in the list — rather than leaving
        // it stale/pointing at a Location this user is no longer assigned
        // to at all.
        user.LocationId = locationIds.FirstOrDefault() is var first && first != 0 ? first : (int?)null;
        user.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Locations updated."));
    }

    /// <summary>
    /// Sync a user's FULL set of Sales/Operation Team memberships (whole-
    /// replace, same convention as SetLocations above). Reuses the
    /// existing TeamMember table (already correctly many-to-many — this
    /// was previously only ever driven by the single-team-name fields on
    /// Create/Update, via ApplyOneTeamTypeAsync below).
    /// </summary>
    private async Task<string> ApplyTeamMembershipAsync(int userId, string? newSalesTeam, string? newOpTeam, string? oldSalesTeam, string? oldOpTeam)
    {
        var notes = new List<string>();
        var salesNote = await ApplyOneTeamTypeAsync(userId, "Sales", newSalesTeam, oldSalesTeam);
        if (salesNote != null) notes.Add(salesNote);
        var opNote = await ApplyOneTeamTypeAsync(userId, "Login", newOpTeam, oldOpTeam);
        if (opNote != null) notes.Add(opNote);
        return string.Join(" ", notes);
    }

    public class SetTeamsRequestDto
    {
        public List<int> SalesTeamIds { get; set; } = new();
        public List<int> OperationTeamIds { get; set; } = new();
    }

    [HttpPut("{id:int}/teams")]
    [Authorize(Roles = "Admin,ProductTeam")]
    public async Task<IActionResult> SetTeams(int id, [FromBody] SetTeamsRequestDto request)
    {
        var user = await _db.Users.FindAsync(id);
        if (user == null) return NotFound(ApiResponseDto<bool>.Fail("User not found."));

        await SyncTeamMembershipsAsync(id, "Sales", request.SalesTeamIds ?? new List<int>());
        await SyncTeamMembershipsAsync(id, "Login", request.OperationTeamIds ?? new List<int>());

        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Teams updated."));
    }

    private async Task SyncTeamMembershipsAsync(int userId, string teamType, List<int> teamIds)
    {
        teamIds = teamIds.Distinct().ToList();
        var existing = await _db.TeamMembers
            .Where(m => m.UserId == userId && !m.IsDeleted && m.Team.Type == teamType)
            .ToListAsync();

        foreach (var row in existing.Where(row => !teamIds.Contains(row.TeamId)))
        {
            row.IsDeleted = true; row.UpdatedAt = DateTime.UtcNow;
        }
        var existingTeamIds = existing.Select(row => row.TeamId).ToHashSet();
        foreach (var teamId in teamIds.Where(teamId => !existingTeamIds.Contains(teamId)))
        {
            _db.TeamMembers.Add(new TeamMember { TeamId = teamId, UserId = userId, CreatedAt = DateTime.UtcNow });
        }
    }

    private async Task<string?> ApplyOneTeamTypeAsync(int userId, string teamType, string? newTeamName, string? oldTeamName)
    {
        newTeamName = string.IsNullOrWhiteSpace(newTeamName) ? null : newTeamName.Trim();
        oldTeamName = string.IsNullOrWhiteSpace(oldTeamName) ? null : oldTeamName.Trim();
        if (string.Equals(newTeamName, oldTeamName, StringComparison.OrdinalIgnoreCase))
            return null; // No change for this team type — nothing to do (also covers "still no team selected").

        try
        {
            // Remove the previous membership this field tracked, if any —
            // same soft-delete convention as TeamsController.RemoveMember.
            if (oldTeamName != null)
            {
                var oldTeam = await _db.Teams.FirstOrDefaultAsync(t => t.Type == teamType && t.Name == oldTeamName && !t.IsDeleted);
                if (oldTeam != null)
                {
                    var oldMember = await _db.TeamMembers.FirstOrDefaultAsync(m => m.TeamId == oldTeam.Id && m.UserId == userId && !m.IsDeleted);
                    if (oldMember != null) { oldMember.IsDeleted = true; oldMember.UpdatedAt = DateTime.UtcNow; }
                }
            }

            // Add the newly-selected team's membership, same add-if-not-
            // already-present convention as TeamsController.AddMember.
            if (newTeamName != null)
            {
                var newTeam = await _db.Teams.FirstOrDefaultAsync(t => t.Type == teamType && t.Name == newTeamName && !t.IsDeleted);
                if (newTeam == null)
                    return $"({teamType} team \"{newTeamName}\" not found — assign it manually from the Teams page.)";

                var already = await _db.TeamMembers.AnyAsync(m => m.TeamId == newTeam.Id && m.UserId == userId && !m.IsDeleted);
                if (!already)
                    _db.TeamMembers.Add(new TeamMember { TeamId = newTeam.Id, UserId = userId, CreatedAt = DateTime.UtcNow });
            }

            await _db.SaveChangesAsync();
            return null;
        }
        catch (Exception)
        {
            // Non-fatal by design (see ApplyTeamMembershipAsync's doc
            // comment) — the user record itself is already safely saved;
            // surface this as a note rather than failing the whole request.
            return $"({teamType} team mapping could not be completed automatically — assign it manually from the Teams page.)";
        }
    }

    /// <summary>Delete user [Admin only]</summary>
    [HttpDelete("{id:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Delete(int id)
    {
        if (id == CurrentUserId)
            return BadRequest(ApiResponseDto<bool>.Fail("Cannot delete your own account."));

        var result = await _userService.DeleteAsync(id);
        return ApiResult(result);
    }

    /// <summary>Change password (own account)</summary>
    [HttpPost("change-password")]
    public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequestDto request)
    {
        if (!ModelState.IsValid)
            return BadRequest(ApiResponseDto<bool>.Fail(
                ModelState.Values.SelectMany(v => v.Errors.Select(e => e.ErrorMessage)).ToList()));

        var result = await _userService.ChangePasswordAsync(CurrentUserId, request);
        return ApiResult(result);
    }

    /// <summary>Admin resets another user's password [Admin only]. No current
    /// password is required from the target user — Admin authorization is
    /// enforced by the role check below, matching Create/Update/Delete on
    /// this controller.</summary>
    [HttpPost("{id:int}/reset-password")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> AdminResetPassword(int id, [FromBody] AdminResetPasswordRequestDto request)
    {
        if (!ModelState.IsValid)
            return BadRequest(ApiResponseDto<bool>.Fail(
                ModelState.Values.SelectMany(v => v.Errors.Select(e => e.ErrorMessage)).ToList()));

        var result = await _userService.AdminResetPasswordAsync(id, request);
        return ApiResult(result);
    }
}
