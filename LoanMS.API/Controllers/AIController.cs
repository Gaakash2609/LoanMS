using LoanMS.Application.AI;
using LoanMS.Application.DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LoanMS.API.Controllers;

/// <summary>
/// AI Module Controller — All endpoints are optional.
/// Returns graceful responses when AI is disabled.
/// Current workflow is NEVER affected by AI being on/off.
/// </summary>
[Authorize]
public class AIController : BaseController
{
    private readonly IAIService _ai;

    public AIController(IAIService ai) => _ai = ai;

    /// <summary>AI status — check if AI is enabled and which provider</summary>
    [HttpGet("status")]
    public IActionResult Status()
    {
        return Ok(ApiResponseDto<object>.Ok(new
        {
            enabled  = _ai.IsEnabled,
            message  = _ai.IsEnabled
                ? "AI module is active."
                : "AI module is disabled. Configure AI:ApiKey and AI:Enabled=true to activate."
        }));
    }

    // ── AI Text Proxy — Browser → /api/ai/parse → configured provider ──────────
    // Provider-neutral text completion; the text analog of the KYC Vision proxy
    // (/api/kyc/vision). The browser posts a system + user prompt and the server
    // forwards it to the configured provider. The API key lives ONLY in server
    // configuration and is never exposed to the browser.
    [AllowAnonymous]
    [HttpPost("parse")]
    public async Task<IActionResult> ParseText([FromBody] AiTextRequestDto request, [FromServices] IServiceProvider sp)
    {
        var provider = sp.GetService(typeof(IAIProvider)) as IAIProvider;
        if (provider is null || !await provider.IsAvailableAsync())
        {
            return Ok(new AiTextResponseDto
            {
                Success = false,
                Code    = "NOT_CONFIGURED",
                Error   = "AI is not configured on the server. Ask your administrator to enable AI and set the API key."
            });
        }

        if (request is null || string.IsNullOrWhiteSpace(request.UserPrompt))
            return BadRequest(new AiTextResponseDto { Success = false, Code = "INVALID_INPUT", Error = "userPrompt is required." });
        if (request.UserPrompt.Length > 100_000 || (request.SystemPrompt?.Length ?? 0) > 20_000)
            return BadRequest(new AiTextResponseDto { Success = false, Code = "INVALID_INPUT", Error = "Prompt is too long." });

        var maxTokens = request.MaxTokens is > 0 and <= 4000 ? request.MaxTokens.Value : 1000;

        try
        {
            var text = await provider.CompleteAsync(request.SystemPrompt ?? string.Empty, request.UserPrompt, maxTokens);
            return Ok(new AiTextResponseDto
            {
                Success  = true,
                Provider = provider.ProviderName,
                Text     = text
            });
        }
        catch (HttpRequestException ex)
        {
            var (status, code, msg) = ex.StatusCode switch
            {
                System.Net.HttpStatusCode.TooManyRequests => (429, "RATE_LIMITED", "Provider rate limit reached. Try again shortly."),
                System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden
                    => (503, "NOT_CONFIGURED", "Provider rejected the server credentials."),
                System.Net.HttpStatusCode.ServiceUnavailable or System.Net.HttpStatusCode.BadGateway or System.Net.HttpStatusCode.GatewayTimeout
                    => (503, "PROVIDER_UNAVAILABLE", "Provider temporarily unavailable. Try again shortly."),
                _ => (502, "PROVIDER_ERROR", "AI text request failed.")
            };
            return StatusCode(status, new AiTextResponseDto { Success = false, Code = code, Error = msg });
        }
        catch (Exception)
        {
            return StatusCode(500, new AiTextResponseDto { Success = false, Code = "UNKNOWN", Error = "An unexpected error occurred." });
        }
    }

