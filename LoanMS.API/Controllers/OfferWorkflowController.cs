using LoanMS.API.Services;
using LoanMS.Application.DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LoanMS.API.Controllers;

/// <summary>
/// Offer → Deviation → Credit Approval → Sanction → Disbursement for one
/// application. Authorization is enforced in OfferWorkflowService (scope → 404,
/// role/permission → 403, stage/state → 409) so every entry point shares it.
/// Raise deviation, deviation decision, credit approval, sanction and
/// disbursement accept an <c>Idempotency-Key</c> header: a replay returns the
/// current state instead of creating a second record.
/// </summary>
[Authorize]
[Route("api/loans/{loanId:int}/workflow")]
public class OfferWorkflowController : BaseController
{
    private readonly IOfferWorkflowService _svc;
    public OfferWorkflowController(IOfferWorkflowService svc) => _svc = svc;

    private WorkflowCaller Caller => new(CurrentUserId, CurrentUserRole, User.FindFirst("fullName")?.Value ?? User.Identity?.Name);
    private string? IdemKey => Request.Headers.TryGetValue("Idempotency-Key", out var v) && !string.IsNullOrWhiteSpace(v) ? v.ToString().Trim() : null;

    [HttpGet]
    public async Task<IActionResult> Get(int loanId) => ApiResult(await _svc.GetAsync(loanId, Caller));

    [HttpPost("move-to-offer")]
    public async Task<IActionResult> MoveToOffer(int loanId, [FromBody] WorkflowStageRequestDto? req) =>
        ApiResult(await _svc.MoveToOfferAsync(loanId, req?.Reason, Caller));

    [HttpPost("back-to-underwriting")]
    public async Task<IActionResult> BackToUnderwriting(int loanId, [FromBody] WorkflowStageRequestDto req) =>
        ApiResult(await _svc.BackToUnderwritingAsync(loanId, req?.Reason, Caller));

    [HttpPost("offers")]
    public async Task<IActionResult> CreateOffer(int loanId, [FromBody] CreateOfferRequestDto req) =>
        ApiResult(await _svc.CreateOfferAsync(loanId, req, Caller));

    [HttpPost("offers/{offerId:int}/revisions")]
    public async Task<IActionResult> Revise(int loanId, int offerId, [FromBody] ReviseOfferRequestDto req) =>
        ApiResult(await _svc.ReviseOfferAsync(loanId, offerId, req, Caller));

    [HttpPost("offers/{offerId:int}/withdraw")]
    public async Task<IActionResult> Withdraw(int loanId, int offerId, [FromBody] OfferActionRequestDto req) =>
        ApiResult(await _svc.WithdrawOfferAsync(loanId, offerId, req, Caller));

    [HttpPost("offers/{offerId:int}/select")]
    public async Task<IActionResult> Select(int loanId, int offerId, [FromBody] OfferActionRequestDto? req) =>
        ApiResult(await _svc.SelectOfferAsync(loanId, offerId, req ?? new(), Caller));

    [HttpPost("offers/{offerId:int}/unselect")]
    public async Task<IActionResult> Unselect(int loanId, int offerId, [FromBody] OfferActionRequestDto req) =>
        ApiResult(await _svc.UnselectOfferAsync(loanId, offerId, req, Caller));

    [HttpPost("offers/{offerId:int}/deviations")]
    public async Task<IActionResult> RaiseDeviation(int loanId, int offerId, [FromBody] RaiseOfferDeviationRequestDto req) =>
        ApiResult(await _svc.RaiseDeviationAsync(loanId, offerId, req, IdemKey, Caller));

    [HttpPost("offers/{offerId:int}/deviations/skip")]
    public async Task<IActionResult> SkipDeviation(int loanId, int offerId, [FromBody] OfferActionRequestDto req) =>
        ApiResult(await _svc.SkipDeviationAsync(loanId, offerId, req, Caller));

    [HttpPost("deviations/{deviationId:int}/decide")]
    public async Task<IActionResult> DecideDeviation(int loanId, int deviationId, [FromBody] DecideOfferDeviationRequestDto req) =>
        ApiResult(await _svc.DecideDeviationAsync(loanId, deviationId, req, IdemKey, Caller));

    [HttpPost("offers/{offerId:int}/credit-approval")]
    public async Task<IActionResult> CreditApproval(int loanId, int offerId, [FromBody] CreditApprovalRequestDto req) =>
        ApiResult(await _svc.CreditApprovalAsync(loanId, offerId, req, IdemKey, Caller));

    [HttpPost("sanctions")]
    public async Task<IActionResult> GenerateSanction(int loanId) =>
        ApiResult(await _svc.GenerateSanctionAsync(loanId, IdemKey, Caller));

    [HttpPost("sanctions/{sanctionId:int}/cancel")]
    public async Task<IActionResult> CancelSanction(int loanId, int sanctionId, [FromBody] CancelSanctionRequestDto req) =>
        ApiResult(await _svc.CancelSanctionAsync(loanId, sanctionId, req, Caller));

