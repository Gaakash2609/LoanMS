using FluentAssertions;
using LoanMS.Application.IncomeVerification;
using LoanMS.Domain.Enums;
using Xunit;

namespace LoanMS.Tests.Services;

// ── Phase 4 engine parity + security tests (§23 matrix) ───────────────────────
// Proves the canonical engine reproduces Vanilla _crossVerifySalary AND enforces
// the spec's authority gates Vanilla lacked. Reference date fixed at 2026-06-20
// (day >= 15 → recentBack 1 → required months Mar/Apr/May 2026).
public class IncomeVerificationEnginePhase4Tests
{
    private static readonly DateTime Ref = new(2026, 6, 20);
    private static readonly TimeSpan Ist = TimeSpan.FromMinutes(330);

    private static long IstMs(int y, int m, int d) =>
        new DateTimeOffset(y, m, d, 0, 0, 0, Ist).ToUnixTimeMilliseconds();   // client's local-midnight

    private static NormalizedTransaction Cr(int y, int m, int d, decimal amt, string section = "Salary", string desc = "SALARY CREDIT") =>
        new()
        {
            DateEpochMs = IstMs(y, m, d),
            Date = DateTimeOffset.FromUnixTimeMilliseconds(IstMs(y, m, d)).UtcDateTime,
            Amount = amt, Type = "CR", Section = section, Desc = desc, RawDesc = desc,
            IsPossibleReturnOrReversal = System.Text.RegularExpressions.Regex.IsMatch(desc, "return|reversal|reject", System.Text.RegularExpressions.RegexOptions.IgnoreCase),
        };

    private static NormalizedBankStatement Stmt(IEnumerable<NormalizedTransaction> txns, DateTime? covStart = null, DateTime? covEnd = null) =>
        new()
        {
            Bank = "HDFC", AccountNo = "123",
            CoverageStart = covStart ?? new DateTime(2026, 1, 1),
            CoverageEnd = covEnd ?? new DateTime(2026, 12, 31),
            CoverageSource = "StatementPeriod",
            // Engine-logic fixtures assume trusted (server-authoritative) evidence so
            // the AutoVerified path is exercised. Gap-1's untrusted case is a dedicated
            // test below. NOT a production claim — no server producer sets this true.
            IsTrustedEvidence = true,
            SalaryCreditCandidates = txns.ToList(),
        };

    private static EngineSlip Slip(int y, int m, decimal? original, decimal? edited = null, bool trusted = true) =>
        new() { ExtractionId = y * 100 + m, Year = y, Month = m, OriginalNetSalary = original, UserEditedSalary = edited, IsTrustedOriginal = trusted };

    private static IncomeVerificationEngineInput Input(NormalizedBankStatement? stmt, IEnumerable<EngineSlip> slips, decimal? declared = null) =>
        new() { LoanId = 1, RequiredMonthsReferenceDate = Ref, Statement = stmt, Slips = slips.ToList(), DeclaredIncome = declared, RunByUserId = 9, RunAt = DateTime.UtcNow };

    private static IEnumerable<EngineSlip> ThreeTrustedSlips(decimal amt) =>
        new[] { Slip(2026, 3, amt), Slip(2026, 4, amt), Slip(2026, 5, amt) };

    private static readonly IncomeVerificationEngine Engine = new();

    // ── Required months (Vanilla _incRequiredMonths parity) ───────────────────
    [Fact]
    public void RequiredMonths_Before15th_GoesBackTwo()
    {
        var r = RequiredMonthsCalculator.Resolve(new DateTime(2026, 6, 10)); // day<15 → back 2
        r.Select(x => x.Month).Should().Equal(2, 3, 4); // Feb, Mar, Apr
        r.All(x => x.Year == 2026).Should().BeTrue();
    }

    [Fact]
    public void RequiredMonths_OnOrAfter15th_GoesBackOne_WithYearRollover()
    {
        var r = RequiredMonthsCalculator.Resolve(new DateTime(2026, 1, 20)); // back 1 → newest Dec 2025
        r.Should().Equal(
            new RequiredMonthsCalculator.YearMonth(2025, 10),
            new RequiredMonthsCalculator.YearMonth(2025, 11),
            new RequiredMonthsCalculator.YearMonth(2025, 12));
    }

    // ── Positive ──────────────────────────────────────────────────────────────
    [Fact]
    public void AllMonthsExactMatch_AutoVerified_WithVerifiedIncome()
    {
        var stmt = Stmt(new[] { Cr(2026, 3, 25, 50000), Cr(2026, 4, 25, 50000), Cr(2026, 5, 25, 50000) });
        var iv = Engine.Run(Input(stmt, ThreeTrustedSlips(50000)));

        iv.State.Should().Be(IncomeVerificationState.AutoVerified);
        iv.VerifiedIncome.Should().Be(50000);
        iv.Months.Should().OnlyContain(m => m.MatchStatus == "Matched");
        iv.Months.Should().HaveCount(3);
    }

