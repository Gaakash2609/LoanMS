using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.Infrastructure.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<User>              Users               => Set<User>();
    public DbSet<Customer>          Customers           => Set<Customer>();
    public DbSet<Loan>              Loans               => Set<Loan>();
    public DbSet<LoanDocument>      LoanDocuments       => Set<LoanDocument>();
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
    public DbSet<DsaPartner>        DsaPartners         => Set<DsaPartner>();
    public DbSet<DsaDocument>       DsaDocuments        => Set<DsaDocument>();
    public DbSet<AppSetting>        AppSettings         => Set<AppSetting>();
    public DbSet<AuditLog>          AuditLogs           => Set<AuditLog>();
    public DbSet<AssignmentLog>     AssignmentLogs      => Set<AssignmentLog>();
    public DbSet<PayoutRule>        PayoutRules         => Set<PayoutRule>();
    public DbSet<LoanReference>     LoanReferences      => Set<LoanReference>();
    public DbSet<PasswordResetToken> PasswordResetTokens => Set<PasswordResetToken>();
    public DbSet<BankMaster>        Banks               => Set<BankMaster>();

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
            e.Property(u => u.FullName).HasMaxLength(150).IsRequired();
            e.Property(u => u.Email).HasMaxLength(200).IsRequired();
            e.Property(u => u.PasswordHash).IsRequired();
            e.Property(u => u.Role).HasConversion<string>();
            e.HasQueryFilter(u => !u.IsDeleted);
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
            e.Property(l => l.LoanNumber).HasMaxLength(20).IsRequired();
            e.Property(l => l.LoanType).HasConversion<string>();
            e.Property(l => l.Status).HasConversion<string>();
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
            e.HasQueryFilter(l => !l.IsDeleted);
            e.HasOne(l => l.Customer).WithMany(c => c.Loans).HasForeignKey(l => l.CustomerId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(l => l.CreatedBy).WithMany(u => u.CreatedLoans).HasForeignKey(l => l.CreatedByUserId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(l => l.AssignedTo).WithMany(u => u.AssignedLoans).HasForeignKey(l => l.AssignedToUserId).IsRequired(false).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(l => l.Dsa).WithMany().HasForeignKey(l => l.DsaId).IsRequired(false).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(l => l.Partner).WithMany().HasForeignKey(l => l.PartnerId).IsRequired(false).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(l => l.Location).WithMany().HasForeignKey(l => l.LocationId).IsRequired(false).OnDelete(DeleteBehavior.SetNull);
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
            e.HasQueryFilter(h => !h.IsDeleted);
            e.HasOne(h => h.Loan).WithMany(l => l.StatusHistory).HasForeignKey(h => h.LoanId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(h => h.ChangedBy).WithMany().HasForeignKey(h => h.ChangedByUserId).OnDelete(DeleteBehavior.Restrict);
        });

        mb.Entity<LoanDocument>(e => {
            e.HasKey(d => d.Id);
            e.HasQueryFilter(d => !d.IsDeleted);
            e.HasOne(d => d.Loan).WithMany(l => l.Documents).HasForeignKey(d => d.LoanId).OnDelete(DeleteBehavior.Cascade);
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
        });

        mb.Entity<Team>(e => {
            e.HasKey(t => t.Id);
            e.Property(t => t.Name).HasMaxLength(100).IsRequired();
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
            e.HasIndex(s => s.Key).IsUnique();
            e.Property(s => s.Key).HasMaxLength(100).IsRequired();
            e.HasQueryFilter(s => !s.IsDeleted);
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
            e.HasOne(r => r.Loan).WithMany().HasForeignKey(r => r.LoanId).OnDelete(DeleteBehavior.Cascade);
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
    }
}
