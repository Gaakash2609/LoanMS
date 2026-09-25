using FluentAssertions;
using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using static LoanMS.Tests.OfferWorkflow.OfferWorkflowTestEnv;
using S = LoanMS.Domain.Entities.OfferWorkflowStatuses;

namespace LoanMS.Tests.OfferWorkflow;

/// <summary>
/// End-to-end workflow scenarios (Section 5–18) through the real service on a
/// relational database: create → act → re-read from the DB → assert.
/// </summary>
public class OfferWorkflowServiceTests
{
    // Every offer at HDFC is inside policy (ROI floor 10%); every ICICI offer at
    // 12% breaches its 14% floor → Deviation Required.
    private static async Task<OfferWorkflowTestEnv> EnvWithRules()
    {
        var env = await CreateAsync();
        await env.AddRuleAsync(Hdfc, "ROI", "ROI_MIN_PCT", 10);
        await env.AddRuleAsync(Icici, "ROI", "ROI_MIN_PCT", 14);
        await env.AddRuleAsync(Idfc, "ROI", "ROI_MIN_PCT", 10);
        await env.AddRuleAsync(Incred, "ROI", "ROI_MIN_PCT", 10);
        return env;
    }

    private static async Task<(OfferWorkflowTestEnv env, Loan loan)> AtOfferStage()
    {
        var env = await EnvWithRules();
        var loan = await env.SeedLoanAsync();
        (await env.Svc.MoveToOfferAsync(loan.Id, null, C("LoginTeam"))).Success.Should().BeTrue();
        return (env, loan);
    }

    private static ApplicationOfferDto OfferOf(ApiResponseDto<LoanWorkflowDto> r, int bankId) => r.Data!.Offers.Single(o => o.BankId == bankId && o.IsActive);

    // ── Stage entry ──────────────────────────────────────────────────────────
    [Fact]
    public async Task MoveToOffer_BlockedUntilVerificationChecksDone()
    {
        using var env = await EnvWithRules();
        var loan = await env.SeedLoanAsync(checks: false);
        var r = await env.Svc.MoveToOfferAsync(loan.Id, null, C("LoginTeam"));
        r.ErrorCode.Should().Be(ApiErrorCodes.WorkflowStage);
        r.Message.Should().Contain("Documents check").And.Contain("FI report");
        (await env.StatusOf(loan.Id)).Should().Be(LoanStatus.UnderReview);

        await env.SetFlagsAsync(loan.Id, l => { l.DocumentChecked = l.IncomeChecked = l.BankChecked = l.EcsReturn = l.FiReportChecked = true; });
        (await env.Svc.MoveToOfferAsync(loan.Id, "ok", C("LoginTeam"))).Success.Should().BeTrue();
        (await env.StatusOf(loan.Id)).Should().Be(LoanStatus.Offer);
    }

    [Fact]
    public async Task OfferCannotBeCreatedBeforeOfferStage()
    {
        using var env = await EnvWithRules();
        var loan = await env.SeedLoanAsync();
        (await env.Svc.CreateOfferAsync(loan.Id, Offer(Hdfc), C("LoginTeam"))).ErrorCode.Should().Be(ApiErrorCodes.WorkflowStage);
    }

    // ── Offers: limits, lenders, persistence ────────────────────────────────
    [Fact]
    public async Task ThreeActiveOffers_FourthBlocked_DuplicateLenderBlocked_HistoricalDoesNotBlock()
    {
        var (env, loan) = await AtOfferStage();
        using var _ = env;
        var c = C("LoginTeam");
        (await env.Svc.CreateOfferAsync(loan.Id, Offer(Hdfc), c)).Success.Should().BeTrue();
        (await env.Svc.CreateOfferAsync(loan.Id, Offer(Hdfc, roi: 11.5m), c)).ErrorCode.Should().Be(ApiErrorCodes.OfferLimit);
        (await env.Svc.CreateOfferAsync(loan.Id, Offer(Icici), c)).Success.Should().BeTrue();
        var third = await env.Svc.CreateOfferAsync(loan.Id, Offer(Idfc), c);
        third.Success.Should().BeTrue();
        var fourth = await env.Svc.CreateOfferAsync(loan.Id, Offer(Incred), c);
        fourth.ErrorCode.Should().Be(ApiErrorCodes.OfferLimit);
        fourth.Message.Should().Contain("at most 3");

        // Withdraw HDFC → a historical (Withdrawn) offer never blocks a new active one, same lender included.
        var hdfc = OfferOf(third, Hdfc);
        (await env.Svc.WithdrawOfferAsync(loan.Id, hdfc.Id, new OfferActionRequestDto { Reason = "Customer declined", ExpectedVersion = hdfc.Version }, c)).Success.Should().BeTrue();
        (await env.Svc.CreateOfferAsync(loan.Id, Offer(Hdfc, roi: 11.75m), c)).Success.Should().BeTrue();

        env.Db.ChangeTracker.Clear();
        var rows = await env.Db.ApplicationOffers.Where(o => o.LoanId == loan.Id).ToListAsync();
        rows.Count(o => S.ActiveOfferStatuses.Contains(o.Status)).Should().Be(3);
        rows.Should().Contain(o => o.BankId == Hdfc && o.Status == S.OfferWithdrawn && o.StatusReason == "Customer declined");
    }

    // Regression (found in the browser walk-through 2026-09-25): offers added
    // after a final selection become NotSelected and must still count toward the
    // 3-offer / one-per-lender limits, otherwise unselecting the final offer would
    // restore more than 3 live offers.
    [Fact]
    public async Task NotSelectedOffers_CountTowardLimit_AndLenderUniqueness()
    {
        var (env, loan) = await AtOfferStage();
        using var _ = env;
        var c = C("LoginTeam");
        var hdfc = OfferOf(await env.Svc.CreateOfferAsync(loan.Id, Offer(Hdfc), c), Hdfc);
        await env.Svc.SelectOfferAsync(loan.Id, hdfc.Id, new OfferActionRequestDto(), C("Sales"));
        var r1 = await env.Svc.CreateOfferAsync(loan.Id, Offer(Icici), c);
        r1.Data!.Offers.Single(o => o.BankId == Icici).Should().Match<ApplicationOfferDto>(o => o.Status == S.OfferNotSelected && o.IsActive);
        (await env.Svc.CreateOfferAsync(loan.Id, Offer(Icici, roi: 13), c)).ErrorCode.Should().Be(ApiErrorCodes.OfferLimit, "same lender, still live");
        (await env.Svc.CreateOfferAsync(loan.Id, Offer(Idfc), c)).Success.Should().BeTrue();
        (await env.Svc.CreateOfferAsync(loan.Id, Offer(Incred), c)).ErrorCode.Should().Be(ApiErrorCodes.OfferLimit, "Final + 2 NotSelected = 3 live");
        var un = await env.Svc.UnselectOfferAsync(loan.Id, hdfc.Id, new OfferActionRequestDto { Reason = "compare again" }, C("Sales"));
        un.Success.Should().BeTrue();
        un.Data!.Offers.Where(o => o.IsActive).Should().HaveCount(3).And.OnlyContain(o => o.Status == S.OfferAvailable);
    }

    [Fact]
    public async Task DbBackstop_SecondActiveOfferSameLender_RejectedByUniqueIndex()
    {
        var (env, loan) = await AtOfferStage();
        using var _ = env;
        (await env.Svc.CreateOfferAsync(loan.Id, Offer(Hdfc), C("LoginTeam"))).Success.Should().BeTrue();
        env.Db.ApplicationOffers.Add(new ApplicationOffer
        {
            LoanId = loan.Id, BankId = Hdfc, LenderName = "HDFC Bank", ProductKey = "personal_loan", LoanType = "Personal",
            Status = S.OfferAvailable, DeviationStatus = S.DevRequired, ApprovalStatus = S.ApprovalPending, CreatedByUserId = Admin,
        });
        var act = () => env.Db.SaveChangesAsync();
        await act.Should().ThrowAsync<DbUpdateException>();
    }

