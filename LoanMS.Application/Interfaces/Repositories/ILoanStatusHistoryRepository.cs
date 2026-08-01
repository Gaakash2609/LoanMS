using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;

namespace LoanMS.Application.Interfaces;

public interface ILoanStatusHistoryRepository : IGenericRepository<LoanStatusHistory>
{
    Task<IEnumerable<LoanStatusHistory>> GetByLoanIdAsync(int loanId);
}
