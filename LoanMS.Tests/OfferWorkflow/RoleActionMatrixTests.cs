using FluentAssertions;
using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using static LoanMS.Tests.OfferWorkflow.OfferWorkflowTestEnv;

namespace LoanMS.Tests.OfferWorkflow;

/// <summary>
/// 11 roles × workflow actions, through the real service, the real visibility
/// scope and the real fail-closed permission defaults. "A" = must succeed,
/// "F" = must be refused (403 Forbidden, or 404 when the role cannot see the
/// application at that stage — never a success).
/// </summary>
public class RoleActionMatrixTests
{
    public static readonly string[] Roles =
        { "Admin", "Manager", "TeamLeader", "LoginTeam", "OperationManager", "LocationHead", "Sales", "Dsa", "Partner", "Accounts", "ProductTeam" };

    // Column order == Roles order.
    private static readonly Dictionary<string, string> Expected = new()
    {
        //                           Adm Mgr DSM CEO CEM ZM  BDE MCP CP  PRO PRK
        ["ViewApplication"]      = "A   A   A   A   A   A   A   A   A   F   F",
        ["ViewOffers"]           = "A   A   A   A   A   A   A   A   A   F   F",
        ["CreateOffer"]          = "A   A   A   A   A   A   F   F   F   F   F",
        ["ReviseOffer"]          = "A   A   A   A   A   A   F   F   F   F   F",
        ["SelectOffer"]          = "A   A   A   A   A   A   A   A   A   F   F",
        ["RaiseDeviation"]       = "A   A   A   A   A   A   F   F   F   F   F",
        ["ApproveDeviation"]     = "A   F   F   A   A   A   F   F   F   F   F",
        ["CreditApproval"]       = "A   F   F   A   A   A   F   F   F   F   F",
        ["EditApprovedTerms"]    = "A   F   F   A   A   A   F   F   F   F   F",
        ["GenerateSanction"]     = "A   F   F   A   A   A   F   F   F   F   F",
        ["CancelSanction"]       = "A   F   F   A   A   A   F   F   F   F   F",
        ["Disburse"]             = "A   F   F   A   A   A   F   F   F   F   F",
        ["ReverseDisbursement"]  = "A   F   F   A   A   A   F   F   F   F   F",
        ["RuleManagement"]       = "A   F   F   F   F   F   F   F   F   F   A",
        ["OfferPipelineReport"]  = "A   A   A   A   A   A   F   F   F   F   F",
        ["UploadBureauReport"]   = "A   F   F   A   A   A   F   F   F   F   F",
        ["ReassignDeviation"]    = "A   F   F   A   A   A   F   F   F   F   F",
        ["ReEvaluateDeviation"]  = "A   A   A   A   A   A   F   F   F   F   F",
    };

    public static IEnumerable<object[]> Cases() =>
        from action in Expected.Keys
        from i in Enumerable.Range(0, Roles.Length)
        select new object[] { action, Roles[i], Expected[action].Split(' ', StringSplitOptions.RemoveEmptyEntries)[i] == "A" };