    [Theory]
    [InlineData(InactiveBank)]
    [InlineData(HomeOnlyBank)]
    [InlineData(999)]
    public async Task OnlyActiveConfiguredLendersForTheProduct(int bankId)
    {
        var (env, loan) = await AtOfferStage();
        using var _ = env;
        (await env.Svc.CreateOfferAsync(loan.Id, Offer(bankId), C("LoginTeam"))).ErrorCode.Should().Be(ApiErrorCodes.Validation);
    }

    [Fact]
    public async Task OfferTerms_AreCalculatedAndPersistedByBackend_AndSurviveReload()
    {
        var (env, loan) = await AtOfferStage();
        using var _ = env;
        await env.Svc.CreateOfferAsync(loan.Id, Offer(Hdfc, pfBundled: true), C("LoginTeam"));
        env.Db.ChangeTracker.Clear();
        var rev = await env.Db.ApplicationOfferRevisions.SingleAsync();
        rev.ProcessingFeeAmount.Should().Be(5000m);
        rev.GstAmount.Should().Be(900m);
        rev.FinancedPrincipal.Should().Be(505900m);
        rev.Emi.Should().Be(LoanMS.Application.Services.EmiCalculator.ReducingBalance(505900m, 12m, 36));
        rev.NetDisbursement.Should().Be(500000m - 5000m - 500m);
        // Fresh read through the API model (what React shows after a refresh).
        var dto = (await env.Svc.GetAsync(loan.Id, C("LoginTeam"))).Data!;
        dto.Offers.Single().Current!.Emi.Should().Be(rev.Emi);
        dto.Offers.Single().DeviationStatus.Should().Be(S.DevNotRequired);
    }

    [Fact]
    public async Task InvalidTerms_AndNegativeNetDisbursement_Rejected()
    {
        var (env, loan) = await AtOfferStage();
        using var _ = env;
        (await env.Svc.CreateOfferAsync(loan.Id, Offer(Hdfc, amount: 0), C("LoginTeam"))).ErrorCode.Should().Be(ApiErrorCodes.Validation);
        (await env.Svc.CreateOfferAsync(loan.Id, Offer(Hdfc, amount: 100000, bt: 150000), C("LoginTeam"))).Message.Should().Contain("Net disbursement");
    }

    // ── Revision ─────────────────────────────────────────────────────────────
    [Fact]
    public async Task Revision_PreservesHistory_ReEvaluatesDeviation_StaleVersionBlocked()
    {
        var (env, loan) = await AtOfferStage();
        using var _ = env;
        var c = C("LoginTeam");
        var created = await env.Svc.CreateOfferAsync(loan.Id, Offer(Icici, roi: 12), c);
        var offer = OfferOf(created, Icici);
        offer.DeviationStatus.Should().Be(S.DevRequired);

        var same = await env.Svc.ReviseOfferAsync(loan.Id, offer.Id, Revise(offer, "no change"), c);
        same.ErrorCode.Should().Be(ApiErrorCodes.Validation);

        var revised = await env.Svc.ReviseOfferAsync(loan.Id, offer.Id, Revise(offer, "Lender matched ROI", r => r.OfferedRoi = 14.5m), c);
        revised.Success.Should().BeTrue();
        var o2 = OfferOf(revised, Icici);
        o2.CurrentRevisionNo.Should().Be(2);
        o2.DeviationStatus.Should().Be(S.DevNotRequired);
        o2.Revisions.Select(r => r.RevisionNo).Should().BeEquivalentTo(new[] { 1, 2 });
        o2.Revisions.Single(r => r.RevisionNo == 1).OfferedRoi.Should().Be(12m);

        // Stale ExpectedVersion (the pre-revision version) → 409, no silent overwrite.
        var stale = await env.Svc.ReviseOfferAsync(loan.Id, offer.Id, Revise(offer, "stale", r => r.OfferedRoi = 15m), c);
        stale.ErrorCode.Should().Be(ApiErrorCodes.ConcurrencyConflict);
        env.Db.ChangeTracker.Clear();
        (await env.Db.ApplicationOfferRevisions.CountAsync()).Should().Be(2);
    }

    // ── Final selection ──────────────────────────────────────────────────────
    [Fact]
    public async Task Select_AnyoneWithAccess_OthersNotSelected_UnselectRestores()
    {
        var (env, loan) = await AtOfferStage();
        using var _ = env;
        await env.Svc.CreateOfferAsync(loan.Id, Offer(Hdfc), C("LoginTeam"));
        var r = await env.Svc.CreateOfferAsync(loan.Id, Offer(Idfc), C("LoginTeam"));
        var hdfc = OfferOf(r, Hdfc);

        // A Business Development Executive (no offer-management rights) with access may confirm.
        var sel = await env.Svc.SelectOfferAsync(loan.Id, hdfc.Id, new OfferActionRequestDto { ExpectedVersion = hdfc.Version }, C("Sales"));
        sel.Success.Should().BeTrue();
        sel.Data!.Offers.Single(o => o.BankId == Hdfc).Status.Should().Be(S.OfferFinal);
        sel.Data.Offers.Single(o => o.BankId == Idfc).Status.Should().Be(S.OfferNotSelected);
        sel.Data.Offers.Single(o => o.BankId == Hdfc).SelectedRevisionNo.Should().Be(1);

        var idfc = sel.Data.Offers.Single(o => o.BankId == Idfc);
        (await env.Svc.SelectOfferAsync(loan.Id, idfc.Id, new OfferActionRequestDto(), C("Sales"))).ErrorCode.Should().Be(ApiErrorCodes.WorkflowStage);

        var un = await env.Svc.UnselectOfferAsync(loan.Id, hdfc.Id, new OfferActionRequestDto { Reason = "Customer prefers IDFC" }, C("Sales"));
        un.Data!.Offers.Should().OnlyContain(o => o.Status == S.OfferAvailable);
    }

    [Fact]
    public async Task ConcurrentSelection_StaleVersionLoses_AndDbAllowsOnlyOneFinal()
    {
        var (env, loan) = await AtOfferStage();
        using var _ = env;
        await env.Svc.CreateOfferAsync(loan.Id, Offer(Hdfc), C("LoginTeam"));
        var r = await env.Svc.CreateOfferAsync(loan.Id, Offer(Idfc), C("LoginTeam"));
        var hdfc = OfferOf(r, Hdfc); var idfc = OfferOf(r, Idfc);
        (await env.Svc.SelectOfferAsync(loan.Id, hdfc.Id, new OfferActionRequestDto { ExpectedVersion = hdfc.Version }, C("Sales"))).Success.Should().BeTrue();
        // The second user's screen still shows IDFC's old version.
        (await env.Svc.SelectOfferAsync(loan.Id, idfc.Id, new OfferActionRequestDto { ExpectedVersion = idfc.Version }, C("LoginTeam"))).Success.Should().BeFalse();

        // DB backstop: a second Final row is refused by the partial unique index.
        env.Db.ChangeTracker.Clear();
        var row = await env.Db.ApplicationOffers.FirstAsync(o => o.Id == idfc.Id);
        row.Status = S.OfferFinal; row.SelectedAt = DateTime.UtcNow; row.SelectedRevisionNo = 1;
        await ((Func<Task>)(() => env.Db.SaveChangesAsync())).Should().ThrowAsync<DbUpdateException>();
    }

