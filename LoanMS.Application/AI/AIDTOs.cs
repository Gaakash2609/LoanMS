namespace LoanMS.Application.AI;

// ── AI Request/Response DTOs ──────────────────────────────────────────────────

public class AIInsightRequestDto
{
    public int LoanId { get; set; }
    public string? Context { get; set; }
}

public class AIInsightResponseDto
{
    public bool Success { get; set; }
    public string? Insight { get; set; }
    public string? Error { get; set; }
    public bool AIEnabled { get; set; }
    public string Provider { get; set; } = string.Empty;
}

public class AICustomerSummaryResponseDto
{
    public bool Success { get; set; }
    public string? Summary { get; set; }
    public string? Recommendation { get; set; }
    public bool AIEnabled { get; set; }
}

public class AIDocumentTagDto
{
    public string DocumentName { get; set; } = string.Empty;
    public string DocumentType { get; set; } = string.Empty;
}

// ── KYC Vision DTOs ───────────────────────────────────────────────────────────

public class KycVisionImageDto
{
    public string MediaType { get; set; } = string.Empty;
    public string Data { get; set; } = string.Empty;
}

public class KycVisionRequestDto
{
    /// <summary>"PAN" | "AADHAAR" (case-insensitive). Used for audit logging.</summary>
    public string DocumentType { get; set; } = string.Empty;
    public List<KycVisionImageDto> Images { get; set; } = new();
    public string Prompt { get; set; } = string.Empty;
}

public class KycVisionResponseDto
{
    public bool Success { get; set; }
    public string? Provider { get; set; }
    public string? Text { get; set; }
    public long? ProcessingTimeMs { get; set; }
    public string? Error { get; set; }
    public string? Code { get; set; }
}

// ── AI Text Proxy DTOs ────────────────────────────────────────────────────────
// Provider-neutral text-completion proxy (text analog of the KYC Vision proxy).
// The browser posts a system + user prompt; the server forwards it to the
// configured AI provider (Gemini/OpenAI/Claude). The API key stays on the server.

public class AiTextRequestDto
{
    /// <summary>Instruction / system prompt for the model.</summary>
    public string SystemPrompt { get; set; } = string.Empty;
    /// <summary>User content to process (e.g. a raw lender email reply).</summary>
    public string UserPrompt { get; set; } = string.Empty;
    /// <summary>Optional max output tokens (defaults applied server-side).</summary>
    public int? MaxTokens { get; set; }
}

public class AiTextResponseDto
{
    public bool Success { get; set; }
    public string? Provider { get; set; }
    public string? Text { get; set; }
    public long? ProcessingTimeMs { get; set; }
    public string? Error { get; set; }
    public string? Code { get; set; }
}
