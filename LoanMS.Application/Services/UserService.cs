using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;

namespace LoanMS.Application.Services;

public class UserService : IUserService
{
    private readonly IUnitOfWork _uow;
    private readonly IAuthService _auth;

    public UserService(IUnitOfWork uow, IAuthService auth)
    {
        _uow  = uow;
        _auth = auth;
    }

    public async Task<ApiResponseDto<UserDto>> GetByIdAsync(int id)
    {
        var user = await _uow.Users.GetByIdAsync(id);
        if (user == null) return ApiResponseDto<UserDto>.Fail("User not found.");
        return ApiResponseDto<UserDto>.Ok(MapToDto(user));
    }

    public async Task<ApiResponseDto<IEnumerable<UserDto>>> GetAllAsync()
    {
        var users = await _uow.Users.GetAllActiveUsersAsync();
        return ApiResponseDto<IEnumerable<UserDto>>.Ok(users.Select(MapToDto));
    }

    /// <summary>
    /// Phase 4 (Users Lookup) — backend-enforced role restriction, since the
    /// frontend cannot be trusted to filter this itself. Assumption (no
    /// existing rule was documented anywhere in the codebase for this
    /// endpoint — confirmed as a gap, defaulted per the project owner):
    ///   Admin/Manager -> full active-user list, unchanged from before.
    ///   Every other role -> only active Sales-role users (the lookup's
    ///     original documented use case — e.g. the wizard's Sales Person
    ///     dropdown — never required seeing Admin/Manager/Dsa/Partner names).
    /// </summary>
    private static readonly HashSet<string> _fullLookupRoles =
        new(StringComparer.OrdinalIgnoreCase) { "Admin", "Manager" };

    public async Task<ApiResponseDto<IEnumerable<UserLookupDto>>> GetLookupAsync(string callerRole)
    {
        var users = await _uow.Users.GetAllActiveUsersAsync();
        if (!_fullLookupRoles.Contains(callerRole ?? string.Empty))
            users = users.Where(u => u.Role == LoanMS.Domain.Enums.UserRole.Sales);

        return ApiResponseDto<IEnumerable<UserLookupDto>>.Ok(users.Select(u => new UserLookupDto
        {
            Id       = u.Id,
            FullName = u.FullName,
            Role     = u.Role.ToString()
        }));
    }

    public async Task<ApiResponseDto<UserDto>> CreateAsync(CreateUserRequestDto request)
    {
        if (await _uow.Users.EmailExistsAsync(request.Email))
            return ApiResponseDto<UserDto>.Fail("Email already in use.");

        var user = new User
        {
            FullName     = request.FullName.Trim(),
            Email        = request.Email.ToLower().Trim(),
            PasswordHash = _auth.HashPassword(request.Password),
            Role         = request.Role,
            IsActive     = true,
            PhoneNumber  = request.PhoneNumber?.Trim(),
            LocationName = request.LocationName?.Trim(),
            SalesTeam    = request.SalesTeam?.Trim(),
            OpTeam       = request.OpTeam?.Trim()
        };

        await _uow.Users.AddAsync(user);
        await _uow.SaveChangesAsync();
        return ApiResponseDto<UserDto>.Ok(MapToDto(user), "User created successfully.");
    }

    public async Task<ApiResponseDto<UserDto>> UpdateAsync(int id, UpdateUserRequestDto request)
    {
        var user = await _uow.Users.GetByIdAsync(id);
        if (user == null) return ApiResponseDto<UserDto>.Fail("User not found.");

        user.FullName     = request.FullName.Trim();
        user.IsActive     = request.IsActive;
        user.Role         = request.Role;
        user.PhoneNumber  = request.PhoneNumber?.Trim();
        user.LocationName = request.LocationName?.Trim();
        user.SalesTeam    = request.SalesTeam?.Trim();
        user.OpTeam       = request.OpTeam?.Trim();
        if (request.PhotoData != null) user.PhotoData = string.IsNullOrWhiteSpace(request.PhotoData) ? null : request.PhotoData;
        user.UpdatedAt    = DateTime.UtcNow;

        await _uow.Users.UpdateAsync(user);
        await _uow.SaveChangesAsync();
        return ApiResponseDto<UserDto>.Ok(MapToDto(user), "User updated.");
    }

    public async Task<ApiResponseDto<bool>> DeleteAsync(int id)
    {
        var user = await _uow.Users.GetByIdAsync(id);
        if (user == null) return ApiResponseDto<bool>.Fail("User not found.");

        await _uow.Users.DeleteAsync(id);
        await _uow.SaveChangesAsync();
        return ApiResponseDto<bool>.Ok(true, "User deleted.");
    }