    // ── Deviation ────────────────────────────────────────────────────────────
    [Fact]
    public async Task NoDeviation_CreditApprovalDirect_MakerCheckerEnforced()
    {
        var (env, loan) = await AtOfferStage();
        using var _ = env;
        var r = await env.Svc.CreateOfferAsync(loan.Id, Offer(Hdfc), C("LoginTeam")); // maker = Credit Evaluation Officer
        var o = OfferOf(r, Hdfc);
        await env.Svc.SelectOfferAsync(loan.Id, o.Id, new OfferActionRequestDto(), C("Sales"));

        var self = await env.Svc.CreditApprovalAsync(loan.Id, o.Id, new CreditApprovalRequestDto { Decision = "Approve", RevisionNo = 1 }, null, C("LoginTeam"));
        self.ErrorCode.Should().Be(ApiErrorCodes.SelfApproval);

        var ok = await env.Svc.CreditApprovalAsync(loan.Id, o.Id, new CreditApprovalRequestDto { Decision = "Approve", RevisionNo = 1, Comment = "OK" }, null, C("OperationManager"));
        ok.Success.Should().BeTrue();
        (await env.StatusOf(loan.Id)).Should().Be(LoanStatus.Approved);
        env.Db.ChangeTracker.Clear();
        var l = await env.Db.Loans.AsNoTracking().FirstAsync(x => x.Id == loan.Id);
        l.ApprovedAmount.Should().Be(500000m);
        l.MonthlyEmi.Should().Be(16607.15m);
        (await env.Db.CreditApprovals.SingleAsync()).DeviationStatusAtApproval.Should().Be(S.DevNotRequired);
    }

    [Fact]
    public async Task DeviationRequired_BlocksCreditApproval_UntilApproved_ByDifferentAuthority()
    {
        var (env, loan) = await AtOfferStage();
        using var _ = env;
        var o = OfferOf(await env.Svc.CreateOfferAsync(loan.Id, Offer(Icici), C("Manager")), Icici);
        await env.Svc.SelectOfferAsync(loan.Id, o.Id, new OfferActionRequestDto(), C("Sales"));

        (await env.Svc.CreditApprovalAsync(loan.Id, o.Id, new CreditApprovalRequestDto { Decision = "Approve", RevisionNo = 1 }, null, C("OperationManager")))
            .ErrorCode.Should().Be(ApiErrorCodes.DeviationUnresolved);

        // Raised by a Credit Evaluation Officer (an approver themself) → routed to an alternate.
        var raised = await env.Svc.RaiseDeviationAsync(loan.Id, o.Id, new RaiseOfferDeviationRequestDto { DeviationType = "ROI", Reason = "Salary account customer" }, "idem-raise-1", C("LoginTeam"));
        raised.Success.Should().BeTrue();
        (await env.StatusOf(loan.Id)).Should().Be(LoanStatus.Decision);
        var dev = raised.Data!.Deviations.Single();
        dev.AssignedApproverId.Should().NotBe(Ceo);
        dev.AssignedApproverId.Should().Be(Cem, "the application's Credit Evaluation Manager is preferred");
        dev.AssignmentState.Should().Be("Escalated");
        dev.Flags!.Should().Contain(f => f.DeviationType == "ROI" && f.Status == "Breach");
        env.Db.ChangeTracker.Clear();
        (await env.Db.Tasks.SingleAsync(t => t.LoanId == loan.Id)).AssignedToUserId.Should().Be(Cem);

        // Idempotent replay of the same raise → no second request.
        (await env.Svc.RaiseDeviationAsync(loan.Id, o.Id, new RaiseOfferDeviationRequestDto { DeviationType = "ROI", Reason = "dup" }, "idem-raise-1", C("LoginTeam"))).Success.Should().BeTrue();
        env.Db.ChangeTracker.Clear();
        (await env.Db.OfferDeviations.CountAsync()).Should().Be(1);

        // Raiser cannot approve; a non-authority role cannot decide at all.
        (await env.Svc.DecideDeviationAsync(loan.Id, dev.Id, new DecideOfferDeviationRequestDto { Approve = true }, null, C("LoginTeam")))
            .ErrorCode.Should().Be(ApiErrorCodes.SelfApproval);
        (await env.Svc.DecideDeviationAsync(loan.Id, dev.Id, new DecideOfferDeviationRequestDto { Approve = true }, null, C("Manager")))
            .ErrorCode.Should().Be(ApiErrorCodes.Forbidden);

        var decided = await env.Svc.DecideDeviationAsync(loan.Id, dev.Id, new DecideOfferDeviationRequestDto { Approve = true, Comment = "Within zonal comfort" }, "idem-dec-1", C("OperationManager"));
        decided.Success.Should().BeTrue();
        (await env.StatusOf(loan.Id)).Should().Be(LoanStatus.Offer, "deviation approval is not credit approval");
        decided.Data!.Offers.Single(x => x.Id == o.Id).DeviationStatus.Should().Be(S.DevApproved);
        env.Db.ChangeTracker.Clear();
        (await env.Db.Tasks.SingleAsync(t => t.LoanId == loan.Id)).IsCompleted.Should().BeTrue();

        var approved = await env.Svc.CreditApprovalAsync(loan.Id, o.Id, new CreditApprovalRequestDto { Decision = "Approve", RevisionNo = 1 }, null, C("LocationHead"));
        approved.Success.Should().BeTrue();
        (await env.StatusOf(loan.Id)).Should().Be(LoanStatus.Approved);
    }

    [Fact]
    public async Task AdminCannotApproveOwnDeviation()
    {
        var (env, loan) = await AtOfferStage();
        using var _ = env;
        var o = OfferOf(await env.Svc.CreateOfferAsync(loan.Id, Offer(Icici), C("Manager")), Icici);
        await env.Svc.SelectOfferAsync(loan.Id, o.Id, new OfferActionRequestDto(), C("Sales"));
        var dev = (await env.Svc.RaiseDeviationAsync(loan.Id, o.Id, new RaiseOfferDeviationRequestDto { DeviationType = "ROI", Reason = "x" }, null, C("Admin"))).Data!.Deviations.Single();
        (await env.Svc.DecideDeviationAsync(loan.Id, dev.Id, new DecideOfferDeviationRequestDto { Approve = true }, null, C("Admin")))
            .ErrorCode.Should().Be(ApiErrorCodes.SelfApproval);
    }

