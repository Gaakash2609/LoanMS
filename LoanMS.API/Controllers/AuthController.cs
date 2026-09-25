using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace LoanMS.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
[Microsoft.AspNetCore.RateLimiting.EnableRateLimiting("GlobalPolicy")]
public abstract class BaseController : ControllerBase
{
    protected int CurrentUserId =>
        int.TryParse(User.FindFirst("userId")?.Value, out var id) ? id : 0;

    // BUGFIX (verified at runtime — GET /api/auth/me returned role:"" for
    // every user, Admin included): AddJwtBearer defaults to
    // MapInboundClaims = true, which RENAMES the inbound short "role" claim
    // (JwtService.cs:31) to ClaimTypes.Role. The principal therefore ends up
    // holding two ClaimTypes.Role claims and none named "role", so this
    // lookup found nothing and returned "" for everyone. That empty role then
    // fell past every named-role branch in LoanRepository.ApplyVisibilityScope
    // into its "unrecognized role" fallback (query.Where(l => false)), scoping
    // EVERY loan query to zero rows — the `WHERE 0` seen in the SQL log for
    // dashboard, loans list and reports alike.
    //
    // ClaimTypes.Role is read first (that is where the value actually lives —
    // both from JwtService.cs:29 and from the renamed short claim), keeping
    // the raw "role" name as a fallback so this still resolves if
    // MapInboundClaims is ever turned off. Same shape CurrentUserEmail below
    // already uses. [Authorize(Roles=...)] is untouched and unaffected — it
    // reads ClaimTypes.Role through IsInRole and was always working.
    protected string CurrentUserRole =>
        User.FindFirst(ClaimTypes.Role)?.Value ?? User.FindFirst("role")?.Value ?? string.Empty;

    protected string CurrentUserEmail =>
        User.FindFirst(ClaimTypes.Email)?.Value ?? string.Empty;

    /// <summary>
    /// "May this caller see this loan application?" — the same
    /// LoanRepository.ApplyVisibilityScope rule the loan list/detail, reports
    /// and dashboard use (single source of truth). Endpoints that take a loan id
    /// must check this server-side; a hidden button is not authorization.
    /// Callers answer NotFound when false, exactly like GET /api/loans/{id}.
    /// </summary>
    protected Task<bool> CanSeeLoanAsync(AppDbContext db, int loanId) =>
        LoanMS.Infrastructure.Repositories.LoanRepository
            .ApplyVisibilityScope(db, db.Loans, CurrentUserId, CurrentUserRole)
            .AnyAsync(l => l.Id == loanId);

    protected IActionResult ApiResult<T>(ApiResponseDto<T> response)
    {
        if (!response.Success)
        {
            // ErrorCode is set only by the duplicate/re-application/archive
            // rules; every older failure keeps its existing 400.
            if (ApiErrorCodes.IsConflict(response.ErrorCode)) return Conflict(response);
            if (response.ErrorCode is ApiErrorCodes.Forbidden or ApiErrorCodes.SelfApproval) return StatusCode(StatusCodes.Status403Forbidden, response);
            if (response.ErrorCode == ApiErrorCodes.NotFound) return NotFound(response);
            return BadRequest(response);
        }
        return Ok(response);
    }
}

[ApiController]
[Route("api/auth")]
[Produces("application/json")]
public class AuthController : BaseController
{
    private readonly IAuthService          _auth;
    private readonly IPasswordResetService _passwordReset;
    private readonly AppDbContext          _db;

    // Server-side lockout thresholds. Mirrors what the frontend previously
    // enforced ALONE via localStorage key 'efin_login_lock' — trivially
    // bypassed by clearing localStorage or opening an incognito window,
    // so it was UX-only, not real security. This is now the sole
    // enforcement point; the frontend lock is kept only to show an instant
    // "locked, try again in Xm" message without a round trip.
    private const int LockoutMaxAttempts = 5;
    private static readonly TimeSpan LockoutWindow = TimeSpan.FromMinutes(15);

    public AuthController(IAuthService auth, IPasswordResetService passwordReset, AppDbContext db)
    {
        _auth          = auth;
        _passwordReset = passwordReset;
        _db            = db;
    }

