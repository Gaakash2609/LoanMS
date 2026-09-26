using System.Text.Json;
using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Application.Services;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using LoanMS.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using S = LoanMS.Domain.Entities.OfferWorkflowStatuses;

namespace LoanMS.API.Services;

/// <summary>The caller of a workflow action (from the JWT).</summary>
public sealed record WorkflowCaller(int UserId, string Role, string? Name = null);

/// <summary>A bureau (CIBIL) report file plus the score it states.</summary>
public sealed record BureauReportUpload(Stream Content, string FileName, string ContentType, long Length,
    int CreditScore, string BureauProvider, DateTime ReportDate);

public interface IOfferWorkflowService : IOfferWorkflowHooks
{
    Task<ApiResponseDto<LoanWorkflowDto>> GetAsync(int loanId, WorkflowCaller c);
    Task<ApiResponseDto<LoanWorkflowDto>> MoveToOfferAsync(int loanId, string? comment, WorkflowCaller c);
    Task<ApiResponseDto<LoanWorkflowDto>> BackToUnderwritingAsync(int loanId, string? reason, WorkflowCaller c);
    Task<ApiResponseDto<LoanWorkflowDto>> CreateOfferAsync(int loanId, CreateOfferRequestDto req, WorkflowCaller c);
    Task<ApiResponseDto<LoanWorkflowDto>> ReviseOfferAsync(int loanId, int offerId, ReviseOfferRequestDto req, WorkflowCaller c);
    Task<ApiResponseDto<LoanWorkflowDto>> WithdrawOfferAsync(int loanId, int offerId, OfferActionRequestDto req, WorkflowCaller c);
    Task<ApiResponseDto<LoanWorkflowDto>> SelectOfferAsync(int loanId, int offerId, OfferActionRequestDto req, WorkflowCaller c);
    Task<ApiResponseDto<LoanWorkflowDto>> UnselectOfferAsync(int loanId, int offerId, OfferActionRequestDto req, WorkflowCaller c);
    Task<ApiResponseDto<LoanWorkflowDto>> RaiseDeviationAsync(int loanId, int offerId, RaiseOfferDeviationRequestDto req, string? idempotencyKey, WorkflowCaller c);
    Task<ApiResponseDto<LoanWorkflowDto>> DecideDeviationAsync(int loanId, int deviationId, DecideOfferDeviationRequestDto req, string? idempotencyKey, WorkflowCaller c);
    Task<ApiResponseDto<LoanWorkflowDto>> SkipDeviationAsync(int loanId, int offerId, OfferActionRequestDto req, WorkflowCaller c);
    Task<ApiResponseDto<LoanWorkflowDto>> CreditApprovalAsync(int loanId, int offerId, CreditApprovalRequestDto req, string? idempotencyKey, WorkflowCaller c);
    Task<ApiResponseDto<LoanWorkflowDto>> GenerateSanctionAsync(int loanId, string? idempotencyKey, WorkflowCaller c);
    Task<ApiResponseDto<LoanWorkflowDto>> CancelSanctionAsync(int loanId, int sanctionId, CancelSanctionRequestDto req, WorkflowCaller c);
    Task<ApiResponseDto<LoanWorkflowDto>> CreateDisbursementAsync(int loanId, CreateDisbursementRequestDto req, string? idempotencyKey, WorkflowCaller c);
    Task<ApiResponseDto<LoanWorkflowDto>> ReverseDisbursementAsync(int loanId, int disbursementId, ReverseDisbursementRequestDto req, WorkflowCaller c);

    Task<ApiResponseDto<LoanWorkflowDto>> ReEvaluateAsync(int loanId, WorkflowCaller c);
    Task<ApiResponseDto<LoanWorkflowDto>> UploadBureauReportAsync(int loanId, BureauReportUpload upload, WorkflowCaller c);
    Task<ApiResponseDto<List<EligibleApproverDto>>> EligibleApproversAsync(int loanId, int deviationId, WorkflowCaller c);
    Task<ApiResponseDto<LoanWorkflowDto>> ReassignDeviationAsync(int loanId, int deviationId, ReassignDeviationRequestDto req, WorkflowCaller c);

    Task<ApiResponseDto<List<DeviationRuleDto>>> ListRulesAsync(int? bankId, bool includeHistory);
    Task<ApiResponseDto<DeviationRuleDto>> CreateRuleAsync(DeviationRuleRequestDto req, WorkflowCaller c);
    Task<ApiResponseDto<DeviationRuleDto>> NewRuleVersionAsync(int ruleId, DeviationRuleRequestDto req, WorkflowCaller c);
    Task<ApiResponseDto<DeviationRuleDto>> SetRuleActiveAsync(int ruleId, bool active, string? reason, WorkflowCaller c);
    Task<ApiResponseDto<DeviationEvaluationDto>> SimulateAsync(DeviationRuleSimulationRequestDto req, WorkflowCaller c);

    Task<ApiResponseDto<List<OfferPipelineReportRowDto>>> PipelineReportAsync(DateTime? from, DateTime? to, int? bankId, string? offerStatus, WorkflowCaller c);
}

/// <summary>
/// Offer → Deviation → Credit Approval → Sanction → Disbursement (Phase 0 design
/// in LOANMS_OFFER_TO_DISBURSEMENT_PHASE0_2026-09-25.md). The backend is the only
/// authority: every action re-checks visibility scope (404), role (403), the
/// application stage and the record state (409) — hidden buttons are not security.
/// Every mutation runs in a transaction with the loan row locked (PostgreSQL
/// FOR UPDATE), writes a LoanStatusHistory row for stage changes, a Timeline
/// (TrackingEntries) row and a before/after AuditLogs row.
/// </summary>
public sealed class OfferWorkflowService : IOfferWorkflowService
{
    public const int MaxActiveOffers = 3;

    /// <summary>Chief Administrator, Zonal Manager, Credit Evaluation Manager, Credit Evaluation Officer.</summary>
    public static readonly string[] AuthorityRoles = { "Admin", "LocationHead", "OperationManager", "LoginTeam" };
    /// <summary>Pipeline roles that collect and key lender offers (same set as the status routes).</summary>
    public static readonly string[] OfferMakerRoles = { "Admin", "Manager", "TeamLeader", "LoginTeam", "OperationManager", "LocationHead" };
    /// <summary>Product &amp; Risk Officer (and Chief Administrator) manage deviation rules.</summary>
    public static readonly string[] RuleManagerRoles = { "Admin", "ProductTeam" };
    /// <summary>Channel Partner / Mass Channel Partner — internal lender/deviation/approval data is masked.</summary>
    public static readonly string[] MaskedRoles = { "Partner", "Dsa" };

    public static readonly string[] DisbursementModes = { "NEFT", "RTGS", "IMPS", "Cheque", "Other" };