    [Fact]
    public async Task RejectedDeviation_CannotBeReRaisedOnSameTerms_NewRevisionAllowsNewRequest()
    {
        var (env, loan) = await AtOfferStage();
        using var _ = env;
        var o = OfferOf(await env.Svc.CreateOfferAsync(loan.Id, Offer(Icici), C("Manager")), Icici);
        await env.Svc.SelectOfferAsync(loan.Id, o.Id, new OfferActionRequestDto(), C("Sales"));
        var dev = (await env.Svc.RaiseDeviationAsync(loan.Id, o.Id, new RaiseOfferDeviationRequestDto { DeviationType = "ROI", Reason = "x" }, null, C("Manager"))).Data!.Deviations.Single();
        (await env.Svc.DecideDeviationAsync(loan.Id, dev.Id, new DecideOfferDeviationRequestDto { Approve = false }, null, C("OperationManager")))
            .ErrorCode.Should().Be(ApiErrorCodes.Validation, "a rejection needs a comment");
        var rej = await env.Svc.DecideDeviationAsync(loan.Id, dev.Id, new DecideOfferDeviationRequestDto { Approve = false, Comment = "ROI too low" }, null, C("OperationManager"));
        rej.Success.Should().BeTrue();
        (await env.StatusOf(loan.Id)).Should().Be(LoanStatus.Offer, "a rejected deviation does not reject the application");
        var off = OfferOf(rej, Icici);
        off.DeviationStatus.Should().Be(S.DevRejected);

        (await env.Svc.RaiseDeviationAsync(loan.Id, o.Id, new RaiseOfferDeviationRequestDto { DeviationType = "ROI", Reason = "again" }, null, C("Manager")))
            .ErrorCode.Should().Be(ApiErrorCodes.WorkflowStage);

        var rev = await env.Svc.ReviseOfferAsync(loan.Id, o.Id, Revise(off, "Negotiated", r => r.OfferedRoi = 13m), C("Manager"));
        OfferOf(rev, Icici).DeviationStatus.Should().Be(S.DevRequired);
        (await env.Svc.RaiseDeviationAsync(loan.Id, o.Id, new RaiseOfferDeviationRequestDto { DeviationType = "ROI", Reason = "revised" }, null, C("Manager"))).Success.Should().BeTrue();
        env.Db.ChangeTracker.Clear();
        var all = await env.Db.OfferDeviations.OrderBy(d => d.Id).ToListAsync();
        all.Should().HaveCount(2);
        all[0].Status.Should().Be(S.RequestRejected, "the old request stays permanently rejected / auditable");
        all[1].RevisionNo.Should().Be(2);
    }

    [Fact]
    public async Task Skip_IsAuthorizedHumanBypass_DistinctFromNotRequired()
    {
        var (env, loan) = await AtOfferStage();
        using var _ = env;
        var icici = OfferOf(await env.Svc.CreateOfferAsync(loan.Id, Offer(Icici), C("Manager")), Icici);
        await env.Svc.SelectOfferAsync(loan.Id, icici.Id, new OfferActionRequestDto(), C("Sales"));
        (await env.Svc.SkipDeviationAsync(loan.Id, icici.Id, new OfferActionRequestDto { Reason = "x" }, C("Manager"))).ErrorCode.Should().Be(ApiErrorCodes.Forbidden);
        (await env.Svc.SkipDeviationAsync(loan.Id, icici.Id, new OfferActionRequestDto(), C("OperationManager"))).ErrorCode.Should().Be(ApiErrorCodes.Validation);
        var skipped = await env.Svc.SkipDeviationAsync(loan.Id, icici.Id, new OfferActionRequestDto { Reason = "Board-approved scheme" }, C("OperationManager"));
        skipped.Success.Should().BeTrue();
        OfferOf(skipped, Icici).DeviationStatus.Should().Be(S.DevSkipped);
        var rec = skipped.Data!.Deviations.Single();
        rec.Status.Should().Be(S.RequestSkipped);
        rec.RaisedByUserId.Should().Be(Cem);
        rec.Reason.Should().Be("Board-approved scheme");

        // An offer that needs no deviation cannot be "skipped" — NotRequired ≠ Skipped.
        await env.Svc.UnselectOfferAsync(loan.Id, icici.Id, new OfferActionRequestDto { Reason = "switch" }, C("Sales"));
        var hdfc = OfferOf(await env.Svc.CreateOfferAsync(loan.Id, Offer(Hdfc), C("Manager")), Hdfc);
        await env.Svc.SelectOfferAsync(loan.Id, hdfc.Id, new OfferActionRequestDto(), C("Sales"));
        var r = await env.Svc.SkipDeviationAsync(loan.Id, hdfc.Id, new OfferActionRequestDto { Reason = "x" }, C("OperationManager"));
        r.ErrorCode.Should().Be(ApiErrorCodes.WorkflowStage);
        r.Message.Should().Contain("No deviation is required");
    }

    [Fact]
    public async Task NoEligibleAlternateApprover_IsEscalated_NeverSelfAssigned()
    {
        var (env, loan) = await AtOfferStage();
        using var _ = env;
        // Deactivate every approver except the raiser (Admin).
        foreach (var u in await env.Db.Users.Where(u => u.Id != Admin).ToListAsync()) u.IsActive = false;
        await env.Db.SaveChangesAsync(); env.Db.ChangeTracker.Clear();
        var o = OfferOf(await env.Svc.CreateOfferAsync(loan.Id, Offer(Icici), C("Admin")), Icici);
        await env.Svc.SelectOfferAsync(loan.Id, o.Id, new OfferActionRequestDto(), C("Admin"));
        var r = await env.Svc.RaiseDeviationAsync(loan.Id, o.Id, new RaiseOfferDeviationRequestDto { DeviationType = "ROI", Reason = "x" }, null, C("Admin"));
        var dev = r.Data!.Deviations.Single();
        dev.AssignedApproverId.Should().BeNull();
        dev.AssignmentState.Should().Be("Escalated");
    }

    [Fact]
    public async Task MissingBureauCibil_FailClosed_ForcesDeviation()
    {
        using var env = await CreateAsync();
        await env.AddRuleAsync(Hdfc, "CIBIL", "CIBIL_MIN", 700);
        var loan = await env.SeedLoanAsync(cibil: 820); // declared only — no bureau report on file
        await env.Svc.MoveToOfferAsync(loan.Id, null, C("LoginTeam"));
        var o = OfferOf(await env.Svc.CreateOfferAsync(loan.Id, Offer(Hdfc), C("LoginTeam")), Hdfc);
        o.DeviationStatus.Should().Be(S.DevRequired);
        o.Evaluation!.Checks.Single().Status.Should().Be("MissingData");

        // Uploading the bureau report (the only trusted CIBIL source) re-checks the live offers.
        var up = await env.Svc.UploadBureauReportAsync(loan.Id, PdfReport(780), C("LoginTeam"));
        up.Success.Should().BeTrue();
        var after = OfferOf(up, Hdfc);
        after.DeviationStatus.Should().Be(S.DevNotRequired);
        after.CurrentRevisionNo.Should().Be(1, "the revision snapshot is kept; the latest evaluation is stored on the offer");
        up.Data!.BureauReport!.CreditScore.Should().Be(780);
    }

    [Fact]
    public async Task RuleChangedAfterRevision_CreditApprovalReEvaluates_AndBlocks()
    {
        var (env, loan) = await AtOfferStage();
        using var _ = env;
        var o = OfferOf(await env.Svc.CreateOfferAsync(loan.Id, Offer(Hdfc), C("LoginTeam")), Hdfc);
        await env.Svc.SelectOfferAsync(loan.Id, o.Id, new OfferActionRequestDto(), C("Sales"));
        await env.AddRuleAsync(Hdfc, "FOIR", "FOIR_MAX_PCT", 20); // FOIR is 30% in the stub
        var r = await env.Svc.CreditApprovalAsync(loan.Id, o.Id, new CreditApprovalRequestDto { Decision = "Approve", RevisionNo = 1 }, null, C("OperationManager"));
        r.ErrorCode.Should().Be(ApiErrorCodes.DeviationUnresolved);
        env.Db.ChangeTracker.Clear();
        (await env.Db.ApplicationOffers.SingleAsync()).DeviationStatus.Should().Be(S.DevRequired, "the corrected status is persisted");
        (await env.StatusOf(loan.Id)).Should().Be(LoanStatus.Offer);
    }

