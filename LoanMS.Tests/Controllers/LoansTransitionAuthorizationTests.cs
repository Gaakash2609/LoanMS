using System.Security.Claims;
using FluentAssertions;
using LoanMS.API.Controllers;
using LoanMS.API.Services;
using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Xunit;

namespace LoanMS.Tests.Controllers;

/// <summary>
/// Regression guard for a real gap found during a backend-authorization audit
/// (2026-08-25): PATCH /api/loans/{id}/submit, /approve, /reject and
/// /disburse are the routes the frontend actually calls (see loansApi.ts),
/// but only the sibling generic PATCH /api/loans/{id}/status endpoint was
/// enforcing the Admin-configurable Roles-and-Permissions matrix via
/// IRolePermissionService.IsAllowedAsync. The four dedicated endpoints either
/// had no role check at all (Submit) or only the coarse, fixed
/// [Authorize(Roles=...)] attribute (Approve/Reject/Disburse) — so disabling
/// e.g. "canDisburse" for a role on the Settings screen had no effect on the
/// button the UI actually wires up. These tests pin the fix: each dedicated
/// endpoint must consult IRolePermissionService with the same permission key
/// UpdateStatus uses for the equivalent transition, and must not reach
/// ILoanService when denied.
/// </summary>
public class LoansTransitionAuthorizationTests
{
    private static AppDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    private static ControllerContext ContextFor(string role, int userId = 1) => new()
    {
        HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(new[]
            {
                new Claim("userId", userId.ToString()),
                new Claim("role", role)
            }, "TestAuth"))
        }
    };

    private static Mock<IRolePermissionService> DenyOnly(string deniedKey)
    {
        var mock = new Mock<IRolePermissionService>();
        mock.Setup(r => r.IsAllowedAsync(It.IsAny<string?>(), It.Is<string>(k => k == deniedKey)))
            .ReturnsAsync(false);
        mock.Setup(r => r.IsAllowedAsync(It.IsAny<string?>(), It.Is<string>(k => k != deniedKey)))
            .ReturnsAsync(true);
        return mock;
    }

    private static Mock<ILoanService> LoanServiceReturning(bool success = true)
    {
        var mock = new Mock<ILoanService>();
        mock.Setup(s => s.UpdateStatusAsync(It.IsAny<int>(), It.IsAny<UpdateLoanStatusRequestDto>(), It.IsAny<int>(), It.IsAny<string>()))
            .ReturnsAsync(success ? ApiResponseDto<LoanDto>.Ok(new LoanDto()) : ApiResponseDto<LoanDto>.Fail("denied"));
        mock.Setup(s => s.HoldAsync(It.IsAny<int>(), It.IsAny<string>(), It.IsAny<int>(), It.IsAny<string>()))
            .ReturnsAsync(ApiResponseDto<LoanDto>.Ok(new LoanDto()));
        mock.Setup(s => s.UnholdAsync(It.IsAny<int>(), It.IsAny<string?>(), It.IsAny<int>(), It.IsAny<string>()))
            .ReturnsAsync(ApiResponseDto<LoanDto>.Ok(new LoanDto()));
        mock.Setup(s => s.GetDeviationsAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<string>()))
            .ReturnsAsync(ApiResponseDto<System.Collections.Generic.List<LoanDeviationDto>>.Ok(new()));
        mock.Setup(s => s.RaiseDeviationAsync(It.IsAny<int>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>(), It.IsAny<string>()))
            .ReturnsAsync(ApiResponseDto<LoanDto>.Ok(new LoanDto()));
        mock.Setup(s => s.DecideDeviationAsync(It.IsAny<int>(), It.IsAny<bool>(), It.IsAny<string?>(), It.IsAny<int>(), It.IsAny<string>()))
            .ReturnsAsync(ApiResponseDto<LoanDto>.Ok(new LoanDto()));
        mock.Setup(s => s.SkipDeviationAsync(It.IsAny<int>(), It.IsAny<string?>(), It.IsAny<int>(), It.IsAny<string>()))
            .ReturnsAsync(ApiResponseDto<LoanDto>.Ok(new LoanDto()));
        return mock;
    }

    [Fact]
    public async Task Submit_Denied_ReturnsForbid_AndNeverCallsLoanService()
    {
        var loanService = LoanServiceReturning();
        var controller = new LoansController(loanService.Object, CreateContext(), Mock.Of<IFileStorageService>(), DenyOnly("canCreateApp").Object)
        { ControllerContext = ContextFor("Sales") };

        var result = await controller.Submit(1);

        result.Should().BeOfType<ForbidResult>();
        loanService.Verify(s => s.UpdateStatusAsync(It.IsAny<int>(), It.IsAny<UpdateLoanStatusRequestDto>(), It.IsAny<int>(), It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task Approve_Denied_ReturnsForbid_AndNeverCallsLoanService()
    {
        var loanService = LoanServiceReturning();
        var controller = new LoansController(loanService.Object, CreateContext(), Mock.Of<IFileStorageService>(), DenyOnly("canChangeStatus").Object)
        { ControllerContext = ContextFor("Manager") };

        var result = await controller.Approve(1, new ApproveRequestDto());

        result.Should().BeOfType<ForbidResult>();
        loanService.Verify(s => s.UpdateStatusAsync(It.IsAny<int>(), It.IsAny<UpdateLoanStatusRequestDto>(), It.IsAny<int>(), It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task Reject_Denied_ReturnsForbid_AndNeverCallsLoanService()
    {
        var loanService = LoanServiceReturning();
        var controller = new LoansController(loanService.Object, CreateContext(), Mock.Of<IFileStorageService>(), DenyOnly("canRejectApp").Object)
        { ControllerContext = ContextFor("Manager") };

        var result = await controller.Reject(1, new RejectRequestDto());

        result.Should().BeOfType<ForbidResult>();
        loanService.Verify(s => s.UpdateStatusAsync(It.IsAny<int>(), It.IsAny<UpdateLoanStatusRequestDto>(), It.IsAny<int>(), It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task Disburse_Denied_ReturnsForbid_AndNeverCallsLoanService()
    {
        var loanService = LoanServiceReturning();
        var controller = new LoansController(loanService.Object, CreateContext(), Mock.Of<IFileStorageService>(), DenyOnly("canDisburse").Object)
        { ControllerContext = ContextFor("Manager") };

        var result = await controller.Disburse(1);

        result.Should().BeOfType<ForbidResult>();
        loanService.Verify(s => s.UpdateStatusAsync(It.IsAny<int>(), It.IsAny<UpdateLoanStatusRequestDto>(), It.IsAny<int>(), It.IsAny<string>()), Times.Never);
    }

    [Theory]
    [InlineData("canCreateApp")]
    [InlineData("canChangeStatus")]
    [InlineData("canRejectApp")]
    [InlineData("canDisburse")]
    public async Task Allowed_TransitionsStillReachLoanService(string permKey)
    {
        var loanService = LoanServiceReturning();
        var allowAll = LoanMS.Tests.TestHelpers.RolePermissionTestDouble.AllowAll();
        var controller = new LoansController(loanService.Object, CreateContext(), Mock.Of<IFileStorageService>(), allowAll)
        { ControllerContext = ContextFor("Admin") };

        IActionResult result = permKey switch
        {
            "canCreateApp" => await controller.Submit(1),
            "canChangeStatus" => await controller.Approve(1, new ApproveRequestDto()),
            "canRejectApp" => await controller.Reject(1, new RejectRequestDto()),
            "canDisburse" => await controller.Disburse(1),
            _ => throw new InvalidOperationException()
        };

        result.Should().NotBeOfType<ForbidResult>();
        loanService.Verify(s => s.UpdateStatusAsync(It.IsAny<int>(), It.IsAny<UpdateLoanStatusRequestDto>(), It.IsAny<int>(), It.IsAny<string>()), Times.Once);
    }

    // ── Hold / Un-hold — canHoldApp gate ─────────────────────────────────────

    [Fact]
    public async Task Hold_Denied_ReturnsForbid_AndNeverCallsLoanService()
    {
        var loanService = LoanServiceReturning();
        var controller = new LoansController(loanService.Object, CreateContext(), Mock.Of<IFileStorageService>(), DenyOnly("canHoldApp").Object)
        { ControllerContext = ContextFor("Manager") };

        var result = await controller.Hold(1, new HoldRequestDto { Reason = "x" });

        result.Should().BeOfType<ForbidResult>();
        loanService.Verify(s => s.HoldAsync(It.IsAny<int>(), It.IsAny<string>(), It.IsAny<int>(), It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task Unhold_Denied_ReturnsForbid_AndNeverCallsLoanService()
    {
        var loanService = LoanServiceReturning();
        var controller = new LoansController(loanService.Object, CreateContext(), Mock.Of<IFileStorageService>(), DenyOnly("canHoldApp").Object)
        { ControllerContext = ContextFor("Manager") };

        var result = await controller.Unhold(1, new HoldRequestDto());

        result.Should().BeOfType<ForbidResult>();
        loanService.Verify(s => s.UnholdAsync(It.IsAny<int>(), It.IsAny<string?>(), It.IsAny<int>(), It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task Hold_Allowed_ReachesLoanService()
    {
        var loanService = LoanServiceReturning();
        var allowAll = LoanMS.Tests.TestHelpers.RolePermissionTestDouble.AllowAll();
        var controller = new LoansController(loanService.Object, CreateContext(), Mock.Of<IFileStorageService>(), allowAll)
        { ControllerContext = ContextFor("Admin") };

        var result = await controller.Hold(1, new HoldRequestDto { Reason = "Docs pending" });

        result.Should().NotBeOfType<ForbidResult>();
        loanService.Verify(s => s.HoldAsync(1, "Docs pending", It.IsAny<int>(), It.IsAny<string>()), Times.Once);
    }

    // ── Deviations — canDeviation gate ───────────────────────────────────────

    [Fact]
    public async Task GetDeviations_Denied_ReturnsForbid_AndNeverCallsLoanService()
    {
        var loanService = LoanServiceReturning();
        var controller = new LoansController(loanService.Object, CreateContext(), Mock.Of<IFileStorageService>(), DenyOnly("canDeviation").Object)
        { ControllerContext = ContextFor("Sales") };

        var result = await controller.GetDeviations(1);

        result.Should().BeOfType<ForbidResult>();
        loanService.Verify(s => s.GetDeviationsAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task GetDeviations_Allowed_ReachesLoanService()
    {
        var loanService = LoanServiceReturning();
        var allowAll = LoanMS.Tests.TestHelpers.RolePermissionTestDouble.AllowAll();
        var controller = new LoansController(loanService.Object, CreateContext(), Mock.Of<IFileStorageService>(), allowAll)
        { ControllerContext = ContextFor("Manager") };

        var result = await controller.GetDeviations(1);

        result.Should().NotBeOfType<ForbidResult>();
        loanService.Verify(s => s.GetDeviationsAsync(1, It.IsAny<int>(), It.IsAny<string>()), Times.Once);
    }

    [Fact]
    public async Task RaiseDeviation_Denied_ReturnsForbid_AndNeverCallsService()
    {
        var loanService = LoanServiceReturning();
        var controller = new LoansController(loanService.Object, CreateContext(), Mock.Of<IFileStorageService>(), DenyOnly("canDeviation").Object)
        { ControllerContext = ContextFor("Manager") };

        var result = await controller.RaiseDeviation(1, new RaiseDeviationRequestDto { DeviationType = "FOIR", Reason = "x" });

        result.Should().BeOfType<ForbidResult>();
        loanService.Verify(s => s.RaiseDeviationAsync(It.IsAny<int>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>(), It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task DecideDeviation_Denied_ReturnsForbid_AndNeverCallsService()
    {
        var loanService = LoanServiceReturning();
        var controller = new LoansController(loanService.Object, CreateContext(), Mock.Of<IFileStorageService>(), DenyOnly("canDeviation").Object)
        { ControllerContext = ContextFor("Manager") };

        var result = await controller.DecideDeviation(1, new DecideDeviationRequestDto { Approve = true });

        result.Should().BeOfType<ForbidResult>();
        loanService.Verify(s => s.DecideDeviationAsync(It.IsAny<int>(), It.IsAny<bool>(), It.IsAny<string?>(), It.IsAny<int>(), It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task RaiseDeviation_Allowed_ReachesService()
    {
        var loanService = LoanServiceReturning();
        var allowAll = LoanMS.Tests.TestHelpers.RolePermissionTestDouble.AllowAll();
        var controller = new LoansController(loanService.Object, CreateContext(), Mock.Of<IFileStorageService>(), allowAll)
        { ControllerContext = ContextFor("TeamLeader") };

        var result = await controller.RaiseDeviation(1, new RaiseDeviationRequestDto { DeviationType = "FOIR Deviation", Reason = "EMI high" });

        result.Should().NotBeOfType<ForbidResult>();
        loanService.Verify(s => s.RaiseDeviationAsync(1, "FOIR Deviation", "EMI high", It.IsAny<int>(), It.IsAny<string>()), Times.Once);
    }
}
