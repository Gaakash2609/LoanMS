using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.Infrastructure.Repositories;

// ── Loan Repository ───────────────────────────────────────────────────────────
public class LoanRepository : GenericRepository<Loan>, ILoanRepository
{
    public LoanRepository(AppDbContext ctx) : base(ctx) { }

    public async Task<Loan?> GetWithDetailsAsync(int id, int? currentUserId = null, string? currentUserRole = null)
    {
        var query = _set.IncludeDeletedUsers()
            .Include(l => l.Customer)
            .Include(l => l.CreatedBy)
            .Include(l => l.AssignedTo)
            .Include(l => l.LoginUser)
            .Include(l => l.OpsManager)
            .Include(l => l.Location)
            .Include(l => l.Dsa)
            .Include(l => l.Partner)
            .Include(l => l.BankLines.OrderBy(b => b.Id))
            .Include(l => l.References.OrderBy(r => r.RefNumber))
            .Include(l => l.SanctionDetail)
            .Include(l => l.StatusHistory.OrderByDescending(h => h.CreatedAt))
                .ThenInclude(h => h.ChangedBy)
            .Include(l => l.Documents)
            .AsQueryable();

        // Phase 2B — same visibility scope as the list endpoint, applied here so
        // that fetching a loan directly by id (e.g. by guessing/incrementing the
        // loanId in the URL) is blocked for anyone outside the caller's scope.
        // currentUserId is only null for internal callers (post-create/update
        // refetch, AI service) that intentionally need the unrestricted record.
        if (currentUserId.HasValue)
            query = ApplyVisibilityScope(_ctx, query, currentUserId.Value, currentUserRole);

        return await query.FirstOrDefaultAsync(l => l.Id == id);
    }

