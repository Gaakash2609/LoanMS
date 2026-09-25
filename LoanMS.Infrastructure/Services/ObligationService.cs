using System.Globalization;
using System.Text.RegularExpressions;
using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Application.Obligations;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.Infrastructure.Services;

// ── Obligation Service (credit-review authority) ──────────────────────────────
// Orchestrates the Obligations tab end-to-end: CRUD with server-side validation,
// the authoritative FOIR engine (with the resolved lender/product policy),
// deterministic bank-statement detection, import, verification and reconciliation.
// Every figure comes from persisted data; the client never decides. Loan-visibility
// scope is enforced on every operation via ILoanService, exactly as the previous
// controller did — an obligation is invisible outside the caller's scope.
public sealed class ObligationService : IObligationService
{
    private readonly AppDbContext _db;
    private readonly ILoanService _loanService;
    private readonly IIncomeVerificationService _incomeVerification;
    private readonly IObligationDetectionService _detection;

    public ObligationService(
        AppDbContext db,
        ILoanService loanService,
        IIncomeVerificationService incomeVerification,
        IObligationDetectionService detection)
    {
        _db = db;
        _loanService = loanService;
        _incomeVerification = incomeVerification;
        _detection = detection;
    }

    // Reverse of WizardController._loanTypeMap (enum → canonical frontend product
    // key) so a loan's product can be matched to a BankProductRule. Car maps to the
    // canonical "new_car_loan"; a used-car rule simply falls back to the bank default.
    public static string ProductKeyFor(LoanType t) => t switch
    {
        LoanType.Personal   => "personal_loan",
        LoanType.Business   => "business_loan",
        LoanType.Home       => "home_loan",
        LoanType.Car        => "new_car_loan",
        LoanType.Education  => "education_loan",
        LoanType.LAP        => "loan_against_property",
        LoanType.Overdraft  => "over_draft",
        LoanType.Insurance  => "insurance",
        _                   => "personal_loan",
    };

    // ── Scope helpers ───────────────────────────────────────────────────────────
    private async Task<bool> InScopeAsync(int loanId, int userId, string userRole)
        => (await _loanService.GetByIdAsync(loanId, userId, userRole)).Success;

    private async Task<Loan?> LoadLoanWithCustomerAsync(int loanId)
        => await _db.Loans.Include(l => l.Customer).FirstOrDefaultAsync(l => l.Id == loanId && !l.IsDeleted);

    // ── Reads ───────────────────────────────────────────────────────────────────
    public async Task<ApiResponseDto<List<LoanObligationDto>>> GetByLoanAsync(int loanId, int userId, string userRole)
    {
        if (!await InScopeAsync(loanId, userId, userRole))
            return ApiResponseDto<List<LoanObligationDto>>.Fail("Loan application not found.");

        var entities = await _db.LoanObligations.Where(o => o.LoanApplicationId == loanId).OrderBy(o => o.Id).ToListAsync();
        return ApiResponseDto<List<LoanObligationDto>>.Ok(entities.Select(ToDto).ToList());
    }

    public async Task<ApiResponseDto<ObligationWorkspaceDto>> GetWorkspaceAsync(int loanId, CalculateFoirRequestDto? whatIf, int userId, string userRole)
    {
        if (!await InScopeAsync(loanId, userId, userRole))
            return ApiResponseDto<ObligationWorkspaceDto>.Fail("Loan application not found.");

        var loan = await LoadLoanWithCustomerAsync(loanId);
        if (loan == null) return ApiResponseDto<ObligationWorkspaceDto>.Fail("Loan application not found.");

        var entities = await _db.LoanObligations.Where(o => o.LoanApplicationId == loanId).OrderBy(o => o.Id).ToListAsync();
        var dtos = entities.Select(ToDto).ToList();

        var workspace = new ObligationWorkspaceDto
        {
            Obligations = dtos,
            Summary = BuildSummary(entities),
            Foir = await ComputeFoirAsync(loan, entities, whatIf),
            Reconciliation = BuildReconciliation(entities),
        };
        return ApiResponseDto<ObligationWorkspaceDto>.Ok(workspace);
    }

