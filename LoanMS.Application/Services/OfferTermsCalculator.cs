namespace LoanMS.Application.Services;

/// <summary>
/// The authoritative offer-terms calculation (Phase 0 §6). Pure and side-effect
/// free. EMI uses the backend's single reducing-balance formula
/// (<see cref="EmiCalculator.ReducingBalance"/>, 2-dp) on the financed principal;
/// the financed principal follows legacy laAutoCalc's "bundled" rule (loan amount
/// + processing fee incl. GST when bundled + insurance when bundled).
/// </summary>
public static class OfferTermsCalculator
{
    public sealed class Input
    {
        public decimal LoanAmount { get; init; }
        public int TenureMonths { get; init; }
        public decimal OfferedRoi { get; init; }
        public decimal ProcessingFeePct { get; init; }
        public decimal GstPct { get; init; }
        public decimal InsuranceAmount { get; init; }
        public bool PfInBundled { get; init; }
        public bool InsuranceInBundled { get; init; }
        public decimal BtAmount { get; init; }
        public decimal StampDuty { get; init; }
    }

    public sealed class Result
    {
        public decimal ProcessingFeeAmount { get; init; }
        public decimal GstAmount { get; init; }
        public decimal FinancedPrincipal { get; init; }
        public decimal Emi { get; init; }
        public decimal NetDisbursement { get; init; }
    }

    /// <summary>Validation errors for raw inputs (empty = valid). No value is ever defaulted.</summary>
    public static List<string> Validate(Input i)
    {
        var e = new List<string>();
        if (i.LoanAmount <= 0) e.Add("Loan amount must be greater than 0.");
        if (i.LoanAmount > 1_000_000_000m) e.Add("Loan amount is unrealistically large.");
        if (i.TenureMonths <= 0 || i.TenureMonths > 480) e.Add("Tenure must be between 1 and 480 months.");
        if (i.OfferedRoi < 0 || i.OfferedRoi > 60) e.Add("Offered ROI must be between 0 and 60% p.a.");
        if (i.ProcessingFeePct < 0 || i.ProcessingFeePct > 20) e.Add("Processing fee must be between 0 and 20%.");
        if (i.GstPct < 0 || i.GstPct > 28) e.Add("GST must be between 0 and 28%.");
        if (i.InsuranceAmount < 0) e.Add("Insurance cannot be negative.");
        if (i.BtAmount < 0) e.Add("BT amount cannot be negative.");
        if (i.StampDuty < 0) e.Add("Stamp duty cannot be negative.");
        if (MoreThan2Dp(i.OfferedRoi) || MoreThan2Dp(i.ProcessingFeePct) || MoreThan2Dp(i.GstPct))
            e.Add("Rates allow at most 2 decimal places.");
        if (MoreThan2Dp(i.LoanAmount) || MoreThan2Dp(i.InsuranceAmount) || MoreThan2Dp(i.BtAmount) || MoreThan2Dp(i.StampDuty))
            e.Add("Amounts allow at most 2 decimal places.");
        return e;
    }

    public static Result Calculate(Input i)
    {
        var pf  = Math.Round(i.LoanAmount * i.ProcessingFeePct / 100m, 2, MidpointRounding.AwayFromZero);
        var gst = Math.Round(pf * i.GstPct / 100m, 2, MidpointRounding.AwayFromZero);
        var financed = i.LoanAmount
                     + (i.PfInBundled ? pf + gst : 0m)
                     + (i.InsuranceInBundled ? i.InsuranceAmount : 0m);
        var deductions = (i.PfInBundled ? 0m : pf + gst)
                       + (i.InsuranceInBundled ? 0m : i.InsuranceAmount)
                       + i.StampDuty + i.BtAmount;
        return new Result
        {
            ProcessingFeeAmount = pf,
            GstAmount = gst,
            FinancedPrincipal = financed,
            Emi = EmiCalculator.ReducingBalance(financed, i.OfferedRoi, i.TenureMonths),
            NetDisbursement = i.LoanAmount - deductions,
        };
    }

    private static bool MoreThan2Dp(decimal v) => v * 100m != Math.Truncate(v * 100m);
}
