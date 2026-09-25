namespace LoanMS.Application.DTOs;

// ── Requests ─────────────────────────────────────────────────────────────────

public class OfferTermsDto
{
    public decimal LoanAmount { get; set; }
    public int TenureMonths { get; set; }
    /// <summary>Lender's base / card rate (% p.a.) — the reference for ROI deviation.</summary>
    public decimal BaseRoi { get; set; }
    public decimal OfferedRoi { get; set; }
    public decimal ProcessingFeePct { get; set; }
    public decimal GstPct { get; set; }
    public decimal InsuranceAmount { get; set; }
    public bool PfInBundled { get; set; }
    public bool InsuranceInBundled { get; set; }
    public decimal BtAmount { get; set; }
    public decimal StampDuty { get; set; }
}

public class CreateOfferRequestDto : OfferTermsDto
{
    public int BankId { get; set; }
    public DateTime? ValidUntil { get; set; }
}

public class ReviseOfferRequestDto : OfferTermsDto
{
    public int ExpectedVersion { get; set; }
    public string Reason { get; set; } = string.Empty;
    public DateTime? ValidUntil { get; set; }
}

public class OfferActionRequestDto
{
    public int? ExpectedVersion { get; set; }
    public string? Reason { get; set; }
}

public class RaiseOfferDeviationRequestDto
{
    public string DeviationType { get; set; } = string.Empty;
    public string Reason { get; set; } = string.Empty;
}

public class DecideOfferDeviationRequestDto
{
    public bool Approve { get; set; }
    public string? Comment { get; set; }
}

public class CreditApprovalRequestDto
{
    /// <summary>Approve / Reject.</summary>
    public string Decision { get; set; } = string.Empty;
    public string? Comment { get; set; }
    /// <summary>The revision the approver reviewed — must equal the offer's current revision.</summary>
    public int RevisionNo { get; set; }
}

public class CancelSanctionRequestDto
{
    public string Reason { get; set; } = string.Empty;
    /// <summary>Cancel / Revoke / Amendment.</summary>
    public string CancellationType { get; set; } = "Cancel";
}

public class CreateDisbursementRequestDto
{
    public decimal Amount { get; set; }
    public DateTime DisbursementDate { get; set; }
    public string BankAccountNumber { get; set; } = string.Empty;
    public string Ifsc { get; set; } = string.Empty;
    public string? AccountHolderName { get; set; }
    public string Utr { get; set; } = string.Empty;
    public string? LenderReference { get; set; }
    public string Mode { get; set; } = string.Empty;
}

public class ReverseDisbursementRequestDto
{
    public string Reason { get; set; } = string.Empty;
}

public class WorkflowStageRequestDto
{
    public string? Reason { get; set; }
}

public class DeviationRuleRequestDto
{
    public string Name { get; set; } = string.Empty;
    public int BankId { get; set; }
    public string? ProductKey { get; set; }
    public string? LoanType { get; set; }
    public string DeviationType { get; set; } = string.Empty;
    public string Metric { get; set; } = string.Empty;
    public decimal LimitValue { get; set; }
    public decimal? MaxApprovableDeviation { get; set; }
    public List<DeviationRuleConditionDto> Conditions { get; set; } = new();
    public string ConditionLogic { get; set; } = "AND";
    public int Priority { get; set; } = 100;
    public DateTime EffectiveFrom { get; set; }
    public DateTime? EffectiveTo { get; set; }
    public bool ApprovalRequired { get; set; } = true;
    public string? Notes { get; set; }
    /// <summary>Required when creating a new version of an existing rule.</summary>
    public string? ChangeReason { get; set; }
}

