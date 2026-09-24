namespace LoanMS.Application.Services;

/// <summary>
/// The backend's single reducing-balance EMI formula, rounded to 2 decimals
/// (a 0% rate is straight-line principal / months). LoansController,
/// WizardController, LoanService and ObligationFoirEngine each used to carry
/// their own copy of exactly this expression. There is deliberately no guard on
/// <paramref name="months"/>: callers keep their own validation, and months == 0
/// still throws DivideByZeroException exactly as every copy did.
/// </summary>
public static class EmiCalculator
{
    public static decimal ReducingBalance(decimal principal, decimal ratePercent, int months)
    {
        if (ratePercent == 0) return Math.Round(principal / months, 2);
        var r   = ratePercent / 12 / 100;
        var pow = (decimal)Math.Pow((double)(1 + r), months);
        return Math.Round(principal * r * pow / (pow - 1), 2);
    }
}