    public async Task<ApiResponseDto<bool>> ChangePasswordAsync(int id, ChangePasswordRequestDto request)
    {
        var user = await _uow.Users.GetByIdAsync(id);
        if (user == null) return ApiResponseDto<bool>.Fail("User not found.");

        if (!_auth.VerifyPassword(request.CurrentPassword, user.PasswordHash))
            return ApiResponseDto<bool>.Fail("Current password is incorrect.");

        user.PasswordHash = _auth.HashPassword(request.NewPassword);
        user.UpdatedAt    = DateTime.UtcNow;

        await _uow.Users.UpdateAsync(user);
        await _uow.SaveChangesAsync();
        return ApiResponseDto<bool>.Ok(true, "Password changed.");
    }

    /// <summary>
    /// Admin-initiated password reset for a DIFFERENT user. No current
    /// password is required (the caller's own Admin authorization, enforced
    /// at the controller via [Authorize(Roles="Admin")], is what grants this).
    /// Never returns or logs the plaintext/hash; only a bool + message.
    /// </summary>
    public async Task<ApiResponseDto<bool>> AdminResetPasswordAsync(int targetUserId, AdminResetPasswordRequestDto request)
    {
        var user = await _uow.Users.GetByIdAsync(targetUserId);
        if (user == null) return ApiResponseDto<bool>.Fail("User not found.");

        user.PasswordHash = _auth.HashPassword(request.NewPassword);
        user.UpdatedAt    = DateTime.UtcNow;

        await _uow.Users.UpdateAsync(user);
        await _uow.SaveChangesAsync();
        return ApiResponseDto<bool>.Ok(true, "Password reset.");
    }

    /// <summary>
    /// Self-service profile update — the caller updates their OWN
    /// PhoneNumber/PhotoData. No Admin check here (unlike UpdateAsync):
    /// authorization is that `id` always comes from the caller's own JWT
    /// (CurrentUserId in the controller), never from the request body, so
    /// there's no way to target another user's record through this method.
    /// FullName/Role/IsActive are intentionally untouched — this is not a
    /// replacement for the Admin-only Update endpoint.
    /// </summary>
    public async Task<ApiResponseDto<UserDto>> UpdateProfileAsync(int id, UpdateProfileRequestDto request)
    {
        var user = await _uow.Users.GetByIdAsync(id);
        if (user == null) return ApiResponseDto<UserDto>.Fail("User not found.");

        user.PhoneNumber = string.IsNullOrWhiteSpace(request.PhoneNumber) ? null : request.PhoneNumber.Trim();
        user.PhotoData   = string.IsNullOrWhiteSpace(request.PhotoData) ? null : request.PhotoData;
        // Address/Bank fields: the frontend saves one section (address OR
        // bank OR primary) at a time — unlike PhoneNumber/PhotoData above,
        // these must be "only touch if this request actually included it",
        // not "always overwrite, blank clears", or saving one section would
        // silently wipe out whichever other section wasn't included in this
        // particular request.
        if (request.AddressLine1 != null) user.AddressLine1 = request.AddressLine1.Trim();
        if (request.AddressLine2 != null) user.AddressLine2 = request.AddressLine2.Trim();
        if (request.AddressCity != null) user.AddressCity = request.AddressCity.Trim();
        if (request.AddressState != null) user.AddressState = request.AddressState.Trim();
        if (request.AddressPostalCode != null) user.AddressPostalCode = request.AddressPostalCode.Trim();
        if (request.BankAccountHolderName != null) user.BankAccountHolderName = request.BankAccountHolderName.Trim();
        if (request.BankName != null) user.BankName = request.BankName.Trim();
        if (request.BankAccountType != null) user.BankAccountType = request.BankAccountType.Trim();
        if (request.BankAccountNumber != null) user.BankAccountNumber = request.BankAccountNumber.Trim();
        if (request.BankIfscCode != null) user.BankIfscCode = request.BankIfscCode.Trim().ToUpperInvariant();
        user.UpdatedAt   = DateTime.UtcNow;

        await _uow.Users.UpdateAsync(user);
        await _uow.SaveChangesAsync();
        return ApiResponseDto<UserDto>.Ok(MapToDto(user), "Profile updated.");
    }

    private static UserDto MapToDto(User u) => new()
    {
        Id           = u.Id,
        FullName     = u.FullName,
        Email        = u.Email,
        Role         = u.Role.ToString(),
        IsActive     = u.IsActive,
        CreatedAt    = u.CreatedAt,
        PhoneNumber  = u.PhoneNumber,
        LocationName = u.LocationName,
        SalesTeam    = u.SalesTeam,
        OpTeam       = u.OpTeam,
        PhotoData    = u.PhotoData,
        AddressLine1 = u.AddressLine1,
        AddressLine2 = u.AddressLine2,
        AddressCity  = u.AddressCity,
        AddressState = u.AddressState,
        AddressPostalCode = u.AddressPostalCode,
        BankAccountHolderName = u.BankAccountHolderName,
        BankName = u.BankName,
        BankAccountType = u.BankAccountType,
        BankAccountNumber = u.BankAccountNumber,
        BankIfscCode = u.BankIfscCode
    };
}
