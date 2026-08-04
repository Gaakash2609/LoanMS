namespace LoanMS.Application.DTOs;

// ── InCred RM Email directory (efin-app.js RM_EMAILS) ──────────────────────
public class RmEmailDto
{
    public int    Id        { get; set; }
    public string Name      { get; set; } = string.Empty;
    public string? Location { get; set; }
    public string Email     { get; set; } = string.Empty;
    public string? ContactNo { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}

/// <summary>Request body for create/update — Id comes from the route, not the body.</summary>
public class RmEmailUpsertDto
{
    public string  Name      { get; set; } = string.Empty;
    public string? Location  { get; set; }
    public string  Email     { get; set; } = string.Empty;
    public string? ContactNo { get; set; }
}