    // ── Gap-1: untrusted (client-parsed) bank evidence can NEVER AutoVerify ───
    [Fact]
    public void UntrustedBankEvidence_NeverAutoVerifies_EvenWithPerfectMatch()
    {
        var stmt = Stmt(new[] { Cr(2026, 3, 25, 50000), Cr(2026, 4, 25, 50000), Cr(2026, 5, 25, 50000) });
        stmt.IsTrustedEvidence = false;   // client-parsed — a fabricated credit could look perfect
        var iv = Engine.Run(Input(stmt, ThreeTrustedSlips(50000)));
        iv.State.Should().Be(IncomeVerificationState.ManualReviewRequired);
        iv.VerifiedIncome.Should().BeNull();
        iv.ReasonCodesJson.Should().Contain("UntrustedBankEvidence");
        // Matching still runs so the reviewer sees the month-by-month evidence.
        iv.Months.Should().OnlyContain(m => m.MatchStatus == "Matched");
    }

    // ── Rounding parity (BRG-8: Math.Floor(x+0.5)) ────────────────────────────
    [Fact]
    public void Amount_49Paise_Matches_50Paise_DoesNot()
    {
        // .49 rounds down → equals 50000; .50 rounds up → 50001 ≠ 50000.
        var ok = Engine.Run(Input(
            Stmt(new[] { Cr(2026, 3, 25, 50000.49m), Cr(2026, 4, 25, 50000m), Cr(2026, 5, 25, 50000m) }),
            ThreeTrustedSlips(50000)));
        ok.State.Should().Be(IncomeVerificationState.AutoVerified);

        var bad = Engine.Run(Input(
            Stmt(new[] { Cr(2026, 3, 25, 50000.50m), Cr(2026, 4, 25, 50000m), Cr(2026, 5, 25, 50000m) }),
            ThreeTrustedSlips(50000)));
        bad.State.Should().Be(IncomeVerificationState.ManualReviewRequired);
        bad.Months.Single(m => m.MonthLabel == "Mar 2026").MatchStatus.Should().Be("AmountMismatch");
    }

    // ── Negative matrix ───────────────────────────────────────────────────────
    [Fact]
    public void WrongAmountInWindow_AmountMismatch()
    {
        var iv = Engine.Run(Input(
            Stmt(new[] { Cr(2026, 3, 25, 49000), Cr(2026, 4, 25, 50000), Cr(2026, 5, 25, 50000) }),
            ThreeTrustedSlips(50000)));
        iv.State.Should().Be(IncomeVerificationState.ManualReviewRequired);
        iv.Months.Single(m => m.MonthLabel == "Mar 2026").ReasonCode.Should().Be("SalaryAmountMismatch");
    }

    [Fact]
    public void CreditOutsideWindow_NoCreditInWindow()
    {
        // 18 Mar is before the 20 Mar → 15 Apr window; statement still covers the period.
        var iv = Engine.Run(Input(
            Stmt(new[] { Cr(2026, 3, 18, 50000), Cr(2026, 4, 25, 50000), Cr(2026, 5, 25, 50000) }),
            ThreeTrustedSlips(50000)));
        iv.State.Should().Be(IncomeVerificationState.ManualReviewRequired);
        iv.Months.Single(m => m.MonthLabel == "Mar 2026").MatchStatus.Should().Be("NoCreditInWindow");
    }

    [Fact]
    public void MissingSlipForAMonth_MissingSalarySlip()
    {
        var slips = new[] { Slip(2026, 3, 50000), Slip(2026, 5, 50000) }; // April missing
        var iv = Engine.Run(Input(Stmt(new[] { Cr(2026, 3, 25, 50000), Cr(2026, 5, 25, 50000) }), slips));
        iv.State.Should().Be(IncomeVerificationState.ManualReviewRequired);
        iv.Months.Single(m => m.MonthLabel == "Apr 2026").ReasonCode.Should().Be("MissingSalarySlip");
    }

    [Fact]
    public void StatementDoesNotCoverWindow_MissingStatementCoverage()
    {
        // No in-window credit for March, and coverage stops at end of Feb.
        var iv = Engine.Run(Input(
            Stmt(new[] { Cr(2026, 4, 25, 50000), Cr(2026, 5, 25, 50000) },
                 covStart: new DateTime(2026, 1, 1), covEnd: new DateTime(2026, 2, 28)),
            ThreeTrustedSlips(50000)));
        iv.Months.Single(m => m.MonthLabel == "Mar 2026").ReasonCode.Should().Be("MissingStatementCoverage");
    }

