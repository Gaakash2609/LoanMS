using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Application.Services;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using Moq;
using FluentAssertions;

namespace LoanMS.Tests.Services;

/// <summary>
/// NOTE ON VERIFICATION: same caveat as the other test files in this project
/// — could not be executed in the sandbox that produced it (no .NET SDK
/// available; network allowlist excludes the Microsoft/NuGet feeds needed).
/// Written against the actual UserService.GetLookupAsync source but not
/// compiler- or run-verified. Run `dotnet test` locally before relying on
/// these.
///
/// Phase 4 — Users Lookup: no existing rule for this endpoint was documented
/// anywhere in the codebase (confirmed a genuine gap; the project owner did
/// not pick a specific option, so the safest default was applied and is
/// tested here): Admin/Manager get the full active-user list unchanged;
/// every other role only gets active Sales-role users.
/// </summary>
public class UserServiceLookupTests
{
    private readonly Mock<IUnitOfWork>     _uowMock  = new();
    private readonly Mock<IUserRepository> _userMock = new();
    private readonly Mock<IAuthService>    _authMock = new();
    private readonly Mock<IEmployeeCodeGenerator> _codeGenMock = new();

    private UserService CreateService()
    {
        _uowMock.Setup(u => u.Users).Returns(_userMock.Object);
        return new UserService(_uowMock.Object, _authMock.Object, _codeGenMock.Object);
    }

    private static List<User> SeedUsers() => new()
    {
        new User { Id = 1, FullName = "Admin One",   Email = "admin@efin.com",   Role = UserRole.Admin,   IsActive = true },
        new User { Id = 2, FullName = "Manager One",  Email = "mgr@efin.com",     Role = UserRole.Manager, IsActive = true },
        new User { Id = 3, FullName = "Sales One",    Email = "sales1@efin.com",  Role = UserRole.Sales,   IsActive = true },
        new User { Id = 4, FullName = "Sales Two",    Email = "sales2@efin.com",  Role = UserRole.Sales,   IsActive = true },
        new User { Id = 5, FullName = "Dsa One",      Email = "dsa1@efin.com",    Role = UserRole.Dsa,     IsActive = true },
        new User { Id = 6, FullName = "Partner One",  Email = "partner1@efin.com",Role = UserRole.Partner, IsActive = true },
    };

    [Fact]
    public async Task Admin_GetsFullActiveUserList_Unchanged()
    {
        _userMock.Setup(r => r.GetAllActiveUsersAsync()).ReturnsAsync(SeedUsers());
        var svc = CreateService();

        var result = await svc.GetLookupAsync("Admin");

        result.Success.Should().BeTrue();
        result.Data!.Select(u => u.Id).Should().BeEquivalentTo(new[] { 1, 2, 3, 4, 5, 6 });
    }

    [Fact]
    public async Task Manager_GetsFullActiveUserList_Unchanged()
    {
        _userMock.Setup(r => r.GetAllActiveUsersAsync()).ReturnsAsync(SeedUsers());
        var svc = CreateService();

        var result = await svc.GetLookupAsync("Manager");

        result.Success.Should().BeTrue();
        result.Data!.Select(u => u.Id).Should().BeEquivalentTo(new[] { 1, 2, 3, 4, 5, 6 });
    }

    [Fact]
    public async Task Dsa_CannotRetrieveRestrictedUsers_OnlySeesSalesRoleUsers()
    {
        _userMock.Setup(r => r.GetAllActiveUsersAsync()).ReturnsAsync(SeedUsers());
        var svc = CreateService();

        var result = await svc.GetLookupAsync("Dsa");

        result.Success.Should().BeTrue();
        result.Data!.Select(u => u.Id).Should().BeEquivalentTo(new[] { 3, 4 });
        result.Data!.Should().NotContain(u => u.Role == "Admin" || u.Role == "Manager" || u.Role == "Dsa" || u.Role == "Partner");
    }

    [Fact]
    public async Task Partner_CannotRetrieveRestrictedUsers_OnlySeesSalesRoleUsers()
    {
        _userMock.Setup(r => r.GetAllActiveUsersAsync()).ReturnsAsync(SeedUsers());
        var svc = CreateService();

        var result = await svc.GetLookupAsync("Partner");

        result.Success.Should().BeTrue();
        result.Data!.Select(u => u.Id).Should().BeEquivalentTo(new[] { 3, 4 });
    }

    [Fact]
    public async Task Sales_CannotRetrieveRestrictedUsers_OnlySeesSalesRoleUsers()
    {
        _userMock.Setup(r => r.GetAllActiveUsersAsync()).ReturnsAsync(SeedUsers());
        var svc = CreateService();

        var result = await svc.GetLookupAsync("Sales");

        result.Success.Should().BeTrue();
        result.Data!.Select(u => u.Id).Should().BeEquivalentTo(new[] { 3, 4 });
    }
}
