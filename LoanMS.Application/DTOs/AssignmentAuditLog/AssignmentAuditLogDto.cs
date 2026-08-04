namespace LoanMS.Application.DTOs;

public class AssignmentAuditLogDto
{
    public int Id { get; set; }
    public int? LoanApplicationId { get; set; }
    public string LoanFrontendId { get; set; } = string.Empty;
    public string? Location { get; set; }
    public string? LoanType { get; set; }
    public string? SalesPerson { get; set; }
    public string? SalesTeam { get; set; }
    public int? AssignedToUserId { get; set; }
    public string? AssignedToUserName { get; set; }
    public int? AssignedByUserId { get; set; }
    public string AssignedByName { get; set; } = string.Empty;
    public string Method { get; set; } = string.Empty;
    public bool TieBreak { get; set; }
    public string? PreviousUserName { get; set; }
    public string? Reason { get; set; }
    public string? CandidatesJson { get; set; }
    public DateTime AssignedAt { get; set; }
    public DateTime CreatedAt { get; set; }
}
