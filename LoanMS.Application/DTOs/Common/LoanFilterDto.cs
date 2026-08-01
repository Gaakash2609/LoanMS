using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class LoanFilterDto
{
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 10;
    public string? Search { get; set; }
    public LoanStatus? Status { get; set; }
    public LoanType? LoanType { get; set; }
    public int? CustomerId { get; set; }
    public int? AssignedToUserId { get; set; }
    public DateTime? FromDate { get; set; }
    public DateTime? ToDate { get; set; }
    public string SortBy { get; set; } = "CreatedAt";
    public string SortDir { get; set; } = "desc";
}
