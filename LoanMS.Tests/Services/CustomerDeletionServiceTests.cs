using FluentAssertions;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using LoanMS.Infrastructure.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LoanMS.Tests.Services;

/// <summary>
/// Permanent customer delete. Runs on a real relational database (SQLite in
/// memory, foreign keys enforced) — the InMemory provider can neither execute
/// bulk deletes nor enforce FKs, so it could not prove "no orphans".
/// Every test seeds a TARGET customer and an identical CONTROL customer with a
/// row in every linked table, then checks the target is gone everywhere and
/// the control is untouched.
/// </summary>
public class CustomerDeletionServiceTests : IDisposable
{
    private readonly SqliteConnection _conn;
    private readonly AppDbContext _db;
    private readonly FakeStorage _storage = new();

    public CustomerDeletionServiceTests()
    {
        _conn = new SqliteConnection("DataSource=:memory:");
        _conn.Open();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(_conn).Options);
        _db.Database.EnsureCreated();
        _db.Users.Add(new User { Id = 1, FullName = "Admin", Email = "admin@x.com", PasswordHash = "x", Role = UserRole.Admin });
        _db.SaveChanges();
    }

    public void Dispose() { _db.Dispose(); _conn.Dispose(); }

    private sealed class FakeStorage : IFileStorageService
    {
        public List<string> Deleted { get; } = new();
        public string? FailKey { get; set; }
        public Task SaveAsync(string key, Stream content, string contentType, CancellationToken ct = default) => Task.CompletedTask;
        public Task<(Stream Content, string? ContentType)?> GetAsync(string key, CancellationToken ct = default) => Task.FromResult<(Stream, string?)?>(null);
        public Task<bool> ExistsAsync(string key, CancellationToken ct = default) => Task.FromResult(false);
        public Task DeleteAsync(string key, CancellationToken ct = default)
        {
            if (key == FailKey) throw new IOException("storage down");
            Deleted.Add(key);
            return Task.CompletedTask;
        }
    }

    private CustomerDeletionService Svc() => new(_db, _storage, NullLogger<CustomerDeletionService>.Instance);

    private sealed record Seeded(int CustomerId, int LoanId, string LoanNumber, string Email, int DocId, string DocPath, int ClaimId, int TaskId, int TicketId);

    /// <summary>One customer with a row in every table linked to it (directly or by id/text).</summary>
    private Seeded SeedCustomer(string tag, LoanStatus status = LoanStatus.Closed)
    {
        var email = $"{tag}@cust.com";
        var c = new Customer { FullName = $"Cust {tag}", Email = email, Phone = "90000" + tag.GetHashCode().ToString("D5")[^5..], PanNumber = $"ABCDE{Math.Abs(tag.GetHashCode()) % 9000 + 1000}F" };
        _db.Customers.Add(c); _db.SaveChanges();
        var loanNumber = $"EFIN-{tag}";
        var loan = new Loan { LoanNumber = loanNumber, CustomerId = c.Id, CreatedByUserId = 1, Status = status, RequestedAmount = 100000, InterestRate = 12, TenureMonths = 24, IncredApplicationId = $"INC-{tag}" };
        _db.Loans.Add(loan); _db.SaveChanges();

        var doc = new LoanDocument { LoanId = loan.Id, DocumentName = "stmt", DocumentType = "bank_statement", FilePath = $"{loan.Id}/{tag}.pdf" };
        var oldDoc = new LoanDocument { LoanId = loan.Id, DocumentName = "old", DocumentType = "bank_statement", FilePath = $"{loan.Id}/{tag}-old.pdf", IsDeleted = true };
        _db.LoanDocuments.AddRange(doc, oldDoc); _db.SaveChanges();
        var iv = new IncomeVerification { LoanId = loan.Id };
        _db.IncomeVerifications.Add(iv); _db.SaveChanges();
        var claim = new PayoutClaim { LoanId = loan.Id, ClaimedByUserId = 1, ClaimAmount = 1000, ClaimType = "Sales", Status = "Pending" };
        var task = new LoanTask { LoanId = loan.Id, Title = "t", AssignedToUserId = 1, CreatedByUserId = 1 };
        var ticket = new Ticket { LoanId = loan.Id, Title = "k", CreatedByUserId = 1 };
        var tracking = new TrackingEntry { LoanId = loan.Id, Name = "EFIN", CreatedByUserId = 1 };
        var obligation = new LoanObligation { LoanApplicationId = loan.Id };
        _db.AddRange(claim, task, ticket, tracking, obligation); _db.SaveChanges();

        _db.AddRange(
            new IncomeVerificationMonth { IncomeVerificationId = iv.Id },
            new SalarySlipExtraction { LoanId = loan.Id, DocumentId = doc.Id },
            new PerfiosReport { LoanId = loan.Id, BankStatementDocumentId = doc.Id },
            new LoanSanctionDetail { LoanId = loan.Id },
            new LoanStatusHistory { LoanId = loan.Id, ChangedByUserId = 1 },
            new LoanOffer { LoanId = loan.Id },
            new LoanReference { LoanId = loan.Id },
            new LoanBankLine { LoanId = loan.Id, BankName = "HDFC" },
            new AiAgentRun { LoanApplicationId = loan.Id },
            new LenderEmailThreadEntry { LoanApplicationId = loan.Id, Direction = "sent" },
            new AssignmentAuditLog { LoanApplicationId = loan.Id, LoanFrontendId = loanNumber },
            new TicketComment { TicketId = ticket.Id, UserId = 1, Content = "c" },
            new AssignmentLog { EntityType = "Task", EntityId = task.Id },
            new AssignmentLog { EntityType = "Ticket", EntityId = ticket.Id },
            new AppNotification { Type = "claim", ClaimId = claim.Id.ToString() },
            new AppNotification { Type = "sla_breach", Message = $"{loanNumber} has been in Submitted status" },
            new AuditLog { EntityName = "Loans", EntityId = loan.Id.ToString(), Action = "Updated" },
            new AuditLog { EntityName = "Customers", EntityId = c.Id.ToString(), Action = "Updated" },
            new AuditLog { EntityName = "LoanDocument", EntityId = doc.Id.ToString(), Action = "Verified" },
            new AuditLog { EntityName = "Payout", EntityId = claim.Id.ToString(), Action = "StatusChanged" },
            new AuditLog { EntityName = "Wizard", EntityId = "draft", Action = "Created", NewValues = $"{{\"email\": \"{email.ToUpper()}\"}}" });
        _db.SaveChanges();

        var bureau = new BureauReport { CustomerId = c.Id };
        _db.BureauReports.Add(bureau); _db.SaveChanges();
        var account = new BureauAccount { BureauReportId = bureau.Id };
        _db.BureauAccounts.Add(account); _db.SaveChanges();
        _db.AddRange(
            new BureauPaymentHistory { BureauAccountId = account.Id, BureauReportId = bureau.Id },
            new BureauEnquiry { BureauReportId = bureau.Id }, new BureauAddress { BureauReportId = bureau.Id },
            new BureauEmployment { BureauReportId = bureau.Id }, new BureauMobileNumber { BureauReportId = bureau.Id },
            new BureauEmailAddress { BureauReportId = bureau.Id }, new ScoreFactor { BureauReportId = bureau.Id });
        _db.SaveChanges();
        _db.ChangeTracker.Clear();
        return new Seeded(c.Id, loan.Id, loanNumber, email, doc.Id, doc.FilePath, claim.Id, task.Id, ticket.Id);
    }

    private void SeedWebhookLog(params (string AppId, string Ref)[] entries)
    {
        var json = System.Text.Json.JsonSerializer.Serialize(entries.Select(e => new { appId = e.AppId, @ref = e.Ref, @event = "X", status = "SUCCESS", time = "t", ok = true }));
        _db.AppSettings.Add(new AppSetting { Key = "incred_webhook_logs", Value = json, Category = "incred" });
        _db.SaveChanges(); _db.ChangeTracker.Clear();
    }

    /// <summary>Rows in every linked table that belong to the given seeded customer.</summary>
    private Dictionary<string, int> Footprint(Seeded s)
    {
        var loan = s.LoanId; var claim = s.ClaimId.ToString();
        var ivIds = _db.IncomeVerifications.IgnoreQueryFilters().Where(v => v.LoanId == loan).Select(v => v.Id).ToList();
        var bureauIds = _db.BureauReports.Where(b => b.CustomerId == s.CustomerId).Select(b => b.Id).ToList();
        return new()
        {
            ["Customers"] = _db.Customers.IgnoreQueryFilters().Count(c => c.Id == s.CustomerId),
            ["Loans"] = _db.Loans.IgnoreQueryFilters().Count(l => l.Id == loan),
            ["LoanDocuments"] = _db.LoanDocuments.IgnoreQueryFilters().Count(x => x.LoanId == loan),
            ["IncomeVerifications"] = ivIds.Count,
            ["IncomeVerificationMonths"] = _db.IncomeVerificationMonths.IgnoreQueryFilters().Count(m => ivIds.Contains(m.IncomeVerificationId)),
            ["SalarySlipExtractions"] = _db.SalarySlipExtractions.IgnoreQueryFilters().Count(x => x.LoanId == loan),
            ["PerfiosReports"] = _db.PerfiosReports.IgnoreQueryFilters().Count(x => x.LoanId == loan),
            ["LoanObligations"] = _db.LoanObligations.IgnoreQueryFilters().Count(x => x.LoanApplicationId == loan),
            ["LoanSanctionDetails"] = _db.LoanSanctionDetails.IgnoreQueryFilters().Count(x => x.LoanId == loan),
            ["LoanStatusHistories"] = _db.LoanStatusHistories.IgnoreQueryFilters().Count(x => x.LoanId == loan),
            ["LoanOffers"] = _db.LoanOffers.IgnoreQueryFilters().Count(x => x.LoanId == loan),
            ["LoanReferences"] = _db.LoanReferences.IgnoreQueryFilters().Count(x => x.LoanId == loan),
            ["LoanBankLines"] = _db.LoanBankLines.IgnoreQueryFilters().Count(x => x.LoanId == loan),
            ["TrackingEntries"] = _db.TrackingEntries.IgnoreQueryFilters().Count(x => x.LoanId == loan),
            ["AiAgentRuns"] = _db.AiAgentRuns.IgnoreQueryFilters().Count(x => x.LoanApplicationId == loan),
            ["LenderEmailThreadEntries"] = _db.LenderEmailThreadEntries.IgnoreQueryFilters().Count(x => x.LoanApplicationId == loan),
            ["PayoutClaims"] = _db.PayoutClaims.IgnoreQueryFilters().Count(x => x.LoanId == loan),
            ["AssignmentAuditLogs"] = _db.AssignmentAuditLogs.Count(x => x.LoanApplicationId == loan || x.LoanFrontendId == s.LoanNumber),
            ["Tasks"] = _db.Tasks.IgnoreQueryFilters().Count(x => x.LoanId == loan),
            ["Tickets"] = _db.Tickets.IgnoreQueryFilters().Count(x => x.LoanId == loan),
            ["TicketComments"] = _db.TicketComments.IgnoreQueryFilters().Count(x => x.TicketId == s.TicketId),
            ["AssignmentLogs"] = _db.AssignmentLogs.Count(x => (x.EntityType == "Task" && x.EntityId == s.TaskId) || (x.EntityType == "Ticket" && x.EntityId == s.TicketId)),
            ["AppNotifications"] = _db.AppNotifications.IgnoreQueryFilters().Count(n => n.ClaimId == claim || (n.Message != null && n.Message.Contains(s.LoanNumber))),
            ["AuditLogs"] = _db.AuditLogs.Count(a => (a.EntityName == "Loans" && a.EntityId == loan.ToString()) || (a.EntityName == "Customers" && a.EntityId == s.CustomerId.ToString())
                || (a.EntityName == "LoanDocument" && a.EntityId == s.DocId.ToString()) || (a.EntityName == "Payout" && a.EntityId == claim)
                || (a.EntityName == "Wizard" && a.NewValues!.ToLower().Contains(s.Email))),
            ["BureauReports"] = bureauIds.Count,
            ["BureauAccounts"] = _db.BureauAccounts.Count(x => bureauIds.Contains(x.BureauReportId)),
            ["BureauPaymentHistories"] = _db.BureauPaymentHistories.Count(x => bureauIds.Contains(x.BureauReportId)),
            ["BureauEnquiries"] = _db.BureauEnquiries.Count(x => bureauIds.Contains(x.BureauReportId)),
            ["BureauAddresses"] = _db.BureauAddresses.Count(x => bureauIds.Contains(x.BureauReportId)),
            ["BureauEmployments"] = _db.BureauEmployments.Count(x => bureauIds.Contains(x.BureauReportId)),
            ["BureauMobileNumbers"] = _db.BureauMobileNumbers.Count(x => bureauIds.Contains(x.BureauReportId)),
            ["BureauEmailAddresses"] = _db.BureauEmailAddresses.Count(x => bureauIds.Contains(x.BureauReportId)),
            ["ScoreFactors"] = _db.ScoreFactors.Count(x => bureauIds.Contains(x.BureauReportId)),
        };
    }

    [Fact]
    public async Task DeletesEverythingForTheCustomer_AndLeavesAnotherCustomerUntouched()
    {
        var target = SeedCustomer("tgt");
        var control = SeedCustomer("ctl");
        SeedWebhookLog(("INC-tgt", "EFIN-tgt"), ("INC-ctl", "EFIN-ctl"));
        Footprint(target).Values.Should().OnlyContain(n => n > 0, "the seed must cover every linked table");
        var controlBefore = Footprint(control);

        var result = await Svc().DeletePermanentlyAsync(target.CustomerId);

        result.Success.Should().BeTrue(string.Join(";", result.Errors));
        Footprint(target).Where(kv => kv.Value != 0).Should().BeEmpty("no row of the deleted customer may remain");
        Footprint(control).Should().BeEquivalentTo(controlBefore, "another customer's data must not be touched");
        // both files (live + superseded) removed from storage, none of the control's
        _storage.Deleted.Should().BeEquivalentTo($"loans/{target.LoanId}/tgt.pdf", $"loans/{target.LoanId}/tgt-old.pdf");
        var webhook = _db.AppSettings.IgnoreQueryFilters().Single(s => s.Key == "incred_webhook_logs").Value;
        webhook.Should().NotContain("INC-tgt").And.Contain("INC-ctl");
        result.Data!.Loans.Should().Be(1);
        result.Data.Documents.Should().Be(2);
    }

    [Fact]
    public async Task CustomerWithActiveLoan_IsRefused_AndNothingIsDeleted()
    {
        var active = SeedCustomer("act", LoanStatus.Disbursed);
        var before = Footprint(active);

        var result = await Svc().DeletePermanentlyAsync(active.CustomerId);

        result.Success.Should().BeFalse();
        result.Errors.Should().Contain(e => e.Contains("active loans"));
        Footprint(active).Should().BeEquivalentTo(before);
        _storage.Deleted.Should().BeEmpty();
    }

    [Fact]
    public async Task StorageFailure_IsReported_AndTheDatabaseDeleteStands()
    {
        var target = SeedCustomer("sto");
        _storage.FailKey = $"loans/{target.LoanId}/sto.pdf";

        var result = await Svc().DeletePermanentlyAsync(target.CustomerId);

        result.Success.Should().BeTrue();
        result.Data!.StorageFailures.Should().Equal(_storage.FailKey);
        Footprint(target).Values.Should().OnlyContain(n => n == 0);
    }

    [Fact]
    public async Task FailureMidTransaction_RollsEverythingBack()
    {
        var target = SeedCustomer("rbk");
        var before = Footprint(target);
        // An unknown table that still references the loan makes the loan delete
        // fail AFTER the child tables were already deleted in the transaction.
        _db.Database.ExecuteSqlRaw("CREATE TABLE \"ExternalRef\" (\"Id\" INTEGER PRIMARY KEY, \"LoanId\" INTEGER NOT NULL REFERENCES \"Loans\"(\"Id\"))");
        _db.Database.ExecuteSqlRaw($"INSERT INTO \"ExternalRef\" (\"Id\", \"LoanId\") VALUES (1, {target.LoanId})");

        var act = () => Svc().DeletePermanentlyAsync(target.CustomerId);

        await act.Should().ThrowAsync<Exception>();
        _db.ChangeTracker.Clear();
        Footprint(target).Should().BeEquivalentTo(before, "a failed delete must leave no half-deleted state");
        _storage.Deleted.Should().BeEmpty("files are only removed after the database commit");
    }

    [Fact]
    public async Task UnknownCustomer_ReturnsNotFound()
    {
        var result = await Svc().DeletePermanentlyAsync(424242);
        result.Success.Should().BeFalse();
        result.Errors.Should().Contain("Customer not found.");
    }
}
