using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
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

    protected string CurrentUserRole =>
        User.FindFirst("role")?.Value ?? string.Empty;

    protected string CurrentUserEmail =>
        User.FindFirst(ClaimTypes.Email)?.Value ?? string.Empty;

    protected IActionResult ApiResult<T>(ApiResponseDto<T> response)
    {
        if (!response.Success) return BadRequest(response);
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

    public AuthController(IAuthService auth, IPasswordResetService passwordReset)
    {
        _auth          = auth;
        _passwordReset = passwordReset;
    }

    /// <summary>Login — public, rate-limited to 5 attempts per IP per 15 minutes.</summary>
    [AllowAnonymous]
    [HttpPost("login")]
    [EnableRateLimiting("LoginPolicy")]
    public async Task<IActionResult> Login([FromBody] LoginRequestDto request)
    {
        if (!ModelState.IsValid)
            return BadRequest(ApiResponseDto<LoginResponseDto>.Fail(
                ModelState.Values.SelectMany(v => v.Errors.Select(e => e.ErrorMessage)).ToList()));

        var result = await _auth.LoginAsync(request);
        await Task.Delay(200);
        // Always return 200 — frontend checks result.success flag
        // Returning 400 on wrong password causes api-bridge to lose the error message
        return Ok(result);
    }

    /// <summary>Refresh — public (uses refresh token as credential), rate-limited.</summary>
    [AllowAnonymous]
    [HttpPost("refresh")]
    [EnableRateLimiting("LoginPolicy")]
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
