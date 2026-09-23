using FluentAssertions;
using LoanMS.Application.Obligations;
using Xunit;

namespace LoanMS.Tests.Services;

// ── Obligation FOIR engine tests ──────────────────────────────────────────────
// Locks the authoritative FOIR maths: proposed EMI counted exactly once (no
// double-count), BT loans dropped from the post-loan burden, the lender/product
// FOIR limit driving the pass/fail decision, and NO invented decision when no
// policy is on file.
public class ObligationFoirEngineTests
{
    private static ObligationFoirEngine.Input Base() => new()
    {
        GrossIncome = 100000m,
        EmploymentType = "SALARIED",
        LoanType = "personal_loan",
        Cibil = 750,
        TenureMonths = 48,
        InterestRate = 12m,
        RequestedAmount = 500000m,
        Obligations = new(),
        ProposedEmi = 10000m,
        ProposedEmiSource = "loan",
    };

    [Fact]
    public void ProposedEmi_IsCounted_ExactlyOnce()
    {
        var i = Base();
        i.Obligations.Add(new ObligationFoirEngine.ObligationEmi { LoanEmi = 15000m, SelectBT = false });
        i.ProposedEmi = 10000m;

        var r = ObligationFoirEngine.Compute(i);

        // Current burden = existing only (15000/100000 = 15%).
        r.CurrentFoirPct.Should().Be(15.0m);
        // Post-loan burden = existing 15000 + proposed 10000 = 25000 (counted once).
        r.TotalObligationsAfter.Should().Be(25000m);
        r.PostLoanFoirPct.Should().Be(25.0m);
    }

    [Fact]
    public void BalanceTransfer_Emis_AreDropped_FromPostLoanBurden()
    {
        var i = Base();
        i.Obligations.Add(new ObligationFoirEngine.ObligationEmi { LoanEmi = 8000m, SelectBT = true });  // refinanced away
        i.Obligations.Add(new ObligationFoirEngine.ObligationEmi { LoanEmi = 5000m, SelectBT = false }); // retained
        i.ProposedEmi = 12000m;

        var r = ObligationFoirEngine.Compute(i);

        r.ExistingActiveEmi.Should().Be(13000m);   // current = both
        r.ExistingNonBtEmi.Should().Be(5000m);      // retained after loan
        r.BalanceTransferEmi.Should().Be(8000m);
        // Post-loan = retained 5000 + proposed 12000 = 17000 (the 8000 BT is gone).
        r.TotalObligationsAfter.Should().Be(17000m);
    }

    [Fact]
    public void LenderLimit_Drives_PassFail_Decision()
    {
        var i = Base();
        i.Obligations.Add(new ObligationFoirEngine.ObligationEmi { LoanEmi = 20000m, SelectBT = false });
        i.ProposedEmi = 25000m;                      // post-loan = 45000/100000 = 45%
        i.ApplicableFoirLimitPct = 40m;
        i.FoirLimitSource = "BankProductRule";

        var r = ObligationFoirEngine.Compute(i);

        r.PostLoanFoirPct.Should().Be(45.0m);
        r.PassesLenderLimit.Should().BeFalse();      // 45% > 40% limit
        r.DecisionLabel.Should().Contain("Exceeds");

        i.ApplicableFoirLimitPct = 50m;              // now within limit
        var r2 = ObligationFoirEngine.Compute(i);
        r2.PassesLenderLimit.Should().BeTrue();
    }

    [Fact]
    public void NoPolicy_MakesNoDecision_ButReportsFactualFoir()
    {
        var i = Base();
        i.Obligations.Add(new ObligationFoirEngine.ObligationEmi { LoanEmi = 30000m, SelectBT = false });
        i.ApplicableFoirLimitPct = null;             // no lender/product policy on file
        i.FoirLimitSource = "None";

        var r = ObligationFoirEngine.Compute(i);

        r.PassesLenderLimit.Should().BeNull();       // never invents a pass/fail
        r.CurrentFoirPct.Should().BeGreaterThan(0);  // but still reports factual FOIR
        r.DecisionLabel.Should().Contain("No lender/product FOIR policy");
    }

