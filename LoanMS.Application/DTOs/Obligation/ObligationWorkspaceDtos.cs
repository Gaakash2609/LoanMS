namespace LoanMS.Application.DTOs;

// ── Obligations credit-review workspace payloads ──────────────────────────────
// One authoritative bundle the React Obligations tab renders. Every number below
// is computed server-side (ObligationService + ObligationFoirEngine) from
// persisted data; React only displays it. No business decision is made client-side.

public class ObligationWorkspaceDto
{
    public List<LoanObligationDto> Obligations { get; set; } = new();
    public ObligationSummaryDto Summary { get; set; } = new();
    public ObligationFoirResultDto Foir { get; set; } = new();
    public ObligationReconciliationDto Reconciliation { get; set; } = new();
}

public class ObligationSummaryDto
{
    public int TotalCount { get; set; }
    public int ActiveCount { get; set; }
    public int ClosedCount { get; set; }
    public int DetectedCount { get; set; }
    public int VerifiedCount { get; set; }
    public int ReviewRequiredCount { get; set; }
    public int MismatchCount { get; set; }

    /// <summary>Sum of EMI for every ACTIVE, non-rejected obligation (the live
    /// monthly burden). Closed/rejected rows are excluded.</summary>
    public decimal TotalActiveMonthlyEmi { get; set; }
    public decimal ApplicantMonthlyEmi { get; set; }
    public decimal CoApplicantMonthlyEmi { get; set; }
    public decimal TotalOutstanding { get; set; }

    /// <summary>Count of active, non-rejected obligations flagged for Balance Transfer.</summary>
    public int BalanceTransferCount { get; set; }
    public decimal BalanceTransferMonthlyEmi { get; set; }

    /// <summary>Source → count, e.g. {"Manual":2,"BankStatement":1}.</summary>
    public Dictionary<string, int> CountBySource { get; set; } = new();
}

public class ObligationFoirResultDto
{
    // ── Whether FOIR can be computed at all ─────────────────────────────────────
    public bool IncomeAvailable { get; set; }

    // ── Income basis ────────────────────────────────────────────────────────────
    public decimal DeclaredIncome { get; set; }
    public decimal? VerifiedIncome { get; set; }
    public decimal CoApplicantIncome { get; set; }
    public decimal CombinedIncome { get; set; }
    /// <summary>"verified-salary" | "declared-salary" | "self-employed-verified-abb"
    /// | "self-employed-estimated".</summary>
    public string IncomeBasis { get; set; } = "declared-salary";
    public string IncomeBasisNote { get; set; } = string.Empty;

    // ── Existing obligations ────────────────────────────────────────────────────
    /// <summary>All active, non-rejected EMIs — the CURRENT monthly burden.</summary>
    public decimal ExistingActiveEmi { get; set; }
    /// <summary>Active EMIs excluding Balance-Transfer ones — the burden RETAINED
    /// after the proposed loan (BT loans are refinanced away by the new loan).</summary>
    public decimal ExistingNonBtEmi { get; set; }
    public decimal BalanceTransferEmi { get; set; }
    public int ActiveObligationCount { get; set; }

    // ── Proposed loan ───────────────────────────────────────────────────────────
    public decimal ProposedEmi { get; set; }
    /// <summary>"loan" (loan.MonthlyEmi) | "computed" (from amount/rate/tenure) |
    /// "override" (what-if input).</summary>
    public string ProposedEmiSource { get; set; } = "loan";
    public decimal ProposedRatePct { get; set; }
    public int ProposedTenureMonths { get; set; }

    // ── FOIR / DBR ──────────────────────────────────────────────────────────────
    public decimal CurrentFoirPct { get; set; }
    public decimal PostLoanFoirPct { get; set; }
    /// <summary>ExistingNonBtEmi + ProposedEmi — the proposed EMI is added exactly
    /// once (never double-counted with the existing obligations).</summary>
    public decimal TotalObligationsAfter { get; set; }

    // ── Applicable lender / product FOIR policy ─────────────────────────────────
    public decimal? ApplicableFoirLimitPct { get; set; }
    /// <summary>"BankProductRule" | "BankMaster" | "None".</summary>
    public string FoirLimitSource { get; set; } = "None";
    public string? LenderName { get; set; }
    public string? ProductKey { get; set; }

    // ── Decision (null / factual-only when no policy is on file) ─────────────────
    public bool? PassesLenderLimit { get; set; }
    public string DecisionLabel { get; set; } = string.Empty;

    // ── Capacity / headroom ─────────────────────────────────────────────────────
    /// <summary>The FOIR% the eligible-EMI capacity is computed at: the lender limit
    /// when available, else the profile's suggested FOIR (heuristic reference).</summary>
    public decimal CapacityFoirPct { get; set; }
    public decimal EligibleEmiAtCapacity { get; set; }
    public decimal AvailableHeadroomEmi { get; set; }
    public decimal? EligibleLoanAmount { get; set; }
    public decimal SuggestedFoirPct { get; set; }
    /// <summary>True when CapacityFoirPct came from the user's what-if FOIR slider.</summary>
    public bool FoirOverrideApplied { get; set; }
    /// <summary>Where CapacityFoirPct came from: "override" | "lender" | "suggested".</summary>
    public string CapacityFoirSource { get; set; } = "suggested";