    // ── Expiry ───────────────────────────────────────────────────────────────
    [Fact]
    public async Task ExpiredOffer_InvalidForSelectionAndApproval()
    {
        var (env, loan) = await AtOfferStage();
        using var _ = env;
        var o = OfferOf(await env.Svc.CreateOfferAsync(loan.Id, Offer(Hdfc, validUntil: DateTime.UtcNow.Date.AddDays(1)), C("LoginTeam")), Hdfc);
        await env.Svc.SelectOfferAsync(loan.Id, o.Id, new OfferActionRequestDto(), C("Sales"));
        // Validity passes.
        var row = await env.Db.ApplicationOffers.FirstAsync(x => x.Id == o.Id);
        row.ValidUntil = DateTime.UtcNow.AddDays(-1);
        await env.Db.SaveChangesAsync(); env.Db.ChangeTracker.Clear();

        var view = await env.Svc.GetAsync(loan.Id, C("Sales"));
        view.Data!.Offers.Single().Status.Should().Be(S.OfferExpired);
        (await env.Svc.CreditApprovalAsync(loan.Id, o.Id, new CreditApprovalRequestDto { Decision = "Approve", RevisionNo = 1 }, null, C("OperationManager")))
            .ErrorCode.Should().Be(ApiErrorCodes.WorkflowStage);
        (await env.Svc.SelectOfferAsync(loan.Id, o.Id, new OfferActionRequestDto(), C("Sales"))).ErrorCode.Should().Be(ApiErrorCodes.WorkflowStage);
    }

    [Fact]
    public async Task DeclinedTerms_CannotBeApproved_UntilRevised()
    {
        var (env, loan) = await AtOfferStage();
        using var _ = env;
        var o = OfferOf(await env.Svc.CreateOfferAsync(loan.Id, Offer(Hdfc), C("LoginTeam")), Hdfc);
        await env.Svc.SelectOfferAsync(loan.Id, o.Id, new OfferActionRequestDto(), C("Sales"));
        (await env.Svc.CreditApprovalAsync(loan.Id, o.Id, new CreditApprovalRequestDto { Decision = "Reject", RevisionNo = 1 }, null, C("OperationManager")))
            .ErrorCode.Should().Be(ApiErrorCodes.Validation, "declining needs a comment");
        var dec = await env.Svc.CreditApprovalAsync(loan.Id, o.Id, new CreditApprovalRequestDto { Decision = "Reject", RevisionNo = 1, Comment = "Income unstable" }, null, C("OperationManager"));
        dec.Success.Should().BeTrue();
        (await env.StatusOf(loan.Id)).Should().Be(LoanStatus.Offer);
        (await env.Svc.CreditApprovalAsync(loan.Id, o.Id, new CreditApprovalRequestDto { Decision = "Approve", RevisionNo = 1 }, null, C("LocationHead")))
            .ErrorCode.Should().Be(ApiErrorCodes.WorkflowStage);
        var off = OfferOf(dec, Hdfc);
        await env.Svc.ReviseOfferAsync(loan.Id, o.Id, Revise(off, "Lower amount", r => r.LoanAmount = 400000), C("LoginTeam"));
        (await env.Svc.CreditApprovalAsync(loan.Id, o.Id, new CreditApprovalRequestDto { Decision = "Approve", RevisionNo = 2 }, null, C("LocationHead")))
            .Success.Should().BeTrue();
    }

    [Fact]
    public async Task CreditApproval_RevisionMismatch_IsConflict()
    {
        var (env, loan) = await AtOfferStage();
        using var _ = env;
        var o = OfferOf(await env.Svc.CreateOfferAsync(loan.Id, Offer(Hdfc), C("LoginTeam")), Hdfc);
        await env.Svc.SelectOfferAsync(loan.Id, o.Id, new OfferActionRequestDto(), C("Sales"));
        (await env.Svc.CreditApprovalAsync(loan.Id, o.Id, new CreditApprovalRequestDto { Decision = "Approve", RevisionNo = 7 }, null, C("OperationManager")))
            .ErrorCode.Should().Be(ApiErrorCodes.ConcurrencyConflict);
    }

    // ── Full chain: approval → sanction → disbursement → reversal ────────────
    private static async Task<(OfferWorkflowTestEnv env, Loan loan, int offerId)> Approved()
    {
        var (env, loan) = await AtOfferStage();
        var o = OfferOf(await env.Svc.CreateOfferAsync(loan.Id, Offer(Hdfc), C("LoginTeam")), Hdfc);
        await env.Svc.SelectOfferAsync(loan.Id, o.Id, new OfferActionRequestDto(), C("Sales"));
        (await env.Svc.CreditApprovalAsync(loan.Id, o.Id, new CreditApprovalRequestDto { Decision = "Approve", RevisionNo = 1 }, null, C("OperationManager"))).Success.Should().BeTrue();
        return (env, loan, o.Id);
    }

    [Fact]
    public async Task Sanction_OnlyFourRoles_OneActive_ImmutableSnapshot_UniqueNumber()
    {
        var (env, loan, offerId) = await Approved();
        using var _ = env;
        (await env.Svc.GenerateSanctionAsync(loan.Id, null, C("Manager"))).ErrorCode.Should().Be(ApiErrorCodes.Forbidden);
        var s1 = await env.Svc.GenerateSanctionAsync(loan.Id, "idem-san-1", C("LoginTeam"));
        s1.Success.Should().BeTrue();
        (await env.Svc.GenerateSanctionAsync(loan.Id, "idem-san-1", C("LoginTeam"))).Success.Should().BeTrue("idempotent replay");
        (await env.Svc.GenerateSanctionAsync(loan.Id, null, C("LoginTeam"))).ErrorCode.Should().Be(ApiErrorCodes.WorkflowStage);
        env.Db.ChangeTracker.Clear();
        var s = await env.Db.Sanctions.SingleAsync();
        s.SanctionNumber.Should().StartWith("SAN-").And.EndWith("-01");
        s.NetDisbursement.Should().Be(500000m - 5900m - 5000m - 500m);
        s.Emi.Should().Be(16607.15m);
        (await env.Db.LoanSanctionDetails.SingleAsync()).SanctionEmi.Should().Be(16607.15m, "the Overview panel mirrors the sanction");

        // Approved terms can no longer be edited while the sanction is active.
        var o = (await env.Svc.GetAsync(loan.Id, C("Admin"))).Data!.Offers.Single(x => x.Id == offerId);
        (await env.Svc.ReviseOfferAsync(loan.Id, offerId, Revise(o, "late change", r => r.TenureMonths = 48), C("OperationManager")))
            .ErrorCode.Should().Be(ApiErrorCodes.WorkflowStage);
    }

    [Fact]
    public async Task EditApprovedTerms_BeforeSanction_ReturnsToOffer_AndNeedsNewApproval()
    {
        var (env, loan, offerId) = await Approved();
        using var _ = env;
        var o = (await env.Svc.GetAsync(loan.Id, C("Admin"))).Data!.Offers.Single(x => x.Id == offerId);
        (await env.Svc.ReviseOfferAsync(loan.Id, offerId, Revise(o, "x", r => r.TenureMonths = 48), C("Manager"))).ErrorCode.Should().Be(ApiErrorCodes.Forbidden);
        var r = await env.Svc.ReviseOfferAsync(loan.Id, offerId, Revise(o, "Approver reduced tenure", r => r.TenureMonths = 30), C("OperationManager"));
        r.Success.Should().BeTrue();
        (await env.StatusOf(loan.Id)).Should().Be(LoanStatus.Offer);
        var off = r.Data!.Offers.Single(x => x.Id == offerId);
        off.ApprovalStatus.Should().Be(S.ApprovalPending);
        off.CurrentRevisionNo.Should().Be(2);
        r.Data.CreditApprovals.Single().IsCurrent.Should().BeFalse();
        // The approver who changed the terms cannot also approve them (maker-checker).
        (await env.Svc.CreditApprovalAsync(loan.Id, offerId, new CreditApprovalRequestDto { Decision = "Approve", RevisionNo = 2 }, null, C("OperationManager")))
            .ErrorCode.Should().Be(ApiErrorCodes.SelfApproval);
        (await env.Svc.CreditApprovalAsync(loan.Id, offerId, new CreditApprovalRequestDto { Decision = "Approve", RevisionNo = 2 }, null, C("LocationHead")))
            .Success.Should().BeTrue();
    }

