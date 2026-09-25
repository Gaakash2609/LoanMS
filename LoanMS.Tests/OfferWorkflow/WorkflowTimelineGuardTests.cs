using System.Security.Claims;
using FluentAssertions;
using LoanMS.API.Controllers;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Tests.TestHelpers;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using static LoanMS.Tests.OfferWorkflow.OfferWorkflowTestEnv;

namespace LoanMS.Tests.OfferWorkflow;

/// <summary>Offer-workflow Timeline rows are audit records: clients may not
/// fabricate, edit or delete them (found in the browser walk-through, where
/// the Timeline offered edit/delete on "EFIN-Sanction Generated").</summary>
public class WorkflowTimelineGuardTests
{
    private static TrackingController Controller(OfferWorkflowTestEnv env) => new(env.Db, RolePermissionTestDouble.AllowAll())
    {
        ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim("userId", Admin.ToString()), new Claim(ClaimTypes.Role, "Admin") }, "Test"))
            }
        }
    };

    [Fact]
    public async Task SystemEntries_CannotBePosted_Edited_OrDeleted_ButManualOnesStillCan()
    {
        using var env = await CreateAsync();
        var loan = await env.SeedLoanAsync(LoanStatus.Offer);
        var ctl = Controller(env);

        (await ctl.Add(loan.Id, new TrackingDto { Name = "EFIN-Approved", Stage = "x", Comment = "fake approval" })).Should().BeOfType<ConflictObjectResult>();
        (await ctl.Add(loan.Id, new TrackingDto { Name = "EFIN-Underwriting", Stage = "x", Comment = "manual" })).Should().BeOfType<OkObjectResult>();

        var sys = new TrackingEntry { LoanId = loan.Id, Name = "EFIN-Sanction Generated", Stage = "Chief Administrator", Status = "COMPLETE", CreatedByUserId = Admin };
        env.Db.TrackingEntries.Add(sys);
        await env.Db.SaveChangesAsync();
        env.Db.ChangeTracker.Clear();

        (await ctl.Update(sys.Id, new TrackingDto { Name = "EFIN-Sanction Generated", Stage = "x", Comment = "edited" })).Should().BeOfType<ConflictObjectResult>();
        (await ctl.Delete(sys.Id)).Should().BeOfType<ConflictObjectResult>();

        var manualId = env.Db.TrackingEntries.Single(t => t.Name == "EFIN-Underwriting").Id;
        (await ctl.Update(manualId, new TrackingDto { Name = "EFIN-Approved", Stage = "x" })).Should().BeOfType<ConflictObjectResult>("renaming into a system entry is also refused");
        (await ctl.Delete(manualId)).Should().BeOfType<OkObjectResult>();
    }
}
