using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace LoanMS.Infrastructure.Data;

public class AppDbContext : DbContext
{
    /// <summary>Name of the User soft-delete query filter (see OnModelCreating).</summary>
    public const string UserSoftDeleteFilter = "UserSoftDelete";

    /// <summary>Partial unique index: at most ONE active/in-process (non-deleted,
    /// non-terminal) application per customer. The DB-level backstop behind
    /// LoanService.EvaluateApplicationEligibility for concurrent submits.</summary>
    public const string ActiveApplicationIndex = "UX_Loans_CustomerId_ActiveApplication";
    /// <summary>Unique normalised PAN (where a valid PAN exists) — customer-create race guard.</summary>
    public const string CustomerPanIndex = "UX_Customers_PanNormalized";

    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    // Customer identity keys are derived columns — recompute them for every
    // added/modified Customer here, the single choke point every write path
    // (wizard, customer API, anything added later) goes through.
    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        RefreshCustomerIdentityKeys();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        RefreshCustomerIdentityKeys();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    private void RefreshCustomerIdentityKeys()
    {
        foreach (var entry in ChangeTracker.Entries<Customer>())
            if (entry.State is EntityState.Added or EntityState.Modified)
                entry.Entity.RefreshIdentityKeys();
    }

    // Root-caused live in production 2026-08-24: POST /api/loans/{id}/obligations
    // was throwing ArgumentException("Cannot write DateTime with Kind=Unspecified
    // to PostgreSQL type 'timestamp with time zone', only UTC is supported") on
    // every request that set LoanObligation.LoanClosureDate, because
    // ObligationsController assigned the request DTO's DateTime? straight onto
    // the entity with no Kind normalization. This is the SAME bug already fixed
    // once in ReportsController.cs (a `new DateTime(y, m, 1)` with no Kind) --
    // it kept recurring because each fix so far normalized one call site, not
    // the underlying gap: nothing enforces Kind=Utc for the whole model.
    // ConfigureConventions applies a converter to every DateTime/DateTime?
    // property at once, closing the bug class rather than the next instance of
    // it (LoanSanctionDetail.EmiDate, LoanTask.DueDate and PayoutClaim.
    // PaymentDate were the same latent risk, just not yet hit in production).
    // SpecifyKind, not ToUniversalTime -- this does not shift the clock value,
    // it only tags an Unspecified value as the UTC it was always meant to be
    // (mirroring every existing manual DateTimeKind.Utc fix already made).
    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        configurationBuilder.Properties<DateTime>().HaveConversion<UtcDateTimeConverter>();
        configurationBuilder.Properties<DateTime?>().HaveConversion<NullableUtcDateTimeConverter>();
    }

    public DbSet<User>              Users               => Set<User>();
    public DbSet<Customer>          Customers           => Set<Customer>();
    public DbSet<Loan>              Loans               => Set<Loan>();
    public DbSet<LoanDocument>      LoanDocuments       => Set<LoanDocument>();
    public DbSet<LoanBankLine>      LoanBankLines       => Set<LoanBankLine>();
    public DbSet<PerfiosReport>     PerfiosReports      => Set<PerfiosReport>();
    public DbSet<IncomeVerification>      IncomeVerifications      => Set<IncomeVerification>();
    public DbSet<IncomeVerificationMonth> IncomeVerificationMonths => Set<IncomeVerificationMonth>();
    public DbSet<SalarySlipExtraction>    SalarySlipExtractions    => Set<SalarySlipExtraction>();
    public DbSet<LoanSanctionDetail> LoanSanctionDetails => Set<LoanSanctionDetail>();
    public DbSet<LoanObligation>    LoanObligations     => Set<LoanObligation>();
    public DbSet<LoanStatusHistory> LoanStatusHistories => Set<LoanStatusHistory>();
    public DbSet<LoanOffer>         LoanOffers          => Set<LoanOffer>();
    public DbSet<TrackingEntry>     TrackingEntries     => Set<TrackingEntry>();
    public DbSet<LoanTask>          Tasks               => Set<LoanTask>();
    public DbSet<Ticket>            Tickets             => Set<Ticket>();
    public DbSet<TicketComment>     TicketComments      => Set<TicketComment>();
    public DbSet<PayoutClaim>       PayoutClaims        => Set<PayoutClaim>();
    public DbSet<Location>          Locations           => Set<Location>();
    public DbSet<Team>              Teams               => Set<Team>();
    public DbSet<TeamMember>        TeamMembers         => Set<TeamMember>();
    public DbSet<UserLocation>      UserLocations       => Set<UserLocation>();
    public DbSet<DsaPartner>        DsaPartners         => Set<DsaPartner>();
    public DbSet<DsaDocument>       DsaDocuments        => Set<DsaDocument>();
    public DbSet<AppSetting>        AppSettings         => Set<AppSetting>();
    public DbSet<AuditLog>          AuditLogs           => Set<AuditLog>();
    public DbSet<AssignmentLog>     AssignmentLogs      => Set<AssignmentLog>();
    public DbSet<PayoutRule>        PayoutRules         => Set<PayoutRule>();
    public DbSet<LoanReference>     LoanReferences      => Set<LoanReference>();
    public DbSet<PasswordResetToken> PasswordResetTokens => Set<PasswordResetToken>();
    public DbSet<BankMaster>        Banks               => Set<BankMaster>();
    public DbSet<AnalyticCompany>       AnalyticCompanies      => Set<AnalyticCompany>();
    public DbSet<AnalyticCategory>      AnalyticCategories     => Set<AnalyticCategory>();
    public DbSet<BankEligibilityLine>   BankEligibilityLines   => Set<BankEligibilityLine>();
    public DbSet<BankProductRule>       BankProductRules       => Set<BankProductRule>();
    public DbSet<BankProductCategory>   BankProductCategories  => Set<BankProductCategory>();
    public DbSet<IncredRmEmail>     IncredRmEmails      => Set<IncredRmEmail>();
    public DbSet<ReportTarget>      ReportTargets       => Set<ReportTarget>();
    public DbSet<AssignmentAuditLog> AssignmentAuditLogs => Set<AssignmentAuditLog>();
    public DbSet<RejectionReason>   RejectionReasons    => Set<RejectionReason>();
    public DbSet<AppNotification>   AppNotifications    => Set<AppNotification>();
    public DbSet<LenderEmailThreadEntry> LenderEmailThreadEntries => Set<LenderEmailThreadEntry>();
    public DbSet<EmailTemplate>     EmailTemplates      => Set<EmailTemplate>();
    public DbSet<ProductOfferMatrix> ProductOfferMatrices => Set<ProductOfferMatrix>();
    public DbSet<AiAgentRun>        AiAgentRuns         => Set<AiAgentRun>();
    public DbSet<LoginAttempt>      LoginAttempts       => Set<LoginAttempt>();

    // Offer → Deviation → Credit Approval → Sanction → Disbursement
    public DbSet<ApplicationOffer>         ApplicationOffers         => Set<ApplicationOffer>();
    public DbSet<ApplicationOfferRevision> ApplicationOfferRevisions => Set<ApplicationOfferRevision>();
    public DbSet<DeviationRule>            DeviationRules            => Set<DeviationRule>();
    public DbSet<OfferDeviation>           OfferDeviations           => Set<OfferDeviation>();
    public DbSet<CreditApproval>           CreditApprovals           => Set<CreditApproval>();
    public DbSet<Sanction>                 Sanctions                 => Set<Sanction>();
    public DbSet<Disbursement>             Disbursements             => Set<Disbursement>();

    // DB-level constraint names the offer workflow maps to clean 409s (DbConflicts).
    public const string ActiveOfferPerLenderIndex  = "UX_ApplicationOffers_Loan_Bank_Active";
    public const string FinalOfferIndex            = "UX_ApplicationOffers_Loan_Final";
    public const string OpenDeviationIndex         = "UX_OfferDeviations_Offer_Raised";
    public const string ActiveSanctionIndex        = "UX_Sanctions_Loan_Active";
    public const string CompletedDisbursementIndex = "UX_Disbursements_Loan_Completed";

    // CIBIL / Bureau Report Entities
    public DbSet<BureauReport>           BureauReports           => Set<BureauReport>();
    public DbSet<BureauAccount>          BureauAccounts          => Set<BureauAccount>();
    public DbSet<BureauPaymentHistory>   BureauPaymentHistories  => Set<BureauPaymentHistory>();
    public DbSet<BureauEnquiry>          BureauEnquiries         => Set<BureauEnquiry>();
    public DbSet<BureauAddress>          BureauAddresses         => Set<BureauAddress>();
    public DbSet<BureauEmployment>       BureauEmployments       => Set<BureauEmployment>();
    public DbSet<BureauMobileNumber>     BureauMobileNumbers     => Set<BureauMobileNumber>();
    public DbSet<BureauEmailAddress>     BureauEmailAddresses    => Set<BureauEmailAddress>();
    public DbSet<ScoreFactor>            ScoreFactors            => Set<ScoreFactor>();

    protected override void OnModelCreating(ModelBuilder mb)
    {
        base.OnModelCreating(mb);

        mb.Entity<User>(e => {
            e.HasKey(u => u.Id);
            e.HasIndex(u => u.Email).IsUnique();
            e.HasIndex(u => u.LocationId);
            e.HasIndex(u => u.EmployeeCode).IsUnique();
            e.Property(u => u.FullName).HasMaxLength(150).IsRequired();
            e.Property(u => u.Email).HasMaxLength(200).IsRequired();
            e.Property(u => u.PasswordHash).IsRequired();
            e.Property(u => u.Role).HasConversion<string>();
            e.Property(u => u.PhoneNumber).HasMaxLength(30);
            e.Property(u => u.LocationName).HasMaxLength(150);
            e.Property(u => u.SalesTeam).HasMaxLength(150);
            e.Property(u => u.OpTeam).HasMaxLength(150);
            e.Property(u => u.EmployeeCode).HasMaxLength(40);
            // Named (EF Core 10) so queries over HISTORICAL records can opt out of
            // this one filter via QueryableExtensions.IncludeDeletedUsers().
            // Loan.CreatedBy, LoanStatusHistory.ChangedBy, LoanTask.CreatedBy/
            // AssignedTo, Ticket.CreatedBy, TicketComment.User and
            // PayoutClaim.ClaimedBy are REQUIRED relationships to User; with the
            // filter in force EF turns every Include/projection of them into an
            // INNER JOIN against non-deleted users, so deleting a user made every
            // loan/claim/task/ticket/status-history row they created vanish
            // (loan detail 404 even for Admin) — verified on PostgreSQL.
            e.HasQueryFilter(UserSoftDeleteFilter, u => !u.IsDeleted);
            e.HasOne(u => u.Location).WithMany(loc => loc.Users).HasForeignKey(u => u.LocationId).IsRequired(false).OnDelete(DeleteBehavior.SetNull);
        });

        mb.Entity<Customer>(e => {
            e.HasKey(c => c.Id);
            e.HasIndex(c => c.Email).IsUnique();
            e.HasIndex(c => c.PanNumber).IsUnique();
            e.Property(c => c.FullName).HasMaxLength(150).IsRequired();
            e.Property(c => c.Email).HasMaxLength(200).IsRequired();
            e.Property(c => c.Phone).HasMaxLength(15).IsRequired();
            e.Property(c => c.PanNumber).HasMaxLength(10);
            e.Property(c => c.AadhaarNumber).HasMaxLength(12);
            e.Property(c => c.MonthlyIncome).HasColumnType("decimal(18,2)");
            e.Property(c => c.MonthlyObligations).HasColumnType("decimal(18,2)");
            e.Property(c => c.Gender).HasMaxLength(1);
            e.Property(c => c.FatherName).HasMaxLength(150);
            e.Property(c => c.ResidenceType).HasMaxLength(40);
            // Normalised identity keys — global matching runs on these. Soft-
            // deleted rows are deliberately INSIDE the unique PAN guarantee (a
            // deleted customer's PAN is still that person's identity).
            e.Property(c => c.PanNormalized).HasMaxLength(10);
            e.Property(c => c.PhoneNormalized).HasMaxLength(10);
            e.Property(c => c.EmailNormalized).HasMaxLength(200);
            e.HasIndex(c => c.PanNormalized, CustomerPanIndex).IsUnique().HasFilter("\"PanNormalized\" IS NOT NULL");
            e.HasIndex(c => c.PhoneNormalized);
            e.HasIndex(c => c.EmailNormalized);
            e.HasQueryFilter(c => !c.IsDeleted);
        });

        mb.Entity<Loan>(e => {
            e.HasKey(l => l.Id);
            e.HasIndex(l => l.LoanNumber).IsUnique();
            e.HasIndex(l => l.Status);
            e.HasIndex(l => l.CreatedAt);
            e.HasIndex(l => new { l.Status, l.CreatedAt });
            e.HasIndex(l => l.CustomerId);
            e.HasIndex(l => l.CreatedByUserId);
            e.HasIndex(l => l.DsaId);
            e.HasIndex(l => l.PartnerId);
            e.HasIndex(l => l.LocationId);
            e.HasIndex(l => l.LoginUserId);
            e.HasIndex(l => l.OpsManagerId);
            e.Property(l => l.LoanNumber).HasMaxLength(20).IsRequired();
            e.Property(l => l.LoanType).HasConversion<string>();
            // Optimistic concurrency on the status: every UPDATE of a loan carries
            // WHERE "Status" = <value read>, so two concurrent transitions (e.g.
            // Approve and Reject on the same UnderReview loan) can no longer both
            // succeed — the loser gets DbUpdateConcurrencyException → HTTP 409.
            // Model-only: no column is added.
            e.Property(l => l.Status).HasConversion<string>().IsConcurrencyToken();
            e.Property(l => l.PreRejectedStatus).HasConversion<string>();
            e.Property(l => l.RequestedAmount).HasColumnType("decimal(18,2)").IsRequired();
            e.Property(l => l.ApprovedAmount).HasColumnType("decimal(18,2)");
            e.Property(l => l.InterestRate).HasColumnType("decimal(5,2)").IsRequired();
            e.Property(l => l.MonthlyEmi).HasColumnType("decimal(18,2)");
            e.Property(l => l.ApplicationSource).HasMaxLength(20);
            e.Property(l => l.IncredApplicationId).HasMaxLength(100);
            e.HasIndex(l => l.IncredApplicationId); // looked up on every inbound InCred webhook call
            e.Property(l => l.IncredCustomerId).HasMaxLength(100);
            e.Property(l => l.IncredRequestId).HasMaxLength(100);
            e.Property(l => l.IncredOfferStatus).HasMaxLength(20);
            e.Property(l => l.ArchiveReason).HasMaxLength(500);
            e.HasOne(l => l.ArchivedBy).WithMany().HasForeignKey(l => l.ArchivedByUserId).IsRequired(false).OnDelete(DeleteBehavior.SetNull);
            // One active/in-process application per customer (see
            // ActiveApplicationIndex). Terminal statuses come from the same
            // classification the eligibility guard uses, so the two can't drift.
            e.HasIndex(l => l.CustomerId, ActiveApplicationIndex).IsUnique().HasFilter(
                "\"IsDeleted\" = false AND \"Status\" NOT IN (" +
                string.Join(", ", LoanMS.Application.Services.LoanService.TerminalApplicationStatuses.Select(s => $"'{s}'")) + ")");
            e.HasQueryFilter(l => !l.IsDeleted);
            e.HasOne(l => l.Customer).WithMany(c => c.Loans).HasForeignKey(l => l.CustomerId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(l => l.CreatedBy).WithMany(u => u.CreatedLoans).HasForeignKey(l => l.CreatedByUserId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(l => l.AssignedTo).WithMany(u => u.AssignedLoans).HasForeignKey(l => l.AssignedToUserId).IsRequired(false).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(l => l.Dsa).WithMany().HasForeignKey(l => l.DsaId).IsRequired(false).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(l => l.Partner).WithMany().HasForeignKey(l => l.PartnerId).IsRequired(false).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(l => l.Location).WithMany().HasForeignKey(l => l.LocationId).IsRequired(false).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(l => l.LoginUser).WithMany().HasForeignKey(l => l.LoginUserId).IsRequired(false).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(l => l.OpsManager).WithMany().HasForeignKey(l => l.OpsManagerId).IsRequired(false).OnDelete(DeleteBehavior.SetNull);
            e.Property(l => l.SalesTeamName).HasMaxLength(200);
            // Application stages are exactly the LoanStatus enum — NI / Not
            // Interested and Cancelled are not application stages and can no
            // longer be written even by raw SQL.
            var loanStatusList = "'" + string.Join("', '", Enum.GetNames<LoanStatus>()) + "'";
            e.ToTable(t => {
                t.HasCheckConstraint("CK_Loans_Status", $"\"Status\" IN ({loanStatusList})");
                t.HasCheckConstraint("CK_Loans_PreRejectedStatus", $"\"PreRejectedStatus\" IS NULL OR \"PreRejectedStatus\" IN ({loanStatusList})");
            });
        });

        mb.Entity<LoanOffer>(e => {
            e.HasKey(o => o.Id);
            e.HasIndex(o => o.LoanId);
            e.Property(o => o.OfferType).HasMaxLength(20);
            e.Property(o => o.LoanAmount).HasColumnType("decimal(18,2)");
            e.Property(o => o.LoanRate).HasColumnType("decimal(5,2)");
            e.Property(o => o.ProcessingFee).HasColumnType("decimal(5,2)");
            e.HasQueryFilter(o => !o.IsDeleted);
            e.HasOne(o => o.Loan).WithMany(l => l.IncredOffers).HasForeignKey(o => o.LoanId).OnDelete(DeleteBehavior.Cascade);
        });

        mb.Entity<LoanStatusHistory>(e => {
            e.HasKey(h => h.Id);
            e.Property(h => h.FromStatus).HasConversion<string>();
            e.Property(h => h.ToStatus).HasConversion<string>();
            var historyStatusList = "'" + string.Join("', '", Enum.GetNames<LoanStatus>()) + "'";
            e.ToTable(t => {
                t.HasCheckConstraint("CK_LoanStatusHistories_FromStatus", $"\"FromStatus\" IN ({historyStatusList})");
                t.HasCheckConstraint("CK_LoanStatusHistories_ToStatus", $"\"ToStatus\" IN ({historyStatusList})");
            });
            e.HasQueryFilter(h => !h.IsDeleted);
            e.HasOne(h => h.Loan).WithMany(l => l.StatusHistory).HasForeignKey(h => h.LoanId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(h => h.ChangedBy).WithMany().HasForeignKey(h => h.ChangedByUserId).OnDelete(DeleteBehavior.Restrict);
        });

        mb.Entity<LoanDocument>(e => {
            e.HasKey(d => d.Id);
            e.HasQueryFilter(d => !d.IsDeleted);
            e.HasOne(d => d.Loan).WithMany(l => l.Documents).HasForeignKey(d => d.LoanId).OnDelete(DeleteBehavior.Cascade);
            // Gap-2: authoritative applicant identity on the source document.
            e.Property(d => d.ApplicantRole).HasConversion<string>().HasMaxLength(20).IsRequired();
            e.Property(d => d.ApplicantKey).HasMaxLength(100);
            e.HasIndex(d => new { d.LoanId, d.ApplicantRole, d.ApplicantKey });
        });

        mb.Entity<LoanBankLine>(e => {
            e.HasKey(b => b.Id);
            e.HasQueryFilter(b => !b.IsDeleted);
            e.Property(b => b.ApprovedLoan).HasColumnType("numeric(18,2)");
            e.HasOne(b => b.Loan).WithMany(l => l.BankLines).HasForeignKey(b => b.LoanId).OnDelete(DeleteBehavior.Cascade);
        });

        mb.Entity<PerfiosReport>(e => {
            e.HasKey(p => p.Id);
            e.HasQueryFilter(p => !p.IsDeleted);
            e.HasOne(p => p.Loan).WithMany(l => l.PerfiosReports).HasForeignKey(p => p.LoanId).OnDelete(DeleteBehavior.Cascade);
            // Gap-1: evidence-authority columns + binding to the actual bank-statement document.
            e.Property(p => p.EvidenceSource).HasMaxLength(20).IsRequired();
            e.Property(p => p.SourcePdfHash).HasMaxLength(128);
            e.HasIndex(p => p.BankStatementDocumentId);
            e.HasOne(p => p.BankStatementDocument).WithMany()
                .HasForeignKey(p => p.BankStatementDocumentId).OnDelete(DeleteBehavior.SetNull);
        });

        // ── Income Verification (Phase 2 data foundation) ──────────────────────
        // Authoritative salary/income verification result + per-month evidence +
        // immutable slip extraction. States/roles stored as strings (HasConversion)
        // to match the Loan.Status / LoanDocument.Status convention. .WithMany()
        // (no navigation on Loan) keeps the Loan entity untouched, mirroring how
        // AssignmentAuditLog attaches to a loan without a back-collection.
        mb.Entity<IncomeVerification>(e => {
            e.HasKey(v => v.Id);
            e.HasQueryFilter(v => !v.IsDeleted);
            e.HasIndex(v => v.LoanId);
            e.HasIndex(v => new { v.LoanId, v.ApplicantRole, v.ApplicantKey });
            // §26(j) idempotency: a retried/double-clicked verify request with the
            // same key can never create a second verification record.
            e.HasIndex(v => v.IdempotencyKey).IsUnique().HasFilter("\"IdempotencyKey\" IS NOT NULL");
            e.Property(v => v.State).HasConversion<string>().HasMaxLength(30).IsRequired();
            e.Property(v => v.ApplicantRole).HasConversion<string>().HasMaxLength(20).IsRequired();
            e.Property(v => v.ApplicantKey).HasMaxLength(100);
            e.Property(v => v.RequiredMonthsJson).HasColumnType("text");
            e.Property(v => v.ReasonCodesJson).HasColumnType("text");
            e.Property(v => v.DeclaredIncome).HasColumnType("numeric(18,2)");
            e.Property(v => v.ExtractedIncome).HasColumnType("numeric(18,2)");
            e.Property(v => v.VerifiedIncome).HasColumnType("numeric(18,2)");
            e.Property(v => v.SourceReportHash).HasMaxLength(128);
            e.Property(v => v.IdempotencyKey).HasMaxLength(80);
            e.Property(v => v.ReviewDecision).HasMaxLength(20);
            e.Property(v => v.ReviewReason).HasMaxLength(1000);
            e.HasOne(v => v.Loan).WithMany().HasForeignKey(v => v.LoanId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(v => v.Months).WithOne(m => m.IncomeVerification)
                .HasForeignKey(m => m.IncomeVerificationId).OnDelete(DeleteBehavior.Cascade);
        });

        mb.Entity<IncomeVerificationMonth>(e => {
            e.HasKey(m => m.Id);
            e.HasQueryFilter(m => !m.IsDeleted);
            e.HasIndex(m => m.IncomeVerificationId);
            e.Property(m => m.MonthLabel).HasMaxLength(20).IsRequired();
            e.Property(m => m.MatchStatus).HasMaxLength(30).IsRequired();
            e.Property(m => m.ReasonCode).HasMaxLength(40);
            e.Property(m => m.MatchedTransactionRef).HasMaxLength(120);
            e.Property(m => m.VerificationMethod).HasMaxLength(40);
            e.Property(m => m.BankAccountRef).HasMaxLength(120);
            e.Property(m => m.OriginalExtractedSalary).HasColumnType("numeric(18,2)");
            e.Property(m => m.EffectiveSalary).HasColumnType("numeric(18,2)");
            e.Property(m => m.MatchedAmount).HasColumnType("numeric(18,2)");
        });

        mb.Entity<SalarySlipExtraction>(e => {
            e.HasKey(s => s.Id);
            e.HasQueryFilter(s => !s.IsDeleted);
            e.HasIndex(s => s.LoanId);
            e.HasIndex(s => new { s.LoanId, s.ApplicantRole, s.ApplicantKey, s.Year, s.Month });
            e.HasIndex(s => s.ContentHash);
            e.Property(s => s.ApplicantRole).HasConversion<string>().HasMaxLength(20).IsRequired();
            e.Property(s => s.ApplicantKey).HasMaxLength(100);
            e.Property(s => s.MonthLabel).HasMaxLength(20);
            e.Property(s => s.ExtractionMethod).HasMaxLength(30).IsRequired();
            e.Property(s => s.OverrideReason).HasMaxLength(500);
            e.Property(s => s.ContentHash).HasMaxLength(128);
            e.Property(s => s.OriginalNetSalary).HasColumnType("numeric(18,2)");
            e.Property(s => s.UserEditedSalary).HasColumnType("numeric(18,2)");
            e.HasOne(s => s.Loan).WithMany().HasForeignKey(s => s.LoanId).OnDelete(DeleteBehavior.Cascade);
        });

        mb.Entity<LoanSanctionDetail>(e => {
            e.HasKey(s => s.Id);
            e.HasQueryFilter(s => !s.IsDeleted);
            e.Property(s => s.SanctionLoanAmt).HasColumnType("numeric(18,2)");
            e.Property(s => s.SanctionEmi).HasColumnType("numeric(18,2)");
            e.Property(s => s.SanctionRoi).HasColumnType("numeric(5,2)");
            e.Property(s => s.Gst).HasColumnType("numeric(18,2)");
            e.Property(s => s.Insurance).HasColumnType("numeric(18,2)");
            e.Property(s => s.PfPercent).HasColumnType("numeric(5,2)");
            e.Property(s => s.FlatRate).HasColumnType("numeric(5,2)");
            e.HasOne(s => s.Loan).WithOne(l => l.SanctionDetail).HasForeignKey<LoanSanctionDetail>(s => s.LoanId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(s => s.LoanId).IsUnique();
        });

        mb.Entity<LoanObligation>(e => {
            e.HasKey(o => o.Id);
            e.HasIndex(o => o.LoanApplicationId);
            e.Property(o => o.LoanType).HasMaxLength(40).IsRequired();
            e.Property(o => o.FinancerName).HasMaxLength(150);
            e.Property(o => o.SanctionAmount).HasColumnType("decimal(18,2)");
            e.Property(o => o.LoanEmi).HasColumnType("decimal(18,2)");
            e.Property(o => o.AmountOutstanding).HasColumnType("decimal(18,2)");
            e.Property(o => o.LoanAccountNumber).HasMaxLength(50);

            // ── Credit-review extension (additive) ──────────────────────────────
            // Enums stored as strings (HasConversion) with an explicit default so
            // the additive migration backfills existing rows safely: every legacy
            // obligation becomes Source=Manual / VerificationStatus=Unverified /
            // ApplicantRole=Applicant. Roles/state string-persisted exactly like
            // IncomeVerification/SalarySlipExtraction.
            e.Property(o => o.ApplicantRole).HasConversion<string>().HasMaxLength(20)
                .IsRequired().HasDefaultValue(ApplicantRole.Applicant);
            e.Property(o => o.ApplicantKey).HasMaxLength(100);
            e.Property(o => o.Source).HasConversion<string>().HasMaxLength(20)
                .IsRequired().HasDefaultValue(ObligationSource.Manual);
            e.Property(o => o.VerificationStatus).HasConversion<string>().HasMaxLength(20)
                .IsRequired().HasDefaultValue(ObligationVerificationStatus.Unverified);

            e.Property(o => o.InterestRate).HasColumnType("decimal(9,4)");
            e.Property(o => o.Notes).HasMaxLength(1000);

            e.Property(o => o.DetectedEmi).HasColumnType("decimal(18,2)");
            e.Property(o => o.DetectedFinancerName).HasMaxLength(150);
            e.Property(o => o.DetectedAccountNumber).HasMaxLength(50);
            e.Property(o => o.DetectionSignature).HasMaxLength(200);
            e.Property(o => o.DetectionEvidenceJson).HasColumnType("text");

            e.Property(o => o.OverrideReason).HasMaxLength(500);
            e.Property(o => o.VerificationNote).HasMaxLength(500);

            // Applicant-isolated lookups + duplicate-detection guard for re-runs.
            e.HasIndex(o => new { o.LoanApplicationId, o.ApplicantRole, o.ApplicantKey });
            e.HasIndex(o => new { o.LoanApplicationId, o.DetectionSignature });

            e.HasQueryFilter(o => !o.IsDeleted);
            e.HasOne(o => o.LoanApplication).WithMany().HasForeignKey(o => o.LoanApplicationId).OnDelete(DeleteBehavior.Cascade);
        });

        mb.Entity<TrackingEntry>(e => {
            e.HasKey(t => t.Id);
            e.HasIndex(t => t.LoanId);
            e.HasIndex(t => new { t.LoanId, t.CreatedAt });
            e.HasQueryFilter(t => !t.IsDeleted);
            e.HasOne(t => t.Loan).WithMany().HasForeignKey(t => t.LoanId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(t => t.CreatedBy).WithMany().HasForeignKey(t => t.CreatedByUserId).OnDelete(DeleteBehavior.Restrict);
        });

        mb.Entity<LoanTask>(e => {
            e.HasKey(t => t.Id);
            e.HasQueryFilter(t => !t.IsDeleted);
            e.HasOne(t => t.Loan).WithMany().HasForeignKey(t => t.LoanId).IsRequired(false).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(t => t.AssignedTo).WithMany().HasForeignKey(t => t.AssignedToUserId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(t => t.CreatedBy).WithMany().HasForeignKey(t => t.CreatedByUserId).OnDelete(DeleteBehavior.Restrict);
            e.Property(t => t.PauseReason).HasMaxLength(500);
        });

        mb.Entity<Ticket>(e => {
            e.HasKey(t => t.Id);
            e.HasQueryFilter(t => !t.IsDeleted);
            e.HasOne(t => t.Loan).WithMany().HasForeignKey(t => t.LoanId).IsRequired(false).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(t => t.CreatedBy).WithMany().HasForeignKey(t => t.CreatedByUserId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(t => t.AssignedTo).WithMany().HasForeignKey(t => t.AssignedToUserId).IsRequired(false).OnDelete(DeleteBehavior.SetNull);
        });

        mb.Entity<TicketComment>(e => {
            e.HasKey(c => c.Id);
            e.HasIndex(c => new { c.TicketId, c.CreatedAt });
            e.HasQueryFilter(c => !c.IsDeleted);
            e.HasOne(c => c.Ticket).WithMany().HasForeignKey(c => c.TicketId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(c => c.User).WithMany().HasForeignKey(c => c.UserId).OnDelete(DeleteBehavior.Restrict);
        });

        mb.Entity<PayoutClaim>(e => {
            e.HasKey(p => p.Id);
            e.Property(p => p.ClaimAmount).HasColumnType("decimal(18,2)");
            e.Property(p => p.ClaimType).HasMaxLength(20).HasDefaultValue("Sales");
            e.HasQueryFilter(p => !p.IsDeleted);
            e.HasOne(p => p.Loan).WithMany().HasForeignKey(p => p.LoanId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(p => p.ClaimedBy).WithMany().HasForeignKey(p => p.ClaimedByUserId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(p => p.ProcessedBy).WithMany().HasForeignKey(p => p.ProcessedByUserId).IsRequired(false).OnDelete(DeleteBehavior.SetNull);
            // Phase 3: idempotency / duplicate-claim protection. One claim per
            // (loan, claimant, capacity) — e.g. the same person can hold a
            // "Sales" claim and a separately-earned "Dsa" claim on one loan,
            // but never two "Sales" claims on the same loan.
            e.HasIndex(p => new { p.LoanId, p.ClaimedByUserId, p.ClaimType })
                .IsUnique()
                .HasFilter("\"IsDeleted\" = false")
                .HasDatabaseName("IX_PayoutClaims_Loan_Claimant_Type_Unique");
        });

        mb.Entity<Location>(e => {
            e.HasKey(l => l.Id);
            e.Property(l => l.Name).HasMaxLength(100).IsRequired();
            e.Property(l => l.Code).HasMaxLength(20).IsRequired();
            e.HasQueryFilter(l => !l.IsDeleted);
        });

        mb.Entity<BankMaster>(e => {
            e.HasKey(b => b.Id);
            e.Property(b => b.BankName).HasMaxLength(150).IsRequired();
            e.Property(b => b.IfscPrefix).HasMaxLength(20);
            e.Property(b => b.EmpCode).HasMaxLength(50);
            e.Property(b => b.Location).HasMaxLength(200);
            e.Property(b => b.RmName).HasMaxLength(150);
            e.Property(b => b.RmMobile).HasMaxLength(15);
            e.Property(b => b.Email).HasMaxLength(200);
            e.Property(b => b.Remarks).HasMaxLength(500);
            e.HasQueryFilter(b => !b.IsDeleted);
            // Prevent duplicate active bank records with the same name (case-insensitive
            // comparison is enforced in the controller before insert; this index is the
            // last-line-of-defense DB-level guard against races/duplicates).
            e.HasIndex(b => b.BankName)
                .IsUnique()
                .HasFilter("\"IsDeleted\" = false")
                .HasDatabaseName("IX_Banks_BankName_Unique_Active");
            e.Property(b => b.EmpTypesJson).HasColumnType("text");
            e.Property(b => b.CompTypesJson).HasColumnType("text");
        });

        // ── Lender Configuration — eligibility engine ────────────────────────────
        mb.Entity<AnalyticCompany>(e => {
            e.HasKey(c => c.Id);
            e.Property(c => c.Name).HasMaxLength(200).IsRequired();
            e.Property(c => c.EmpTypesJson).HasColumnType("text");
            e.Property(c => c.CompType).HasMaxLength(50);
            e.HasQueryFilter(c => !c.IsDeleted);
        });

        mb.Entity<AnalyticCategory>(e => {
            e.HasKey(c => c.Id);
            e.Property(c => c.Name).HasMaxLength(100).IsRequired();
            e.HasQueryFilter(c => !c.IsDeleted);
        });

        mb.Entity<BankEligibilityLine>(e => {
            e.HasKey(l => l.Id);
            e.Property(l => l.PinCode).HasMaxLength(10);
            e.HasQueryFilter(l => !l.IsDeleted);
            e.HasOne(l => l.Bank).WithMany(b => b.Lines).HasForeignKey(l => l.BankId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(l => l.Company).WithMany().HasForeignKey(l => l.CompanyId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(l => l.Category).WithMany().HasForeignKey(l => l.CategoryId).OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(l => l.BankId);
            e.HasIndex(l => l.CompanyId);
            e.HasIndex(l => l.CategoryId);
        });

        mb.Entity<BankProductRule>(e => {
            e.HasKey(r => r.Id);
            e.HasQueryFilter(r => !r.IsDeleted);
            e.Property(r => r.ProductKey).HasMaxLength(50).IsRequired();
            e.Property(r => r.MaxLoanAmt).HasColumnType("numeric(18,2)");
            e.Property(r => r.MinTurnover).HasColumnType("numeric(18,2)");
            e.Property(r => r.MinAvgBalance).HasColumnType("numeric(18,2)");
            e.HasOne(r => r.Bank).WithMany(b => b.ProductRules).HasForeignKey(r => r.BankId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(r => new { r.BankId, r.ProductKey }).IsUnique();
        });

        mb.Entity<BankProductCategory>(e => {
            e.HasKey(c => c.Id);
            e.HasQueryFilter(c => !c.IsDeleted);
            e.Property(c => c.ProductKey).HasMaxLength(50).IsRequired();
            e.Property(c => c.Name).HasMaxLength(100).IsRequired();
            e.Property(c => c.Color).HasMaxLength(30);
            e.Property(c => c.Notes).HasMaxLength(500);
            e.Property(c => c.MinTurnover).HasColumnType("numeric(18,2)");
            e.HasOne(c => c.Bank).WithMany().HasForeignKey(c => c.BankId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(c => new { c.BankId, c.ProductKey });
        });

        mb.Entity<ReportTarget>(e => {
            e.HasKey(rt => rt.Id);
            e.Property(rt => rt.TargetMonth).HasMaxLength(7).IsRequired();
            e.Property(rt => rt.DisbAmt).HasColumnType("decimal(18,2)");
            e.HasQueryFilter(rt => !rt.IsDeleted);
            // Only one organization-wide (UserId/TeamId both null) target per
            // month — mirrors RPT_TARGETS being keyed uniquely by month today.
            // Per-user/per-team targets (once used) are naturally excluded from
            // this filter since the partial index only covers UserId/TeamId IS NULL.
            e.HasIndex(rt => rt.TargetMonth)
                .IsUnique()
                .HasFilter("\"IsDeleted\" = false AND \"UserId\" IS NULL AND \"TeamId\" IS NULL")
                .HasDatabaseName("IX_ReportTargets_TargetMonth_OrgWide_Unique");
        });

        mb.Entity<IncredRmEmail>(e => {
            e.HasKey(r => r.Id);
            e.Property(r => r.Name).HasMaxLength(150).IsRequired();
            e.Property(r => r.Location).HasMaxLength(100);
            e.Property(r => r.Email).HasMaxLength(200).IsRequired();
            e.Property(r => r.ContactNo).HasMaxLength(15);
            e.HasQueryFilter(r => !r.IsDeleted);
        });

        mb.Entity<Team>(e => {
            e.HasKey(t => t.Id);
            e.Property(t => t.Name).HasMaxLength(100).IsRequired();
            e.Property(t => t.IsActive).HasDefaultValue(true);
            e.HasQueryFilter(t => !t.IsDeleted);
            e.HasOne(t => t.Location).WithMany().HasForeignKey(t => t.LocationId).IsRequired(false).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(t => t.TeamLead).WithMany().HasForeignKey(t => t.TeamLeadUserId).IsRequired(false).OnDelete(DeleteBehavior.SetNull);
        });

        mb.Entity<TeamMember>(e => {
            e.HasKey(m => m.Id);
            e.HasQueryFilter(m => !m.IsDeleted);
            e.HasOne(m => m.Team).WithMany(t => t.Members).HasForeignKey(m => m.TeamId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(m => m.User).WithMany().HasForeignKey(m => m.UserId).OnDelete(DeleteBehavior.Restrict);
        });

        mb.Entity<UserLocation>(e => {
            e.HasKey(m => m.Id);
            e.HasQueryFilter(m => !m.IsDeleted);
            e.HasIndex(m => new { m.UserId, m.LocationId }).IsUnique();
            e.HasOne(m => m.User).WithMany().HasForeignKey(m => m.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(m => m.Location).WithMany().HasForeignKey(m => m.LocationId).OnDelete(DeleteBehavior.Restrict);
        });

        mb.Entity<DsaPartner>(e => {
            e.HasKey(d => d.Id);
            e.Property(d => d.Name).HasMaxLength(150).IsRequired();
            e.Property(d => d.Code).HasMaxLength(20).IsRequired();
            e.Property(d => d.PartnerType).HasConversion<string>().HasMaxLength(20);
            e.Property(d => d.Pan).HasMaxLength(20);
            e.Property(d => d.OfficeAddress).HasMaxLength(300);
            e.Property(d => d.OfficeState).HasMaxLength(100);
            e.Property(d => d.OfficePin).HasMaxLength(10);
            e.Property(d => d.OfficeAddressType).HasMaxLength(30);
            e.Property(d => d.Category).HasMaxLength(30);
            e.HasIndex(d => d.LinkedUserId);
            e.HasIndex(d => d.MappedDsaId);
            e.HasQueryFilter(d => !d.IsDeleted);
            e.HasOne(d => d.MappedSalesUser).WithMany().HasForeignKey(d => d.MappedSalesUserId).IsRequired(false).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(d => d.LinkedUser).WithMany().HasForeignKey(d => d.LinkedUserId).IsRequired(false).OnDelete(DeleteBehavior.SetNull);
            // Self-referencing: a Partner record maps to a DSA record. SetNull (not Cascade) —
            // deleting/soft-deleting a DSA must never cascade-delete the Partners mapped to it.
            e.HasOne(d => d.MappedDsa).WithMany().HasForeignKey(d => d.MappedDsaId).IsRequired(false).OnDelete(DeleteBehavior.SetNull);
        });

        mb.Entity<DsaDocument>(e => {
            e.HasKey(d => d.Id);
            e.Property(d => d.DocumentName).HasMaxLength(255).IsRequired();
            e.Property(d => d.DocumentType).HasMaxLength(50).IsRequired();
            e.Property(d => d.FilePath).HasMaxLength(500).IsRequired();
            e.Property(d => d.UploadedByUserId).HasMaxLength(50);
            e.HasIndex(d => d.DsaPartnerId);
            e.HasQueryFilter(d => !d.IsDeleted);
            e.HasOne(d => d.DsaPartner).WithMany(p => p.Documents).HasForeignKey(d => d.DsaPartnerId).OnDelete(DeleteBehavior.Cascade);
        });

        mb.Entity<AppSetting>(e => {
            e.HasKey(s => s.Id);
            e.Property(s => s.Key).HasMaxLength(100).IsRequired();
            e.HasQueryFilter(s => !s.IsDeleted);
            // Org-wide settings (UserId IS NULL) keep the original one-row-per-Key
            // guarantee — unchanged behaviour for Roles/Menu-Visibility/InCred/AI/
            // Email/branding config.
            e.HasIndex(s => s.Key)
                .IsUnique()
                .HasFilter("\"UserId\" IS NULL")
                .HasDatabaseName("IX_AppSettings_Key_OrgWide_Unique");
            // Per-user settings (e.g. User Profile) get one row per (Key, UserId) —
            // each user has their own independent copy of the same Key.
            e.HasIndex(s => new { s.Key, s.UserId })
                .IsUnique()
                .HasFilter("\"UserId\" IS NOT NULL")
                .HasDatabaseName("IX_AppSettings_Key_UserId_Unique");
        });

        mb.Entity<AuditLog>(e => {
            e.HasKey(a => a.Id);
            e.HasIndex(a => a.EntityName);
            e.HasIndex(a => a.UserId);
            e.HasIndex(a => a.CreatedAt);
            e.Property(a => a.Action).HasMaxLength(50).IsRequired();
            e.Property(a => a.EntityName).HasMaxLength(100).IsRequired();
        });

        mb.Entity<AssignmentLog>(e => {
            e.HasKey(a => a.Id);
            e.HasIndex(a => new { a.EntityType, a.EntityId });
            e.HasIndex(a => a.CreatedAt);
            e.Property(a => a.EntityType).HasMaxLength(50).IsRequired();
            e.Property(a => a.FromUserName).HasMaxLength(150);
            e.Property(a => a.ToUserName).HasMaxLength(150).IsRequired();
            e.Property(a => a.AssignedByName).HasMaxLength(150);
            e.Property(a => a.Notes).HasMaxLength(500);
            // Insert-only audit trail — no query filter needed (no IsDeleted column),
            // no FK constraints to Users (mirrors AuditLog's UserId, which is also a
            // plain nullable int, not a navigation property) so a user being removed
            // later never breaks or cascades against historical assignment records.
        });

        mb.Entity<AssignmentAuditLog>(e => {
            e.HasKey(a => a.Id);
            e.HasIndex(a => a.LoanApplicationId);
            e.HasIndex(a => a.LoanFrontendId);
            e.HasIndex(a => a.AssignedAt);
            e.Property(a => a.LoanFrontendId).HasMaxLength(40).IsRequired();
            e.Property(a => a.Location).HasMaxLength(100);
            e.Property(a => a.LoanType).HasMaxLength(60);
            e.Property(a => a.SalesPerson).HasMaxLength(150);
            e.Property(a => a.SalesTeam).HasMaxLength(150);
            e.Property(a => a.AssignedToUserName).HasMaxLength(150);
            e.Property(a => a.AssignedByName).HasMaxLength(150).IsRequired();
            e.Property(a => a.Method).HasMaxLength(20).IsRequired();
            e.Property(a => a.PreviousUserName).HasMaxLength(150);
            e.Property(a => a.Reason).HasMaxLength(500);
            // Insert-only audit trail — no query filter needed (no IsDeleted
            // column), same convention as AssignmentLog. LoanApplicationId is
            // nullable and left un-cascaded (SetNull) rather than Cascade —
            // this record must survive even if the loan it refers to is later
            // hard-deleted, since it's a historical audit entry, not live data.
            e.HasOne(a => a.LoanApplication)
                .WithMany()
                .HasForeignKey(a => a.LoanApplicationId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        mb.Entity<LenderEmailThreadEntry>(e => {
            e.HasKey(t => t.Id);
            e.HasIndex(t => t.LoanApplicationId);
            e.Property(t => t.Direction).HasMaxLength(20).IsRequired();
            e.Property(t => t.Stage).HasMaxLength(40);
            e.Property(t => t.RmName).HasMaxLength(150);
            e.Property(t => t.RmEmail).HasMaxLength(200);
            e.Property(t => t.Subject).HasMaxLength(500);
            e.Property(t => t.Source).HasMaxLength(40);
            e.HasQueryFilter(t => !t.IsDeleted);
            e.HasOne(t => t.LoanApplication).WithMany().HasForeignKey(t => t.LoanApplicationId).OnDelete(DeleteBehavior.Cascade);
        });

        mb.Entity<EmailTemplate>(e => {
            e.HasKey(t => t.Id);
            e.HasQueryFilter(t => !t.IsDeleted);
            e.Property(t => t.TemplateKey).HasMaxLength(40).IsRequired();
            e.Property(t => t.Subject).HasMaxLength(500).IsRequired();
            e.HasIndex(t => t.TemplateKey).IsUnique().HasFilter("\"IsDeleted\" = false");
        });

        mb.Entity<ProductOfferMatrix>(e => {
            e.HasKey(p => p.Id);
            e.HasQueryFilter(p => !p.IsDeleted);
            e.Property(p => p.ProductKey).HasMaxLength(60).IsRequired();
            e.HasIndex(p => p.ProductKey).IsUnique().HasFilter("\"IsDeleted\" = false");
        });

        mb.Entity<AiAgentRun>(e => {
            e.HasKey(a => a.Id);
            e.HasIndex(a => a.LoanApplicationId);
            e.Property(a => a.RunId).HasMaxLength(60).IsRequired();
            e.Property(a => a.Status).HasMaxLength(20).IsRequired();
            e.HasQueryFilter(a => !a.IsDeleted);
            e.HasOne(a => a.LoanApplication).WithMany().HasForeignKey(a => a.LoanApplicationId).OnDelete(DeleteBehavior.Cascade);
        });

        mb.Entity<LoginAttempt>(e => {
            e.HasKey(a => a.Id);
            e.Property(a => a.Email).HasMaxLength(200).IsRequired();
            e.Property(a => a.IpAddress).HasMaxLength(60).IsRequired();
            e.HasIndex(a => new { a.Email, a.CreatedAt });
            e.HasIndex(a => new { a.IpAddress, a.CreatedAt });
            // No soft-delete query filter — rows are hard-deleted on cleanup
            // (successful login / periodic purge), not tombstoned; this is a
            // short-lived lockout counter, not an audit trail.
        });

        mb.Entity<RejectionReason>(e => {
            e.HasKey(r => r.Id);
            e.HasQueryFilter(r => !r.IsDeleted);
            e.Property(r => r.Key).HasMaxLength(80).IsRequired();
            e.Property(r => r.Label).HasMaxLength(300).IsRequired();
            e.HasIndex(r => r.Key).IsUnique().HasFilter("\"IsDeleted\" = false");
        });

        mb.Entity<AppNotification>(e => {
            e.HasKey(n => n.Id);
            e.HasQueryFilter(n => !n.IsDeleted);
            e.Property(n => n.Type).HasMaxLength(60).IsRequired();
            e.Property(n => n.Partner).HasMaxLength(200);
            e.Property(n => n.TargetRole).HasMaxLength(40);
            e.Property(n => n.Amount).HasColumnType("decimal(18,2)");
            e.Property(n => n.Icon).HasMaxLength(10);
            e.Property(n => n.Message).HasMaxLength(500);
            e.HasIndex(n => new { n.TargetRole, n.IsRead, n.CreatedAt });
            e.HasIndex(n => new { n.TargetUserId, n.IsRead, n.CreatedAt });
        });

        mb.Entity<PayoutRule>(e => {
            e.HasKey(p => p.Id);
            e.Property(p => p.LoanType).HasMaxLength(50).IsRequired();
            e.Property(p => p.Percentage).HasColumnType("decimal(5,2)");
            e.Property(p => p.MinPayout).HasColumnType("decimal(18,2)");
            e.Property(p => p.MaxPayout).HasColumnType("decimal(18,2)");
            e.HasIndex(p => p.LoanType);
        });

        mb.Entity<LoanReference>(e => {
            e.HasKey(r => r.Id);
            e.Property(r => r.Name).HasMaxLength(150).IsRequired();
            e.Property(r => r.Mobile).HasMaxLength(15).IsRequired();
            e.Property(r => r.Relation).HasMaxLength(50).IsRequired();
            e.HasIndex(r => r.LoanId);
            e.HasQueryFilter(r => !r.IsDeleted);
            // WithMany(l => l.References) — NOT the parameterless WithMany().
            //
            // Loan.References was added after this line was written. With a bare
            // WithMany(), EF treats this as a relationship to an *unnamed*
            // navigation and then discovers Loan.References separately by
            // convention, giving TWO relationships between the same pair of
            // types. The second one needs its own foreign key, and because
            // LoanId is already taken by this one, EF invents a shadow property
            // "LoanId1" — logged on every model build as:
            //   "The foreign key property 'LoanReference.LoanId1' was created in
            //    shadow state because a conflicting property with the simple name
            //    'LoanId' exists in the entity type"
            // and scaffolded into any new migration as a junk LoanReferences.LoanId1
            // column that no code reads or writes (confirmed absent from the
            // database — every other pending column in the model already exists).
            //
            // Naming the inverse navigation collapses both into the single
            // relationship that was always intended. No schema change: LoanId is
            // already the FK column and already indexed above.
            e.HasOne(r => r.Loan).WithMany(l => l.References).HasForeignKey(r => r.LoanId).OnDelete(DeleteBehavior.Cascade);
        });

        mb.Entity<PasswordResetToken>(e => {
            e.HasKey(t => t.Id);
            e.Property(t => t.TokenHash).HasMaxLength(64).IsRequired();
            e.HasIndex(t => t.TokenHash).IsUnique();
            e.HasIndex(t => new { t.UserId, t.IsUsed });
            e.HasQueryFilter(t => !t.IsDeleted);
            e.HasOne(t => t.User)
             .WithMany()
             .HasForeignKey(t => t.UserId)
             .OnDelete(DeleteBehavior.Cascade);
        });

        // CIBIL / Bureau Report Entities
        mb.Entity<BureauReport>(e => {
            e.HasKey(b => b.Id);
            e.HasIndex(b => b.CustomerId);
            e.Property(b => b.CreditScore).IsRequired();
            e.Property(b => b.RiskCategory).HasMaxLength(50);
            e.Property(b => b.RiskLevel).HasMaxLength(50);
            e.Property(b => b.RiskGrade).HasMaxLength(1);
            e.Property(b => b.BureauProvider).HasMaxLength(50);
            e.Property(b => b.LendingRecommendation).HasMaxLength(50);
            e.Property(b => b.FullName).HasMaxLength(150);
            e.Property(b => b.Gender).HasMaxLength(10);
            e.Property(b => b.PAN).HasMaxLength(10);
            e.Property(b => b.AadhaarNumber).HasMaxLength(20);
            e.Property(b => b.CKYCNumber).HasMaxLength(50);
            e.Property(b => b.BureauRiskScore).HasColumnType("decimal(5,2)");
            e.Property(b => b.AnnualIncome).HasColumnType("decimal(18,2)");
            e.Property(b => b.TotalSanctionAmount).HasColumnType("decimal(18,2)");
            e.Property(b => b.CurrentOutstanding).HasColumnType("decimal(18,2)");
            e.Property(b => b.OverdueAmount).HasColumnType("decimal(18,2)");
            e.Property(b => b.OccupationType).HasMaxLength(100);
            e.Property(b => b.CreditMaturity).HasMaxLength(50);
            e.Property(b => b.LoanClosureBehaviour).HasMaxLength(100);
            e.HasMany(b => b.Accounts).WithOne(a => a.BureauReport).HasForeignKey(a => a.BureauReportId).OnDelete(DeleteBehavior.Cascade);
            // PaymentHistory is related to BureauAccount, not directly to BureauReport
            e.HasMany(b => b.Enquiries).WithOne(e => e.BureauReport).HasForeignKey(e => e.BureauReportId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(b => b.Addresses).WithOne(a => a.BureauReport).HasForeignKey(a => a.BureauReportId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(b => b.EmploymentHistory).WithOne(e => e.BureauReport).HasForeignKey(e => e.BureauReportId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(b => b.MobileNumbers).WithOne(m => m.BureauReport).HasForeignKey(m => m.BureauReportId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(b => b.EmailAddresses).WithOne(e => e.BureauReport).HasForeignKey(e => e.BureauReportId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(b => b.ScoreFactors).WithOne(sf => sf.BureauReport).HasForeignKey(sf => sf.BureauReportId).OnDelete(DeleteBehavior.Cascade);
        });

        mb.Entity<BureauAccount>(e => {
            e.HasKey(a => a.Id);
            e.HasIndex(a => a.BureauReportId);
            e.Property(a => a.LenderName).HasMaxLength(150).IsRequired();
            e.Property(a => a.LoanType).HasMaxLength(50);
            e.Property(a => a.Ownership).HasMaxLength(50);
            e.Property(a => a.AccountNumber).HasMaxLength(100);
            e.Property(a => a.AccountStatus).HasMaxLength(50);
            e.Property(a => a.PaymentFrequency).HasMaxLength(50);
            e.Property(a => a.SanctionAmount).HasColumnType("decimal(18,2)");
            e.Property(a => a.CurrentBalance).HasColumnType("decimal(18,2)");
            e.Property(a => a.EMIAmount).HasColumnType("decimal(18,2)");
            e.HasMany(a => a.PaymentHistory).WithOne(ph => ph.Account).HasForeignKey(ph => ph.BureauAccountId).OnDelete(DeleteBehavior.Cascade);
        });

        mb.Entity<BureauPaymentHistory>(e => {
            e.HasKey(ph => ph.Id);
            e.HasIndex(ph => new { ph.BureauAccountId, ph.ReportMonth });
            e.Property(ph => ph.DPDStatus).HasMaxLength(10);
            e.Property(ph => ph.Status).HasMaxLength(50);
            e.Property(ph => ph.ScheduledAmount).HasColumnType("decimal(18,2)");
            e.Property(ph => ph.PaidAmount).HasColumnType("decimal(18,2)");
        });

        mb.Entity<BureauEnquiry>(e => {
            e.HasKey(e => e.Id);
            e.HasIndex(e => e.BureauReportId);
            e.Property(e => e.EnquiryType).HasMaxLength(100);
            e.Property(e => e.Purpose).HasMaxLength(100);
            e.Property(e => e.RequestedAmount).HasColumnType("decimal(18,2)");
        });

        mb.Entity<BureauAddress>(e => {
            e.HasKey(a => a.Id);
            e.HasIndex(a => a.BureauReportId);
            e.Property(a => a.AddressType).HasMaxLength(50);
            e.Property(a => a.Street).HasMaxLength(200);
            e.Property(a => a.City).HasMaxLength(100);
            e.Property(a => a.State).HasMaxLength(100);
            e.Property(a => a.PostalCode).HasMaxLength(20);
            e.Property(a => a.Country).HasMaxLength(100);
        });

        mb.Entity<BureauEmployment>(e => {
            e.HasKey(e => e.Id);
            e.HasIndex(e => e.BureauReportId);
            e.Property(e => e.EmployerName).HasMaxLength(200);
            e.Property(e => e.Occupation).HasMaxLength(100);
            e.Property(e => e.EmploymentType).HasMaxLength(50);
            e.Property(e => e.MonthlyIncome).HasColumnType("decimal(18,2)");
        });

        mb.Entity<BureauMobileNumber>(e => {
            e.HasKey(m => m.Id);
            e.HasIndex(m => m.BureauReportId);
            e.Property(m => m.PhoneNumber).HasMaxLength(20).IsRequired();
        });

        mb.Entity<BureauEmailAddress>(e => {
            e.HasKey(e => e.Id);
            e.HasIndex(e => e.BureauReportId);
            e.Property(e => e.EmailAddress).HasMaxLength(200).IsRequired();
        });

        mb.Entity<ScoreFactor>(e => {
            e.HasKey(sf => sf.Id);
            e.HasIndex(sf => sf.BureauReportId);
            e.Property(sf => sf.Factor).HasMaxLength(200).IsRequired();
            e.Property(sf => sf.Description).HasMaxLength(500);
        });

        // ── Offer workflow ───────────────────────────────────────────────────
        // Partial unique indexes are the DB backstop for the service rules:
        // one ACTIVE offer per lender per application, one FINAL offer per
        // application, one open deviation request per offer, one ACTIVE
        // sanction per application, one completed disbursement per application.
        // The max-3-active-offers rule and the immutability of revisions /
        // approvals / sanctions / disbursement money columns are enforced by
        // PostgreSQL triggers in migration AddOfferWorkflow.
        var activeOfferFilter = "\"IsDeleted\" = false AND \"Status\" IN ('" +
            string.Join("', '", OfferWorkflowStatuses.ActiveOfferStatuses) + "')";
        mb.Entity<ApplicationOffer>(e => {
            e.HasKey(o => o.Id);
            e.Property(o => o.LenderName).HasMaxLength(200).IsRequired();
            e.Property(o => o.ProductKey).HasMaxLength(100).IsRequired();
            e.Property(o => o.LoanType).HasMaxLength(50).IsRequired();
            e.Property(o => o.Status).HasMaxLength(20).IsRequired();
            e.Property(o => o.DeviationStatus).HasMaxLength(20).IsRequired();
            e.Property(o => o.ApprovalStatus).HasMaxLength(20).IsRequired();
            e.Property(o => o.StatusReason).HasMaxLength(1000);
            e.Property(o => o.Version).IsConcurrencyToken();
            e.HasIndex(o => o.LoanId);
            e.HasIndex(o => new { o.LoanId, o.BankId }, ActiveOfferPerLenderIndex).IsUnique().HasFilter(activeOfferFilter);
            e.HasIndex(o => o.LoanId, FinalOfferIndex).IsUnique()
                .HasFilter($"\"IsDeleted\" = false AND \"Status\" = '{OfferWorkflowStatuses.OfferFinal}'");
            e.HasQueryFilter(o => !o.IsDeleted);
            e.HasOne(o => o.Loan).WithMany().HasForeignKey(o => o.LoanId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(o => o.Bank).WithMany().HasForeignKey(o => o.BankId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<User>().WithMany().HasForeignKey(o => o.CreatedByUserId).OnDelete(DeleteBehavior.Restrict);
            e.ToTable(t => {
                t.HasCheckConstraint("CK_ApplicationOffers_Status", "\"Status\" IN ('" + string.Join("', '", OfferWorkflowStatuses.AllOfferStatuses) + "')");
                t.HasCheckConstraint("CK_ApplicationOffers_DeviationStatus", "\"DeviationStatus\" IN ('" + string.Join("', '", OfferWorkflowStatuses.AllOfferDeviationStatuses) + "')");
                t.HasCheckConstraint("CK_ApplicationOffers_ApprovalStatus", "\"ApprovalStatus\" IN ('" + string.Join("', '", OfferWorkflowStatuses.AllApprovalStatuses) + "')");
                t.HasCheckConstraint("CK_ApplicationOffers_FinalSelection", "\"Status\" <> 'Final' OR (\"SelectedAt\" IS NOT NULL AND \"SelectedRevisionNo\" IS NOT NULL)");
            });
        });

        mb.Entity<ApplicationOfferRevision>(e => {
            e.HasKey(r => r.Id);
            e.HasIndex(r => new { r.OfferId, r.RevisionNo }).IsUnique();
            foreach (var p in new[] { nameof(ApplicationOfferRevision.LoanAmount), nameof(ApplicationOfferRevision.ProcessingFeeAmount),
                                      nameof(ApplicationOfferRevision.GstAmount), nameof(ApplicationOfferRevision.InsuranceAmount),
                                      nameof(ApplicationOfferRevision.BtAmount), nameof(ApplicationOfferRevision.StampDuty),
                                      nameof(ApplicationOfferRevision.FinancedPrincipal), nameof(ApplicationOfferRevision.Emi),
                                      nameof(ApplicationOfferRevision.NetDisbursement) })
                e.Property(p).HasColumnType("decimal(18,2)");
            foreach (var p in new[] { nameof(ApplicationOfferRevision.BaseRoi), nameof(ApplicationOfferRevision.OfferedRoi),
                                      nameof(ApplicationOfferRevision.ProcessingFeePct), nameof(ApplicationOfferRevision.GstPct) })
                e.Property(p).HasColumnType("decimal(5,2)");
            e.Property(r => r.RateType).HasMaxLength(20);
            e.Property(r => r.ChangeReason).HasMaxLength(1000);
            e.Property(r => r.EvaluationOutcome).HasMaxLength(20);
            e.HasOne(r => r.Offer).WithMany(o => o.Revisions).HasForeignKey(r => r.OfferId).OnDelete(DeleteBehavior.Restrict);
            e.ToTable(t => t.HasCheckConstraint("CK_OfferRevisions_Positive",
                "\"LoanAmount\" > 0 AND \"TenureMonths\" > 0 AND \"OfferedRoi\" >= 0 AND \"NetDisbursement\" > 0"));
        });

        mb.Entity<DeviationRule>(e => {
            e.HasKey(r => r.Id);
            e.Property(r => r.RuleKey).HasMaxLength(64).IsRequired();
            e.Property(r => r.Name).HasMaxLength(200).IsRequired();
            e.Property(r => r.ProductKey).HasMaxLength(100);
            e.Property(r => r.LoanType).HasMaxLength(50);
            e.Property(r => r.DeviationType).HasMaxLength(30).IsRequired();
            e.Property(r => r.Metric).HasMaxLength(40).IsRequired();
            e.Property(r => r.LimitValue).HasColumnType("decimal(18,2)");
            e.Property(r => r.MaxApprovableDeviation).HasColumnType("decimal(18,2)");
            e.Property(r => r.ConditionLogic).HasMaxLength(3);
            e.Property(r => r.Notes).HasMaxLength(1000);
            e.HasIndex(r => new { r.RuleKey, r.Version }).IsUnique();
            e.HasIndex(r => new { r.BankId, r.DeviationType });
            e.HasOne(r => r.Bank).WithMany().HasForeignKey(r => r.BankId).OnDelete(DeleteBehavior.Restrict);
            e.ToTable(t => {
                t.HasCheckConstraint("CK_DeviationRules_Dates", "\"EffectiveTo\" IS NULL OR \"EffectiveTo\" >= \"EffectiveFrom\"");
                t.HasCheckConstraint("CK_DeviationRules_Logic", "\"ConditionLogic\" IN ('AND', 'OR')");
            });
        });

        mb.Entity<OfferDeviation>(e => {
            e.HasKey(d => d.Id);
            e.Property(d => d.DeviationType).HasMaxLength(40).IsRequired();
            e.Property(d => d.Source).HasMaxLength(10).IsRequired();
            e.Property(d => d.Status).HasMaxLength(20).IsRequired();
            e.Property(d => d.Reason).HasMaxLength(2000).IsRequired();
            e.Property(d => d.AssignmentState).HasMaxLength(20);
            e.Property(d => d.DecisionComment).HasMaxLength(2000);
            e.Property(d => d.ClosedReason).HasMaxLength(500);
            e.Property(d => d.IdempotencyKey).HasMaxLength(100);
            e.Property(d => d.DecisionIdempotencyKey).HasMaxLength(100);
            e.HasIndex(d => d.LoanId);
            e.HasIndex(d => d.OfferId, OpenDeviationIndex).IsUnique()
                .HasFilter($"\"Status\" = '{OfferWorkflowStatuses.RequestRaised}'");
            e.HasIndex(d => d.IdempotencyKey).IsUnique().HasFilter("\"IdempotencyKey\" IS NOT NULL");
            e.HasIndex(d => d.DecisionIdempotencyKey).IsUnique().HasFilter("\"DecisionIdempotencyKey\" IS NOT NULL");
            e.HasOne<Loan>().WithMany().HasForeignKey(d => d.LoanId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<ApplicationOffer>().WithMany().HasForeignKey(d => d.OfferId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<User>().WithMany().HasForeignKey(d => d.RaisedByUserId).OnDelete(DeleteBehavior.Restrict);
            e.ToTable(t => {
                t.HasCheckConstraint("CK_OfferDeviations_Status", "\"Status\" IN ('" + string.Join("', '", OfferWorkflowStatuses.AllRequestStatuses) + "')");
                t.HasCheckConstraint("CK_OfferDeviations_NoSelfApproval", "\"Status\" <> 'Approved' OR \"DecidedByUserId\" <> \"RaisedByUserId\"");
            });
        });

        mb.Entity<CreditApproval>(e => {
            e.HasKey(a => a.Id);
            e.Property(a => a.LenderName).HasMaxLength(200);
            e.Property(a => a.Decision).HasMaxLength(20).IsRequired();
            e.Property(a => a.Comment).HasMaxLength(2000);
            e.Property(a => a.DeviationStatusAtApproval).HasMaxLength(20);
            e.Property(a => a.IdempotencyKey).HasMaxLength(100);
            e.HasIndex(a => a.LoanId);
            e.HasIndex(a => a.IdempotencyKey).IsUnique().HasFilter("\"IdempotencyKey\" IS NOT NULL");
            e.HasOne<Loan>().WithMany().HasForeignKey(a => a.LoanId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<ApplicationOffer>().WithMany().HasForeignKey(a => a.OfferId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<User>().WithMany().HasForeignKey(a => a.ApproverUserId).OnDelete(DeleteBehavior.Restrict);
            e.ToTable(t => t.HasCheckConstraint("CK_CreditApprovals_Decision", "\"Decision\" IN ('Approved', 'Rejected')"));
        });

        mb.Entity<Sanction>(e => {
            e.HasKey(s => s.Id);
            e.Property(s => s.SanctionNumber).HasMaxLength(60).IsRequired();
            e.Property(s => s.LenderName).HasMaxLength(200);
            foreach (var p in new[] { nameof(Sanction.LoanAmount), nameof(Sanction.Emi), nameof(Sanction.ProcessingFeeAmount),
                                      nameof(Sanction.GstAmount), nameof(Sanction.InsuranceAmount), nameof(Sanction.BtAmount),
                                      nameof(Sanction.StampDuty), nameof(Sanction.FinancedPrincipal), nameof(Sanction.NetDisbursement) })
                e.Property(p).HasColumnType("decimal(18,2)");
            foreach (var p in new[] { nameof(Sanction.Roi), nameof(Sanction.ProcessingFeePct), nameof(Sanction.GstPct) })
                e.Property(p).HasColumnType("decimal(5,2)");
            e.Property(s => s.Status).HasMaxLength(20).IsRequired();
            e.Property(s => s.CancellationType).HasMaxLength(20);
            e.Property(s => s.CancelReason).HasMaxLength(1000);
            e.Property(s => s.IdempotencyKey).HasMaxLength(100);
            e.HasIndex(s => s.SanctionNumber).IsUnique();
            e.HasIndex(s => s.LoanId, ActiveSanctionIndex).IsUnique()
                .HasFilter($"\"Status\" = '{OfferWorkflowStatuses.SanctionActive}'");
            e.HasIndex(s => s.IdempotencyKey).IsUnique().HasFilter("\"IdempotencyKey\" IS NOT NULL");
            e.HasOne<Loan>().WithMany().HasForeignKey(s => s.LoanId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<ApplicationOffer>().WithMany().HasForeignKey(s => s.OfferId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<CreditApproval>().WithMany().HasForeignKey(s => s.CreditApprovalId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Sanction>().WithMany().HasForeignKey(s => s.PreviousSanctionId).OnDelete(DeleteBehavior.Restrict);
            e.ToTable(t => {
                t.HasCheckConstraint("CK_Sanctions_Status", "\"Status\" IN ('" + string.Join("', '", OfferWorkflowStatuses.AllSanctionStatuses) + "')");
                t.HasCheckConstraint("CK_Sanctions_CancelReason", "\"Status\" <> 'Cancelled' OR (\"CancelReason\" IS NOT NULL AND \"CancelledAt\" IS NOT NULL)");
            });
        });

        mb.Entity<Disbursement>(e => {
            e.HasKey(d => d.Id);
            e.Property(d => d.Type).HasMaxLength(20).IsRequired();
            e.Property(d => d.Amount).HasColumnType("decimal(18,2)");
            e.Property(d => d.BankAccountNumber).HasMaxLength(34).IsRequired();
            e.Property(d => d.Ifsc).HasMaxLength(11).IsRequired();
            e.Property(d => d.AccountHolderName).HasMaxLength(200);
            e.Property(d => d.Utr).HasMaxLength(50).IsRequired();
            e.Property(d => d.LenderReference).HasMaxLength(100);
            e.Property(d => d.Mode).HasMaxLength(20).IsRequired();
            e.Property(d => d.Status).HasMaxLength(20).IsRequired();
            e.Property(d => d.Reason).HasMaxLength(1000);
            e.Property(d => d.PreviousLoanStatus).HasMaxLength(20);
            e.Property(d => d.IdempotencyKey).HasMaxLength(100);
            e.HasIndex(d => d.LoanId, CompletedDisbursementIndex).IsUnique()
                .HasFilter($"\"Type\" = '{OfferWorkflowStatuses.TypeDisbursement}' AND \"Status\" = '{OfferWorkflowStatuses.DisbursementCompleted}'");
            e.HasIndex(d => d.IdempotencyKey).IsUnique().HasFilter("\"IdempotencyKey\" IS NOT NULL");
            e.HasOne<Loan>().WithMany().HasForeignKey(d => d.LoanId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Sanction>().WithMany().HasForeignKey(d => d.SanctionId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Disbursement>().WithMany().HasForeignKey(d => d.ReversalOfId).OnDelete(DeleteBehavior.Restrict);
            e.ToTable(t => {
                t.HasCheckConstraint("CK_Disbursements_Type", "\"Type\" IN ('Disbursement', 'Reversal')");
                t.HasCheckConstraint("CK_Disbursements_Status", "\"Status\" IN ('Completed', 'Reversed')");
                t.HasCheckConstraint("CK_Disbursements_Amount", "\"Amount\" > 0");
                t.HasCheckConstraint("CK_Disbursements_ReversalRef", "\"Type\" <> 'Reversal' OR (\"ReversalOfId\" IS NOT NULL AND \"Reason\" IS NOT NULL)");
            });
        });
    }
}

public class UtcDateTimeConverter : ValueConverter<DateTime, DateTime>
{
    public static DateTime AsUtc(DateTime v) =>
        v.Kind == DateTimeKind.Utc ? v
        : v.Kind == DateTimeKind.Local ? v.ToUniversalTime()
        : DateTime.SpecifyKind(v, DateTimeKind.Utc);

    public UtcDateTimeConverter() : base(v => AsUtc(v), v => DateTime.SpecifyKind(v, DateTimeKind.Utc)) { }
}

public class NullableUtcDateTimeConverter : ValueConverter<DateTime?, DateTime?>
{
    public NullableUtcDateTimeConverter() : base(
        v => v.HasValue ? UtcDateTimeConverter.AsUtc(v.Value) : v,
        v => v.HasValue ? DateTime.SpecifyKind(v.Value, DateTimeKind.Utc) : v) { }
}
