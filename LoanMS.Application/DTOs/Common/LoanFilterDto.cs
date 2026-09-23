using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class LoanFilterDto
{
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 10;
    public string? Search { get; set; }
    /// <summary>
    /// Vanilla's topbar search-scope dropdown (index.html #topbar-search-field):
    /// "" / null = all fields, else one of name, id, mobile, pan, dsa, partner,
    /// company, sales, loantype, status. Vanilla scoped the search client-side
    /// over the whole in-memory APPLICATIONS array; here the list is paged
    /// server-side, so the scope has to travel with the query or a scoped search
    /// would only ever look inside the current page.
    /// </summary>
    public string? SearchField { get; set; }
    public LoanStatus? Status { get; set; }
    // Gap 1 — multi-status filtering (Dashboard "In Process" drill-down:
    // Vanilla's login+underwriting+offer stages, i.e. Submitted+UnderReview
    // here — offer has no persisted backend status). Bound from a single
    // comma-separated `statuses` query value (ASP.NET Core's query-string
    // model binder splits a comma-delimited value into a collection
    // automatically), so the frontend sends one `statuses=Submitted,UnderReview`
    // param rather than axios' default `statuses[]=` array encoding, which
    // this binder does not parse. Takes precedence over Status when present
    // (see LoanRepository.ApplyListFilters) — the two are mutually exclusive,
    // never combined.
    public List<LoanStatus>? Statuses { get; set; }
    public LoanType? LoanType { get; set; }
    public int? CustomerId { get; set; }
    public int? AssignedToUserId { get; set; }
    // Phase 1 (DSA parity) — backs the DSA Management "Apps" drill-down
    // (Vanilla dsaViewApps/renderDsaMappingOverview, efin-app.js:31127).
    // Loan.DsaId/PartnerId already existed on the entity (set correctly by
    // the wizard) but were never exposed as a list filter — GetAll only
    // ever returned every loan regardless of channel. No migration
    // required, only a query filter.
    public int? DsaId { get; set; }
    public int? PartnerId { get; set; }
    public DateTime? FromDate { get; set; }
    public DateTime? ToDate { get; set; }
    public string SortBy { get; set; } = "CreatedAt";
    public string SortDir { get; set; } = "desc";
}
