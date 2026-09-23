using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;

namespace LoanMS.Application.Interfaces;

public interface IUserRepository : IGenericRepository<User>
{
    Task<User?> GetByEmailAsync(string email);
    Task<User?> GetByRefreshTokenAsync(string refreshToken);
    Task<IEnumerable<User>> GetAllActiveUsersAsync();
    Task<bool> EmailExistsAsync(string email, int? excludeId = null);

    /// <summary>
    /// Looks up a user by email INCLUDING soft-deleted rows. Users.Email carries
    /// a unique index that is NOT filtered by IsDeleted, so a soft-deleted user
    /// still physically occupies its address while being invisible to every
    /// normal (query-filtered) lookup — see UserService.CreateAsync.
    /// </summary>
    Task<User?> GetByEmailIncludingDeletedAsync(string email);
}
