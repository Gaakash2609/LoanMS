using LoanMS.Application.DTOs;
using LoanMS.Domain.Enums;

namespace LoanMS.Application.Services;

/// <summary>
/// Pure, side-effect-free port of legacy's laCheckDeviations (efin-app.js):
/// flags where a loan's terms fall outside standard underwriting policy
/// bands. Every threshold and formula is carried over verbatim from the
/// legacy source so the current product surfaces the same risk signals. Kept
/// dependency-free (no EF, no DTOs beyond the result) so it can be unit-tested
/// directly.
/// </summary>
public static class DeviationEvaluator
{
    public static List<LoanDeviationDto> Evaluate(
        LoanType loanType, decimal loanAmount, int tenureMonths, decimal roi,
        decimal emi, decimal salary, int cibil, string? employmentType)
    {
        var flags = new List<LoanDeviationDto>();
        var empType = (employmentType ?? "").ToUpperInvariant();

        // ── ROI deviation — standard band by CIBIL ───────────────────────────
        int stdRoiMin = 0, stdRoiMax = 36;
        if      (cibil >= 800) { stdRoiMin = 9;  stdRoiMax = 14; }
        else if (cibil >= 750) { stdRoiMin = 11; stdRoiMax = 16; }
        else if (cibil >= 700) { stdRoiMin = 13; stdRoiMax = 20; }
        else if (cibil >= 650) { stdRoiMin = 16; stdRoiMax = 26; }
        else if (cibil > 0)    { stdRoiMin = 20; stdRoiMax = 36; }
        if (roi > 0 && cibil > 0 && (roi < stdRoiMin || roi > stdRoiMax))
            flags.Add(new LoanDeviationDto
            {
                Type = "ROI Deviation",
                Description = $"Rate of Interest {Trim(roi)}% is outside the standard band of {stdRoiMin}%–{stdRoiMax}% for CIBIL {cibil}",
                Badge = $"{Trim(roi)}% vs {stdRoiMin}–{stdRoiMax}%"
            });

        // ── FOIR deviation — EMI as a % of net salary ────────────────────────
        if (salary > 0 && emi > 0)
        {
            var foirPct = (int)Math.Round(emi / salary * 100m, MidpointRounding.AwayFromZero);
            var maxFoir = loanType is LoanType.Home or LoanType.LAP ? 60
                        : loanType == LoanType.Business ? 55
                        : (empType is "SELFEMP" or "SELF_EMPLOYED") ? 50
                        : 50;
            if (foirPct > maxFoir)
                flags.Add(new LoanDeviationDto
                {
                    Type = "FOIR Deviation",
                    Description = $"EMI ₹{Inr(emi)} is {foirPct}% of net salary ₹{Inr(salary)}, exceeding the {maxFoir}% FOIR cap",
                    Badge = $"FOIR {foirPct}% > {maxFoir}%"
                });
        }

        // ── Loan amount vs income multiplier ─────────────────────────────────
        if (salary > 0 && loanAmount > 0)
        {
            var multiplier = (int)Math.Round(loanAmount / salary, MidpointRounding.AwayFromZero);
            var maxMult = loanType == LoanType.Home ? 72
                        : loanType == LoanType.Business ? 36
                        : 24;
            if (multiplier > maxMult)
                flags.Add(new LoanDeviationDto
                {
                    Type = "Loan Amount Deviation",
                    Description = $"Loan amount ₹{Inr(loanAmount)} is {multiplier}x monthly income (max allowed: {maxMult}x for {Label(loanType)})",
                    Badge = $"{multiplier}x income"
                });
        }

        // ── Tenure deviation ─────────────────────────────────────────────────
        var maxTenure = loanType == LoanType.Home ? 300
                      : loanType == LoanType.LAP ? 180
                      : loanType == LoanType.Business ? 84
                      : loanType == LoanType.Car ? 84
                      : 60;
        if (tenureMonths > maxTenure)
            flags.Add(new LoanDeviationDto
            {
                Type = "Tenure Deviation",
                Description = $"Tenure of {tenureMonths} months exceeds the standard maximum of {maxTenure} months for {Label(loanType)}",
                Badge = $"{tenureMonths} mo > {maxTenure} mo"
            });

        // ── CIBIL deviation ──────────────────────────────────────────────────
        const int minCibil = 650;
        if (cibil > 0 && cibil < minCibil)
            flags.Add(new LoanDeviationDto
            {
                Type = "CIBIL Deviation",
                Description = $"CIBIL score {cibil} is below the minimum threshold of {minCibil} for this loan type",
                Badge = $"CIBIL {cibil} < {minCibil}"
            });

        return flags;
    }

    private static string Inr(decimal v) => v.ToString("#,0", System.Globalization.CultureInfo.GetCultureInfo("en-IN"));
    private static string Trim(decimal v) => v == Math.Truncate(v) ? ((long)v).ToString() : v.ToString("0.##");
    private static string Label(LoanType t) => t switch
    {
        LoanType.Home => "home loan",
        LoanType.LAP => "loan against property",
        LoanType.Business => "business loan",
        LoanType.Car => "car loan",
        LoanType.Education => "education loan",
        LoanType.Overdraft => "overdraft",
        _ => "personal loan"
    };
}
