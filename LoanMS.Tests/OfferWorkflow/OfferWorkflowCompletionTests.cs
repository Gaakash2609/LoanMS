using System.Security.Claims;
using FluentAssertions;
using LoanMS.API.Controllers;
using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Tests.TestHelpers;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using static LoanMS.Tests.OfferWorkflow.OfferWorkflowTestEnv;
using S = LoanMS.Domain.Entities.OfferWorkflowStatuses;

namespace LoanMS.Tests.OfferWorkflow;

/// <summary>Owner decisions of 2026-09-25 (bureau upload as the CIBIL source, lender
/// offer validity) and the remaining workflow gaps (re-evaluation, approver
/// reassignment, task pause on hold / close on reject).</summary>
public class OfferWorkflowCompletionTests
{
    private static async Task<(OfferWorkflowTestEnv env, Loan loan)> AtOffer(bool cibilRule = false)
    {
        var env = await CreateAsync();
        await env.AddRuleAsync(Hdfc, "ROI", "ROI_MIN_PCT", 10);
        await env.AddRuleAsync(Icici, "ROI", "ROI_MIN_PCT", 14);
        if (cibilRule) await env.AddRuleAsync(Hdfc, "CIBIL", "CIBIL_MIN", 700);
        var loan = await env.SeedLoanAsync();
        (await env.Svc.MoveToOfferAsync(loan.Id, null, C("LoginTeam"))).Success.Should().BeTrue();
        return (env, loan);
    }

    private static ApplicationOfferDto OfferOf(ApiResponseDto<LoanWorkflowDto> r, int bankId) => r.Data!.Offers.Single(o => o.BankId == bankId && o.IsActive);

    // ── Bureau report upload (owner decision: the only CIBIL source) ─────────
    [Fact]
    public async Task BureauUpload_StoresFileAndReport_DeactivatesPrevious_ReChecksOffers()
    {
        var (env, loan) = await AtOffer(cibilRule: true);
        using var _ = env;
        var o = OfferOf(await env.Svc.CreateOfferAsync(loan.Id, Offer(Hdfc), C("LoginTeam")), Hdfc);
        o.DeviationStatus.Should().Be(S.DevRequired, "no bureau report yet → CIBIL missing → manual review");

        var low = await env.Svc.UploadBureauReportAsync(loan.Id, PdfReport(640), C("OperationManager"));
        low.Success.Should().BeTrue();
        OfferOf(low, Hdfc).DeviationStatus.Should().Be(S.DevRequired);
        OfferOf(low, Hdfc).Evaluation!.Checks.Single(c => c.DeviationType == "CIBIL").Status.Should().Be("Breach");

        var good = await env.Svc.UploadBureauReportAsync(loan.Id, PdfReport(790, "Experian"), C("LoginTeam"));
        OfferOf(good, Hdfc).DeviationStatus.Should().Be(S.DevNotRequired);
        good.Data!.BureauReport!.Should().Match<BureauReportSummaryDto>(b => b.CreditScore == 790 && b.BureauProvider == "Experian" && b.UploadedBy == "Credit Officer");

        env.Db.ChangeTracker.Clear();
        var reports = await env.Db.BureauReports.OrderBy(b => b.Id).ToListAsync();
        reports.Should().HaveCount(2);
        reports[0].IsActive.Should().BeFalse();
        reports[1].IsActive.Should().BeTrue();
        reports[1].UploadedByUserId.Should().Be(Ceo);
        var doc = await env.Db.LoanDocuments.Where(d => d.DocumentType == "Bureau Report").OrderByDescending(d => d.Id).FirstAsync();
        File.Exists(Path.Combine(env.StorageRoot, "loans", doc.FilePath.Replace('/', Path.DirectorySeparatorChar))).Should().BeTrue();
        (await env.Db.TrackingEntries.CountAsync(t => t.Name == "EFIN-Deviation Re-evaluated")).Should().Be(1, "NotRequired after the good report");
        (await env.Db.TrackingEntries.CountAsync(t => t.Name == "EFIN-Bureau Report Uploaded")).Should().Be(2);
    }

