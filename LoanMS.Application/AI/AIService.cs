using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using Microsoft.Extensions.Logging;

namespace LoanMS.Application.AI;

/// <summary>
/// AI Service implementation. Wraps all AI calls in try/catch so the app
/// never fails if AI is unavailable. Returns null on any failure.
/// </summary>
public class AIService : IAIService
{
    private readonly IAIProvider?    _provider;
    private readonly IPromptService  _prompts;
    private readonly IUnitOfWork     _uow;
    private readonly ILogger<AIService> _logger;
    private readonly bool            _enabled;

    public bool IsEnabled => _enabled && _provider != null;

    public AIService(
        IPromptService prompts,
        IUnitOfWork uow,
        ILogger<AIService> logger,
        IAIProvider? provider = null,
        bool enabled = false)
    {
        _prompts  = prompts;
        _uow      = uow;
        _logger   = logger;
        _provider = provider;
        _enabled  = enabled;
    }

    public async Task<string?> GetCustomerSummaryAsync(int customerId)
    {
        if (!IsEnabled) return null;
        try
        {
            var customer = await _uow.Customers.GetByIdAsync(customerId);
            if (customer == null) return null;
            var prompt = _prompts.BuildCustomerSummaryPrompt(new {
                customer.FullName, customer.EmploymentType, customer.MonthlyIncome,
                customer.CibilScore, customer.CompanyName, customer.City, customer.State
            });
            return await _provider!.CompleteAsync("You are a helpful loan management assistant.", prompt);
        }
        catch (Exception ex) { _logger.LogWarning(ex, "AI customer summary failed"); return null; }
    }

    public async Task<string?> GetLoanRecommendationAsync(int customerId)
    {
        if (!IsEnabled) return null;
        try
        {
            var customer = await _uow.Customers.GetByIdAsync(customerId);
            if (customer == null) return null;
            var prompt = _prompts.BuildLoanRecommendationPrompt(new {
                customer.MonthlyIncome, customer.CibilScore, customer.EmploymentType
            });
            return await _provider!.CompleteAsync("You are a senior loan advisor.", prompt);
        }
        catch (Exception ex) { _logger.LogWarning(ex, "AI loan recommendation failed"); return null; }
    }

    public async Task<string?> GetLoanInsightAsync(int loanId)
    {
        if (!IsEnabled) return null;
        try
        {
            var loan = await _uow.Loans.GetWithDetailsAsync(loanId);
            if (loan == null) return null;
            var prompt = _prompts.BuildLoanInsightPrompt(new {
                loan.LoanNumber, Status = loan.Status.ToString(), loan.RequestedAmount,
                loan.ApprovedAmount, loan.InterestRate, loan.TenureMonths,
                CustomerName = loan.Customer?.FullName, CibilScore = loan.Customer?.CibilScore
            });
            return await _provider!.CompleteAsync("You are a loan processing assistant.", prompt);
        }
        catch (Exception ex) { _logger.LogWarning(ex, "AI loan insight failed"); return null; }
    }

    public async Task<string?> GetUnderwritingSupportAsync(int loanId)
    {
        if (!IsEnabled) return null;
        try
        {
            var loan = await _uow.Loans.GetWithDetailsAsync(loanId);
            if (loan == null) return null;
            var prompt = _prompts.BuildUnderwritingPrompt(new {
                loan.LoanNumber, LoanType = loan.LoanType.ToString(),
                loan.RequestedAmount, loan.InterestRate, loan.TenureMonths,
                CustomerIncome = loan.Customer?.MonthlyIncome,
                CibilScore = loan.Customer?.CibilScore,
                EmploymentType = loan.Customer?.EmploymentType,
                DocumentCount = loan.Documents?.Count ?? 0
            });
            return await _provider!.CompleteAsync("You are an underwriting support assistant.", prompt, 600);
        }
        catch (Exception ex) { _logger.LogWarning(ex, "AI underwriting failed"); return null; }
    }

    public async Task<string?> GetAINotesAsync(int loanId, string context)
    {
        if (!IsEnabled) return null;
        try
        {
            var loan = await _uow.Loans.GetWithDetailsAsync(loanId);
            if (loan == null) return null;
            var prompt = _prompts.BuildNotesPrompt(new {
                loan.LoanNumber, Status = loan.Status.ToString(),
                CustomerName = loan.Customer?.FullName
            }, context);
            return await _provider!.CompleteAsync("You are a professional loan case manager.", prompt, 200);
        }
        catch (Exception ex) { _logger.LogWarning(ex, "AI notes generation failed"); return null; }
    }

    public async Task<string?> GetDashboardInsightAsync(object dashboardStats)
    {
        if (!IsEnabled) return null;
        try
        {
            var prompt = _prompts.BuildDashboardInsightPrompt(dashboardStats);
            return await _provider!.CompleteAsync("You are a business intelligence assistant.", prompt);
        }
        catch (Exception ex) { _logger.LogWarning(ex, "AI dashboard insight failed"); return null; }
    }

    public async Task<string?> GetDocumentTagAsync(string documentName, string documentType)
    {
        if (!IsEnabled) return null;
        try
        {
            var prompt = _prompts.BuildDocumentTagPrompt(documentName, documentType);
            return await _provider!.CompleteAsync("You classify documents.", prompt, 20);
        }
        catch (Exception ex) { _logger.LogWarning(ex, "AI document tag failed"); return null; }
    }

    public async Task<string?> GetCaseInsightAsync(int loanId, string currentStage)
    {
        if (!IsEnabled) return null;
        try
        {
            var loan = await _uow.Loans.GetWithDetailsAsync(loanId);
            if (loan == null) return null;
            var prompt = _prompts.BuildCaseInsightPrompt(new {
                loan.LoanNumber, Status = loan.Status.ToString(), loan.RequestedAmount,
                CustomerName = loan.Customer?.FullName
            }, currentStage);
            return await _provider!.CompleteAsync("You are a loan case manager.", prompt);
        }
        catch (Exception ex) { _logger.LogWarning(ex, "AI case insight failed"); return null; }
    }
}
