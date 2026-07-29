using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using BCrypt.Net;
using Microsoft.Extensions.Configuration;

namespace LoanMS.Application.Services;

public class AuthService : IAuthService
{
    private readonly IUnitOfWork _uow;
    private readonly IJwtService _jwt;
    private readonly IConfiguration _cfg;

    public AuthService(IUnitOfWork uow, IJwtService jwt, IConfiguration cfg)
    {
        _uow = uow;
        _jwt = jwt;
        _cfg = cfg;
    }

    // Read expiry values from configuration — never hardcode
    private int AccessTokenMinutes  => int.TryParse(_cfg["Jwt:ExpiryMinutes"],     out var m) ? m : 20;
    private int RefreshTokenDays    => int.TryParse(_cfg["Jwt:RefreshExpiryDays"], out var d) ? d : 1;

    public async Task<ApiResponseDto<LoginResponseDto>> LoginAsync(LoginRequestDto request)
    {
        var user = await _uow.Users.GetByEmailAsync(request.Email.ToLower().Trim());
        if (user == null || !user.IsActive)
            return ApiResponseDto<LoginResponseDto>.Fail("Invalid email or password.");

        if (!VerifyPassword(request.Password, user.PasswordHash))
            return ApiResponseDto<LoginResponseDto>.Fail("Invalid email or password.");

        var accessToken  = _jwt.GenerateAccessToken(user);
        var refreshToken = _jwt.GenerateRefreshToken();

        user.RefreshToken       = refreshToken;
        user.RefreshTokenExpiry = DateTime.UtcNow.AddDays(RefreshTokenDays);
        await _uow.Users.UpdateAsync(user);
        await _uow.SaveChangesAsync();

        return ApiResponseDto<LoginResponseDto>.Ok(new LoginResponseDto
        {
            AccessToken  = accessToken,
            RefreshToken = refreshToken,
            ExpiresAt    = DateTime.UtcNow.AddMinutes(AccessTokenMinutes),
            User = new UserDto
            {
                Id        = user.Id,
                FullName  = user.FullName,
                Email     = user.Email,
                Role      = user.Role.ToString(),
                IsActive  = user.IsActive,
                CreatedAt = user.CreatedAt
            }
        }, "Login successful.");
    }

    public async Task<ApiResponseDto<LoginResponseDto>> RefreshTokenAsync(string refreshToken)
    {
        var user = await _uow.Users.GetByRefreshTokenAsync(refreshToken);
        if (user == null || user.RefreshTokenExpiry < DateTime.UtcNow)
            return ApiResponseDto<LoginResponseDto>.Fail("Invalid or expired refresh token.");

        var newAccess  = _jwt.GenerateAccessToken(user);
        var newRefresh = _jwt.GenerateRefreshToken();

        user.RefreshToken       = newRefresh;
        user.RefreshTokenExpiry = DateTime.UtcNow.AddDays(RefreshTokenDays);
        await _uow.Users.UpdateAsync(user);
        await _uow.SaveChangesAsync();

        return ApiResponseDto<LoginResponseDto>.Ok(new LoginResponseDto
        {
            AccessToken  = newAccess,
            RefreshToken = newRefresh,
            ExpiresAt    = DateTime.UtcNow.AddMinutes(AccessTokenMinutes),
            User = new UserDto
            {
                Id        = user.Id,
                FullName  = user.FullName,
                Email     = user.Email,
                Role      = user.Role.ToString(),
                IsActive  = user.IsActive,
                CreatedAt = user.CreatedAt
            }
        });
    }

    public async Task<ApiResponseDto<bool>> LogoutAsync(int userId)
    {
        var user = await _uow.Users.GetByIdAsync(userId);
        if (user == null) return ApiResponseDto<bool>.Fail("User not found.");

        user.RefreshToken       = null;
        user.RefreshTokenExpiry = null;
        await _uow.Users.UpdateAsync(user);
        await _uow.SaveChangesAsync();

        return ApiResponseDto<bool>.Ok(true, "Logged out successfully.");
    }

    public string HashPassword(string password) =>
        BCrypt.Net.BCrypt.HashPassword(password, workFactor: 12);

    public bool VerifyPassword(string password, string hash)
    {
        // Try standard verify first ($2a$/$2b$/$2y$ hashes — this covers every
        // hash this app actually issues, since HashPassword() above always uses
        // BCrypt.HashPassword). EnhancedVerify is only a fallback for a
        // different (SHA-384 pre-hashed) scheme this app never generates.
        //
        // IMPORTANT: only fall through to EnhancedVerify when Verify() *throws*
        // (i.e. the hash format itself wasn't understood) — not merely when it
        // returns false for a wrong password. Previously both calls ran on every
        // wrong-password attempt, silently doubling the (already CPU-heavy,
        // workFactor=12) bcrypt cost and pushing /api/auth/login well past the
        // 1000ms "slow request" threshold (the WRN log lines). A wrong password
        // now costs one bcrypt round instead of two.
        try
        {
            return BCrypt.Net.BCrypt.Verify(password, hash);
        }
        catch
        {
            try { return BCrypt.Net.BCrypt.EnhancedVerify(password, hash); }
            catch { return false; }
        }
    }
}
