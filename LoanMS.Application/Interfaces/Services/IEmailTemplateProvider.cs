namespace LoanMS.Application.Interfaces;

/// <summary>
/// Reads an Admin-customized email-template override (Settings → All Email
/// Templates), or null if the Admin never customized that key — callers
/// fall back to their own built-in default text in that case. Kept
/// separate from IEmailConfigStore (which lives in Infrastructure, since
/// EmailService — its only consumer — is also Infrastructure) because
/// LoanService (Application layer) needs this too, and Application can't
/// reference Infrastructure directly.
/// </summary>
public interface IEmailTemplateProvider
{
    Task<(string? Subject, string? Body)> GetTemplateAsync(string templateKey);
}
