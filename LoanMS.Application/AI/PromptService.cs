using System.Text.Json;

namespace LoanMS.Application.AI;

/// <summary>
/// All AI prompts in one place. Tuned for Indian loan management context (EFIN/LoanMS).
/// </summary>
public class PromptService : IPromptService
{
    private static readonly JsonSerializerOptions _opts = new() { WriteIndented = false };

    public string BuildCustomerSummaryPrompt(object customerData)
    {
        var json = JsonSerializer.Serialize(customerData, _opts);
        return $"You are a loan officer assistant for an Indian NBFC/DSA. " +
               $"Summarize this customer profile in 2-3 concise sentences highlighting creditworthiness, " +
               $"income stability, and any risk flags. Be factual and professional.\n\nCustomer Data: {json}";
    }

    public string BuildLoanRecommendationPrompt(object customerData)
    {
        var json = JsonSerializer.Serialize(customerData, _opts);
        return $"You are a senior loan advisor. Based on this customer profile (income, CIBIL score, " +
               $"employment type, existing loans), recommend 1-2 loan products with suitable amount ranges " +
               $"and tenure. Keep it brief (3-4 lines). Indian context (INR amounts).\n\nData: {json}";
    }

    public string BuildLoanInsightPrompt(object loanData)
    {
        var json = JsonSerializer.Serialize(loanData, _opts);
        return $"You are a loan processing assistant. Analyze this loan application and provide " +
               $"2-3 key insights about its current status, any concerns, and next recommended steps. " +
               $"Be concise and actionable.\n\nLoan Data: {json}";
    }

    public string BuildUnderwritingPrompt(object loanData)
    {
        var json = JsonSerializer.Serialize(loanData, _opts);
        return $"You are an underwriting support assistant for an Indian lending platform. " +
               $"Review this loan and highlight: (1) key risk factors, (2) supporting strengths, " +
               $"(3) suggested verification checklist. Keep it professional and brief.\n\nLoan: {json}";
    }

    public string BuildDashboardInsightPrompt(object stats)
    {
        var json = JsonSerializer.Serialize(stats, _opts);
        return $"You are a business intelligence assistant. Based on these loan portfolio statistics, " +
               $"give 2-3 key business insights or action items. Be specific and data-driven.\n\nStats: {json}";
    }

    public string BuildDocumentTagPrompt(string documentName, string documentType)
        => $"Classify this loan document into one of these tags: " +
           $"[identity_proof, address_proof, income_proof, bank_statement, property_doc, " +
           $"employment_proof, form_16, itr, offer_letter, other]. " +
           $"Document: '{documentName}', Type: '{documentType}'. " +
           $"Reply with ONLY the tag, nothing else.";

    public string BuildCaseInsightPrompt(object loanData, string currentStage)
    {
        var json = JsonSerializer.Serialize(loanData, _opts);
        return $"You are a loan case manager. The loan is currently at stage: '{currentStage}'. " +
               $"Based on the loan data, give 1-2 specific actions or warnings to move this case forward. " +
               $"Be brief and actionable.\n\nLoan: {json}";
    }

    public string BuildNotesPrompt(object context, string noteContext)
    {
        var json = JsonSerializer.Serialize(context, _opts);
        return $"Generate a professional case note for a loan officer based on: Context='{noteContext}', " +
               $"Loan Data={json}. Keep it under 100 words, factual, in third-person style.";
    }
}