    public async Task<ApiResponseDto<ObligationFoirResultDto>> CalculateFoirAsync(int loanId, CalculateFoirRequestDto request, int userId, string userRole)
    {
        if (!await InScopeAsync(loanId, userId, userRole))
            return ApiResponseDto<ObligationFoirResultDto>.Fail("Loan application not found.");

        var loan = await LoadLoanWithCustomerAsync(loanId);
        if (loan == null) return ApiResponseDto<ObligationFoirResultDto>.Fail("Loan application not found.");

        var entities = await _db.LoanObligations.Where(o => o.LoanApplicationId == loanId).ToListAsync();
        return ApiResponseDto<ObligationFoirResultDto>.Ok(await ComputeFoirAsync(loan, entities, request));
    }

    // ── Detection ─────────────────────────────────────────────────────────────
    public async Task<ApiResponseDto<DetectObligationsResultDto>> DetectAsync(int loanId, int userId, string userRole)
    {
        if (!await InScopeAsync(loanId, userId, userRole))
            return ApiResponseDto<DetectObligationsResultDto>.Fail("Loan application not found.");

        var report = await _db.PerfiosReports
            .Where(p => p.LoanId == loanId && p.ReportDataJson != null && !p.IsDeleted)
            .OrderByDescending(p => p.Id)
            .FirstOrDefaultAsync();

        var result = new DetectObligationsResultDto();
        if (report == null)
        {
            result.PerfiosReportAvailable = false;
            result.Message = "No persisted bank statement (Perfios) found for this loan. Run a bank-statement analysis first.";
            return ApiResponseDto<DetectObligationsResultDto>.Ok(result);
        }

        result.PerfiosReportAvailable = true;
        result.PerfiosReportId = report.Id;
        var candidates = _detection.Detect(report.ReportDataJson);

        var existingSignatures = await _db.LoanObligations
            .Where(o => o.LoanApplicationId == loanId && o.DetectionSignature != null)
            .Select(o => o.DetectionSignature!)
            .ToListAsync();
        var existing = new HashSet<string>(existingSignatures);
        foreach (var c in candidates) c.AlreadyImported = existing.Contains(c.DetectionSignature);

        result.Candidates = candidates;
        if (candidates.Count == 0)
            result.Message = "No recurring EMI / mandate debits were detected in the persisted statement.";
        return ApiResponseDto<DetectObligationsResultDto>.Ok(result);
    }

    public async Task<ApiResponseDto<List<LoanObligationDto>>> ImportDetectedAsync(int loanId, ImportDetectedObligationsRequestDto request, int userId, string userRole)
    {
        if (!await InScopeAsync(loanId, userId, userRole))
            return ApiResponseDto<List<LoanObligationDto>>.Fail("Loan application not found.");
        if (request.Signatures == null || request.Signatures.Count == 0)
            return ApiResponseDto<List<LoanObligationDto>>.Fail("No detected obligations were selected to import.");

        var report = await _db.PerfiosReports
            .Where(p => p.LoanId == loanId && p.ReportDataJson != null && !p.IsDeleted)
            .OrderByDescending(p => p.Id)
            .FirstOrDefaultAsync();
        if (report == null)
            return ApiResponseDto<List<LoanObligationDto>>.Fail("No persisted bank statement is available to import from.");

        var candidates = _detection.Detect(report.ReportDataJson)
            .ToDictionary(c => c.DetectionSignature, c => c);

        var existingSignatures = new HashSet<string>(await _db.LoanObligations
            .Where(o => o.LoanApplicationId == loanId && o.DetectionSignature != null)
            .Select(o => o.DetectionSignature!)
            .ToListAsync());

        var (role, key) = ParseApplicant(request.ApplicantRole, request.ApplicantKey);
        var created = new List<LoanObligation>();
        foreach (var sig in request.Signatures.Distinct())
        {
            if (existingSignatures.Contains(sig)) continue;            // never duplicate on re-import
            if (!candidates.TryGetValue(sig, out var c)) continue;     // stale/unknown signature — skip
            var o = new LoanObligation
            {
                LoanApplicationId = loanId,
                LoanType = "other",                                     // not inferable from a bank debit
                LoanEmi = c.Emi,
                DetectedEmi = c.Emi,
                FinancerName = c.FinancerName,
                DetectedFinancerName = c.FinancerName,
                DetectedAccountNumber = c.AccountNumber,
                LoanAccountNumber = c.AccountNumber,
                Source = ObligationSource.BankStatement,
                VerificationStatus = ObligationVerificationStatus.ReviewRequired,
                ApplicantRole = role,
                ApplicantKey = key,
                SourcePerfiosReportId = report.Id,
                DetectionSignature = sig,
                DetectionEvidenceJson = c.EvidenceJson,
                CreatedByUserId = userId,
                CreatedAt = DateTime.UtcNow,
            };
            _db.LoanObligations.Add(o);
            created.Add(o);
            existingSignatures.Add(sig);
        }

        if (created.Count == 0)
            return ApiResponseDto<List<LoanObligationDto>>.Fail("Nothing to import — the selected obligations already exist or are no longer detected.");

        await _db.SaveChangesAsync();
        return ApiResponseDto<List<LoanObligationDto>>.Ok(created.Select(ToDto).ToList(),
            $"Imported {created.Count} detected obligation(s) for review.");
    }