    /// <summary>
    /// Single source of truth for role-based Loan visibility. Applied to
    /// every loan read surface: list, search/filter, dashboard/recent loans,
    /// and detail-by-id. This is server-side query scoping — the frontend
    /// never decides who can see what.
    ///   Sales            -> own created loans + loans currently assigned to them
    ///   Dsa              -> own DSA cases (linked via DsaPartner.LinkedUserId)
    ///                       PLUS every Partner's cases where that Partner is
    ///                       mapped under this DSA (DsaPartner.MappedDsaId)
    ///   Partner          -> loans whose PartnerId matches the DsaPartner record linked to this user
    ///   Manager          -> team-MEMBERSHIP based (verified against the reference Odoo
    ///                       project): every loan whose creator/assignee belongs to a
    ///                       Sales-type Team this user leads or is a member of
    ///   TeamLeader       -> same rule as Manager (Sales-team membership)
    ///   LoginTeam        -> own personally-assigned processing queue only (Loan.LoginUserId)
    ///   OperationManager -> whole Login-type Team's queue (team-membership derivation,
    ///                       same mechanism as Manager/TeamLeader, applied to Login teams)
    ///   LocationHead     -> every loan at their assigned Location (User.LocationId),
    ///                       independent of team — cuts across Source/Process/Operation
    ///   ProductTeam      -> no Loan visibility at all — real access is over the
    ///                       configuration modules (Offers/Lender/DSA/Partner
    ///                       management), not loans — see DsaController,
    ///                       BanksController, ProductOfferMatrixController
    ///   Accounts         -> financially-relevant applications only (Approved/Disbursed)
    ///   Admin            -> unrestricted
    ///   anything else / unrecognized role -> no loans visible
    ///
    /// Made internal static (ctx passed in explicitly instead of using the
    /// instance's _ctx) so CustomerRepository, in the same assembly, can
    /// reuse this exact rule set to scope customers via their loans, instead
    /// of re-implementing the Sales/Dsa/Partner/Manager rules a second time.
    /// </summary>
    // BUGFIX (confirmed real access-control bypass — ReportsController used
    // _db.Loans directly, unscoped, in 7 endpoints): changed from `internal`
    // to `public` ONLY — no logic change — so ReportsController (a
    // different assembly, LoanMS.API) can call this exact same, single,
    // centralized method instead of ReportsController inventing its own,
    // second visibility-rule. Every other caller (LoansController,
    // DashboardController, SearchController) is completely unaffected by
    // this visibility widening.
    public static IQueryable<Loan> ApplyVisibilityScope(AppDbContext ctx, IQueryable<Loan> query, int currentUserId, string? currentUserRole)
    {
        var role = currentUserRole ?? string.Empty;

        if (string.Equals(role, "Admin", StringComparison.OrdinalIgnoreCase))
            return query;

        // ── Admin-assigned scope expansion (explicit system-owner override) ─────
        // Supersedes the earlier, narrower conclusion that "Manager/TeamLeader =
        // team-only, LocationHead = location-only" — those role-specific base
        // rules below are PRESERVED (nothing removed), but for every restricted
        // role, an Admin can now ALSO explicitly assign additional Locations
        // (UserLocations) and/or Sales/Operation Teams (TeamMembers, same table
        // Manager/OperationManager already correctly used) to widen that user's
        // authorized scope — combined via OR, never AND, per the explicit
        // requirement that a user must not need to match every mapping
        // simultaneously.
        //
        // BUGFIX (confirmed real risk during focused EF Core-translatability
        // verification, fixed before any actual runtime failure was
        // observed): the first version of this expansion built a separate,
        // pre-filtered IQueryable<Loan> per role, then tried to fold it into
        // the final query via `baseFiltered.Any(b => b.Id == l.Id)` inside
        // another .Where() lambda. That's a correlated-subquery-of-a-
        // subquery pattern (several roles' base rules are themselves built
        // from nested Union/Contains subqueries) that EF Core is not
        // guaranteed to translate — it risks throwing "The LINQ expression
        // could not be translated" at runtime for some role branches.
        // Rewritten below so every role writes ONE single, flat .Where()
        // lambda combining its own base condition with the same four
        // admin-scope OR-terms directly, inline — no nested-IQueryable
        // composition at all, which is the standard, guaranteed-safe EF
        // Core pattern (at the small cost of repeating those four terms
        // per role instead of factoring them into a shared helper).
        //
        // A user with zero admin-assigned mappings gets zero additional
        // scope from this — adminAssignedTeamUserIds/adminAssignedLocationIds
        // are empty in that case, so .Contains() on them never matches
        // anything, and each role's own base condition (still present via
        // ||) is unaffected. This keeps "no mappings" secure-by-default
        // (Case 5 in the original spec) while letting explicit mappings
        // expand access when present.
        // BUGFIX (confirmed real precision issue during focused Team-schema
        // verification — Sales vs Login team category check): the original
        // version combined Sales- and Login-type admin-assigned teams into
        // one undifferentiated "team-mates" list, checked against all three
        // of CreatedByUserId/AssignedToUserId/LoginUserId uniformly. That
        // let a user admin-assigned to ONLY a Sales Team incidentally gain
        // visibility into an unrelated Login/processing queue, if one of
        // their Sales-teammates happened to ALSO independently belong to
        // some Login-type team elsewhere — a real over-grant the spec's own
        // distinct "Sales Teams" vs "Operation Teams" categorization does
        // not intend. Split into two separate sets, matching the same
        // Type == "Sales" / Type == "Login" distinction the existing
        // Manager and OperationManager base rules below already correctly
        // maintain — Sales-team admin-assignments only ever expand
        // Created/AssignedTo visibility; Login-team admin-assignments only
        // ever expand LoginUserId visibility.
        var adminAssignedSalesTeamUserIds = ctx.Set<TeamMember>()
            .Where(tm => !tm.IsDeleted && tm.Team.Type == "Sales" && ctx.Set<TeamMember>()
                .Any(mine => mine.UserId == currentUserId && !mine.IsDeleted && mine.TeamId == tm.TeamId))
            .Select(tm => tm.UserId)
            .Union(ctx.Set<Team>()
                .Where(t => t.Type == "Sales" && t.TeamLeadUserId != null && ctx.Set<TeamMember>()
                    .Any(mine => mine.UserId == currentUserId && !mine.IsDeleted && mine.TeamId == t.Id))
                .Select(t => t.TeamLeadUserId!.Value));

        var adminAssignedLoginTeamUserIds = ctx.Set<TeamMember>()
            .Where(tm => !tm.IsDeleted && tm.Team.Type == "Login" && ctx.Set<TeamMember>()
                .Any(mine => mine.UserId == currentUserId && !mine.IsDeleted && mine.TeamId == tm.TeamId))
            .Select(tm => tm.UserId)
            .Union(ctx.Set<Team>()
                .Where(t => t.Type == "Login" && t.TeamLeadUserId != null && ctx.Set<TeamMember>()
                    .Any(mine => mine.UserId == currentUserId && !mine.IsDeleted && mine.TeamId == t.Id))
                .Select(t => t.TeamLeadUserId!.Value));

        var adminAssignedLocationIds = ctx.Set<UserLocation>()
            .Where(ul => ul.UserId == currentUserId && !ul.IsDeleted)
            .Select(ul => ul.LocationId);

        // Local bool functions are avoided entirely here — see the BUGFIX
        // comment above for why: every role below writes one flat,
        // self-contained .Where() lambda instead.

        if (string.Equals(role, "Sales", StringComparison.OrdinalIgnoreCase))
            return query.Where(l =>
                l.CreatedByUserId == currentUserId || l.AssignedToUserId == currentUserId ||
                adminAssignedSalesTeamUserIds.Contains(l.CreatedByUserId) ||
                (l.AssignedToUserId.HasValue && adminAssignedSalesTeamUserIds.Contains(l.AssignedToUserId.Value)) ||
                (l.LoginUserId.HasValue && adminAssignedLoginTeamUserIds.Contains(l.LoginUserId.Value)) ||
                (l.LocationId.HasValue && adminAssignedLocationIds.Contains(l.LocationId.Value)));

        if (string.Equals(role, "Dsa", StringComparison.OrdinalIgnoreCase))
            // Own DSA cases: never compare currentUserId directly to
            // Loan.DsaId — DsaId is a DsaPartner record id, not a User id.
            // Resolve via the linked user.
            //
            // PLUS (added per business owner): if the loan's Partner is
            // mapped under this DSA (DsaPartner.MappedDsaId — the Partner
            // Management "mapped DSA" field), the DSA also sees that
            // Partner's cases. Rule as specified: a Partner with no mapped
            // DSA is unaffected by this at all (no location or other
            // condition involved) — only linkage matters.
            return query.Where(l =>
                (l.DsaId != null && l.Dsa != null && l.Dsa.LinkedUserId == currentUserId) ||
                (l.PartnerId != null && l.Partner != null && l.Partner.MappedDsa != null &&
                 l.Partner.MappedDsa.LinkedUserId == currentUserId) ||
                adminAssignedSalesTeamUserIds.Contains(l.CreatedByUserId) ||
                (l.AssignedToUserId.HasValue && adminAssignedSalesTeamUserIds.Contains(l.AssignedToUserId.Value)) ||
                (l.LoginUserId.HasValue && adminAssignedLoginTeamUserIds.Contains(l.LoginUserId.Value)) ||
                (l.LocationId.HasValue && adminAssignedLocationIds.Contains(l.LocationId.Value)));

        if (string.Equals(role, "Partner", StringComparison.OrdinalIgnoreCase))
            // Same rule for Partner: never compare currentUserId directly to Loan.PartnerId.
            return query.Where(l =>
                (l.PartnerId != null && l.Partner != null && l.Partner.LinkedUserId == currentUserId) ||
                adminAssignedSalesTeamUserIds.Contains(l.CreatedByUserId) ||
                (l.AssignedToUserId.HasValue && adminAssignedSalesTeamUserIds.Contains(l.AssignedToUserId.Value)) ||
                (l.LoginUserId.HasValue && adminAssignedLoginTeamUserIds.Contains(l.LoginUserId.Value)) ||
                (l.LocationId.HasValue && adminAssignedLocationIds.Contains(l.LocationId.Value)));

        // TeamLeader (Sales hierarchy) — team-MEMBERSHIP rule: sees every loan
        // whose creator/assignee is a member of a Sales Team this user leads or
        // belongs to. Per the confirmed final spec (G-15, least privilege) a
        // Team Leader is scoped to their mapped Sales Team ONLY — no Location or
        // Login-queue widening — so another team's applications stay hidden even
        // at the same Location.
        if (string.Equals(role, "TeamLeader", StringComparison.OrdinalIgnoreCase))
        {
            var mySalesTeamIds = ctx.Set<Team>()
                .Where(t => t.Type == "Sales" &&
                    (t.TeamLeadUserId == currentUserId ||
                     ctx.Set<TeamMember>().Any(tm => tm.TeamId == t.Id && tm.UserId == currentUserId && !tm.IsDeleted)))
                .Select(t => t.Id);

            var teamUserIds = ctx.Set<TeamMember>()
                .Where(tm => mySalesTeamIds.Contains(tm.TeamId) && !tm.IsDeleted)
                .Select(tm => tm.UserId)
                .Union(ctx.Set<Team>()
                    .Where(t => mySalesTeamIds.Contains(t.Id) && t.TeamLeadUserId != null)
                    .Select(t => t.TeamLeadUserId!.Value));

            return query.Where(l =>
                teamUserIds.Contains(l.CreatedByUserId) ||
                (l.AssignedToUserId.HasValue && teamUserIds.Contains(l.AssignedToUserId.Value)));
        }

        // Manager — G-03 (confirmed). Intersection, NOT union: a Manager sees a
        // loan ONLY when BOTH hold —
        //   (a) the loan's Location is one of the Manager's mapped Locations
        //       (UserLocations), AND
        //   (b) the loan's Team (its creator/assignee belongs to a Sales Team the
        //       Manager leads/belongs to) is one of the Manager's mapped Teams.
        // No global access. A Manager with no Location mapping, or no Team
        // mapping, sees nothing (least privilege — an Admin must map both). This
        // deliberately replaces the earlier OR/union behaviour.
        if (string.Equals(role, "Manager", StringComparison.OrdinalIgnoreCase))
        {
            var mySalesTeamIds = ctx.Set<Team>()
                .Where(t => t.Type == "Sales" &&
                    (t.TeamLeadUserId == currentUserId ||
                     ctx.Set<TeamMember>().Any(tm => tm.TeamId == t.Id && tm.UserId == currentUserId && !tm.IsDeleted)))
                .Select(t => t.Id);

            var teamUserIds = ctx.Set<TeamMember>()
                .Where(tm => mySalesTeamIds.Contains(tm.TeamId) && !tm.IsDeleted)
                .Select(tm => tm.UserId)
                .Union(ctx.Set<Team>()
                    .Where(t => mySalesTeamIds.Contains(t.Id) && t.TeamLeadUserId != null)
                    .Select(t => t.TeamLeadUserId!.Value));

            var myLocationIds = ctx.Set<UserLocation>()
                .Where(ul => ul.UserId == currentUserId && !ul.IsDeleted)
                .Select(ul => ul.LocationId);

            return query.Where(l =>
                (l.LocationId.HasValue && myLocationIds.Contains(l.LocationId.Value)) &&
                (teamUserIds.Contains(l.CreatedByUserId) ||
                 (l.AssignedToUserId.HasValue && teamUserIds.Contains(l.AssignedToUserId.Value))));
        }

        // LoginTeam — base rule: an individual Login Team member sees their
        // OWN personally-assigned processing queue. Admin-assigned Location/
        // Team mappings can now additionally widen this via the same OR-terms.
        if (string.Equals(role, "LoginTeam", StringComparison.OrdinalIgnoreCase))
            return query.Where(l =>
                l.LoginUserId == currentUserId ||
                adminAssignedSalesTeamUserIds.Contains(l.CreatedByUserId) ||
                (l.AssignedToUserId.HasValue && adminAssignedSalesTeamUserIds.Contains(l.AssignedToUserId.Value)) ||
                (l.LoginUserId.HasValue && adminAssignedLoginTeamUserIds.Contains(l.LoginUserId.Value)) ||
                (l.LocationId.HasValue && adminAssignedLocationIds.Contains(l.LocationId.Value)));

        // OperationManager — G-04 (confirmed). Intersection, NOT union: an
        // Operations Manager sees a loan ONLY when BOTH hold —
        //   (a) the loan's Location is one of the OM's mapped Locations
        //       (UserLocations), AND
        //   (b) the loan's AssignedLoginUser (Loan.LoginUserId) is one of the
        //       OM's mapped Login Users (members/leads of Login-type Teams the OM
        //       leads or belongs to).
        // No global access. An OM with no Location mapping, or no mapped Login
        // Users, sees nothing (least privilege). Replaces the earlier OR/union.
        if (string.Equals(role, "OperationManager", StringComparison.OrdinalIgnoreCase))
        {
            var myLoginTeamIds = ctx.Set<Team>()
                .Where(t => t.Type == "Login" &&
                    (t.TeamLeadUserId == currentUserId ||
                     ctx.Set<TeamMember>().Any(tm => tm.TeamId == t.Id && tm.UserId == currentUserId && !tm.IsDeleted)))
                .Select(t => t.Id);

            var loginUserIds = ctx.Set<TeamMember>()
                .Where(tm => myLoginTeamIds.Contains(tm.TeamId) && !tm.IsDeleted)
                .Select(tm => tm.UserId)
                .Union(ctx.Set<Team>()
                    .Where(t => myLoginTeamIds.Contains(t.Id) && t.TeamLeadUserId != null)
                    .Select(t => t.TeamLeadUserId!.Value));

            var myLocationIds = ctx.Set<UserLocation>()
                .Where(ul => ul.UserId == currentUserId && !ul.IsDeleted)
                .Select(ul => ul.LocationId);

            return query.Where(l =>
                (l.LocationId.HasValue && myLocationIds.Contains(l.LocationId.Value)) &&
                (l.LoginUserId.HasValue && loginUserIds.Contains(l.LoginUserId.Value)));
        }

        // LocationHead — base rule: every loan at any Admin-assigned
        // Location (UserLocations — already many-to-many), independent of
        // team. Also gets the same OR-terms so an Admin can ALSO grant this
        // user extra Team-based scope on top of their Location scope, per
        // the same union-everything principle (the Location-term below is
        // therefore redundant with this role's own base rule, which is
        // harmless — OR of the same condition twice is a no-op).
        if (string.Equals(role, "LocationHead", StringComparison.OrdinalIgnoreCase))
        {
            var myLocationIds = ctx.Set<UserLocation>()
                .Where(ul => ul.UserId == currentUserId && !ul.IsDeleted)
                .Select(ul => ul.LocationId);
            return query.Where(l =>
                (l.LocationId != null && myLocationIds.Contains(l.LocationId.Value)) ||
                adminAssignedSalesTeamUserIds.Contains(l.CreatedByUserId) ||
                (l.AssignedToUserId.HasValue && adminAssignedSalesTeamUserIds.Contains(l.AssignedToUserId.Value)) ||
                (l.LoginUserId.HasValue && adminAssignedLoginTeamUserIds.Contains(l.LoginUserId.Value)) ||
                (l.LocationId.HasValue && adminAssignedLocationIds.Contains(l.LocationId.Value)));
        }

        // ProductTeam: no existing field ties a User to a specific
        // product/LoanType (unlike LocationHead, which now has a real
        // Location link), so — per the project owner's explicit decision —
        // this intentionally falls through to the same "no loans visible"
        // rule as any other unrecognized role below. ProductTeam's real
        // access is over the configuration modules (Offers/Lender/DSA/
        // Partner management), not Loan visibility — see DsaController,
        // BanksController, ProductOfferMatrixController.

        // Accounts — per the final Role & Access spec: financially-relevant
        // applications only (a loan becomes relevant to Accounts once
        // there's actually a payout to reconcile). No team/location scope —
        // Accounts is explicitly a cross-location finance function (same
        // convention already used for PayoutController's _selfOnlyRoles,
        // which deliberately excludes Accounts from the self-only claim
        // scoping for the same reason).
        if (string.Equals(role, "Accounts", StringComparison.OrdinalIgnoreCase))
            return query.Where(l => l.Status == LoanStatus.Approved || l.Status == LoanStatus.Disbursed);

        // Unrelated / unrecognized roles: no loan should be visible.
        return query.Where(l => false);
    }

