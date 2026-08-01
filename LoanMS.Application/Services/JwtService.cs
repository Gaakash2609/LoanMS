using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;

namespace LoanMS.Application.Services;

public class JwtService : IJwtService
{
    private readonly IConfiguration _config;

    public JwtService(IConfiguration config) => _config = config;

    public string GenerateAccessToken(User user)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_config["Jwt:Key"]!));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new Claim(JwtRegisteredClaimNames.Email, user.Email),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new Claim(ClaimTypes.Name, user.FullName),
            new Claim(ClaimTypes.Role, user.Role.ToString()),
            new Claim("userId", user.Id.ToString()),
            new Claim("role", user.Role.ToString())
        };

        // ROOT CAUSE FIX: Jwt:Issuer / Jwt:Audience are not set in any appsettings
        // file or ECS task definition (only Jwt:Key is). Program.cs's
        // TokenValidationParameters already falls back to "LoanMS.API" /
        // "LoanMS.Client" when those config keys are missing, and requires
        // ValidateIssuer/ValidateAudience = true. This class previously read the
        // same missing config with NO fallback, so tokens were minted with no
        // "iss"/"aud" claims at all — which the validator then always rejected
        // with a 401, on every single request, regardless of how fresh the
        // login was. The fallback here MUST always match Program.cs exactly.
        var issuer   = _config["Jwt:Issuer"]   ?? "LoanMS.API";
        var audience = _config["Jwt:Audience"] ?? "LoanMS.Client";

        var token = new JwtSecurityToken(
            issuer: issuer,
            audience: audience,
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(int.Parse(_config["Jwt:ExpiryMinutes"] ?? "60")),
            signingCredentials: creds
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public string GenerateRefreshToken()
    {
        var bytes = new byte[64];
        using var rng = RandomNumberGenerator.Create();
        rng.GetBytes(bytes);
        return Convert.ToBase64String(bytes);
    }

    public int? GetUserIdFromToken(string token)
    {
        try
        {
            var handler = new JwtSecurityTokenHandler();
            var jwt = handler.ReadJwtToken(token);
            var claim = jwt.Claims.FirstOrDefault(c => c.Type == "userId");
            return claim != null ? int.Parse(claim.Value) : null;
        }
        catch { return null; }
    }
}