    [Fact]
    public void OneCredit_CannotBeReusedForTwoMonths()
    {
        // Only a single ₹50000 credit — the first month consumes it, the rest can't reuse it.
        var iv = Engine.Run(Input(Stmt(new[] { Cr(2026, 3, 25, 50000) }), ThreeTrustedSlips(50000)));
        iv.State.Should().Be(IncomeVerificationState.ManualReviewRequired);
        iv.Months.Count(m => m.MatchStatus == "Matched").Should().Be(1);
        iv.Months.Count(m => m.MatchStatus != "Matched").Should().Be(2);
    }

    [Fact]
    public void MissingBankStatement_ManualReview()
    {
        var iv = Engine.Run(Input(stmt: null, ThreeTrustedSlips(50000)));
        iv.State.Should().Be(IncomeVerificationState.ManualReviewRequired);
        iv.Months.Should().OnlyContain(m => m.MatchStatus == "MissingBankStatement");
    }

    // ── Security: the §4 tampering scenario ───────────────────────────────────
    [Fact]
    public void ManualOverride_EvenWhenBankMatchesEditedAmount_NeverAutoVerifies()
    {
        // Original ₹50,000, user edits to ₹45,000, bank credit is ₹45,000.
        // The month "matches" on the edited value, but it must NOT auto-verify.
        var slips = new[] { Slip(2026, 3, original: 50000, edited: 45000), Slip(2026, 4, 50000), Slip(2026, 5, 50000) };
        var stmt = Stmt(new[] { Cr(2026, 3, 25, 45000), Cr(2026, 4, 25, 50000), Cr(2026, 5, 25, 50000) });
        var iv = Engine.Run(Input(stmt, slips));

        iv.State.Should().Be(IncomeVerificationState.ManualReviewRequired);
        iv.VerifiedIncome.Should().BeNull();
        iv.ReasonCodesJson.Should().Contain("ManualSalaryOverride");
        // Original is preserved on the month record (never overwritten).
        iv.Months.Single(m => m.MonthLabel == "Mar 2026").OriginalExtractedSalary.Should().Be(50000);
    }

    [Fact]
    public void UntrustedOriginal_NeverAutoVerifies_EvenIfAllMatch()
    {
        var slips = new[] { Slip(2026, 3, 50000, trusted: false), Slip(2026, 4, 50000), Slip(2026, 5, 50000) };
        var stmt = Stmt(new[] { Cr(2026, 3, 25, 50000), Cr(2026, 4, 25, 50000), Cr(2026, 5, 25, 50000) });
        var iv = Engine.Run(Input(stmt, slips));
        iv.State.Should().Be(IncomeVerificationState.ManualReviewRequired);
        iv.ReasonCodesJson.Should().Contain("UntrustedOriginal");
    }

    [Fact]
    public void DuplicateSameMonthSlip_ManualReview()
    {
        var slips = new[] { Slip(2026, 3, 50000), Slip(2026, 3, 50000), Slip(2026, 4, 50000), Slip(2026, 5, 50000) };
        var stmt = Stmt(new[] { Cr(2026, 3, 25, 50000), Cr(2026, 4, 25, 50000), Cr(2026, 5, 25, 50000) });
        var iv = Engine.Run(Input(stmt, slips));
        iv.State.Should().Be(IncomeVerificationState.ManualReviewRequired);
        iv.Months.Single(m => m.MonthLabel == "Mar 2026").ReasonCode.Should().Be("DuplicateSalarySlipMonth");
    }

    [Fact]
    public void DeclaredVsVerified_Discrepancy_IsSurfaced_ButStillAutoVerifies_NoThreshold()
    {
        var stmt = Stmt(new[] { Cr(2026, 3, 25, 50000), Cr(2026, 4, 25, 50000), Cr(2026, 5, 25, 50000) });
        var iv = Engine.Run(Input(stmt, ThreeTrustedSlips(50000), declared: 80000));
        iv.State.Should().Be(IncomeVerificationState.AutoVerified);
        iv.VerifiedIncome.Should().Be(50000);            // verified, NOT the declared 80000
        iv.ReasonCodesJson.Should().Contain("DeclaredIncomeMismatch");
    }

    // ── Reversal record-only (user decision) ──────────────────────────────────
    [Fact]
    public void ReturnReversalNarration_IsRecorded_ButNotExcluded()
    {
        var stmt = Stmt(new[]
        {
            Cr(2026, 3, 25, 50000, desc: "SALARY REVERSAL"),   // flagged, still matches
            Cr(2026, 4, 25, 50000),
            Cr(2026, 5, 25, 50000),
        });
        var iv = Engine.Run(Input(stmt, ThreeTrustedSlips(50000)));
        iv.State.Should().Be(IncomeVerificationState.AutoVerified);   // record-only, not excluded
        iv.ReasonCodesJson.Should().Contain("InfoReturnReversalNarration");
    }
}