    /// <summary>
    /// Reports page filters (Scope / User / Team / Status).
    ///
    /// This is NARROWING ONLY and must always run AFTER ApplyVisibilityScope —
    /// every caller composes them in that order. Nothing here can widen what a
    /// user may see: the predicates are additional .Where() clauses on a query
    /// the authorization rule has already restricted, so an out-of-scope loan
    /// is gone before this is reached. That is also why Partner needs no
    /// special case here — its branch in ApplyVisibilityScope has already
    /// pinned the query to that partner's own records.
    ///
    /// The behaviour mirrors the legacy Reports page (_rptGetFilteredApps,
    /// efin-app.js:12901) exactly, including the parts that are arguably
    /// legacy quirks — they are reproduced deliberately rather than
    /// "improved", so the two apps agree on what a report contains:
    ///
    ///   • "My Team" is offered to Admin and TeamLeader only (efin-app.js:12978).
    ///     Manager does NOT get it, and a scope=team from any other role is a
    ///     no-op, matching legacy's `teamMembers.length` guard (:12915).
    ///   • The team roster comes from LEADERSHIP, not membership: the first
    ///     Sales team this user leads, then that team's lead + members
    ///     (`twSalesTeams.find(t => t.leader === uname)`, :13036).
    ///   • Only the FIRST such team counts; further teams the same person
    ///     leads are ignored, exactly as .find() does. Legacy's "first" is its
    ///     array order, which is not deterministic; Id order is used here as
    ///     the closest stable equivalent.
    ///   • No team found degrades to just this user, so "My Team" quietly
    ///     behaves like "My Data" (:13038's `: [uname]` fallback).
    ///
    /// Loans are matched on CreatedByUserId OR AssignedToUserId. Legacy matches
    /// its single `a.sales` field, which this data model splits across those
    /// two columns.
    /// </summary>
    /// <param name="scope">"all" | "mine" | "team". Anything else is treated as "all".</param>
    public static IQueryable<Loan> ApplyReportNarrowing(
        AppDbContext ctx,
        IQueryable<Loan> query,
        int currentUserId,
        string? currentUserRole,
        string? scope = null,
        int? userId = null,
        int? teamId = null,
        LoanStatus? status = null)
    {
        var role = currentUserRole ?? string.Empty;

        // ── Scope ────────────────────────────────────────────────────────
        if (string.Equals(scope, "mine", StringComparison.OrdinalIgnoreCase))
        {
            query = query.Where(l =>
                l.CreatedByUserId == currentUserId ||
                (l.AssignedToUserId.HasValue && l.AssignedToUserId.Value == currentUserId));
        }
        else if (string.Equals(scope, "team", StringComparison.OrdinalIgnoreCase)
                 && (string.Equals(role, "Admin", StringComparison.OrdinalIgnoreCase)
                     || string.Equals(role, "TeamLeader", StringComparison.OrdinalIgnoreCase)))
        {
            // First Sales team this user LEADS — see the note above on why
            // leadership (not membership) and why only the first one.
            var myTeamId = ctx.Set<Team>()
                .Where(t => t.Type == "Sales" && !t.IsDeleted && t.TeamLeadUserId == currentUserId)
                .OrderBy(t => t.Id)
                .Select(t => (int?)t.Id)
                .FirstOrDefault();

            if (myTeamId == null)
            {
                // Legacy's `: [uname]` fallback — "My Team" becomes "My Data".
                query = query.Where(l =>
                    l.CreatedByUserId == currentUserId ||
                    (l.AssignedToUserId.HasValue && l.AssignedToUserId.Value == currentUserId));
            }
            else
            {
                var rosterUserIds = TeamRosterUserIds(ctx, myTeamId.Value);
                query = query.Where(l =>
                    rosterUserIds.Contains(l.CreatedByUserId) ||
                    (l.AssignedToUserId.HasValue && rosterUserIds.Contains(l.AssignedToUserId.Value)));
            }
        }
        // "all" (and scope=team from a role that isn't offered it) adds nothing.

        // ── Individual user ──────────────────────────────────────────────
        if (userId.HasValue)
        {
            var uid = userId.Value;
            query = query.Where(l =>
                l.CreatedByUserId == uid ||
                (l.AssignedToUserId.HasValue && l.AssignedToUserId.Value == uid));
        }

        // ── Team ─────────────────────────────────────────────────────────
        // Legacy narrows to the SELECTED team's leader + members
        // (efin-app.js:12921), which is the same roster shape as above.
        if (teamId.HasValue)
        {
            var rosterUserIds = TeamRosterUserIds(ctx, teamId.Value);
            query = query.Where(l =>
                rosterUserIds.Contains(l.CreatedByUserId) ||
                (l.AssignedToUserId.HasValue && rosterUserIds.Contains(l.AssignedToUserId.Value)));
        }

        // ── Status ───────────────────────────────────────────────────────
        if (status.HasValue)
            query = query.Where(l => l.Status == status.Value);

        return query;
    }

