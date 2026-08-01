using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.Infrastructure.Repositories;

// ── Password Reset Token Repository ──────────────────────────────────────────
public class PasswordResetTokenRepository
    : GenericRepository<PasswordResetToken>, IPasswordResetTokenRepository
{
    public PasswordResetTokenRepository(AppDbContext ctx) : base(ctx) { }

    public async Task<PasswordResetToken?> GetValidTokenAsync(string tokenHash) =>
        await _set.Include(t => t.User)
                  .FirstOrDefaultAsync(t =>
                      t.TokenHash == tokenHash &&
                      !t.IsUsed   &&
                      t.ExpiresAt > DateTime.UtcNow);

    public async Task InvalidateAllForUserAsync(int userId)
    {
        var tokens = await _set
            .Where(t => t.UserId == userId && !t.IsUsed)
            .ToListAsync();

        foreach (var token in tokens)
        {
            token.IsUsed    = true;
            token.UpdatedAt = DateTime.UtcNow;
        }
        // Caller (UnitOfWork.SaveChangesAsync) persists changes.
    }
}
