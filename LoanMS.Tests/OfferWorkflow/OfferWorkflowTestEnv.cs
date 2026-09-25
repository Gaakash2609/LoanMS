using LoanMS.API.Services;
using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Application.Services;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using LoanMS.Infrastructure.Repositories;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Moq;

namespace LoanMS.Tests.OfferWorkflow;

/// <summary>
/// Offer-workflow test bed on a RELATIONAL SQLite in-memory database (not EF
/// InMemory), so the partial unique indexes, CHECK constraints, transactions and
/// the optimistic-concurrency token are really exercised. The PostgreSQL-only
/// triggers (max-3 / immutability) are verified separately on real PostgreSQL.
/// The real OfferWorkflowService, LoanService (with the cascade hooks) and the
/// real fail-closed RolePermissionService (embedded defaults) are wired exactly
/// like Program.cs; only the obligations/FOIR engine is stubbed.
/// </summary>
internal sealed class OfferWorkflowTestEnv : IDisposable
{
    public const int Admin = 1, Sales = 2, Product = 3, Zonal = 4, Manager = 5, TeamLeader = 6,
        Ceo = 7, Cem = 8, DsaUser = 9, PartnerUser = 10, Accounts = 11, Ceo2 = 12;
    public const int Loc = 1;
    public const int Hdfc = 1, Icici = 2, Idfc = 3, Incred = 4, InactiveBank = 5, HomeOnlyBank = 6;

    public static readonly Dictionary<string, int> UserOfRole = new()
    {
        ["Admin"] = Admin, ["Sales"] = Sales, ["ProductTeam"] = Product, ["LocationHead"] = Zonal, ["Manager"] = Manager,
        ["TeamLeader"] = TeamLeader, ["LoginTeam"] = Ceo, ["OperationManager"] = Cem, ["Dsa"] = DsaUser,
        ["Partner"] = PartnerUser, ["Accounts"] = Accounts,
    };

    private readonly SqliteConnection _conn;
    public AppDbContext Db { get; }
    public ServiceProvider Sp { get; }
    public decimal? FoirPct { get; set; } = 30m;
    public decimal Income { get; set; } = 100000m;
    public bool IncomeAvailable { get; set; } = true;
    public string StorageRoot { get; } = "";
    public Mock<IEmailService> Emails { get; } = null!;

    public OfferWorkflowService Svc => Sp.GetRequiredService<OfferWorkflowService>();
    public ILoanService Loans => Sp.GetRequiredService<ILoanService>();

    private OfferWorkflowTestEnv(IRolePermissionService? perm)
    {
        _conn = new SqliteConnection("DataSource=:memory:");
        _conn.Open();
        Db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(_conn).Options);
        Db.Database.EnsureCreated();

        var obligations = new Mock<IObligationService>();
        obligations.Setup(o => o.CalculateFoirAsync(It.IsAny<int>(), It.IsAny<CalculateFoirRequestDto>(), It.IsAny<int>(), It.IsAny<string>()))
            .ReturnsAsync(() => ApiResponseDto<ObligationFoirResultDto>.Ok(new ObligationFoirResultDto
            {
                IncomeAvailable = IncomeAvailable, CombinedIncome = IncomeAvailable ? Income : 0,
                PostLoanFoirPct = FoirPct ?? 0,
            }));

