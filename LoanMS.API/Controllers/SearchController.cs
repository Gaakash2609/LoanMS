using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

// ── Global Search (productivity audit, P1) ───────────────────────────────────
// One search box across Loans/Customers/DSA/Partners instead of needing to
// know which page a record lives on first. Every section below reuses the
// SAME visibility rule its own dedicated endpoint already enforces — Loans
// via ILoanService.GetAllAsync (role-scoped), Customers via ICustomerService.
// GetAllAsync (role-scoped), DSA/Partners via the same role-scoping already
// in DsaController.GetAll (reproduced here, not a new rule). No result here
// can ever show a record the caller couldn't already see on that record's
// own dedicated page.
[Authorize]
public class SearchController : BaseController
{
    private readonly ILoanService _loanService;
    private readonly ICustomerService _customerService;
    private readonly AppDbContext _db;

    public SearchController(ILoanService loanService, ICustomerService customerService, AppDbContext db)
    {
        _loanService = loanService;
        _customerService = customerService;
        _db = db;
    }

    [HttpGet]
    public async Task<IActionResult> Search([FromQuery] string q)
    {
        if (string.IsNullOrWhiteSpace(q) || q.Trim().Length < 2)
            return Ok(ApiResponseDto<object>.Ok(new { loans = new List<object>(), customers = new List<object>(), dsaPartners = new List<object>() }));

        var term = q.Trim();

        var loansTask = _loanService.GetAllAsync(
            new LoanFilterDto { Page = 1, PageSize = 10, Search = term, SortBy = "CreatedAt", SortDir = "desc" },
            CurrentUserId, CurrentUserRole);

        var customersTask = _customerService.GetAllAsync(1, 10, term, CurrentUserId, CurrentUserRole);

        // DSA/Partner — same role-scoping DsaController.GetAll already applies.
        var dsaQuery = _db.DsaPartners.AsQueryable();
        if (string.Equals(CurrentUserRole, "Partner", StringComparison.OrdinalIgnoreCase))
            dsaQuery = dsaQuery.Where(d => d.LinkedUserId == CurrentUserId);
        else if (string.Equals(CurrentUserRole, "Dsa", StringComparison.OrdinalIgnoreCase))
            dsaQuery = dsaQuery.Where(d => d.LinkedUserId == CurrentUserId || (d.MappedDsa != null && d.MappedDsa.LinkedUserId == CurrentUserId));
        var dsaPartnersTask = dsaQuery
            .Where(d => d.Name.Contains(term) || (d.Code != null && d.Code.Contains(term)) || (d.Phone != null && d.Phone.Contains(term)))
            .OrderBy(d => d.Name)
            .Select(d => new { d.Id, d.Name, d.Code, PartnerType = d.PartnerType.ToString() })
            .Take(10)
            .ToListAsync();

        await Task.WhenAll(loansTask, customersTask, dsaPartnersTask);

        var loans = (loansTask.Result.Data?.Items ?? new List<LoanListDto>())
            .Select(l => new { l.Id, l.LoanNumber, l.CustomerName, l.Status, l.RequestedAmount });
        var customers = (customersTask.Result.Data?.Items ?? new List<CustomerDto>())
            .Select(c => new { c.Id, c.FullName, c.Phone });

        return Ok(ApiResponseDto<object>.Ok(new
        {
            loans,
            customers,
            dsaPartners = dsaPartnersTask.Result
        }));
    }
}