    /// <summary>
    /// A team's lead plus its members, as user ids. Kept as one definition so
    /// the "My Team" scope and the Team filter can never drift apart, and so
    /// this matches the lead-∪-members shape ApplyVisibilityScope already uses.
    /// </summary>
    private static IQueryable<int> TeamRosterUserIds(AppDbContext ctx, int teamId)
        => ctx.Set<TeamMember>()
            .Where(tm => tm.TeamId == teamId && !tm.IsDeleted)
            .Select(tm => tm.UserId)
            .Union(ctx.Set<Team>()
                .Where(t => t.Id == teamId && t.TeamLeadUserId != null)
                .Select(t => t.TeamLeadUserId!.Value));

    /// <summary>
    /// Phase 3A — "can this user act on this loan" check for Update/UpdateStatus/
    /// Submit/Approve/Reject/Delete. Deliberately reuses ApplyVisibilityScope
    /// (the same rule set that gates the list/detail endpoints) instead of a
    /// second, separate authorization check — one rule set, one place to change it.
    /// </summary>
    public async Task<bool> HasAccessAsync(int loanId, int currentUserId, string? currentUserRole)
    {
        var query = ApplyVisibilityScope(_ctx, _set.AsQueryable(), currentUserId, currentUserRole);
        return await query.AnyAsync(l => l.Id == loanId);
    }

    public async Task<bool> LocationExistsAsync(int locationId)
    {
        return await _ctx.Set<LoanMS.Domain.Entities.Location>().AnyAsync(l => l.Id == locationId && !l.IsDeleted);
    }

    public async Task ReplaceBankLinesAsync(int loanId, List<LoanBankLine> newLines)
    {
        var existing = await _ctx.Set<LoanBankLine>().Where(b => b.LoanId == loanId && !b.IsDeleted).ToListAsync();
        foreach (var line in existing)
        {
            line.IsDeleted = true;
            line.UpdatedAt = DateTime.UtcNow;
        }
        foreach (var line in newLines)
        {
            line.LoanId = loanId;
            line.CreatedAt = DateTime.UtcNow;
            _ctx.Set<LoanBankLine>().Add(line);
        }
        await _ctx.SaveChangesAsync();
    }

    public async Task ReplaceReferencesAsync(int loanId, List<LoanReference> newRefs)
    {
        // Same whole-table-replace convention as ReplaceBankLinesAsync —
        // simpler and safer than diffing individual row ids for a small,
        // always-fully-resubmitted set (2 references, edited together as
        // one form section in saveEditDetail()).
        var existing = await _ctx.Set<LoanReference>().Where(r => r.LoanId == loanId && !r.IsDeleted).ToListAsync();
        foreach (var r in existing)
        {
            r.IsDeleted = true;
            r.UpdatedAt = DateTime.UtcNow;
        }
        foreach (var r in newRefs)
        {
            r.LoanId = loanId;
            r.CreatedAt = DateTime.UtcNow;
            _ctx.Set<LoanReference>().Add(r);
        }
        await _ctx.SaveChangesAsync();
    }

    public async Task<PagedResultDto<LoanListDto>> GetPagedAsync(LoanFilterDto filter, int? currentUserId = null, string? currentUserRole = null)
    {
        var query = _set.IncludeDeletedUsers()
            .Include(l => l.Customer)
            .Include(l => l.CreatedBy)
            .Include(l => l.AssignedTo)
            .AsQueryable();

        // Role-based scoping — enforced on the server, not the client.
        if (currentUserId.HasValue)
            query = ApplyVisibilityScope(_ctx, query, currentUserId.Value, currentUserRole);

        query = ApplyListFilters(_ctx, query, filter);

        var total = await query.CountAsync();
        var items = await query
            .Skip((filter.Page - 1) * filter.PageSize)
            .Take(filter.PageSize)
            .Select(l => new LoanListDto
            {
                Id              = l.Id,
                LoanNumber      = l.LoanNumber,
                LoanType        = l.LoanType.ToString(),
                Status          = l.Status.ToString(),
                RequestedAmount = l.RequestedAmount,
                ApprovedAmount  = l.ApprovedAmount,
                InterestRate    = l.InterestRate,
                TenureMonths    = l.TenureMonths,
                CustomerName    = l.Customer.FullName,
                CustomerPhone   = l.Customer.Phone,
                CustomerCibilScore = l.Customer.CibilScore,
                LocationName    = l.Location != null ? l.Location.Name : null,
                Purpose         = l.Purpose,
                Remarks         = l.Remarks,
                SelectedLenderNames = l.SelectedLenderNames,
                DsaName         = l.Dsa != null ? l.Dsa.Name : null,
                PartnerName     = l.Partner != null ? l.Partner.Name : null,
                CustomerCity    = l.Customer.City,
                CustomerState   = l.Customer.State,
                CustomerGender  = l.Customer.Gender,
                CustomerEmploymentType = l.Customer.EmploymentType,
                CustomerCompanyName    = l.Customer.CompanyName,
                CreatedByUserId        = l.CreatedByUserId,
                AssignedToUserId       = l.AssignedToUserId,
                CustomerMonthlyIncome  = l.Customer.MonthlyIncome,
                CreatedByName   = l.CreatedBy.FullName,
                AssignedToName  = l.AssignedTo != null ? l.AssignedTo.FullName : null,
                LoginUserName   = l.LoginUser  != null ? l.LoginUser.FullName  : null,
                RiskGrade       = _ctx.Set<BureauReport>()
                                    .Where(b => b.CustomerId == l.CustomerId)
                                    .OrderByDescending(b => b.ScoreGeneratedDate)
                                    .Select(b => b.RiskGrade)
                                    .FirstOrDefault(),
                CreatedAt       = l.CreatedAt
            })
            .ToListAsync();

        return new PagedResultDto<LoanListDto>
        {
            Items = items, TotalCount = total, Page = filter.Page, PageSize = filter.PageSize
        };
    }

