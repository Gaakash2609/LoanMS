using FluentAssertions;
using LoanMS.Application.DTOs;
using LoanMS.Application.Services;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using Xunit;

namespace LoanMS.Tests.Services;

/// <summary>
/// Pure-rule unit tests for the customer-duplicate / re-application / archive
/// work: identifier normalisation, global identity resolution (incl. the
/// conflict case), and the central 45-day eligibility evaluator (exact
/// boundaries, missing RejectedAt, multiple rejections, archive combinations).
/// </summary>
public class CustomerIdentityAndEligibilityRuleTests
{
    // ── Normalisation ─────────────────────────────────────────────────────────

    [Theory]
    [InlineData(" abcde1234f ", "ABCDE1234F")]
    [InlineData("ABCDE1234F", "ABCDE1234F")]
    [InlineData("abcde1234", null)]      // incomplete (autosave mid-typing)
    [InlineData("ABCD11234F", null)]     // bad shape
    [InlineData("", null)]
    [InlineData(null, null)]
    public void NormalizePan_TrimUppercase_OnlyValidPanIdentifies(string? raw, string? expected) =>
        Customer.NormalizePan(raw).Should().Be(expected);

    [Theory]
    [InlineData("9876543210", "9876543210")]
    [InlineData("+91 98765 43210", "9876543210")]
    [InlineData("+91-98765-43210", "9876543210")]
    [InlineData("09876543210", "9876543210")]
    [InlineData("(0) 98765.43210", "9876543210")]
    [InlineData("98765", null)]           // fewer than 10 digits
    [InlineData("  ", null)]
    [InlineData(null, null)]
    public void NormalizeMobile_DigitsOnly_Last10(string? raw, string? expected) =>
        Customer.NormalizeMobile(raw).Should().Be(expected);

