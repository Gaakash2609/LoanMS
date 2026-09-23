using FluentAssertions;
using LoanMS.API.Controllers;
using LoanMS.API.Services;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using LoanMS.Tests.TestHelpers;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace LoanMS.Tests.Controllers;

/// <summary>
/// Pins GET /api/incred/status against a regression that made the one
/// endpoint whose entire job is "report whether InCred is configured" 500
/// specifically in the unconfigured case.
///
/// GetStatus() used to call the private _loadCreds(), which throws
/// InvalidOperationException the moment no InCred credentials are saved in
/// Settings (the PHASE 6 security fix removed the old built-in-fallback
/// path that used to make _loadCreds() always succeed). IncredPage.tsx
/// calls this endpoint on every page load, so the InCred module 500'd on
/// its own status check on any environment without InCred configured --
/// which is every fresh install, and was reproduced live against a local
/// dev database while wiring the missing per-application action buttons
/// into IncredPage.
/// </summary>
public class IncredStatusTests
{
    private static IncredController CreateController(AppDbContext db)
    {
        var httpFactory = new Mock<IHttpClientFactory>();
        var protectorMock = new Mock<IDataProtector>();
        var dpProvider = new Mock<IDataProtectionProvider>();
        dpProvider.Setup(p => p.CreateProtector(It.IsAny<string>())).Returns(protectorMock.Object);

        var cache = new FakeCacheService();
        var rolePerm = RolePermissionTestDouble.AllowAll();

        return new IncredController(db, httpFactory.Object, dpProvider.Object,
            NullLogger<IncredController>.Instance, cache, rolePerm)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };
    }

    private static AppDbContext CreateDb() =>
        new(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    [Fact]
    public async Task GetStatus_NoCredentialsConfigured_ReturnsConfiguredFalse_NotAServerError()
    {
        using var db = CreateDb(); // no AppSettings seeded at all
        var controller = CreateController(db);

        var result = await controller.GetStatus(); // must not throw

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        var json = System.Text.Json.JsonSerializer.Serialize(ok.Value);
        json.Should().Contain("\"configured\":false");
        json.Should().NotContain("\"baseUrl\":\"", "no baseUrl should be echoed back when unconfigured");
    }

    [Fact]
    public async Task GetStatus_PartialCredentials_StillReturnsConfiguredFalse_NotAServerError()
    {
        using var db = CreateDb();
        // Only base URL saved -- clientId/secret still missing, exactly the
        // half-configured state an operator mid-setup would leave it in.
        db.AppSettings.Add(new AppSetting { Key = "incred_base_url", Value = "https://api.incred.test/v3" });
        await db.SaveChangesAsync();
        var controller = CreateController(db);

        var result = await controller.GetStatus();

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        System.Text.Json.JsonSerializer.Serialize(ok.Value).Should().Contain("\"configured\":false");
    }

    [Fact]
    public async Task GetStatus_FullCredentialsConfigured_ReturnsConfiguredTrue_WithBaseUrl()
    {
        using var db = CreateDb();
        db.AppSettings.AddRange(
            new AppSetting { Key = "incred_base_url", Value = "https://api.incred.test/v3" },
            new AppSetting { Key = "incred_client_id", Value = "test-client" },
            new AppSetting { Key = "incred_client_secret_enc", Value = "dGVzdC1zZWNyZXQ" });
        await db.SaveChangesAsync();
        var controller = CreateController(db);

        var result = await controller.GetStatus();

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        var json = System.Text.Json.JsonSerializer.Serialize(ok.Value);
        json.Should().Contain("\"configured\":true");
        json.Should().Contain("api.incred.test");
    }
}