        var services = new ServiceCollection();
        services.AddSingleton(Db);
        services.AddSingleton(perm ?? new RolePermissionService(Db));
        services.AddSingleton(obligations.Object);
        StorageRoot = Path.Combine(Path.GetTempPath(), "loanms-offer-tests", Guid.NewGuid().ToString("N"));
        services.AddSingleton<IFileStorageService>(new LoanMS.Infrastructure.Services.LocalFileStorageService(StorageRoot));
        Emails = new Mock<IEmailService>();
        services.AddSingleton(Emails.Object);
        services.AddSingleton(sp => new OfferWorkflowService(Db, sp.GetRequiredService<IRolePermissionService>(), sp));
        services.AddSingleton<ILoanService>(sp =>
        {
            var email = new Mock<IEmailService>();
            var templates = new Mock<IEmailTemplateProvider>();
            templates.Setup(t => t.GetTemplateAsync(It.IsAny<string>())).ReturnsAsync(((string?)null, (string?)null));
            return new LoanService(new UnitOfWork(Db), email.Object, templates.Object, null, null, sp.GetRequiredService<OfferWorkflowService>());
        });
        Sp = services.BuildServiceProvider();
    }

    public static async Task<OfferWorkflowTestEnv> CreateAsync(IRolePermissionService? perm = null)
    {
        var env = new OfferWorkflowTestEnv(perm);
        var db = env.Db;
        db.Locations.Add(new Location { Id = Loc, Name = "Pune" });
        void U(int id, string name, UserRole role) => db.Users.Add(new User { Id = id, FullName = name, Email = $"u{id}@efin.test", Role = role });
        U(Admin, "Chief Admin", UserRole.Admin); U(Sales, "BDE Ravi", UserRole.Sales); U(Product, "Risk Officer", UserRole.ProductTeam);
        U(Zonal, "Zonal Mgr", UserRole.LocationHead); U(Manager, "BDM", UserRole.Manager); U(TeamLeader, "DSM", UserRole.TeamLeader);
        U(Ceo, "Credit Officer", UserRole.LoginTeam); U(Cem, "Credit Manager", UserRole.OperationManager); U(DsaUser, "Mass Partner", UserRole.Dsa);
        U(PartnerUser, "Channel Partner", UserRole.Partner); U(Accounts, "Payout Officer", UserRole.Accounts); U(Ceo2, "Credit Officer 2", UserRole.LoginTeam);
        await db.SaveChangesAsync();
        foreach (var uid in new[] { Sales, Zonal, Manager, TeamLeader, Ceo, Cem, DsaUser, PartnerUser, Ceo2 })
            db.UserLocations.Add(new UserLocation { UserId = uid, LocationId = Loc });
        var loginTeam = new Team { Name = "Login Pune", Type = "Login", TeamLeadUserId = Cem, LocationId = Loc };
        db.Teams.Add(loginTeam);
        await db.SaveChangesAsync();
        db.TeamMembers.Add(new TeamMember { TeamId = loginTeam.Id, UserId = Ceo });
        db.TeamMembers.Add(new TeamMember { TeamId = loginTeam.Id, UserId = Ceo2 });
        db.DsaPartners.Add(new DsaPartner { Id = 1, Name = "Mass DSA", Code = "DSA1", LinkedUserId = DsaUser });
        void B(int id, string name, bool active = true, string? types = null) =>
            db.Banks.Add(new BankMaster { Id = id, BankName = name, IsActive = active, LoanTypesJson = types });
        B(Hdfc, "HDFC Bank"); B(Icici, "ICICI Bank"); B(Idfc, "IDFC First Bank"); B(Incred, "InCred Finance");
        B(InactiveBank, "Dormant Bank", active: false); B(HomeOnlyBank, "Home Only Bank", types: "[\"home_loan\"]");
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        return env;
    }

    public async Task<Loan> SeedLoanAsync(LoanStatus status = LoanStatus.UnderReview, bool checks = true, int? cibil = 760)
    {
        var customer = new Customer
        {
            FullName = "Asha Verma", Email = $"asha{Guid.NewGuid():N}@x.test", Phone = "98" + Random.Shared.Next(10000000, 99999999),
            PanNumber = "ABCDE" + Random.Shared.Next(1000, 9999) + "F", MonthlyIncome = 100000, EmploymentType = "SALARIED", CibilScore = cibil,
        };
        Db.Customers.Add(customer);
        await Db.SaveChangesAsync();
        var loan = new Loan
        {
            LoanNumber = "EFIN" + Random.Shared.Next(100000, 999999), LoanType = LoanType.Personal, Status = status,
            RequestedAmount = 500000, InterestRate = 12, TenureMonths = 36, CustomerId = customer.Id,
            CreatedByUserId = Sales, AssignedToUserId = Sales, LocationId = Loc, LoginUserId = Ceo, OpsManagerId = Cem, DsaId = 1,
            DocumentChecked = checks, IncomeChecked = checks, BankChecked = checks, EcsReturn = checks, FiReportChecked = checks,
        };
        Db.Loans.Add(loan);
        await Db.SaveChangesAsync();
        Db.ChangeTracker.Clear();
        return loan;
    }

    public async Task<DeviationRule> AddRuleAsync(int bankId, string type, string metric, decimal limit, int priority = 100,
        string conditionsJson = "[]", string logic = "AND", DateTime? from = null, DateTime? to = null, decimal? maxApprovable = null,
        string? productKey = null, bool approvalRequired = true, string? name = null)
    {
        var r = new DeviationRule
        {
            RuleKey = Guid.NewGuid().ToString("N")[..12], Version = 1, Name = name ?? $"{type} {metric}", BankId = bankId,
            ProductKey = productKey, DeviationType = type, Metric = metric, LimitValue = limit, Priority = priority,
            ConditionsJson = conditionsJson, ConditionLogic = logic, EffectiveFrom = from ?? DateTime.UtcNow.AddDays(-30),
            EffectiveTo = to, MaxApprovableDeviation = maxApprovable, ApprovalRequired = approvalRequired, CreatedByUserId = Product,
        };
        Db.DeviationRules.Add(r);
        await Db.SaveChangesAsync();
        Db.ChangeTracker.Clear();
        return r;
    }

    public static WorkflowCaller C(string role) => new(UserOfRole[role], role, role + " user");
    public static WorkflowCaller C(int userId, string role) => new(userId, role, role + " user " + userId);

    public static CreateOfferRequestDto Offer(int bankId, decimal amount = 500000, int tenure = 36, decimal baseRoi = 13, decimal roi = 12,
        decimal pf = 1, decimal gst = 18, decimal ins = 5000, bool pfBundled = false, bool insBundled = false, decimal bt = 0, decimal stamp = 500,
        DateTime? validUntil = null) => new()
    {
        BankId = bankId, LoanAmount = amount, TenureMonths = tenure, BaseRoi = baseRoi, OfferedRoi = roi, ProcessingFeePct = pf, GstPct = gst,
        InsuranceAmount = ins, PfInBundled = pfBundled, InsuranceInBundled = insBundled, BtAmount = bt, StampDuty = stamp, ValidUntil = validUntil,
    };

    public static ReviseOfferRequestDto Revise(ApplicationOfferDto o, string reason, Action<ReviseOfferRequestDto>? change = null)
    {
        var c = o.Current!;
        var r = new ReviseOfferRequestDto
        {
            ExpectedVersion = o.Version, Reason = reason, ValidUntil = o.ValidUntil, LoanAmount = c.LoanAmount, TenureMonths = c.TenureMonths,
            BaseRoi = c.BaseRoi, OfferedRoi = c.OfferedRoi, ProcessingFeePct = c.ProcessingFeePct, GstPct = c.GstPct, InsuranceAmount = c.InsuranceAmount,
            PfInBundled = c.PfInBundled, InsuranceInBundled = c.InsuranceInBundled, BtAmount = c.BtAmount, StampDuty = c.StampDuty,
        };
        change?.Invoke(r);
        return r;
    }

    public static CreateDisbursementRequestDto Disb(decimal amount, string utr = "UTR12345678") => new()
    {
        Amount = amount, DisbursementDate = DateTime.UtcNow.Date, BankAccountNumber = "123456789012", Ifsc = "HDFC0001234",
        AccountHolderName = "Asha Verma", Utr = utr, LenderReference = "LAN-1", Mode = "NEFT",
    };

    /// <summary>A Bank Details Check posted with result "Okay to Process" for the account Disb() uses.</summary>
    public async Task SeedVerifiedBankCheckAsync(int loanId, string acct = "123456789012", string ifsc = "HDFC0001234", string result = "Okay to Process")
    {
        Db.TrackingEntries.Add(new TrackingEntry
        {
            LoanId = loanId, Name = "EFIN- Bank Details Check", Stage = "Credit Evaluation Officer", Status = "COMPLETE", CreatedByUserId = Ceo,
            SubNote = $"Bank Name: HDFC Bank\nAccount Holder Name: Asha Verma\nAccount Number: {acct}\nIFSC Code: {ifsc}\nCheck Type: Salary Account\nResult: {result}",
        });
        await Db.SaveChangesAsync();
        Db.ChangeTracker.Clear();
    }

    public static BureauReportUpload PdfReport(int score = 780, string provider = "CIBIL", DateTime? date = null) =>
        new(new MemoryStream(System.Text.Encoding.ASCII.GetBytes("%PDF-1.4 bureau report")), "cibil.pdf", "application/pdf", 22, score, provider,
            date ?? DateTime.UtcNow.Date.AddDays(-2));

    public async Task SetFlagsAsync(int loanId, Action<Loan> change)
    {
        var l = await Db.Loans.FirstAsync(x => x.Id == loanId);
        change(l);
        await Db.SaveChangesAsync();
        Db.ChangeTracker.Clear();
    }

    public async Task<LoanStatus> StatusOf(int loanId)
    {
        Db.ChangeTracker.Clear();
        return (await Db.Loans.AsNoTracking().FirstAsync(l => l.Id == loanId)).Status;
    }

    public void Dispose()
    {
        try { if (Directory.Exists(StorageRoot)) Directory.Delete(StorageRoot, true); } catch { /* temp */ }
        Sp.Dispose();
        Db.Dispose();
        _conn.Dispose();
    }
}
