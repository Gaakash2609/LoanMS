namespace LoanMS.Application.IncomeVerification;

// ── Salary amount rounding (BRG-8, user-confirmed) ────────────────────────────
// Vanilla compares amounts with JavaScript `Math.round(Number(x))`. Phase-1
// scratch tests (Node vs .NET) proved:
//   • C# default Math.Round (banker's/ToEven) is WRONG (0.5→0, 2.5→2).
//   • C# MidpointRounding.AwayFromZero is WRONG on negatives (JS Math.round(-2.5)=-2, Away=-3).
//   • Math.Floor(x + 0.5) matches JS Math.round on EVERY tested case.
// So salary matching rounds with Math.Floor(x + 0.5m). No tolerance / no fuzzy /
// no ±₹1 — exact comparison of the rounded integers, exactly as Vanilla.
public static class SalaryMath
{
    /// <summary>JS Math.round parity: Math.Floor(x + 0.5). Deterministic on decimal.</summary>
    public static decimal JsRound(decimal x) => Math.Floor(x + 0.5m);

    /// <summary>Exact rounded-amount equality (the salary match test).</summary>
    public static bool AmountsMatch(decimal a, decimal b) => JsRound(a) == JsRound(b);
}