    // ── Writes ──────────────────────────────────────────────────────────────────
    public async Task<ApiResponseDto<LoanObligationDto>> CreateAsync(CreateLoanObligationRequestDto request, int userId, string userRole)
    {
        if (!await InScopeAsync(request.LoanApplicationId, userId, userRole))
            return ApiResponseDto<LoanObligationDto>.Fail("Loan application not found.");

        var (role, key) = ParseApplicant(request.ApplicantRole, request.ApplicantKey);
        var validation = ValidateFigures(request.LoanEmi, request.SanctionAmount, request.AmountOutstanding,
            request.InterestRate, request.TenureMonths, request.StartDate, request.MaturityDate);
        if (validation != null) return ApiResponseDto<LoanObligationDto>.Fail(validation);

        var dup = await DuplicateAccountAsync(request.LoanApplicationId, role, key, request.LoanAccountNumber, null);
        if (dup) return ApiResponseDto<LoanObligationDto>.Fail("An obligation with this account number already exists for this applicant.");

        var o = new LoanObligation
        {
            LoanApplicationId = request.LoanApplicationId,
            LoanType = request.LoanType,
            SanctionAmount = request.SanctionAmount,
            FinancerName = request.FinancerName,
            LoanEmi = request.LoanEmi,
            AmountOutstanding = request.AmountOutstanding,
            LoanClosureDate = request.LoanClosureDate,
            LoanAccountNumber = request.LoanAccountNumber,
            SelectBT = request.SelectBT,
            ApplicantRole = role,
            ApplicantKey = key,
            IsClosed = request.IsClosed,
            InterestRate = request.InterestRate,
            TenureMonths = request.TenureMonths,
            StartDate = request.StartDate,
            MaturityDate = request.MaturityDate,
            Notes = request.Notes,
            Source = ObligationSource.Manual,
            VerificationStatus = ObligationVerificationStatus.Unverified,
            CreatedByUserId = userId,
            CreatedAt = DateTime.UtcNow,
        };
        _db.LoanObligations.Add(o);
        await _db.SaveChangesAsync();
        return ApiResponseDto<LoanObligationDto>.Ok(ToDto(o), "Obligation added.");
    }

