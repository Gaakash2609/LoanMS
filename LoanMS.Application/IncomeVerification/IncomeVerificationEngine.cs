using System.Text.Json;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
// The namespace segment 'IncomeVerification' shadows the entity type of the same
// name, so alias the entities explicitly.
using IncomeVerificationEntity = LoanMS.Domain.Entities.IncomeVerification;

namespace LoanMS.Application.IncomeVerification;

/// <summary>The canonical backend verification engine — Phase 4.</summary>
public interface IIncomeVerificationEngine
{
    IncomeVerificationEntity Run(IncomeVerificationEngineInput input);
}

// ── Income Verification Engine (Phase 4) ──────────────────────────────────────
// The single authoritative, Vanilla-equivalent salary cross-verification, ported
// from ai-agent.js _crossVerifySalary (line 259) and driven ONLY by trusted
// backend inputs. Preserves Vanilla exactly:
//   • required months from _incRequiredMonths (persisted reference date),
//   • per-month window 20th → next 15th,
//   • EXACT amount match via Math.Floor(x+0.5) (BRG-8), no tolerance,
//   • one bank credit consumed by at most one month (reuse prevented),
//   • passes only when EVERY required month matches.
// Adds the spec's mandated authority/security rules on top (which Vanilla lacked):
//   • a user-edited (override) salary can NEVER silently auto-verify → ManualReviewRequired (§4),
//   • an untrusted/ClientReported original → ManualReviewRequired (§26a),
//   • duplicate same-month slips → ManualReviewRequired / DuplicateSalarySlipMonth (§26f, BRG-3),
//   • statement coverage validated (§26c, BRG-1) — "no match" ≠ "no salary",
//   • declared-vs-verified discrepancy is surfaced, never auto-trusted, no threshold (§5, BRG-2),
//   • return/reversal narration is RECORDED but NOT excluded (user decision, Vanilla-exact).
public sealed class IncomeVerificationEngine : IIncomeVerificationEngine
{
    // India-only deployment; client builds txn dates as local `new Date(y,m-1,d)`
    // (parser.ts / perfios-core.js), stored as epoch-ms. Interpreting in IST and
    // comparing calendar dates reproduces Vanilla's local-midnight Date windowing.
    private static readonly TimeSpan IstOffset = TimeSpan.FromMinutes(330);

    private sealed record Reason(string Code, string? MonthLabel, string Detail);