    [Theory]
    [InlineData("  Ravi.K@Example.COM ", "ravi.k@example.com")]
    [InlineData("9876543210@efin.auto", null)]                 // system placeholder
    [InlineData("draft-0123abcd@efin.auto", null)]             // system placeholder
    [InlineData("no-at-sign", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void NormalizeEmail_TrimLowercase_PlaceholdersNeverIdentify(string? raw, string? expected) =>
        Customer.NormalizeEmail(raw).Should().Be(expected);

    [Fact]
    public void RefreshIdentityKeys_DerivesAllThreeKeys()
    {
        var c = new Customer { PanNumber = "abcde1234f", Phone = "+91 98765 43210", Email = " A@B.COM " };
        c.RefreshIdentityKeys();
        c.PanNormalized.Should().Be("ABCDE1234F");
        c.PhoneNormalized.Should().Be("9876543210");
        c.EmailNormalized.Should().Be("a@b.com");
    }

    // ── Identity resolution (CustomerService.ResolveIdentity — pure) ─────────

    private static CustomerIdentityRow Row(int id, string? pan = null, string? phone = null, string? email = null, bool deleted = false)
        => new() { Id = id, PanNormalized = pan, PhoneNormalized = phone, EmailNormalized = email, IsDeleted = deleted };

    [Fact]
    public void Resolve_NoMatches_NoDraft_IsNew()
    {
        var r = CustomerService.ResolveIdentity("ABCDE1234F", new List<CustomerIdentityRow>(), null, false);
        r.Outcome.Should().Be(CustomerIdentityOutcome.New);
        r.NeedsReview.Should().BeFalse();
    }

    [Fact]
    public void Resolve_PanAndMobileSameCustomer_Matched_AsExistingMaster()
    {
        var a = Row(1, "ABCDE1234F", "9876543210");
        var r = CustomerService.ResolveIdentity("ABCDE1234F", new[] { a, a }, null, false);
        r.Outcome.Should().Be(CustomerIdentityOutcome.Matched);
        r.CustomerId.Should().Be(1);
        r.IsExistingMaster.Should().BeTrue("a returning customer's identity fields must not be overwritten");
    }

    [Fact]
    public void Resolve_PanMatchesOneCustomer_MobileAnother_Conflict_NeverMerged()
    {
        var a = Row(1, "ABCDE1234F", "1111111111");
        var b = Row(2, "ZZZZZ9999Z", "9876543210");
        var r = CustomerService.ResolveIdentity("ABCDE1234F", new[] { a, b }, null, false);
        r.Outcome.Should().Be(CustomerIdentityOutcome.Conflict);
        r.NeedsReview.Should().BeTrue();
        r.CustomerId.Should().BeNull();
        r.MatchedCustomerIds.Should().BeEquivalentTo(new[] { 1, 2 });
        r.Message.Should().Contain("admin review");
    }

    [Fact]
    public void Resolve_MobileMatchesCustomerWithDifferentPan_Conflict()
    {
        var a = Row(1, "ZZZZZ9999Z", "9876543210");
        var r = CustomerService.ResolveIdentity("ABCDE1234F", new[] { a }, null, false);
        r.Outcome.Should().Be(CustomerIdentityOutcome.Conflict);
    }

    [Fact]
    public void Resolve_OnlySoftDeletedCustomerMatches_NeedsReview_NotRestored()
    {
        var a = Row(1, "ABCDE1234F", deleted: true);
        var r = CustomerService.ResolveIdentity("ABCDE1234F", new[] { a }, null, false);
        r.Outcome.Should().Be(CustomerIdentityOutcome.DeletedMatch);
        r.NeedsReview.Should().BeTrue();
        r.CustomerId.Should().BeNull();
    }

    [Fact]
    public void Resolve_MobileOnlyMatch_ToCustomerWithoutPan_Matched()
    {
        var a = Row(1, null, "9876543210");
        var r = CustomerService.ResolveIdentity("ABCDE1234F", new[] { a }, null, false);
        r.Outcome.Should().Be(CustomerIdentityOutcome.Matched);
        r.CustomerId.Should().Be(1);
    }

    [Fact]
    public void Resolve_DraftsOwnProvisionalRecord_IsNotACompetingMatch_AndIsSupersededByExistingCustomer()
    {
        // Draft started with mobile only → provisional customer 10 (phone M).
        // The PAN typed later belongs to existing customer 1.
        var provisional = Row(10, null, "9876543210");
        var existing = Row(1, "ABCDE1234F", "1111111111");
        var r = CustomerService.ResolveIdentity("ABCDE1234F", new[] { provisional, existing }, provisional, ownProvisional: true);
        r.Outcome.Should().Be(CustomerIdentityOutcome.Matched);
        r.CustomerId.Should().Be(1);
        r.SupersededProvisionalCustomerId.Should().Be(10);
        r.IsExistingMaster.Should().BeTrue();
    }

    [Fact]
    public void Resolve_DraftsOwnProvisionalRecord_OnlyMatch_KeepsRefiningIt()
    {
        var provisional = Row(10, null, "9876543210");
        var r = CustomerService.ResolveIdentity(null, new[] { provisional }, provisional, ownProvisional: true);
        r.Outcome.Should().Be(CustomerIdentityOutcome.Matched);
        r.CustomerId.Should().Be(10);
        r.IsExistingMaster.Should().BeFalse("the draft's own record keeps being refined as the user types");
    }

    [Fact]
    public void Resolve_DraftLinkedToSharedCustomer_TypedDetailsIdentifyAnother_Conflict()
    {
        var shared = Row(5, "AAAAA1111A", "9876543210");
        var other = Row(6, "BBBBB2222B", "2222222222");
        var r = CustomerService.ResolveIdentity("BBBBB2222B", new[] { other }, shared, ownProvisional: false);
        r.Outcome.Should().Be(CustomerIdentityOutcome.Conflict);
    }

    // ── Eligibility: duplicate application + 45-day rule ─────────────────────

    private static readonly DateTime Now = new(2026, 9, 24, 12, 0, 0, DateTimeKind.Utc);

    private static LoanEligibilityRow Loan(int id, LoanStatus status, DateTime? rejectedAt = null,
        DateTime? historyRejectedAt = null, bool deleted = false, bool archived = false) => new()
    {
        Id = id, LoanNumber = $"EFIN{id}", Status = status, RejectedAt = rejectedAt,
        LastRejectionTransitionAt = historyRejectedAt, IsDeleted = deleted, IsArchived = archived,
        CreatedByUserId = 99, CreatedAt = Now.AddDays(-100),
    };

    [Theory]
    [InlineData(LoanStatus.Draft)]
    [InlineData(LoanStatus.Submitted)]
    [InlineData(LoanStatus.UnderReview)]
    [InlineData(LoanStatus.Approved)]
    [InlineData(LoanStatus.Acceptance)]
    [InlineData(LoanStatus.Disbursed)]   // running loan → active (conservative)
    [InlineData(LoanStatus.OnHold)]
    [InlineData(LoanStatus.Decision)]
    public void ActiveOrInProcessApplication_Blocks(LoanStatus status)
    {
        var e = LoanService.EvaluateApplicationEligibility(new[] { Loan(1, status) }, Now);
        e.Allowed.Should().BeFalse();
        e.Code.Should().Be(ApiErrorCodes.ActiveApplicationExists);
        e.BlockingLoanNumber.Should().Be("EFIN1");
    }

    [Fact]
    public void OnlyClosedApplication_Allowed_CustomerExistingDoesNotBlock()
    {
        LoanService.EvaluateApplicationEligibility(new[] { Loan(1, LoanStatus.Closed) }, Now).Allowed.Should().BeTrue();
        LoanService.EvaluateApplicationEligibility(Array.Empty<LoanEligibilityRow>(), Now).Allowed.Should().BeTrue();
    }

    [Fact]
    public void Rejected_Day44_Blocked_WithReapplyDate()
    {
        var rejectedAt = Now.AddDays(-44);
        var e = LoanService.EvaluateApplicationEligibility(new[] { Loan(1, LoanStatus.Rejected, rejectedAt) }, Now);
        e.Allowed.Should().BeFalse();
        e.Code.Should().Be(ApiErrorCodes.ReapplyCooldown);
        e.ReapplyAfterUtc.Should().Be(rejectedAt.AddDays(45));
        e.Message.Should().Contain("Re-application allowed after");
    }

    [Fact]
    public void Rejected_ExactlyDay45_Allowed()
    {
        var e = LoanService.EvaluateApplicationEligibility(new[] { Loan(1, LoanStatus.Rejected, Now.AddDays(-45)) }, Now);
        e.Allowed.Should().BeTrue("allowed exactly when now >= RejectedAt + 45 days");
    }

    [Fact]
    public void Rejected_OneSecondBeforeDay45_Blocked()
    {
        var e = LoanService.EvaluateApplicationEligibility(
            new[] { Loan(1, LoanStatus.Rejected, Now.AddDays(-45).AddSeconds(1)) }, Now);
        e.Allowed.Should().BeFalse();
    }

    [Fact]
    public void CooldownCountsFromRejectedAt_NotCreatedAt()
    {
        // Created 200 days ago, rejected 10 days ago → still blocked.
        var row = Loan(1, LoanStatus.Rejected, Now.AddDays(-10));
        row.CreatedAt = Now.AddDays(-200);
        LoanService.EvaluateApplicationEligibility(new[] { row }, Now).Allowed.Should().BeFalse();
    }

    [Fact]
    public void MultipleRejections_LatestRejectionWins()
    {
        var e = LoanService.EvaluateApplicationEligibility(new[]
        {
            Loan(1, LoanStatus.Rejected, Now.AddDays(-100)),
            Loan(2, LoanStatus.Rejected, Now.AddDays(-20)),
        }, Now);
        e.Allowed.Should().BeFalse();
        e.BlockingLoanId.Should().Be(2);
        e.ReapplyAfterUtc.Should().Be(Now.AddDays(-20).AddDays(45));
    }

    [Fact]
    public void MissingRejectedAt_UsesExactHistoryTransition()
    {
        var blocked = LoanService.EvaluateApplicationEligibility(
            new[] { Loan(1, LoanStatus.Rejected, rejectedAt: null, historyRejectedAt: Now.AddDays(-5)) }, Now);
        blocked.Code.Should().Be(ApiErrorCodes.ReapplyCooldown);

        var allowed = LoanService.EvaluateApplicationEligibility(
            new[] { Loan(1, LoanStatus.Rejected, rejectedAt: null, historyRejectedAt: Now.AddDays(-60)) }, Now);
        allowed.Allowed.Should().BeTrue();
    }

    [Fact]
    public void MissingRejectedAt_AndNoHistory_Blocked_AdminReview_NeverGuessedFromCreatedAt()
    {
        var row = Loan(1, LoanStatus.Rejected);          // no RejectedAt, no history
        row.CreatedAt = Now.AddDays(-400);               // an old CreatedAt must NOT be used as a guess
        var e = LoanService.EvaluateApplicationEligibility(new[] { row }, Now);
        e.Allowed.Should().BeFalse();
        e.Code.Should().Be(ApiErrorCodes.RejectionDateUnknown);
        e.Message.Should().Contain("admin review");
    }

    [Fact]
    public void HistoryLaterThanRejectedAt_LaterDateUsed()
    {
        var e = LoanService.EvaluateApplicationEligibility(
            new[] { Loan(1, LoanStatus.Rejected, rejectedAt: Now.AddDays(-90), historyRejectedAt: Now.AddDays(-3)) }, Now);
        e.Allowed.Should().BeFalse();
        e.LatestRejectedAtUtc.Should().Be(Now.AddDays(-3));
    }

    [Fact]
    public void ReopenedApplication_RejectedAtKept_NoLongerCountsAsRejection_ButCountsAsActive()
    {
        // A reopened loan keeps RejectedAt but its status is active again.
        var e = LoanService.EvaluateApplicationEligibility(
            new[] { Loan(1, LoanStatus.Submitted, rejectedAt: Now.AddDays(-2)) }, Now);
        e.Code.Should().Be(ApiErrorCodes.ActiveApplicationExists);
    }

    [Fact]
    public void ExcludedLoan_IsTheApplicationBeingSubmitted_NotAConflictWithItself()
    {
        var e = LoanService.EvaluateApplicationEligibility(new[] { Loan(7, LoanStatus.Draft) }, Now, excludeLoanId: 7);
        e.Allowed.Should().BeTrue();
    }

    [Fact]
    public void SoftDeletedActiveApplication_DoesNotBlock()
    {
        LoanService.EvaluateApplicationEligibility(new[] { Loan(1, LoanStatus.Draft, deleted: true) }, Now)
            .Allowed.Should().BeTrue();
    }

    [Fact]
    public void SoftDeletedRejectedApplication_StillCountsForTheCooldown()
    {
        var e = LoanService.EvaluateApplicationEligibility(
            new[] { Loan(1, LoanStatus.Rejected, Now.AddDays(-10), deleted: true) }, Now);
        e.Code.Should().Be(ApiErrorCodes.ReapplyCooldown);
    }

    // The four archive combinations from the brief.
    [Fact]
    public void Archive_OnlyArchivedNonRejected_AllowedImmediately()
    {
        LoanService.EvaluateApplicationEligibility(
            new[] { Loan(1, LoanStatus.Closed, archived: true) }, Now).Allowed.Should().BeTrue();
    }

    [Fact]
    public void Archive_ArchivedPlusAnotherActive_Blocked()
    {
        var e = LoanService.EvaluateApplicationEligibility(new[]
        {
            Loan(1, LoanStatus.Closed, archived: true),
            Loan(2, LoanStatus.UnderReview),
        }, Now);
        e.Code.Should().Be(ApiErrorCodes.ActiveApplicationExists);
        e.BlockingLoanId.Should().Be(2);
    }

    [Fact]
    public void Archive_ArchivedRejected_Before45Days_Blocked()
    {
        LoanService.EvaluateApplicationEligibility(
            new[] { Loan(1, LoanStatus.Rejected, Now.AddDays(-30), archived: true) }, Now)
            .Code.Should().Be(ApiErrorCodes.ReapplyCooldown, "archiving never resets the rejection restriction");
    }

    [Fact]
    public void Archive_ArchivedRejected_After45Days_Allowed()
    {
        LoanService.EvaluateApplicationEligibility(
            new[] { Loan(1, LoanStatus.Rejected, Now.AddDays(-46), archived: true) }, Now)
            .Allowed.Should().BeTrue();
    }

    [Fact]
    public void Classification_TerminalIsRejectedAndClosedOnly_ArchivableMatches()
    {
        foreach (var s in Enum.GetValues<LoanStatus>())
        {
            var terminal = s is LoanStatus.Rejected or LoanStatus.Closed;
            LoanService.IsActiveApplicationStatus(s).Should().Be(!terminal, s.ToString());
            LoanService.IsArchivableStatus(s).Should().Be(terminal, s.ToString());
        }
    }

    // ── Caller-facing message: no other user's application details leak ──────

    [Fact]
    public void DescribeForCaller_SalesSeesGenericText_AdminSeesLoanNumber()
    {
        var e = LoanService.EvaluateApplicationEligibility(new[] { Loan(1, LoanStatus.Submitted) }, Now);
        LoanService.DescribeEligibilityForCaller(e, callerUserId: 5, callerRole: "Sales")
            .Should().StartWith("Active application exists").And.NotContain("EFIN1");
        LoanService.DescribeEligibilityForCaller(e, callerUserId: 5, callerRole: "Admin").Should().Contain("EFIN1");
        LoanService.DescribeEligibilityForCaller(e, callerUserId: 99, callerRole: "Sales")
            .Should().Contain("EFIN1", "the application's own creator may see its number");
    }
}
