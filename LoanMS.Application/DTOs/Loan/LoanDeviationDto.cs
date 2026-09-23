namespace LoanMS.Application.DTOs;

/// <summary>
/// One detected policy-band breach on a loan's terms — the "deviation flags"
/// legacy computed in laCheckDeviations (efin-app.js). A loan with an empty
/// deviation list is within standard policy; a non-empty list is what a
/// reviewer would raise/skip a deviation over.
/// </summary>
public class LoanDeviationDto
{
    /// <summary>e.g. "ROI Deviation", "FOIR Deviation".</summary>
    public string Type { get; set; } = string.Empty;
    /// <summary>Human-readable explanation of the breach.</summary>
    public string Description { get; set; } = string.Empty;
    /// <summary>Compact badge, e.g. "FOIR 62% > 50%".</summary>
    public string Badge { get; set; } = string.Empty;
}