    /// <summary>Login — public, rate-limited to 5 attempts per IP per 15 minutes,
    /// and locked out for 15 minutes after 5 FAILED attempts for either the
    /// target email or the calling IP (whichever trips first).</summary>
    [AllowAnonymous]
    [HttpPost("login")]
    [EnableRateLimiting("LoginPolicy")]
    public async Task<IActionResult> Login([FromBody] LoginRequestDto request)
    {
        if (!ModelState.IsValid)
            return BadRequest(ApiResponseDto<LoginResponseDto>.Fail(
                ModelState.Values.SelectMany(v => v.Errors.Select(e => e.ErrorMessage)).ToList()));

        var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        var email = request.Email.Trim().ToLowerInvariant();
        var windowStart = DateTime.UtcNow - LockoutWindow;

        var emailFailCount = await _db.LoginAttempts
            .Where(a => a.Email == email && a.CreatedAt >= windowStart)
            .CountAsync();
        var ipFailCount = await _db.LoginAttempts
            .Where(a => a.IpAddress == ip && a.CreatedAt >= windowStart)
            .CountAsync();

        if (emailFailCount >= LockoutMaxAttempts || ipFailCount >= LockoutMaxAttempts)
        {
            var oldestRelevant = await _db.LoginAttempts
                .Where(a => (a.Email == email || a.IpAddress == ip) && a.CreatedAt >= windowStart)
                .OrderBy(a => a.CreatedAt)
                .Select(a => a.CreatedAt)
                .FirstOrDefaultAsync();
            var retryAfter = oldestRelevant == default ? LockoutWindow : (oldestRelevant + LockoutWindow) - DateTime.UtcNow;
            var minutes = Math.Max(1, (int)Math.Ceiling(retryAfter.TotalMinutes));
            return Ok(ApiResponseDto<LoginResponseDto>.Fail(
                $"Too many failed attempts. Try again in {minutes} minute{(minutes == 1 ? "" : "s")}."));
        }

        var result = await _auth.LoginAsync(request);
        await Task.Delay(200);

        if (result.Success)
        {
            // Successful login clears this email's failed-attempt history —
            // a mistyped-then-corrected password shouldn't leave the account
            // sitting near a lockout threshold it never actually earned.
            var stale = await _db.LoginAttempts.Where(a => a.Email == email).ToListAsync();
            if (stale.Count > 0)
            {
                _db.LoginAttempts.RemoveRange(stale);
                await _db.SaveChangesAsync();
            }
        }
        else
        {
            _db.LoginAttempts.Add(new LoginAttempt { Email = email, IpAddress = ip, CreatedAt = DateTime.UtcNow });
            await _db.SaveChangesAsync();
        }

        // Always return 200 — frontend checks result.success flag
        // Returning 400 on wrong password causes api-bridge to lose the error message
        return Ok(result);
    }

    /// <summary>Refresh — public (uses refresh token as credential), rate-limited.</summary>
    // Uses its own "RefreshPolicy" (separate from "LoginPolicy") because this
    // endpoint is called silently and automatically in the background by every
    // open tab to renew an access token — it is not a deliberate sign-in
    // attempt. Sharing the tight, brute-force-oriented login budget with this
    // routine background traffic could exhaust it and make real logins fail
    // with 429 even for a user who just typed in their correct password.
    [AllowAnonymous]
    [HttpPost("refresh")]
    [EnableRateLimiting("RefreshPolicy")]
    public async Task<IActionResult> Refresh([FromBody] RefreshTokenRequestDto request)
    {
        var result = await _auth.RefreshTokenAsync(request.RefreshToken);
        return ApiResult(result);
    }

    /// <summary>Logout — requires valid JWT.</summary>
    [Authorize]
    [HttpPost("logout")]
    public async Task<IActionResult> Logout()
    {
        var result = await _auth.LogoutAsync(CurrentUserId);
        return ApiResult(result);
    }

    /// <summary>Current user info — requires valid JWT.</summary>
    [Authorize]
    [HttpGet("me")]
    public IActionResult Me()
    {
        return Ok(ApiResponseDto<object>.Ok(new {
            Id    = CurrentUserId,
            Email = CurrentUserEmail,
            Role  = CurrentUserRole
        }));
    }

    [AllowAnonymous]
    [HttpPost("forgot-password")]
    [EnableRateLimiting("LoginPolicy")]
    public async Task<IActionResult> ForgotPassword([FromBody] ForgotPasswordRequestDto request)
    {
        if (!ModelState.IsValid)
            return BadRequest(ApiResponseDto<bool>.Fail(
                ModelState.Values.SelectMany(v => v.Errors.Select(e => e.ErrorMessage)).ToList()));

        var result = await _passwordReset.ForgotPasswordAsync(request);
        await Task.Delay(200);
        return Ok(result);
    }

    [AllowAnonymous]
    [HttpPost("reset-password")]
    [EnableRateLimiting("LoginPolicy")]
    public async Task<IActionResult> ResetPassword([FromBody] ResetPasswordRequestDto request)
    {
        if (!ModelState.IsValid)
            return BadRequest(ApiResponseDto<bool>.Fail(
                ModelState.Values.SelectMany(v => v.Errors.Select(e => e.ErrorMessage)).ToList()));

        var result = await _passwordReset.ResetPasswordAsync(request);
        return ApiResult(result);
    }
}