    [Fact]
    public async Task Disbursement_Gates_Record_Reversal()
    {
        var (env, loan, _) = await Approved();
        using var __ = env;
        (await env.Svc.CreateDisbursementAsync(loan.Id, Disb(1000), null, C("LoginTeam"))).Message.Should().Contain("No active sanction");
        await env.Svc.GenerateSanctionAsync(loan.Id, null, C("LoginTeam"));
        var net = 500000m - 5900m - 5000m - 500m;
        (await env.Svc.CreateDisbursementAsync(loan.Id, Disb(net), null, C("LoginTeam"))).Message.Should().Contain("Nach and Customer Agreement");
        await env.SetFlagsAsync(loan.Id, l => { l.NachDone = true; l.CustomerAgreementDone = true; });
        // "Correct bank details": only an account verified by the Bank Details Check ("Okay to Process").
        (await env.Svc.CreateDisbursementAsync(loan.Id, Disb(net), null, C("LoginTeam"))).Message.Should().Contain("not verified");
        await env.SeedVerifiedBankCheckAsync(loan.Id, acct: "999999999999", result: "Mismatch / Rejected");
        (await env.Svc.CreateDisbursementAsync(loan.Id, Disb(net), null, C("LoginTeam"))).Message.Should().Contain("not verified");
        await env.SeedVerifiedBankCheckAsync(loan.Id, acct: "999999999999");
        (await env.Svc.CreateDisbursementAsync(loan.Id, Disb(net), null, C("LoginTeam"))).Message.Should().Contain("does not match");
        await env.SeedVerifiedBankCheckAsync(loan.Id);
        (await env.Svc.CreateDisbursementAsync(loan.Id, Disb(net + 1), null, C("LoginTeam"))).Message.Should().Contain("exceeds");
        var badIfsc = Disb(net); badIfsc.Ifsc = "HDFC1";
        (await env.Svc.CreateDisbursementAsync(loan.Id, badIfsc, null, C("LoginTeam"))).ErrorCode.Should().Be(ApiErrorCodes.Validation);
        (await env.Svc.CreateDisbursementAsync(loan.Id, Disb(net), null, C("Manager"))).ErrorCode.Should().Be(ApiErrorCodes.Forbidden);

        var d = await env.Svc.CreateDisbursementAsync(loan.Id, Disb(net), "idem-disb-1", C("LoginTeam"));
        d.Success.Should().BeTrue();
        (await env.Svc.CreateDisbursementAsync(loan.Id, Disb(net), "idem-disb-1", C("LoginTeam"))).Success.Should().BeTrue("idempotent replay");
        (await env.StatusOf(loan.Id)).Should().Be(LoanStatus.Disbursed);
        d.Data!.Disbursements.Single().BankAccountNumber.Should().Be("XXXXXXXX9012");
        env.Db.ChangeTracker.Clear();
        (await env.Db.Disbursements.CountAsync()).Should().Be(1);

        // A disbursed sanction cannot be cancelled.
        var sid = (await env.Db.Sanctions.SingleAsync()).Id;
        (await env.Svc.CancelSanctionAsync(loan.Id, sid, new CancelSanctionRequestDto { Reason = "x", CancellationType = "Revoke" }, C("LoginTeam")))
            .Success.Should().BeFalse();

        var rev = await env.Svc.ReverseDisbursementAsync(loan.Id, d.Data.Disbursements.Single().Id, new ReverseDisbursementRequestDto { Reason = "Wrong beneficiary account" }, C("OperationManager"));
        rev.Success.Should().BeTrue();
        (await env.StatusOf(loan.Id)).Should().Be(LoanStatus.Approved);
        env.Db.ChangeTracker.Clear();
        var rows = await env.Db.Disbursements.OrderBy(x => x.Id).ToListAsync();
        rows.Should().HaveCount(2, "the original disbursement is never deleted");
        rows[0].Status.Should().Be(S.DisbursementReversed);
        rows[1].Type.Should().Be(S.TypeReversal);
        rows[1].ReversalOfId.Should().Be(rows[0].Id);
    }

    [Fact]
    public async Task SanctionAmendment_ReturnsToOffer_ReSanctionIsNewVersion()
    {
        var (env, loan, offerId) = await Approved();
        using var _ = env;
        await env.Svc.GenerateSanctionAsync(loan.Id, null, C("LoginTeam"));
        env.Db.ChangeTracker.Clear();
        var s1 = await env.Db.Sanctions.SingleAsync();
        (await env.Svc.CancelSanctionAsync(loan.Id, s1.Id, new CancelSanctionRequestDto { Reason = "", CancellationType = "Amendment" }, C("LoginTeam"))).ErrorCode.Should().Be(ApiErrorCodes.Validation);
        var c = await env.Svc.CancelSanctionAsync(loan.Id, s1.Id, new CancelSanctionRequestDto { Reason = "Stamp duty correction", CancellationType = "Amendment" }, C("LoginTeam"));
        c.Success.Should().BeTrue();
        (await env.StatusOf(loan.Id)).Should().Be(LoanStatus.Offer);

        var o = c.Data!.Offers.Single(x => x.Id == offerId);
        await env.Svc.ReviseOfferAsync(loan.Id, offerId, Revise(o, "Stamp duty corrected", r => r.StampDuty = 750), C("LoginTeam"));
        (await env.Svc.CreditApprovalAsync(loan.Id, offerId, new CreditApprovalRequestDto { Decision = "Approve", RevisionNo = 2 }, null, C("OperationManager"))).Success.Should().BeTrue();
        (await env.Svc.GenerateSanctionAsync(loan.Id, null, C("LocationHead"))).Success.Should().BeTrue();
        env.Db.ChangeTracker.Clear();
        var all = await env.Db.Sanctions.OrderBy(x => x.Id).ToListAsync();
        all.Should().HaveCount(2);
        all[0].Status.Should().Be(S.SanctionCancelled);
        all[0].CancellationType.Should().Be("Amendment");
        all[1].SanctionVersion.Should().Be(2);
        all[1].PreviousSanctionId.Should().Be(all[0].Id);
        all[1].StampDuty.Should().Be(750m);
    }

    [Fact]
    public async Task DbBackstop_SecondActiveSanction_Refused()
    {
        var (env, loan, _) = await Approved();
        using var __ = env;
        await env.Svc.GenerateSanctionAsync(loan.Id, null, C("LoginTeam"));
        env.Db.ChangeTracker.Clear();
        var s = await env.Db.Sanctions.AsNoTracking().SingleAsync();
        s.Id = 0; s.SanctionNumber = "SAN-DUP"; s.IdempotencyKey = null;
        env.Db.Sanctions.Add(s);
        await ((Func<Task>)(() => env.Db.SaveChangesAsync())).Should().ThrowAsync<DbUpdateException>();
    }

