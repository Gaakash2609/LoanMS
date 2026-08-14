using LoanMS.Application.Interfaces;
using LoanMS.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.Infrastructure.Services;

public class EmailTemplateProvider : IEmailTemplateProvider
{
    private readonly AppDbContext _db;
    public EmailTemplateProvider(AppDbContext db) => _db = db;

    public async Task<(string? Subject, string? Body)> GetTemplateAsync(string templateKey)
    {
        var key = (templateKey ?? string.Empty).Trim().ToLowerInvariant();
        var tpl = await _db.EmailTemplates.AsNoTracking()
            .FirstOrDefaultAsync(t => t.TemplateKey == key && !t.IsDeleted);
        return (tpl?.Subject, tpl?.Body);
    }
}
