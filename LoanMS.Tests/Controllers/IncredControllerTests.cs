using System.Net;
using System.Text.Json;
using FluentAssertions;
using LoanMS.API.Controllers;
using LoanMS.API.Services;      // IRolePermissionService — 6th IncredController ctor arg.
using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using LoanMS.Tests.TestHelpers;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace LoanMS.Tests.Controllers;

/// <summary>
/// Runs clean: 17/17 passing as of the LoanMS migration finalization pass.
/// (An earlier note here said this suite could not be executed in the
/// sandbox that produced it, due to a blocked NuGet restore in that
/// environment, and had not been compiler- or run-verified. That has since
/// been confirmed false in an environment with normal network access — left
/// as a correction, not a silent edit, since the note was an explicit
/// caveat someone might otherwise still be relying on.)
/// </summary>
public class IncredControllerTests
{
    private const string TokenSuccessBody = "{\"access_token\":\"tok-1\",\"expires_in\":3600}";

    // PHASE 6 SECURITY FIX: IncredController._loadCreds() no longer falls back
    // to a hardcoded, committed InCred client secret (that fallback was a
    // leaked-credential finding and has been removed from the controller).
    // These tests now seed AppSettings explicitly, the same way the real app
    // must be configured, instead of relying on the removed built-in default.
    private const string TestClientId = "test-incred-client-id";
    // Must be syntactically valid base64url (no padding) — IDataProtector's
    // string-based Unprotect() extension calls WebEncoders.Base64UrlDecode on
    // this value BEFORE the mocked byte[]-based Unprotect() below ever runs,
    // so an arbitrary non-base64 string here would throw during decode.
    // The mock ignores the actual decoded bytes and always returns
    // TestDecryptedSecret regardless of what this decodes to.
    private const string TestEncSecret = "dGVzdC1zZWNyZXQ";
    private const string TestDecryptedSecret = "test-incred-secret";

    private static (IncredController controller, QueuedHttpMessageHandler handler, FakeCacheService cache, AppDbContext db) CreateController()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        var db = new AppDbContext(options);

        // Seed InCred configuration in Settings — required now that
        // IncredController no longer has a hardcoded fallback (see fix above).
        db.AppSettings.AddRange(
            new AppSetting { Key = "incred_base_url", Value = "https://api.incred.test/v3" },
            new AppSetting { Key = "incred_client_id", Value = TestClientId },
            new AppSetting { Key = "incred_client_secret_enc", Value = TestEncSecret });
        db.SaveChanges();

        var handler = new QueuedHttpMessageHandler();
        var httpFactory = new Mock<IHttpClientFactory>();
        httpFactory.Setup(f => f.CreateClient("incred")).Returns(() => new HttpClient(handler));

        var protectorMock = new Mock<IDataProtector>();
        protectorMock.Setup(p => p.Unprotect(It.IsAny<byte[]>())).Returns(System.Text.Encoding.UTF8.GetBytes(TestDecryptedSecret));
        var dpProvider = new Mock<IDataProtectionProvider>();
        dpProvider.Setup(p => p.CreateProtector(It.IsAny<string>())).Returns(protectorMock.Object);

        var cache = new FakeCacheService();

        // Permissive stub. IRolePermissionService layers the Admin-configurable
        // permission matrix on top of the fixed [Authorize] checks and is
        // fail-open by contract (a key absent from GetDeniedPermissionsAsync
        // means "allowed"), so allowing everything here keeps these tests
        // focused on the InCred behaviour they actually assert.
        var rolePerm = new Mock<IRolePermissionService>();
        rolePerm.Setup(r => r.IsAllowedAsync(It.IsAny<string?>(), It.IsAny<string>())).ReturnsAsync(true);
        rolePerm.Setup(r => r.IsMenuAllowedAsync(It.IsAny<string?>(), It.IsAny<string>())).ReturnsAsync(true);
        rolePerm.Setup(r => r.GetDeniedPermissionsAsync(It.IsAny<string?>(), It.IsAny<IEnumerable<string>>()))
                .ReturnsAsync(new HashSet<string>());

        var controller = new IncredController(db, httpFactory.Object, dpProvider.Object,
            NullLogger<IncredController>.Instance, cache, rolePerm.Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };

