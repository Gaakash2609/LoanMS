using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

/// <summary>
/// Insert-only payload posted straight from efin-app.js at the same moment
/// an entry is pushed to ASSIGNMENT_AUDIT_LOG — field names line up 1:1 with
/// that entry object (see AssignmentAuditLog entity doc comment) so the
/// frontend can post the entry (plus a couple of resolved ids) with no
/// reshaping.
/// </summary>
public class CreateAssignmentAuditLogRequestDto
{
    /// <summary>Resolved backend Loan id, when the frontend already knows it
    /// (app._apiId). Omit/null if the loan hasn't synced to the backend yet.</summary>
    public int? LoanApplicationId { get; set; }

    /// <summary>Frontend application id — entry.appId. Always required; this
    /// is the reliable join key regardless of backend-sync timing.</summary>
    [Required]
    public string LoanFrontendId { get; set; } = string.Empty;

    public string? Location { get; set; }
    public string? LoanType { get; set; }
    public string? SalesPerson { get; set; }
    public string? SalesTeam { get; set; }

    public int? AssignedToUserId { get; set; }
    public string? AssignedToUserName { get; set; }

    /// <summary>Only meaningful for a MANUAL reassignment (a real logged-in
    /// user made the decision). Left null for AUTOMATIC decisions.</summary>
    public int? AssignedByUserId { get; set; }
    /// <summary>entry.decidedBy — "System" (stored as "System (Auto)") or the
    /// acting user's name.</summary>
    public string? AssignedByName { get; set; }

    [Required]
    public string Method { get; set; } = string.Empty;
    public bool TieBreak { get; set; }
    public string? PreviousUserName { get; set; }
    public string? Reason { get; set; }

    /// <summary>entry.candidates, passed through as-is and stored as raw JSON.</summary>
    public object? Candidates { get; set; }

    [Required]
    public DateTime AssignedAt { get; set; }
}