    [Fact]
    public async Task BureauUpload_Validation_AndAuthority()
    {
        var (env, loan) = await AtOffer();
        using var _ = env;
        (await env.Svc.UploadBureauReportAsync(loan.Id, PdfReport(), C("Manager"))).ErrorCode.Should().Be(ApiErrorCodes.Forbidden);
        (await env.Svc.UploadBureauReportAsync(loan.Id, PdfReport(), C("Sales"))).ErrorCode.Should().Be(ApiErrorCodes.Forbidden);
        (await env.Svc.UploadBureauReportAsync(loan.Id, PdfReport(950), C("Admin"))).ErrorCode.Should().Be(ApiErrorCodes.Validation);
        (await env.Svc.UploadBureauReportAsync(loan.Id, PdfReport(provider: "Unknown"), C("Admin"))).ErrorCode.Should().Be(ApiErrorCodes.Validation);
        (await env.Svc.UploadBureauReportAsync(loan.Id, PdfReport(date: DateTime.UtcNow.AddDays(5)), C("Admin"))).ErrorCode.Should().Be(ApiErrorCodes.Validation);
        var fake = new API.Services.BureauReportUpload(new MemoryStream(new byte[] { 1, 2, 3, 4, 5 }), "cibil.pdf", "application/pdf", 5, 700, "CIBIL", DateTime.UtcNow.Date);
        (await env.Svc.UploadBureauReportAsync(loan.Id, fake, C("Admin"))).Message.Should().Contain("does not match its type");
        env.Db.ChangeTracker.Clear();
        (await env.Db.BureauReports.CountAsync()).Should().Be(0);
    }

    // ── Lender offer validity (owner decision) ────────────────────────────────
    [Fact]
    public async Task LenderValidityDays_PrefillValidUntil_ExplicitDateWins()
    {
        var (env, loan) = await AtOffer();
        using var _ = env;
        var bank = await env.Db.Banks.FirstAsync(b => b.Id == Hdfc);
        bank.OfferValidityDays = 30;
        await env.Db.SaveChangesAsync(); env.Db.ChangeTracker.Clear();
        var r = await env.Svc.CreateOfferAsync(loan.Id, Offer(Hdfc), C("LoginTeam"));
        OfferOf(r, Hdfc).ValidUntil!.Value.Date.Should().Be(DateTime.UtcNow.Date.AddDays(30));
        r.Data!.EligibleLenders.Single(l => l.BankId == Hdfc).OfferValidityDays.Should().Be(30, "the Add-offer form pre-fills from it");
        var explicitDate = DateTime.UtcNow.Date.AddDays(10);
        var r2 = await env.Svc.CreateOfferAsync(loan.Id, Offer(Idfc, validUntil: explicitDate), C("LoginTeam"));
        OfferOf(r2, Idfc).ValidUntil!.Value.Date.Should().Be(explicitDate);
    }

    // ── Rule change re-evaluates Offer-stage applications of that lender ─────
    [Fact]
    public async Task RuleChange_ReEvaluatesLiveOffers_OfThatLenderOnly()
    {
        var (env, loan) = await AtOffer();
        using var _ = env;
        var icici = OfferOf(await env.Svc.CreateOfferAsync(loan.Id, Offer(Icici), C("LoginTeam")), Icici);
        icici.DeviationStatus.Should().Be(S.DevRequired);
        var hdfc = OfferOf(await env.Svc.CreateOfferAsync(loan.Id, Offer(Hdfc), C("LoginTeam")), Hdfc);
        hdfc.DeviationStatus.Should().Be(S.DevNotRequired);

        var iciciRule = (await env.Svc.ListRulesAsync(Icici, false)).Data!.Single();
        var v2 = await env.Svc.NewRuleVersionAsync(iciciRule.Id, new DeviationRuleRequestDto
        {
            Name = "ICICI ROI floor relaxed", BankId = Icici, DeviationType = "ROI", Metric = "ROI_MIN_PCT", LimitValue = 11, Priority = 100,
            EffectiveFrom = DateTime.UtcNow.AddDays(-30), ChangeReason = "Scheme", ApprovalRequired = true,
        }, C("ProductTeam"));
        v2.Success.Should().BeTrue();

        var wf = (await env.Svc.GetAsync(loan.Id, C("Admin"))).Data!;
        wf.Offers.Single(o => o.BankId == Icici).DeviationStatus.Should().Be(S.DevNotRequired, "ICICI re-evaluated against v2");
        wf.Offers.Single(o => o.BankId == Icici).LatestEvaluatedAt.Should().NotBeNull();
        wf.Offers.Single(o => o.BankId == Hdfc).LatestEvaluatedAt.Should().BeNull("HDFC rules did not change");
    }

