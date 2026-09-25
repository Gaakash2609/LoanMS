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

    public async Task<T> ExecuteInTransactionAsync<T>(Func<Task<T>> work)
    {
        // Already inside a caller's transaction (e.g. the wizard), or a provider
        // without transactions (EF InMemory in tests): just run it.
        if (!_ctx.Database.IsRelational() || _ctx.Database.CurrentTransaction != null)
            return await work();

        // Same NpgsqlRetryingExecutionStrategy rule WizardController follows:
        // the transaction must be opened inside the strategy's delegate.
        var strategy = _ctx.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await _ctx.Database.BeginTransactionAsync();
            var result = await work();
            await tx.CommitAsync();
            return result;
        });
    }

    public void Dispose() => _ctx.Dispose();
}
