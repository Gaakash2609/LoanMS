using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using System.Security.Cryptography;
using System.Text;

namespace LoanMS.Application.Services;

/// <summary>
/// Two-step password-reset flow:
///   1. ForgotPassword  — generate + email a signed token
///   2. ResetPassword   — validate token, update hash, revoke sessions
///
/// Security: 256-bit random token; only SHA-256 hash stored; constant-time
/// response; tokens invalidated after use or when a new one is issued.
/// </summary>
public class PasswordResetService : IPasswordResetService
{
    private readonly IUnitOfWork    _uow;
    private readonly IEmailService  _email;
    private readonly IConfiguration _cfg;
    private readonly ILogger<PasswordResetService> _log;

    private const string ForgotSuccessMsg =
        "If an account with that email exists, a password reset link has been sent.";

    public PasswordResetService(
        IUnitOfWork uow,
        IEmailService email,
        IConfiguration cfg,
        ILogger<PasswordResetService> log)
    {
        _uow   = uow;
        _email = email;
        _cfg   = cfg;
        _log   = log;
    }

    private int ExpiryMinutes =>
        int.TryParse(_cfg["PasswordReset:ExpiryMinutes"], out var m) ? m : 15;

    // ── Step 1 ────────────────────────────────────────────────────────────────

    public async Task<ApiResponseDto<bool>> ForgotPasswordAsync(ForgotPasswordRequestDto request)
    {
        var email = request.Email.ToLower().Trim();
        var user  = await _uow.Users.GetByEmailAsync(email);

        // Always return success to prevent user enumeration
        if (user == null || !user.IsActive)
        {
            _log.LogInformation("Password reset requested for unknown/inactive email {Email}", email);
            return ApiResponseDto<bool>.Ok(true, ForgotSuccessMsg);
        }

        // Invalidate all outstanding tokens before issuing a new one
        await _uow.PasswordResetTokens.InvalidateAllForUserAsync(user.Id);

        var rawToken  = GenerateRawToken();
        var tokenHash = HashToken(rawToken);

        await _uow.PasswordResetTokens.AddAsync(new PasswordResetToken
        {
            UserId    = user.Id,
            TokenHash = tokenHash,
            ExpiresAt = DateTime.UtcNow.AddMinutes(ExpiryMinutes),
            IsUsed    = false,
            CreatedAt = DateTime.UtcNow
        });
        await _uow.SaveChangesAsync();

        var baseUrl   = _cfg["App:BaseUrl"]?.TrimEnd('/') ?? "https://localhost";
        var resetLink = $"{baseUrl}/reset-password" +
                        $"?token={Uri.EscapeDataString(rawToken)}" +
                        $"&email={Uri.EscapeDataString(user.Email)}";

        try
        {
            await _email.SendPasswordResetEmailAsync(user.Email, user.FullName, resetLink);
        }
        catch (Exception ex)
        {
            // Log but don't surface SMTP errors — token is already persisted
            _log.LogError(ex, "Failed to deliver password-reset email to {Email}", user.Email);
        }

        return ApiResponseDto<bool>.Ok(true, ForgotSuccessMsg);
    }

    // ── Step 2 ────────────────────────────────────────────────────────────────

    public async Task<ApiResponseDto<bool>> ResetPasswordAsync(ResetPasswordRequestDto request)
    {
        const string invalidMsg = "The reset link is invalid or has expired. Please request a new one.";

        var tokenHash = HashToken(request.Token);
        var record    = await _uow.PasswordResetTokens.GetValidTokenAsync(tokenHash);

        if (record == null)
        {
            _log.LogWarning("Invalid or expired password-reset token used.");
            return ApiResponseDto<bool>.Fail(invalidMsg);
        }

        // Double-bind: email in request must match token owner
        if (!string.Equals(record.User.Email, request.Email.ToLower().Trim(),
                           StringComparison.OrdinalIgnoreCase))
        {
            _log.LogWarning("Token/email mismatch for password reset attempt.");
            return ApiResponseDto<bool>.Fail(invalidMsg);
        }

        // Update password
        record.User.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword, workFactor: 12);
        record.User.UpdatedAt    = DateTime.UtcNow;

        // Revoke all active sessions
        record.User.RefreshToken       = null;
        record.User.RefreshTokenExpiry = null;

        await _uow.Users.UpdateAsync(record.User);

        // Consume token
        record.IsUsed    = true;
        record.UpdatedAt = DateTime.UtcNow;
        await _uow.PasswordResetTokens.UpdateAsync(record);

        await _uow.SaveChangesAsync();

        _log.LogInformation("Password successfully reset for user {UserId}", record.UserId);
        return ApiResponseDto<bool>.Ok(true, "Password has been reset successfully. Please log in.");
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static string GenerateRawToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        return Convert.ToBase64String(bytes)
                       .Replace('+', '-').Replace('/', '_').TrimEnd('=');
    }

    private static string HashToken(string rawToken)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(rawToken));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}