    [Fact]
    public async Task ManualReEvaluate_OnlyMakersAndAuthorities_AtOfferStage()
    {
        var (env, loan) = await AtOffer();
        using var _ = env;
        var before = OfferOf(await env.Svc.CreateOfferAsync(loan.Id, Offer(Hdfc), C("LoginTeam")), Hdfc);
        (await env.Svc.ReEvaluateAsync(loan.Id, C("Sales"))).ErrorCode.Should().Be(ApiErrorCodes.Forbidden);
        var after = OfferOf(await env.Svc.ReEvaluateAsync(loan.Id, C("Manager")), Hdfc);
        after.LatestEvaluatedAt.Should().NotBeNull();
        after.Version.Should().Be(before.Version, "an unchanged outcome must not invalidate an open screen (no spurious concurrency conflict)");
        (await env.Svc.SelectOfferAsync(loan.Id, before.Id, new OfferActionRequestDto { ExpectedVersion = before.Version }, C("Sales"))).Success.Should().BeTrue();
    }

    // ── Approver reassignment (inactive / unavailable approver) ─────────────
    [Fact]
    public async Task InactiveApprover_IsFlagged_AndReassigned_ToEligibleUserOnly()
    {
        var (env, loan) = await AtOffer();
        using var _ = env;
        var o = OfferOf(await env.Svc.CreateOfferAsync(loan.Id, Offer(Icici), C("Manager")), Icici);
        await env.Svc.SelectOfferAsync(loan.Id, o.Id, new OfferActionRequestDto(), C("Sales"));
        var dev = (await env.Svc.RaiseDeviationAsync(loan.Id, o.Id, new RaiseOfferDeviationRequestDto { DeviationType = "ROI", Reason = "x" }, null, C("Manager")))
            .Data!.Deviations.Single();
        dev.AssignedApproverId.Should().Be(Cem);
        env.Emails.Verify(e => e.SendAsync("u8@efin.test", It.IsAny<string>(), It.Is<string>(s => s.Contains("Deviation approval required")), It.IsAny<string>(), null, null), Times.Once);

        var cem = await env.Db.Users.FirstAsync(u => u.Id == Cem);
        cem.IsActive = false;
        await env.Db.SaveChangesAsync(); env.Db.ChangeTracker.Clear();
        (await env.Svc.GetAsync(loan.Id, C("Admin"))).Data!.Deviations.Single().AssignedApproverActive.Should().BeFalse();

        var eligible = (await env.Svc.EligibleApproversAsync(loan.Id, dev.Id, C("LocationHead"))).Data!;
        eligible.Select(e => e.UserId).Should().NotContain(new[] { Cem, Manager }).And.Contain(new[] { Admin, Ceo, Ceo2 });
        (await env.Svc.EligibleApproversAsync(loan.Id, dev.Id, C("Manager"))).ErrorCode.Should().Be(ApiErrorCodes.Forbidden);

        (await env.Svc.ReassignDeviationAsync(loan.Id, dev.Id, new ReassignDeviationRequestDto { ApproverUserId = Manager, Reason = "x" }, C("LocationHead")))
            .ErrorCode.Should().Be(ApiErrorCodes.Validation, "the raiser / a non-authority user is never eligible");
        (await env.Svc.ReassignDeviationAsync(loan.Id, dev.Id, new ReassignDeviationRequestDto { ApproverUserId = Ceo2 }, C("LocationHead")))
            .ErrorCode.Should().Be(ApiErrorCodes.Validation, "reason required");
        var r = await env.Svc.ReassignDeviationAsync(loan.Id, dev.Id, new ReassignDeviationRequestDto { ApproverUserId = Ceo2, Reason = "CEM left" }, C("LocationHead"));
        r.Success.Should().BeTrue();
        var d2 = r.Data!.Deviations.Single();
        d2.AssignedApproverId.Should().Be(Ceo2);
        d2.AssignmentState.Should().Be("Reassigned");
        env.Db.ChangeTracker.Clear();
        var tasks = await env.Db.Tasks.Where(t => t.LoanId == loan.Id).OrderBy(t => t.Id).ToListAsync();
        tasks.Should().HaveCount(2);
        tasks[0].IsCompleted.Should().BeTrue();
        tasks[1].AssignedToUserId.Should().Be(Ceo2);
        (await env.Svc.DecideDeviationAsync(loan.Id, dev.Id, new DecideOfferDeviationRequestDto { Approve = true }, null, C(Ceo2, "LoginTeam"))).Success.Should().BeTrue();
    }

