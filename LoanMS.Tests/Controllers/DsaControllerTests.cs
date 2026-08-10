using System.Security.Claims;
using FluentAssertions;
using LoanMS.API.Controllers;
using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace LoanMS.Tests.Controllers;

/// <summary>
/// NOTE ON VERIFICATION: same caveat as the other test files in this project
/// — this suite could not be executed in the sandbox that produced it (no
/// .NET SDK could be installed there; the network allowlist doesn't include
/// the Microsoft/NuGet feeds `dotnet build`/`dotnet test` need). Written
/// against the actual DsaController.GetAll source but not compiler- or
/// run-verified. Run `dotnet test` locally before relying on these.
///
/// Phase 4 — DSA + Team + User Lookup Access: Partner/Dsa now only see their
/// own DsaPartner record (LinkedUserId == CurrentUserId). Admin/Manager/Sales
/// keep the existing full-list behavior.
/// </summary>
public class DsaControllerTests
{
    private static (DsaController controller, AppDbContext db) CreateController(int currentUserId, string currentUserRole)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        var db = new AppDbContext(options);

        var claims = new ClaimsIdentity(new[]
        {
            new Claim("userId", currentUserId.ToString()),
            new Claim("role", currentUserRole)
        }, "TestAuth");

        var controller = new DsaController(db, new LoanMS.Infrastructure.Services.LocalFileStorageService(System.IO.Path.GetTempPath()))
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(claims) }
            }
        };

        return (controller, db);
    }

    private static List<DsaPartner> ExtractList(IActionResult result)
    {
        var ok = (OkObjectResult)result;
        var response = (ApiResponseDto<object>)ok.Value!;
        // GetAll projects to an anonymous type, not DsaPartner directly — the tests
        // only need to know which loanMS Id values came back, via reflection on Id.
        var items = (IEnumerable<object>)response.Data!;
        var ids = items.Select(i => (int)i.GetType().GetProperty("Id")!.GetValue(i)!).ToList();
        return ids.Select(id => new DsaPartner { Id = id }).ToList();
    }

    [Fact]
    public async Task Partner_SeesOnlyOwnDsaRecord()
    {
        var (controller, db) = CreateController(currentUserId: 1, currentUserRole: "Partner");
        var myRecord    = new DsaPartner { Id = 1, Name = "My Partner Co", Code = "P1", PartnerType = PartnerType.Partner, LinkedUserId = 1 };
        var otherRecord = new DsaPartner { Id = 2, Name = "Other Partner Co", Code = "P2", PartnerType = PartnerType.Partner, LinkedUserId = 2 };
        db.DsaPartners.AddRange(myRecord, otherRecord);
        await db.SaveChangesAsync();

        var result = await controller.GetAll();
        var ids = ExtractList(result).Select(d => d.Id).ToList();

        ids.Should().Contain(1);
        ids.Should().NotContain(2);
    }

    [Fact]
    public async Task Dsa_SeesOnlyOwnDsaRecord()
    {
        var (controller, db) = CreateController(currentUserId: 5, currentUserRole: "Dsa");
        var myRecord    = new DsaPartner { Id = 1, Name = "My DSA", Code = "D1", PartnerType = PartnerType.Dsa, LinkedUserId = 5 };
        var otherRecord = new DsaPartner { Id = 2, Name = "Other DSA", Code = "D2", PartnerType = PartnerType.Dsa, LinkedUserId = 6 };
        db.DsaPartners.AddRange(myRecord, otherRecord);
        await db.SaveChangesAsync();

        var result = await controller.GetAll();
        var ids = ExtractList(result).Select(d => d.Id).ToList();

        ids.Should().Contain(1);
        ids.Should().NotContain(2);
    }

    [Fact]
    public async Task Admin_SeesAllDsaRecords_Unchanged()
    {
        var (controller, db) = CreateController(currentUserId: 99, currentUserRole: "Admin");
        db.DsaPartners.AddRange(
            new DsaPartner { Id = 1, Name = "DSA A", Code = "D1", PartnerType = PartnerType.Dsa, LinkedUserId = 5 },
            new DsaPartner { Id = 2, Name = "DSA B", Code = "D2", PartnerType = PartnerType.Dsa, LinkedUserId = 6 });
        await db.SaveChangesAsync();

        var result = await controller.GetAll();
        var ids = ExtractList(result).Select(d => d.Id).ToList();

        ids.Should().Contain(1);
        ids.Should().Contain(2);
    }
}