    /// <summary>AI smart customer summary + loan recommendation</summary>
    [HttpGet("customer/{customerId:int}/summary")]
    public async Task<IActionResult> CustomerSummary(int customerId)
    {
        var summary        = await _ai.GetCustomerSummaryAsync(customerId);
        var recommendation = await _ai.GetLoanRecommendationAsync(customerId);

        return Ok(ApiResponseDto<AICustomerSummaryResponseDto>.Ok(new AICustomerSummaryResponseDto
        {
            Success        = _ai.IsEnabled,
            Summary        = summary ?? "AI not enabled. Enable AI to get smart customer summary.",
            Recommendation = recommendation ?? "Enable AI to get smart loan recommendations.",
            AIEnabled      = _ai.IsEnabled
        }));
    }

    /// <summary>AI loan insight</summary>
    [HttpGet("loan/{loanId:int}/insight")]
    public async Task<IActionResult> LoanInsight(int loanId)
    {
        var insight = await _ai.GetLoanInsightAsync(loanId);
        return Ok(ApiResponseDto<AIInsightResponseDto>.Ok(new AIInsightResponseDto
        {
            Success   = insight != null,
            Insight   = insight ?? "Enable AI to get smart loan insights.",
            AIEnabled = _ai.IsEnabled
        }));
    }

    /// <summary>AI underwriting support</summary>
    [HttpGet("loan/{loanId:int}/underwriting")]
    [Authorize(Roles = "Admin,Manager")]
    public async Task<IActionResult> UnderwritingSupport(int loanId)
    {
        var insight = await _ai.GetUnderwritingSupportAsync(loanId);
        return Ok(ApiResponseDto<AIInsightResponseDto>.Ok(new AIInsightResponseDto
        {
            Success   = insight != null,
            Insight   = insight ?? "Enable AI to get underwriting support.",
            AIEnabled = _ai.IsEnabled
        }));
    }

    /// <summary>AI case insight for current workflow stage</summary>
    [HttpGet("loan/{loanId:int}/case-insight")]
    public async Task<IActionResult> CaseInsight(int loanId, [FromQuery] string stage = "")
    {
        var insight = await _ai.GetCaseInsightAsync(loanId, stage);
        return Ok(ApiResponseDto<AIInsightResponseDto>.Ok(new AIInsightResponseDto
        {
            Success   = insight != null,
            Insight   = insight ?? "Enable AI to get case insights.",
            AIEnabled = _ai.IsEnabled
        }));
    }

    /// <summary>AI-generated notes for a loan context</summary>
    [HttpPost("loan/{loanId:int}/notes")]
    public async Task<IActionResult> GenerateNotes(int loanId, [FromBody] AIInsightRequestDto request)
    {
        var notes = await _ai.GetAINotesAsync(loanId, request.Context ?? "general update");
        return Ok(ApiResponseDto<AIInsightResponseDto>.Ok(new AIInsightResponseDto
        {
            Success   = notes != null,
            Insight   = notes ?? "Enable AI to generate smart notes.",
            AIEnabled = _ai.IsEnabled
        }));
    }

    /// <summary>AI dashboard insights</summary>
    [HttpPost("dashboard/insights")]
    public async Task<IActionResult> DashboardInsights([FromBody] object stats)
    {
        var insight = await _ai.GetDashboardInsightAsync(stats);
        return Ok(ApiResponseDto<AIInsightResponseDto>.Ok(new AIInsightResponseDto
        {
            Success   = insight != null,
            Insight   = insight ?? "Enable AI to get smart dashboard insights.",
            AIEnabled = _ai.IsEnabled
        }));
    }

    /// <summary>AI document tagging</summary>
    [HttpPost("document/tag")]
    public async Task<IActionResult> TagDocument([FromBody] AIDocumentTagDto request)
    {
        var tag = await _ai.GetDocumentTagAsync(request.DocumentName, request.DocumentType);
        return Ok(ApiResponseDto<object>.Ok(new
        {
            tag       = tag ?? "other",
            aiTagged  = tag != null,
            AIEnabled = _ai.IsEnabled
        }));
    }
}
