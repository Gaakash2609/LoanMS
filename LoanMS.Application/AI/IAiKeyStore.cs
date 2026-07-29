namespace LoanMS.Application.AI;

/// <summary>
/// Resolves the API key to use for a given AI provider ("gemini" / "openai").
/// Checks the Admin-saved, encrypted-at-rest key in the database first
/// (Settings → AI Provider Keys), and falls back to the static
/// AI:ApiKey / AI:OpenAIApiKey value from appsettings/environment if no
/// Admin key has been saved yet. This lets an Admin rotate provider keys
/// from the UI without editing config files or restarting the server.
/// </summary>
public interface IAiKeyStore
{
    Task<string?> GetKeyAsync(string providerName);
}
