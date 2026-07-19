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
    public DbSet<TrackingEntry>     TrackingEntries     => Set<TrackingEntry>();
    public DbSet<LoanTask>          Tasks               => Set<LoanTask>();
    public DbSet<Ticket>            Tickets             => Set<Ticket>();
    public DbSet<PayoutClaim>       PayoutClaims        => Set<PayoutClaim>();
    public DbSet<Location>          Locations           => Set<Location>();
    public DbSet<Team>              Teams               => Set<Team>();
    public DbSet<TeamMember>        TeamMembers         => Set<TeamMember>();
    public DbSet<DsaPartner>        DsaPartners         => Set<DsaPartner>();
    public DbSet<AppSetting>        AppSettings         => Set<AppSetting>();
    public DbSet<AuditLog>          AuditLogs           => Set<AuditLog>();
    public DbSet<PayoutRule>        PayoutRules         => Set<PayoutRule>();
    public DbSet<LoanReference>     LoanReferences      => Set<LoanReference>();
    public DbSet<PasswordResetToken> PasswordResetTokens => Set<PasswordResetToken>();

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
            e.Property(l => l.LoanNumber).HasMaxLength(20).IsRequired();
            e.Property(l => l.LoanType).HasConversion<string>();
            e.Property(l => l.Status).HasConversion<string>();
            e.Property(l => l.RequestedAmount).HasColumnType("decimal(18,2)").IsRequired();
            e.Property(l => l.ApprovedAmount).HasColumnType("decimal(18,2)");
            e.Property(l => l.InterestRate).HasColumnType("decimal(5,2)").IsRequired();
            e.Property(l => l.MonthlyEmi).HasColumnType("decimal(18,2)");
            e.HasQueryFilter(l => !l.IsDeleted);
            e.HasOne(l => l.Customer).WithMany(c => c.Loans).HasForeignKey(l => l.CustomerId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(l => l.CreatedBy).WithMany(u => u.CreatedLoans).HasForeignKey(l => l.CreatedByUserId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(l => l.AssignedTo).WithMany(u => u.AssignedLoans).HasForeignKey(l => l.AssignedToUserId).IsRequired(false).OnDelete(DeleteBehavior.SetNull);
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

        mb.Entity<PayoutClaim>(e => {
            e.HasKey(p => p.Id);
            e.Property(p => p.ClaimAmount).HasColumnType("decimal(18,2)");
            e.HasQueryFilter(p => !p.IsDeleted);
            e.HasOne(p => p.Loan).WithMany().HasForeignKey(p => p.LoanId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(p => p.ClaimedBy).WithMany().HasForeignKey(p => p.ClaimedByUserId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(p => p.ProcessedBy).WithMany().HasForeignKey(p => p.ProcessedByUserId).IsRequired(false).OnDelete(DeleteBehavior.SetNull);
        });

        mb.Entity<Location>(e => {
            e.HasKey(l => l.Id);
            e.Property(l => l.Name).HasMaxLength(100).IsRequired();
            e.HasQueryFilter(l => !l.IsDeleted);
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
            e.HasQueryFilter(d => !d.IsDeleted);
            e.HasOne(d => d.MappedSalesUser).WithMany().HasForeignKey(d => d.MappedSalesUserId).IsRequired(false).OnDelete(DeleteBehavior.SetNull);
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