    /// <summary>Timeline (TrackingEntries) names written only by this service. They are
    /// part of the audit trail: TrackingController refuses to create, edit or delete them.</summary>
    public static readonly HashSet<string> SystemTimelineNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "EFIN-Final Offer Check", "EFIN-Back to Underwriting", "EFIN-Offer Created", "EFIN-Offer Revised",
        "EFIN-Offer Withdrawn", "EFIN-Offer Selected", "EFIN-Offer Unselected", "EFIN-Offer Expired",
        "EFIN-Deviation", "EFIN-Approved Deviation", "EFIN-Deviation Rejected", "EFIN- SKIP Deviation",
        "EFIN-Approved", "EFIN-Credit Rejected", "EFIN-Sanction Generated", "EFIN-Sanction Cancelled",
        "EFIN-Sanction Revoked", "EFIN-Sanction Amendment", "EFIN-Disbursed", "EFIN-Disbursement Reversed",
        "EFIN-Deviation Re-evaluated", "EFIN-Deviation Reassigned", "EFIN-Bureau Report Uploaded",
        "EFIN-Deviation Closed",
    };

    public static readonly string[] BureauProviders = { "CIBIL", "Experian", "Equifax", "CRIF High Mark" };
    public static readonly string[] CancellationTypes = { "Cancel", "Revoke", "Amendment" };

    private readonly AppDbContext _db;
    private readonly IRolePermissionService _perm;
    // ILoanService / IObligationService are resolved lazily: LoanService takes
    // this class as its IOfferWorkflowHooks and ObligationService takes
    // ILoanService, so constructor injection would be a DI cycle.
    private readonly IServiceProvider _sp;
    // Set by an action that must persist a state correction even though it
    // refuses the request (e.g. credit approval discovering a new deviation).
    private bool _commitOnError;

    public OfferWorkflowService(AppDbContext db, IRolePermissionService perm, IServiceProvider sp)
    {
        _db = db;
        _perm = perm;
        _sp = sp;
    }

    private static bool Is(string role, IEnumerable<string> set) => set.Contains(role, StringComparer.OrdinalIgnoreCase);
    private static bool IsAdmin(string role) => string.Equals(role, "Admin", StringComparison.OrdinalIgnoreCase);
    private static DateTime Now => DateTime.UtcNow;

    private static ApiResponseDto<LoanWorkflowDto> Fail(string msg, string code) => ApiResponseDto<LoanWorkflowDto>.Fail(msg, code);
    private static ApiResponseDto<LoanWorkflowDto> NotFound() => Fail("Loan not found.", ApiErrorCodes.NotFound);
    private static ApiResponseDto<LoanWorkflowDto> Forbidden(string what) => Fail($"You do not have permission to {what}.", ApiErrorCodes.Forbidden);
    private static ApiResponseDto<LoanWorkflowDto> Stage(string msg) => Fail(msg, ApiErrorCodes.WorkflowStage);
    private static ApiResponseDto<LoanWorkflowDto> Invalid(string msg) => Fail(msg, ApiErrorCodes.Validation);

    private Task<bool> InScopeAsync(int loanId, int userId, string role) =>
        LoanRepository.ApplyVisibilityScope(_db, _db.Loans, userId, role).AnyAsync(l => l.Id == loanId);

    private async Task<bool> AllowedAsync(string role, string key) => IsAdmin(role) || await _perm.IsAllowedAsync(role, key);

    // ── Transaction + row lock + conflict mapping ────────────────────────────
    // Same rule as UnitOfWork.ExecuteInTransactionAsync / WizardController: with
    // NpgsqlRetryingExecutionStrategy the transaction must be opened inside the
    // strategy's delegate (a retried attempt starts from a clean change tracker).
    private async Task<ApiResponseDto<LoanWorkflowDto>> MutateAsync(int loanId, WorkflowCaller c, Func<Loan, Task<ApiResponseDto<LoanWorkflowDto>?>> work,
        Func<Task>? afterCommit = null)
    {
        if (!await InScopeAsync(loanId, c.UserId, c.Role)) return NotFound();
        ApiResponseDto<LoanWorkflowDto>? error;
        try
        {
            if (_db.Database.IsRelational() && _db.Database.CurrentTransaction == null)
            {
                var strategy = _db.Database.CreateExecutionStrategy();
                error = await strategy.ExecuteAsync(async () =>
                {
                    _db.ChangeTracker.Clear();
                    await using var tx = await _db.Database.BeginTransactionAsync();
                    var e = await RunLockedAsync(loanId, work);
                    if (e != null && !_commitOnError) { await tx.RollbackAsync(); return e; }
                    await _db.SaveChangesAsync();
                    await tx.CommitAsync();
                    return e;
                });
            }
            else
            {
                error = await RunLockedAsync(loanId, work);
                if (error == null || _commitOnError) await _db.SaveChangesAsync();
            }
        }
        catch (DbUpdateConcurrencyException)
        {
            _db.ChangeTracker.Clear();
            return Fail("This application or offer was changed by someone else a moment ago. Refresh and try again.", ApiErrorCodes.ConcurrencyConflict);
        }
        catch (DbUpdateException ex) when (ClassifyConflict(ex) is { } msg)
        {
            _db.ChangeTracker.Clear();
            return Fail(msg, ApiErrorCodes.ConcurrencyConflict);
        }
        _db.ChangeTracker.Clear();
        if (error != null) return error;
        if (afterCommit != null) { try { await afterCommit(); } catch { /* notifications are non-fatal */ } }
        return await GetAsync(loanId, c);
    }

    private async Task<ApiResponseDto<LoanWorkflowDto>?> RunLockedAsync(int loanId, Func<Loan, Task<ApiResponseDto<LoanWorkflowDto>?>> work)
    {
        _commitOnError = false;
        // Serialize every workflow action on one application (final selection,
        // offer count, sanction, disbursement) behind the loan row lock.
        if (_db.Database.IsNpgsql())
            await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"Loans\" WHERE \"Id\" = {loanId} FOR UPDATE");
        var loan = await _db.Loans.Include(l => l.Customer).FirstOrDefaultAsync(l => l.Id == loanId);
        if (loan == null) return NotFound();
        return await work(loan);
    }

    /// <summary>Unique / trigger violations from the DB backstops → business messages.</summary>
    internal static string? ClassifyConflict(Exception ex)
    {
        for (Exception? e = ex; e != null; e = e.InnerException)
        {
            if (e is Npgsql.PostgresException pg)
            {
                var n = pg.ConstraintName ?? "";
                if (pg.SqlState == "23505")
                {
                    if (n == AppDbContext.ActiveOfferPerLenderIndex) return "This lender already has an active offer on this application.";
                    if (n == AppDbContext.FinalOfferIndex) return "Another offer was selected as final at the same moment. Refresh and try again.";
                    if (n == AppDbContext.OpenDeviationIndex) return "A deviation request is already pending for this offer.";
                    if (n == AppDbContext.ActiveSanctionIndex) return "This application already has an active sanction.";
                    if (n == AppDbContext.CompletedDisbursementIndex) return "This application has already been disbursed.";
                    if (n.Contains("IdempotencyKey")) return "This request was already processed (duplicate submission).";
                    return "A duplicate record was rejected by the database.";
                }
                if (pg.SqlState is "P0001" or "23514") return pg.MessageText;
            }
            var m = e.Message ?? "";
            if (m.Contains("UNIQUE constraint failed: ApplicationOffers", StringComparison.Ordinal)) return "This lender already has an active offer, or another offer is already final.";
            if (m.Contains("UNIQUE constraint failed: OfferDeviations", StringComparison.Ordinal)) return "A deviation request is already pending for this offer.";
            if (m.Contains("UNIQUE constraint failed: Sanctions", StringComparison.Ordinal)) return "This application already has an active sanction.";
            if (m.Contains("UNIQUE constraint failed: Disbursements", StringComparison.Ordinal)) return "This application has already been disbursed.";
        }
        return null;
    }

    // ── Shared writers ───────────────────────────────────────────────────────
    private void Transition(Loan loan, LoanStatus to, string comment, int userId)
    {
        var from = loan.Status;
        loan.Status = to;
        loan.UpdatedAt = Now;
        loan.SlaBreachNotifiedAt = null;
        _db.LoanStatusHistories.Add(new LoanStatusHistory
        {
            LoanId = loan.Id, FromStatus = from, ToStatus = to, Comment = comment, ChangedByUserId = userId
        });
    }

    private void Timeline(int loanId, string name, string comment, string? subNote, WorkflowCaller c) =>
        _db.TrackingEntries.Add(new TrackingEntry
        {
            LoanId = loanId, Name = name, Stage = RoleTitle(c.Role), AssignedUser = "", Status = "COMPLETE",
            Comment = comment, SubNote = subNote, CreatedByUserId = c.UserId
        });

    private void Audit(string entity, int id, string action, object? before, object? after, string? reason, WorkflowCaller c) =>
        _db.AuditLogs.Add(new AuditLog
        {
            EntityName = entity, EntityId = id.ToString(), Action = action,
            OldValues = before == null ? null : JsonSerializer.Serialize(before),
            NewValues = after == null ? null : JsonSerializer.Serialize(after),
            Reason = reason, UserId = c.UserId, UserName = c.Name, CreatedAt = Now
        });

    internal static string RoleTitle(string role) => role switch
    {
        "Admin" => "Chief Administrator", "Manager" => "Business Development Manager", "TeamLeader" => "Deputy Sales Manager",
        "LoginTeam" => "Credit Evaluation Officer", "OperationManager" => "Credit Evaluation Manager", "LocationHead" => "Zonal Manager",
        "Sales" => "Business Development Executive", "Dsa" => "Mass Channel Partner", "Partner" => "Channel Partner",
        "Accounts" => "Payout & Reconciliation Officer", "ProductTeam" => "Product & Risk Officer", _ => role
    };

    private static string Inr(decimal v) => "₹" + v.ToString("#,0.##", System.Globalization.CultureInfo.GetCultureInfo("en-IN"));

    private static string TermsLine(ApplicationOfferRevision r) =>
        $"Amount {Inr(r.LoanAmount)} · Tenure {r.TenureMonths} mo · ROI {r.OfferedRoi}% · EMI {Inr(r.Emi)} · PF {r.ProcessingFeePct}% ({Inr(r.ProcessingFeeAmount)}) + GST {Inr(r.GstAmount)} · "
        + $"Insurance {Inr(r.InsuranceAmount)} · BT {Inr(r.BtAmount)} · Stamp {Inr(r.StampDuty)} · Net disbursement {Inr(r.NetDisbursement)}";

    // ═════════════════════════════════════════════════════════════════════════
    // Read model
    // ═════════════════════════════════════════════════════════════════════════
    public async Task<ApiResponseDto<LoanWorkflowDto>> GetAsync(int loanId, WorkflowCaller c)
    {
        if (!await InScopeAsync(loanId, c.UserId, c.Role)) return NotFound();
        if (!await _db.Loans.AsNoTracking().AnyAsync(l => l.Id == loanId)) return NotFound();

        // Lazy expiry (also enforced at every action): an active offer past its
        // validity is expired before anyone can see or act on it as valid.
        // Then repair an application left at Decision with no open deviation
        // request (e.g. the final offer expired while the deviation was waiting
        // for the approver) — otherwise nobody gets an Approve/Reject button and
        // the application is stuck at Decision for good.
        try
        {
            if (await ExpireOffersAsync(loanId, c)) await _db.SaveChangesAsync();
            if (await ReconcileDecisionStageAsync(loanId, c)) await _db.SaveChangesAsync();
        }
        catch (DbUpdateException) { /* a concurrent action expired/changed it first — the fresh read below shows it */ }
        _db.ChangeTracker.Clear();

        // Read the loan AFTER the repair above so the status shown is current.
        var loan = await _db.Loans.AsNoTracking().Include(l => l.Customer).FirstOrDefaultAsync(l => l.Id == loanId);
        if (loan == null) return NotFound();

        var masked = Is(c.Role, MaskedRoles);
        var offers = await _db.ApplicationOffers.AsNoTracking().Include(o => o.Revisions)
            .Where(o => o.LoanId == loanId).OrderBy(o => o.Id).ToListAsync();
        var deviations = await _db.OfferDeviations.AsNoTracking().Where(d => d.LoanId == loanId).OrderByDescending(d => d.Id).ToListAsync();
        var approvals = await _db.CreditApprovals.AsNoTracking().Where(a => a.LoanId == loanId).OrderByDescending(a => a.Id).ToListAsync();
        var sanctions = await _db.Sanctions.AsNoTracking().Where(s => s.LoanId == loanId).OrderByDescending(s => s.Id).ToListAsync();
        var disb = await _db.Disbursements.AsNoTracking().Where(d => d.LoanId == loanId).OrderByDescending(d => d.Id).ToListAsync();

        var userIds = offers.SelectMany(o => new[] { o.CreatedByUserId, o.UpdatedByUserId ?? 0, o.SelectedByUserId ?? 0 })
            .Concat(offers.SelectMany(o => o.Revisions.Select(r => r.CreatedByUserId)))
            .Concat(deviations.SelectMany(d => new[] { d.RaisedByUserId, d.AssignedApproverId ?? 0, d.DecidedByUserId ?? 0 }))
            .Concat(approvals.Select(a => a.ApproverUserId))
            .Concat(sanctions.SelectMany(s => new[] { s.GeneratedByUserId, s.CancelledByUserId ?? 0 }))
            .Concat(disb.Select(d => d.CreatedByUserId))
            .Where(i => i > 0).Distinct().ToList();
        var bureau = await _db.BureauReports.AsNoTracking().Where(b => b.CustomerId == loan.CustomerId && b.IsActive)
            .OrderByDescending(b => b.ScoreGeneratedDate).ThenByDescending(b => b.Id).FirstOrDefaultAsync();
        if (bureau?.UploadedByUserId is int bu) userIds.Add(bu);
        var names = await _db.Users.IgnoreQueryFilters().Where(u => userIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.FullName);
        var inactiveApprovers = await _db.Users.IgnoreQueryFilters()
            .Where(u => userIds.Contains(u.Id) && (!u.IsActive || u.IsDeleted)).Select(u => u.Id).ToListAsync();
        string? N(int? id) => id is > 0 && names.TryGetValue(id.Value, out var n) ? n : null;

        var dto = new LoanWorkflowDto
        {
            LoanId = loan.Id, LoanNumber = loan.LoanNumber, LoanStatus = loan.Status.ToString(),
            ProductKey = LoanMS.Infrastructure.Services.ObligationService.ProductKeyFor(loan.LoanType),
            MaxActiveOffers = MaxActiveOffers,
            MoveToOfferBlockers = loan.Status == LoanStatus.UnderReview ? LoanService.OfferEntryBlockers(loan) : new(),
            ManualDeviationCategories = DeviationRuleEngine.ManualCategories.ToList(),
        };

        foreach (var o in offers)
        {
            var revs = o.Revisions.OrderByDescending(r => r.RevisionNo).Select(r => RevDto(r, masked, N(r.CreatedByUserId))).ToList();
            var cur = o.Revisions.FirstOrDefault(r => r.RevisionNo == o.CurrentRevisionNo);
            DeviationEvaluationDto? evalDto = null;
            var evalJson = o.LatestEvaluationJson ?? cur?.EvaluationJson;
            if (!masked && evalJson != null)
                evalDto = ToDto(JsonSerializer.Deserialize<DeviationRuleEngine.Evaluation>(evalJson, JsonOpts)!);
            dto.Offers.Add(new ApplicationOfferDto
            {
                Id = o.Id, BankId = o.BankId, LenderName = o.LenderName, ProductKey = o.ProductKey, LoanType = o.LoanType,
                Status = o.Status, IsActive = S.ActiveOfferStatuses.Contains(o.Status),
                DeviationStatus = o.DeviationStatus, ApprovalStatus = o.ApprovalStatus,
                CurrentRevisionNo = o.CurrentRevisionNo, SelectedRevisionNo = o.SelectedRevisionNo,
                ValidUntil = o.ValidUntil, IsExpired = o.Status == S.OfferExpired, Version = o.Version,
                SelectedAt = o.SelectedAt, SelectedBy = N(o.SelectedByUserId), StatusReason = masked ? null : o.StatusReason,
                CreatedBy = N(o.CreatedByUserId), CreatedAt = o.CreatedAt, UpdatedAt = o.UpdatedAt, UpdatedBy = N(o.UpdatedByUserId),
                Current = revs.FirstOrDefault(r => r.RevisionNo == o.CurrentRevisionNo), Revisions = revs, Evaluation = evalDto,
                LatestEvaluatedAt = o.LatestEvaluatedAt,
            });
        }

        var lenderByOffer = offers.ToDictionary(o => o.Id, o => o.LenderName);
        dto.Deviations = deviations.Select(d => new OfferDeviationDto
        {
            Id = d.Id, OfferId = d.OfferId, RevisionNo = d.RevisionNo, LenderName = lenderByOffer.GetValueOrDefault(d.OfferId, ""),
            DeviationType = d.DeviationType, Source = d.Source, Status = d.Status,
            Reason = masked ? null : d.Reason, RaisedBy = N(d.RaisedByUserId), RaisedByUserId = d.RaisedByUserId, RaisedAt = d.RaisedAt,
            AssignedApprover = N(d.AssignedApproverId), AssignedApproverId = d.AssignedApproverId, AssignmentState = d.AssignmentState,
            AssignedApproverActive = d.AssignedApproverId == null || !inactiveApprovers.Contains(d.AssignedApproverId.Value),
            DecidedBy = N(d.DecidedByUserId), DecidedAt = d.DecidedAt, DecisionComment = masked ? null : d.DecisionComment,
            ClosedReason = d.ClosedReason,
            Flags = masked || d.RuleSnapshotJson == null ? null
                : ToDto(JsonSerializer.Deserialize<DeviationRuleEngine.Evaluation>(d.RuleSnapshotJson, JsonOpts)!).Checks,
        }).ToList();
        dto.CreditApprovals = approvals.Select(a => new CreditApprovalDto
        {
            Id = a.Id, OfferId = a.OfferId, RevisionNo = a.RevisionNo, LenderName = a.LenderName, Decision = a.Decision,
            Comment = masked ? null : a.Comment, DeviationStatusAtApproval = a.DeviationStatusAtApproval,
            Approver = N(a.ApproverUserId), CreatedAt = a.CreatedAt, IsCurrent = a.IsCurrent,
        }).ToList();
        dto.Sanctions = sanctions.Select(s => new SanctionDto
        {
            Id = s.Id, SanctionNumber = s.SanctionNumber, SanctionVersion = s.SanctionVersion, PreviousSanctionId = s.PreviousSanctionId,
            OfferId = s.OfferId, RevisionNo = s.RevisionNo, CreditApprovalId = s.CreditApprovalId, LenderName = s.LenderName,
            LoanAmount = s.LoanAmount, TenureMonths = s.TenureMonths, Roi = s.Roi, Emi = s.Emi,
            ProcessingFeePct = s.ProcessingFeePct, ProcessingFeeAmount = s.ProcessingFeeAmount, GstPct = s.GstPct, GstAmount = s.GstAmount,
            InsuranceAmount = s.InsuranceAmount, BtAmount = s.BtAmount, StampDuty = s.StampDuty, FinancedPrincipal = s.FinancedPrincipal,
            NetDisbursement = s.NetDisbursement, Status = s.Status, GeneratedBy = N(s.GeneratedByUserId), GeneratedAt = s.GeneratedAt,
            CancellationType = s.CancellationType, CancelReason = masked ? null : s.CancelReason, CancelledBy = N(s.CancelledByUserId), CancelledAt = s.CancelledAt,
        }).ToList();
        dto.Disbursements = disb.Select(d => new DisbursementDto
        {
            Id = d.Id, SanctionId = d.SanctionId, Type = d.Type, ReversalOfId = d.ReversalOfId, Amount = d.Amount,
            DisbursementDate = d.DisbursementDate, BankAccountNumber = MaskAccount(d.BankAccountNumber), Ifsc = d.Ifsc,
            AccountHolderName = d.AccountHolderName, Utr = d.Utr, LenderReference = d.LenderReference, Mode = d.Mode,
            Status = d.Status, Reason = masked ? null : d.Reason, CreatedBy = N(d.CreatedByUserId), CreatedAt = d.CreatedAt,
        }).ToList();

        if (loan.Status == LoanStatus.Offer && !masked)
            dto.EligibleLenders = await EligibleLendersAsync(loan);
        if (bureau != null && !masked)
            dto.BureauReport = new BureauReportSummaryDto
            {
                Id = bureau.Id, BureauProvider = bureau.BureauProvider, CreditScore = bureau.CreditScore,
                ReportDate = bureau.ScoreGeneratedDate, UploadedAt = bureau.CreatedAt, UploadedBy = N(bureau.UploadedByUserId),
                FileName = string.IsNullOrEmpty(bureau.SourceFile) ? null : Path.GetFileName(bureau.SourceFile),
            };
        dto.Capabilities = await CapabilitiesAsync(loan, c, offers, sanctions, disb);
        return ApiResponseDto<LoanWorkflowDto>.Ok(dto);
    }

    internal static readonly JsonSerializerOptions JsonOpts = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static string MaskAccount(string acct) =>
        string.IsNullOrEmpty(acct) || acct.Length <= 4 ? acct : new string('X', acct.Length - 4) + acct[^4..];

    private static OfferRevisionDto RevDto(ApplicationOfferRevision r, bool masked, string? by) => new()
    {
        RevisionNo = r.RevisionNo, LoanAmount = r.LoanAmount, TenureMonths = r.TenureMonths,
        BaseRoi = masked ? 0 : r.BaseRoi, OfferedRoi = r.OfferedRoi, RateType = r.RateType,
        ProcessingFeePct = r.ProcessingFeePct, ProcessingFeeAmount = r.ProcessingFeeAmount, GstPct = r.GstPct, GstAmount = r.GstAmount,
        InsuranceAmount = r.InsuranceAmount, PfInBundled = r.PfInBundled, InsuranceInBundled = r.InsuranceInBundled,
        BtAmount = r.BtAmount, StampDuty = r.StampDuty, FinancedPrincipal = r.FinancedPrincipal, Emi = r.Emi,
        NetDisbursement = r.NetDisbursement, ChangeReason = masked ? null : r.ChangeReason,
        EvaluationOutcome = masked ? "" : r.EvaluationOutcome, CreatedBy = by, CreatedByUserId = r.CreatedByUserId, CreatedAt = r.CreatedAt,
        MarginPp = masked ? null : r.BaseRoi - r.OfferedRoi,
    };

    internal static DeviationEvaluationDto ToDto(DeviationRuleEngine.Evaluation e) => new()
    {
        Outcome = e.Outcome, ManualReview = e.ManualReview, ManualReviewReason = e.ManualReviewReason, EvaluatedAt = e.EvaluatedAt,
        FactsUsed = e.FactsUsed,
        Checks = e.Checks.Select(k => new DeviationCheckDto
        {
            DeviationType = k.DeviationType, Metric = k.Metric, Status = k.Status, Actual = k.Actual, Allowed = k.Allowed,
            Difference = k.Difference, Unit = k.Unit, ApprovalRequired = k.ApprovalRequired, ExceedsAuthority = k.ExceedsAuthority,
            Message = k.Message, RuleId = k.Rule?.RuleId, RuleKey = k.Rule?.RuleKey, RuleVersion = k.Rule?.Version, RuleName = k.Rule?.Name,
        }).ToList(),
    };

    private async Task<WorkflowCapabilitiesDto> CapabilitiesAsync(Loan loan, WorkflowCaller c, List<ApplicationOffer> offers,
        List<Sanction> sanctions, List<Disbursement> disb)
    {
        var maker = Is(c.Role, OfferMakerRoles) && await AllowedAsync(c.Role, "canChangeStatus");
        var authority = Is(c.Role, AuthorityRoles);
        var raiser = Is(c.Role, OfferMakerRoles) && await AllowedAsync(c.Role, "canDeviation");
        var disburser = authority && await AllowedAsync(c.Role, "canDisburse");
        var hasActiveSanction = sanctions.Any(s => s.Status == S.SanctionActive);
        var hasDisbursement = disb.Any(d => d.Type == S.TypeDisbursement && d.Status == S.DisbursementCompleted);
        var final = offers.FirstOrDefault(o => o.Status == S.OfferFinal);
        var st = loan.Status;
        return new WorkflowCapabilitiesDto
        {
            Masked = Is(c.Role, MaskedRoles),
            CanMoveToOffer = maker && st == LoanStatus.UnderReview,
            CanBackToUnderwriting = maker && st == LoanStatus.Offer,
            CanManageOffers = maker && st == LoanStatus.Offer,
            CanSelectOffer = st == LoanStatus.Offer,
            CanRaiseDeviation = raiser && st == LoanStatus.Offer && final != null
                && final.DeviationStatus is S.DevRequired or S.DevNotRequired,
            CanSkipDeviation = authority && st == LoanStatus.Offer && final?.DeviationStatus == S.DevRequired,
            CanDecideDeviation = authority && st == LoanStatus.Decision,
            CanCreditApprove = authority && st == LoanStatus.Offer && final != null,
            CanEditApprovedTerms = authority && st is LoanStatus.Approved or LoanStatus.Acceptance && !hasActiveSanction,
            CanGenerateSanction = authority && st == LoanStatus.Approved && !hasActiveSanction,
            CanCancelSanction = authority && st is LoanStatus.Approved or LoanStatus.Acceptance && hasActiveSanction && !hasDisbursement,
            CanDisburse = disburser && st is LoanStatus.Approved or LoanStatus.Acceptance && hasActiveSanction && !hasDisbursement,
            CanReverseDisbursement = disburser && st == LoanStatus.Disbursed,
            CanReassignDeviation = authority && st == LoanStatus.Decision,
            CanUploadBureauReport = authority && st is not (LoanStatus.Rejected or LoanStatus.Closed or LoanStatus.Disbursed or LoanStatus.Draft),
            CanReEvaluate = (maker || authority) && st == LoanStatus.Offer,
        };
    }

    private async Task<List<EligibleLenderDto>> EligibleLendersAsync(Loan loan)
    {
        var productKey = LoanMS.Infrastructure.Services.ObligationService.ProductKeyFor(loan.LoanType);
        var norm = LoanMS.API.Controllers.LenderConfigController.NormalizeLoanType(productKey);
        var banks = await _db.Banks.AsNoTracking().Where(b => !b.IsDeleted && b.IsActive).OrderBy(b => b.BankName).ToListAsync();
        return banks.Where(b =>
            {
                var types = LoanMS.API.Controllers.LenderConfigController.SafeDeserializeStringList(b.LoanTypesJson);
                return types.Count == 0 || types.Any(t => LoanMS.API.Controllers.LenderConfigController.NormalizeLoanType(t) == norm);
            })
            .Select(b => new EligibleLenderDto { BankId = b.Id, BankName = b.BankName, OfferValidityDays = b.OfferValidityDays }).ToList();
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Deviation evaluation for one revision (authoritative facts)
    // ═════════════════════════════════════════════════════════════════════════
    private async Task<DeviationRuleEngine.Facts> BuildFactsAsync(Loan loan, int bankId, string productKey, OfferTermsDto t, decimal emi, WorkflowCaller c)
    {
        decimal? income = null, foir = null;
        // Internal system computation: the caller's access to the application is
        // checked before any evaluation, so the FOIR engine runs with full scope
        // (a role without obligations access must not turn FOIR into "missing").
        var foirRes = await _sp.GetRequiredService<IObligationService>().CalculateFoirAsync(loan.Id, new CalculateFoirRequestDto { ProposedEmi = emi }, c.UserId, "Admin");
        if (foirRes.Success && foirRes.Data is { IncomeAvailable: true } fr && fr.CombinedIncome > 0)
        {
            income = fr.CombinedIncome;
            foir = fr.PostLoanFoirPct;
        }
        var bureau = await _db.BureauReports.AsNoTracking()
            .Where(b => b.CustomerId == loan.CustomerId && b.IsActive)
            .OrderByDescending(b => b.ScoreGeneratedDate)
            .Select(b => (int?)b.CreditScore).FirstOrDefaultAsync();
        var existingCustomer = await _db.Loans.AnyAsync(l => l.CustomerId == loan.CustomerId && l.Id != loan.Id
            && (l.Status == LoanStatus.Disbursed || l.Status == LoanStatus.Closed));
        return new DeviationRuleEngine.Facts
        {
            BankId = bankId, ProductKey = productKey, LoanType = loan.LoanType.ToString(), AsOf = Now,
            LoanAmount = t.LoanAmount, TenureMonths = t.TenureMonths, BaseRoi = t.BaseRoi, OfferedRoi = t.OfferedRoi,
            BtAmount = t.BtAmount, MonthlyIncome = income, PostLoanFoirPct = foir,
            BureauCibil = bureau is > 0 ? bureau : null, DeclaredCibil = loan.Customer?.CibilScore,
            EmploymentType = loan.Customer?.EmploymentType, CustomerType = loan.Customer?.CompanyType,
            ExistingCustomer = existingCustomer,
        };
    }

    private async Task<DeviationRuleEngine.Evaluation> EvaluateAsync(Loan loan, int bankId, string productKey, OfferTermsDto t, decimal emi, WorkflowCaller c)
    {
        var facts = await BuildFactsAsync(loan, bankId, productKey, t, emi, c);
        var rules = await _db.DeviationRules.AsNoTracking().Where(r => r.BankId == bankId).ToListAsync();
        return DeviationRuleEngine.Evaluate(rules, facts);
    }

    private static OfferTermsCalculator.Input CalcInput(OfferTermsDto t) => new()
    {
        LoanAmount = t.LoanAmount, TenureMonths = t.TenureMonths, OfferedRoi = t.OfferedRoi, ProcessingFeePct = t.ProcessingFeePct,
        GstPct = t.GstPct, InsuranceAmount = t.InsuranceAmount, PfInBundled = t.PfInBundled, InsuranceInBundled = t.InsuranceInBundled,
        BtAmount = t.BtAmount, StampDuty = t.StampDuty,
    };

    private static List<string> ValidateTerms(OfferTermsDto t)
    {
        var e = OfferTermsCalculator.Validate(CalcInput(t));
        if (t.BaseRoi < 0 || t.BaseRoi > 60) e.Add("Base ROI must be between 0 and 60% p.a.");
        if (t.BaseRoi * 100m != Math.Truncate(t.BaseRoi * 100m)) e.Add("Base ROI allows at most 2 decimal places.");
        if (e.Count == 0)
        {
            var r = OfferTermsCalculator.Calculate(CalcInput(t));
            if (r.NetDisbursement <= 0) e.Add("Net disbursement must be greater than 0 — deductions exceed the loan amount.");
        }
        return e;
    }

    private async Task<ApplicationOfferRevision> BuildRevisionAsync(Loan loan, ApplicationOffer offer, int revNo, OfferTermsDto t, string? reason, WorkflowCaller c)
    {
        var calc = OfferTermsCalculator.Calculate(CalcInput(t));
        var ev = await EvaluateAsync(loan, offer.BankId, offer.ProductKey, t, calc.Emi, c);
        return new ApplicationOfferRevision
        {
            OfferId = offer.Id, Offer = offer, RevisionNo = revNo, LoanAmount = t.LoanAmount, TenureMonths = t.TenureMonths,
            BaseRoi = t.BaseRoi, OfferedRoi = t.OfferedRoi, RateType = "Reducing",
            ProcessingFeePct = t.ProcessingFeePct, ProcessingFeeAmount = calc.ProcessingFeeAmount,
            GstPct = t.GstPct, GstAmount = calc.GstAmount, InsuranceAmount = t.InsuranceAmount,
            PfInBundled = t.PfInBundled, InsuranceInBundled = t.InsuranceInBundled, BtAmount = t.BtAmount, StampDuty = t.StampDuty,
            FinancedPrincipal = calc.FinancedPrincipal, Emi = calc.Emi, NetDisbursement = calc.NetDisbursement,
            ChangeReason = reason, EvaluationJson = JsonSerializer.Serialize(ev, JsonOpts), EvaluationOutcome = ev.Outcome,
            CreatedByUserId = c.UserId, CreatedAt = Now,
        };
    }

    /// <summary>Expire active offers past validity (before sanction). Returns true if anything changed (not saved).</summary>
    private async Task<bool> ExpireOffersAsync(int loanId, WorkflowCaller c)
    {
        // "Valid until 26-Sep" means valid for the WHOLE of 26-Sep. ValidUntil is
        // stored as a date (midnight), so comparing it with the current time
        // expired offers at 00:00 of their last valid day — and an offer entered
        // as "valid until today" expired the moment it was saved. That silently
        // closed pending deviation requests before the approver could act.
        var today = Now.Date;
        var hasSanction = await _db.Sanctions.AnyAsync(s => s.LoanId == loanId && s.Status == S.SanctionActive);
        if (hasSanction) return false; // the sanction snapshot is what counts from here on
        var expiring = await _db.ApplicationOffers
            .Where(o => o.LoanId == loanId && (o.Status == S.OfferAvailable || o.Status == S.OfferFinal || o.Status == S.OfferNotSelected)
                        && o.ValidUntil != null && o.ValidUntil < today)
            .ToListAsync();
        foreach (var o in expiring)
        {
            var wasFinal = o.Status == S.OfferFinal;
            o.Status = S.OfferExpired;
            o.StatusReason = $"Offer validity ended {o.ValidUntil:dd-MMM-yyyy}.";
            o.ApprovalStatus = S.ApprovalPending;
            o.Version++;
            o.UpdatedAt = Now;
            await CloseOpenDeviationsAsync(o.Id, "Offer expired.");
            await InvalidateApprovalsAsync(o.Id);
            Timeline(loanId, "EFIN-Offer Expired", $"{o.LenderName} offer expired (valid until {o.ValidUntil:dd-MMM-yyyy}).",
                wasFinal ? "The expired offer was the selected final offer — select a valid offer or revise it." : " ", c with { Role = "System" });
        }
        return expiring.Count > 0;
    }

    /// <summary>
    /// Self-heal for an application sitting at Decision without any open
    /// (Raised) deviation request. Decision exists only while a deviation waits
    /// for an approver; if that request was closed some other way (offer
    /// expired, superseded, withdrawn) the application must return to Offer,
    /// otherwise no one sees Approve/Reject and nothing can move it forward.
    /// Also resets an offer still flagged "Raised" with no raised request so the
    /// deviation can be raised again. Stages changes; the caller saves.
    /// </summary>
    private async Task<bool> ReconcileDecisionStageAsync(int loanId, WorkflowCaller c)
    {
        var loan = await _db.Loans.FirstOrDefaultAsync(l => l.Id == loanId);
        if (loan == null || loan.Status != LoanStatus.Decision) return false;
        if (await _db.OfferDeviations.AnyAsync(d => d.LoanId == loanId && d.Status == S.RequestRaised)) return false;

        foreach (var o in await _db.ApplicationOffers.Where(o => o.LoanId == loanId && o.DeviationStatus == S.DevRaised).ToListAsync())
        {
            o.DeviationStatus = S.DevRequired;
            o.Version++; o.UpdatedAt = Now;
        }
        const string why = "No open deviation request (it was closed — e.g. the offer expired or was revised). Application returned to the Offer stage.";
        Transition(loan, LoanStatus.Offer, "[AUTO] " + why, c.UserId);
        Timeline(loanId, "EFIN-Deviation Closed", why, "Select / revise the offer and raise the deviation again if still required.", c with { Role = "System" });
        Audit("Loan", loanId, "DecisionStageReconciled", new { Status = LoanStatus.Decision.ToString() }, new { Status = LoanStatus.Offer.ToString() }, why, c);
        return true;
    }

    private async Task CloseOpenDeviationsAsync(int offerId, string reason)
    {
        var open = await _db.OfferDeviations.Where(d => d.OfferId == offerId && d.Status == S.RequestRaised).ToListAsync();
        foreach (var d in open)
        {
            d.Status = S.RequestClosed;
            d.ClosedReason = reason;
            if (d.TaskId is int tid && await _db.Tasks.FindAsync(tid) is { } task && !task.IsCompleted)
            {
                task.IsCompleted = true;
                task.Description = (task.Description ?? "") + $"\n[Closed] {reason}";
                task.UpdatedAt = Now;
            }
        }
    }

    private async Task InvalidateApprovalsAsync(int offerId)
    {
        foreach (var a in await _db.CreditApprovals.Where(a => a.OfferId == offerId && a.IsCurrent).ToListAsync())
            a.IsCurrent = false;
    }

    private static string CurrentOutcome(ApplicationOffer offer, ApplicationOfferRevision rev)
    {
        if (offer.LatestEvaluationJson == null) return rev.EvaluationOutcome;
        return JsonSerializer.Deserialize<DeviationRuleEngine.Evaluation>(offer.LatestEvaluationJson, JsonOpts)?.Outcome ?? rev.EvaluationOutcome;
    }

    private static string DeviationStatusFromEvaluation(string outcome) =>
        outcome == "NotRequired" ? S.DevNotRequired : S.DevRequired;

    // ═════════════════════════════════════════════════════════════════════════
    // Stage moves
    // ═════════════════════════════════════════════════════════════════════════
    public async Task<ApiResponseDto<LoanWorkflowDto>> MoveToOfferAsync(int loanId, string? comment, WorkflowCaller c)
    {
        if (!await InScopeAsync(loanId, c.UserId, c.Role)) return NotFound();
        if (!Is(c.Role, OfferMakerRoles) || !await AllowedAsync(c.Role, "canChangeStatus")) return Forbidden("move this application to the Offer stage");
        return await MutateAsync(loanId, c, async loan =>
        {
            if (loan.IsArchived) return Stage("Archived applications cannot move.");
            if (loan.Status != LoanStatus.UnderReview) return Stage($"Only an Under Review application can move to Offer (this one is {loan.Status}).");
            var blockers = LoanService.OfferEntryBlockers(loan);
            if (blockers.Count > 0) return Stage("Complete verification first: " + string.Join(", ", blockers) + ".");
            Transition(loan, LoanStatus.Offer, string.IsNullOrWhiteSpace(comment) ? "Verification complete — moved to Offer." : comment!, c.UserId);
            Timeline(loan.Id, "EFIN-Final Offer Check", string.IsNullOrWhiteSpace(comment) ? "Moved to Offer stage" : comment!, " ", c);
            Audit("Loan", loan.Id, "StatusChanged", new { Status = "UnderReview" }, new { Status = "Offer" }, comment, c);
            return null;
        });
    }

    public async Task<ApiResponseDto<LoanWorkflowDto>> BackToUnderwritingAsync(int loanId, string? reason, WorkflowCaller c)
    {
        if (string.IsNullOrWhiteSpace(reason)) return Invalid("A reason is required to send the application back to Underwriting.");
        if (!await InScopeAsync(loanId, c.UserId, c.Role)) return NotFound();
        if (!Is(c.Role, OfferMakerRoles) || !await AllowedAsync(c.Role, "canChangeStatus")) return Forbidden("send this application back");
        return await MutateAsync(loanId, c, async loan =>
        {
            if (loan.Status != LoanStatus.Offer) return Stage($"Only an application at the Offer stage can go back to Underwriting (this one is {loan.Status}).");
            var offers = await _db.ApplicationOffers.Where(o => o.LoanId == loanId).ToListAsync();
            foreach (var o in offers)
            {
                await CloseOpenDeviationsAsync(o.Id, "Application sent back to Underwriting.");
                await InvalidateApprovalsAsync(o.Id);
                if (o.Status is S.OfferFinal or S.OfferNotSelected)
                {
                    o.Status = S.OfferAvailable;
                    o.SelectedAt = null; o.SelectedByUserId = null; o.SelectedRevisionNo = null;
                    o.StatusReason = "Selection cleared — application sent back to Underwriting.";
                }
                o.ApprovalStatus = S.ApprovalPending;
                o.Version++; o.UpdatedAt = Now; o.UpdatedByUserId = c.UserId;
            }
            Transition(loan, LoanStatus.UnderReview, $"[BACK] {reason}", c.UserId);
            Timeline(loan.Id, "EFIN-Back to Underwriting", reason!, "Final selection cleared; pending deviation requests closed.", c);
            Audit("Loan", loan.Id, "StatusChanged", new { Status = "Offer" }, new { Status = "UnderReview" }, reason, c);
            return null;
        });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Offers
    // ═════════════════════════════════════════════════════════════════════════
    public async Task<ApiResponseDto<LoanWorkflowDto>> CreateOfferAsync(int loanId, CreateOfferRequestDto req, WorkflowCaller c)
    {
        if (!await InScopeAsync(loanId, c.UserId, c.Role)) return NotFound();
        if (!Is(c.Role, OfferMakerRoles) || !await AllowedAsync(c.Role, "canChangeStatus")) return Forbidden("create offers");
        var errors = ValidateTerms(req);
        if (req.ValidUntil != null && req.ValidUntil.Value.Date < Now.Date) errors.Add("Valid-until date is already in the past.");
        if (errors.Count > 0) return Invalid(string.Join(" ", errors));

        return await MutateAsync(loanId, c, async loan =>
        {
            if (loan.Status != LoanStatus.Offer) return Stage($"Offers can be added only at the Offer stage (this application is {loan.Status}).");
            await ExpireOffersAsync(loanId, c);
            var eligible = await EligibleLendersAsync(loan);
            var lender = eligible.FirstOrDefault(l => l.BankId == req.BankId);
            if (lender == null) return Invalid("This lender is not an active, configured lender for this product.");

            var active = await _db.ApplicationOffers.Where(o => o.LoanId == loanId && S.ActiveOfferStatuses.Contains(o.Status)).ToListAsync();
            if (active.Any(o => o.BankId == req.BankId))
                return Fail($"{lender.BankName} already has an active offer on this application — revise it instead.", ApiErrorCodes.OfferLimit);
            if (active.Count >= MaxActiveOffers)
                return Fail($"An application can hold at most {MaxActiveOffers} active lender offers (including not-selected alternatives). Withdraw one first.", ApiErrorCodes.OfferLimit);

            var productKey = LoanMS.Infrastructure.Services.ObligationService.ProductKeyFor(loan.LoanType);
            // Lender Configuration's offer validity pre-fills valid-until when the user left it blank.
            var validUntil = req.ValidUntil ?? (lender.OfferValidityDays is int days && days > 0 ? Now.Date.AddDays(days) : null);
            // A final offer already exists → the new one is a non-selected alternative.
            var hasFinal = active.Any(o => o.Status == S.OfferFinal);
            var offer = new ApplicationOffer
            {
                LoanId = loanId, BankId = req.BankId, LenderName = lender.BankName, ProductKey = productKey,
                LoanType = loan.LoanType.ToString(), Status = hasFinal ? S.OfferNotSelected : S.OfferAvailable,
                ApprovalStatus = S.ApprovalPending, CurrentRevisionNo = 1,
                ValidUntil = validUntil, CreatedByUserId = c.UserId, CreatedAt = Now,
                StatusReason = hasFinal ? "Added after a final offer was selected." : null,
            };
            _db.ApplicationOffers.Add(offer);
            var rev = await BuildRevisionAsync(loan, offer, 1, req, "Initial offer", c);
            offer.DeviationStatus = DeviationStatusFromEvaluation(rev.EvaluationOutcome);
            _db.ApplicationOfferRevisions.Add(rev);
            Timeline(loanId, "EFIN-Offer Created", $"{lender.BankName} offer added (rev 1).", TermsLine(rev), c);
            Audit("Loan", loanId, "OfferCreated", null, new { lender.BankName, req.LoanAmount, req.TenureMonths, req.OfferedRoi, rev.Emi, rev.NetDisbursement, offer.DeviationStatus }, null, c);
            return null;
        });
    }

    public async Task<ApiResponseDto<LoanWorkflowDto>> ReviseOfferAsync(int loanId, int offerId, ReviseOfferRequestDto req, WorkflowCaller c)
    {
        if (string.IsNullOrWhiteSpace(req.Reason)) return Invalid("A reason is required for an offer revision.");
        if (!await InScopeAsync(loanId, c.UserId, c.Role)) return NotFound();
        var errors = ValidateTerms(req);
        if (req.ValidUntil != null && req.ValidUntil.Value.Date < Now.Date) errors.Add("Valid-until date is already in the past.");
        if (errors.Count > 0) return Invalid(string.Join(" ", errors));

        var editingApproved = false;
        return await MutateAsync(loanId, c, async loan =>
        {
            var offer = await _db.ApplicationOffers.Include(o => o.Revisions).FirstOrDefaultAsync(o => o.Id == offerId && o.LoanId == loanId);
            if (offer == null) return Fail("Offer not found.", ApiErrorCodes.NotFound);
            await ExpireOffersAsync(loanId, c);

            if (loan.Status is LoanStatus.Approved or LoanStatus.Acceptance)
            {
                // Edit Approved Terms — only the 4 authority roles, only before a sanction.
                if (!Is(c.Role, AuthorityRoles)) return Forbidden("change credit-approved terms");
                if (offer.Status != S.OfferFinal) return Stage("Only the approved (final) offer can be revised after credit approval.");
                if (await _db.Sanctions.AnyAsync(s => s.LoanId == loanId && s.Status == S.SanctionActive))
                    return Stage("A sanction is active — cancel it (Amendment) before changing the terms.");
                editingApproved = true;
            }
            else
            {
                if (!Is(c.Role, OfferMakerRoles) || !await AllowedAsync(c.Role, "canChangeStatus")) return Forbidden("revise offers");
                if (loan.Status != LoanStatus.Offer) return Stage($"Offers can be revised only at the Offer stage (this application is {loan.Status}).");
            }
            if (!S.ActiveOfferStatuses.Contains(offer.Status)) return Stage($"A {offer.Status} offer cannot be revised.");
            if (req.ExpectedVersion != offer.Version)
                return Fail("This offer was changed by someone else. Refresh to see the latest revision.", ApiErrorCodes.ConcurrencyConflict);

            var current = offer.Revisions.First(r => r.RevisionNo == offer.CurrentRevisionNo);
            if (SameTerms(current, req) && req.ValidUntil == offer.ValidUntil)
                return Invalid("No term changed — nothing to revise.");

            var rev = await BuildRevisionAsync(loan, offer, offer.CurrentRevisionNo + 1, req, req.Reason.Trim(), c);
            _db.ApplicationOfferRevisions.Add(rev);
            var before = new { Rev = current.RevisionNo, current.LoanAmount, current.TenureMonths, current.OfferedRoi, current.Emi, offer.DeviationStatus, offer.ApprovalStatus };
            offer.CurrentRevisionNo = rev.RevisionNo;
            offer.LatestEvaluationJson = null; offer.LatestEvaluatedAt = null; // the new revision's own evaluation is current
            offer.ValidUntil = req.ValidUntil;
            offer.DeviationStatus = DeviationStatusFromEvaluation(rev.EvaluationOutcome);
            offer.ApprovalStatus = S.ApprovalPending;
            offer.Version++; offer.UpdatedAt = Now; offer.UpdatedByUserId = c.UserId;
            if (offer.Status == S.OfferFinal) offer.SelectedRevisionNo = rev.RevisionNo;
            await CloseOpenDeviationsAsync(offer.Id, $"Superseded by revision {rev.RevisionNo}.");
            await InvalidateApprovalsAsync(offer.Id);

            if (editingApproved)
                Transition(loan, LoanStatus.Offer, $"[TERMS CHANGED] Credit-approved terms revised (rev {rev.RevisionNo}) — deviation re-evaluated, new credit approval required. {req.Reason}", c.UserId);

            Timeline(loanId, "EFIN-Offer Revised", $"{offer.LenderName} offer revised to rev {rev.RevisionNo}: {req.Reason.Trim()}",
                TermsLine(rev) + $" · Deviation: {offer.DeviationStatus}", c);
            Audit("ApplicationOffer", offer.Id, "Revised", before,
                new { Rev = rev.RevisionNo, rev.LoanAmount, rev.TenureMonths, rev.OfferedRoi, rev.Emi, offer.DeviationStatus, offer.ApprovalStatus }, req.Reason, c);
            return null;
        });
    }

    private static bool SameTerms(ApplicationOfferRevision r, OfferTermsDto t) =>
        r.LoanAmount == t.LoanAmount && r.TenureMonths == t.TenureMonths && r.BaseRoi == t.BaseRoi && r.OfferedRoi == t.OfferedRoi
        && r.ProcessingFeePct == t.ProcessingFeePct && r.GstPct == t.GstPct && r.InsuranceAmount == t.InsuranceAmount
        && r.PfInBundled == t.PfInBundled && r.InsuranceInBundled == t.InsuranceInBundled && r.BtAmount == t.BtAmount && r.StampDuty == t.StampDuty;

    public async Task<ApiResponseDto<LoanWorkflowDto>> WithdrawOfferAsync(int loanId, int offerId, OfferActionRequestDto req, WorkflowCaller c)
    {
        if (string.IsNullOrWhiteSpace(req.Reason)) return Invalid("A reason is required to withdraw an offer.");
        if (!await InScopeAsync(loanId, c.UserId, c.Role)) return NotFound();
        if (!Is(c.Role, OfferMakerRoles) || !await AllowedAsync(c.Role, "canChangeStatus")) return Forbidden("withdraw offers");
        return await MutateAsync(loanId, c, async loan =>
        {
            if (loan.Status != LoanStatus.Offer) return Stage($"Offers can be withdrawn only at the Offer stage (this application is {loan.Status}).");
            var offer = await _db.ApplicationOffers.FirstOrDefaultAsync(o => o.Id == offerId && o.LoanId == loanId);
            if (offer == null) return Fail("Offer not found.", ApiErrorCodes.NotFound);
            if (!S.ActiveOfferStatuses.Contains(offer.Status))
                return Stage($"A {offer.Status} offer cannot be withdrawn.");
            if (req.ExpectedVersion is int v && v != offer.Version)
                return Fail("This offer was changed by someone else. Refresh and try again.", ApiErrorCodes.ConcurrencyConflict);
            var wasFinal = offer.Status == S.OfferFinal;
            var before = offer.Status;
            offer.Status = S.OfferWithdrawn;
            offer.StatusReason = req.Reason!.Trim();
            offer.ApprovalStatus = S.ApprovalPending;
            offer.Version++; offer.UpdatedAt = Now; offer.UpdatedByUserId = c.UserId;
            await CloseOpenDeviationsAsync(offer.Id, "Offer withdrawn.");
            await InvalidateApprovalsAsync(offer.Id);
            if (wasFinal) await RestoreNotSelectedAsync(loanId, offer.Id);
            Timeline(loanId, "EFIN-Offer Withdrawn", $"{offer.LenderName} offer withdrawn: {req.Reason!.Trim()}",
                wasFinal ? "It was the final offer — the other offers are available for selection again." : " ", c);
            Audit("ApplicationOffer", offer.Id, "Withdrawn", new { Status = before }, new { offer.Status }, req.Reason, c);
            return null;
        });
    }

    private async Task RestoreNotSelectedAsync(int loanId, int exceptOfferId)
    {
        foreach (var o in await _db.ApplicationOffers.Where(o => o.LoanId == loanId && o.Id != exceptOfferId && o.Status == S.OfferNotSelected).ToListAsync())
        {
            o.Status = S.OfferAvailable;
            o.StatusReason = "Available again — the final selection was cleared.";
            o.Version++; o.UpdatedAt = Now;
        }
    }

    public async Task<ApiResponseDto<LoanWorkflowDto>> SelectOfferAsync(int loanId, int offerId, OfferActionRequestDto req, WorkflowCaller c)
    {
        // Anyone with access to the application may confirm the final offer (Phase 0 §8);
        // scope is still enforced (404 outside it).
        if (!await InScopeAsync(loanId, c.UserId, c.Role)) return NotFound();
        return await MutateAsync(loanId, c, async loan =>
        {
            if (loan.Status != LoanStatus.Offer) return Stage($"A final offer can be selected only at the Offer stage (this application is {loan.Status}).");
            await ExpireOffersAsync(loanId, c);
            var offers = await _db.ApplicationOffers.Where(o => o.LoanId == loanId).ToListAsync();
            var offer = offers.FirstOrDefault(o => o.Id == offerId);
            if (offer == null) return Fail("Offer not found.", ApiErrorCodes.NotFound);
            if (offer.Status == S.OfferFinal) return Stage("This offer is already the final offer.");
            if (offer.Status is not (S.OfferAvailable or S.OfferNotSelected))
                return Stage($"A {offer.Status} offer cannot be selected.");
            if (req.ExpectedVersion is int v && v != offer.Version)
                return Fail("This offer was changed by someone else. Refresh and try again.", ApiErrorCodes.ConcurrencyConflict);
            var currentFinal = offers.FirstOrDefault(o => o.Status == S.OfferFinal);
            if (currentFinal != null)
                return Stage($"{currentFinal.LenderName} is already the final offer — unselect it first.");

            offer.Status = S.OfferFinal;
            offer.SelectedAt = Now; offer.SelectedByUserId = c.UserId; offer.SelectedRevisionNo = offer.CurrentRevisionNo;
            offer.StatusReason = null;
            offer.Version++; offer.UpdatedAt = Now; offer.UpdatedByUserId = c.UserId;
            foreach (var o in offers.Where(o => o.Id != offer.Id && o.Status == S.OfferAvailable))
            {
                o.Status = S.OfferNotSelected;
                o.StatusReason = $"{offer.LenderName} selected as final offer.";
                o.Version++; o.UpdatedAt = Now;
            }
            Timeline(loanId, "EFIN-Offer Selected", $"{offer.LenderName} selected as final offer (rev {offer.CurrentRevisionNo}).",
                $"Deviation: {offer.DeviationStatus}", c);
            Audit("ApplicationOffer", offer.Id, "Selected", null, new { offer.Status, offer.SelectedRevisionNo }, null, c);
            return null;
        });
    }

    public async Task<ApiResponseDto<LoanWorkflowDto>> UnselectOfferAsync(int loanId, int offerId, OfferActionRequestDto req, WorkflowCaller c)
    {
        if (string.IsNullOrWhiteSpace(req.Reason)) return Invalid("A reason is required to change the final offer.");
        if (!await InScopeAsync(loanId, c.UserId, c.Role)) return NotFound();
        return await MutateAsync(loanId, c, async loan =>
        {
            if (loan.Status != LoanStatus.Offer) return Stage($"The final offer can be changed only at the Offer stage (this application is {loan.Status}).");
            var offer = await _db.ApplicationOffers.FirstOrDefaultAsync(o => o.Id == offerId && o.LoanId == loanId);
            if (offer == null) return Fail("Offer not found.", ApiErrorCodes.NotFound);
            if (offer.Status != S.OfferFinal) return Stage("Only the final offer can be unselected.");
            if (req.ExpectedVersion is int v && v != offer.Version)
                return Fail("This offer was changed by someone else. Refresh and try again.", ApiErrorCodes.ConcurrencyConflict);
            offer.Status = S.OfferAvailable;
            offer.SelectedAt = null; offer.SelectedByUserId = null; offer.SelectedRevisionNo = null;
            offer.StatusReason = req.Reason!.Trim();
            offer.ApprovalStatus = S.ApprovalPending;
            offer.Version++; offer.UpdatedAt = Now; offer.UpdatedByUserId = c.UserId;
            await CloseOpenDeviationsAsync(offer.Id, "Final selection cleared.");
            await InvalidateApprovalsAsync(offer.Id);
            await RestoreNotSelectedAsync(loanId, offer.Id);
            Timeline(loanId, "EFIN-Offer Unselected", $"{offer.LenderName} is no longer the final offer: {req.Reason!.Trim()}", " ", c);
            Audit("ApplicationOffer", offer.Id, "Unselected", new { Status = S.OfferFinal }, new { offer.Status }, req.Reason, c);
            return null;
        });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Deviation — raise / decide / skip
    // ═════════════════════════════════════════════════════════════════════════
    public async Task<ApiResponseDto<LoanWorkflowDto>> RaiseDeviationAsync(int loanId, int offerId, RaiseOfferDeviationRequestDto req, string? idempotencyKey, WorkflowCaller c)
    {
        if (!await InScopeAsync(loanId, c.UserId, c.Role)) return NotFound();
        if (!string.IsNullOrWhiteSpace(idempotencyKey))
        {
            var prior = await _db.OfferDeviations.AsNoTracking().FirstOrDefaultAsync(d => d.IdempotencyKey == idempotencyKey);
            if (prior != null)
                return prior.LoanId == loanId ? await GetAsync(loanId, c) : Invalid("Idempotency key already used for another application.");
        }
        if (!Is(c.Role, OfferMakerRoles) || !await AllowedAsync(c.Role, "canDeviation")) return Forbidden("raise deviations");
        var type = (req.DeviationType ?? "").Trim();
        if (!DeviationRuleEngine.ManualCategories.Contains(type) && type != "Multiple")
            return Invalid("Deviation type must be one of: " + string.Join(", ", DeviationRuleEngine.ManualCategories) + ".");
        if (string.IsNullOrWhiteSpace(req.Reason)) return Invalid("A deviation reason is required.");

        LoanTask? task = null;
        int? approverId = null;
        return await MutateAsync(loanId, c, async loan =>
        {
            if (loan.Status != LoanStatus.Offer) return Stage($"A deviation can be raised only at the Offer stage (this application is {loan.Status}).");
            await ExpireOffersAsync(loanId, c);
            var offer = await _db.ApplicationOffers.Include(o => o.Revisions).FirstOrDefaultAsync(o => o.Id == offerId && o.LoanId == loanId);
            if (offer == null) return Fail("Offer not found.", ApiErrorCodes.NotFound);
            if (offer.Status != S.OfferFinal) return Stage("Deviation is lender-specific — raise it on the selected final offer.");
            if (offer.DeviationStatus == S.DevRejected)
                return Stage("The deviation for these terms was rejected. Revise the offer terms to raise a new deviation request.");
            if (offer.DeviationStatus is S.DevApproved or S.DevSkipped)
                return Stage($"Deviation for revision {offer.CurrentRevisionNo} is already {offer.DeviationStatus}.");
            if (offer.DeviationStatus == S.DevRaised) return Stage("A deviation request is already pending for this offer.");
            // A rejected request on this exact revision can never be re-raised.
            if (await _db.OfferDeviations.AnyAsync(d => d.OfferId == offer.Id && d.RevisionNo == offer.CurrentRevisionNo && d.Status == S.RequestRejected))
                return Stage("A deviation for this revision was already rejected — revise the terms first.");

            var rev = offer.Revisions.First(r => r.RevisionNo == offer.CurrentRevisionNo);
            var (assignee, state) = await PickApproverAsync(loan, c.UserId, c.Role);
            approverId = assignee?.Id;
            var dev = new OfferDeviation
            {
                LoanId = loanId, OfferId = offer.Id, RevisionNo = rev.RevisionNo, BankId = offer.BankId,
                DeviationType = type, Source = CurrentOutcome(offer, rev) == "Required" ? "Auto" : "Manual",
                Status = S.RequestRaised, Reason = req.Reason.Trim(), RuleSnapshotJson = offer.LatestEvaluationJson ?? rev.EvaluationJson,
                OfferSnapshotJson = JsonSerializer.Serialize(RevDto(rev, false, null), JsonOpts),
                RaisedByUserId = c.UserId, RaisedAt = Now, AssignedApproverId = assignee?.Id, AssignmentState = state,
                IdempotencyKey = string.IsNullOrWhiteSpace(idempotencyKey) ? null : idempotencyKey,
            };
            _db.OfferDeviations.Add(dev);
            offer.DeviationStatus = S.DevRaised;
            offer.Version++; offer.UpdatedAt = Now; offer.UpdatedByUserId = c.UserId;
            if (assignee != null)
            {
                task = new LoanTask
                {
                    LoanId = loanId, Title = $"Deviation approval — {loan.LoanNumber} ({offer.LenderName})",
                    Description = $"{type} deviation raised by {c.Name ?? RoleTitle(c.Role)}: {req.Reason.Trim()}",
                    Priority = "High", AssignedToUserId = assignee.Id, CreatedByUserId = c.UserId, DueDate = Now.AddDays(1),
                };
                _db.Tasks.Add(task);
            }
            Transition(loan, LoanStatus.Decision, $"Deviation Type: {type} | Reason: {req.Reason.Trim()}", c.UserId);
            Timeline(loanId, "EFIN-Deviation", $"Deviation Type: {type}\nDeviation Reason: {req.Reason.Trim()}",
                assignee != null ? $"Assigned to {assignee.FullName} ({RoleTitle(assignee.Role.ToString())})"
                                 : "No eligible alternate approver — escalated.", c);
            Audit("Loan", loanId, "DeviationRaised", null, new { offer.LenderName, type, Rev = rev.RevisionNo, AssignedTo = assignee?.Id, state }, req.Reason, c);
            return null;
        }, afterCommit: async () =>
        {
            // Link the task + notify (after the ids exist).
            var dev = await _db.OfferDeviations.Where(d => d.OfferId == offerId && d.Status == S.RequestRaised).FirstOrDefaultAsync();
            if (dev != null && task != null) { dev.TaskId = task.Id; }
            _db.AppNotifications.Add(new AppNotification
            {
                Type = "deviation_raised", Icon = "⚠️",
                Message = approverId != null ? $"Deviation raised on application #{loanId} — awaiting your approval."
                                             : $"Deviation raised on application #{loanId} — no eligible approver, escalated.",
                TargetUserId = approverId, TargetRole = approverId == null ? "Admin" : null,
            });
            await _db.SaveChangesAsync();
            await EmailApproverAsync(approverId, loanId, "Deviation approval required");
        });
    }

    /// <summary>
    /// Eligible approver: one of the 4 authority roles, active, able to see the
    /// application, and never the raiser. Preference: the application's Credit
    /// Evaluation Manager (OpsManager) → its login user → Credit Evaluation
    /// Manager → Zonal Manager → Credit Evaluation Officer → Chief Administrator.
    /// </summary>
    private async Task<(User? user, string state)> PickApproverAsync(Loan loan, int raiserId, string raiserRole)
    {
        var order = new[] { UserRole.OperationManager, UserRole.LocationHead, UserRole.LoginTeam, UserRole.Admin };
        var candidates = await _db.Users.Where(u => u.IsActive && u.Id != raiserId && order.Contains(u.Role)).ToListAsync();
        var preferred = new[] { loan.OpsManagerId, loan.LoginUserId }.Where(i => i.HasValue).Select(i => i!.Value).ToList();
        var ranked = candidates
            .OrderBy(u => preferred.Contains(u.Id) ? preferred.IndexOf(u.Id) : 99)
            .ThenBy(u => Array.IndexOf(order, u.Role)).ThenBy(u => u.Id).ToList();
        foreach (var u in ranked)
            if (await LoanRepository.ApplyVisibilityScope(_db, _db.Loans, u.Id, u.Role.ToString()).AnyAsync(l => l.Id == loan.Id))
                // The raiser is an approver themselves → routed to an alternate approver.
                return (u, Is(raiserRole, AuthorityRoles) ? "Escalated" : "Assigned");
        return (null, "Escalated");
    }

    public async Task<ApiResponseDto<LoanWorkflowDto>> DecideDeviationAsync(int loanId, int deviationId, DecideOfferDeviationRequestDto req, string? idempotencyKey, WorkflowCaller c)
    {
        if (!await InScopeAsync(loanId, c.UserId, c.Role)) return NotFound();
        if (!string.IsNullOrWhiteSpace(idempotencyKey))
        {
            var prior = await _db.OfferDeviations.AsNoTracking().FirstOrDefaultAsync(d => d.DecisionIdempotencyKey == idempotencyKey);
            if (prior != null)
                return prior.LoanId == loanId ? await GetAsync(loanId, c) : Invalid("Idempotency key already used for another application.");
        }
        if (!Is(c.Role, AuthorityRoles)) return Forbidden("decide deviations (Chief Administrator, Zonal Manager, Credit Evaluation Manager or Credit Evaluation Officer only)");
        if (!req.Approve && string.IsNullOrWhiteSpace(req.Comment)) return Invalid("A comment is required to reject a deviation.");
        int? taskId = null;
        return await MutateAsync(loanId, c, async loan =>
        {
            var dev = await _db.OfferDeviations.FirstOrDefaultAsync(d => d.Id == deviationId && d.LoanId == loanId);
            if (dev == null) return Fail("Deviation request not found.", ApiErrorCodes.NotFound);
            if (dev.Status != S.RequestRaised) return Stage($"This deviation request is already {dev.Status}.");
            if (loan.Status != LoanStatus.Decision) return Stage($"The application is {loan.Status}, not awaiting a deviation decision.");
            // Segregation of duties — nobody decides a deviation they raised, Admin included.
            if (dev.RaisedByUserId == c.UserId)
                return Fail("You raised this deviation — it must be decided by a different eligible approver.", ApiErrorCodes.SelfApproval);
            var offer = await _db.ApplicationOffers.Include(o => o.Revisions).FirstAsync(o => o.Id == dev.OfferId);
            if (offer.CurrentRevisionNo != dev.RevisionNo)
                return Stage("The offer was revised after this deviation was raised — it no longer applies.");
            if (req.Approve && dev.RuleSnapshotJson != null)
            {
                var ev = JsonSerializer.Deserialize<DeviationRuleEngine.Evaluation>(dev.RuleSnapshotJson, JsonOpts);
                var over = ev?.Checks.Where(k => k.ExceedsAuthority).ToList() ?? new();
                if (over.Count > 0)
                    return Stage("The deviation exceeds the configured approvable limit (" + string.Join("; ", over.Select(o => o.Message))
                        + ") — it cannot be approved; revise the terms.");
            }
            dev.Status = req.Approve ? S.RequestApproved : S.RequestRejected;
            dev.DecidedByUserId = c.UserId; dev.DecidedAt = Now;
            dev.DecisionComment = string.IsNullOrWhiteSpace(req.Comment) ? null : req.Comment.Trim();
            dev.DecisionIdempotencyKey = string.IsNullOrWhiteSpace(idempotencyKey) ? null : idempotencyKey;
            taskId = dev.TaskId;
            if (dev.TaskId is int tid && await _db.Tasks.FindAsync(tid) is { } task && !task.IsCompleted)
            {
                task.IsCompleted = true; task.UpdatedAt = Now;
                task.Description = (task.Description ?? "") + $"\n[{dev.Status}] by {c.Name ?? RoleTitle(c.Role)}";
            }
            offer.DeviationStatus = req.Approve ? S.DevApproved : S.DevRejected;
            offer.Version++; offer.UpdatedAt = Now; offer.UpdatedByUserId = c.UserId;
            // Deviation decision returns the application to Offer: approved →
            // awaiting Credit Approval; rejected → revise terms / choose another
            // lender / reject the application (a separate, explicit action).
            Transition(loan, LoanStatus.Offer,
                req.Approve ? $"Deviation approved. {req.Comment}".Trim() : $"Deviation rejected. {req.Comment}".Trim(), c.UserId);
            Timeline(loanId, req.Approve ? "EFIN-Approved Deviation" : "EFIN-Deviation Rejected",
                req.Approve ? "Deviation approved — proceed to Credit Approval" : "Deviation rejected",
                string.IsNullOrWhiteSpace(req.Comment) ? " " : req.Comment!.Trim(), c);
            Audit("OfferDeviation", dev.Id, req.Approve ? "Approved" : "Rejected", new { Status = S.RequestRaised }, new { dev.Status }, req.Comment, c);
            return null;
        });
    }

    public async Task<ApiResponseDto<LoanWorkflowDto>> SkipDeviationAsync(int loanId, int offerId, OfferActionRequestDto req, WorkflowCaller c)
    {
        if (!await InScopeAsync(loanId, c.UserId, c.Role)) return NotFound();
        if (!Is(c.Role, AuthorityRoles)) return Forbidden("skip deviations");
        if (string.IsNullOrWhiteSpace(req.Reason)) return Invalid("A reason is required to skip a deviation.");
        return await MutateAsync(loanId, c, async loan =>
        {
            if (loan.Status != LoanStatus.Offer) return Stage($"Deviation can be skipped only at the Offer stage (this application is {loan.Status}).");
            await ExpireOffersAsync(loanId, c);
            var offer = await _db.ApplicationOffers.Include(o => o.Revisions).FirstOrDefaultAsync(o => o.Id == offerId && o.LoanId == loanId);
            if (offer == null) return Fail("Offer not found.", ApiErrorCodes.NotFound);
            if (offer.Status != S.OfferFinal) return Stage("Skip applies to the selected final offer.");
            if (offer.DeviationStatus != S.DevRequired)
                return Stage(offer.DeviationStatus == S.DevNotRequired
                    ? "No deviation is required for this offer — there is nothing to skip."
                    : $"Deviation is {offer.DeviationStatus} — it cannot be skipped.");
            var rev = offer.Revisions.First(r => r.RevisionNo == offer.CurrentRevisionNo);
            var evJson = offer.LatestEvaluationJson ?? rev.EvaluationJson;
            var ev = evJson == null ? null : JsonSerializer.Deserialize<DeviationRuleEngine.Evaluation>(evJson, JsonOpts);
            if (ev?.Checks.Any(k => k.ExceedsAuthority) == true)
                return Stage("A breach exceeds the configured approvable limit — it cannot be skipped; revise the terms.");
            _db.OfferDeviations.Add(new OfferDeviation
            {
                LoanId = loanId, OfferId = offer.Id, RevisionNo = rev.RevisionNo, BankId = offer.BankId,
                DeviationType = SkippedTypes(ev), Source = "Manual", Status = S.RequestSkipped, Reason = req.Reason!.Trim(),
                RuleSnapshotJson = evJson, OfferSnapshotJson = JsonSerializer.Serialize(RevDto(rev, false, null), JsonOpts),
                RaisedByUserId = c.UserId, RaisedAt = Now, DecidedByUserId = c.UserId, DecidedAt = Now,
                DecisionComment = "Skipped by authorized user", AssignmentState = "Assigned",
            });
            offer.DeviationStatus = S.DevSkipped;
            offer.Version++; offer.UpdatedAt = Now; offer.UpdatedByUserId = c.UserId;
            Timeline(loanId, "EFIN- SKIP Deviation", "Deviation skipped", $"Skipped by {c.Name ?? RoleTitle(c.Role)}: {req.Reason!.Trim()}", c);
            Audit("ApplicationOffer", offer.Id, "DeviationSkipped", new { DeviationStatus = S.DevRequired }, new { offer.DeviationStatus }, req.Reason, c);
            return null;
        });
    }

    private static string SkippedTypes(DeviationRuleEngine.Evaluation? ev)
    {
        if (ev == null) return "Other";
        var types = ev.Checks.Where(k => k.Status != "Within").Select(k => k.DeviationType).Distinct().ToList();
        if (ev.ManualReview && types.Count == 0) return "ManualReview";
        var s = string.Join(",", types);
        return s.Length == 0 ? "Other" : s.Length > 40 ? "Multiple" : s;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Credit (offer terms) approval
    // ═════════════════════════════════════════════════════════════════════════
    public async Task<ApiResponseDto<LoanWorkflowDto>> CreditApprovalAsync(int loanId, int offerId, CreditApprovalRequestDto req, string? idempotencyKey, WorkflowCaller c)
    {
        if (!await InScopeAsync(loanId, c.UserId, c.Role)) return NotFound();
        if (!string.IsNullOrWhiteSpace(idempotencyKey))
        {
            var prior = await _db.CreditApprovals.AsNoTracking().FirstOrDefaultAsync(a => a.IdempotencyKey == idempotencyKey);
            if (prior != null)
                return prior.LoanId == loanId ? await GetAsync(loanId, c) : Invalid("Idempotency key already used for another application.");
        }
        if (!Is(c.Role, AuthorityRoles)) return Forbidden("give credit approval (Chief Administrator, Zonal Manager, Credit Evaluation Manager or Credit Evaluation Officer only)");
        var approve = string.Equals(req.Decision, "Approve", StringComparison.OrdinalIgnoreCase);
        var reject = string.Equals(req.Decision, "Reject", StringComparison.OrdinalIgnoreCase);
        if (!approve && !reject) return Invalid("Decision must be Approve or Reject.");
        if (reject && string.IsNullOrWhiteSpace(req.Comment)) return Invalid("A comment is required to reject the offer terms.");

        var notifyApproved = false;
        return await MutateAsync(loanId, c, async loan =>
        {
            if (loan.Status != LoanStatus.Offer) return Stage($"Credit approval happens at the Offer stage (this application is {loan.Status}).");
            await ExpireOffersAsync(loanId, c);
            var offer = await _db.ApplicationOffers.Include(o => o.Revisions).FirstOrDefaultAsync(o => o.Id == offerId && o.LoanId == loanId);
            if (offer == null) return Fail("Offer not found.", ApiErrorCodes.NotFound);
            if (offer.Status == S.OfferExpired) return Stage("This offer has expired — revise it with a new validity or choose another offer.");
            if (offer.Status != S.OfferFinal) return Stage("Only the selected final offer can be credit-approved.");
            if (req.RevisionNo != offer.CurrentRevisionNo)
                return Fail($"You reviewed revision {req.RevisionNo}, but the current revision is {offer.CurrentRevisionNo}. Refresh and review again.", ApiErrorCodes.ConcurrencyConflict);
            var rev = offer.Revisions.First(r => r.RevisionNo == offer.CurrentRevisionNo);

            List<object> devRefs = new();
            if (approve && offer.ApprovalStatus == S.ApprovalRejected)
                return Stage("Credit approval was declined for these terms — revise the offer (new revision) before approving.");
            if (approve)
            {
                // Maker-checker: the author of the current terms cannot approve them.
                if (rev.CreatedByUserId == c.UserId)
                    return Fail("You created the current offer terms — credit approval must come from a different eligible approver.", ApiErrorCodes.SelfApproval);
                var blockers = LoanService.OfferEntryBlockers(loan);
                if (blockers.Count > 0) return Stage("Required checks are incomplete: " + string.Join(", ", blockers) + ".");
                // Deviation must be resolved on THIS revision — re-run the engine so a
                // rule / data change since the revision was created is not missed.
                var ev = await EvaluateAsync(loan, offer.BankId, offer.ProductKey, RevDto(rev, false, null), rev.Emi, c);
                offer.LatestEvaluationJson = JsonSerializer.Serialize(ev, JsonOpts);
                offer.LatestEvaluatedAt = Now;
                var resolved = offer.DeviationStatus is S.DevApproved or S.DevSkipped;
                if (!resolved)
                {
                    if (offer.DeviationStatus != S.DevNotRequired)
                        return Fail($"Deviation is {offer.DeviationStatus} — it must be approved or skipped before credit approval.", ApiErrorCodes.DeviationUnresolved);
                    if (ev.Outcome != "NotRequired")
                    {
                        offer.DeviationStatus = S.DevRequired;
                        offer.Version++;
                        _commitOnError = true;
                        return Fail("Re-evaluation now finds a deviation for these terms (rules or application data changed). Raise or skip the deviation first.", ApiErrorCodes.DeviationUnresolved);
                    }
                }
                devRefs = await _db.OfferDeviations.Where(d => d.OfferId == offer.Id && d.RevisionNo == rev.RevisionNo
                        && (d.Status == S.RequestApproved || d.Status == S.RequestSkipped))
                    .Select(d => (object)new { d.Id, d.DeviationType, d.Status }).ToListAsync();
            }

            var approval = new CreditApproval
            {
                LoanId = loanId, OfferId = offer.Id, RevisionNo = rev.RevisionNo, BankId = offer.BankId, LenderName = offer.LenderName,
                Decision = approve ? "Approved" : "Rejected", Comment = string.IsNullOrWhiteSpace(req.Comment) ? null : req.Comment.Trim(),
                TermsSnapshotJson = JsonSerializer.Serialize(RevDto(rev, false, null), JsonOpts),
                DeviationRefsJson = JsonSerializer.Serialize(devRefs), DeviationStatusAtApproval = offer.DeviationStatus,
                ApproverUserId = c.UserId, CreatedAt = Now, IsCurrent = approve,
                IdempotencyKey = string.IsNullOrWhiteSpace(idempotencyKey) ? null : idempotencyKey,
            };
            _db.CreditApprovals.Add(approval);
            offer.ApprovalStatus = approve ? S.ApprovalApproved : S.ApprovalRejected;
            offer.Version++; offer.UpdatedAt = Now; offer.UpdatedByUserId = c.UserId;

            if (approve)
            {
                loan.ApprovedAt = Now;
                loan.ApprovedAmount = rev.LoanAmount;
                loan.InterestRate = rev.OfferedRoi;
                loan.TenureMonths = rev.TenureMonths;
                loan.MonthlyEmi = rev.Emi;
                Transition(loan, LoanStatus.Approved, $"Credit approval — {offer.LenderName} rev {rev.RevisionNo}. {req.Comment}".Trim(), c.UserId);
                notifyApproved = true;
            }
            Timeline(loanId, approve ? "EFIN-Approved" : "EFIN-Credit Rejected",
                approve ? $"Credit approval given for {offer.LenderName} (rev {rev.RevisionNo})" : $"Credit approval declined for {offer.LenderName}: {req.Comment?.Trim()}",
                TermsLine(rev), c);
            Audit("Loan", loanId, approve ? "CreditApproved" : "CreditRejected", null, new { offer.LenderName, Rev = rev.RevisionNo, offer.DeviationStatus }, req.Comment, c);
            return null;
        }, afterCommit: async () =>
        {
            if (notifyApproved)
                await _sp.GetRequiredService<ILoanService>().NotifyStageChangeAsync(loanId, LoanStatus.Approved, req.Comment);
        });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Sanction
    // ═════════════════════════════════════════════════════════════════════════
    public async Task<ApiResponseDto<LoanWorkflowDto>> GenerateSanctionAsync(int loanId, string? idempotencyKey, WorkflowCaller c)
    {
        if (!await InScopeAsync(loanId, c.UserId, c.Role)) return NotFound();
        if (!string.IsNullOrWhiteSpace(idempotencyKey))
        {
            var prior = await _db.Sanctions.AsNoTracking().FirstOrDefaultAsync(s => s.IdempotencyKey == idempotencyKey);
            if (prior != null)
                return prior.LoanId == loanId ? await GetAsync(loanId, c) : Invalid("Idempotency key already used for another application.");
        }
        if (!Is(c.Role, AuthorityRoles)) return Forbidden("generate sanctions");
        return await MutateAsync(loanId, c, async loan =>
        {
            if (loan.Status != LoanStatus.Approved) return Stage($"A sanction is generated after credit approval (this application is {loan.Status}).");
            if (await _db.Sanctions.AnyAsync(s => s.LoanId == loanId && s.Status == S.SanctionActive))
                return Stage("This application already has an active sanction.");
            await ExpireOffersAsync(loanId, c);
            var offer = await _db.ApplicationOffers.Include(o => o.Revisions).FirstOrDefaultAsync(o => o.LoanId == loanId && o.Status == S.OfferFinal);
            if (offer == null) return Stage("No valid final offer — it may have expired or been withdrawn.");
            var approval = await _db.CreditApprovals.Where(a => a.OfferId == offer.Id && a.IsCurrent && a.Decision == "Approved")
                .OrderByDescending(a => a.Id).FirstOrDefaultAsync();
            if (approval == null || approval.RevisionNo != offer.CurrentRevisionNo || offer.ApprovalStatus != S.ApprovalApproved)
                return Stage("The final offer's current terms are not credit-approved.");
            if (offer.DeviationStatus is not (S.DevNotRequired or S.DevApproved or S.DevSkipped))
                return Fail("Deviation is not resolved.", ApiErrorCodes.DeviationUnresolved);
            var rev = offer.Revisions.First(r => r.RevisionNo == offer.CurrentRevisionNo);
            var previous = await _db.Sanctions.Where(s => s.LoanId == loanId).OrderByDescending(s => s.SanctionVersion).FirstOrDefaultAsync();
            var version = (previous?.SanctionVersion ?? 0) + 1;
            var devRefs = await _db.OfferDeviations.Where(d => d.OfferId == offer.Id && d.RevisionNo == rev.RevisionNo
                    && (d.Status == S.RequestApproved || d.Status == S.RequestSkipped))
                .Select(d => new { d.Id, d.DeviationType, d.Status }).ToListAsync();
            var s = new Sanction
            {
                LoanId = loanId, SanctionNumber = $"SAN-{loan.LoanNumber}-{version:D2}", SanctionVersion = version,
                PreviousSanctionId = previous?.Id, OfferId = offer.Id, RevisionNo = rev.RevisionNo, CreditApprovalId = approval.Id,
                BankId = offer.BankId, LenderName = offer.LenderName, LoanAmount = rev.LoanAmount, TenureMonths = rev.TenureMonths,
                Roi = rev.OfferedRoi, Emi = rev.Emi, ProcessingFeePct = rev.ProcessingFeePct, ProcessingFeeAmount = rev.ProcessingFeeAmount,
                GstPct = rev.GstPct, GstAmount = rev.GstAmount, InsuranceAmount = rev.InsuranceAmount, BtAmount = rev.BtAmount,
                StampDuty = rev.StampDuty, FinancedPrincipal = rev.FinancedPrincipal, NetDisbursement = rev.NetDisbursement,
                DeviationRefsJson = JsonSerializer.Serialize(devRefs), Status = S.SanctionActive,
                GeneratedByUserId = c.UserId, GeneratedAt = Now,
                IdempotencyKey = string.IsNullOrWhiteSpace(idempotencyKey) ? null : idempotencyKey,
            };
            _db.Sanctions.Add(s);
            await SyncSanctionDetailAsync(loan, rev);
            Timeline(loanId, "EFIN-Sanction Generated", $"Sanction {s.SanctionNumber} generated — {offer.LenderName}", TermsLine(rev), c);
            Audit("Loan", loanId, "SanctionGenerated", null, new { s.SanctionNumber, s.LenderName, s.LoanAmount, s.Roi, s.TenureMonths, s.Emi, s.NetDisbursement }, null, c);
            return null;
        });
    }

    /// <summary>Keeps the existing Overview "Approval Details" panel (LoanSanctionDetail)
    /// showing the sanctioned figures — it is display-only while a sanction is active.</summary>
    private async Task SyncSanctionDetailAsync(Loan loan, ApplicationOfferRevision rev)
    {
        var sd = await _db.LoanSanctionDetails.FirstOrDefaultAsync(x => x.LoanId == loan.Id);
        if (sd == null) { sd = new LoanSanctionDetail { LoanId = loan.Id }; _db.LoanSanctionDetails.Add(sd); }
        sd.SanctionLoanAmt = rev.LoanAmount; sd.SanctionTenureMonths = rev.TenureMonths; sd.SanctionRoi = rev.OfferedRoi; sd.SanctionEmi = rev.Emi;
        sd.StampDuty = rev.StampDuty.ToString("0.##"); sd.Gst = rev.GstPct; sd.Insurance = rev.InsuranceAmount; sd.PfPercent = rev.ProcessingFeePct;
        sd.PfInBundled = rev.PfInBundled; sd.InsuranceInBundled = rev.InsuranceInBundled;
        sd.IsBundled = rev.PfInBundled || rev.InsuranceInBundled; sd.IsBt = rev.BtAmount > 0;
        sd.UpdatedAt = Now;
    }

    public async Task<ApiResponseDto<LoanWorkflowDto>> CancelSanctionAsync(int loanId, int sanctionId, CancelSanctionRequestDto req, WorkflowCaller c)
    {
        if (!await InScopeAsync(loanId, c.UserId, c.Role)) return NotFound();
        if (!Is(c.Role, AuthorityRoles)) return Forbidden("cancel or revoke sanctions");
        if (string.IsNullOrWhiteSpace(req.Reason)) return Invalid("A reason is required to cancel / revoke a sanction.");
        if (!CancellationTypes.Contains(req.CancellationType)) return Invalid("Cancellation type must be Cancel, Revoke or Amendment.");
        return await MutateAsync(loanId, c, async loan =>
        {
            var s = await _db.Sanctions.FirstOrDefaultAsync(x => x.Id == sanctionId && x.LoanId == loanId);
            if (s == null) return Fail("Sanction not found.", ApiErrorCodes.NotFound);
            if (s.Status != S.SanctionActive) return Stage($"This sanction is already {s.Status}.");
            if (await _db.Disbursements.AnyAsync(d => d.LoanId == loanId && d.Type == S.TypeDisbursement && d.Status == S.DisbursementCompleted))
                return Stage("This sanction has been disbursed — reverse the disbursement before cancelling it.");
            if (loan.Status is not (LoanStatus.Approved or LoanStatus.Acceptance))
                return Stage($"A sanction can be cancelled while the application is Approved or Acceptance (it is {loan.Status}).");
            s.Status = S.SanctionCancelled; s.CancellationType = req.CancellationType; s.CancelReason = req.Reason.Trim();
            s.CancelledByUserId = c.UserId; s.CancelledAt = Now;
            // Downstream: the credit approval behind it is no longer current and the
            // application returns to Offer (re-approval → new sanction version).
            var offer = await _db.ApplicationOffers.FirstAsync(o => o.Id == s.OfferId);
            await InvalidateApprovalsAsync(offer.Id);
            offer.ApprovalStatus = S.ApprovalPending;
            offer.Version++; offer.UpdatedAt = Now; offer.UpdatedByUserId = c.UserId;
            Transition(loan, LoanStatus.Offer, $"[SANCTION {req.CancellationType.ToUpperInvariant()}] {s.SanctionNumber}: {req.Reason.Trim()}", c.UserId);
            Timeline(loanId, $"EFIN-Sanction {(req.CancellationType == "Revoke" ? "Revoked" : req.CancellationType == "Amendment" ? "Amendment" : "Cancelled")}",
                $"Sanction {s.SanctionNumber} {req.CancellationType.ToLowerInvariant()}: {req.Reason.Trim()}",
                "Application back at Offer — credit approval and a new sanction are required.", c);
            Audit("Sanction", s.Id, "Cancelled", new { Status = S.SanctionActive }, new { s.Status, s.CancellationType }, req.Reason, c);
            return null;
        });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Disbursement
    // ═════════════════════════════════════════════════════════════════════════
    public async Task<ApiResponseDto<LoanWorkflowDto>> CreateDisbursementAsync(int loanId, CreateDisbursementRequestDto req, string? idempotencyKey, WorkflowCaller c)
    {
        if (!await InScopeAsync(loanId, c.UserId, c.Role)) return NotFound();
        if (!string.IsNullOrWhiteSpace(idempotencyKey))
        {
            var prior = await _db.Disbursements.AsNoTracking().FirstOrDefaultAsync(d => d.IdempotencyKey == idempotencyKey);
            if (prior != null)
                return prior.LoanId == loanId ? await GetAsync(loanId, c) : Invalid("Idempotency key already used for another application.");
        }
        if (!Is(c.Role, AuthorityRoles) || !await AllowedAsync(c.Role, "canDisburse")) return Forbidden("disburse");
        var errors = new List<string>();
        if (req.Amount <= 0) errors.Add("Disbursement amount must be greater than 0.");
        if (req.Amount * 100m != Math.Truncate(req.Amount * 100m)) errors.Add("Amount allows at most 2 decimal places.");
        var acct = (req.BankAccountNumber ?? "").Replace(" ", "");
        if (!System.Text.RegularExpressions.Regex.IsMatch(acct, "^[0-9]{6,18}$")) errors.Add("Bank account number must be 6–18 digits.");
        var ifsc = (req.Ifsc ?? "").Trim().ToUpperInvariant();
        if (!System.Text.RegularExpressions.Regex.IsMatch(ifsc, "^[A-Z]{4}0[A-Z0-9]{6}$")) errors.Add("IFSC must be 11 characters (e.g. HDFC0001234).");
        if (string.IsNullOrWhiteSpace(req.Utr) || req.Utr.Trim().Length < 6) errors.Add("UTR / transaction reference is required.");
        if (!DisbursementModes.Contains(req.Mode)) errors.Add("Mode must be NEFT, RTGS, IMPS, Cheque or Other.");
        if (req.DisbursementDate == default) errors.Add("Disbursement date is required.");
        else if (req.DisbursementDate.Date > Now.Date.AddDays(1)) errors.Add("Disbursement date cannot be in the future.");
        if (errors.Count > 0) return Invalid(string.Join(" ", errors));

        return await MutateAsync(loanId, c, async loan =>
        {
            if (loan.Status is not (LoanStatus.Approved or LoanStatus.Acceptance))
                return Stage($"Disbursement needs an Approved / Acceptance application (this one is {loan.Status}).");
            var s = await _db.Sanctions.FirstOrDefaultAsync(x => x.LoanId == loanId && x.Status == S.SanctionActive);
            if (s == null) return Stage("No active sanction — generate the sanction before disbursing.");
            if (await _db.Disbursements.AnyAsync(d => d.LoanId == loanId && d.Type == S.TypeDisbursement && d.Status == S.DisbursementCompleted))
                return Stage("This application has already been disbursed.");
            var offer = await _db.ApplicationOffers.FirstAsync(o => o.Id == s.OfferId);
            if (offer.Status != S.OfferFinal || offer.BankId != s.BankId) return Stage("The sanctioned lender no longer matches the final offer.");
            if (req.Amount > s.NetDisbursement)
                return Invalid($"Amount {Inr(req.Amount)} exceeds the sanctioned net disbursement {Inr(s.NetDisbursement)}.");
            var gate = LoanService.DisbursementGateError(loan);
            if (gate != null) return Stage(gate);
            var bankError = await VerifiedBankDetailsErrorAsync(loanId, acct, ifsc);
            if (bankError != null) return Stage(bankError);

            var prevStatus = loan.Status;
            _db.Disbursements.Add(new Disbursement
            {
                LoanId = loanId, SanctionId = s.Id, Type = S.TypeDisbursement, Amount = req.Amount,
                DisbursementDate = DateTime.SpecifyKind(req.DisbursementDate.Date, DateTimeKind.Utc),
                BankAccountNumber = acct, Ifsc = ifsc, AccountHolderName = req.AccountHolderName?.Trim(),
                Utr = req.Utr.Trim(), LenderReference = req.LenderReference?.Trim(), Mode = req.Mode,
                Status = S.DisbursementCompleted, PreviousLoanStatus = prevStatus.ToString(),
                CreatedByUserId = c.UserId, CreatedAt = Now,
                IdempotencyKey = string.IsNullOrWhiteSpace(idempotencyKey) ? null : idempotencyKey,
            });
            loan.DisbursedAt = Now;
            Transition(loan, LoanStatus.Disbursed, $"Disbursed {Inr(req.Amount)} via {req.Mode}, UTR {req.Utr.Trim()} (sanction {s.SanctionNumber}).", c.UserId);
            Timeline(loanId, "EFIN-Disbursed", "Loan disbursed — funds transferred successfully",
                $"{Inr(req.Amount)} · {req.Mode} · UTR {req.Utr.Trim()} · A/c {MaskAccount(acct)} ({ifsc}) · Sanction {s.SanctionNumber}", c);
            Audit("Loan", loanId, "Disbursed", null, new { req.Amount, req.Mode, Utr = req.Utr.Trim(), s.SanctionNumber }, null, c);
            return null;
        }, afterCommit: async () =>
            await _sp.GetRequiredService<ILoanService>().NotifyStageChangeAsync(loanId, LoanStatus.Disbursed, null));
    }

    public async Task<ApiResponseDto<LoanWorkflowDto>> ReverseDisbursementAsync(int loanId, int disbursementId, ReverseDisbursementRequestDto req, WorkflowCaller c)
    {
        if (!await InScopeAsync(loanId, c.UserId, c.Role)) return NotFound();
        if (!Is(c.Role, AuthorityRoles) || !await AllowedAsync(c.Role, "canDisburse")) return Forbidden("reverse disbursements");
        if (string.IsNullOrWhiteSpace(req.Reason)) return Invalid("A reason is required to reverse a disbursement.");
        return await MutateAsync(loanId, c, async loan =>
        {
            var d = await _db.Disbursements.FirstOrDefaultAsync(x => x.Id == disbursementId && x.LoanId == loanId);
            if (d == null) return Fail("Disbursement not found.", ApiErrorCodes.NotFound);
            if (d.Type != S.TypeDisbursement || d.Status != S.DisbursementCompleted) return Stage("Only a completed disbursement can be reversed.");
            if (loan.Status != LoanStatus.Disbursed) return Stage($"The application is {loan.Status}; only a Disbursed application can be reversed.");
            d.Status = S.DisbursementReversed;
            _db.Disbursements.Add(new Disbursement
            {
                LoanId = loanId, SanctionId = d.SanctionId, Type = S.TypeReversal, ReversalOfId = d.Id, Amount = d.Amount,
                DisbursementDate = Now.Date, BankAccountNumber = d.BankAccountNumber, Ifsc = d.Ifsc, AccountHolderName = d.AccountHolderName,
                Utr = d.Utr, LenderReference = d.LenderReference, Mode = d.Mode, Status = S.DisbursementCompleted,
                Reason = req.Reason.Trim(), CreatedByUserId = c.UserId, CreatedAt = Now,
            });
            var restore = Enum.TryParse<LoanStatus>(d.PreviousLoanStatus, out var p) && p is LoanStatus.Approved or LoanStatus.Acceptance
                ? p : LoanStatus.Approved;
            loan.DisbursedAt = null;
            Transition(loan, restore, $"[DISBURSEMENT REVERSED] {Inr(d.Amount)} UTR {d.Utr}: {req.Reason.Trim()}", c.UserId);
            Timeline(loanId, "EFIN-Disbursement Reversed", $"Disbursement of {Inr(d.Amount)} (UTR {d.Utr}) reversed: {req.Reason.Trim()}",
                $"Application back to {restore}.", c);
            Audit("Disbursement", d.Id, "Reversed", new { Status = S.DisbursementCompleted }, new { d.Status }, req.Reason, c);
            return null;
        });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Hooks used by LoanService (reject / reopen / override / acceptance gate)
    // ═════════════════════════════════════════════════════════════════════════
    public Task<bool> HasActiveSanctionAsync(int loanId) =>
        _db.Sanctions.AnyAsync(s => s.LoanId == loanId && s.Status == S.SanctionActive);

    public Task<bool> HasCompletedDisbursementAsync(int loanId) =>
        _db.Disbursements.AnyAsync(d => d.LoanId == loanId && d.Type == S.TypeDisbursement && d.Status == S.DisbursementCompleted);

    public Task<bool> HasTimelineEntryAsync(int loanId, string entryName) =>
        _db.TrackingEntries.AnyAsync(t => t.LoanId == loanId && t.Name == entryName);

    public async Task<string?> AcceptanceFiBlockerAsync(int loanId)
    {
        // Only entries carrying the result lines are the FI report; the system
        // follow-up note shares the name "EFIN- FI report" but has no results, so
        // "latest entry" must mean the latest REPORT (else a Pending FI slipped
        // through behind its own follow-up note).
        var subNotes = await _db.TrackingEntries
            .Where(t => t.LoanId == loanId && t.Name == LoanMS.Application.Services.VerificationChecks.FiReport.EntryName)
            .OrderByDescending(t => t.CreatedAt).ThenByDescending(t => t.Id)
            .Select(t => t.SubNote).ToListAsync();
        foreach (var note in subNotes)
        {
            var (resi, office) = LoanMS.Application.Services.VerificationChecks.ParseFiResult(note);
            if (resi == null && office == null) continue;
            static bool Bad(string? r) => string.Equals(r, "Negative", StringComparison.OrdinalIgnoreCase)
                                       || string.Equals(r, "Pending", StringComparison.OrdinalIgnoreCase);
            return Bad(resi) || Bad(office)
                ? "Cannot move to Acceptance — EFIN FI Report results must not be Negative or Pending."
                : null;
        }
        return "Cannot move to Acceptance — EFIN FI Report must be completed first.";
    }

    public async Task OnApplicationRejectedAsync(int loanId, int userId, string? reason)
    {
        var why = "Application rejected" + (string.IsNullOrWhiteSpace(reason) ? "." : $": {reason!.Trim()}");
        foreach (var o in await _db.ApplicationOffers.Where(o => o.LoanId == loanId).ToListAsync())
        {
            await CloseOpenDeviationsAsync(o.Id, why);
            await InvalidateApprovalsAsync(o.Id);
            if (o.DeviationStatus == S.DevRaised) o.DeviationStatus = S.DevRequired;
            if (o.ApprovalStatus == S.ApprovalApproved) o.ApprovalStatus = S.ApprovalPending;
            o.Version++;
        }
        foreach (var s in await _db.Sanctions.Where(s => s.LoanId == loanId && s.Status == S.SanctionActive).ToListAsync())
        {
            s.Status = S.SanctionCancelled; s.CancellationType = "Cancel"; s.CancelReason = why;
            s.CancelledByUserId = userId; s.CancelledAt = Now;
        }
        // Related tasks close with the application (history kept).
        foreach (var t in await _db.Tasks.Where(t => t.LoanId == loanId && !t.IsCompleted).ToListAsync())
        {
            t.IsCompleted = true; t.PausedAt = null; t.PauseReason = null; t.UpdatedAt = Now;
            t.Description = (t.Description ?? "") + $"\n[Closed] {why}";
        }
    }

    public async Task OnApplicationHeldAsync(int loanId, string? reason)
    {
        foreach (var t in await _db.Tasks.Where(t => t.LoanId == loanId && !t.IsCompleted && t.PausedAt == null).ToListAsync())
        {
            t.PausedAt = Now;
            t.PauseReason = ("Application on hold" + (string.IsNullOrWhiteSpace(reason) ? "" : $": {reason!.Trim()}")) is var r && r.Length > 500 ? r[..500] : r;
            t.UpdatedAt = Now;
        }
    }

    public async Task OnApplicationUnheldAsync(int loanId)
    {
        foreach (var t in await _db.Tasks.Where(t => t.LoanId == loanId && t.PausedAt != null).ToListAsync())
        {
            t.PausedAt = null; t.PauseReason = null; t.UpdatedAt = Now;
        }
    }

    public async Task OnApplicationReopenedAsync(int loanId, int userId)
    {
        foreach (var o in await _db.ApplicationOffers.Include(o => o.Revisions).Where(o => o.LoanId == loanId).ToListAsync())
        {
            o.ApprovalStatus = S.ApprovalPending;
            if (o.DeviationStatus is S.DevRaised) o.DeviationStatus = S.DevRequired;
            o.Version++;
        }
    }


    // ═════════════════════════════════════════════════════════════════════════
    // Re-evaluation (rules changed / bureau report uploaded / on demand)
    // ═════════════════════════════════════════════════════════════════════════
    /// <summary>Re-run the rule engine on the current revision of every live offer
    /// whose deviation is still open (Required / NotRequired) while the application
    /// is at the Offer stage. The revision's own snapshot is kept; the latest result
    /// is stored on the offer. Stages its changes; the caller saves.</summary>
    private async Task<int> ReEvaluateLoanOffersAsync(Loan loan, WorkflowCaller c, string trigger, int? bankId = null)
    {
        if (loan.Status != LoanStatus.Offer) return 0;
        var offers = await _db.ApplicationOffers.Include(o => o.Revisions)
            .Where(o => o.LoanId == loan.Id && S.ActiveOfferStatuses.Contains(o.Status)
                        && (o.DeviationStatus == S.DevRequired || o.DeviationStatus == S.DevNotRequired)
                        && (bankId == null || o.BankId == bankId))
            .ToListAsync();
        var changed = 0;
        foreach (var o in offers)
        {
            var rev = o.Revisions.First(r => r.RevisionNo == o.CurrentRevisionNo);
            var ev = await EvaluateAsync(loan, o.BankId, o.ProductKey, RevDto(rev, false, null), rev.Emi, c);
            o.LatestEvaluationJson = JsonSerializer.Serialize(ev, JsonOpts);
            o.LatestEvaluatedAt = Now;
            var status = DeviationStatusFromEvaluation(ev.Outcome);
            if (status != o.DeviationStatus)
            {
                Timeline(loan.Id, "EFIN-Deviation Re-evaluated", $"{o.LenderName}: deviation {o.DeviationStatus} → {status} ({trigger}).", " ", c);
                o.DeviationStatus = status;
                o.Version++; // only an outcome change invalidates what a user is looking at
                changed++;
            }
            o.UpdatedAt = Now;
        }
        return changed;
    }

    public async Task<ApiResponseDto<LoanWorkflowDto>> ReEvaluateAsync(int loanId, WorkflowCaller c)
    {
        if (!await InScopeAsync(loanId, c.UserId, c.Role)) return NotFound();
        if (!Is(c.Role, OfferMakerRoles) && !Is(c.Role, AuthorityRoles)) return Forbidden("re-check deviations");
        return await MutateAsync(loanId, c, async loan =>
        {
            if (loan.Status != LoanStatus.Offer) return Stage($"Deviation re-check runs at the Offer stage (this application is {loan.Status}).");
            await ExpireOffersAsync(loanId, c);
            await ReEvaluateLoanOffersAsync(loan, c, "manual re-check");
            return null;
        });
    }

    /// <summary>Re-evaluate Offer-stage applications that have live offers from this lender
    /// (after a rule of that lender changed). Each application in its own transaction.</summary>
    private async Task ReEvaluateForBankAsync(int bankId, WorkflowCaller c)
    {
        var loanIds = await _db.ApplicationOffers.AsNoTracking()
            .Where(o => o.BankId == bankId && S.ActiveOfferStatuses.Contains(o.Status) && o.Loan.Status == LoanStatus.Offer)
            .Select(o => o.LoanId).Distinct().ToListAsync();
        var system = c with { Role = "Admin" };
        foreach (var loanId in loanIds)
        {
            try
            {
                _db.ChangeTracker.Clear();
                if (_db.Database.IsRelational() && _db.Database.CurrentTransaction == null)
                {
                    var strategy = _db.Database.CreateExecutionStrategy();
                    await strategy.ExecuteAsync(async () =>
                    {
                        _db.ChangeTracker.Clear();
                        await using var tx = await _db.Database.BeginTransactionAsync();
                        await RunReEvalAsync(loanId, bankId, system);
                        await tx.CommitAsync();
                    });
                }
                else await RunReEvalAsync(loanId, bankId, system);
            }
            catch (DbUpdateException) { /* a concurrent action on that application wins; the next read re-evaluates */ }
            _db.ChangeTracker.Clear();
        }
    }

    private async Task RunReEvalAsync(int loanId, int bankId, WorkflowCaller c)
    {
        if (_db.Database.IsNpgsql())
            await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT 1 FROM \"Loans\" WHERE \"Id\" = {loanId} FOR UPDATE");
        var loan = await _db.Loans.Include(l => l.Customer).FirstOrDefaultAsync(l => l.Id == loanId);
        if (loan == null) return;
        await ReEvaluateLoanOffersAsync(loan, c with { Role = "System" }, "deviation rule changed", bankId);
        await _db.SaveChangesAsync();
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Bureau (CIBIL) report upload — the only CIBIL source the rules trust
    // ═════════════════════════════════════════════════════════════════════════
    private static readonly string[] BureauFileExtensions = { ".pdf", ".png", ".jpg", ".jpeg" };
    private const long MaxBureauFileBytes = 10 * 1024 * 1024;

    public async Task<ApiResponseDto<LoanWorkflowDto>> UploadBureauReportAsync(int loanId, BureauReportUpload u, WorkflowCaller c)
    {
        if (!await InScopeAsync(loanId, c.UserId, c.Role)) return NotFound();
        if (!Is(c.Role, AuthorityRoles))
            return Forbidden("upload bureau reports (Chief Administrator, Zonal Manager, Credit Evaluation Manager or Credit Evaluation Officer only)");
        var errors = new List<string>();
        if (u.CreditScore < 300 || u.CreditScore > 900) errors.Add("Credit score must be between 300 and 900.");
        if (!BureauProviders.Contains(u.BureauProvider)) errors.Add("Bureau must be one of: " + string.Join(", ", BureauProviders) + ".");
        if (u.ReportDate == default) errors.Add("Report date is required.");
        else if (u.ReportDate.Date > Now.Date) errors.Add("Report date cannot be in the future.");
        var ext = Path.GetExtension(u.FileName ?? "").ToLowerInvariant();
        if (u.Length <= 0) errors.Add("The bureau report file is required.");
        else if (u.Length > MaxBureauFileBytes) errors.Add("The report file must be 10 MB or smaller.");
        if (!BureauFileExtensions.Contains(ext)) errors.Add("The report must be a PDF, PNG or JPG file.");
        byte[] bytes = Array.Empty<byte>();
        if (errors.Count == 0)
        {
            using var ms = new MemoryStream();
            await u.Content.CopyToAsync(ms);
            bytes = ms.ToArray();
            var magicOk = ext == ".pdf" ? bytes.Length > 4 && bytes[0] == 0x25 && bytes[1] == 0x50 && bytes[2] == 0x44 && bytes[3] == 0x46
                        : ext == ".png" ? bytes.Length > 4 && bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47
                        : bytes.Length > 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF;
            if (!magicOk) errors.Add("The file content does not match its type.");
        }
        if (errors.Count > 0) return Invalid(string.Join(" ", errors));

        var storedName = $"bureau_{Guid.NewGuid():N}{ext}";
        var storage = _sp.GetRequiredService<IFileStorageService>();
        await storage.SaveAsync(DocumentStorageKeys.ForLoanDocument($"{loanId}/{storedName}"), new MemoryStream(bytes),
            string.IsNullOrWhiteSpace(u.ContentType) ? "application/octet-stream" : u.ContentType);

        var result = await MutateAsync(loanId, c, async loan =>
        {
            if (loan.Status is LoanStatus.Rejected or LoanStatus.Closed or LoanStatus.Disbursed or LoanStatus.Draft)
                return Stage($"A bureau report cannot be added to a {loan.Status} application.");
            var customer = loan.Customer;
            foreach (var old in await _db.BureauReports.Where(b => b.CustomerId == loan.CustomerId && b.IsActive).ToListAsync())
            {
                old.IsActive = false; old.UpdatedAt = Now;
            }
            var reportDate = DateTime.SpecifyKind(u.ReportDate.Date, DateTimeKind.Utc);
            _db.LoanDocuments.Add(new LoanDocument
            {
                LoanId = loanId, DocumentName = Path.GetFileNameWithoutExtension(u.FileName) ?? "Bureau report",
                DocumentType = "Bureau Report", FilePath = $"{loanId}/{storedName}", FileSizeBytes = bytes.Length,
                UploadedByUserId = c.UserId.ToString(), CreatedAt = Now,
            });
            _db.BureauReports.Add(new BureauReport
            {
                CustomerId = loan.CustomerId, BureauProvider = u.BureauProvider, CreditScore = u.CreditScore,
                ScoreGeneratedDate = reportDate, IsLiveScore = false, FullName = customer?.FullName ?? "",
                PAN = customer?.PanNumber ?? "", DateOfBirth = customer?.DateOfBirth ?? reportDate,
                OldestAccountDate = reportDate, LatestAccountDate = reportDate,
                SourceFile = $"{loanId}/{storedName}", UploadedByUserId = c.UserId, IsActive = true,
                CreatedAt = Now, UpdatedAt = Now,
            });
            Timeline(loanId, "EFIN-Bureau Report Uploaded", $"{u.BureauProvider} report uploaded — score {u.CreditScore} (dated {reportDate:dd-MMM-yyyy}).", " ", c);
            Audit("Loan", loanId, "BureauReportUploaded", null, new { u.BureauProvider, u.CreditScore, ReportDate = reportDate, File = storedName }, null, c);
            await _db.SaveChangesAsync();
            await ReEvaluateLoanOffersAsync(loan, c, "bureau report uploaded");
            return null;
        });
        if (!result.Success)
        {
            try { await storage.DeleteAsync(DocumentStorageKeys.ForLoanDocument($"{loanId}/{storedName}")); } catch { /* best effort */ }
        }
        return result;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Deviation approver reassignment (inactive / unavailable approver)
    // ═════════════════════════════════════════════════════════════════════════
    private async Task<List<User>> EligibleApproverUsersAsync(int loanId, int raiserId)
    {
        var roles = new[] { UserRole.Admin, UserRole.LocationHead, UserRole.OperationManager, UserRole.LoginTeam };
        var users = await _db.Users.Where(u => u.IsActive && u.Id != raiserId && roles.Contains(u.Role)).OrderBy(u => u.FullName).ToListAsync();
        var result = new List<User>();
        foreach (var u in users)
            if (await LoanRepository.ApplyVisibilityScope(_db, _db.Loans, u.Id, u.Role.ToString()).AnyAsync(l => l.Id == loanId))
                result.Add(u);
        return result;
    }

    public async Task<ApiResponseDto<List<EligibleApproverDto>>> EligibleApproversAsync(int loanId, int deviationId, WorkflowCaller c)
    {
        if (!await InScopeAsync(loanId, c.UserId, c.Role)) return ApiResponseDto<List<EligibleApproverDto>>.Fail("Loan not found.", ApiErrorCodes.NotFound);
        if (!Is(c.Role, AuthorityRoles)) return ApiResponseDto<List<EligibleApproverDto>>.Fail("You do not have permission to reassign deviations.", ApiErrorCodes.Forbidden);
        var dev = await _db.OfferDeviations.AsNoTracking().FirstOrDefaultAsync(d => d.Id == deviationId && d.LoanId == loanId);
        if (dev == null) return ApiResponseDto<List<EligibleApproverDto>>.Fail("Deviation request not found.", ApiErrorCodes.NotFound);
        var users = await EligibleApproverUsersAsync(loanId, dev.RaisedByUserId);
        return ApiResponseDto<List<EligibleApproverDto>>.Ok(users
            .Select(u => new EligibleApproverDto { UserId = u.Id, Name = u.FullName, RoleTitle = RoleTitle(u.Role.ToString()) }).ToList());
    }

    public async Task<ApiResponseDto<LoanWorkflowDto>> ReassignDeviationAsync(int loanId, int deviationId, ReassignDeviationRequestDto req, WorkflowCaller c)
    {
        if (!await InScopeAsync(loanId, c.UserId, c.Role)) return NotFound();
        if (!Is(c.Role, AuthorityRoles)) return Forbidden("reassign deviations");
        if (string.IsNullOrWhiteSpace(req.Reason)) return Invalid("A reason is required to reassign the approver.");
        User? target = null;
        var result = await MutateAsync(loanId, c, async loan =>
        {
            var dev = await _db.OfferDeviations.FirstOrDefaultAsync(d => d.Id == deviationId && d.LoanId == loanId);
            if (dev == null) return Fail("Deviation request not found.", ApiErrorCodes.NotFound);
            if (dev.Status != S.RequestRaised) return Stage($"This deviation request is already {dev.Status}.");
            if (dev.AssignedApproverId == req.ApproverUserId) return Invalid("That user is already the assigned approver.");
            var eligible = await EligibleApproverUsersAsync(loanId, dev.RaisedByUserId);
            target = eligible.FirstOrDefault(u => u.Id == req.ApproverUserId);
            if (target == null)
                return Invalid("The selected user is not an eligible approver (active Chief Administrator, Zonal Manager or Credit Evaluation Manager / Officer with access, and not the raiser).");
            var from = dev.AssignedApproverId;
            if (dev.TaskId is int tid && await _db.Tasks.FindAsync(tid) is { } oldTask && !oldTask.IsCompleted)
            {
                oldTask.IsCompleted = true; oldTask.UpdatedAt = Now;
                oldTask.Description = (oldTask.Description ?? "") + $"\n[Reassigned to {target.FullName}] {req.Reason.Trim()}";
            }
            var task = new LoanTask
            {
                LoanId = loanId, Title = $"Deviation approval — {loan.LoanNumber}",
                Description = $"{dev.DeviationType} deviation reassigned by {c.Name ?? RoleTitle(c.Role)}: {req.Reason.Trim()}",
                Priority = "High", AssignedToUserId = target.Id, CreatedByUserId = c.UserId, DueDate = Now.AddDays(1),
            };
            _db.Tasks.Add(task);
            await _db.SaveChangesAsync();
            dev.TaskId = task.Id;
            dev.AssignedApproverId = target.Id;
            dev.AssignmentState = "Reassigned";
            Timeline(loanId, "EFIN-Deviation Reassigned", $"Deviation approver changed to {target.FullName}: {req.Reason.Trim()}", " ", c);
            Audit("OfferDeviation", dev.Id, "Reassigned", new { AssignedApproverId = from }, new { AssignedApproverId = target.Id }, req.Reason, c);
            _db.AppNotifications.Add(new AppNotification
            {
                Type = "deviation_raised", Icon = "⚠️", TargetUserId = target.Id,
                Message = $"Deviation on application #{loanId} reassigned to you — awaiting your approval.",
            });
            return null;
        }, afterCommit: async () => { if (target != null) await EmailApproverAsync(target.Id, loanId, "Deviation approval reassigned to you"); });
        return result;
    }

    /// <summary>Internal notification email to an approver through the existing
    /// email service (non-fatal: an unconfigured mail provider never blocks the action).</summary>
    private async Task EmailApproverAsync(int? approverId, int loanId, string subject)
    {
        if (approverId == null) return;
        var email = _sp.GetService<IEmailService>();
        if (email == null) return;
        try
        {
            var u = await _db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == approverId);
            var loanNo = await _db.Loans.AsNoTracking().Where(l => l.Id == loanId).Select(l => l.LoanNumber).FirstOrDefaultAsync();
            if (u == null || string.IsNullOrWhiteSpace(u.Email)) return;
            await email.SendAsync(u.Email, u.FullName, $"{subject} — {loanNo}",
                $"<p>Dear {System.Net.WebUtility.HtmlEncode(u.FullName)},</p><p>A deviation on application <strong>{loanNo}</strong> is awaiting your decision. "
                + "Open the application's <strong>Offers</strong> tab in LoanMS to review it.</p>");
        }
        catch { /* non-fatal */ }
    }

    /// <summary>The disbursement account must be one the Bank Details Check verified
    /// ("Okay to Process"). Null = OK.</summary>
    private async Task<string?> VerifiedBankDetailsErrorAsync(int loanId, string acct, string ifsc)
    {
        var checks = await _db.TrackingEntries.AsNoTracking()
            .Where(t => t.LoanId == loanId && t.Name == "EFIN- Bank Details Check" && t.SubNote != null)
            .OrderBy(t => t.Id).Select(t => t.SubNote!).ToListAsync();
        static string? Field(string note, string label) => note.Split('\n')
            .Select(l => l.Trim()).FirstOrDefault(l => l.StartsWith(label + ":", StringComparison.OrdinalIgnoreCase))?[(label.Length + 1)..].Trim();
        // The LATEST check of each account decides: a later "Not Okay" on the same account revokes an earlier "Okay".
        var latestPerAccount = checks
            .Select(n => (Acct: new string((Field(n, "Account Number") ?? "").Where(char.IsDigit).ToArray()),
                          Ifsc: (Field(n, "IFSC Code") ?? "").Trim().ToUpperInvariant(),
                          Ok: (Field(n, "Result") ?? "").StartsWith("Okay", StringComparison.OrdinalIgnoreCase)))
            .Where(x => x.Acct.Length > 0)
            .GroupBy(x => x.Acct).Select(g => g.Last()).ToList();
        var verified = latestPerAccount.Where(x => x.Ok).ToList();
        if (verified.Count == 0)
            return "Bank details are not verified — complete the Bank Details Check with result 'Okay to Process' before disbursing.";
        if (!verified.Any(v => v.Acct == acct && (v.Ifsc.Length == 0 || v.Ifsc == ifsc)))
            return "The disbursement account / IFSC does not match the bank details verified in the Bank Details Check.";
        return null;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Deviation rules (Product & Risk Officer / Chief Administrator)
    // ═════════════════════════════════════════════════════════════════════════
    public async Task<ApiResponseDto<List<DeviationRuleDto>>> ListRulesAsync(int? bankId, bool includeHistory)
    {
        var q = _db.DeviationRules.AsNoTracking().Include(r => r.Bank).AsQueryable();
        if (bankId != null) q = q.Where(r => r.BankId == bankId);
        var rules = await q.OrderBy(r => r.Bank.BankName).ThenBy(r => r.DeviationType).ThenBy(r => r.RuleKey).ThenByDescending(r => r.Version).ToListAsync();
        var latest = rules.GroupBy(r => r.RuleKey).ToDictionary(g => g.Key, g => g.Max(r => r.Version));
        if (!includeHistory) rules = rules.Where(r => r.Version == latest[r.RuleKey]).ToList();
        var ids = rules.Select(r => r.CreatedByUserId).Distinct().ToList();
        var names = await _db.Users.IgnoreQueryFilters().Where(u => ids.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.FullName);
        return ApiResponseDto<List<DeviationRuleDto>>.Ok(rules.Select(r => RuleDto(r, latest[r.RuleKey] == r.Version, names.GetValueOrDefault(r.CreatedByUserId))).ToList());
    }

    private static DeviationRuleDto RuleDto(DeviationRule r, bool isLatest, string? by) => new()
    {
        Id = r.Id, RuleKey = r.RuleKey, Version = r.Version, Name = r.Name, BankId = r.BankId, BankName = r.Bank?.BankName,
        ProductKey = r.ProductKey, LoanType = r.LoanType, DeviationType = r.DeviationType, Metric = r.Metric,
        Unit = DeviationRuleEngine.UnitOf(r.Metric), LimitValue = r.LimitValue, MaxApprovableDeviation = r.MaxApprovableDeviation,
        Conditions = DeviationRuleEngine.ParseConditions(r.ConditionsJson).Select(x => new DeviationRuleConditionDto { Field = x.Field, Op = x.Op, Value = x.Value }).ToList(),
        ConditionLogic = r.ConditionLogic, Priority = r.Priority, EffectiveFrom = r.EffectiveFrom, EffectiveTo = r.EffectiveTo,
        IsActive = r.IsActive, ApprovalRequired = r.ApprovalRequired, Notes = r.Notes, CreatedBy = by, CreatedAt = r.CreatedAt,
        SupersededAt = r.SupersededAt, DeactivatedAt = r.DeactivatedAt, IsLatest = isLatest,
    };

    private static DeviationRule RuleFrom(DeviationRuleRequestDto d) => new()
    {
        Name = (d.Name ?? "").Trim(), BankId = d.BankId,
        ProductKey = string.IsNullOrWhiteSpace(d.ProductKey) ? null : d.ProductKey.Trim(),
        LoanType = string.IsNullOrWhiteSpace(d.LoanType) ? null : d.LoanType.Trim(),
        DeviationType = (d.DeviationType ?? "").Trim(), Metric = (d.Metric ?? "").Trim(), LimitValue = d.LimitValue,
        MaxApprovableDeviation = d.MaxApprovableDeviation,
        ConditionsJson = JsonSerializer.Serialize(d.Conditions.Select(x => new DeviationRuleEngine.Condition { Field = x.Field?.Trim() ?? "", Op = x.Op?.Trim() ?? "", Value = x.Value?.Trim() ?? "" }).ToList()),
        ConditionLogic = string.IsNullOrWhiteSpace(d.ConditionLogic) ? "AND" : d.ConditionLogic.Trim().ToUpperInvariant(),
        Priority = d.Priority, EffectiveFrom = DateTime.SpecifyKind(d.EffectiveFrom == default ? DateTime.UtcNow.Date : d.EffectiveFrom, DateTimeKind.Utc),
        EffectiveTo = d.EffectiveTo == null ? null : DateTime.SpecifyKind(d.EffectiveTo.Value, DateTimeKind.Utc),
        ApprovalRequired = d.ApprovalRequired, Notes = d.Notes?.Trim(), IsActive = true,
    };

    public async Task<ApiResponseDto<DeviationRuleDto>> CreateRuleAsync(DeviationRuleRequestDto req, WorkflowCaller c)
    {
        if (!Is(c.Role, RuleManagerRoles)) return ApiResponseDto<DeviationRuleDto>.Fail("Only the Product & Risk Officer or Chief Administrator can manage deviation rules.", ApiErrorCodes.Forbidden);
        var rule = RuleFrom(req);
        if (!await _db.Banks.AnyAsync(b => b.Id == rule.BankId && !b.IsDeleted))
            return ApiResponseDto<DeviationRuleDto>.Fail("Lender not found.", ApiErrorCodes.Validation);
        var errors = DeviationRuleEngine.ValidateRule(rule, await _db.DeviationRules.AsNoTracking().Where(r => r.BankId == rule.BankId).ToListAsync());
        if (errors.Count > 0) return ApiResponseDto<DeviationRuleDto>.Fail(string.Join(" ", errors), ApiErrorCodes.RuleConflict);
        rule.RuleKey = Guid.NewGuid().ToString("N")[..12].ToUpperInvariant();
        rule.Version = 1; rule.CreatedByUserId = c.UserId; rule.CreatedAt = Now;
        _db.DeviationRules.Add(rule);
        await _db.SaveChangesAsync();
        Audit("DeviationRule", rule.Id, "Created", null, RuleDto(rule, true, null), req.ChangeReason, c);
        await _db.SaveChangesAsync();
        await _db.Entry(rule).Reference(r => r.Bank).LoadAsync();
        var created = RuleDto(rule, true, c.Name);
        await ReEvaluateForBankAsync(rule.BankId, c);
        return ApiResponseDto<DeviationRuleDto>.Ok(created, "Deviation rule created.");
    }

    public async Task<ApiResponseDto<DeviationRuleDto>> NewRuleVersionAsync(int ruleId, DeviationRuleRequestDto req, WorkflowCaller c)
    {
        if (!Is(c.Role, RuleManagerRoles)) return ApiResponseDto<DeviationRuleDto>.Fail("Only the Product & Risk Officer or Chief Administrator can manage deviation rules.", ApiErrorCodes.Forbidden);
        if (string.IsNullOrWhiteSpace(req.ChangeReason)) return ApiResponseDto<DeviationRuleDto>.Fail("A change reason is required for a new rule version.", ApiErrorCodes.Validation);
        var old = await _db.DeviationRules.FirstOrDefaultAsync(r => r.Id == ruleId);
        if (old == null) return ApiResponseDto<DeviationRuleDto>.Fail("Rule not found.", ApiErrorCodes.NotFound);
        var latest = await _db.DeviationRules.Where(r => r.RuleKey == old.RuleKey).MaxAsync(r => r.Version);
        if (old.Version != latest) return ApiResponseDto<DeviationRuleDto>.Fail("Only the latest version can be edited — older versions are read-only history.", ApiErrorCodes.ConcurrencyConflict);
        var rule = RuleFrom(req);
        if (rule.BankId != old.BankId) return ApiResponseDto<DeviationRuleDto>.Fail("A rule's lender cannot change — create a new rule for another lender.", ApiErrorCodes.Validation);
        rule.RuleKey = old.RuleKey;
        var errors = DeviationRuleEngine.ValidateRule(rule, await _db.DeviationRules.AsNoTracking().Where(r => r.BankId == rule.BankId).ToListAsync());
        if (errors.Count > 0) return ApiResponseDto<DeviationRuleDto>.Fail(string.Join(" ", errors), ApiErrorCodes.RuleConflict);
        rule.RuleKey = old.RuleKey; rule.Version = latest + 1; rule.CreatedByUserId = c.UserId; rule.CreatedAt = Now;
        rule.IsActive = old.IsActive;
        old.IsActive = false; old.SupersededAt = Now;
        _db.DeviationRules.Add(rule);
        Audit("DeviationRule", old.Id, "NewVersion", RuleDto(old, false, null), RuleDto(rule, true, null), req.ChangeReason, c);
        await _db.SaveChangesAsync();
        await _db.Entry(rule).Reference(r => r.Bank).LoadAsync();
        var versioned = RuleDto(rule, true, c.Name);
        var msg = $"Version {rule.Version} created; version {old.Version} retired.";
        await ReEvaluateForBankAsync(rule.BankId, c);
        return ApiResponseDto<DeviationRuleDto>.Ok(versioned, msg);
    }

    public async Task<ApiResponseDto<DeviationRuleDto>> SetRuleActiveAsync(int ruleId, bool active, string? reason, WorkflowCaller c)
    {
        if (!Is(c.Role, RuleManagerRoles)) return ApiResponseDto<DeviationRuleDto>.Fail("Only the Product & Risk Officer or Chief Administrator can manage deviation rules.", ApiErrorCodes.Forbidden);
        if (string.IsNullOrWhiteSpace(reason)) return ApiResponseDto<DeviationRuleDto>.Fail("A reason is required.", ApiErrorCodes.Validation);
        var r = await _db.DeviationRules.Include(x => x.Bank).FirstOrDefaultAsync(x => x.Id == ruleId);
        if (r == null) return ApiResponseDto<DeviationRuleDto>.Fail("Rule not found.", ApiErrorCodes.NotFound);
        if (r.SupersededAt != null) return ApiResponseDto<DeviationRuleDto>.Fail("A superseded version is read-only history.", ApiErrorCodes.WorkflowStage);
        if (r.IsActive == active) return ApiResponseDto<DeviationRuleDto>.Fail($"Rule is already {(active ? "active" : "inactive")}.", ApiErrorCodes.WorkflowStage);
        if (active)
        {
            var errors = DeviationRuleEngine.ValidateRule(r, await _db.DeviationRules.AsNoTracking().Where(x => x.BankId == r.BankId && x.Id != r.Id).ToListAsync());
            if (errors.Count > 0) return ApiResponseDto<DeviationRuleDto>.Fail(string.Join(" ", errors), ApiErrorCodes.RuleConflict);
        }
        r.IsActive = active;
        r.DeactivatedAt = active ? null : Now;
        r.DeactivatedByUserId = active ? null : c.UserId;
        Audit("DeviationRule", r.Id, active ? "Activated" : "Deactivated", new { IsActive = !active }, new { IsActive = active }, reason, c);
        await _db.SaveChangesAsync();
        var toggled = RuleDto(r, true, null);
        await ReEvaluateForBankAsync(r.BankId, c);
        return ApiResponseDto<DeviationRuleDto>.Ok(toggled, active ? "Rule activated." : "Rule deactivated.");
    }

    public async Task<ApiResponseDto<DeviationEvaluationDto>> SimulateAsync(DeviationRuleSimulationRequestDto req, WorkflowCaller c)
    {
        if (!Is(c.Role, RuleManagerRoles) && !Is(c.Role, AuthorityRoles))
            return ApiResponseDto<DeviationEvaluationDto>.Fail("You do not have permission to simulate deviation rules.", ApiErrorCodes.Forbidden);
        var terms = ValidateTerms(req);
        if (terms.Count > 0) return ApiResponseDto<DeviationEvaluationDto>.Fail(string.Join(" ", terms), ApiErrorCodes.Validation);
        var calc = OfferTermsCalculator.Calculate(CalcInput(req));
        DeviationRuleEngine.Facts facts;
        if (req.LoanId is int lid)
        {
            if (!await InScopeAsync(lid, c.UserId, c.Role)) return ApiResponseDto<DeviationEvaluationDto>.Fail("Loan not found.", ApiErrorCodes.NotFound);
            var loan = await _db.Loans.AsNoTracking().Include(l => l.Customer).FirstAsync(l => l.Id == lid);
            facts = await BuildFactsAsync(loan, req.BankId, LoanMS.Infrastructure.Services.ObligationService.ProductKeyFor(loan.LoanType), req, calc.Emi, c);
            if (req.AsOf != null) facts = WithAsOf(facts, req.AsOf.Value);
        }
        else
        {
            facts = new DeviationRuleEngine.Facts
            {
                BankId = req.BankId, ProductKey = req.ProductKey ?? "", LoanType = req.LoanType ?? "", AsOf = req.AsOf ?? Now,
                LoanAmount = req.LoanAmount, TenureMonths = req.TenureMonths, BaseRoi = req.BaseRoi, OfferedRoi = req.OfferedRoi,
                BtAmount = req.BtAmount, MonthlyIncome = req.MonthlyIncome, PostLoanFoirPct = req.PostLoanFoirPct,
                BureauCibil = req.BureauCibil, EmploymentType = req.EmploymentType,
            };
        }
        var rules = await _db.DeviationRules.AsNoTracking().Where(r => r.BankId == req.BankId).ToListAsync();
        if (req.DraftRule != null)
        {
            var draft = RuleFrom(req.DraftRule);
            draft.Id = -1; draft.RuleKey = "DRAFT"; draft.Version = 0;
            rules.Add(draft);
        }
        // Dry run: nothing is written.
        return ApiResponseDto<DeviationEvaluationDto>.Ok(ToDto(DeviationRuleEngine.Evaluate(rules, facts)));
    }

    private static DeviationRuleEngine.Facts WithAsOf(DeviationRuleEngine.Facts f, DateTime asOf) => new()
    {
        BankId = f.BankId, ProductKey = f.ProductKey, LoanType = f.LoanType, AsOf = asOf, LoanAmount = f.LoanAmount,
        TenureMonths = f.TenureMonths, BaseRoi = f.BaseRoi, OfferedRoi = f.OfferedRoi, BtAmount = f.BtAmount,
        MonthlyIncome = f.MonthlyIncome, PostLoanFoirPct = f.PostLoanFoirPct, BureauCibil = f.BureauCibil,
        DeclaredCibil = f.DeclaredCibil, EmploymentType = f.EmploymentType, CustomerType = f.CustomerType, ExistingCustomer = f.ExistingCustomer,
    };

    // ═════════════════════════════════════════════════════════════════════════
    // Report
    // ═════════════════════════════════════════════════════════════════════════
    public async Task<ApiResponseDto<List<OfferPipelineReportRowDto>>> PipelineReportAsync(DateTime? from, DateTime? to, int? bankId, string? offerStatus, WorkflowCaller c)
    {
        if (!await AllowedAsync(c.Role, "canViewReports"))
            return ApiResponseDto<List<OfferPipelineReportRowDto>>.Fail("You do not have permission to view reports.", ApiErrorCodes.Forbidden);
        var masked = Is(c.Role, MaskedRoles);
        var scoped = LoanRepository.ApplyVisibilityScope(_db, _db.Loans.Where(l => !l.IsArchived), c.UserId, c.Role).Select(l => l.Id);
        var q = _db.ApplicationOffers.AsNoTracking().Include(o => o.Revisions).Include(o => o.Loan).ThenInclude(l => l.Customer)
            .Where(o => scoped.Contains(o.LoanId));
        if (from != null) q = q.Where(o => o.CreatedAt >= from);
        if (to != null) { var end = to.Value.Date.AddDays(1); q = q.Where(o => o.CreatedAt < end); }
        if (bankId != null) q = q.Where(o => o.BankId == bankId);
        if (!string.IsNullOrWhiteSpace(offerStatus)) q = q.Where(o => o.Status == offerStatus);
        var offers = await q.OrderByDescending(o => o.CreatedAt).Take(5000).ToListAsync();
        var loanIds = offers.Select(o => o.LoanId).Distinct().ToList();
        var devs = await _db.OfferDeviations.AsNoTracking().Where(d => loanIds.Contains(d.LoanId)).ToListAsync();
        var apps = await _db.CreditApprovals.AsNoTracking().Where(a => loanIds.Contains(a.LoanId) && a.Decision == "Approved").ToListAsync();
        var sans = await _db.Sanctions.AsNoTracking().Where(s => loanIds.Contains(s.LoanId)).ToListAsync();
        var disb = await _db.Disbursements.AsNoTracking().Where(d => loanIds.Contains(d.LoanId) && d.Type == S.TypeDisbursement).ToListAsync();
        var rows = offers.Select(o =>
        {
            var rev = o.Revisions.First(r => r.RevisionNo == o.CurrentRevisionNo);
            var s = sans.Where(x => x.OfferId == o.Id).OrderByDescending(x => x.Id).FirstOrDefault();
            var d = s == null ? null : disb.Where(x => x.SanctionId == s.Id).OrderByDescending(x => x.Id).FirstOrDefault();
            return new OfferPipelineReportRowDto
            {
                LoanId = o.LoanId, LoanNumber = o.Loan.LoanNumber, ApplicantName = o.Loan.Customer?.FullName ?? "",
                ApplicationStatus = o.Loan.Status.ToString(), OfferId = o.Id, LenderName = o.LenderName, OfferStatus = o.Status,
                IsFinalLender = o.Status == S.OfferFinal, RevisionNo = o.CurrentRevisionNo, LoanAmount = rev.LoanAmount,
                TenureMonths = rev.TenureMonths, BaseRoi = masked ? null : rev.BaseRoi, OfferedRoi = rev.OfferedRoi, Emi = rev.Emi,
                NetDisbursement = rev.NetDisbursement, DeviationStatus = o.DeviationStatus,
                DeviationTypes = masked ? null : string.Join(", ", devs.Where(x => x.OfferId == o.Id && x.Status != S.RequestClosed).Select(x => x.DeviationType).Distinct()),
                ApprovalStatus = o.ApprovalStatus,
                ApprovedAt = apps.Where(a => a.OfferId == o.Id).OrderByDescending(a => a.Id).FirstOrDefault()?.CreatedAt,
                SanctionNumber = s?.SanctionNumber, SanctionStatus = s?.Status, SanctionedAt = s?.GeneratedAt, SanctionAmount = s?.LoanAmount,
                DisbursedAmount = d?.Amount, DisbursedAt = d?.DisbursementDate, DisbursementStatus = d?.Status, OfferCreatedAt = o.CreatedAt,
            };
        }).ToList();
        return ApiResponseDto<List<OfferPipelineReportRowDto>>.Ok(rows);
    }
}
