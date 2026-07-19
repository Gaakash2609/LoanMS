using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Application.Services;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using Microsoft.Extensions.Configuration;
using Moq;
using FluentAssertions;

namespace LoanMS.Tests.Services;

public class AuthServiceTests
{
    private readonly Mock<IUnitOfWork>   _uowMock  = new();
    private readonly Mock<IUserRepository> _userMock = new();
    private readonly Mock<IJwtService>   _jwtMock  = new();
    private readonly IConfiguration      _cfg;

    public AuthServiceTests()
    {
        _cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:ExpiryMinutes"]    = "20",
                ["Jwt:RefreshExpiryDays"] = "1"
            }).Build();
    }

    private AuthService CreateService()
    {
        _uowMock.Setup(u => u.Users).Returns(_userMock.Object);
        _uowMock.Setup(u => u.SaveChangesAsync()).ReturnsAsync(1);
        return new AuthService(_uowMock.Object, _jwtMock.Object, _cfg);
    }

    [Fact]
    public async Task LoginAsync_UserNotFound_ReturnsFail()
    {
        _userMock.Setup(r => r.GetByEmailAsync("x@x.com")).ReturnsAsync((User?)null);
        var svc    = CreateService();
        var result = await svc.LoginAsync(new LoginRequestDto { Email = "x@x.com", Password = "test" });
        result.Success.Should().BeFalse();
        result.Message.Should().Contain("Invalid email or password");
    }

    [Fact]
    public async Task LoginAsync_InactiveUser_ReturnsFail()
    {
        var user = new User { Id=1, Email="a@a.com", PasswordHash="x", IsActive=false, Role=UserRole.Admin, FullName="A" };
        _userMock.Setup(r => r.GetByEmailAsync("a@a.com")).ReturnsAsync(user);
        var svc    = CreateService();
        var result = await svc.LoginAsync(new LoginRequestDto { Email = "a@a.com", Password = "pass" });
        result.Success.Should().BeFalse();
    }

    [Fact]
    public async Task LoginAsync_WrongPassword_ReturnsFail()
    {
        var hash = BCrypt.Net.BCrypt.HashPassword("correct_password", 4);
        var user = new User { Id=1, Email="a@a.com", PasswordHash=hash, IsActive=true, Role=UserRole.Admin, FullName="Admin" };
        _userMock.Setup(r => r.GetByEmailAsync("a@a.com")).ReturnsAsync(user);
        _userMock.Setup(r => r.UpdateAsync(It.IsAny<User>())).ReturnsAsync((User u) => u);

        var svc    = CreateService();
        var result = await svc.LoginAsync(new LoginRequestDto { Email = "a@a.com", Password = "wrong_password" });
        result.Success.Should().BeFalse();
    }

    [Fact]
    public async Task LoginAsync_CorrectCredentials_ReturnsToken()
    {
        var hash = BCrypt.Net.BCrypt.HashPassword("Admin@123", 4);
        var user = new User { Id=1, Email="admin@efin.com", PasswordHash=hash, IsActive=true, Role=UserRole.Admin, FullName="Admin" };
        _userMock.Setup(r => r.GetByEmailAsync("admin@efin.com")).ReturnsAsync(user);
        _userMock.Setup(r => r.UpdateAsync(It.IsAny<User>())).ReturnsAsync((User u) => u);
        _jwtMock.Setup(j => j.GenerateAccessToken(user)).Returns("access_token_xyz");
        _jwtMock.Setup(j => j.GenerateRefreshToken()).Returns("refresh_token_xyz");

        var svc    = CreateService();
        var result = await svc.LoginAsync(new LoginRequestDto { Email = "admin@efin.com", Password = "Admin@123" });

        result.Success.Should().BeTrue();
        result.Data!.AccessToken.Should().Be("access_token_xyz");
        result.Data.RefreshToken.Should().Be("refresh_token_xyz");
    }

    [Fact]
    public async Task RefreshTokenAsync_InvalidToken_ReturnsFail()
    {
        _userMock.Setup(r => r.GetByRefreshTokenAsync("bad_token")).ReturnsAsync((User?)null);
        var svc    = CreateService();
        var result = await svc.RefreshTokenAsync("bad_token");
        result.Success.Should().BeFalse();
        result.Message.Should().Contain("Invalid or expired");
    }

    [Fact]
    public async Task LogoutAsync_ValidUser_ClearsRefreshToken()
    {
        var user = new User { Id=1, Email="a@a.com", PasswordHash="x", IsActive=true,
                              Role=UserRole.Admin, FullName="A",
                              RefreshToken="old_token", RefreshTokenExpiry=DateTime.UtcNow.AddDays(1) };
        _userMock.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(user);
        _userMock.Setup(r => r.UpdateAsync(It.IsAny<User>())).ReturnsAsync((User u) => u);

        var svc    = CreateService();
        var result = await svc.LogoutAsync(1);

        result.Success.Should().BeTrue();
        user.RefreshToken.Should().BeNull();
    }
}
