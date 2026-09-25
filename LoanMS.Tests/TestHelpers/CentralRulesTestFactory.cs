using LoanMS.Application.Interfaces;
using LoanMS.Application.Services;
using LoanMS.Infrastructure.Data;
using LoanMS.Infrastructure.Repositories;
using Moq;

namespace LoanMS.Tests.TestHelpers;

/// <summary>
/// Real CustomerService + LoanService wired onto the SAME AppDbContext a test
/// uses — the central identity + duplicate/45-day rules the wizard and loan
/// endpoints now share. E-mail is a no-op mock; the clock is injectable so
/// 45-day boundaries can be tested exactly.
/// </summary>
internal static class CentralRulesTestFactory
{
    public static (ICustomerService Customers, ILoanService Loans) Create(AppDbContext db, TimeProvider? clock = null)
    {
        var uow = new UnitOfWork(db);
        var email = new Mock<IEmailService>();
        var templates = new Mock<IEmailTemplateProvider>();
        templates.Setup(t => t.GetTemplateAsync(It.IsAny<string>())).ReturnsAsync(((string?)null, (string?)null));
        return (new CustomerService(uow), new LoanService(uow, email.Object, templates.Object, null, clock));
    }
}

/// <summary>A clock frozen at a given UTC instant.</summary>
internal sealed class FixedClock : TimeProvider
{
    private readonly DateTimeOffset _now;
    public FixedClock(DateTime utcNow) => _now = new DateTimeOffset(DateTime.SpecifyKind(utcNow, DateTimeKind.Utc));
    public override DateTimeOffset GetUtcNow() => _now;
}
