using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.Infrastructure.Repositories;

// ── LoanStatusHistory Repository ──────────────────────────────────────────────
public class LoanStatusHistoryRepository : GenericRepository<LoanStatusHistory>, ILoanStatusHistoryRepository
{
    public LoanStatusHistoryRepository(AppDbContext ctx) : base(ctx) { }

    public async Task<IEnumerable<LoanStatusHistory>> GetByLoanIdAsync(int loanId) =>
        await _set.Include(h => h.ChangedBy)
                  .Where(h => h.LoanId == loanId)
                  .OrderByDescending(h => h.CreatedAt)
                  .ToListAsync();
}
