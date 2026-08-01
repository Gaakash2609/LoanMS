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
}
