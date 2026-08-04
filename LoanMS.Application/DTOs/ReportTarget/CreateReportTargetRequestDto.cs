using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class CreateReportTargetRequestDto
{
    /// <summary>"YYYY-MM", e.g. "2026-05".</summary>
    [Required]
    public string TargetMonth { get; set; } = string.Empty;

    /// <summary>Optional — omit for an organization-wide target (current UI default).</summary>
    public int? UserId { get; set; }

    /// <summary>Optional — omit for an organization-wide target (current UI default).</summary>
    public int? TeamId { get; set; }

    public decimal DisbAmt { get; set; }
    public int LoginCount { get; set; }
    public int DisbCount { get; set; }
}
