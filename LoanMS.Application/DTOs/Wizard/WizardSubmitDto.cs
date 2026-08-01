using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class WizardSubmitDto
{
    // When set, identifies an existing Draft loan to resume/complete instead of
    // creating a brand-new Loan/Customer record. Leave null/0 for a fresh application.
    public int?    LoanId      { get; set; }
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
}
