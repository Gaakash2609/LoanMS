namespace LoanMS.Application.DTOs;

/// <summary>
/// Sales Team / Operations Manager assignment — see
/// LoansController.UpdateAssignment for why this is a separate, narrow
/// endpoint rather than folded into the full UpdateLoanRequestDto.
/// Both fields are optional/nullable independently: sending only one
/// leaves the other field on the loan untouched (not cleared).
/// </summary>
public class UpdateLoanAssignmentRequestDto
{
    public string? SalesTeamName { get; set; }
    public int? OpsManagerId { get; set; }
    /// <summary>Set explicitly true to clear SalesTeamName instead of leaving it untouched when null.</summary>
    public bool ClearSalesTeam { get; set; }
    /// <summary>Set explicitly true to clear OpsManagerId instead of leaving it untouched when null.</summary>
    public bool ClearOpsManager { get; set; }

    // ── Extended (linked-users persistence fix, continued) — Login User,
    // Sales Person, and Location were the same "looks saved, isn't" gap as
    // SalesTeamName/OpsManagerId above: the UI's Team & Assignment panel
    // edits them, but nothing reached the database. Reusing this same
    // narrow endpoint (not the full loan Update, for the same reason —
    // that one only allows Draft/Submitted status) rather than adding
    // three more endpoints for an identical pattern.
    public int? LoginUserId { get; set; }
    public bool ClearLoginUser { get; set; }
    public int? AssignedToUserId { get; set; }
    public bool ClearAssignedTo { get; set; }
    public int? LocationId { get; set; }
    public bool ClearLocation { get; set; }
}