    // ── Application Reject / Reopen / Hold / Back cascade ────────────────────
    [Fact]
    public async Task RejectAfterSanction_CancelsSanction_ReopenResumesAtOffer()
    {
        var (env, loan, offerId) = await Approved();
        using var _ = env;
        await env.Svc.GenerateSanctionAsync(loan.Id, null, C("LoginTeam"));
        var rej = await env.Loans.UpdateStatusAsync(loan.Id, new UpdateLoanStatusRequestDto { NewStatus = LoanStatus.Rejected, Comment = "Customer backed out" }, Admin, "Admin");
        rej.Success.Should().BeTrue();
        env.Db.ChangeTracker.Clear();
        (await env.Db.Sanctions.SingleAsync()).Status.Should().Be(S.SanctionCancelled);
        (await env.Db.CreditApprovals.SingleAsync()).IsCurrent.Should().BeFalse();
        (await env.Db.ApplicationOffers.SingleAsync()).Status.Should().Be(S.OfferFinal, "offers are frozen, history kept");

        // Frozen: nothing moves on a rejected application.
        (await env.Svc.GenerateSanctionAsync(loan.Id, null, C("LoginTeam"))).ErrorCode.Should().Be(ApiErrorCodes.WorkflowStage);

        var reo = await env.Loans.ReopenAsync(loan.Id, "Customer returned", Admin, "Admin");
        reo.Success.Should().BeTrue();
        (await env.StatusOf(loan.Id)).Should().Be(LoanStatus.Offer, "downstream revalidation: approval + sanction must be redone");
        env.Db.ChangeTracker.Clear();
        (await env.Db.ApplicationOffers.SingleAsync()).ApprovalStatus.Should().Be(S.ApprovalPending);
    }

    [Fact]
    public async Task RejectWhileDeviationPending_ClosesRequestAndTask()
    {
        var (env, loan) = await AtOfferStage();
        using var _ = env;
        var o = OfferOf(await env.Svc.CreateOfferAsync(loan.Id, Offer(Icici), C("Manager")), Icici);
        await env.Svc.SelectOfferAsync(loan.Id, o.Id, new OfferActionRequestDto(), C("Sales"));
        await env.Svc.RaiseDeviationAsync(loan.Id, o.Id, new RaiseOfferDeviationRequestDto { DeviationType = "ROI", Reason = "x" }, null, C("Manager"));
        (await env.Loans.UpdateStatusAsync(loan.Id, new UpdateLoanStatusRequestDto { NewStatus = LoanStatus.Rejected, Comment = "Policy" }, Admin, "Admin")).Success.Should().BeTrue();
        env.Db.ChangeTracker.Clear();
        var d = await env.Db.OfferDeviations.SingleAsync();
        d.Status.Should().Be(S.RequestClosed);
        d.ClosedReason.Should().Contain("rejected");
        (await env.Db.Tasks.SingleAsync()).IsCompleted.Should().BeTrue();
    }

    [Fact]
    public async Task Hold_FreezesEveryWorkflowAction()
    {
        var (env, loan) = await AtOfferStage();
        using var _ = env;
        var o = OfferOf(await env.Svc.CreateOfferAsync(loan.Id, Offer(Hdfc), C("LoginTeam")), Hdfc);
        (await env.Loans.HoldAsync(loan.Id, "Awaiting documents", Admin, "Admin")).Success.Should().BeTrue();
        (await env.Svc.CreateOfferAsync(loan.Id, Offer(Idfc), C("LoginTeam"))).ErrorCode.Should().Be(ApiErrorCodes.WorkflowStage);
        (await env.Svc.SelectOfferAsync(loan.Id, o.Id, new OfferActionRequestDto(), C("Sales"))).ErrorCode.Should().Be(ApiErrorCodes.WorkflowStage);
        (await env.Svc.CreditApprovalAsync(loan.Id, o.Id, new CreditApprovalRequestDto { Decision = "Approve", RevisionNo = 1 }, null, C("OperationManager"))).ErrorCode.Should().Be(ApiErrorCodes.WorkflowStage);
        (await env.Loans.UnholdAsync(loan.Id, null, Admin, "Admin")).Success.Should().BeTrue();
        (await env.StatusOf(loan.Id)).Should().Be(LoanStatus.Offer);
    }

    [Fact]
    public async Task BackToUnderwriting_ClearsSelection_ClosesOpenDeviation()
    {
        var (env, loan) = await AtOfferStage();
        using var _ = env;
        var r = await env.Svc.CreateOfferAsync(loan.Id, Offer(Icici), C("Manager"));
        await env.Svc.CreateOfferAsync(loan.Id, Offer(Hdfc), C("Manager"));
        var o = OfferOf(r, Icici);
        await env.Svc.SelectOfferAsync(loan.Id, o.Id, new OfferActionRequestDto(), C("Sales"));
        var raised = await env.Svc.RaiseDeviationAsync(loan.Id, o.Id, new RaiseOfferDeviationRequestDto { DeviationType = "ROI", Reason = "x" }, null, C("Manager"));
        // At Decision the application cannot go back until the deviation is decided.
        (await env.Svc.BackToUnderwritingAsync(loan.Id, "recheck income", C("Manager"))).ErrorCode.Should().Be(ApiErrorCodes.WorkflowStage);
        await env.Svc.DecideDeviationAsync(loan.Id, raised.Data!.Deviations.Single().Id, new DecideOfferDeviationRequestDto { Approve = true }, null, C("OperationManager"));
        (await env.Svc.BackToUnderwritingAsync(loan.Id, "", C("Manager"))).ErrorCode.Should().Be(ApiErrorCodes.Validation);
        var back = await env.Svc.BackToUnderwritingAsync(loan.Id, "Income re-verification", C("Manager"));
        back.Success.Should().BeTrue();
        (await env.StatusOf(loan.Id)).Should().Be(LoanStatus.UnderReview);
        back.Data!.Offers.Should().OnlyContain(x => x.Status == S.OfferAvailable && x.ApprovalStatus == S.ApprovalPending);
    }

    [Fact]
    public async Task GenericStatusRoute_CannotBypassTheChain_AndAcceptanceNeedsSanction()
    {
        var (env, loan, _) = await Approved();
        using var __ = env;
        (await env.Loans.UpdateStatusAsync(loan.Id, new UpdateLoanStatusRequestDto { NewStatus = LoanStatus.Disbursed }, Admin, "Admin"))
            .ErrorCode.Should().Be(ApiErrorCodes.WorkflowStage);
        (await env.Loans.UpdateStatusAsync(loan.Id, new UpdateLoanStatusRequestDto { NewStatus = LoanStatus.Acceptance }, Admin, "Admin"))
            .Message.Should().Contain("sanction");
        await env.Svc.GenerateSanctionAsync(loan.Id, null, C("LoginTeam"));
        (await env.Loans.UpdateStatusAsync(loan.Id, new UpdateLoanStatusRequestDto { NewStatus = LoanStatus.Acceptance }, Admin, "Admin")).Success.Should().BeTrue();
        (await env.Loans.OverrideStatusAsync(loan.Id, LoanStatus.UnderReview, "force", Admin, "Admin")).Success.Should().BeFalse("an active sanction may not be stranded");
    }

    // ── Security: IDOR + field masking ───────────────────────────────────────
    [Fact]
    public async Task OutOfScope_Is404_InScopeWithoutRole_Is403()
    {
        var (env, loan) = await AtOfferStage();
        using var _ = env;
        // Payout & Reconciliation Officer sees only Approved/Disbursed applications → Offer-stage app is out of scope.
        (await env.Svc.GetAsync(loan.Id, C("Accounts"))).ErrorCode.Should().Be(ApiErrorCodes.NotFound);
        (await env.Svc.CreateOfferAsync(loan.Id, Offer(Hdfc), C("Accounts"))).ErrorCode.Should().Be(ApiErrorCodes.NotFound);
        (await env.Svc.GetAsync(999999, C("Admin"))).ErrorCode.Should().Be(ApiErrorCodes.NotFound);
        // A Business Development Executive can see it but cannot key offers.
        (await env.Svc.CreateOfferAsync(loan.Id, Offer(Hdfc), C("Sales"))).ErrorCode.Should().Be(ApiErrorCodes.Forbidden);
        // Another application's offer id through this application's route is not found.
        var other = await env.SeedLoanAsync(LoanStatus.Offer);
        var theirs = OfferOf(await env.Svc.CreateOfferAsync(other.Id, Offer(Hdfc), C("LoginTeam")), Hdfc);
        (await env.Svc.SelectOfferAsync(loan.Id, theirs.Id, new OfferActionRequestDto(), C("LoginTeam"))).ErrorCode.Should().Be(ApiErrorCodes.NotFound);
    }

