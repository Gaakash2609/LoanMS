using FluentAssertions;
using LoanMS.Application.Interfaces;
using LoanMS.Application.Services;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using Moq;
using Xunit;

namespace LoanMS.Tests.Services;

// ── Draft delete scope (roles audit R#5) ─────────────────────────────────────
// Manager is an "internal" role that may delete other users' drafts, but it
// used to do so with an unscoped lookup — even drafts outside its visibility
// (Location AND Team). It must now be able to see the loan first.
public class LoanDeleteScopeTests
{
    private readonly Mock<IUnitOfWork> _uow = new();
    private readonly Mock<ILoanRepository> _loans = new();

    private LoanService Service(Loan loan, bool managerCanSee)
    {
        _uow.Setup(u => u.Loans).Returns(_loans.Object);
        _uow.Setup(u => u.SaveChangesAsync()).ReturnsAsync(1);
        _loans.Setup(r => r.GetByIdAsync(loan.Id)).ReturnsAsync(loan);
        _loans.Setup(r => r.HasAccessAsync(loan.Id, It.IsAny<int>(), It.IsAny<string?>())).ReturnsAsync(managerCanSee);
        return new LoanService(_uow.Object, new Mock<IEmailService>().Object, new Mock<IEmailTemplateProvider>().Object);
    }

    private static Loan Draft(int createdBy) => new() { Id = 5, Status = LoanStatus.Draft, CreatedByUserId = createdBy };

    [Fact]
    public async Task Manager_CannotDelete_AnotherUsersDraft_OutsideItsScope()
    {
        var result = await Service(Draft(createdBy: 1), managerCanSee: false).DeleteAsync(5, currentUserId: 20, "Manager");
        result.Success.Should().BeFalse();
        result.Errors.Should().Contain("Loan not found.");
        _loans.Verify(r => r.DeleteAsync(It.IsAny<int>()), Times.Never);
    }

    [Fact]
    public async Task Manager_CanDelete_AnotherUsersDraft_InsideItsScope()
    {
        var result = await Service(Draft(createdBy: 1), managerCanSee: true).DeleteAsync(5, currentUserId: 20, "Manager");
        result.Success.Should().BeTrue();
        _loans.Verify(r => r.DeleteAsync(5), Times.Once);
    }

    [Fact]
    public async Task Admin_StaysUnscoped()
    {
        var result = await Service(Draft(createdBy: 1), managerCanSee: false).DeleteAsync(5, currentUserId: 99, "Admin");
        result.Success.Should().BeTrue();
        _loans.Verify(r => r.HasAccessAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<string?>()), Times.Never);
    }

    [Fact]
    public async Task OtherRoles_StillDeleteOnlyTheirOwnDrafts()
    {
        (await Service(Draft(createdBy: 7), managerCanSee: false).DeleteAsync(5, currentUserId: 7, "Sales")).Success.Should().BeTrue();
        (await Service(Draft(createdBy: 1), managerCanSee: true).DeleteAsync(5, currentUserId: 7, "Sales")).Success.Should().BeFalse();
    }
}