    [Fact]
    public async Task GenericTaskReassign_OfPendingDeviationTask_IsRefused()
    {
        var (env, loan) = await AtOffer();
        using var _ = env;
        var o = OfferOf(await env.Svc.CreateOfferAsync(loan.Id, Offer(Icici), C("Manager")), Icici);
        await env.Svc.SelectOfferAsync(loan.Id, o.Id, new OfferActionRequestDto(), C("Sales"));
        await env.Svc.RaiseDeviationAsync(loan.Id, o.Id, new RaiseOfferDeviationRequestDto { DeviationType = "ROI", Reason = "x" }, null, C("Manager"));
        env.Db.ChangeTracker.Clear();
        var task = await env.Db.Tasks.SingleAsync();
        var ctl = TasksAs(env, Admin, "Admin");
        (await ctl.Reassign(task.Id, new TaskReassignDto { AssignedToUserId = Sales })).Should().BeOfType<ConflictObjectResult>();
    }

    // ── Tasks pause on Hold, close on Reject ─────────────────────────────────
    [Fact]
    public async Task Hold_PausesTasks_CompleteBlocked_UnholdResumes_RejectCloses()
    {
        var (env, loan) = await AtOffer();
        using var _ = env;
        env.Db.Tasks.Add(new LoanTask { LoanId = loan.Id, Title = "Collect PD", AssignedToUserId = Ceo, CreatedByUserId = Admin });
        await env.Db.SaveChangesAsync(); env.Db.ChangeTracker.Clear();
        var taskId = (await env.Db.Tasks.SingleAsync()).Id;

        (await env.Loans.HoldAsync(loan.Id, "Customer travelling", Admin, "Admin")).Success.Should().BeTrue();
        env.Db.ChangeTracker.Clear();
        var t = await env.Db.Tasks.SingleAsync();
        t.PausedAt.Should().NotBeNull();
        t.PauseReason.Should().Contain("Customer travelling");
        (await TasksAs(env, Admin, "Admin").Complete(taskId)).Should().BeOfType<ConflictObjectResult>();

        (await env.Loans.UnholdAsync(loan.Id, null, Admin, "Admin")).Success.Should().BeTrue();
        env.Db.ChangeTracker.Clear();
        (await env.Db.Tasks.SingleAsync()).PausedAt.Should().BeNull();

        (await env.Loans.UpdateStatusAsync(loan.Id, new UpdateLoanStatusRequestDto { NewStatus = LoanStatus.Rejected, Comment = "Declined" }, Admin, "Admin")).Success.Should().BeTrue();
        env.Db.ChangeTracker.Clear();
        var closed = await env.Db.Tasks.SingleAsync();
        closed.IsCompleted.Should().BeTrue();
        closed.Description.Should().Contain("Application rejected");
    }

    private static TasksController TasksAs(OfferWorkflowTestEnv env, int userId, string role) => new(env.Db, RolePermissionTestDouble.AllowAll())
    {
        ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim("userId", userId.ToString()), new Claim(ClaimTypes.Role, role) }, "Test"))
            }
        }
    };
}