    [Fact]
    public void FoirOverride_DrivesCapacity_AndIsFlagged()
    {
        var i = Base();
        i.GrossIncome = 100000m;
        i.ApplicableFoirLimitPct = 50m;   // lender policy on file
        i.FoirOverride = 70;              // user slides FOIR to 70%

        var r = ObligationFoirEngine.Compute(i);

        r.FoirOverrideApplied.Should().BeTrue();
        r.CapacityFoirSource.Should().Be("override");
        r.CapacityFoirPct.Should().Be(70m);                 // override wins over lender limit
        r.EligibleEmiAtCapacity.Should().Be(70000m);        // 100000 × 70%
        // The lender pass/fail decision stays independent of the slider.
        r.ApplicableFoirLimitPct.Should().Be(50m);
    }

    [Fact]
    public void FoirOverride_IsClampedTo40_80()
    {
        var i = Base(); i.FoirOverride = 999;
        ObligationFoirEngine.Compute(i).CapacityFoirPct.Should().Be(80m);
        i.FoirOverride = 5;
        ObligationFoirEngine.Compute(i).CapacityFoirPct.Should().Be(40m);
    }

    [Fact]
    public void VanillaMetrics_ArePopulated()
    {
        var i = Base();
        i.Obligations.Add(new ObligationFoirEngine.ObligationEmi { LoanEmi = 20000m, SelectBT = false, AmountOutstanding = 300000m });
        i.Obligations.Add(new ObligationFoirEngine.ObligationEmi { LoanEmi = 8000m, SelectBT = true, AmountOutstanding = 100000m });

        var r = ObligationFoirEngine.Compute(i);

        r.Cibil.Should().Be(750);
        r.PrimaryNetIncome.Should().Be(100000m);
        r.MaxEligibleLoanAmount.Should().BeGreaterThan(0);
        r.BtBenefitLoanAmount.Should().BeGreaterThan(0);       // BT EMI present → benefit > 0
        r.CibilMultiplier.Should().BeGreaterThan(0);
        r.LoanByMultiplier.Should().BeGreaterThan(0);
        r.Dscr.Should().NotBe("—");                            // going EMI > 0
        r.NonBtOutstanding.Should().Be(300000m);
        r.BtOutstanding.Should().Be(100000m);
    }

    [Fact]
    public void NoIncome_IsReported_NotCrashed()
    {
        var i = Base();
        i.GrossIncome = 0m;

        var r = ObligationFoirEngine.Compute(i);

        r.IncomeAvailable.Should().BeFalse();
        r.CurrentFoirPct.Should().Be(0m);
    }

    [Fact]
    public void SelfEmployed_UsesVerifiedAbb_WhenPresent_ElseEstimate()
    {
        var withAbb = Base();
        withAbb.EmploymentType = "SELF EMPLOYED";
        withAbb.GrossIncome = 100000m;
        withAbb.VerifiedNetIncome = 80000m;
        var r1 = ObligationFoirEngine.Compute(withAbb);
        r1.IncomeBasis.Should().Be("self-employed-verified-abb");
        r1.CombinedIncome.Should().Be(80000m);

        var noAbb = Base();
        noAbb.EmploymentType = "SELF EMPLOYED";
        noAbb.GrossIncome = 100000m;
        noAbb.VerifiedNetIncome = null;
        var r2 = ObligationFoirEngine.Compute(noAbb);
        r2.IncomeBasis.Should().Be("self-employed-estimated");
        r2.CombinedIncome.Should().Be(70000m); // 70% of gross
    }

    [Fact]
    public void Salaried_UsesTrustedVerifiedIncome_OverDeclared()
    {
        var i = Base();
        i.GrossIncome = 60000m;
        i.TrustedSalariedIncome = 90000m;

        var r = ObligationFoirEngine.Compute(i);

        r.IncomeBasis.Should().Be("verified-salary");
        r.CombinedIncome.Should().Be(90000m);
        r.VerifiedIncome.Should().Be(90000m);
    }

    [Fact]
    public void CoApplicantIncome_AddsToBasis_ButObligationsStayCallerFiltered()
    {
        var i = Base();
        i.GrossIncome = 100000m;
        i.CoApplicantIncome = 50000m;

        var r = ObligationFoirEngine.Compute(i);

        r.CombinedIncome.Should().Be(150000m);
    }
}
