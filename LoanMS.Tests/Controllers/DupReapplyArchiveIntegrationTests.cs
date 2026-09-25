using System.Reflection;
using System.Security.Claims;
using FluentAssertions;
using LoanMS.API.Controllers;
using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using LoanMS.Infrastructure.Repositories;
using LoanMS.Tests.TestHelpers;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace LoanMS.Tests.Controllers;

/// <summary>
/// API-level integration tests for the customer-duplicate / re-application /
/// archive rules: REAL controllers + REAL LoanService/CustomerService + real
/// repositories over one EF InMemory database (the same wiring DI produces).
/// DB-only guarantees (partial unique index, advisory locks, 23505 → 409,
/// migration) cannot be exercised by InMemory and are verified separately on
/// real PostgreSQL (see LOANMS_DUP_REAPPLY_ARCHIVE_2026-09-24.md).
/// </summary>
public class DupReapplyArchiveIntegrationTests
{
    private const int AdminId = 1, SalesId = 2, ProductId = 3, ZonalId = 4, ManagerId = 5, OtherSalesId = 6;
    private const int LocA = 1, LocB = 2;
    private const string SalesName = "Ravi Kumar";

    private sealed class Env
    {
        public required string DbName { get; init; }
        public required AppDbContext Db { get; init; }
        public TimeProvider? Clock { get; init; }

        public AppDbContext NewContext() => new(Options(DbName));

        public WizardController Wizard(int userId, string role)
        {
            var (customers, loans) = CentralRulesTestFactory.Create(Db, Clock);
            return WithUser(new WizardController(Db, NullLogger<WizardController>.Instance, RolePermissionTestDouble.AllowAll(),
                new LoanMS.API.Services.LoginUserAssignmentService(Db), customers, loans), userId, role);
        }

        public LoansController Loans(int userId, string role)
        {
            var (customers, loans) = CentralRulesTestFactory.Create(Db, Clock);
            return WithUser(new LoansController(loans, Db, Mock.Of<IFileStorageService>(), RolePermissionTestDouble.AllowAll(), customers), userId, role);
        }

        public CustomersController CustomersApi(int userId, string role)
        {
            var (customers, _) = CentralRulesTestFactory.Create(Db, Clock);
            return WithUser(new CustomersController(customers, Mock.Of<ICustomerDeletionService>()), userId, role);
        }

        public ILoanService LoanService() => CentralRulesTestFactory.Create(Db, Clock).Loans;
    }

