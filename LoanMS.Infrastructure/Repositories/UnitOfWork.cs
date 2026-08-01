using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.Infrastructure.Repositories;

// ── Unit of Work ──────────────────────────────────────────────────────────────
public class UnitOfWork : IUnitOfWork
{
    private readonly AppDbContext _ctx;

    public IUserRepository               Users               { get; }
    public ICustomerRepository           Customers           { get; }
    public ILoanRepository               Loans               { get; }
    public ILoanStatusHistoryRepository  LoanStatusHistories { get; }
    public IPasswordResetTokenRepository PasswordResetTokens { get; }

    public UnitOfWork(AppDbContext ctx)
    {
        _ctx                = ctx;
        Users               = new UserRepository(ctx);
        Customers           = new CustomerRepository(ctx);
        Loans               = new LoanRepository(ctx);
        LoanStatusHistories = new LoanStatusHistoryRepository(ctx);
        PasswordResetTokens = new PasswordResetTokenRepository(ctx);
    }

    public async Task<int> SaveChangesAsync() => await _ctx.SaveChangesAsync();

    public void Dispose() => _ctx.Dispose();
}