    [HttpPost("disbursements")]
    public async Task<IActionResult> Disburse(int loanId, [FromBody] CreateDisbursementRequestDto req) =>
        ApiResult(await _svc.CreateDisbursementAsync(loanId, req, IdemKey, Caller));

    [HttpPost("re-evaluate")]
    public async Task<IActionResult> ReEvaluate(int loanId) => ApiResult(await _svc.ReEvaluateAsync(loanId, Caller));

    /// <summary>Upload a bureau (CIBIL) report file with its score — the only CIBIL source
    /// the deviation rules trust. multipart/form-data: file, creditScore, bureauProvider, reportDate.</summary>
    [HttpPost("bureau-report")]
    [RequestSizeLimit(11 * 1024 * 1024)]
    public async Task<IActionResult> UploadBureauReport(int loanId, IFormFile? file, [FromForm] int creditScore,
        [FromForm] string? bureauProvider, [FromForm] DateTime reportDate)
    {
        if (file == null) return BadRequest(ApiResponseDto<object>.Fail("The bureau report file is required.", ApiErrorCodes.Validation));
        await using var stream = file.OpenReadStream();
        return ApiResult(await _svc.UploadBureauReportAsync(loanId,
            new BureauReportUpload(stream, file.FileName, file.ContentType, file.Length, creditScore, bureauProvider ?? "", reportDate), Caller));
    }

    [HttpGet("deviations/{deviationId:int}/eligible-approvers")]
    public async Task<IActionResult> EligibleApprovers(int loanId, int deviationId) =>
        ApiResult(await _svc.EligibleApproversAsync(loanId, deviationId, Caller));

    [HttpPost("deviations/{deviationId:int}/reassign")]
    public async Task<IActionResult> ReassignDeviation(int loanId, int deviationId, [FromBody] ReassignDeviationRequestDto req) =>
        ApiResult(await _svc.ReassignDeviationAsync(loanId, deviationId, req, Caller));

    [HttpPost("disbursements/{disbursementId:int}/reverse")]
    public async Task<IActionResult> Reverse(int loanId, int disbursementId, [FromBody] ReverseDisbursementRequestDto req) =>
        ApiResult(await _svc.ReverseDisbursementAsync(loanId, disbursementId, req, Caller));
}

/// <summary>Versioned, lender-specific deviation rules — Product &amp; Risk Officer / Chief Administrator.</summary>
[Authorize]
[Route("api/deviation-rules")]
public class DeviationRulesController : BaseController
{
    private readonly IOfferWorkflowService _svc;
    public DeviationRulesController(IOfferWorkflowService svc) => _svc = svc;
    private WorkflowCaller Caller => new(CurrentUserId, CurrentUserRole, User.FindFirst("fullName")?.Value ?? User.Identity?.Name);

    /// <summary>Rules are internal credit policy: rule managers and the 4 credit authority roles may read them.</summary>
    private bool CanRead => OfferWorkflowService.RuleManagerRoles.Concat(OfferWorkflowService.AuthorityRoles)
        .Contains(CurrentUserRole, StringComparer.OrdinalIgnoreCase);

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] int? bankId, [FromQuery] bool includeHistory = false)
    {
        if (!CanRead) return StatusCode(403, ApiResponseDto<object>.Fail("You do not have permission to view deviation rules.", ApiErrorCodes.Forbidden));
        return ApiResult(await _svc.ListRulesAsync(bankId, includeHistory));
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] DeviationRuleRequestDto req) => ApiResult(await _svc.CreateRuleAsync(req, Caller));

    [HttpPost("{ruleId:int}/versions")]
    public async Task<IActionResult> NewVersion(int ruleId, [FromBody] DeviationRuleRequestDto req) => ApiResult(await _svc.NewRuleVersionAsync(ruleId, req, Caller));

    [HttpPost("{ruleId:int}/activate")]
    public async Task<IActionResult> Activate(int ruleId, [FromBody] WorkflowStageRequestDto req) => ApiResult(await _svc.SetRuleActiveAsync(ruleId, true, req?.Reason, Caller));

    [HttpPost("{ruleId:int}/deactivate")]
    public async Task<IActionResult> Deactivate(int ruleId, [FromBody] WorkflowStageRequestDto req) => ApiResult(await _svc.SetRuleActiveAsync(ruleId, false, req?.Reason, Caller));

    [HttpPost("simulate")]
    public async Task<IActionResult> Simulate([FromBody] DeviationRuleSimulationRequestDto req) => ApiResult(await _svc.SimulateAsync(req, Caller));

    [HttpGet("/api/reports/offer-pipeline")]
    public async Task<IActionResult> PipelineReport([FromQuery] DateTime? from, [FromQuery] DateTime? to, [FromQuery] int? bankId, [FromQuery] string? offerStatus) =>
        ApiResult(await _svc.PipelineReportAsync(from, to, bankId, offerStatus, Caller));
}
