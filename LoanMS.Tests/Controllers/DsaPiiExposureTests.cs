using System.Security.Claims;
using System.Text;
using FluentAssertions;
using LoanMS.API.Controllers;
using LoanMS.API.Services;
using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using LoanMS.Tests.TestHelpers;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace LoanMS.Tests.Controllers;

// ── DSA/Partner PII (master prompt Part 6) ──────────────────────────────────
// PAN, email, phone, office address and KYC files go only to Admin,
// ProductTeam, Manager and TeamLeader (and a DSA/Partner for its own records).
// Any other role that may open the directory gets GET /api/dsa/lookup's fields.
public class DsaPiiExposureTests
{
    private const string Pan = "ABCDE1234F";

    private static AppDbContext Seed()
    {
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        db.DsaPartners.AddRange(
            new DsaPartner { Id = 1, Name = "Alpha DSA", Code = "D1", PartnerType = PartnerType.Dsa, Pan = Pan,
                             Email = "alpha@dsa.in", Phone = "9876543210", OfficeAddress = "12 MG Road", LinkedUserId = 50 },
            new DsaPartner { Id = 2, Name = "Beta Partner", Code = "P2", PartnerType = PartnerType.Partner, Pan = "PQRST6789K",
                             Email = "beta@p.in", Phone = "9123456780", LinkedUserId = 51, MappedDsaId = 1 },
            new DsaPartner { Id = 3, Name = "Gamma (inactive)", Code = "D3", PartnerType = PartnerType.Dsa, IsActive = false });
        db.SaveChanges();
        return db;
    }

    // allowAllMenus simulates an Admin who switched the DSA menu on for a role.
    private static DsaController Dsa(AppDbContext db, int userId, string role, bool allowAllMenus = false)
    {
        var ctl = new DsaController(db, new LoanMS.Infrastructure.Services.LocalFileStorageService(Path.GetTempPath()),
            allowAllMenus ? RolePermissionTestDouble.AllowAll() : new RolePermissionService(db))
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(new[]
                    {
                        new Claim("userId", userId.ToString()), new Claim("role", role),
                    }, "TestAuth")),
                },
            },
        };
        return ctl;
    }

    private static List<object> Rows(IActionResult result) =>
        ((IEnumerable<object>)((ApiResponseDto<object>)((OkObjectResult)result).Value!).Data!).ToList();

    private static string[] Fields(object row) => row.GetType().GetProperties().Select(p => p.Name).OrderBy(n => n).ToArray();

    private static string Csv(IActionResult result) => Encoding.UTF8.GetString(((FileContentResult)result).FileContents);

    [Theory]
    [InlineData("Admin")]
    [InlineData("ProductTeam")]
    [InlineData("Manager")]
    [InlineData("TeamLeader")]
    public async Task FullDetailRoles_GetPanAndContactDetails(string role)
    {
        var db = Seed();
        var rows = Rows(await Dsa(db, 9, role).GetAll());
        rows.Should().HaveCount(3);
        rows.Select(r => r.GetType().GetProperty("Pan")!.GetValue(r)).Should().Contain(Pan);
        Csv(await Dsa(db, 9, role).Export()).Should().Contain(Pan).And.Contain("alpha@dsa.in");
    }

    [Theory]
    [InlineData("LocationHead", false)] // has the DSA menu by default
    [InlineData("Sales", true)]
    [InlineData("LoginTeam", true)]
    [InlineData("OperationManager", true)]
    [InlineData("Accounts", true)]
    public async Task OtherRoles_GetOnlyTheLookupFields(string role, bool allowAllMenus)
    {
        var db = Seed();
        var rows = Rows(await Dsa(db, 9, role, allowAllMenus).GetAll());
        rows.Should().HaveCount(2, "inactive records are not part of the lookup");
        foreach (var r in rows) Fields(r).Should().Equal("Code", "Id", "Name", "PartnerType");

        var csv = Csv(await Dsa(db, 9, role, allowAllMenus).Export());
        csv.Should().StartWith("Name,Code,Type").And.Contain("Alpha DSA");
        csv.Should().NotContain(Pan).And.NotContain("alpha@dsa.in").And.NotContain("9876543210");

        (await Dsa(db, 9, role, allowAllMenus).GetDocuments(1)).Should().BeOfType<ForbidResult>();
        (await Dsa(db, 9, role, allowAllMenus).DownloadDocument(1, "x.pdf")).Should().BeOfType<ForbidResult>();
    }

    [Fact]
    public async Task RoleWithoutTheMenu_CannotExport()
    {
        // Export used to skip the menu gate entirely.
        (await Dsa(Seed(), 9, "Accounts").Export()).Should().BeOfType<ForbidResult>();
    }

    [Fact]
    public async Task DsaAndPartner_SeeTheirOwnRecordsInFull()
    {
        var db = Seed();
        var partner = Rows(await Dsa(db, 51, "Partner").GetAll());
        partner.Should().ContainSingle();
        partner[0].GetType().GetProperty("Pan")!.GetValue(partner[0]).Should().Be("PQRST6789K");

        var dsa = Rows(await Dsa(db, 50, "Dsa").GetAll());
        dsa.Select(r => (int)r.GetType().GetProperty("Id")!.GetValue(r)!).Should().BeEquivalentTo(new[] { 1, 2 });
        Csv(await Dsa(db, 50, "Dsa").Export()).Should().Contain(Pan).And.NotContain("Gamma");

        (await Dsa(db, 51, "Partner").GetDocuments(2)).Should().BeOfType<OkObjectResult>();
        (await Dsa(db, 9, "Manager").GetDocuments(1)).Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task Lookup_IsUnchanged()
    {
        var rows = Rows(await Dsa(Seed(), 9, "Sales").GetLookup());
        rows.Should().HaveCount(2);
        Fields(rows[0]).Should().Equal("Code", "Id", "Name", "PartnerType");
    }
}
