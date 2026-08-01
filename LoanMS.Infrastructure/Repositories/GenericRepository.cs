using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.Infrastructure.Repositories;

// ── Generic Repository ────────────────────────────────────────────────────────
public class GenericRepository<T> : IGenericRepository<T> where T : BaseEntity
{
    protected readonly AppDbContext _ctx;
    protected readonly DbSet<T> _set;

    public GenericRepository(AppDbContext ctx)
    {
        _ctx = ctx;
        _set = ctx.Set<T>();
    }

    public async Task<T?> GetByIdAsync(int id) =>
        await _set.FirstOrDefaultAsync(e => e.Id == id);

    public async Task<IEnumerable<T>> GetAllAsync() =>
        await _set.ToListAsync();

    public async Task<T> AddAsync(T entity)
    {
        await _set.AddAsync(entity);
        return entity;
    }

    public async Task<T> UpdateAsync(T entity)
    {
        _set.Update(entity);
        return await Task.FromResult(entity);
    }

    public async Task DeleteAsync(int id)
    {
        var entity = await _set.FindAsync(id);
        if (entity != null) { entity.IsDeleted = true; entity.UpdatedAt = DateTime.UtcNow; }
    }

    public async Task<bool> ExistsAsync(int id) =>
        await _set.AnyAsync(e => e.Id == id);
}
