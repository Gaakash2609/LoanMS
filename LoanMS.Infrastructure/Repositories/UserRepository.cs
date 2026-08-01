using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.Infrastructure.Repositories;

// ── User Repository ───────────────────────────────────────────────────────────
public class UserRepository : GenericRepository<User>, IUserRepository
{
    public UserRepository(AppDbContext ctx) : base(ctx) { }

    public async Task<User?> GetByEmailAsync(string email) =>
        await _set.FirstOrDefaultAsync(u => u.Email.ToLower() == email.ToLower());

    public async Task<User?> GetByRefreshTokenAsync(string refreshToken) =>
        await _set.FirstOrDefaultAsync(u => u.RefreshToken == refreshToken);

    public async Task<IEnumerable<User>> GetAllActiveUsersAsync() =>
        await _set.Where(u => u.IsActive).OrderBy(u => u.FullName).ToListAsync();

    public async Task<bool> EmailExistsAsync(string email, int? excludeId = null)
    {
        var query = _set.Where(u => u.Email == email.ToLower());
        if (excludeId.HasValue) query = query.Where(u => u.Id != excludeId.Value);
        return await query.AnyAsync();
    }
}