    public async Task<ApiResponseDto<LoanObligationDto>> UpdateAsync(int id, UpdateLoanObligationRequestDto request, int userId, string userRole)
    {
        var o = await _db.LoanObligations.FirstOrDefaultAsync(x => x.Id == id);
        if (o == null || !await InScopeAsync(o.LoanApplicationId, userId, userRole))
            return ApiResponseDto<LoanObligationDto>.Fail("Obligation not found.");

        var (role, key) = ParseApplicant(request.ApplicantRole, request.ApplicantKey, o.ApplicantRole, o.ApplicantKey);
        var validation = ValidateFigures(request.LoanEmi, request.SanctionAmount, request.AmountOutstanding,
            request.InterestRate, request.TenureMonths, request.StartDate, request.MaturityDate);
        if (validation != null) return ApiResponseDto<LoanObligationDto>.Fail(validation);

        var dup = await DuplicateAccountAsync(o.LoanApplicationId, role, key, request.LoanAccountNumber, o.Id);
        if (dup) return ApiResponseDto<LoanObligationDto>.Fail("An obligation with this account number already exists for this applicant.");

        // Editing the figures of a DETECTED row is recorded as a manual override —
        // it never overwrites the immutable detected originals, and an edit can never
        // stay Verified (it drops back to ReviewRequired).
        var isDetected = o.Source != ObligationSource.Manual;
        var figuresChanged = o.LoanEmi != request.LoanEmi
            || !string.Equals(o.FinancerName ?? "", request.FinancerName ?? "", StringComparison.Ordinal)
            || !string.Equals(o.LoanAccountNumber ?? "", request.LoanAccountNumber ?? "", StringComparison.Ordinal)
            || o.AmountOutstanding != request.AmountOutstanding;
        if (isDetected && figuresChanged)
        {
            if (string.IsNullOrWhiteSpace(request.OverrideReason))
                return ApiResponseDto<LoanObligationDto>.Fail("Editing a detected obligation requires an override reason.");
            o.IsManualOverride = true;
            o.OverrideReason = request.OverrideReason!.Trim();
            o.OverriddenByUserId = userId;
            o.OverriddenAt = DateTime.UtcNow;
            if (o.VerificationStatus == ObligationVerificationStatus.Verified)
                o.VerificationStatus = ObligationVerificationStatus.ReviewRequired;
        }

        o.LoanType = request.LoanType;
        o.SanctionAmount = request.SanctionAmount;
        o.FinancerName = request.FinancerName;
        o.LoanEmi = request.LoanEmi;
        o.AmountOutstanding = request.AmountOutstanding;
        o.LoanClosureDate = request.LoanClosureDate;
        o.LoanAccountNumber = request.LoanAccountNumber;
        o.SelectBT = request.SelectBT;
        o.ApplicantRole = role;
        o.ApplicantKey = key;
        o.IsClosed = request.IsClosed;
        o.InterestRate = request.InterestRate;
        o.TenureMonths = request.TenureMonths;
        o.StartDate = request.StartDate;
        o.MaturityDate = request.MaturityDate;
        o.Notes = request.Notes;
        o.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return ApiResponseDto<LoanObligationDto>.Ok(ToDto(o), "Obligation updated.");
    }

    public async Task<ApiResponseDto<bool>> DeleteAsync(int id, int userId, string userRole)
    {
        var o = await _db.LoanObligations.FirstOrDefaultAsync(x => x.Id == id);
        if (o == null || !await InScopeAsync(o.LoanApplicationId, userId, userRole))
            return ApiResponseDto<bool>.Fail("Obligation not found.");

        o.IsDeleted = true;
        o.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return ApiResponseDto<bool>.Ok(true, "Obligation deleted.");
    }

    public async Task<ApiResponseDto<LoanObligationDto>> VerifyAsync(int id, VerifyObligationRequestDto request, int userId, string userRole)
    {
        var o = await _db.LoanObligations.FirstOrDefaultAsync(x => x.Id == id);
        if (o == null || !await InScopeAsync(o.LoanApplicationId, userId, userRole))
            return ApiResponseDto<LoanObligationDto>.Fail("Obligation not found.");

        if (!Enum.TryParse<ObligationVerificationStatus>(request.Decision, ignoreCase: true, out var decision)
            || decision == ObligationVerificationStatus.Unverified)
            return ApiResponseDto<LoanObligationDto>.Fail("Decision must be Verified, Rejected, or ReviewRequired.");
        if (decision == ObligationVerificationStatus.Rejected && string.IsNullOrWhiteSpace(request.Note))
            return ApiResponseDto<LoanObligationDto>.Fail("A reason is required when rejecting an obligation.");

        o.VerificationStatus = decision;
        o.VerifiedByUserId = userId;
        o.VerifiedAt = DateTime.UtcNow;
        o.VerificationNote = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note!.Trim();
        o.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return ApiResponseDto<LoanObligationDto>.Ok(ToDto(o),
            $"Obligation marked {decision}.");
    }

