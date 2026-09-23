using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

/// <summary>
/// Per-loan Lender RM override (Lender Email Workflow) — mirrors Vanilla's
/// openRmOverrideModal (lender-email-workflow.js). Sets the RM contact used for
/// the lender-email enquiry/reply workflow for THIS application only, without
/// changing the master Bank/NBFC record.
/// </summary>
public class UpdateLenderRmRequestDto
{
    [Required]
    public string RmName  { get; set; } = string.Empty;
    [Required, EmailAddress]
    public string RmEmail { get; set; } = string.Empty;
    public string? RmMobile { get; set; }
}
