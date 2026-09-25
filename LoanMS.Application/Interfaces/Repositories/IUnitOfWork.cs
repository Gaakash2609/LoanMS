using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;

namespace LoanMS.Application.Interfaces;

public interface IUnitOfWork : IDisposable
{
    IUserRepository Users { get; }
    ICustomerRepository Customers { get; }
    ILoanRepository Loans { get; }
    ILoanStatusHistoryRepository LoanStatusHistories { get; }
    IPasswordResetTokenRepository PasswordResetTokens { get; }
    Task<int> SaveChangesAsync();
    /// <summary>Runs <paramref name="work"/> inside one database transaction
    /// (through the provider's execution strategy), so a guard check, its lock
    /// and the write it protects commit together. Joins an already-open
    /// transaction; runs plainly on providers without transactions (InMemory).</summary>
    Task<T> ExecuteInTransactionAsync<T>(Func<Task<T>> work);
}