    // ── FOIR assembly ─────────────────────────────────────────────────────────
    private async Task<ObligationFoirResultDto> ComputeFoirAsync(Loan loan, List<LoanObligation> all, CalculateFoirRequestDto? whatIf)
    {
        var (role, key) = ParseApplicant(whatIf?.ApplicantRole, whatIf?.ApplicantKey);

        // Applicant isolation: only THIS applicant's active, non-rejected obligations
        // feed the FOIR — a co-applicant's EMIs never leak into the applicant's ratio.
        var active = all.Where(o =>
                o.ApplicantRole == role
                && (key == null || o.ApplicantKey == key)
                && !o.IsClosed
                && o.VerificationStatus != ObligationVerificationStatus.Rejected)
            .Select(o => new ObligationFoirEngine.ObligationEmi { LoanEmi = o.LoanEmi, SelectBT = o.SelectBT, AmountOutstanding = o.AmountOutstanding })
            .ToList();

        var customer = loan.Customer;
        var gross = customer?.MonthlyIncome ?? 0m;
        var productKey = ProductKeyFor(loan.LoanType);

        // Trusted incomes (authoritative, from persisted verification / statement).
        decimal? trustedSalaried = null;
        decimal? selfEmpAbb = null;
        if (ObligationFoirEngine.IsSelfEmployed(customer?.EmploymentType))
            selfEmpAbb = await ResolveSelfEmployedAbbAsync(loan.Id);
        else
            trustedSalaried = await _incomeVerification.GetTrustedVerifiedIncomeAsync(loan.Id, role, key);

        // Proposed EMI: explicit what-if → the loan's own EMI → computed from terms.
        var (proposedEmi, proposedSource) = ResolveProposedEmi(loan, whatIf, customer?.CibilScore);

        var (limit, limitSource, lenderName) = await ResolveFoirPolicyAsync(loan, productKey);

        return ObligationFoirEngine.Compute(new ObligationFoirEngine.Input
        {
            GrossIncome = gross,
            EmploymentType = customer?.EmploymentType,
            LoanType = productKey,
            Cibil = customer?.CibilScore,
            TenureMonths = loan.TenureMonths,
            InterestRate = loan.InterestRate,
            RequestedAmount = loan.ApprovedAmount ?? loan.RequestedAmount,
            Obligations = active,
            CoApplicantIncome = Math.Max(0, whatIf?.CoApplicantIncome ?? 0m),
            VerifiedNetIncome = selfEmpAbb,
            TrustedSalariedIncome = trustedSalaried,
            ProposedEmi = proposedEmi,
            ProposedEmiSource = proposedSource,
            FoirOverride = whatIf?.FoirOverride,
            ApplicableFoirLimitPct = limit,
            FoirLimitSource = limitSource,
            LenderName = lenderName,
            ProductKey = productKey,
        });
    }

    private (decimal emi, string source) ResolveProposedEmi(Loan loan, CalculateFoirRequestDto? whatIf, int? cibil)
    {
        if (whatIf?.ProposedEmi is decimal p && p > 0) return (p, "override");
        if (loan.MonthlyEmi is decimal m && m > 0) return (m, "loan");
        var principal = loan.ApprovedAmount ?? loan.RequestedAmount;
        var rate = loan.InterestRate is >= 6 and <= 36
            ? loan.InterestRate
            : ObligationFoirEngine.SuggestedRoiFor(ProductKeyFor(loan.LoanType), cibil ?? 700);
        var tenure = loan.TenureMonths > 0 ? loan.TenureMonths : 36;
        return (ObligationFoirEngine.CalculateEmi(principal, rate, tenure), "computed");
    }

    // Self-employed net income = latest valid Perfios ABB (mirrors the frontend
    // FoirEligibilityPanel). AverageBankBalance is stored as a formatted string, so
    // strip everything but digits/decimal before parsing; unparseable → null.
    private async Task<decimal?> ResolveSelfEmployedAbbAsync(int loanId)
    {
        var report = await _db.PerfiosReports
            .Where(p => p.LoanId == loanId && p.IsValid && p.AverageBankBalance != null && !p.IsDeleted)
            .OrderByDescending(p => p.Id)
            .FirstOrDefaultAsync();
        if (report?.AverageBankBalance == null) return null;
        var cleaned = Regex.Replace(report.AverageBankBalance, @"[^0-9.]", "");
        return decimal.TryParse(cleaned, NumberStyles.Any, CultureInfo.InvariantCulture, out var v) && v > 0 ? v : null;
    }