    // ── Vanilla-parity detail metrics (ROI pill, breakdown cards, DSCR) ─────────
    public int Cibil { get; set; }
    public decimal PrimaryNetIncome { get; set; }
    public decimal RequestedAmount { get; set; }
    /// <summary>EligibleLoanAmount − RequestedAmount: ≥0 headroom, &lt;0 shortfall.</summary>
    public decimal LoanDiff { get; set; }
    /// <summary>Max eligible loan at the FOIR cap ignoring existing obligations.</summary>
    public decimal MaxEligibleLoanAmount { get; set; }
    /// <summary>Extra eligible loan freed by moving BT obligations onto the new loan.</summary>
    public decimal BtBenefitLoanAmount { get; set; }
    /// <summary>CIBIL/loan-type salary multiplier cross-check.</summary>
    public int CibilMultiplier { get; set; }
    public decimal LoanByMultiplier { get; set; }
    /// <summary>Conservative eligible = min(FOIR-method loan, multiplier loan).</summary>
    public decimal ConservativeEligibleLoanAmount { get; set; }
    /// <summary>Debt-service coverage ratio (income / going EMI) formatted, or "—".</summary>
    public string Dscr { get; set; } = "—";
    public decimal NonBtOutstanding { get; set; }
    public decimal BtOutstanding { get; set; }
}

public class ObligationReconciliationDto
{
    public int MismatchCount { get; set; }
    public List<ObligationMismatchDto> Mismatches { get; set; } = new();
}

public class ObligationMismatchDto
{
    public int ObligationId { get; set; }
    public string? FinancerName { get; set; }
    /// <summary>"emi" | "financer" | "accountNumber".</summary>
    public string Field { get; set; } = string.Empty;
    public string DetectedValue { get; set; } = string.Empty;
    public string CurrentValue { get; set; } = string.Empty;
    public string Note { get; set; } = string.Empty;
}

// ── Bank-statement detection ──────────────────────────────────────────────────

public class DetectObligationsResultDto
{
    public bool PerfiosReportAvailable { get; set; }
    public int? PerfiosReportId { get; set; }
    public string? Message { get; set; }
    public List<DetectedObligationCandidateDto> Candidates { get; set; } = new();
}

public class DetectedObligationCandidateDto
{
    public string DetectionSignature { get; set; } = string.Empty;
    /// <summary>The recurring monthly debit amount — the detected EMI.</summary>
    public decimal Emi { get; set; }
    /// <summary>Best-effort lender parsed from the narration; null when the evidence
    /// does not clearly identify one (never invented).</summary>
    public string? FinancerName { get; set; }
    /// <summary>Only when the narration exposes an account/loan reference; else null.</summary>
    public string? AccountNumber { get; set; }
    /// <summary>"ACH/NACH" | "ECS" | "EMI" — the detection channel, for evidence.</summary>
    public string Channel { get; set; } = string.Empty;
    public int OccurrenceCount { get; set; }
    public DateTime FirstSeen { get; set; }
    public DateTime LastSeen { get; set; }
    public string EvidenceJson { get; set; } = "[]";
    /// <summary>True when an obligation with this signature already exists on the
    /// loan — so a re-run never creates a duplicate.</summary>
    public bool AlreadyImported { get; set; }
}

public class ImportDetectedObligationsRequestDto
{
    /// <summary>Which candidate signatures (from a detect call) to persist as
    /// ReviewRequired obligations.</summary>
    public List<string> Signatures { get; set; } = new();
    public string? ApplicantRole { get; set; }
    public string? ApplicantKey { get; set; }
}

// ── What-if FOIR + verification requests ──────────────────────────────────────

public class CalculateFoirRequestDto
{
    /// <summary>Override the proposed EMI (what-if). Null → use the loan's own EMI.</summary>
    public decimal? ProposedEmi { get; set; }
    /// <summary>What-if co-applicant monthly income added to the income basis.</summary>
    public decimal? CoApplicantIncome { get; set; }
    /// <summary>What-if FOIR% from the eligibility slider (clamped 40–80). Null → use
    /// the lender/product limit when on file, else the profile's suggested FOIR.</summary>
    public int? FoirOverride { get; set; }
    public string? ApplicantRole { get; set; }
    public string? ApplicantKey { get; set; }
}

public class VerifyObligationRequestDto
{
    /// <summary>"Verified" | "Rejected" | "ReviewRequired".</summary>
    public string Decision { get; set; } = string.Empty;
    public string? Note { get; set; }
}