    /// <summary>
    /// Applications → Export. Same search/status/type/customer/assignee/date
    /// filters and role-based visibility scope as GetPagedAsync, but ignores
    /// Page/PageSize and instead returns up to maxRows matching rows in one
    /// shot for a CSV download (LoansController.Export) — capped so a very
    /// broad filter (or none at all) can't pull an unbounded result set into
    /// memory.
    /// </summary>
    public async Task<List<LoanListDto>> GetForExportAsync(LoanFilterDto filter, int? currentUserId = null, string? currentUserRole = null, int maxRows = 5000)
    {
        var query = _set.IncludeDeletedUsers()
            .Include(l => l.Customer)
            .Include(l => l.CreatedBy)
            .Include(l => l.AssignedTo)
            .AsQueryable();

        if (currentUserId.HasValue)
            query = ApplyVisibilityScope(_ctx, query, currentUserId.Value, currentUserRole);

        query = ApplyListFilters(_ctx, query, filter);

        return await query
            .Take(maxRows)
            .Select(l => new LoanListDto
            {
                Id              = l.Id,
                LoanNumber      = l.LoanNumber,
                LoanType        = l.LoanType.ToString(),
                Status          = l.Status.ToString(),
                RequestedAmount = l.RequestedAmount,
                ApprovedAmount  = l.ApprovedAmount,
                InterestRate    = l.InterestRate,
                TenureMonths    = l.TenureMonths,
                CustomerName    = l.Customer.FullName,
                CustomerPhone   = l.Customer.Phone,
                CustomerCibilScore = l.Customer.CibilScore,
                LocationName    = l.Location != null ? l.Location.Name : null,
                Purpose         = l.Purpose,
                Remarks         = l.Remarks,
                SelectedLenderNames = l.SelectedLenderNames,
                DsaName         = l.Dsa != null ? l.Dsa.Name : null,
                PartnerName     = l.Partner != null ? l.Partner.Name : null,
                CustomerCity    = l.Customer.City,
                CustomerState   = l.Customer.State,
                CustomerGender  = l.Customer.Gender,
                CustomerEmploymentType = l.Customer.EmploymentType,
                CustomerCompanyName    = l.Customer.CompanyName,
                CreatedByUserId        = l.CreatedByUserId,
                AssignedToUserId       = l.AssignedToUserId,
                CustomerMonthlyIncome  = l.Customer.MonthlyIncome,
                CreatedByName   = l.CreatedBy.FullName,
                AssignedToName  = l.AssignedTo != null ? l.AssignedTo.FullName : null,
                LoginUserName   = l.LoginUser  != null ? l.LoginUser.FullName  : null,
                RiskGrade       = _ctx.Set<BureauReport>()
                                    .Where(b => b.CustomerId == l.CustomerId)
                                    .OrderByDescending(b => b.ScoreGeneratedDate)
                                    .Select(b => b.RiskGrade)
                                    .FirstOrDefault(),
                CreatedAt       = l.CreatedAt
            })
            .ToListAsync();
    }

    /// <summary>
    /// Shared search/status/type/customer/assignee/date filtering + sort,
    /// factored out of GetPagedAsync so GetForExportAsync applies the exact
    /// same rules rather than a second, hand-copied version that could drift.
    /// </summary>
    private static IQueryable<Loan> ApplyListFilters(AppDbContext ctx, IQueryable<Loan> query, LoanFilterDto filter)
    {
        if (!string.IsNullOrEmpty(filter.Search))
        {
            var s = filter.Search.ToLower();
            // PHASE 6 FIX: this searched only LoanNumber / name / phone / email.
            // Vanilla's filterTable (efin-app.js:2211) searches App ID, name,
            // PAN, mobile, sales person, DSA, linked partner, company, loan
            // type, status, Aadhaar and email — so searching a PAN or a DSA
            // name returned nothing here while working fine in the legacy app.
            // LoanType/Status are enums persisted via HasConversion<string>(),
            // and ToString() on them is not translatable, so a text term is
            // resolved to an enum value up front and matched by equality (the
            // converter turns that into the right string comparison in SQL).
            // Hoisted to plain locals on purpose: EF's parameter-extraction pass
            // eagerly evaluates any subexpression that doesn't touch `l`, so a
            // `typeToken.Value` left inside the predicate would throw
            // InvalidOperationException whenever the term matched no enum value.
            // (`Where(l => false)` is already used by ApplyVisibilityScope above,
            // so the no-rows predicate itself is proven against this provider.)
            var typeToken   = ParseLoanTypeToken(s);
            var statusToken = ParseStatusToken(s);
            var hasType     = typeToken.HasValue;
            var typeVal     = typeToken ?? default;
            var hasStatus   = statusToken.HasValue;
            var statusVal   = statusToken ?? default;

            query = (filter.SearchField ?? "").ToLower() switch
            {
                "name"     => query.Where(l => l.Customer.FullName.ToLower().Contains(s)),
                "id"       => query.Where(l => l.LoanNumber.ToLower().Contains(s)),
                "mobile"   => query.Where(l => l.Customer.Phone.Contains(s)),
                "pan"      => query.Where(l => l.Customer.PanNumber != null && l.Customer.PanNumber.ToLower().Contains(s)),
                "dsa"      => query.Where(l => l.Dsa != null && l.Dsa.Name.ToLower().Contains(s)),
                "partner"  => query.Where(l => l.Partner != null && l.Partner.Name.ToLower().Contains(s)),
                "company"  => query.Where(l => l.Customer.CompanyName != null && l.Customer.CompanyName.ToLower().Contains(s)),
                "sales"    => query.Where(l => l.CreatedBy.FullName.ToLower().Contains(s)),
                "loantype" => hasType
                                ? query.Where(l => l.LoanType == typeVal)
                                : query.Where(l => false),
                "status"   => hasStatus
                                ? query.Where(l => l.Status == statusVal)
                                : query.Where(l => false),
                // All Fields
                _ => query.Where(l =>
                        l.LoanNumber.ToLower().Contains(s) ||
                        l.Customer.FullName.ToLower().Contains(s) ||
                        l.Customer.Phone.Contains(s) ||
                        l.Customer.Email.ToLower().Contains(s) ||
                        (l.Customer.PanNumber != null && l.Customer.PanNumber.ToLower().Contains(s)) ||
                        (l.Customer.AadhaarNumber != null && l.Customer.AadhaarNumber.Contains(s)) ||
                        (l.Customer.CompanyName != null && l.Customer.CompanyName.ToLower().Contains(s)) ||
                        l.CreatedBy.FullName.ToLower().Contains(s) ||
                        (l.Dsa != null && l.Dsa.Name.ToLower().Contains(s)) ||
                        (l.Partner != null && l.Partner.Name.ToLower().Contains(s)) ||
                        (hasType   && l.LoanType == typeVal) ||
                        (hasStatus && l.Status   == statusVal)),
            };
        }

        // Gap 1 — Statuses (multi-select) takes precedence over the single
        // Status filter when both somehow arrive together; callers are
        // expected to send exactly one of the two (frontend loanStore.setFilter
        // enforces this by clearing whichever one isn't being set).
        if (filter.Statuses is { Count: > 0 }) query = query.Where(l => filter.Statuses.Contains(l.Status));
        else if (filter.Status.HasValue)       query = query.Where(l => l.Status == filter.Status.Value);
        if (filter.LoanType.HasValue) query = query.Where(l => l.LoanType == filter.LoanType.Value);
        if (filter.CustomerId.HasValue) query = query.Where(l => l.CustomerId == filter.CustomerId.Value);
        if (filter.AssignedToUserId.HasValue) query = query.Where(l => l.AssignedToUserId == filter.AssignedToUserId.Value);
        // Phase 1 (DSA parity) — see LoanFilterDto.DsaId/PartnerId.
        if (filter.DsaId.HasValue) query = query.Where(l => l.DsaId == filter.DsaId.Value);
        if (filter.PartnerId.HasValue) query = query.Where(l => l.PartnerId == filter.PartnerId.Value);
        if (filter.FromDate.HasValue) query = query.Where(l => l.CreatedAt >= filter.FromDate.Value);
        if (filter.ToDate.HasValue)   query = query.Where(l => l.CreatedAt <= filter.ToDate.Value.AddDays(1));

        query = ApplyAdvancedFilters(query, filter);

        return filter.SortBy.ToLower() switch
        {
            "amount"     => filter.SortDir == "asc" ? query.OrderBy(l => l.RequestedAmount)  : query.OrderByDescending(l => l.RequestedAmount),
            "status"     => filter.SortDir == "asc" ? query.OrderBy(l => l.Status)            : query.OrderByDescending(l => l.Status),
            "loannumber" => filter.SortDir == "asc" ? query.OrderBy(l => l.LoanNumber)        : query.OrderByDescending(l => l.LoanNumber),
            // Productivity audit (P1) — lets the Applications list be
            // triaged by bureau risk grade (A best .. D worst, alphabetical
            // sort happens to match risk order for this project's grades),
            // same stored BureauReport.RiskGrade value the list projection
            // above already surfaces, not a new computation.
            "riskgrade"  => filter.SortDir == "asc"
                ? query.OrderBy(l => ctx.Set<BureauReport>().Where(b => b.CustomerId == l.CustomerId).OrderByDescending(b => b.ScoreGeneratedDate).Select(b => b.RiskGrade).FirstOrDefault())
                : query.OrderByDescending(l => ctx.Set<BureauReport>().Where(b => b.CustomerId == l.CustomerId).OrderByDescending(b => b.ScoreGeneratedDate).Select(b => b.RiskGrade).FirstOrDefault()),
            _            => filter.SortDir == "asc" ? query.OrderBy(l => l.CreatedAt)         : query.OrderByDescending(l => l.CreatedAt)
        };
    }