    // Resolve the applicable FOIR policy: BankProductRule.FoirLimit for the loan's
    // lender+product, else that bank's BankMaster.FoirLimit, else none (factual FOIR
    // only). The lender is the loan's Analytic Bank, else its first selected lender.
    private async Task<(decimal? limit, string source, string? lenderName)> ResolveFoirPolicyAsync(Loan loan, string productKey)
    {
        var lenderName = !string.IsNullOrWhiteSpace(loan.AnalyticBank)
            ? loan.AnalyticBank!.Trim()
            : loan.SelectedLenderNames?.Split(',').Select(s => s.Trim()).FirstOrDefault(s => !string.IsNullOrWhiteSpace(s));
        if (string.IsNullOrWhiteSpace(lenderName)) return (null, "None", null);

        var lower = lenderName.ToLowerInvariant();
        var bank = await _db.Set<BankMaster>()
            .Include(b => b.ProductRules)
            .Where(b => !b.IsDeleted && b.BankName.ToLower() == lower)
            .FirstOrDefaultAsync();
        if (bank == null) return (null, "None", lenderName);

        var rule = bank.ProductRules.FirstOrDefault(r => !r.IsDeleted && r.ProductKey == productKey);
        if (rule?.FoirLimit is int pf && pf > 0) return (pf, "BankProductRule", bank.BankName);
        if (bank.FoirLimit > 0) return (bank.FoirLimit, "BankMaster", bank.BankName);
        return (null, "None", bank.BankName);
    }

    // ── Summary + reconciliation ───────────────────────────────────────────────
    private static ObligationSummaryDto BuildSummary(List<LoanObligation> all)
    {
        bool Counts(LoanObligation o) => !o.IsClosed && o.VerificationStatus != ObligationVerificationStatus.Rejected;
        var active = all.Where(Counts).ToList();
        var s = new ObligationSummaryDto
        {
            TotalCount = all.Count,
            ActiveCount = active.Count,
            ClosedCount = all.Count(o => o.IsClosed),
            DetectedCount = all.Count(o => o.Source == ObligationSource.BankStatement),
            VerifiedCount = all.Count(o => o.VerificationStatus == ObligationVerificationStatus.Verified),
            ReviewRequiredCount = all.Count(o => o.VerificationStatus == ObligationVerificationStatus.ReviewRequired),
            TotalActiveMonthlyEmi = active.Sum(o => o.LoanEmi),
            ApplicantMonthlyEmi = active.Where(o => o.ApplicantRole == ApplicantRole.Applicant).Sum(o => o.LoanEmi),
            CoApplicantMonthlyEmi = active.Where(o => o.ApplicantRole == ApplicantRole.CoApplicant).Sum(o => o.LoanEmi),
            TotalOutstanding = active.Sum(o => o.AmountOutstanding),
            BalanceTransferCount = active.Count(o => o.SelectBT),
            BalanceTransferMonthlyEmi = active.Where(o => o.SelectBT).Sum(o => o.LoanEmi),
            MismatchCount = all.Count(HasMismatch),
        };
        foreach (var g in all.GroupBy(o => o.Source.ToString()))
            s.CountBySource[g.Key] = g.Count();
        return s;
    }

    private static ObligationReconciliationDto BuildReconciliation(List<LoanObligation> all)
    {
        var recon = new ObligationReconciliationDto();
        foreach (var o in all.Where(HasMismatch))
        {
            if (o.DetectedEmi is decimal de && Math.Abs(de - o.LoanEmi) > EmiTolerance(de))
                recon.Mismatches.Add(new ObligationMismatchDto
                {
                    ObligationId = o.Id, FinancerName = o.FinancerName, Field = "emi",
                    DetectedValue = de.ToString("0.##", CultureInfo.InvariantCulture),
                    CurrentValue = o.LoanEmi.ToString("0.##", CultureInfo.InvariantCulture),
                    Note = "Detected EMI differs from the current value.",
                });
            if (!string.IsNullOrWhiteSpace(o.DetectedFinancerName) &&
                !string.Equals(o.DetectedFinancerName, o.FinancerName ?? "", StringComparison.OrdinalIgnoreCase))
                recon.Mismatches.Add(new ObligationMismatchDto
                {
                    ObligationId = o.Id, FinancerName = o.FinancerName, Field = "financer",
                    DetectedValue = o.DetectedFinancerName!, CurrentValue = o.FinancerName ?? "—",
                    Note = "Detected lender differs from the current value.",
                });
            if (!string.IsNullOrWhiteSpace(o.DetectedAccountNumber) &&
                !string.Equals(o.DetectedAccountNumber, o.LoanAccountNumber ?? "", StringComparison.OrdinalIgnoreCase))
                recon.Mismatches.Add(new ObligationMismatchDto
                {
                    ObligationId = o.Id, FinancerName = o.FinancerName, Field = "accountNumber",
                    DetectedValue = o.DetectedAccountNumber!, CurrentValue = o.LoanAccountNumber ?? "—",
                    Note = "Detected account number differs from the current value.",
                });
        }
        recon.MismatchCount = recon.Mismatches.Count;
        return recon;
    }