    private static T WithUser<T>(T controller, int userId, string role) where T : ControllerBase
    {
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(new[]
                {
                    new Claim("userId", userId.ToString()), new Claim("role", role),
                    new Claim(ClaimTypes.Email, $"u{userId}@efin.test"),
                }, "TestAuth"))
            }
        };
        return controller;
    }

    private static DbContextOptions<AppDbContext> Options(string name) => new DbContextOptionsBuilder<AppDbContext>()
        .UseInMemoryDatabase(name)
        .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
        .Options;

    private static async Task<Env> CreateEnv(TimeProvider? clock = null)
    {
        var name = Guid.NewGuid().ToString();
        var db = new AppDbContext(Options(name));
        db.Locations.AddRange(new Location { Id = LocA, Name = "Pune" }, new Location { Id = LocB, Name = "Delhi" });
        db.Users.AddRange(
            new User { Id = AdminId, FullName = "Chief Admin", Email = "admin@efin.test", Role = UserRole.Admin },
            new User { Id = SalesId, FullName = SalesName, Email = "sales@efin.test", Role = UserRole.Sales },
            new User { Id = ProductId, FullName = "Risk Officer", Email = "risk@efin.test", Role = UserRole.ProductTeam },
            new User { Id = ZonalId, FullName = "Zonal Mgr", Email = "zonal@efin.test", Role = UserRole.LocationHead, LocationId = LocA },
            new User { Id = ManagerId, FullName = "Mgr", Email = "mgr@efin.test", Role = UserRole.Manager },
            new User { Id = OtherSalesId, FullName = "Other Sales", Email = "other@efin.test", Role = UserRole.Sales });
        db.Set<UserLocation>().Add(new UserLocation { UserId = ZonalId, LocationId = LocA });
        await db.SaveChangesAsync();
        return new Env { DbName = name, Db = db, Clock = clock };
    }

    private static async Task<Customer> SeedCustomer(Env env, string? pan, string phone, string email, bool deleted = false, string name = "Existing Customer")
    {
        var c = new Customer { FullName = name, PanNumber = pan, Phone = phone, Email = email, IsDeleted = deleted };
        env.Db.Customers.Add(c);
        await env.Db.SaveChangesAsync();
        return c;
    }

    private static async Task<Loan> SeedLoan(Env env, int customerId, LoanStatus status, DateTime? rejectedAt = null,
        int createdBy = SalesId, int? locationId = LocA, bool deleted = false, DateTime? createdAt = null, bool archived = false)
    {
        var l = new Loan
        {
            LoanNumber = "EFIN" + Guid.NewGuid().ToString("N")[..10], LoanType = LoanType.Personal, Status = status,
            RequestedAmount = 100000, InterestRate = 12, TenureMonths = 24, CustomerId = customerId,
            CreatedByUserId = createdBy, AssignedToUserId = createdBy, LocationId = locationId, RejectedAt = rejectedAt,
            IsDeleted = deleted, IsArchived = archived, CreatedAt = createdAt ?? DateTime.UtcNow.AddDays(-1),
        };
        env.Db.Loans.Add(l);
        await env.Db.SaveChangesAsync();
        return l;
    }

    // Change a loan through a FRESH context (a blocked request clears the shared
    // context's change tracker, exactly like a finished HTTP request would).
    private static async Task Mutate(Env env, int loanId, Action<Loan> change)
    {
        await using var db = env.NewContext();
        change(await db.Loans.SingleAsync(l => l.Id == loanId));
        await db.SaveChangesAsync();
    }

    private static WizardSubmitDto Dto(string? pan, string mobile, string email, int? loanId = null, string name = "New Applicant") => new()
    {
        LoanId = loanId, FullName = name, Mobile = mobile, Email = email, Pan = pan,
        Amount = 250000, LoanType = "personal_loan", LoanRate = 12, Tenure = 24, SalesPerson = SalesName,
    };

    private static ApiResponseDto<T> Body<T>(IActionResult r) => (ApiResponseDto<T>)((ObjectResult)r).Value!;

    // ══ Duplicate application — every create path, global identity ══════════

    [Fact]
    public async Task WizardSubmit_CustomerHasActiveApplicationByAnotherUser_409_GlobalIdentity_NoNewLoan()
    {
        var env = await CreateEnv();
        var c = await SeedCustomer(env, "ABCDE1234F", "9876543210", "cust@x.test");
        await SeedLoan(env, c.Id, LoanStatus.UnderReview, createdBy: OtherSalesId);

        var r = await env.Wizard(SalesId, "Sales").Submit(Dto(" abcde1234f ", "9876543210", "new@x.test"));

        r.Should().BeOfType<ConflictObjectResult>();
        Body<WizardSubmitResponseDto>(r).ErrorCode.Should().Be(ApiErrorCodes.ActiveApplicationExists);
        Body<WizardSubmitResponseDto>(r).Errors[0].Should().StartWith("Active application exists");
        (await env.NewContext().Loans.CountAsync()).Should().Be(1);
        (await env.NewContext().Customers.CountAsync()).Should().Be(1, "no duplicate customer is created");
    }

    [Fact]
    public async Task WizardSubmit_MatchesOnNormalisedMobile_LegacyFormattedPhone_409()
    {
        var env = await CreateEnv();
        var c = await SeedCustomer(env, null, "+91 98765-43210", "legacy@x.test");
        await SeedLoan(env, c.Id, LoanStatus.Submitted);

        var r = await env.Wizard(SalesId, "Sales").Submit(Dto(null, "9876543210", "someone@x.test"));

        r.Should().BeOfType<ConflictObjectResult>();
        Body<WizardSubmitResponseDto>(r).ErrorCode.Should().Be(ApiErrorCodes.ActiveApplicationExists);
    }

    [Fact]
    public async Task WizardSubmit_ExistingCustomerWithOnlyClosedApplication_Allowed_ReusesCustomer_IdentityNotOverwritten()
    {
        var env = await CreateEnv();
        var c = await SeedCustomer(env, "ABCDE1234F", "9876543210", "cust@x.test", name: "Original Name");
        await SeedLoan(env, c.Id, LoanStatus.Closed);

        var r = await env.Wizard(SalesId, "Sales").Submit(Dto("ABCDE1234F", "9999999999", "cust@x.test", name: "Typed Differently"));

        r.Should().BeOfType<OkObjectResult>();
        var db = env.NewContext();
        (await db.Customers.CountAsync()).Should().Be(1);
        var reloaded = await db.Customers.SingleAsync();
        reloaded.FullName.Should().Be("Original Name", "existing master data is never blindly overwritten");
        reloaded.Phone.Should().Be("9876543210");
        (await db.Loans.CountAsync(l => l.CustomerId == c.Id)).Should().Be(2);
    }

    [Fact]
    public async Task PostApiLoans_CustomerHasActiveApplication_409_AndBlockedAttemptAudited()
    {
        var env = await CreateEnv();
        var c = await SeedCustomer(env, "ABCDE1234F", "9876543210", "cust@x.test");
        await SeedLoan(env, c.Id, LoanStatus.Approved);

        var r = await env.Loans(AdminId, "Admin").Create(new CreateLoanRequestDto
        {
            CustomerId = c.Id, RequestedAmount = 100000, InterestRate = 12, TenureMonths = 12, LoanType = LoanType.Personal
        });

        r.Should().BeOfType<ConflictObjectResult>();
        Body<LoanDto>(r).ErrorCode.Should().Be(ApiErrorCodes.ActiveApplicationExists);
        (await env.NewContext().AuditLogs.CountAsync(a => a.Action == "ApplicationBlocked")).Should().Be(1);
    }

    [Fact]
    public async Task WizardValidate_UsesTheSameCentralRule_409OnCooldown()
    {
        var env = await CreateEnv();
        var c = await SeedCustomer(env, "ABCDE1234F", "9876543210", "cust@x.test");
        await SeedLoan(env, c.Id, LoanStatus.Rejected, rejectedAt: DateTime.UtcNow.AddDays(-10));

        var r = await env.Wizard(SalesId, "Sales").Validate(Dto("ABCDE1234F", "9876543210", "cust@x.test"));

        r.Should().BeOfType<ConflictObjectResult>();
        Body<object>(r).ErrorCode.Should().Be(ApiErrorCodes.ReapplyCooldown);
        Body<object>(r).Errors[0].Should().StartWith("Re-application allowed after");
    }

    // ══ 45-day rule through the API ═══════════════════════════════════════════

    [Fact]
    public async Task WizardSubmit_Rejected10DaysAgo_409_Rejected46DaysAgo_Allowed()
    {
        var env = await CreateEnv();
        var c = await SeedCustomer(env, "ABCDE1234F", "9876543210", "cust@x.test");
        var rej = await SeedLoan(env, c.Id, LoanStatus.Rejected, rejectedAt: DateTime.UtcNow.AddDays(-10));

        (await env.Wizard(SalesId, "Sales").Submit(Dto("ABCDE1234F", "9876543210", "cust@x.test")))
            .Should().BeOfType<ConflictObjectResult>();

        await Mutate(env, rej.Id, l => l.RejectedAt = DateTime.UtcNow.AddDays(-46));
        (await env.Wizard(SalesId, "Sales").Submit(Dto("ABCDE1234F", "9876543210", "cust@x.test")))
            .Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task ExactBoundary_ThroughService_Day44Blocked_Day45Allowed()
    {
        var rejectedAt = new DateTime(2026, 1, 1, 10, 0, 0, DateTimeKind.Utc);
        foreach (var (days, allowed) in new[] { (44, false), (45, true) })
        {
            var env = await CreateEnv(new FixedClock(rejectedAt.AddDays(days)));
            var c = await SeedCustomer(env, "ABCDE1234F", "9876543210", "cust@x.test");
            await SeedLoan(env, c.Id, LoanStatus.Rejected, rejectedAt: rejectedAt);
            (await env.LoanService().CheckApplicationEligibilityAsync(c.Id)).Allowed.Should().Be(allowed, $"day {days}");
        }
    }

    [Fact]
    public async Task LegacyRejectedWithoutRejectedAt_UsesExactHistory_ElseBlockedForAdminReview()
    {
        var env = await CreateEnv();
        var c = await SeedCustomer(env, "ABCDE1234F", "9876543210", "cust@x.test");
        var legacy = await SeedLoan(env, c.Id, LoanStatus.Rejected, rejectedAt: null, createdAt: DateTime.UtcNow.AddDays(-300));

        var unknown = await env.LoanService().CheckApplicationEligibilityAsync(c.Id);
        unknown.Code.Should().Be(ApiErrorCodes.RejectionDateUnknown);

        // A same-status note (e.g. an archive/timeline row) is NOT a rejection.
        env.Db.LoanStatusHistories.Add(new LoanStatusHistory { LoanId = legacy.Id, FromStatus = LoanStatus.Rejected, ToStatus = LoanStatus.Rejected, Comment = "note", ChangedByUserId = AdminId, CreatedAt = DateTime.UtcNow });
        await env.Db.SaveChangesAsync();
        (await env.LoanService().CheckApplicationEligibilityAsync(c.Id)).Code.Should().Be(ApiErrorCodes.RejectionDateUnknown);

        env.Db.LoanStatusHistories.Add(new LoanStatusHistory { LoanId = legacy.Id, FromStatus = LoanStatus.UnderReview, ToStatus = LoanStatus.Rejected, ChangedByUserId = AdminId, CreatedAt = DateTime.UtcNow.AddDays(-50) });
        await env.Db.SaveChangesAsync();
        (await env.LoanService().CheckApplicationEligibilityAsync(c.Id)).Allowed.Should().BeTrue("the exact history date is 50 days old");
    }

    // ══ RejectedAt: server-side only ══════════════════════════════════════════

    [Fact]
    public async Task RejectedAt_NeverTakenFromPayload_SetServerSideOnRejection()
    {
        var env = await CreateEnv();
        // A client trying to smuggle a back-dated rejectedAt: none of the request
        // DTOs has such a member, so JSON binding simply drops it.
        var json = "{\"newStatus\":\"Rejected\",\"comment\":\"x\",\"rejectedAt\":\"2020-01-01T00:00:00Z\"}";
        var req = Newtonsoft.Json.JsonConvert.DeserializeObject<UpdateLoanStatusRequestDto>(json,
            new Newtonsoft.Json.JsonSerializerSettings { Converters = { new Newtonsoft.Json.Converters.StringEnumConverter() } })!;
        typeof(UpdateLoanStatusRequestDto).GetProperty("RejectedAt").Should().BeNull();
        typeof(WizardSubmitDto).GetProperty("RejectedAt").Should().BeNull();
        typeof(UpdateLoanRequestDto).GetProperty("RejectedAt").Should().BeNull();

        var c = await SeedCustomer(env, "ABCDE1234F", "9876543210", "cust@x.test");
        var loan = await SeedLoan(env, c.Id, LoanStatus.Submitted);
        var before = DateTime.UtcNow;
        var result = await env.LoanService().UpdateStatusAsync(loan.Id, req, AdminId, "Admin");

        result.Success.Should().BeTrue();
        var saved = await env.NewContext().Loans.SingleAsync(l => l.Id == loan.Id);
        saved.RejectedAt.Should().NotBeNull().And.BeOnOrAfter(before);
    }

    [Fact]
    public async Task RejectWhileDeviationPending_StampsRejectedAt()
    {
        var env = await CreateEnv();
        var c = await SeedCustomer(env, "ABCDE1234F", "9876543210", "cust@x.test");
        var loan = await SeedLoan(env, c.Id, LoanStatus.Decision);

        (await env.LoanService().UpdateStatusAsync(loan.Id, new UpdateLoanStatusRequestDto { NewStatus = LoanStatus.Rejected, Comment = "no" }, AdminId, "Admin")).Success.Should().BeTrue();

        (await env.NewContext().Loans.SingleAsync(l => l.Id == loan.Id)).RejectedAt.Should().NotBeNull();
    }

    // ══ Draft / resume ═════════════════════════════════════════════════════════

    [Fact]
    public async Task ResumingAnOldDraft_CannotBypassTheCooldown_SaveAndSubmitBoth409()
    {
        var env = await CreateEnv();
        var c = await SeedCustomer(env, "ABCDE1234F", "9876543210", "cust@x.test");
        var oldDraft = await SeedLoan(env, c.Id, LoanStatus.Draft, createdAt: DateTime.UtcNow.AddDays(-60));
        await SeedLoan(env, c.Id, LoanStatus.Rejected, rejectedAt: DateTime.UtcNow.AddDays(-10));

        var save = await env.Wizard(SalesId, "Sales").SaveDraft(Dto("ABCDE1234F", "9876543210", "cust@x.test", loanId: oldDraft.Id));
        var submit = await env.Wizard(SalesId, "Sales").Submit(Dto("ABCDE1234F", "9876543210", "cust@x.test", loanId: oldDraft.Id));

        save.Should().BeOfType<ConflictObjectResult>();
        submit.Should().BeOfType<ConflictObjectResult>();
        Body<WizardSubmitResponseDto>(submit).ErrorCode.Should().Be(ApiErrorCodes.ReapplyCooldown);
        (await env.NewContext().Loans.SingleAsync(l => l.Id == oldDraft.Id)).Status.Should().Be(LoanStatus.Draft);
    }

    [Fact]
    public async Task DraftSubmitEndpoint_ReRunsTheGuard()
    {
        var env = await CreateEnv();
        var c = await SeedCustomer(env, "ABCDE1234F", "9876543210", "cust@x.test");
        var draft = await SeedLoan(env, c.Id, LoanStatus.Draft);
        await SeedLoan(env, c.Id, LoanStatus.Rejected, rejectedAt: DateTime.UtcNow.AddDays(-3));

        var r = await env.Loans(AdminId, "Admin").Submit(draft.Id);

        r.Should().BeOfType<ConflictObjectResult>();
    }

    [Fact]
    public async Task OwnDraft_SavedRepeatedly_IsNotADuplicateOfItself()
    {
        var env = await CreateEnv();
        var w = env.Wizard(SalesId, "Sales");
        var first = await w.SaveDraft(Dto("ABCDE1234F", "9876543210", "cust@x.test"));
        var id = Body<WizardSubmitResponseDto>(first).Data!.LoanId;

        (await env.Wizard(SalesId, "Sales").SaveDraft(Dto("ABCDE1234F", "9876543210", "cust@x.test", loanId: id))).Should().BeOfType<OkObjectResult>();
        (await env.Wizard(SalesId, "Sales").Submit(Dto("ABCDE1234F", "9876543210", "cust@x.test", loanId: id))).Should().BeOfType<OkObjectResult>();
        (await env.NewContext().Loans.CountAsync()).Should().Be(1);
    }

    [Fact]
    public async Task DraftStartedByMobile_ThenPanOfExistingCustomer_RelinksToExisting_NoOrphanDuplicate()
    {
        var env = await CreateEnv();
        var existing = await SeedCustomer(env, "ABCDE1234F", "1111111111", "old@x.test", name: "Returning Customer");

        var first = await env.Wizard(SalesId, "Sales").SaveDraft(Dto(null, "9876543210", "", name: "Returning Cust"));
        var loanId = Body<WizardSubmitResponseDto>(first).Data!.LoanId;
        (await env.NewContext().Customers.CountAsync()).Should().Be(2, "a provisional customer was created for the draft");

        var second = await env.Wizard(SalesId, "Sales").SaveDraft(Dto("ABCDE1234F", "9876543210", "", loanId: loanId, name: "Returning Cust"));

        second.Should().BeOfType<OkObjectResult>();
        var db = env.NewContext();
        (await db.Loans.SingleAsync(l => l.Id == loanId)).CustomerId.Should().Be(existing.Id);
        (await db.Customers.IgnoreQueryFilters().CountAsync()).Should().Be(1, "the superseded provisional record is removed, not left as a duplicate");
        var c = await db.Customers.SingleAsync();
        c.FullName.Should().Be("Returning Customer");
        c.Phone.Should().Be("1111111111");
    }

    // ══ Customer merge / conflict / soft-deleted ═════════════════════════════

    [Fact]
    public async Task PanMatchesOneCustomer_MobileAnother_409NeedsReview_NoMerge_NoNewCustomer_Audited()
    {
        var env = await CreateEnv();
        var a = await SeedCustomer(env, "ABCDE1234F", "1111111111", "a@x.test", name: "A");
        var b = await SeedCustomer(env, "ZZZZZ9999Z", "9876543210", "b@x.test", name: "B");

        var r = await env.Wizard(SalesId, "Sales").Submit(Dto("ABCDE1234F", "9876543210", "n@x.test"));

        r.Should().BeOfType<ConflictObjectResult>();
        Body<WizardSubmitResponseDto>(r).ErrorCode.Should().Be(ApiErrorCodes.CustomerNeedsReview);
        var db = env.NewContext();
        (await db.Customers.CountAsync()).Should().Be(2);
        (await db.Customers.SingleAsync(c => c.Id == a.Id)).Phone.Should().Be("1111111111");
        (await db.Customers.SingleAsync(c => c.Id == b.Id)).PanNumber.Should().Be("ZZZZZ9999Z");
        (await db.Loans.CountAsync()).Should().Be(0);
        var audit = await db.AuditLogs.SingleAsync(x => x.Action == "CustomerNeedsReview");
        audit.NewValues.Should().NotContain("ABCDE1234F").And.NotContain("9876543210", "identifiers are masked in the audit trail");
    }

    [Fact]
    public async Task SoftDeletedCustomerMatch_409NeedsReview_NotResurrected()
    {
        var env = await CreateEnv();
        var old = await SeedCustomer(env, "ABCDE1234F", "9876543210", "old@x.test", deleted: true);

        var r = await env.Wizard(AdminId, "Admin").Submit(Dto("ABCDE1234F", "9876543210", "old@x.test"));

        r.Should().BeOfType<ConflictObjectResult>();
        (await env.NewContext().Customers.IgnoreQueryFilters().SingleAsync(c => c.Id == old.Id)).IsDeleted.Should().BeTrue();
    }

    [Fact]
    public async Task PostApiCustomers_DuplicateByNormalisedMobile_409_NoSilentDuplicate()
    {
        var env = await CreateEnv();
        await SeedCustomer(env, null, "+91 98765 43210", "x@x.test");

        var r = await env.CustomersApi(AdminId, "Admin").Create(new CreateCustomerRequestDto
        {
            FullName = "Dup", Phone = "9876543210", Email = "different@x.test"
        });

        r.Should().BeOfType<ConflictObjectResult>();
        (await env.NewContext().Customers.CountAsync()).Should().Be(1);
    }

    [Fact]
    public async Task CheckPan_IsGlobal_NormalisedAndLeaksNoCustomerData()
    {
        var env = await CreateEnv();
        var c = await SeedCustomer(env, "ABCDE1234F", "9876543210", "x@x.test");
        await SeedLoan(env, c.Id, LoanStatus.Closed, createdBy: OtherSalesId);   // not visible to Sales user 2

        var r = await env.CustomersApi(SalesId, "Sales").CheckPan(" abcde1234f ");
        var json = Newtonsoft.Json.JsonConvert.SerializeObject(((OkObjectResult)r).Value);

        json.Should().Contain("\"exists\":true").And.Contain("\"matchStatus\":\"match\"");
        json.Should().NotContain("Existing Customer").And.NotContain("x@x.test").And.NotContain("\"Id\"");

        var byMobile = await env.CustomersApi(SalesId, "Sales").CheckPan(null, mobile: "+91 98765 43210");
        Newtonsoft.Json.JsonConvert.SerializeObject(((OkObjectResult)byMobile).Value).Should().Contain("\"exists\":true");
    }

    [Fact]
    public async Task DuplicateCheck_SalesSeesRuleButNotAnotherUsersApplicationNumber()
    {
        var env = await CreateEnv();
        var c = await SeedCustomer(env, "ABCDE1234F", "9876543210", "x@x.test");
        var other = await SeedLoan(env, c.Id, LoanStatus.Submitted, createdBy: OtherSalesId);

        var r = await env.Loans(SalesId, "Sales").DuplicateCheck("ABCDE1234F");
        var json = Newtonsoft.Json.JsonConvert.SerializeObject(((OkObjectResult)r).Value);

        json.Should().Contain("\"hasDuplicate\":true").And.Contain("Active application exists");
        json.Should().NotContain(other.LoanNumber);
    }

    // ══ Delete / soft-delete / restore ═══════════════════════════════════════

    [Fact]
    public async Task SoftDeletedRejectedApplication_StillBlocks_SoftDeletedActiveDoesNot()
    {
        var env = await CreateEnv();
        var c = await SeedCustomer(env, "ABCDE1234F", "9876543210", "x@x.test");
        await SeedLoan(env, c.Id, LoanStatus.Draft, deleted: true);
        (await env.LoanService().CheckApplicationEligibilityAsync(c.Id)).Allowed.Should().BeTrue();

        await SeedLoan(env, c.Id, LoanStatus.Rejected, rejectedAt: DateTime.UtcNow.AddDays(-5), deleted: true);
        (await env.LoanService().CheckApplicationEligibilityAsync(c.Id)).Code.Should().Be(ApiErrorCodes.ReapplyCooldown);
    }

    [Fact]
    public async Task PermanentCustomerDelete_RefusedInsideTheCooldown()
    {
        var env = await CreateEnv();
        var c = await SeedCustomer(env, "ABCDE1234F", "9876543210", "x@x.test");
        await SeedLoan(env, c.Id, LoanStatus.Rejected, rejectedAt: DateTime.UtcNow.AddDays(-5));
        var svc = new LoanMS.Infrastructure.Services.CustomerDeletionService(env.Db, Mock.Of<IFileStorageService>(),
            NullLogger<LoanMS.Infrastructure.Services.CustomerDeletionService>.Instance);

        var r = await svc.DeletePermanentlyAsync(c.Id);

        r.Success.Should().BeFalse();
        r.Errors[0].Should().Contain("45-day");
        (await env.NewContext().Customers.CountAsync()).Should().Be(1);
    }

    // ══ Status transitions / reopen / override ═══════════════════════════════

    [Fact]
    public async Task Reopen_WhenAnotherActiveApplicationExists_409_AndRejectedAtKeptOnSuccess()
    {
        var env = await CreateEnv();
        var c = await SeedCustomer(env, "ABCDE1234F", "9876543210", "x@x.test");
        var rejected = await SeedLoan(env, c.Id, LoanStatus.Rejected, rejectedAt: DateTime.UtcNow.AddDays(-2));
        var active = await SeedLoan(env, c.Id, LoanStatus.Submitted);

        (await env.Loans(AdminId, "Admin").Reopen(rejected.Id, new ReopenRequestDto { Reason = "mistake" }))
            .Should().BeOfType<ConflictObjectResult>();

        await Mutate(env, active.Id, l => l.Status = LoanStatus.Closed);
        (await env.Loans(AdminId, "Admin").Reopen(rejected.Id, new ReopenRequestDto { Reason = "mistake" }))
            .Should().BeOfType<OkObjectResult>();
        (await env.NewContext().Loans.SingleAsync(l => l.Id == rejected.Id)).RejectedAt.Should().NotBeNull("rejection history is preserved");
    }

    [Fact]
    public async Task AdminOverride_ClosedBackToActive_WhileAnotherActive_409()
    {
        var env = await CreateEnv();
        var c = await SeedCustomer(env, "ABCDE1234F", "9876543210", "x@x.test");
        var closed = await SeedLoan(env, c.Id, LoanStatus.Closed);
        await SeedLoan(env, c.Id, LoanStatus.UnderReview);

        var r = await env.Loans(AdminId, "Admin").OverrideStatus(closed.Id,
            new OverrideStatusRequestDto { NewStatus = LoanStatus.Submitted, Reason = "fix" });

        r.Should().BeOfType<ConflictObjectResult>();
    }

    [Fact]
    public async Task ClosingTheActiveApplication_ImmediatelyAllowsANewOne()
    {
        var env = await CreateEnv();
        var c = await SeedCustomer(env, "ABCDE1234F", "9876543210", "x@x.test");
        var disbursed = await SeedLoan(env, c.Id, LoanStatus.Disbursed);
        (await env.LoanService().CheckApplicationEligibilityAsync(c.Id)).Allowed.Should().BeFalse("a running (Disbursed) loan is active");

        (await env.LoanService().UpdateStatusAsync(disbursed.Id, new UpdateLoanStatusRequestDto { NewStatus = LoanStatus.Closed }, AdminId, "Admin"))
            .Success.Should().BeTrue();
        (await env.LoanService().CheckApplicationEligibilityAsync(c.Id)).Allowed.Should().BeTrue();
    }

    // ══ Archive ═══════════════════════════════════════════════════════════════

    [Fact]
    public async Task Archive_Rejected_ByAdmin_PersistsGlobally_Audited_KeepsCustomerDocsHistory_KeepsCooldown()
    {
        var env = await CreateEnv();
        var c = await SeedCustomer(env, "ABCDE1234F", "9876543210", "x@x.test");
        var loan = await SeedLoan(env, c.Id, LoanStatus.Rejected, rejectedAt: DateTime.UtcNow.AddDays(-10));
        env.Db.LoanDocuments.Add(new LoanDocument { LoanId = loan.Id, DocumentName = "pan", DocumentType = "identity", FilePath = $"{loan.Id}/a.pdf", UploadedByUserId = "2" });
        await env.Db.SaveChangesAsync();

        var r = await env.Loans(AdminId, "Admin").Archive(loan.Id, new ArchiveLoanRequestDto { Reason = "  Duplicate lead  " });

        r.Should().BeOfType<OkObjectResult>();
        var db = env.NewContext();   // a fresh context = any other user/session
        var saved = await db.Loans.SingleAsync(l => l.Id == loan.Id);
        saved.IsArchived.Should().BeTrue();
        saved.ArchivedByUserId.Should().Be(AdminId);
        saved.ArchiveReason.Should().Be("Duplicate lead");
        saved.ArchivedAt.Should().NotBeNull();
        saved.Status.Should().Be(LoanStatus.Rejected);
        saved.RejectedAt.Should().NotBeNull();
        var audit = await db.AuditLogs.SingleAsync(a => a.Action == "Archived");
        audit.Reason.Should().Be("Duplicate lead");
        audit.UserId.Should().Be(AdminId);
        (await db.LoanStatusHistories.CountAsync(h => h.LoanId == loan.Id && h.Comment!.StartsWith("[ARCHIVED]"))).Should().Be(1);
        (await db.LoanDocuments.CountAsync(d => d.LoanId == loan.Id)).Should().Be(1);
        (await db.Customers.CountAsync()).Should().Be(1);

        // Archiving never resets the rejection restriction.
        (await env.Wizard(SalesId, "Sales").Submit(Dto("ABCDE1234F", "9876543210", "x@x.test")))
            .Should().BeOfType<ConflictObjectResult>();
    }

    [Fact]
    public async Task Archive_ActiveApplication_409_NotArchived()
    {
        var env = await CreateEnv();
        var c = await SeedCustomer(env, "ABCDE1234F", "9876543210", "x@x.test");
        var loan = await SeedLoan(env, c.Id, LoanStatus.UnderReview);

        var r = await env.Loans(AdminId, "Admin").Archive(loan.Id, new ArchiveLoanRequestDto { Reason = "cleanup" });

        r.Should().BeOfType<ConflictObjectResult>();
        Body<LoanDto>(r).ErrorCode.Should().Be(ApiErrorCodes.ArchiveNotAllowed);
        (await env.NewContext().Loans.SingleAsync(l => l.Id == loan.Id)).IsArchived.Should().BeFalse();
        (await env.NewContext().AuditLogs.CountAsync(a => a.Action == "Archived")).Should().Be(0);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Archive_ReasonMandatory_400(string? reason)
    {
        var env = await CreateEnv();
        var c = await SeedCustomer(env, "ABCDE1234F", "9876543210", "x@x.test");
        var loan = await SeedLoan(env, c.Id, LoanStatus.Closed);

        var r = await env.Loans(AdminId, "Admin").Archive(loan.Id, new ArchiveLoanRequestDto { Reason = reason });

        r.Should().BeOfType<BadRequestObjectResult>();
        Body<LoanDto>(r).ErrorCode.Should().Be(ApiErrorCodes.ReasonRequired);
        (await env.NewContext().Loans.SingleAsync(l => l.Id == loan.Id)).IsArchived.Should().BeFalse();
    }

    [Fact]
    public void Archive_Endpoint_RoleGate_IsExactlyAdminProductTeamLocationHead()
    {
        var attr = typeof(LoansController).GetMethod(nameof(LoansController.Archive))!
            .GetCustomAttributes<AuthorizeAttribute>().Single(a => a.Roles != null);
        attr.Roles!.Split(',').Should().BeEquivalentTo(new[] { "Admin", "ProductTeam", "LocationHead" });
        LoanMS.Application.Services.LoanService.ArchiveRoles.Should().BeEquivalentTo(new[] { "Admin", "ProductTeam", "LocationHead" });
    }

    [Theory]
    [InlineData(SalesId, "Sales")]
    [InlineData(ManagerId, "Manager")]
    public async Task Archive_OtherRoles_403_EvenIfTheRoleGateWereBypassed(int userId, string role)
    {
        var env = await CreateEnv();
        var c = await SeedCustomer(env, "ABCDE1234F", "9876543210", "x@x.test");
        var loan = await SeedLoan(env, c.Id, LoanStatus.Closed);

        var r = await env.Loans(userId, role).Archive(loan.Id, new ArchiveLoanRequestDto { Reason = "x" });

        ((ObjectResult)r).StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        (await env.NewContext().Loans.SingleAsync(l => l.Id == loan.Id)).IsArchived.Should().BeFalse();
    }

    [Fact]
    public async Task Archive_LocationHead_OwnLocationAllowed_OtherLocationNotFound()
    {
        var env = await CreateEnv();
        var c1 = await SeedCustomer(env, "ABCDE1234F", "9876543210", "x@x.test");
        var c2 = await SeedCustomer(env, "ZZZZZ9999Z", "9000000000", "y@x.test");
        var own = await SeedLoan(env, c1.Id, LoanStatus.Closed, locationId: LocA);
        var foreign = await SeedLoan(env, c2.Id, LoanStatus.Closed, locationId: LocB);

        (await env.Loans(ZonalId, "LocationHead").Archive(own.Id, new ArchiveLoanRequestDto { Reason = "done" }))
            .Should().BeOfType<OkObjectResult>();
        (await env.Loans(ZonalId, "LocationHead").Archive(foreign.Id, new ArchiveLoanRequestDto { Reason = "done" }))
            .Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task Archive_ProductTeam_AllowedRole_ButExistingRbacGivesItNoLoanVisibility()
    {
        // Owner decision in LoanRepository.ApplyVisibilityScope: ProductTeam sees
        // no loans. The role is authorised to archive, but only inside its
        // visibility scope — which is empty unless an Admin assigns one.
        var env = await CreateEnv();
        var c = await SeedCustomer(env, "ABCDE1234F", "9876543210", "x@x.test");
        var loan = await SeedLoan(env, c.Id, LoanStatus.Closed);

        (await env.Loans(ProductId, "ProductTeam").Archive(loan.Id, new ArchiveLoanRequestDto { Reason = "x" }))
            .Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task ArchivedApplication_CannotBeReopenedOrOverridden()
    {
        var env = await CreateEnv();
        var c = await SeedCustomer(env, "ABCDE1234F", "9876543210", "x@x.test");
        var loan = await SeedLoan(env, c.Id, LoanStatus.Rejected, rejectedAt: DateTime.UtcNow.AddDays(-1), archived: true);

        (await env.Loans(AdminId, "Admin").Reopen(loan.Id, new ReopenRequestDto { Reason = "x" })).Should().BeOfType<ConflictObjectResult>();
        (await env.Loans(AdminId, "Admin").OverrideStatus(loan.Id, new OverrideStatusRequestDto { NewStatus = LoanStatus.Submitted, Reason = "x" }))
            .Should().BeOfType<ConflictObjectResult>();
    }

    [Fact]
    public async Task ArchivedApplications_HiddenFromListCountsDashboardExportReports_VisibleInArchivedView()
    {
        var env = await CreateEnv();
        var c = await SeedCustomer(env, "ABCDE1234F", "9876543210", "x@x.test");
        var archived = await SeedLoan(env, c.Id, LoanStatus.Rejected, rejectedAt: DateTime.UtcNow.AddDays(-60), archived: true);
        var visible = await SeedLoan(env, c.Id, LoanStatus.Closed);
        var svc = env.LoanService();

        var list = (await svc.GetAllAsync(new LoanFilterDto { PageSize = 50 }, AdminId, "Admin")).Data!;
        list.TotalCount.Should().Be(1);
        list.Items.Select(i => i.Id).Should().Equal(visible.Id);

        (await svc.GetAllAsync(new LoanFilterDto { PageSize = 50, Status = LoanStatus.Rejected }, AdminId, "Admin")).Data!.TotalCount
            .Should().Be(0, "status filters run on the operational list too");

        var archivedView = (await svc.GetAllAsync(new LoanFilterDto { PageSize = 50, Archived = "only" }, AdminId, "Admin")).Data!;
        archivedView.Items.Select(i => i.Id).Should().Equal(archived.Id);
        archivedView.Items[0].IsArchived.Should().BeTrue();

        (await svc.ExportAsync(new LoanFilterDto(), AdminId, "Admin")).Select(i => i.Id).Should().Equal(visible.Id);
        (await svc.ExportAsync(new LoanFilterDto { Archived = "only" }, AdminId, "Admin")).Select(i => i.Id).Should().Equal(archived.Id);

        var stats = (await svc.GetDashboardStatsAsync(AdminId, "Admin")).Data!;
        stats.RejectedLoans.Should().Be(0);
        stats.TotalLoans.Should().Be(1);

        LoanRepository.ApplyOperationalScope(env.Db, env.Db.Loans, AdminId, "Admin").Count().Should().Be(1, "reports use the same scope");

        // Still reachable directly (archive/history view → detail page).
        (await svc.GetByIdAsync(archived.Id, AdminId, "Admin")).Data!.IsArchived.Should().BeTrue();
    }
}
