using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using LoanMS.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using FluentAssertions;
using Xunit;

namespace LoanMS.Tests.Repositories;

/// <summary>
/// NOTE ON VERIFICATION: same caveat as the other repository/controller test
/// files in this project — this suite could not be executed in the sandbox
/// that produced it (no .NET SDK could be installed there; the network
/// allowlist doesn't include the Microsoft/NuGet feeds `dotnet build`/`dotnet
/// test` need). Written against the actual LoanRepository.ApplyVisibilityScope
/// source (entity fields, Team/TeamMember relationships all cross-checked
/// against the real files) but not compiler- or run-verified. Run `dotnet
/// test` locally before relying on these.
///
/// Phase 3 — Loan Visibility for Missing Roles: TeamLeader, LoginTeam, and
/// OperationManager now get a real scope inside ApplyVisibilityScope, reusing
/// the existing Team/TeamMember/Location relationships (confirmed with the
/// project owner — see LoanRepository.cs comments). LocationHead and
/// ProductTeam are left unchanged (no loans visible) since no existing field
/// ties either role to a Location or product — out of scope for this phase.
/// </summary>
public class LoanRepositoryTests
{
    private static AppDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(options);
    }

    private static Loan MakeLoan(int id, int customerId, int locationId, string loanNumberSuffix) => new()
    {
        Id = id, LoanNumber = $"EFIN2026TEST{loanNumberSuffix}", LoanType = LoanType.Personal, Status = LoanStatus.Draft,
        RequestedAmount = 100000, InterestRate = 10, TenureMonths = 12,
        CustomerId = customerId, CreatedByUserId = 999, LocationId = locationId
    };

    // ── TeamLeader / Manager (Sales hierarchy — team-membership rule) ──────────
    // Verified against the reference Odoo project: sees loans whose
    // creator/assignee is a member of a Sales Team this user leads or
    // belongs to — NOT a Location-based rule (that was the old Phase 3
    // implementation, corrected here per the final spec).

    [Fact]
    public async Task TeamLeader_AuthorizedLoan_Visible()
    {
        var db = CreateContext();
        var customer = new Customer { Id = 1, FullName = "C1", Email = "c1@t.com", Phone = "9000000001" };
        var teamLeaderUser = new User { Id = 1, FullName = "TL", Email = "tl@efin.com", Role = UserRole.TeamLeader };
        var salesExecUser  = new User { Id = 2, FullName = "SE", Email = "se@efin.com", Role = UserRole.Sales };
        var location = new Location { Id = 1, Name = "Mumbai", City = "Mumbai", State = "MH" };
        var team = new Team { Id = 1, Name = "Sales A", Type = "Sales", LocationId = location.Id, TeamLeadUserId = teamLeaderUser.Id };
        db.AddRange(customer, teamLeaderUser, salesExecUser, location, team);
        await db.SaveChangesAsync();
        // salesExecUser is a MEMBER of the team the TeamLeader leads.
        db.Set<TeamMember>().Add(new TeamMember { TeamId = team.Id, UserId = salesExecUser.Id });
        db.Loans.Add(new Loan
        {
            Id = 1, LoanNumber = "EFIN2026TEST001", LoanType = LoanType.Personal, Status = LoanStatus.Draft,
            RequestedAmount = 100000, InterestRate = 10, TenureMonths = 12,
            CustomerId = customer.Id, CreatedByUserId = salesExecUser.Id, LocationId = location.Id
        });
        await db.SaveChangesAsync();

        var repo = new LoanRepository(db);
        var result = await repo.GetPagedAsync(new LoanFilterDto(), currentUserId: teamLeaderUser.Id, currentUserRole: "TeamLeader");

        result.Items.Should().Contain(l => l.Id == 1);
    }

    [Fact]
    public async Task TeamLeader_UnauthorizedLoan_Hidden()
    {
        var db = CreateContext();
        var customer = new Customer { Id = 1, FullName = "C1", Email = "c1@t.com", Phone = "9000000001" };
        var teamLeaderUser = new User { Id = 1, FullName = "TL", Email = "tl@efin.com", Role = UserRole.TeamLeader };
        var outsiderUser   = new User { Id = 3, FullName = "Outsider", Email = "out@efin.com", Role = UserRole.Sales };
        var location = new Location { Id = 1, Name = "Mumbai", City = "Mumbai", State = "MH" };
        var team = new Team { Id = 1, Name = "Sales A", Type = "Sales", LocationId = location.Id, TeamLeadUserId = teamLeaderUser.Id };
        db.AddRange(customer, teamLeaderUser, outsiderUser, location, team);
        await db.SaveChangesAsync();
        // outsiderUser is NOT a member of the TeamLeader's team — even
        // though the loan is at the SAME Location, it must stay hidden
        // (this is the exact behavior corrected by the team-membership rule).
        db.Loans.Add(new Loan
        {
            Id = 2, LoanNumber = "EFIN2026TEST002", LoanType = LoanType.Personal, Status = LoanStatus.Draft,
            RequestedAmount = 100000, InterestRate = 10, TenureMonths = 12,
            CustomerId = customer.Id, CreatedByUserId = outsiderUser.Id, LocationId = location.Id
        });
        await db.SaveChangesAsync();

        var repo = new LoanRepository(db);
        var result = await repo.GetPagedAsync(new LoanFilterDto(), currentUserId: teamLeaderUser.Id, currentUserRole: "TeamLeader");

        result.Items.Should().NotContain(l => l.Id == 2);
    }

    [Fact]
    public async Task TeamLeader_SelfCreatedLoan_Visible()
    {
        // The TeamLeader themself (as the team lead, not a TeamMember row)
        // creating a loan directly must also be visible to themself.
        var db = CreateContext();
        var customer = new Customer { Id = 1, FullName = "C1", Email = "c1@t.com", Phone = "9000000001" };
        var teamLeaderUser = new User { Id = 1, FullName = "TL", Email = "tl@efin.com", Role = UserRole.TeamLeader };
        var location = new Location { Id = 1, Name = "Mumbai", City = "Mumbai", State = "MH" };
        var team = new Team { Id = 1, Name = "Sales A", Type = "Sales", LocationId = location.Id, TeamLeadUserId = teamLeaderUser.Id };
        db.AddRange(customer, teamLeaderUser, location, team);
        db.Loans.Add(new Loan
        {
            Id = 3, LoanNumber = "EFIN2026TEST003", LoanType = LoanType.Personal, Status = LoanStatus.Draft,
            RequestedAmount = 100000, InterestRate = 10, TenureMonths = 12,
            CustomerId = customer.Id, CreatedByUserId = teamLeaderUser.Id, LocationId = location.Id
        });
        await db.SaveChangesAsync();

        var repo = new LoanRepository(db);
        var result = await repo.GetPagedAsync(new LoanFilterDto(), currentUserId: teamLeaderUser.Id, currentUserRole: "TeamLeader");

        result.Items.Should().Contain(l => l.Id == 3);
    }

    // ── LoginTeam ─────────────────────────────────────────────────────────────

    // ── LoginTeam (own personal processing queue via Loan.LoginUserId) ─────────

    [Fact]
    public async Task LoginTeam_OwnAssignedLoan_Visible()
    {
        var db = CreateContext();
        var customer = new Customer { Id = 1, FullName = "C1", Email = "c1@t.com", Phone = "9000000001" };
        var loginTeamUser = new User { Id = 1, FullName = "LT Member", Email = "lt@efin.com", Role = UserRole.LoginTeam };
        db.AddRange(customer, loginTeamUser);
        db.Loans.Add(new Loan
        {
            Id = 1, LoanNumber = "EFIN2026TEST003", LoanType = LoanType.Personal, Status = LoanStatus.Draft,
            RequestedAmount = 100000, InterestRate = 10, TenureMonths = 12,
            CustomerId = customer.Id, CreatedByUserId = 999, LoginUserId = loginTeamUser.Id
        });
        await db.SaveChangesAsync();

        var repo = new LoanRepository(db);
        var result = await repo.GetPagedAsync(new LoanFilterDto(), currentUserId: loginTeamUser.Id, currentUserRole: "LoginTeam");

        result.Items.Should().Contain(l => l.Id == 1);
    }

    [Fact]
    public async Task LoginTeam_AnotherMembersLoan_Hidden()
    {
        // Even within the SAME Login Team, a member sees only their own
        // personally-assigned queue — not a teammate's.
        var db = CreateContext();
        var customer = new Customer { Id = 1, FullName = "C1", Email = "c1@t.com", Phone = "9000000001" };
        var loginTeamUser = new User { Id = 1, FullName = "LT Member", Email = "lt@efin.com", Role = UserRole.LoginTeam };
        var teammate      = new User { Id = 2, FullName = "Teammate", Email = "tm@efin.com", Role = UserRole.LoginTeam };
        var location = new Location { Id = 1, Name = "Mumbai", City = "Mumbai", State = "MH" };
        var loginTeam = new Team { Id = 1, Name = "Login A", Type = "Login", LocationId = location.Id };
        db.AddRange(customer, loginTeamUser, teammate, location, loginTeam);
        await db.SaveChangesAsync();
        db.Set<TeamMember>().AddRange(
            new TeamMember { TeamId = loginTeam.Id, UserId = loginTeamUser.Id },
            new TeamMember { TeamId = loginTeam.Id, UserId = teammate.Id });
        db.Loans.Add(new Loan
        {
            Id = 2, LoanNumber = "EFIN2026TEST004", LoanType = LoanType.Personal, Status = LoanStatus.Draft,
            RequestedAmount = 100000, InterestRate = 10, TenureMonths = 12,
            CustomerId = customer.Id, CreatedByUserId = 999, LoginUserId = teammate.Id
        });
        await db.SaveChangesAsync();

        var repo = new LoanRepository(db);
        var result = await repo.GetPagedAsync(new LoanFilterDto(), currentUserId: loginTeamUser.Id, currentUserRole: "LoginTeam");

        result.Items.Should().NotContain(l => l.Id == 2);
    }

    [Fact]
    public async Task LoginTeam_UnassignedLoan_Hidden()
    {
        var db = CreateContext();
        var customer = new Customer { Id = 1, FullName = "C1", Email = "c1@t.com", Phone = "9000000001" };
        var loginTeamUser = new User { Id = 1, FullName = "LT Member", Email = "lt@efin.com", Role = UserRole.LoginTeam };
        db.AddRange(customer, loginTeamUser);
        db.Loans.Add(new Loan
        {
            Id = 3, LoanNumber = "EFIN2026TEST005", LoanType = LoanType.Personal, Status = LoanStatus.Draft,
            RequestedAmount = 100000, InterestRate = 10, TenureMonths = 12,
            CustomerId = customer.Id, CreatedByUserId = 999, LoginUserId = null
        });
        await db.SaveChangesAsync();

        var repo = new LoanRepository(db);
        var result = await repo.GetPagedAsync(new LoanFilterDto(), currentUserId: loginTeamUser.Id, currentUserRole: "LoginTeam");

        result.Items.Should().NotContain(l => l.Id == 3);
    }

    // ── OperationManager (supervises whole Login-team queue) ────────────────────

    [Fact]
    public async Task OperationManager_TeamMembersLoan_Visible()
    {
        var db = CreateContext();
        var customer = new Customer { Id = 1, FullName = "C1", Email = "c1@t.com", Phone = "9000000001" };
        var opsManagerUser = new User { Id = 1, FullName = "Ops Mgr", Email = "ops@efin.com", Role = UserRole.OperationManager };
        var loginUser       = new User { Id = 2, FullName = "Login User", Email = "lu@efin.com", Role = UserRole.LoginTeam };
        var location = new Location { Id = 1, Name = "Mumbai", City = "Mumbai", State = "MH" };
        var loginTeam = new Team { Id = 1, Name = "Login A", Type = "Login", LocationId = location.Id, TeamLeadUserId = opsManagerUser.Id };
        db.AddRange(customer, opsManagerUser, loginUser, location, loginTeam);
        await db.SaveChangesAsync();
        db.Set<TeamMember>().Add(new TeamMember { TeamId = loginTeam.Id, UserId = loginUser.Id });
        db.Loans.Add(new Loan
        {
            Id = 1, LoanNumber = "EFIN2026TEST006", LoanType = LoanType.Personal, Status = LoanStatus.Draft,
            RequestedAmount = 100000, InterestRate = 10, TenureMonths = 12,
            CustomerId = customer.Id, CreatedByUserId = 999, LoginUserId = loginUser.Id
        });
        await db.SaveChangesAsync();

        var repo = new LoanRepository(db);
        var result = await repo.GetPagedAsync(new LoanFilterDto(), currentUserId: opsManagerUser.Id, currentUserRole: "OperationManager");

        result.Items.Should().Contain(l => l.Id == 1);
    }

    [Fact]
    public async Task OperationManager_OtherTeamsLoan_Hidden()
    {
        var db = CreateContext();
        var customer = new Customer { Id = 1, FullName = "C1", Email = "c1@t.com", Phone = "9000000001" };
        var opsManagerUser = new User { Id = 1, FullName = "Ops Mgr", Email = "ops@efin.com", Role = UserRole.OperationManager };
        var otherLoginUser  = new User { Id = 3, FullName = "Other Login", Email = "ol@efin.com", Role = UserRole.LoginTeam };
        var myLocation    = new Location { Id = 1, Name = "Mumbai", City = "Mumbai", State = "MH" };
        var otherLocation = new Location { Id = 2, Name = "Delhi",  City = "Delhi",  State = "DL" };
        var myTeam    = new Team { Id = 1, Name = "Login A", Type = "Login", LocationId = myLocation.Id, TeamLeadUserId = opsManagerUser.Id };
        var otherTeam = new Team { Id = 2, Name = "Login B", Type = "Login", LocationId = otherLocation.Id };
        db.AddRange(customer, opsManagerUser, otherLoginUser, myLocation, otherLocation, myTeam, otherTeam);
        await db.SaveChangesAsync();
        db.Set<TeamMember>().Add(new TeamMember { TeamId = otherTeam.Id, UserId = otherLoginUser.Id });
        db.Loans.Add(new Loan
        {
            Id = 2, LoanNumber = "EFIN2026TEST007", LoanType = LoanType.Personal, Status = LoanStatus.Draft,
            RequestedAmount = 100000, InterestRate = 10, TenureMonths = 12,
            CustomerId = customer.Id, CreatedByUserId = 999, LoginUserId = otherLoginUser.Id
        });
        await db.SaveChangesAsync();

        var repo = new LoanRepository(db);
        var result = await repo.GetPagedAsync(new LoanFilterDto(), currentUserId: opsManagerUser.Id, currentUserRole: "OperationManager");

        result.Items.Should().NotContain(l => l.Id == 2);
    }

    [Fact]
    public async Task OperationManager_LeadsSalesTeamOnly_LoanHidden()
    {
        // A user who leads a Sales-type team must not get visibility via the
        // OperationManager rule — Type == "Login" is required.
        var db = CreateContext();
        var customer = new Customer { Id = 1, FullName = "C1", Email = "c1@t.com", Phone = "9000000001" };
        var user     = new User { Id = 1, FullName = "Lead", Email = "l@efin.com", Role = UserRole.OperationManager };
        var location = new Location { Id = 1, Name = "Mumbai", City = "Mumbai", State = "MH" };
        var salesTeam = new Team { Id = 1, Name = "Sales A", Type = "Sales", LocationId = location.Id, TeamLeadUserId = user.Id };
        db.AddRange(customer, user, location, salesTeam);
        db.Loans.Add(new Loan
        {
            Id = 3, LoanNumber = "EFIN2026TEST008", LoanType = LoanType.Personal, Status = LoanStatus.Draft,
            RequestedAmount = 100000, InterestRate = 10, TenureMonths = 12,
            CustomerId = customer.Id, CreatedByUserId = 999, LoginUserId = user.Id
        });
        await db.SaveChangesAsync();

        var repo = new LoanRepository(db);
        var result = await repo.GetPagedAsync(new LoanFilterDto(), currentUserId: user.Id, currentUserRole: "OperationManager");

        result.Items.Should().NotContain(l => l.Id == 3);
    }

    // ── LocationHead (location-wide, independent of team) ───────────────────────

    [Fact]
    public async Task LocationHead_SameLocationLoan_Visible()
    {
        var db = CreateContext();
        var customer = new Customer { Id = 1, FullName = "C1", Email = "c1@t.com", Phone = "9000000001" };
        var location = new Location { Id = 1, Name = "Mumbai", City = "Mumbai", State = "MH" };
        var locationHeadUser = new User { Id = 1, FullName = "LH", Email = "lh@efin.com", Role = UserRole.LocationHead, LocationId = location.Id };
        db.AddRange(customer, location, locationHeadUser);
        db.Loans.Add(MakeLoan(1, customer.Id, location.Id, "009"));
        await db.SaveChangesAsync();

        var repo = new LoanRepository(db);
        var result = await repo.GetPagedAsync(new LoanFilterDto(), currentUserId: locationHeadUser.Id, currentUserRole: "LocationHead");

        result.Items.Should().Contain(l => l.Id == 1);
    }

    [Fact]
    public async Task LocationHead_OtherLocationLoan_Hidden()
    {
        var db = CreateContext();
        var customer = new Customer { Id = 1, FullName = "C1", Email = "c1@t.com", Phone = "9000000001" };
        var myLocation    = new Location { Id = 1, Name = "Mumbai", City = "Mumbai", State = "MH" };
        var otherLocation = new Location { Id = 2, Name = "Delhi",  City = "Delhi",  State = "DL" };
        var locationHeadUser = new User { Id = 1, FullName = "LH", Email = "lh@efin.com", Role = UserRole.LocationHead, LocationId = myLocation.Id };
        db.AddRange(customer, myLocation, otherLocation, locationHeadUser);
        db.Loans.Add(MakeLoan(2, customer.Id, otherLocation.Id, "010"));
        await db.SaveChangesAsync();

        var repo = new LoanRepository(db);
        var result = await repo.GetPagedAsync(new LoanFilterDto(), currentUserId: locationHeadUser.Id, currentUserRole: "LocationHead");

        result.Items.Should().NotContain(l => l.Id == 2);
    }

    [Fact]
    public async Task LocationHead_NoLocationAssigned_SeesNothing()
    {
        var db = CreateContext();
        var customer = new Customer { Id = 1, FullName = "C1", Email = "c1@t.com", Phone = "9000000001" };
        var location = new Location { Id = 1, Name = "Mumbai", City = "Mumbai", State = "MH" };
        var locationHeadUser = new User { Id = 1, FullName = "LH", Email = "lh@efin.com", Role = UserRole.LocationHead, LocationId = null };
        db.AddRange(customer, location, locationHeadUser);
        db.Loans.Add(MakeLoan(1, customer.Id, location.Id, "011"));
        await db.SaveChangesAsync();

        var repo = new LoanRepository(db);
        var result = await repo.GetPagedAsync(new LoanFilterDto(), currentUserId: locationHeadUser.Id, currentUserRole: "LocationHead");

        result.Items.Should().BeEmpty();
    }

    [Fact]
    public async Task ProductTeam_StillSeesNoLoans_Unchanged()
    {
        var db = CreateContext();
        var customer = new Customer { Id = 1, FullName = "C1", Email = "c1@t.com", Phone = "9000000001" };
        var location = new Location { Id = 1, Name = "Mumbai", City = "Mumbai", State = "MH" };
        db.AddRange(customer, location);
        db.Loans.Add(MakeLoan(1, customer.Id, location.Id, "012"));
        await db.SaveChangesAsync();

        var repo = new LoanRepository(db);
        var result = await repo.GetPagedAsync(new LoanFilterDto(), currentUserId: 1, currentUserRole: "ProductTeam");

        result.Items.Should().BeEmpty();
    }

    // ── Dsa (own cases + linked-Partner cases via DsaPartner.MappedDsaId) ───────

    [Fact]
    public async Task Dsa_LinkedPartnersLoan_Visible()
    {
        var db = CreateContext();
        var customer = new Customer { Id = 1, FullName = "C1", Email = "c1@t.com", Phone = "9000000001" };
        var dsaUser     = new User { Id = 1, FullName = "DSA", Email = "dsa@efin.com", Role = UserRole.Dsa };
        var dsaRecord   = new DsaPartner { Id = 1, Name = "DSA Co", Code = "D1", PartnerType = PartnerType.Dsa, LinkedUserId = dsaUser.Id };
        var partnerRecord = new DsaPartner { Id = 2, Name = "Partner Co", Code = "P1", PartnerType = PartnerType.Partner, MappedDsaId = dsaRecord.Id };
        db.AddRange(customer, dsaUser, dsaRecord, partnerRecord);
        db.Loans.Add(new Loan
        {
            Id = 1, LoanNumber = "EFIN2026TEST013", LoanType = LoanType.Personal, Status = LoanStatus.Draft,
            RequestedAmount = 100000, InterestRate = 10, TenureMonths = 12,
            CustomerId = customer.Id, CreatedByUserId = 999, PartnerId = partnerRecord.Id
        });
        await db.SaveChangesAsync();

        var repo = new LoanRepository(db);
        var result = await repo.GetPagedAsync(new LoanFilterDto(), currentUserId: dsaUser.Id, currentUserRole: "Dsa");

        result.Items.Should().Contain(l => l.Id == 1);
    }

    [Fact]
    public async Task Dsa_UnlinkedPartnersLoan_Hidden()
    {
        // A Partner with NO MappedDsaId is unaffected — stays hidden from
        // every DSA, per the business owner's exact rule.
        var db = CreateContext();
        var customer = new Customer { Id = 1, FullName = "C1", Email = "c1@t.com", Phone = "9000000001" };
        var dsaUser        = new User { Id = 1, FullName = "DSA", Email = "dsa@efin.com", Role = UserRole.Dsa };
        var unlinkedPartner = new DsaPartner { Id = 3, Name = "Independent Partner", Code = "P2", PartnerType = PartnerType.Partner, MappedDsaId = null };
        db.AddRange(customer, dsaUser, unlinkedPartner);
        db.Loans.Add(new Loan
        {
            Id = 2, LoanNumber = "EFIN2026TEST014", LoanType = LoanType.Personal, Status = LoanStatus.Draft,
            RequestedAmount = 100000, InterestRate = 10, TenureMonths = 12,
            CustomerId = customer.Id, CreatedByUserId = 999, PartnerId = unlinkedPartner.Id
        });
        await db.SaveChangesAsync();

        var repo = new LoanRepository(db);
        var result = await repo.GetPagedAsync(new LoanFilterDto(), currentUserId: dsaUser.Id, currentUserRole: "Dsa");

        result.Items.Should().NotContain(l => l.Id == 2);
    }

    // ── Accounts (financially-relevant stages only) ─────────────────────────────

    [Fact]
    public async Task Accounts_ApprovedLoan_Visible()
    {
        var db = CreateContext();
        var customer = new Customer { Id = 1, FullName = "C1", Email = "c1@t.com", Phone = "9000000001" };
        db.AddRange(customer);
        db.Loans.Add(new Loan
        {
            Id = 1, LoanNumber = "EFIN2026TEST017", LoanType = LoanType.Personal, Status = LoanStatus.Approved,
            RequestedAmount = 100000, InterestRate = 10, TenureMonths = 12,
            CustomerId = customer.Id, CreatedByUserId = 999
        });
        await db.SaveChangesAsync();

        var repo = new LoanRepository(db);
        var result = await repo.GetPagedAsync(new LoanFilterDto(), currentUserId: 1, currentUserRole: "Accounts");

        result.Items.Should().Contain(l => l.Id == 1);
    }

    [Fact]
    public async Task Accounts_DisbursedLoan_Visible()
    {
        var db = CreateContext();
        var customer = new Customer { Id = 1, FullName = "C1", Email = "c1@t.com", Phone = "9000000001" };
        db.AddRange(customer);
        db.Loans.Add(new Loan
        {
            Id = 2, LoanNumber = "EFIN2026TEST018", LoanType = LoanType.Personal, Status = LoanStatus.Disbursed,
            RequestedAmount = 100000, InterestRate = 10, TenureMonths = 12,
            CustomerId = customer.Id, CreatedByUserId = 999
        });
        await db.SaveChangesAsync();

        var repo = new LoanRepository(db);
        var result = await repo.GetPagedAsync(new LoanFilterDto(), currentUserId: 1, currentUserRole: "Accounts");

        result.Items.Should().Contain(l => l.Id == 2);
    }

    [Fact]
    public async Task Accounts_DraftLoan_Hidden()
    {
        var db = CreateContext();
        var customer = new Customer { Id = 1, FullName = "C1", Email = "c1@t.com", Phone = "9000000001" };
        db.AddRange(customer);
        db.Loans.Add(new Loan
        {
            Id = 3, LoanNumber = "EFIN2026TEST019", LoanType = LoanType.Personal, Status = LoanStatus.Draft,
            RequestedAmount = 100000, InterestRate = 10, TenureMonths = 12,
            CustomerId = customer.Id, CreatedByUserId = 999
        });
        await db.SaveChangesAsync();

        var repo = new LoanRepository(db);
        var result = await repo.GetPagedAsync(new LoanFilterDto(), currentUserId: 1, currentUserRole: "Accounts");

        result.Items.Should().NotContain(l => l.Id == 3);
    }

    // ── Regression: Admin / Sales / Manager unchanged ──────────────────────────

    [Fact]
    public async Task Admin_SeesAllLoans_Unchanged()
    {
        var db = CreateContext();
        var customer  = new Customer { Id = 1, FullName = "C1", Email = "c1@t.com", Phone = "9000000001" };
        var location1 = new Location { Id = 1, Name = "Mumbai", City = "Mumbai", State = "MH" };
        var location2 = new Location { Id = 2, Name = "Delhi",  City = "Delhi",  State = "DL" };
        db.AddRange(customer, location1, location2);
        db.Loans.Add(MakeLoan(1, customer.Id, location1.Id, "011"));
        db.Loans.Add(MakeLoan(2, customer.Id, location2.Id, "012"));
        await db.SaveChangesAsync();

        var repo = new LoanRepository(db);
        var result = await repo.GetPagedAsync(new LoanFilterDto(), currentUserId: 999, currentUserRole: "Admin");

        result.Items.Should().Contain(l => l.Id == 1);
        result.Items.Should().Contain(l => l.Id == 2);
    }

    [Fact]
    public async Task Sales_OwnLoanVisible_OthersHidden_Unchanged()
    {
        var db = CreateContext();
        var customer  = new Customer { Id = 1, FullName = "C1", Email = "c1@t.com", Phone = "9000000001" };
        var salesUserA = new User { Id = 1, FullName = "Sales A", Email = "a@efin.com", Role = UserRole.Sales };
        var salesUserB = new User { Id = 2, FullName = "Sales B", Email = "b@efin.com", Role = UserRole.Sales };
        db.AddRange(customer, salesUserA, salesUserB);
        await db.SaveChangesAsync();
        db.Loans.Add(new Loan
        {
            Id = 1, LoanNumber = "EFIN2026TEST013", LoanType = LoanType.Personal, Status = LoanStatus.Draft,
            RequestedAmount = 100000, InterestRate = 10, TenureMonths = 12,
            CustomerId = customer.Id, CreatedByUserId = salesUserA.Id
        });
        db.Loans.Add(new Loan
        {
            Id = 2, LoanNumber = "EFIN2026TEST014", LoanType = LoanType.Personal, Status = LoanStatus.Draft,
            RequestedAmount = 100000, InterestRate = 10, TenureMonths = 12,
            CustomerId = customer.Id, CreatedByUserId = salesUserB.Id
        });
        await db.SaveChangesAsync();

        var repo = new LoanRepository(db);
        var result = await repo.GetPagedAsync(new LoanFilterDto(), currentUserId: salesUserA.Id, currentUserRole: "Sales");

        result.Items.Should().Contain(l => l.Id == 1);
        result.Items.Should().NotContain(l => l.Id == 2);
    }

    [Fact]
    public async Task Manager_TeamMembershipVisible_NonMemberHidden_Corrected()
    {
        // Corrected per the final spec (Odoo-verified): Manager visibility is
        // team-MEMBERSHIP based, not Location-based. Two loans at the SAME
        // Location — one created by a team member (visible), one by a
        // non-member (hidden) — proves it's membership, not location, doing
        // the filtering.
        var db = CreateContext();
        var customer     = new Customer { Id = 1, FullName = "C1", Email = "c1@t.com", Phone = "9000000001" };
        var managerUser  = new User { Id = 1, FullName = "Mgr", Email = "mgr@efin.com", Role = UserRole.Manager };
        var memberUser   = new User { Id = 2, FullName = "Member", Email = "member@efin.com", Role = UserRole.Sales };
        var outsiderUser = new User { Id = 3, FullName = "Outsider", Email = "outsider@efin.com", Role = UserRole.Sales };
        var location = new Location { Id = 1, Name = "Mumbai", City = "Mumbai", State = "MH" };
        var team = new Team { Id = 1, Name = "Sales A", Type = "Sales", LocationId = location.Id, TeamLeadUserId = managerUser.Id };
        db.AddRange(customer, managerUser, memberUser, outsiderUser, location, team);
        await db.SaveChangesAsync();
        db.Set<TeamMember>().Add(new TeamMember { TeamId = team.Id, UserId = memberUser.Id });
        db.Loans.Add(new Loan
        {
            Id = 1, LoanNumber = "EFIN2026TEST015", LoanType = LoanType.Personal, Status = LoanStatus.Draft,
            RequestedAmount = 100000, InterestRate = 10, TenureMonths = 12,
            CustomerId = customer.Id, CreatedByUserId = memberUser.Id, LocationId = location.Id
        });
        db.Loans.Add(new Loan
        {
            Id = 2, LoanNumber = "EFIN2026TEST016", LoanType = LoanType.Personal, Status = LoanStatus.Draft,
            RequestedAmount = 100000, InterestRate = 10, TenureMonths = 12,
            CustomerId = customer.Id, CreatedByUserId = outsiderUser.Id, LocationId = location.Id
        });
        await db.SaveChangesAsync();

        var repo = new LoanRepository(db);
        var result = await repo.GetPagedAsync(new LoanFilterDto(), currentUserId: managerUser.Id, currentUserRole: "Manager");

        result.Items.Should().Contain(l => l.Id == 1);
        result.Items.Should().NotContain(l => l.Id == 2);
    }
}