    private static decimal EmiTolerance(decimal detected) => Math.Max(1m, Math.Round(detected * 0.02m, 2));

    private static bool HasMismatch(LoanObligation o)
    {
        if (o.DetectedEmi is decimal de && Math.Abs(de - o.LoanEmi) > EmiTolerance(de)) return true;
        if (!string.IsNullOrWhiteSpace(o.DetectedFinancerName) &&
            !string.Equals(o.DetectedFinancerName, o.FinancerName ?? "", StringComparison.OrdinalIgnoreCase)) return true;
        if (!string.IsNullOrWhiteSpace(o.DetectedAccountNumber) &&
            !string.Equals(o.DetectedAccountNumber, o.LoanAccountNumber ?? "", StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    // ── Validation + helpers ────────────────────────────────────────────────────
    private static string? ValidateFigures(decimal emi, decimal sanction, decimal outstanding,
        decimal? rate, int? tenure, DateTime? start, DateTime? maturity)
    {
        if (emi < 0) return "EMI cannot be negative.";
        if (sanction < 0) return "Sanction amount cannot be negative.";
        if (outstanding < 0) return "Outstanding amount cannot be negative.";
        if (rate is < 0 or > 100) return "Interest rate must be between 0 and 100.";
        if (tenure is < 0) return "Tenure cannot be negative.";
        if (start is not null && maturity is not null && maturity < start)
            return "Maturity date cannot be before the start date.";
        return null;
    }

    private async Task<bool> DuplicateAccountAsync(int loanId, ApplicantRole role, string? key, string? accountNumber, int? excludeId)
    {
        if (string.IsNullOrWhiteSpace(accountNumber)) return false;
        var acc = accountNumber.Trim();
        return await _db.LoanObligations.AnyAsync(o =>
            o.LoanApplicationId == loanId
            && o.ApplicantRole == role
            && o.ApplicantKey == key
            && o.LoanAccountNumber != null
            && o.LoanAccountNumber == acc
            && (excludeId == null || o.Id != excludeId));
    }

    private static (ApplicantRole role, string? key) ParseApplicant(string? role, string? key,
        ApplicantRole fallbackRole = ApplicantRole.Applicant, string? fallbackKey = null)
    {
        var r = Enum.TryParse<ApplicantRole>(role, ignoreCase: true, out var parsed) ? parsed : fallbackRole;
        var k = key ?? fallbackKey;
        return (r, string.IsNullOrWhiteSpace(k) ? null : k.Trim());
    }

    private static LoanObligationDto ToDto(LoanObligation o) => new()
    {
        Id = o.Id,
        LoanApplicationId = o.LoanApplicationId,
        LoanType = o.LoanType,
        SanctionAmount = o.SanctionAmount,
        FinancerName = o.FinancerName,
        LoanEmi = o.LoanEmi,
        AmountOutstanding = o.AmountOutstanding,
        LoanClosureDate = o.LoanClosureDate,
        LoanAccountNumber = o.LoanAccountNumber,
        SelectBT = o.SelectBT,
        ApplicantRole = o.ApplicantRole.ToString(),
        ApplicantKey = o.ApplicantKey,
        Source = o.Source.ToString(),
        VerificationStatus = o.VerificationStatus.ToString(),
        IsClosed = o.IsClosed,
        InterestRate = o.InterestRate,
        TenureMonths = o.TenureMonths,
        StartDate = o.StartDate,
        MaturityDate = o.MaturityDate,
        Notes = o.Notes,
        DetectedEmi = o.DetectedEmi,
        DetectedFinancerName = o.DetectedFinancerName,
        DetectedAccountNumber = o.DetectedAccountNumber,
        SourcePerfiosReportId = o.SourcePerfiosReportId,
        DetectionEvidenceJson = o.DetectionEvidenceJson,
        IsManualOverride = o.IsManualOverride,
        OverrideReason = o.OverrideReason,
        VerifiedByUserId = o.VerifiedByUserId,
        VerifiedAt = o.VerifiedAt,
        VerificationNote = o.VerificationNote,
        CountsTowardFoir = !o.IsClosed && o.VerificationStatus != ObligationVerificationStatus.Rejected,
        HasReconciliationMismatch = HasMismatch(o),
        CreatedAt = o.CreatedAt,
        UpdatedAt = o.UpdatedAt,
    };
}