public class DeviationRuleConditionDto
{
    public string Field { get; set; } = string.Empty;
    public string Op { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
}

public class DeviationRuleSimulationRequestDto : OfferTermsDto
{
    /// <summary>Evaluate against this application's data (read-only). Optional.</summary>
    public int? LoanId { get; set; }
    public int BankId { get; set; }
    public string? ProductKey { get; set; }
    public string? LoanType { get; set; }
    public DateTime? AsOf { get; set; }
    /// <summary>Facts used when no LoanId is given (pure what-if).</summary>
    public decimal? MonthlyIncome { get; set; }
    public decimal? PostLoanFoirPct { get; set; }
    public int? BureauCibil { get; set; }
    public string? EmploymentType { get; set; }
    /// <summary>Also evaluate this draft (unsaved) rule alongside the stored ones.</summary>
    public DeviationRuleRequestDto? DraftRule { get; set; }
}

// ── Responses ────────────────────────────────────────────────────────────────

public class OfferRevisionDto : OfferTermsDto
{
    public int RevisionNo { get; set; }
    public string RateType { get; set; } = "Reducing";
    public decimal ProcessingFeeAmount { get; set; }
    public decimal GstAmount { get; set; }
    public decimal FinancedPrincipal { get; set; }
    public decimal Emi { get; set; }
    public decimal NetDisbursement { get; set; }
    public string? ChangeReason { get; set; }
    public string EvaluationOutcome { get; set; } = string.Empty;
    public string? CreatedBy { get; set; }
    public int CreatedByUserId { get; set; }
    public DateTime CreatedAt { get; set; }
    /// <summary>Base ROI minus offered ROI — internal; null when masked.</summary>
    public decimal? MarginPp { get; set; }
}

public class DeviationCheckDto
{
    public string DeviationType { get; set; } = string.Empty;
    public string Metric { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public decimal? Actual { get; set; }
    public decimal? Allowed { get; set; }
    public decimal? Difference { get; set; }
    public string Unit { get; set; } = string.Empty;
    public bool ApprovalRequired { get; set; }
    public bool ExceedsAuthority { get; set; }
    public string Message { get; set; } = string.Empty;
    public int? RuleId { get; set; }
    public string? RuleKey { get; set; }
    public int? RuleVersion { get; set; }
    public string? RuleName { get; set; }
}

public class DeviationEvaluationDto
{
    public string Outcome { get; set; } = string.Empty;
    public bool ManualReview { get; set; }
    public string? ManualReviewReason { get; set; }
    public List<DeviationCheckDto> Checks { get; set; } = new();
    public DateTime EvaluatedAt { get; set; }
    public Dictionary<string, string?> FactsUsed { get; set; } = new();
}

public class ApplicationOfferDto
{
    public int Id { get; set; }
    public int BankId { get; set; }
    public string LenderName { get; set; } = string.Empty;
    public string ProductKey { get; set; } = string.Empty;
    public string LoanType { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public bool IsActive { get; set; }
    public string DeviationStatus { get; set; } = string.Empty;
    public string ApprovalStatus { get; set; } = string.Empty;
    public int CurrentRevisionNo { get; set; }
    public int? SelectedRevisionNo { get; set; }
    public DateTime? ValidUntil { get; set; }
    public bool IsExpired { get; set; }
    public int Version { get; set; }
    public DateTime? SelectedAt { get; set; }
    public string? SelectedBy { get; set; }
    public string? StatusReason { get; set; }
    public string? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public string? UpdatedBy { get; set; }
    public OfferRevisionDto? Current { get; set; }
    public List<OfferRevisionDto> Revisions { get; set; } = new();
    public DateTime? LatestEvaluatedAt { get; set; }
    /// <summary>Null when masked for the caller (Channel Partner / Mass Channel Partner).</summary>
    public DeviationEvaluationDto? Evaluation { get; set; }
}

public class OfferDeviationDto
{
    public int Id { get; set; }
    public int OfferId { get; set; }
    public int RevisionNo { get; set; }
    public string LenderName { get; set; } = string.Empty;
    public string DeviationType { get; set; } = string.Empty;
    public string Source { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    /// <summary>Internal — null when masked.</summary>
    public string? Reason { get; set; }
    public string? RaisedBy { get; set; }
    public int RaisedByUserId { get; set; }
    public DateTime RaisedAt { get; set; }
    public string? AssignedApprover { get; set; }
    public int? AssignedApproverId { get; set; }
    /// <summary>False when the assigned approver has been deactivated — reassign the request.</summary>
    public bool AssignedApproverActive { get; set; } = true;
    public string AssignmentState { get; set; } = string.Empty;
    public string? DecidedBy { get; set; }
    public DateTime? DecidedAt { get; set; }
    /// <summary>Internal — null when masked.</summary>
    public string? DecisionComment { get; set; }
    public string? ClosedReason { get; set; }
    /// <summary>Internal — null when masked.</summary>
    public List<DeviationCheckDto>? Flags { get; set; }
}

public class CreditApprovalDto
{
    public int Id { get; set; }
    public int OfferId { get; set; }
    public int RevisionNo { get; set; }
    public string LenderName { get; set; } = string.Empty;
    public string Decision { get; set; } = string.Empty;
    /// <summary>Internal — null when masked.</summary>
    public string? Comment { get; set; }
    public string DeviationStatusAtApproval { get; set; } = string.Empty;
    public string? Approver { get; set; }
    public DateTime CreatedAt { get; set; }
    public bool IsCurrent { get; set; }
}

public class SanctionDto
{
    public int Id { get; set; }
    public string SanctionNumber { get; set; } = string.Empty;
    public int SanctionVersion { get; set; }
    public int? PreviousSanctionId { get; set; }
    public int OfferId { get; set; }
    public int RevisionNo { get; set; }
    public int CreditApprovalId { get; set; }
    public string LenderName { get; set; } = string.Empty;
    public decimal LoanAmount { get; set; }
    public int TenureMonths { get; set; }
    public decimal Roi { get; set; }
    public decimal Emi { get; set; }
    public decimal ProcessingFeePct { get; set; }
    public decimal ProcessingFeeAmount { get; set; }
    public decimal GstPct { get; set; }
    public decimal GstAmount { get; set; }
    public decimal InsuranceAmount { get; set; }
    public decimal BtAmount { get; set; }
    public decimal StampDuty { get; set; }
    public decimal FinancedPrincipal { get; set; }
    public decimal NetDisbursement { get; set; }
    public string Status { get; set; } = string.Empty;
    public string? GeneratedBy { get; set; }
    public DateTime GeneratedAt { get; set; }
    public string? CancellationType { get; set; }
    public string? CancelReason { get; set; }
    public string? CancelledBy { get; set; }
    public DateTime? CancelledAt { get; set; }
}

public class DisbursementDto
{
    public int Id { get; set; }
    public int SanctionId { get; set; }
    public string Type { get; set; } = string.Empty;
    public int? ReversalOfId { get; set; }
    public decimal Amount { get; set; }
    public DateTime DisbursementDate { get; set; }
    /// <summary>Masked to the last 4 digits for every caller.</summary>
    public string BankAccountNumber { get; set; } = string.Empty;
    public string Ifsc { get; set; } = string.Empty;
    public string? AccountHolderName { get; set; }
    public string Utr { get; set; } = string.Empty;
    public string? LenderReference { get; set; }
    public string Mode { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string? Reason { get; set; }
    public string? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class WorkflowCapabilitiesDto
{
    public bool CanManageOffers { get; set; }
    public bool CanSelectOffer { get; set; }
    public bool CanRaiseDeviation { get; set; }
    public bool CanDecideDeviation { get; set; }
    public bool CanSkipDeviation { get; set; }
    public bool CanCreditApprove { get; set; }
    public bool CanEditApprovedTerms { get; set; }
    public bool CanGenerateSanction { get; set; }
    public bool CanCancelSanction { get; set; }
    public bool CanDisburse { get; set; }
    public bool CanReverseDisbursement { get; set; }
    public bool CanReassignDeviation { get; set; }
    public bool CanUploadBureauReport { get; set; }
    public bool CanReEvaluate { get; set; }
    public bool CanMoveToOffer { get; set; }
    public bool CanBackToUnderwriting { get; set; }
    /// <summary>Internal ROI / margin / deviation reasons / approval comments are hidden from this caller.</summary>
    public bool Masked { get; set; }
}

public class EligibleLenderDto
{
    public int BankId { get; set; }
    public string BankName { get; set; } = string.Empty;
    /// <summary>Lender Configuration's default offer validity (days), if set.</summary>
    public int? OfferValidityDays { get; set; }
}

public class BureauReportSummaryDto
{
    public int Id { get; set; }
    public string BureauProvider { get; set; } = string.Empty;
    public int CreditScore { get; set; }
    public DateTime ReportDate { get; set; }
    public DateTime UploadedAt { get; set; }
    public string? UploadedBy { get; set; }
    /// <summary>Stored file name of the uploaded report (the file itself is in the loan's Documents as "Bureau Report").</summary>
    public string? FileName { get; set; }
}

public class EligibleApproverDto
{
    public int UserId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string RoleTitle { get; set; } = string.Empty;
}

public class ReassignDeviationRequestDto
{
    public int ApproverUserId { get; set; }
    public string Reason { get; set; } = string.Empty;
}

public class LoanWorkflowDto
{
    public int LoanId { get; set; }
    public string LoanNumber { get; set; } = string.Empty;
    public string LoanStatus { get; set; } = string.Empty;
    public string ProductKey { get; set; } = string.Empty;
    public int MaxActiveOffers { get; set; }
    public List<string> MoveToOfferBlockers { get; set; } = new();
    public List<ApplicationOfferDto> Offers { get; set; } = new();
    public List<OfferDeviationDto> Deviations { get; set; } = new();
    public List<CreditApprovalDto> CreditApprovals { get; set; } = new();
    public List<SanctionDto> Sanctions { get; set; } = new();
    public List<DisbursementDto> Disbursements { get; set; } = new();
    public List<EligibleLenderDto> EligibleLenders { get; set; } = new();
    /// <summary>The customer's active bureau report (the only CIBIL source the deviation rules use); null = none on file.</summary>
    public BureauReportSummaryDto? BureauReport { get; set; }
    public WorkflowCapabilitiesDto Capabilities { get; set; } = new();
    public List<string> ManualDeviationCategories { get; set; } = new();
}

public class DeviationRuleDto
{
    public int Id { get; set; }
    public string RuleKey { get; set; } = string.Empty;
    public int Version { get; set; }
    public string Name { get; set; } = string.Empty;
    public int BankId { get; set; }
    public string? BankName { get; set; }
    public string? ProductKey { get; set; }
    public string? LoanType { get; set; }
    public string DeviationType { get; set; } = string.Empty;
    public string Metric { get; set; } = string.Empty;
    public string Unit { get; set; } = string.Empty;
    public decimal LimitValue { get; set; }
    public decimal? MaxApprovableDeviation { get; set; }
    public List<DeviationRuleConditionDto> Conditions { get; set; } = new();
    public string ConditionLogic { get; set; } = "AND";
    public int Priority { get; set; }
    public DateTime EffectiveFrom { get; set; }
    public DateTime? EffectiveTo { get; set; }
    public bool IsActive { get; set; }
    public bool ApprovalRequired { get; set; }
    public string? Notes { get; set; }
    public string? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? SupersededAt { get; set; }
    public DateTime? DeactivatedAt { get; set; }
    /// <summary>Latest version of its rule key (older versions are read-only history).</summary>
    public bool IsLatest { get; set; }
}

public class OfferPipelineReportRowDto
{
    public int LoanId { get; set; }
    public string LoanNumber { get; set; } = string.Empty;
    public string ApplicantName { get; set; } = string.Empty;
    public string ApplicationStatus { get; set; } = string.Empty;
    public int OfferId { get; set; }
    public string LenderName { get; set; } = string.Empty;
    public string OfferStatus { get; set; } = string.Empty;
    public bool IsFinalLender { get; set; }
    public int RevisionNo { get; set; }
    public decimal LoanAmount { get; set; }
    public int TenureMonths { get; set; }
    /// <summary>Null when masked.</summary>
    public decimal? BaseRoi { get; set; }
    public decimal OfferedRoi { get; set; }
    public decimal Emi { get; set; }
    public decimal NetDisbursement { get; set; }
    public string DeviationStatus { get; set; } = string.Empty;
    public string? DeviationTypes { get; set; }
    public string ApprovalStatus { get; set; } = string.Empty;
    public DateTime? ApprovedAt { get; set; }
    public string? SanctionNumber { get; set; }
    public string? SanctionStatus { get; set; }
    public DateTime? SanctionedAt { get; set; }
    public decimal? SanctionAmount { get; set; }
    public decimal? DisbursedAmount { get; set; }
    public DateTime? DisbursedAt { get; set; }
    public string? DisbursementStatus { get; set; }
    public DateTime OfferCreatedAt { get; set; }
}
