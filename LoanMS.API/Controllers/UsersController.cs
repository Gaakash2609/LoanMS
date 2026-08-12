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

    public UsersController(IUserService userService, AppDbContext db)
    {
        _userService = userService;
        _db = db;
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

        return CreatedAtAction(nameof(GetById), new { id = result.Data!.Id },
            string.IsNullOrEmpty(mappingNote) ? result : ApiResponseDto<UserDto>.Ok(result.Data, (result.Message ?? "User created.") + " " + mappingNote));
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
        if (!string.IsNullOrEmpty(mappingNote))
            return Ok(ApiResponseDto<UserDto>.Ok(result.Data, (result.Message ?? "User updated.") + " " + mappingNote));

        return ApiResult(result);
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
    private async Task<string> ApplyTeamMembershipAsync(int userId, string? newSalesTeam, string? newOpTeam, string? oldSalesTeam, string? oldOpTeam)
    {
        var notes = new List<string>();
        var salesNote = await ApplyOneTeamTypeAsync(userId, "Sales", newSalesTeam, oldSalesTeam);
        if (salesNote != null) notes.Add(salesNote);
        var opNote = await ApplyOneTeamTypeAsync(userId, "Login", newOpTeam, oldOpTeam);
        if (opNote != null) notes.Add(opNote);
        return string.Join(" ", notes);
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
