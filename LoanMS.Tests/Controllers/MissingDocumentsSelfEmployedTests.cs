using System.Security.Claims;
using System.Text.Json;
using FluentAssertions;
using LoanMS.API.Controllers;
using LoanMS.API.Services;
using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Xunit;

namespace LoanMS.Tests.Controllers;

/// <summary>
/// RA-5 regression: GET /api/loans/{id}/missing-documents must flag ITR + GST as
/// expected for a self-employed applicant. The stored employment type from the
/// wizard is "SELFEMP" (NewApplicationPage empType map), but the check compared
/// against the literal "Self-Employed"/"Professional" and so never matched —
/// ITR/GST were never flagged for any self-employed applicant. Discovered via a
/// live end-to-end run.
/// </summary>
public class MissingDocumentsSelfEmployedTests
{
    private static AppDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static ControllerContext AdminCtx() => new()
    {
        HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(new[]
            {
                new Claim("userId", "1"), new Claim("role", "Admin"),
            }, "TestAuth")),
        },
    };

    private static async Task<string> MissingDocsJson(string employmentType)
    {
        var db = CreateContext();
        db.Set<Customer>().Add(new Customer { Id = 5, FullName = "SE Cust", Email = "se@x.com", Phone = "9", EmploymentType = employmentType });
        await db.SaveChangesAsync();

        var loanSvc = new Mock<ILoanService>();
        loanSvc.Setup(s => s.GetByIdAsync(5, It.IsAny<int>(), It.IsAny<string>(), It.IsAny<HashSet<string>?>()))
            .ReturnsAsync(ApiResponseDto<LoanDto>.Ok(new LoanDto { Customer = new CustomerDto { Id = 5 } }));

        var controller = new LoansController(loanSvc.Object, db, Mock.Of<IFileStorageService>(), Mock.Of<IRolePermissionService>())
        { ControllerContext = AdminCtx() };

        var result = await controller.GetMissingDocuments(5);
        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        var body = ok.Value.Should().BeOfType<ApiResponseDto<object>>().Subject;
        return JsonSerializer.Serialize(body.Data);
    }

    [Theory]
    [InlineData("SELFEMP")]
    [InlineData("SELF_EMPLOYED")]
    [InlineData("Self-Employed")]
    [InlineData("Professional")]
    public async Task Flags_ITR_and_GST_for_self_employed_variants(string empType)
    {
        var json = await MissingDocsJson(empType);
        json.Should().Contain("itr");
        json.Should().Contain("gst");
        // the two always-mandatory docs are still present too
        json.Should().Contain("salary_slip").And.Contain("bank_statement");
    }

    [Fact]
    public async Task Does_not_flag_ITR_or_GST_for_a_salaried_applicant()
    {
        var json = await MissingDocsJson("SALARIED");
        json.Should().NotContain("itr");
        json.Should().NotContain("gst");
        json.Should().Contain("salary_slip").And.Contain("bank_statement");
    }
}
