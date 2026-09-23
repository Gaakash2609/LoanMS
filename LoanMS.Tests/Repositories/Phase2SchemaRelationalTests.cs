using FluentAssertions;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace LoanMS.Tests.Repositories;

/// <summary>
/// Phase 2 RBAC — schema verification on a REAL relational provider (SQLite
/// in-memory), not the EF InMemory fake. EnsureCreated() builds the schema
/// straight from the entity model — exactly the dev/SQLite path in Program.cs —
/// so this proves the new G-10/G-11 LoanDocument columns and the G-23
/// AuditLog.Reason column map to real SQL columns with the correct types and
/// round-trip (defaults included). It catches relational type-mapping problems
/// the InMemory provider would silently ignore. The production Postgres path is
/// covered by the additive ADD COLUMN IF NOT EXISTS migrations.
/// </summary>
public class Phase2SchemaRelationalTests
{
    [Fact]
    public void DocumentVerificationFields_And_AuditReason_RoundTrip_OnRelationalSchema()
    {
        var connection = new SqliteConnection("DataSource=:memory:");
        connection.Open();
        try
        {
            var options = new DbContextOptionsBuilder<AppDbContext>()
                .UseSqlite(connection)
                .Options;

            using (var db = new AppDbContext(options))
            {
                db.Database.EnsureCreated();   // model → real relational schema

                db.Users.Add(new User { Id = 1, FullName = "U", Email = "u@x.com" });
                db.Customers.Add(new Customer { Id = 1, FullName = "C" });
                db.Loans.Add(new Loan { Id = 1, LoanNumber = "L1", CustomerId = 1, CreatedByUserId = 1 });

                // Default-value document (mimics an existing/pre-migration row).
                db.Set<LoanDocument>().Add(new LoanDocument
                {
                    Id = 1, LoanId = 1, DocumentName = "d1", DocumentType = "identity", FilePath = "1/a.pdf"
                });
                // Fully-populated verification/versioning row.
                db.Set<LoanDocument>().Add(new LoanDocument
                {
                    Id = 2, LoanId = 1, DocumentName = "d2", DocumentType = "income", FilePath = "1/b.pdf",
                    Status = "Rejected", ReviewNote = "blurred", ReviewedByUserId = "7",
                    ReviewedAt = DateTime.UtcNow, Version = 2, SupersededByDocumentId = null
                });
                db.AuditLogs.Add(new AuditLog
                {
                    EntityName = "Loans", Action = "StageOverride", EntityId = "1",
                    OldValues = "Approved", NewValues = "Disbursed", Reason = "exception approved"
                });
                db.SaveChanges();
            }

            using (var db = new AppDbContext(options))
            {
                var d1 = db.Set<LoanDocument>().Find(1)!;
                d1.Status.Should().Be("Pending");   // entity default persisted to a real column
                d1.Version.Should().Be(1);

                var d2 = db.Set<LoanDocument>().Find(2)!;
                d2.Status.Should().Be("Rejected");
                d2.ReviewNote.Should().Be("blurred");
                d2.ReviewedByUserId.Should().Be("7");
                d2.Version.Should().Be(2);

                var audit = db.AuditLogs.Single();
                audit.Reason.Should().Be("exception approved");
                audit.OldValues.Should().Be("Approved");
                audit.NewValues.Should().Be("Disbursed");
            }
        }
        finally
        {
            connection.Close();
        }
    }
}
