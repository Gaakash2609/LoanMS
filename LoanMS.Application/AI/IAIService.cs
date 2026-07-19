namespace LoanMS.Application.AI;

// ══════════════════════════════════════════════════════════════════════════════
// AI MODULE — Modular & Optional
// Current workflow continues to work even if AI is disabled.
// Set "Features:AIEnabled": false in appsettings to disable AI entirely.
// ══════════════════════════════════════════════════════════════════════════════

/// <summary>
/// Core AI provider abstraction — swap between OpenAI / Claude / Gemini without
/// changing any business logic. Implement a new provider and register it in DI.
/// </summary>
public interface IAIProvider
{
    string ProviderName { get; }
    Task<string> CompleteAsync(string systemPrompt, string userPrompt, int maxTokens = 500);
    Task<bool> IsAvailableAsync();

    /// <summary>
    /// Vision extraction from one or more images. Providers that do not support
    /// vision throw NotSupportedException via the default implementation.
    /// </summary>
    Task<string> ExtractFromImagesAsync(
        IReadOnlyList<VisionImage> images,
        string prompt,
        CancellationToken cancellationToken = default)
        => throw new NotSupportedException($"Provider '{ProviderName}' does not support vision.");

    /// <summary>True when this provider implements vision extraction.</summary>
    bool SupportsVision => false;
}

/// <summary>A single base64-encoded image plus its MIME type.</summary>
public sealed class VisionImage
{
    public string MediaType { get; set; } = string.Empty;
    public string Data { get; set; } = string.Empty;
}

/// <summary>
/// High-level AI service — orchestrates prompts for Loan MS use-cases.
/// All methods return null gracefully when AI is disabled or unavailable.
/// </summary>
public interface IAIService
{
    // Customer insights
    Task<string?> GetCustomerSummaryAsync(int customerId);
    Task<string?> GetLoanRecommendationAsync(int customerId);

    // Loan insights
    Task<string?> GetLoanInsightAsync(int loanId);
    Task<string?> GetUnderwritingSupportAsync(int loanId);
    Task<string?> GetAINotesAsync(int loanId, string context);

    // Dashboard insights
    Task<string?> GetDashboardInsightAsync(object dashboardStats);

    // Document tagging
    Task<string?> GetDocumentTagAsync(string documentName, string documentType);

    // Case insights (for tracking/workflow)
    Task<string?> GetCaseInsightAsync(int loanId, string currentStage);

    bool IsEnabled { get; }
}

/// <summary>
/// Prompt builder — keeps all prompts in one place for easy tuning.
/// </summary>
public interface IPromptService
{
    string BuildCustomerSummaryPrompt(object customerData);
    string BuildLoanRecommendationPrompt(object customerData);
    string BuildLoanInsightPrompt(object loanData);
    string BuildUnderwritingPrompt(object loanData);
    string BuildDashboardInsightPrompt(object stats);
    string BuildDocumentTagPrompt(string documentName, string documentType);
    string BuildCaseInsightPrompt(object loanData, string currentStage);
    string BuildNotesPrompt(object context, string noteContext);
}