    [Theory]
    [MemberData(nameof(Cases))]
    public async Task Role_Action(string action, string role, bool allowed)
    {
        using var env = await CreateAsync();
        await env.AddRuleAsync(Hdfc, "ROI", "ROI_MIN_PCT", 10);
        await env.AddRuleAsync(Icici, "ROI", "ROI_MIN_PCT", 14);
        var loan = await env.SeedLoanAsync();
        var who = C(role);
        var svc = env.Svc;
        (await svc.MoveToOfferAsync(loan.Id, null, C("Admin"))).Success.Should().BeTrue();

        async Task<ApplicationOfferDto> NewOffer(int bank) =>
            (await svc.CreateOfferAsync(loan.Id, Offer(bank), C("Manager"))).Data!.Offers.Single(o => o.BankId == bank && o.IsActive);
        async Task<ApplicationOfferDto> Final(int bank)
        {
            var o = await NewOffer(bank);
            (await svc.SelectOfferAsync(loan.Id, o.Id, new OfferActionRequestDto(), C("Admin"))).Success.Should().BeTrue();
            return (await svc.GetAsync(loan.Id, C("Admin"))).Data!.Offers.Single(x => x.Id == o.Id);
        }
        async Task<ApplicationOfferDto> ApprovedOffer()
        {
            var o = await Final(Hdfc);
            (await svc.CreditApprovalAsync(loan.Id, o.Id, new CreditApprovalRequestDto { Decision = "Approve", RevisionNo = 1 }, null, C("Admin"))).Success.Should().BeTrue();
            return (await svc.GetAsync(loan.Id, C("Admin"))).Data!.Offers.Single(x => x.Id == o.Id);
        }
        async Task Sanctioned()
        {
            await ApprovedOffer();
            (await svc.GenerateSanctionAsync(loan.Id, null, C("Admin"))).Success.Should().BeTrue();
            await env.SetFlagsAsync(loan.Id, l => { l.NachDone = true; l.CustomerAgreementDone = true; });
            await env.SeedVerifiedBankCheckAsync(loan.Id);
        }
        const decimal net = 500000m - 5900m - 5000m - 500m;

        ApiResponseDto<object> result = action switch
        {
            "ViewApplication" or "ViewOffers" => Wrap(await svc.GetAsync(loan.Id, who)),
            "CreateOffer" => Wrap(await svc.CreateOfferAsync(loan.Id, Offer(Hdfc), who)),
            "ReviseOffer" => Wrap(await ReviseAs(await NewOffer(Hdfc))),
            "SelectOffer" => Wrap(await svc.SelectOfferAsync(loan.Id, (await NewOffer(Hdfc)).Id, new OfferActionRequestDto(), who)),
            "RaiseDeviation" => Wrap(await svc.RaiseDeviationAsync(loan.Id, (await Final(Icici)).Id,
                new RaiseOfferDeviationRequestDto { DeviationType = "ROI", Reason = "matrix" }, null, who)),
            "ApproveDeviation" => Wrap(await ApproveDeviationAs()),
            "CreditApproval" => Wrap(await svc.CreditApprovalAsync(loan.Id, (await Final(Hdfc)).Id,
                new CreditApprovalRequestDto { Decision = "Approve", RevisionNo = 1 }, null, who)),
            "EditApprovedTerms" => Wrap(await svc.ReviseOfferAsync(loan.Id, (await ApprovedOffer()).Id is var id ? id : 0,
                Revise((await svc.GetAsync(loan.Id, C("Admin"))).Data!.Offers.Single(o => o.Id == id), "matrix", r => r.TenureMonths = 30), who)),
            "GenerateSanction" => Wrap(await GenerateAs()),
            "CancelSanction" => Wrap(await CancelAs()),
            "Disburse" => Wrap(await DisburseAs()),
            "ReverseDisbursement" => Wrap(await ReverseAs()),
            "RuleManagement" => Wrap(await svc.CreateRuleAsync(new DeviationRuleRequestDto
            {
                Name = "matrix rule", BankId = Idfc, DeviationType = "Tenure", Metric = "TENURE_MAX_MONTHS", LimitValue = 60,
                Priority = 10, EffectiveFrom = DateTime.UtcNow.AddDays(-1),
            }, who)),
            "OfferPipelineReport" => Wrap(await svc.PipelineReportAsync(null, null, null, null, who)),
            "UploadBureauReport" => Wrap(await svc.UploadBureauReportAsync(loan.Id, PdfReport(), who)),
            "ReassignDeviation" => Wrap(await ReassignAs()),
            "ReEvaluateDeviation" => Wrap(await svc.ReEvaluateAsync(loan.Id, who)),
            _ => throw new InvalidOperationException(action),
        };

        if (allowed)
            result.Success.Should().BeTrue($"{role} must be allowed to {action} (got {result.ErrorCode}: {result.Message ?? string.Join(" ", result.Errors)})");
        else
        {
            result.Success.Should().BeFalse($"{role} must NOT be allowed to {action}");
            result.ErrorCode.Should().BeOneOf(new[] { ApiErrorCodes.Forbidden, ApiErrorCodes.NotFound }, $"{role}/{action} must be refused on authority, not on state");
        }
        return;

        Task<ApiResponseDto<LoanWorkflowDto>> ReviseAs(ApplicationOfferDto o) =>
            svc.ReviseOfferAsync(loan.Id, o.Id, Revise(o, "matrix", r => r.OfferedRoi = 11.5m), who);

        async Task<ApiResponseDto<LoanWorkflowDto>> ApproveDeviationAs()
        {
            var o = await Final(Icici);
            // Raised by the Business Development Manager so no authority role is the raiser.
            var d = (await svc.RaiseDeviationAsync(loan.Id, o.Id, new RaiseOfferDeviationRequestDto { DeviationType = "ROI", Reason = "m" }, null, C("Manager")))
                .Data!.Deviations.Single();
            return await svc.DecideDeviationAsync(loan.Id, d.Id, new DecideOfferDeviationRequestDto { Approve = true, Comment = "ok" }, null, who);
        }
        async Task<ApiResponseDto<LoanWorkflowDto>> ReassignAs()
        {
            var o = await Final(Icici);
            var d = (await svc.RaiseDeviationAsync(loan.Id, o.Id, new RaiseOfferDeviationRequestDto { DeviationType = "ROI", Reason = "m" }, null, C("Manager")))
                .Data!.Deviations.Single();
            return await svc.ReassignDeviationAsync(loan.Id, d.Id, new ReassignDeviationRequestDto { ApproverUserId = Ceo2, Reason = "Approver on leave" }, who);
        }
        async Task<ApiResponseDto<LoanWorkflowDto>> GenerateAs() { await ApprovedOffer(); return await svc.GenerateSanctionAsync(loan.Id, null, who); }
        async Task<ApiResponseDto<LoanWorkflowDto>> CancelAs()
        {
            await ApprovedOffer();
            await svc.GenerateSanctionAsync(loan.Id, null, C("Admin"));
            env.Db.ChangeTracker.Clear();
            var sid = (await env.Db.Sanctions.SingleAsync()).Id;
            return await svc.CancelSanctionAsync(loan.Id, sid, new CancelSanctionRequestDto { Reason = "matrix", CancellationType = "Cancel" }, who);
        }
        async Task<ApiResponseDto<LoanWorkflowDto>> DisburseAs() { await Sanctioned(); return await svc.CreateDisbursementAsync(loan.Id, Disb(net), null, who); }
        async Task<ApiResponseDto<LoanWorkflowDto>> ReverseAs()
        {
            await Sanctioned();
            var d = (await svc.CreateDisbursementAsync(loan.Id, Disb(net), null, C("Admin"))).Data!.Disbursements.Single();
            return await svc.ReverseDisbursementAsync(loan.Id, d.Id, new ReverseDisbursementRequestDto { Reason = "matrix" }, who);
        }
    }

    private static ApiResponseDto<object> Wrap<T>(ApiResponseDto<T> r) => new()
    {
        Success = r.Success, Message = r.Message, Errors = r.Errors, ErrorCode = r.ErrorCode, Data = r.Data,
    };

    [Fact]
    public void Matrix_Covers_All11Roles()
    {
        Roles.Should().HaveCount(11);
        foreach (var row in Expected.Values) row.Split(' ', StringSplitOptions.RemoveEmptyEntries).Should().HaveCount(11);
    }
}