    [Theory]
    [InlineData("Partner")]
    [InlineData("Dsa")]
    public async Task ChannelPartners_SeeMaskedInternalFields(string role)
    {
        var (env, loan) = await AtOfferStage();
        using var _ = env;
        var o = OfferOf(await env.Svc.CreateOfferAsync(loan.Id, Offer(Icici, baseRoi: 15), C("Manager")), Icici);
        await env.Svc.SelectOfferAsync(loan.Id, o.Id, new OfferActionRequestDto(), C("Sales"));
        await env.Svc.RaiseDeviationAsync(loan.Id, o.Id, new RaiseOfferDeviationRequestDto { DeviationType = "ROI", Reason = "Internal risk note" }, null, C("Manager"));
        var v = (await env.Svc.GetAsync(loan.Id, C(role))).Data!;
        v.Capabilities.Masked.Should().BeTrue();
        v.Offers.Single().Current!.BaseRoi.Should().Be(0);
        v.Offers.Single().Current!.MarginPp.Should().BeNull();
        v.Offers.Single().Evaluation.Should().BeNull();
        v.Deviations.Single().Reason.Should().BeNull();
        v.Deviations.Single().Flags.Should().BeNull();
        v.Offers.Single().Current!.OfferedRoi.Should().Be(12m, "the customer-facing rate is not internal");
        // Internal roles see everything.
        var internalView = (await env.Svc.GetAsync(loan.Id, C("Manager"))).Data!;
        internalView.Offers.Single().Current!.BaseRoi.Should().Be(15m);
        internalView.Deviations.Single().Reason.Should().Be("Internal risk note");
    }

    // ── Timeline / audit ─────────────────────────────────────────────────────
    [Fact]
    public async Task EveryStep_WritesTimelineHistoryAndAudit()
    {
        var (env, loan, _) = await Approved();
        using var __ = env;
        await env.Svc.GenerateSanctionAsync(loan.Id, null, C("LoginTeam"));
        env.Db.ChangeTracker.Clear();
        var names = await env.Db.TrackingEntries.Where(t => t.LoanId == loan.Id).Select(t => t.Name).ToListAsync();
        names.Should().Contain(new[] { "EFIN-Final Offer Check", "EFIN-Offer Created", "EFIN-Offer Selected", "EFIN-Approved", "EFIN-Sanction Generated" });
        var hist = await env.Db.LoanStatusHistories.Where(h => h.LoanId == loan.Id).OrderBy(h => h.Id).Select(h => h.ToStatus).ToListAsync();
        hist.Should().ContainInOrder(LoanStatus.Offer, LoanStatus.Approved);
        (await env.Db.AuditLogs.CountAsync(a => a.EntityId == loan.Id.ToString())).Should().BeGreaterThanOrEqualTo(4);
    }

    // ── Rule management ──────────────────────────────────────────────────────
    [Fact]
    public async Task Rules_ProductRiskOfficerManages_VersionsAreImmutable_SimulationWritesNothing()
    {
        using var env = await CreateAsync();
        var req = new DeviationRuleRequestDto
        {
            Name = "HDFC PL ROI floor", BankId = Hdfc, ProductKey = "personal_loan", DeviationType = "ROI", Metric = "ROI_MIN_PCT",
            LimitValue = 11, Priority = 10, EffectiveFrom = DateTime.UtcNow.AddDays(-1), ApprovalRequired = true,
        };
        (await env.Svc.CreateRuleAsync(req, C("Sales"))).ErrorCode.Should().Be(ApiErrorCodes.Forbidden);
        (await env.Svc.CreateRuleAsync(req, C("OperationManager"))).ErrorCode.Should().Be(ApiErrorCodes.Forbidden);
        var v1 = await env.Svc.CreateRuleAsync(req, C("ProductTeam"));
        v1.Success.Should().BeTrue();
        (await env.Svc.CreateRuleAsync(req, C("ProductTeam"))).ErrorCode.Should().Be(ApiErrorCodes.RuleConflict, "an identical overlapping rule is refused");

        req.LimitValue = 11.5m;
        (await env.Svc.NewRuleVersionAsync(v1.Data!.Id, req, C("ProductTeam"))).ErrorCode.Should().Be(ApiErrorCodes.Validation, "change reason required");
        req.ChangeReason = "Credit committee revision";
        var v2 = await env.Svc.NewRuleVersionAsync(v1.Data.Id, req, C("ProductTeam"));
        v2.Success.Should().BeTrue();
        v2.Data!.Version.Should().Be(2);
        (await env.Svc.NewRuleVersionAsync(v1.Data.Id, req, C("ProductTeam"))).ErrorCode.Should().Be(ApiErrorCodes.ConcurrencyConflict, "old versions are read-only");
        var hist = (await env.Svc.ListRulesAsync(Hdfc, includeHistory: true)).Data!;
        hist.Should().HaveCount(2);
        hist.Single(r => r.Version == 1).Should().Match<DeviationRuleDto>(r => !r.IsActive && r.SupersededAt != null && r.LimitValue == 11);
        (await env.Svc.SetRuleActiveAsync(v2.Data.Id, false, null, C("ProductTeam"))).ErrorCode.Should().Be(ApiErrorCodes.Validation);
        (await env.Svc.SetRuleActiveAsync(v2.Data.Id, false, "Scheme paused", C("ProductTeam"))).Success.Should().BeTrue();

        var loan = await env.SeedLoanAsync(LoanStatus.Offer);
        var before = await env.Db.ApplicationOffers.CountAsync() + await env.Db.DeviationRules.CountAsync();
        var sim = await env.Svc.SimulateAsync(new DeviationRuleSimulationRequestDto
        {
            LoanId = loan.Id, BankId = Hdfc, LoanAmount = 500000, TenureMonths = 36, BaseRoi = 13, OfferedRoi = 11, GstPct = 18,
            DraftRule = new DeviationRuleRequestDto { Name = "draft", BankId = Hdfc, DeviationType = "ROI", Metric = "ROI_MIN_PCT", LimitValue = 12, Priority = 5, EffectiveFrom = DateTime.UtcNow.AddDays(-1) },
        }, C("ProductTeam"));
        // ProductTeam cannot see applications → simulation against a real application is refused;
        // the pure what-if (no LoanId) works.
        sim.ErrorCode.Should().Be(ApiErrorCodes.NotFound);
        var what = await env.Svc.SimulateAsync(new DeviationRuleSimulationRequestDto
        {
            BankId = Hdfc, ProductKey = "personal_loan", LoanType = "Personal", LoanAmount = 500000, TenureMonths = 36, BaseRoi = 13, OfferedRoi = 11, GstPct = 18,
            DraftRule = new DeviationRuleRequestDto { Name = "draft", BankId = Hdfc, DeviationType = "ROI", Metric = "ROI_MIN_PCT", LimitValue = 12, Priority = 5, EffectiveFrom = DateTime.UtcNow.AddDays(-1) },
        }, C("ProductTeam"));
        what.Success.Should().BeTrue();
        what.Data!.Checks.Single().Status.Should().Be("Breach");
        (await env.Db.ApplicationOffers.CountAsync() + await env.Db.DeviationRules.CountAsync()).Should().Be(before, "dry run writes nothing");
    }
}