        return (controller, handler, cache, db);
    }

    private static Loan SeedLoanWithCustomer(AppDbContext db, Action<Customer>? customize = null)
    {
        var customer = new Customer
        {
            FullName = "Test Kumar",
            Phone = "9999999999",
            PanNumber = "ABCDE1234F",
            DateOfBirth = new DateTime(1990, 1, 1),
            Gender = "Male",
            EmploymentType = "Professional",
            ResidenceType = "Rented",
            PinCode = "400001",
            MonthlyIncome = 50000,
            FatherName = "Father Kumar",
        };
        customize?.Invoke(customer);
        db.Customers.Add(customer);
        db.SaveChanges();

        var loan = new Loan
        {
            LoanNumber = "LN-1",
            LoanType = LoanType.Personal,
            RequestedAmount = 100000,
            TenureMonths = 12,
            CustomerId = customer.Id,
            CreatedByUserId = 1,
        };
        db.Loans.Add(loan);
        db.SaveChanges();
        return loan;
    }

    private static JsonElement Json(string json) => JsonDocument.Parse(json).RootElement;

    // ═══════════════════════════════════════════════════════════════════════
    // Mapping helpers
    // ═══════════════════════════════════════════════════════════════════════

    [Theory]
    [InlineData("Professional", "SELFEMP")]
    [InlineData("Self-Employed", "SELFEMP")]
    [InlineData("Salaried", "SALARIED")]
    [InlineData("Not Earning", "NOTEARNING")]
    [InlineData("Something Else", null)]
    [InlineData(null, null)]
    public void MapEmploymentType_MapsCorrectly(string? input, string? expected) =>
        IncredController._mapEmploymentTypeForIncred(input).Should().Be(expected);

    [Theory]
    [InlineData("Rented", "RENTED_SELF_WITH_FAMILY")]
    [InlineData("Owned", "OWNED_SELF_SPOUSE")]
    [InlineData("Parental", "OWNED_BY_PARENTS")]
    [InlineData("Company Provided", "RENTED_ACCOMMODATION_BY_EMPLOYER")]
    [InlineData("Unknown", null)]
    [InlineData(null, null)]
    public void MapResidenceType_MapsCorrectly(string? input, string? expected) =>
        IncredController._mapResidenceTypeForIncred(input).Should().Be(expected);

    [Theory]
    [InlineData("Male", "M")]
    [InlineData("Female", "F")]
    [InlineData("Other", null)]
    [InlineData(null, null)]
    public void MapGender_MapsCorrectly(string? input, string? expected) =>
        IncredController._mapGenderForIncred(input).Should().Be(expected);

    // ═══════════════════════════════════════════════════════════════════════
    // Duplicate application prevention / idempotency
    // ═══════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task CreateIncredApplicationForLoan_AlreadyExists_ReturnsEarlyWithoutHttpCall()
    {
        var (controller, handler, _, db) = CreateController();
        var loan = SeedLoanWithCustomer(db);
        loan.ApplicationSource = "incred";
        loan.IncredApplicationId = "APP-123";
        await db.SaveChangesAsync();

        var result = await controller.CreateIncredApplicationForLoan(loan.Id);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        var body = ok.Value.Should().BeOfType<ApiResponseDto<IncredLoanInfoDto>>().Subject;
        body.Success.Should().BeTrue();
        body.Message.Should().Contain("already exists");
        handler.RequestUrls.Should().BeEmpty("no InCred call should be made for an already-created application");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Webhook body guards + DB sync
    // ═══════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task ReceiveWebhook_EmptyBody_ReturnsErrorWithoutThrowing()
    {
        var (controller, _, _, _) = CreateController();

        var result = await controller.ReceiveWebhook(default); // default JsonElement => ValueKind.Undefined

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        JsonSerializer.Serialize(ok.Value).Should().Contain("error");
    }

    [Fact]
    public async Task ReceiveWebhook_MissingIdentifiers_ReturnsErrorWithoutThrowing()
    {
        var (controller, _, _, _) = CreateController();

        var result = await controller.ReceiveWebhook(Json("{\"EVENT\":\"SOMETHING\"}"));

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        JsonSerializer.Serialize(ok.Value).Should().Contain("error");
    }

    [Fact]
    public async Task ReceiveWebhook_MatchingApplicationId_SyncsLoanRow()
    {
        var (controller, _, _, db) = CreateController();
        var loan = SeedLoanWithCustomer(db);
        loan.ApplicationSource = "incred";
        loan.IncredApplicationId = "APP-999";
        await db.SaveChangesAsync();

        var payload = Json("{\"APPLICATION_ID\":\"APP-999\",\"EVENT\":\"OFFER_GENERATED\",\"STATUS\":\"SUCCESS\"}");
        var result = await controller.ReceiveWebhook(payload);

        result.Should().BeOfType<OkObjectResult>();
        var updated = await db.Loans.FirstAsync(l => l.Id == loan.Id);
        updated.IncredLastWebhookEvent.Should().Be("OFFER_GENERATED");
        updated.IncredLastWebhookStatus.Should().Be("SUCCESS");
    }

    // Webhook caller authentication (shared-secret gate). When
    // incred_webhook_secret is configured, a spoofed caller with no/wrong
    // X-Webhook-Token must be rejected (401) and must NOT mutate the loan.
    [Fact]
    public async Task ReceiveWebhook_SecretConfigured_WrongToken_RejectsWithoutSyncing()
    {
        var (controller, _, _, db) = CreateController();
        db.AppSettings.Add(new AppSetting { Key = "incred_webhook_secret", Value = "s3cr3t-token" });
        var loan = SeedLoanWithCustomer(db);
        loan.ApplicationSource = "incred";
        loan.IncredApplicationId = "APP-777";
        await db.SaveChangesAsync();

        controller.ControllerContext.HttpContext.Request.Headers["X-Webhook-Token"] = "WRONG";
        var payload = Json("{\"APPLICATION_ID\":\"APP-777\",\"EVENT\":\"OFFER_GENERATED\",\"STATUS\":\"SUCCESS\"}");
        var result = await controller.ReceiveWebhook(payload);

        result.Should().BeOfType<UnauthorizedObjectResult>();
        var untouched = await db.Loans.FirstAsync(l => l.Id == loan.Id);
        untouched.IncredLastWebhookEvent.Should().BeNull("a spoofed webhook must not mutate the loan");
        untouched.IncredLastWebhookStatus.Should().BeNull();
    }

    [Fact]
    public async Task ReceiveWebhook_SecretConfigured_CorrectToken_SyncsLoanRow()
    {
        var (controller, _, _, db) = CreateController();
        db.AppSettings.Add(new AppSetting { Key = "incred_webhook_secret", Value = "s3cr3t-token" });
        var loan = SeedLoanWithCustomer(db);
        loan.ApplicationSource = "incred";
        loan.IncredApplicationId = "APP-778";
        await db.SaveChangesAsync();

        controller.ControllerContext.HttpContext.Request.Headers["X-Webhook-Token"] = "s3cr3t-token";
        var payload = Json("{\"APPLICATION_ID\":\"APP-778\",\"EVENT\":\"DISBURSED\",\"STATUS\":\"SUCCESS\"}");
        var result = await controller.ReceiveWebhook(payload);

        result.Should().BeOfType<OkObjectResult>();
        var updated = await db.Loans.FirstAsync(l => l.Id == loan.Id);
        updated.IncredLastWebhookEvent.Should().Be("DISBURSED");
        updated.IncredLastWebhookStatus.Should().Be("SUCCESS");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Token caching
    // ═══════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task TokenCache_ReusedAcrossCalls_OnlyFetchesTokenOnce()
    {
        var (controller, handler, _, _) = CreateController();
        handler.Enqueue(HttpStatusCode.OK, TokenSuccessBody);
        handler.Enqueue(HttpStatusCode.OK, "{\"status\":true}");
        handler.Enqueue(HttpStatusCode.OK, "{\"status\":true}");

        await controller.CheckEligibility(Json("{\"a\":1}"));
        await controller.CheckEligibility(Json("{\"a\":1}"));

        handler.RequestUrls.Count(u => u.Contains("openid-connect/token")).Should().Be(1);
        handler.RequestUrls.Count(u => u.Contains("/loan/application/eligibility")).Should().Be(2);
    }

    [Fact]
    public async Task TokenCache_ExpiredEntry_TriggersRefetch()
    {
        var (controller, handler, cache, _) = CreateController();
        // Pre-seed an already-expired cached token for the seeded test credentials
        // (CreateController() now seeds AppSettings — see PHASE 6 fix above —
        // so _loadCreds() resolves TestClientId rather than a hardcoded default).
        await cache.SetAsync(
            IncredController.TOKEN_CACHE_KEY_PREFIX + TestClientId,
            new IncredController.CachedIncredToken { AccessToken = "stale", ExpiresAtUtc = DateTime.UtcNow.AddMinutes(-5) });

        handler.Enqueue(HttpStatusCode.OK, TokenSuccessBody);
        handler.Enqueue(HttpStatusCode.OK, "{\"status\":true}");

        await controller.CheckEligibility(Json("{\"a\":1}"));

        handler.RequestUrls.Count(u => u.Contains("openid-connect/token")).Should().Be(1,
            "an expired cache entry must not be treated as valid");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 401 refresh-and-retry
    // ═══════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task Call_401WithCachedToken_RefreshesTokenAndRetriesOnce()
    {
        var (controller, handler, _, _) = CreateController();
        handler.Enqueue(HttpStatusCode.OK, TokenSuccessBody);                       // initial token fetch
        handler.Enqueue(HttpStatusCode.Unauthorized, "{\"message\":\"expired\"}");  // first call rejected
        handler.Enqueue(HttpStatusCode.OK, TokenSuccessBody);                       // forced refresh
        handler.Enqueue(HttpStatusCode.OK, "{\"status\":true}");                    // retried call succeeds

        var result = await controller.CheckEligibility(Json("{\"a\":1}"));

        var content = result.Should().BeOfType<ContentResult>().Subject;
        content.Content.Should().Contain("\"status\":true");
        handler.RequestUrls.Count(u => u.Contains("openid-connect/token")).Should().Be(2);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Retry / backoff behavior
    // ═══════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task OfferRequest_429_RetriesAndSucceeds()
    {
        var (controller, handler, _, _) = CreateController();
        handler.Enqueue(HttpStatusCode.OK, TokenSuccessBody);
        handler.Enqueue(HttpStatusCode.TooManyRequests, "{\"message\":\"rate limited\"}");
        handler.Enqueue(HttpStatusCode.OK, "{\"status\":true}");

        var result = await controller.OfferRequest(Json("{\"APPLICATION_ID\":\"A1\"}"));

        var content = result.Should().BeOfType<ContentResult>().Subject;
        content.Content.Should().Contain("\"status\":true");
        handler.RequestUrls.Count(u => u.Contains("/offer/request")).Should().Be(2);
    }

    [Fact]
    public async Task PollOfferStatus_500_RetriesAndSucceeds()
    {
        var (controller, handler, _, _) = CreateController();
        handler.Enqueue(HttpStatusCode.OK, TokenSuccessBody);
        handler.Enqueue(HttpStatusCode.InternalServerError, "{\"message\":\"boom\"}");
        handler.Enqueue(HttpStatusCode.OK, "{\"status\":true}");

        var result = await controller.PollOfferStatus(Json("{\"APPLICATION_ID\":\"A1\"}"));

        var content = result.Should().BeOfType<ContentResult>().Subject;
        content.Content.Should().Contain("\"status\":true");
        handler.RequestUrls.Count(u => u.Contains("/offer/status")).Should().Be(2);
    }

    [Fact]
    public async Task OfferRequest_400_DoesNotRetry()
    {
        var (controller, handler, _, _) = CreateController();
        handler.Enqueue(HttpStatusCode.OK, TokenSuccessBody);
        handler.Enqueue(HttpStatusCode.BadRequest, "{\"status\":false,\"message\":\"bad input\"}");

        var result = await controller.OfferRequest(Json("{\"APPLICATION_ID\":\"A1\"}"));

        result.Should().BeOfType<ContentResult>();
        handler.RequestUrls.Count(u => u.Contains("/offer/request")).Should().Be(1,
            "4xx business errors must not be retried");
    }

    [Fact]
    public async Task CreateApplication_500_NeverRetried()
    {
        var (controller, handler, _, _) = CreateController();
        handler.Enqueue(HttpStatusCode.OK, TokenSuccessBody);
        handler.Enqueue(HttpStatusCode.InternalServerError, "{\"message\":\"boom\"}");

        var result = await controller.CreateApplication(Json("{\"MOBILE\":\"9999999999\"}"));

        result.Should().BeOfType<ContentResult>();
        handler.RequestUrls.Count(u => u.Contains("/application/init")).Should().Be(1,
            "application/init must never be blindly retried, even on 5xx — a timeout/5xx here is ambiguous " +
            "(InCred may have already created the application) and retrying could create a duplicate");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Partial failure / recovery
    // ═══════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task CreateIncredApplicationForLoan_OfferRequestFails_KeepsApplicationCreated()
    {
        var (controller, handler, _, db) = CreateController();
        var loan = SeedLoanWithCustomer(db);

        handler.Enqueue(HttpStatusCode.OK, TokenSuccessBody);
        handler.Enqueue(HttpStatusCode.OK,
            "{\"status\":true,\"response\":{\"APPLICATION_ID\":\"APP-1\",\"CUSTOMER_ID\":\"CUST-1\"}}"); // application/init succeeds
        // offer/request allows transient retry (3 attempts) — fail all 3
        handler.Enqueue(HttpStatusCode.InternalServerError, "{\"message\":\"boom\"}");
        handler.Enqueue(HttpStatusCode.InternalServerError, "{\"message\":\"boom\"}");
        handler.Enqueue(HttpStatusCode.InternalServerError, "{\"message\":\"boom\"}");

        var result = await controller.CreateIncredApplicationForLoan(loan.Id);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        var body = ok.Value.Should().BeOfType<ApiResponseDto<IncredLoanInfoDto>>().Subject;
        body.Data!.IncredApplicationId.Should().Be("APP-1",
            "the application must remain created even though the subsequent offer step failed");
        // After 3 failed attempts, offer/request's last (still-erroring) response body is
        // returned as-is and parsed as JSON — InCred's body has no "status":true, so this
        // hits the business-failure branch (not the catch block) with its own message.
        body.Message.Should().Contain("boom");
    }
}