    public IncomeVerificationEntity Run(IncomeVerificationEngineInput input)
    {
        var required = RequiredMonthsCalculator.Resolve(input.RequiredMonthsReferenceDate);
        var reasons = new List<Reason>();

        var iv = new IncomeVerificationEntity
        {
            LoanId = input.LoanId,
            ApplicantRole = input.ApplicantRole,
            ApplicantKey = input.ApplicantKey,
            RequiredMonthsReferenceDate = input.RequiredMonthsReferenceDate,
            RequiredMonthsJson = JsonSerializer.Serialize(
                required.Select(r => new { y = r.Year, m = r.Month, label = RequiredMonthsCalculator.Label(r) })),
            DeclaredIncome = input.DeclaredIncome,
            RunByUserId = input.RunByUserId,
            RunAt = input.RunAt,
            PerfiosReportId = input.PerfiosReportId,
            SourceReportHash = input.SourceReportHash,
            IdempotencyKey = input.IdempotencyKey,
            State = IncomeVerificationState.Pending,
        };

        // Slip lookup by (year,month) for this applicant + duplicate detection.
        var byMonth = input.Slips
            .GroupBy(s => (s.Year, s.Month))
            .ToDictionary(g => g.Key, g => g.ToList());

        var statement = input.Statement;
        var candidates = statement?.SalaryCreditCandidates ?? new List<NormalizedTransaction>();
        var usedCandidate = new bool[candidates.Count];

        bool anyOverride = false, anyUntrusted = false, anyDuplicate = false;
        var matchedNets = new List<decimal>();      // effective nets of matched months (for VerifiedIncome)
        var extractedNets = new List<decimal>();     // original nets present (for ExtractedIncome)

        foreach (var ym in required)
        {
            var label = RequiredMonthsCalculator.Label(ym);
            var winStartDate = new DateOnly(ym.Year, ym.Month, 20);
            var winEndAnchor = new DateTime(ym.Year, ym.Month, 1).AddMonths(1);
            var winEndDate = new DateOnly(winEndAnchor.Year, winEndAnchor.Month, 15);

            var month = new IncomeVerificationMonth
            {
                Year = ym.Year,
                Month = ym.Month,
                MonthLabel = label,
                WindowStart = new DateTime(ym.Year, ym.Month, 20, 0, 0, 0),
                WindowEnd = new DateTime(winEndDate.Year, winEndDate.Month, 15, 23, 59, 59),
                MatchStatus = "Pending",
            };

            // ── Slip presence + duplicate + trust/override ──────────────────────
            byMonth.TryGetValue((ym.Year, ym.Month), out var slipsForMonth);
            if (slipsForMonth is null || slipsForMonth.Count == 0)
            {
                month.MatchStatus = "MissingSlip";
                month.ReasonCode = nameof(IncomeVerificationReason.MissingSalarySlip);
                reasons.Add(new Reason(month.ReasonCode, label, "No salary slip found for this required month."));
                iv.Months.Add(month);
                continue;
            }

            if (slipsForMonth.Count > 1)
            {
                anyDuplicate = true;
                month.MatchStatus = "DuplicateSlip";
                month.ReasonCode = nameof(IncomeVerificationReason.DuplicateSalarySlipMonth);
                reasons.Add(new Reason(month.ReasonCode, label,
                    $"{slipsForMonth.Count} salary slips for the same applicant+month — none chosen silently; manual review required."));
                // Do not attempt a match; ambiguity must be resolved by a human.
                iv.Months.Add(month);
                continue;
            }

            var slip = slipsForMonth[0];
            month.SalarySlipExtractionId = slip.ExtractionId;
            month.OriginalExtractedSalary = slip.OriginalNetSalary;
            if (slip.OriginalNetSalary is > 0m) extractedNets.Add(slip.OriginalNetSalary.Value);

            if (!slip.IsTrustedOriginal)
            {
                anyUntrusted = true;
                reasons.Add(new Reason("UntrustedOriginal", label,
                    "Original net salary is client-reported (not server-extracted) — cannot auto-verify."));
            }
            if (slip.HasOverride)
            {
                anyOverride = true;
                reasons.Add(new Reason(nameof(IncomeVerificationReason.ManualSalaryOverride), label,
                    $"Salary was manually edited (original ₹{slip.OriginalNetSalary?.ToString() ?? "—"} → used ₹{slip.UserEditedSalary}). Cannot silently auto-verify."));
            }

            var effective = slip.EffectiveSalary;
            month.EffectiveSalary = effective;
            if (effective is null or <= 0m)
            {
                month.MatchStatus = "MissingSlip";
                month.ReasonCode = nameof(IncomeVerificationReason.MissingSalarySlip);
                reasons.Add(new Reason(month.ReasonCode, label, "Slip present but no usable net salary figure."));
                iv.Months.Add(month);
                continue;
            }

            // ── Bank statement present? ─────────────────────────────────────────
            if (statement is null)
            {
                month.MatchStatus = "MissingBankStatement";
                month.ReasonCode = nameof(IncomeVerificationReason.MissingBankStatement);
                reasons.Add(new Reason(month.ReasonCode, label, "No verified bank statement to validate salary credits."));
                iv.Months.Add(month);
                continue;
            }

            // ── Find an unused, in-window credit with an exact rounded amount ────
            int matchIdx = -1;
            bool anyInWindow = false;
            for (int j = 0; j < candidates.Count; j++)
            {
                if (usedCandidate[j]) continue;                     // reuse prevented (Vanilla usedTxn)
                var c = candidates[j];
                var txnDate = DateOnly.FromDateTime(
                    DateTimeOffset.FromUnixTimeMilliseconds(c.DateEpochMs).ToOffset(IstOffset).DateTime);
                if (txnDate < winStartDate || txnDate > winEndDate) continue;
                anyInWindow = true;
                if (SalaryMath.AmountsMatch(c.Amount, effective.Value)) { matchIdx = j; break; }
            }

            if (matchIdx >= 0)
            {
                usedCandidate[matchIdx] = true;
                var c = candidates[matchIdx];
                month.MatchStatus = "Matched";
                month.MatchedAmount = c.Amount;
                month.MatchedTransactionDate =
                    DateTimeOffset.FromUnixTimeMilliseconds(c.DateEpochMs).ToOffset(IstOffset).DateTime;
                month.MatchedTransactionRef = c.Desc;
                month.VerificationMethod = c.Section;   // "Salary" / "NEFT"
                month.BankAccountRef = statement.AccountNo ?? statement.Bank;
                matchedNets.Add(effective.Value);

                // Reversal RECORD-ONLY (user decision): flag but do not exclude.
                if (c.IsPossibleReturnOrReversal)
                    reasons.Add(new Reason("InfoReturnReversalNarration", label,
                        "Matched credit's narration matches a return/reversal pattern — recorded for review, not excluded."));
                iv.Months.Add(month);
                continue;
            }

            // No match — classify (§9): amount mismatch vs coverage vs no credit.
            if (anyInWindow)
            {
                month.MatchStatus = "AmountMismatch";
                month.ReasonCode = nameof(IncomeVerificationReason.SalaryAmountMismatch);
                reasons.Add(new Reason(month.ReasonCode, label,
                    $"A credit exists in the window (20 {label} → 15 next) but none exactly matches net ₹{effective}."));
            }
            else if (!StatementCoversWindow(statement, winStartDate, winEndDate))
            {
                month.MatchStatus = "MissingStatementCoverage";
                month.ReasonCode = nameof(IncomeVerificationReason.MissingStatementCoverage);
                reasons.Add(new Reason(month.ReasonCode, label,
                    "Bank statement does not cover this month's salary window — cannot conclude 'no salary'."));
            }
            else
            {
                month.MatchStatus = "NoCreditInWindow";
                month.ReasonCode = nameof(IncomeVerificationReason.TransactionOutsideWindow);
                reasons.Add(new Reason(month.ReasonCode, label,
                    "No salary credit found inside the window, though the statement covers it."));
            }
            iv.Months.Add(month);
        }

        // ── Incomes ──────────────────────────────────────────────────────────────
        if (extractedNets.Count > 0) iv.ExtractedIncome = SalaryMath.JsRound(extractedNets.Average());

        // ── Declared-vs-verified discrepancy: surface only, NO threshold (BRG-2) ──
        bool allMatched = iv.Months.Count == required.Count && iv.Months.All(m => m.MatchStatus == "Matched");

        // ── Gap-1: bank-evidence authority gate ──────────────────────────────────
        // Client-parsed bank evidence is UNTRUSTED and can NEVER AutoVerify — a
        // fabricated client transaction (even one that exactly matches a trusted
        // slip) must route to manual review. Mirrors the §26a untrusted-original
        // gate; does NOT alter any salary matching/window/rounding/reuse rule.
        bool evidenceTrusted = statement is not null && statement.IsTrustedEvidence;
        if (statement is not null && !statement.IsTrustedEvidence)
            reasons.Add(new Reason("UntrustedBankEvidence", null,
                "Bank evidence is client-parsed (not server-authoritative) — cannot auto-verify; manual review required."));

        // ── State resolution (Vanilla pass/block + spec authority gates) ─────────
        if (statement is null && iv.Months.All(m => m.MatchStatus == "MissingBankStatement"))
        {
            iv.State = IncomeVerificationState.ManualReviewRequired;
            if (!reasons.Any(r => r.Code == nameof(IncomeVerificationReason.MissingBankStatement)))
                reasons.Add(new Reason(nameof(IncomeVerificationReason.MissingBankStatement), null,
                    "No verified bank statement present for this applicant."));
        }
        else if (allMatched && evidenceTrusted && !anyOverride && !anyUntrusted && !anyDuplicate)
        {
            iv.State = IncomeVerificationState.AutoVerified;
            iv.VerifiedIncome = matchedNets.Count > 0 ? SalaryMath.JsRound(matchedNets.Average()) : null;
        }
        else
        {
            // Every non-clean outcome (incl. untrusted bank evidence) routes to a
            // human (mirrors Vanilla's block+assign).
            iv.State = IncomeVerificationState.ManualReviewRequired;
        }

        // Declared-vs-verified note (informational; only meaningful once verified).
        if (iv.VerifiedIncome is not null && input.DeclaredIncome is > 0m &&
            SalaryMath.JsRound(input.DeclaredIncome.Value) != iv.VerifiedIncome.Value)
        {
            reasons.Add(new Reason(nameof(IncomeVerificationReason.DeclaredIncomeMismatch), null,
                $"Declared income ₹{input.DeclaredIncome} differs from bank-verified ₹{iv.VerifiedIncome}. Surfaced for review; declared income is never auto-trusted."));
        }

        iv.ReasonCodesJson = reasons.Count > 0 ? JsonSerializer.Serialize(reasons) : null;
        return iv;
    }

    // §26(c)/BRG-1: covered when statement period spans the whole window.
    private static bool StatementCoversWindow(NormalizedBankStatement s, DateOnly winStart, DateOnly winEnd)
    {
        if (s.CoverageStart is null || s.CoverageEnd is null) return true; // unknown → don't assert "not covered"
        var covStart = DateOnly.FromDateTime(s.CoverageStart.Value);
        var covEnd = DateOnly.FromDateTime(s.CoverageEnd.Value);
        return covStart <= winStart && covEnd >= winEnd;
    }
}
