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
            IsActive     = true
        };

        await _uow.Users.AddAsync(user);
        await _uow.SaveChangesAsync();
        return ApiResponseDto<UserDto>.Ok(MapToDto(user), "User created successfully.");
    }

    public async Task<ApiResponseDto<UserDto>> UpdateAsync(int id, UpdateUserRequestDto request)
    {
        var user = await _uow.Users.GetByIdAsync(id);
        if (user == null) return ApiResponseDto<UserDto>.Fail("User not found.");

        user.FullName   = request.FullName.Trim();
        user.IsActive   = request.IsActive;
        user.Role       = request.Role;
        user.UpdatedAt  = DateTime.UtcNow;

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

    private static UserDto MapToDto(User u) => new()
    {
        Id        = u.Id,
        FullName  = u.FullName,
        Email     = u.Email,
        Role      = u.Role.ToString(),
        IsActive  = u.IsActive,
        CreatedAt = u.CreatedAt
    };
}