    /// <summary>
    /// Resolves a free-text search term to a LoanType, so "personal", "car" or
    /// "against property" narrow the list the way vanilla's
    /// loanTypeLabel(a.loanType) substring match did. Returns null when nothing
    /// matches, which the caller treats as "this scope contributes no rows"
    /// rather than "match everything".
    /// </summary>
    public async Task<LoanFilterOptionsDto> GetFilterOptionsAsync(int userId, string? role)
    {
        var scope = ApplyVisibilityScope(_ctx, _set.IncludeDeletedUsers(), userId, role);

        async Task<List<string>> Distinct(IQueryable<string?> values) =>
            (await values.Where(v => v != null && v != "").Distinct().ToListAsync())
                .Select(v => v!.Trim()).Where(v => v.Length > 0)
                .Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(v => v).ToList();

        var sales = await Distinct(scope.Select(l => (string?)l.CreatedBy.FullName));
        var assigned = await Distinct(scope.Where(l => l.AssignedTo != null).Select(l => (string?)l.AssignedTo!.FullName));

        // Channel lives inside Remarks ("Source: X | Channel: Y") — parse it the
        // same way WizardController.GetDraft does.
        var remarks = await scope.Where(l => l.Remarks != null && l.Remarks.Contains("Channel:"))
            .Select(l => l.Remarks!).Distinct().ToListAsync();
        var channels = remarks
            .Select(r => System.Text.RegularExpressions.Regex.Match(r, @"Channel:\s*([^|]+?)\s*(\||$)").Groups[1].Value)
            .Where(v => v.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(v => v).ToList();

        return new LoanFilterOptionsDto
        {
            SalesPeople = sales.Union(assigned, StringComparer.OrdinalIgnoreCase).OrderBy(v => v).ToList(),
            Locations   = await Distinct(scope.Where(l => l.Location != null).Select(l => (string?)l.Location!.Name)),
            Channels    = channels,
            Banks       = await Distinct(scope.Select(l => l.SelectedLenderNames)),
            Purposes    = await Distinct(scope.Select(l => l.Purpose)),
            EmpTypes    = await Distinct(scope.Select(l => l.Customer.EmploymentType)),
            Cities      = await Distinct(scope.Select(l => l.Customer.City)),
            States      = await Distinct(scope.Select(l => l.Customer.State)),
            Genders     = await Distinct(scope.Select(l => l.Customer.Gender)),
            DsaNames    = await Distinct(scope.Where(l => l.Dsa != null).Select(l => (string?)l.Dsa!.Name)),
            Partners    = await Distinct(scope.Where(l => l.Partner != null).Select(l => (string?)l.Partner!.Name)),
            Companies   = await Distinct(scope.Select(l => l.Customer.CompanyName)),
        };
    }

    /// <summary>
    /// Applications "Advanced Filter" predicates. They used to run in the
    /// browser on the current page only, so matches on other pages were never
    /// shown and totals/pagination ignored them. Same semantics as before:
    /// exact, case-insensitive text matches; inclusive numeric bounds; rows
    /// without a value never match a bound on that value.
    /// </summary>
    private static IQueryable<Loan> ApplyAdvancedFilters(IQueryable<Loan> query, LoanFilterDto f)
    {
        static string? Norm(string? v) => string.IsNullOrWhiteSpace(v) ? null : v.Trim().ToLower();

        if (f.MinAmount.HasValue) query = query.Where(l => l.RequestedAmount >= f.MinAmount.Value);
        if (f.MaxAmount.HasValue) query = query.Where(l => l.RequestedAmount <= f.MaxAmount.Value);
        if (f.MinCibil.HasValue)  query = query.Where(l => l.Customer.CibilScore != null && l.Customer.CibilScore >= f.MinCibil.Value);
        if (f.MaxCibil.HasValue)  query = query.Where(l => l.Customer.CibilScore != null && l.Customer.CibilScore <= f.MaxCibil.Value);
        if (f.MinSalary.HasValue) query = query.Where(l => l.Customer.MonthlyIncome != null && l.Customer.MonthlyIncome >= f.MinSalary.Value);
        if (f.MaxSalary.HasValue) query = query.Where(l => l.Customer.MonthlyIncome != null && l.Customer.MonthlyIncome <= f.MaxSalary.Value);

        if (Norm(f.SalesPerson) is { } sales)
            query = query.Where(l => l.CreatedBy.FullName.ToLower() == sales
                                  || (l.AssignedTo != null && l.AssignedTo.FullName.ToLower() == sales));
        if (Norm(f.Location) is { } loc)      query = query.Where(l => l.Location != null && l.Location.Name.ToLower() == loc);
        if (Norm(f.Bank) is { } bank)         query = query.Where(l => l.SelectedLenderNames != null && l.SelectedLenderNames.ToLower() == bank);
        if (Norm(f.Purpose) is { } purpose)   query = query.Where(l => l.Purpose != null && l.Purpose.ToLower() == purpose);
        if (Norm(f.EmpType) is { } emp)       query = query.Where(l => l.Customer.EmploymentType != null && l.Customer.EmploymentType.ToLower() == emp);
        if (Norm(f.City) is { } city)         query = query.Where(l => l.Customer.City != null && l.Customer.City.ToLower() == city);
        if (Norm(f.State) is { } state)       query = query.Where(l => l.Customer.State != null && l.Customer.State.ToLower() == state);
        if (Norm(f.Gender) is { } gender)     query = query.Where(l => l.Customer.Gender != null && l.Customer.Gender.ToLower() == gender);
        if (Norm(f.DsaName) is { } dsa)       query = query.Where(l => l.Dsa != null && l.Dsa.Name.ToLower() == dsa);
        if (Norm(f.PartnerName) is { } ptn)   query = query.Where(l => l.Partner != null && l.Partner.Name.ToLower() == ptn);
        if (Norm(f.CompanyName) is { } comp)  query = query.Where(l => l.Customer.CompanyName != null && l.Customer.CompanyName.ToLower() == comp);

        // The wizard writes Remarks as "Source: X | Channel: Y" (Channel last),
        // so the channel is either followed by " |" or ends the string.
        if (Norm(f.Channel) is { } channel)
        {
            var mid = "channel: " + channel + " |";
            var end = "channel: " + channel;
            query = query.Where(l => l.Remarks != null &&
                (l.Remarks.ToLower().Contains(mid) || l.Remarks.ToLower().EndsWith(end)));
        }
        return query;
    }

    private static LoanType? ParseLoanTypeToken(string term)
        => MatchEnumLabel<LoanType>(term, v => v switch
        {
            LoanType.Personal  => "personal loan",
            LoanType.Business  => "business loan",
            LoanType.Home      => "home loan",
            LoanType.Vehicle   => "vehicle loan",
            LoanType.Education => "education loan",
            LoanType.Car       => "car loan",
            LoanType.LAP       => "lap loan against property",
            LoanType.Overdraft => "overdraft cash credit",
            _                  => v.ToString().ToLower(),
        });

    /// <summary>Same idea for LoanStatus, using the business labels the UI shows.</summary>
    private static LoanStatus? ParseStatusToken(string term)
        => MatchEnumLabel<LoanStatus>(term, v => v switch
        {
            LoanStatus.Draft       => "draft personal details",
            LoanStatus.Submitted   => "submitted assign lender",
            LoanStatus.UnderReview => "under review underwriting",
            LoanStatus.OnHold      => "on hold",
            _                      => v.ToString().ToLower(),
        });

    private static TEnum? MatchEnumLabel<TEnum>(string term, Func<TEnum, string> label) where TEnum : struct, Enum
    {
        foreach (var v in Enum.GetValues<TEnum>())
        {
            if (v.ToString()!.ToLower().Contains(term) || label(v).Contains(term))
                return v;
        }
        return null;
    }

    public async Task<string?> GetLatestRiskGradeAsync(int customerId)
    {
        return await _ctx.Set<BureauReport>()
            .Where(b => b.CustomerId == customerId)
            .OrderByDescending(b => b.ScoreGeneratedDate)
            .Select(b => b.RiskGrade)
            .FirstOrDefaultAsync();
    }

    public async Task<string> GenerateLoanNumberAsync()
    {
        // EFIN + current year + 7-digit random (non-sequential) number.
        // Year always reflects the current system year automatically.
        var year = DateTime.UtcNow.Year;
        string candidate;
        do
        {
            var suffix = System.Security.Cryptography.RandomNumberGenerator.GetInt32(1000000, 10000000).ToString();
            candidate = $"EFIN{year}{suffix}";
        }
        // Re-roll on collision to guarantee uniqueness across all statuses
        // (Draft, Processing, Completed, Rejected, Resumed all live in the same table).
        while (await _set.AnyAsync(l => l.LoanNumber == candidate));
        return candidate;
    }

    public async Task<DashboardStatsDto> GetDashboardStatsAsync(int? userId = null, string? role = null)
    {
        // Use SQL aggregation instead of loading all loans into memory.
        // Phase 2B — dashboard/recent-loans uses the same visibility scope as
        // the list and detail endpoints, so a Sales/Dsa/Partner/Manager user
        // never sees totals or "recent loans" that include loans outside their scope.
        var baseQuery = _set.IncludeDeletedUsers();
        if (userId.HasValue)
            baseQuery = ApplyVisibilityScope(_ctx, baseQuery, userId.Value, role);

        // Single aggregation query — no ToListAsync() on full table
        var stats = await baseQuery.GroupBy(_ => 1).Select(g => new
        {
            Total        = g.Count(),
            Pending      = g.Count(l => l.Status == LoanStatus.Submitted || l.Status == LoanStatus.UnderReview),
            Approved     = g.Count(l => l.Status == LoanStatus.Approved),
            Rejected     = g.Count(l => l.Status == LoanStatus.Rejected),
            Disbursed    = g.Count(l => l.Status == LoanStatus.Disbursed),
            TotalReq     = g.Sum(l => l.RequestedAmount),
            TotalAppr    = g.Where(l => l.ApprovedAmount != null).Sum(l => l.ApprovedAmount ?? 0),
            TotalDisb    = g.Where(l => l.Status == LoanStatus.Disbursed && l.ApprovedAmount != null)
                            .Sum(l => l.ApprovedAmount ?? 0),
        }).FirstOrDefaultAsync();

        var customers = await _ctx.Set<Customer>().CountAsync(c => !c.IsDeleted);

        // Gap 2 — Recent Activity feed, sourced from real persisted
        // LoanStatusHistory rows (same visibility scope as everything else
        // on this dashboard) rather than RecentLoans' creation-date ordering
        // below, so a status change on an older loan surfaces here too.
        var recentActivity = await GetRecentActivityAsync(userId, role, 15);

        var recent = await baseQuery
            .Include(l => l.Customer).Include(l => l.CreatedBy).Include(l => l.AssignedTo).Include(l => l.LoginUser)
            .OrderByDescending(l => l.CreatedAt).Take(10)
            .Select(l => new LoanListDto
            {
                Id              = l.Id,
                LoanNumber      = l.LoanNumber,
                LoanType        = l.LoanType.ToString(),
                Status          = l.Status.ToString(),
                RequestedAmount = l.RequestedAmount,
                ApprovedAmount  = l.ApprovedAmount,
                InterestRate    = l.InterestRate,
                TenureMonths    = l.TenureMonths,
                CustomerName    = l.Customer.FullName,
                CustomerPhone   = l.Customer.Phone,
                CustomerCibilScore = l.Customer.CibilScore,
                LocationName    = l.Location != null ? l.Location.Name : null,
                Purpose         = l.Purpose,
                Remarks         = l.Remarks,
                SelectedLenderNames = l.SelectedLenderNames,
                DsaName         = l.Dsa != null ? l.Dsa.Name : null,
                PartnerName     = l.Partner != null ? l.Partner.Name : null,
                CustomerCity    = l.Customer.City,
                CustomerState   = l.Customer.State,
                CustomerGender  = l.Customer.Gender,
                CustomerEmploymentType = l.Customer.EmploymentType,
                CustomerCompanyName    = l.Customer.CompanyName,
                CreatedByUserId        = l.CreatedByUserId,
                AssignedToUserId       = l.AssignedToUserId,
                CustomerMonthlyIncome  = l.Customer.MonthlyIncome,
                CreatedByName   = l.CreatedBy.FullName,
                AssignedToName  = l.AssignedTo != null ? l.AssignedTo.FullName : null,
                LoginUserName   = l.LoginUser  != null ? l.LoginUser.FullName  : null,
                RiskGrade       = _ctx.Set<BureauReport>()
                                    .Where(b => b.CustomerId == l.CustomerId)
                                    .OrderByDescending(b => b.ScoreGeneratedDate)
                                    .Select(b => b.RiskGrade)
                                    .FirstOrDefault(),
                CreatedAt       = l.CreatedAt
            }).ToListAsync();

        return new DashboardStatsDto
        {
            TotalLoans           = stats?.Total ?? 0,
            TotalCustomers       = customers,
            PendingLoans         = stats?.Pending ?? 0,
            ApprovedLoans        = stats?.Approved ?? 0,
            RejectedLoans        = stats?.Rejected ?? 0,
            DisbursedLoans       = stats?.Disbursed ?? 0,
            TotalRequestedAmount = stats?.TotalReq ?? 0,
            TotalApprovedAmount  = stats?.TotalAppr ?? 0,
            TotalDisbursedAmount = stats?.TotalDisb ?? 0,
            RecentLoans          = recent,
            RecentActivity       = recentActivity
        };
    }

    /// <summary>
    /// Dashboard Recent Activity feed (Gap 2) — a global, cross-loan feed of
    /// real persisted status transitions, built from LoanStatusHistory (the
    /// audit trail LoanService already writes on every create/status-change:
    /// CreateAsync, UpdateStatusAsync, admin overrides, hold/release, etc.).
    /// It reads from the database instead of an in-memory array that resets
    /// on every page load, so it survives refreshes/restarts and reflects
    /// every visible loan's real history, not just the current browser
    /// session's events. Same role-based visibility scope as every other
    /// loan read (Phase 2B) — a loan outside the caller's scope contributes
    /// no activity rows either.
    ///
    /// RE-AUDITED AGAIN (Phase 9 — Recent Activity final gap pass). The
    /// PENDING categories the previous pass of this comment left out are now
    /// split into two buckets after inspecting AuditLogs/AuditMiddleware/
    /// TrackingController/UsersController/IncredController directly:
    ///  - Users (create/update/delete/reset-password), Tracking (per-loan
    ///    timeline-entry edit/delete — TrackingController's PUT/DELETE), and
    ///    Incred (lender-sync POST/PATCH writes) DO have a genuine persisted
    ///    source: AuditMiddleware writes an AuditLogs row for every
    ///    successful POST/PUT/PATCH/DELETE to /api/* with EntityName taken
    ///    from the URL path segment, which is exactly "Users"/"Tracking"/
    ///    "Incred" for these controllers' routes. Reused below via the
    ///    already-Admin-only AuditLogs table/AuditController — no new audit
    ///    system.
    ///  - Custom-role create/update/delete (efin-app.js:28658/28682) still
    ///    has NO reliably attributable persisted source: SettingsController
    ///    stores the whole role/permission map as one blob under the
    ///    "efin_role_permissions" key, so an AuditLogs row for it says only
    ///    "Settings updated", indistinguishable from a logo/email-config/
    ///    AI-key change. Reporting that as "role created" would be
    ///    fabricating detail the data doesn't contain, so it is genuinely
    ///    left PENDING rather than guessed at. "Invited user" is folded into
    ///    the Users bucket rather than its own line for the same reason —
    ///    invite-completion (efin-app.js:38016) has no dedicated backend
    ///    action; it ends in a Users photo/password write that AuditLogs
    ///    already records as a generic Users update.
    ///
    /// The merged AuditLogs-sourced half of this feed is gated to Admin
    /// callers only: AuditController (the existing Audit Log page) is
    /// already [Authorize(Roles="Admin")], i.e. the product already treats
    /// this data as admin-sensitive (who reset whose password, who edited a
    /// loan's timeline, ...). Merging it into every role's dashboard here
    /// would be a new access-control regression, not a parity fix, so
    /// non-Admin callers keep getting the Loan-only feed exactly as before.
    /// </summary>
    private async Task<List<RecentActivityDto>> GetRecentActivityAsync(int? userId, string? role, int take)
    {
        var loanScope = _set.IncludeDeletedUsers();
        if (userId.HasValue)
            loanScope = ApplyVisibilityScope(_ctx, loanScope, userId.Value, role);

        var loanActivity = await (
            from h in _ctx.LoanStatusHistories
            join l in loanScope on h.LoanId equals l.Id
            orderby h.CreatedAt descending
            select new RecentActivityDto
            {
                Type         = "Loan",
                LoanId       = l.Id,
                LoanNumber   = l.LoanNumber,
                CustomerName = l.Customer.FullName,
                Status       = h.ToStatus.ToString(),
                ChangedAt    = h.CreatedAt
            }
        ).Take(take).ToListAsync();

        var auditActivity = new List<RecentActivityDto>();
        if (string.Equals(role, "Admin", StringComparison.OrdinalIgnoreCase))
        {
            var auditEntityNames = new[] { "Users", "Tracking", "Incred" };
            var auditRows = await _ctx.AuditLogs
                .Where(a => auditEntityNames.Contains(a.EntityName))
                .OrderByDescending(a => a.CreatedAt)
                .Take(take)
                .ToListAsync();

            auditActivity = auditRows.Select(a => new RecentActivityDto
            {
                Type        = "Audit",
                EntityName  = a.EntityName,
                Action      = a.Action,
                Description = BuildAuditDescription(a),
                ChangedAt   = a.CreatedAt
            }).ToList();
        }

        return loanActivity
            .Concat(auditActivity)
            .OrderByDescending(a => a.ChangedAt)
            .Take(take)
            .ToList();
    }

    /// <summary>Builds an honest, generic summary from an AuditLog row —
    /// who + action + which record. Deliberately does NOT try to reproduce
    /// Vanilla's exact pushActivity() wording (e.g. old-name→new-name) since
    /// AuditMiddleware's generic write log never captured that field-level
    /// detail in the first place — this describes the real row as it
    /// actually is, rather than fabricating specificity it doesn't have.</summary>
    private static string BuildAuditDescription(AuditLog a)
    {
        var who = !string.IsNullOrWhiteSpace(a.UserName) ? a.UserName : "System";
        var verb = a.Action switch
        {
            "Created"       => "created",
            "Updated"       => "updated",
            "Deleted"       => "deleted",
            "StatusChanged" => "changed the status of",
            _               => a.Action?.ToLowerInvariant() ?? "modified"
        };
        var target = a.EntityId != null ? $"{a.EntityName} #{a.EntityId}" : a.EntityName;
        return $"{who} {verb} {target}";
    }

    public async Task<IEnumerable<Loan>> GetLoansByCustomerAsync(int customerId) =>
        await _set.Where(l => l.CustomerId == customerId).ToListAsync();
}
