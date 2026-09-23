using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class WizardSubmitDto
{
    // When set, identifies an existing Draft loan to resume/complete instead of
    // creating a brand-new Loan/Customer record. Leave null/0 for a fresh application.
    public int?    LoanId      { get; set; }
    // Which wizard step this draft was last saved on (1-based). Persisted
    // onto Loan.WizardStep so resume/list-drafts work purely from the
    // server — never from browser localStorage.
    public int?    Step        { get; set; }
    public string FullName     { get; set; } = string.Empty;
    public string Mobile       { get; set; } = string.Empty;
    public string Email        { get; set; } = string.Empty;
    public string? Pan         { get; set; }
    public string? Aadhar      { get; set; }
    public string? Dob         { get; set; }
    public string? Gender      { get; set; }
    public string? FatherName  { get; set; }
    public int?   Cibil        { get; set; }
    public string? City        { get; set; }
    public string? State       { get; set; }
    public string? Street1     { get; set; }
    // House/Flat No. (Street1) and Street & Locality (Street2) are two
    // separate wizard fields (NewApplicationPage.tsx Step4) — Street2 was
    // missing here entirely, so the frontend's `street2` was silently
    // dropped by model binding before ever reaching FindOrCreateCustomerAsync.
    public string? Street2     { get; set; }
    public string? Zip         { get; set; }
    public string? HomeType    { get; set; }
    public string? EmpType     { get; set; }
    public string? CompName    { get; set; }
    public string? CompType    { get; set; }
    public decimal Salary      { get; set; }
    /// <summary>Existing monthly EMI/debt obligations declared on the Employment step — persisted
    /// onto Customer.MonthlyObligations (Phase 5A). Defaults to 0 (no existing obligations).</summary>
    public decimal Obligations { get; set; }
    public string? Desig       { get; set; }
    public string? OfficeEmail { get; set; }
    public string  LoanType    { get; set; } = "personal_loan";
    public decimal Amount      { get; set; }
    public decimal LoanRate    { get; set; } = 12;
    public int     Tenure      { get; set; } = 24;
    public string? Purpose     { get; set; }
    public string? R1Name      { get; set; }
    public string? R1Mobile    { get; set; }
    public string? R1Relation  { get; set; }
    public string? R2Name      { get; set; }
    public string? R2Mobile    { get; set; }
    public string? R2Relation  { get; set; }
    public string? SalesPerson { get; set; }
    public string? Source      { get; set; }
    public string? Channel     { get; set; }
    public string? LenderName  { get; set; }
    public string? EfinId      { get; set; }

    // ── Phase 2A — Wizard mapping (DSA / Partner / Location) ──────────────
    // Ids only. CreatedByUserId is NEVER taken from the request body — it is
    // always derived server-side from the JWT (see BaseController.CurrentUserId).
    public int? DsaId          { get; set; }
    public int? PartnerId      { get; set; }
    public int? LocationId     { get; set; }
    // Response-only (GetDraft never reads these from the request body,
    // only ever sets them when building its response) — the resumed
    // wizard's hidden fields (w-location, w-dsa-name-val, w-partner-name-val)
    // hold NAMES, not raw ids, so a draft-resume needs the name back, not
    // just the id ApplyMapping already saves correctly.
    public string? DsaName      { get; set; }
    public string? PartnerName  { get; set; }
    public string? LocationName { get; set; }

    /// <summary>Product-specific fields (Insurance/Property/Vehicle/
    /// Education) — confirmed never captured server-side at all. Generic
    /// dictionary rather than ~28 named properties, since only one
    /// product-category's fields are ever relevant per submission; the
    /// frontend already sends these as a flat key/value object, so this
    /// binds directly without needing per-field DTO properties.</summary>
    public Dictionary<string, object>? ProductData { get; set; }

    /// <summary>Banks picked on Step 9's eligibility matcher (max 2). Reuses
    /// the existing bank-lines DTO shape rather than a new one. Persisted
    /// directly inside Submit (see SyncBankLinesAsync) instead of relying on
    /// the separate PUT /api/loans/{id}/bank-lines call the frontend also
    /// makes — that endpoint is role-gated more narrowly than who may submit
    /// a wizard application (e.g. Sales/Dsa/Partner can create an application
    /// but cannot call it directly), so their selected banks were silently
    /// dropped. This does not change any role/permission logic — it only lets
    /// the wizard persist its own data through the action it already has
    /// authority to call. Harmless if the frontend's separate call also
    /// succeeds afterward — both are whole-set replaces of the same rows.</summary>
    public List<BankLineItemDto>? SelectedBanks { get; set; }
}
