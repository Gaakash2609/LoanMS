using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AuditLogs",
                columns: table => new
                {
                    Id         = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    EntityName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Action     = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    EntityId   = table.Column<string>(type: "text", nullable: true),
                    OldValues  = table.Column<string>(type: "text", nullable: true),
                    NewValues  = table.Column<string>(type: "text", nullable: true),
                    UserId     = table.Column<int>(type: "integer", nullable: true),
                    UserName   = table.Column<string>(type: "text", nullable: true),
                    IpAddress  = table.Column<string>(type: "text", nullable: true),
                    CreatedAt  = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table => table.PrimaryKey("PK_AuditLogs", x => x.Id));

            migrationBuilder.CreateTable(
                name: "Locations",
                columns: table => new
                {
                    Id        = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name      = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    City      = table.Column<string>(type: "text", nullable: false),
                    State     = table.Column<string>(type: "text", nullable: false),
                    PinCode   = table.Column<string>(type: "text", nullable: true),
                    IsActive  = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table => table.PrimaryKey("PK_Locations", x => x.Id));

            migrationBuilder.CreateTable(
                name: "Users",
                columns: table => new
                {
                    Id                  = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    FullName            = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    Email               = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    PasswordHash        = table.Column<string>(type: "text", nullable: false),
                    Role                = table.Column<string>(type: "text", nullable: false),
                    IsActive            = table.Column<bool>(type: "boolean", nullable: false),
                    RefreshToken        = table.Column<string>(type: "text", nullable: true),
                    RefreshTokenExpiry  = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    MustChangePassword  = table.Column<bool>(type: "boolean", nullable: false),
                    FailedLoginAttempts = table.Column<int>(type: "integer", nullable: false),
                    LockedUntil         = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt           = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt           = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted           = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table => table.PrimaryKey("PK_Users", x => x.Id));

            migrationBuilder.CreateTable(
                name: "Customers",
                columns: table => new
                {
                    Id             = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    FullName       = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    Email          = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Phone          = table.Column<string>(type: "character varying(15)", maxLength: 15, nullable: false),
                    PanNumber      = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: true),
                    AadhaarNumber  = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: true),
                    DateOfBirth    = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Address        = table.Column<string>(type: "text", nullable: true),
                    City           = table.Column<string>(type: "text", nullable: true),
                    State          = table.Column<string>(type: "text", nullable: true),
                    PinCode        = table.Column<string>(type: "text", nullable: true),
                    MonthlyIncome  = table.Column<decimal>(type: "decimal(18,2)", nullable: true),
                    EmploymentType = table.Column<string>(type: "text", nullable: true),
                    CompanyName    = table.Column<string>(type: "text", nullable: true),
                    CibilScore     = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt      = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt      = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted      = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table => table.PrimaryKey("PK_Customers", x => x.Id));

            migrationBuilder.CreateTable(
                name: "AppSettings",
                columns: table => new
                {
                    Id        = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Key       = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Value     = table.Column<string>(type: "text", nullable: false),
                    Category  = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table => table.PrimaryKey("PK_AppSettings", x => x.Id));

            migrationBuilder.CreateTable(
                name: "PayoutRules",
                columns: table => new
                {
                    Id         = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    LoanType   = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Percentage = table.Column<decimal>(type: "decimal(5,2)", nullable: false),
                    MinPayout  = table.Column<decimal>(type: "decimal(18,2)", nullable: true),
                    MaxPayout  = table.Column<decimal>(type: "decimal(18,2)", nullable: true),
                    IsActive   = table.Column<bool>(type: "boolean", nullable: false),
                    Notes      = table.Column<string>(type: "text", nullable: true),
                    CreatedAt  = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt  = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted  = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table => table.PrimaryKey("PK_PayoutRules", x => x.Id));

            migrationBuilder.CreateTable(
                name: "DsaPartners",
                columns: table => new
                {
                    Id                = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name              = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    Code              = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Email             = table.Column<string>(type: "text", nullable: true),
                    Phone             = table.Column<string>(type: "text", nullable: true),
                    City              = table.Column<string>(type: "text", nullable: true),
                    IsActive          = table.Column<bool>(type: "boolean", nullable: false),
                    MappedSalesUserId = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt         = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt         = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted         = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DsaPartners", x => x.Id);
                    table.ForeignKey("FK_DsaPartners_Users_MappedSalesUserId", x => x.MappedSalesUserId, "Users", "Id", onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "PasswordResetTokens",
                columns: table => new
                {
                    Id        = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TokenHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    UserId    = table.Column<int>(type: "integer", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    IsUsed    = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PasswordResetTokens", x => x.Id);
                    table.ForeignKey("FK_PasswordResetTokens_Users_UserId", x => x.UserId, "Users", "Id", onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Teams",
                columns: table => new
                {
                    Id             = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name           = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Type           = table.Column<string>(type: "text", nullable: false),
                    LocationId     = table.Column<int>(type: "integer", nullable: true),
                    TeamLeadUserId = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt      = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt      = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted      = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Teams", x => x.Id);
                    table.ForeignKey("FK_Teams_Locations_LocationId", x => x.LocationId, "Locations", "Id", onDelete: ReferentialAction.SetNull);
                    table.ForeignKey("FK_Teams_Users_TeamLeadUserId", x => x.TeamLeadUserId, "Users", "Id", onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "Loans",
                columns: table => new
                {
                    Id               = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    LoanNumber       = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    LoanType         = table.Column<string>(type: "text", nullable: false),
                    Status           = table.Column<string>(type: "text", nullable: false),
                    RequestedAmount  = table.Column<decimal>(type: "decimal(18,2)", nullable: false),
                    ApprovedAmount   = table.Column<decimal>(type: "decimal(18,2)", nullable: true),
                    InterestRate     = table.Column<decimal>(type: "decimal(5,2)", nullable: false),
                    TenureMonths     = table.Column<int>(type: "integer", nullable: false),
                    MonthlyEmi       = table.Column<decimal>(type: "decimal(18,2)", nullable: true),
                    Purpose          = table.Column<string>(type: "text", nullable: true),
                    Remarks          = table.Column<string>(type: "text", nullable: true),
                    ApprovedAt       = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DisbursedAt      = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ClosedAt         = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CustomerId       = table.Column<int>(type: "integer", nullable: false),
                    CreatedByUserId  = table.Column<int>(type: "integer", nullable: false),
                    AssignedToUserId = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt        = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt        = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted        = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Loans", x => x.Id);
                    table.ForeignKey("FK_Loans_Customers_CustomerId", x => x.CustomerId, "Customers", "Id", onDelete: ReferentialAction.Restrict);
                    table.ForeignKey("FK_Loans_Users_CreatedByUserId", x => x.CreatedByUserId, "Users", "Id", onDelete: ReferentialAction.Restrict);
                    table.ForeignKey("FK_Loans_Users_AssignedToUserId", x => x.AssignedToUserId, "Users", "Id", onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "LoanDocuments",
                columns: table => new
                {
                    Id              = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    LoanId          = table.Column<int>(type: "integer", nullable: false),
                    DocumentName    = table.Column<string>(type: "text", nullable: false),
                    DocumentType    = table.Column<string>(type: "text", nullable: false),
                    FilePath        = table.Column<string>(type: "text", nullable: false),
                    FileSizeBytes   = table.Column<long>(type: "bigint", nullable: false),
                    UploadedByUserId= table.Column<string>(type: "text", nullable: false),
                    CreatedAt       = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt       = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted       = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LoanDocuments", x => x.Id);
                    table.ForeignKey("FK_LoanDocuments_Loans_LoanId", x => x.LoanId, "Loans", "Id", onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "LoanStatusHistories",
                columns: table => new
                {
                    Id              = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    LoanId          = table.Column<int>(type: "integer", nullable: false),
                    FromStatus      = table.Column<string>(type: "text", nullable: false),
                    ToStatus        = table.Column<string>(type: "text", nullable: false),
                    Comment         = table.Column<string>(type: "text", nullable: true),
                    ChangedByUserId = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt       = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt       = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted       = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LoanStatusHistories", x => x.Id);
                    table.ForeignKey("FK_LoanStatusHistories_Loans_LoanId", x => x.LoanId, "Loans", "Id", onDelete: ReferentialAction.Cascade);
                    table.ForeignKey("FK_LoanStatusHistories_Users_ChangedByUserId", x => x.ChangedByUserId, "Users", "Id", onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "TrackingEntries",
                columns: table => new
                {
                    Id              = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    LoanId          = table.Column<int>(type: "integer", nullable: false),
                    Name            = table.Column<string>(type: "text", nullable: false),
                    Stage           = table.Column<string>(type: "text", nullable: false),
                    AssignedUser    = table.Column<string>(type: "text", nullable: false),
                    Status          = table.Column<string>(type: "text", nullable: false),
                    Comment         = table.Column<string>(type: "text", nullable: true),
                    SubNote         = table.Column<string>(type: "text", nullable: true),
                    CreatedByUserId = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt       = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt       = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted       = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TrackingEntries", x => x.Id);
                    table.ForeignKey("FK_TrackingEntries_Loans_LoanId", x => x.LoanId, "Loans", "Id", onDelete: ReferentialAction.Cascade);
                    table.ForeignKey("FK_TrackingEntries_Users_CreatedByUserId", x => x.CreatedByUserId, "Users", "Id", onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Tasks",
                columns: table => new
                {
                    Id                = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    LoanId            = table.Column<int>(type: "integer", nullable: true),
                    Title             = table.Column<string>(type: "text", nullable: false),
                    Description       = table.Column<string>(type: "text", nullable: true),
                    Priority          = table.Column<string>(type: "text", nullable: false),
                    IsCompleted       = table.Column<bool>(type: "boolean", nullable: false),
                    DueDate           = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    AssignedToUserId  = table.Column<int>(type: "integer", nullable: false),
                    CreatedByUserId   = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt         = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt         = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted         = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Tasks", x => x.Id);
                    table.ForeignKey("FK_Tasks_Loans_LoanId", x => x.LoanId, "Loans", "Id", onDelete: ReferentialAction.Cascade);
                    table.ForeignKey("FK_Tasks_Users_AssignedToUserId", x => x.AssignedToUserId, "Users", "Id", onDelete: ReferentialAction.Restrict);
                    table.ForeignKey("FK_Tasks_Users_CreatedByUserId", x => x.CreatedByUserId, "Users", "Id", onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Tickets",
                columns: table => new
                {
                    Id                = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Title             = table.Column<string>(type: "text", nullable: false),
                    Description       = table.Column<string>(type: "text", nullable: false),
                    Status            = table.Column<string>(type: "text", nullable: false),
                    Priority          = table.Column<string>(type: "text", nullable: false),
                    LoanId            = table.Column<int>(type: "integer", nullable: true),
                    CreatedByUserId   = table.Column<int>(type: "integer", nullable: false),
                    AssignedToUserId  = table.Column<int>(type: "integer", nullable: true),
                    ClosedAt          = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt         = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt         = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted         = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Tickets", x => x.Id);
                    table.ForeignKey("FK_Tickets_Loans_LoanId", x => x.LoanId, "Loans", "Id", onDelete: ReferentialAction.Cascade);
                    table.ForeignKey("FK_Tickets_Users_CreatedByUserId", x => x.CreatedByUserId, "Users", "Id", onDelete: ReferentialAction.Restrict);
                    table.ForeignKey("FK_Tickets_Users_AssignedToUserId", x => x.AssignedToUserId, "Users", "Id", onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "PayoutClaims",
                columns: table => new
                {
                    Id                = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    LoanId            = table.Column<int>(type: "integer", nullable: false),
                    ClaimedByUserId   = table.Column<int>(type: "integer", nullable: false),
                    ClaimAmount       = table.Column<decimal>(type: "decimal(18,2)", nullable: false),
                    Status            = table.Column<string>(type: "text", nullable: false),
                    Month             = table.Column<string>(type: "text", nullable: true),
                    Notes             = table.Column<string>(type: "text", nullable: true),
                    VerifiedAt        = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    PaidAt            = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ProcessedByUserId = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt         = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt         = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted         = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PayoutClaims", x => x.Id);
                    table.ForeignKey("FK_PayoutClaims_Loans_LoanId", x => x.LoanId, "Loans", "Id", onDelete: ReferentialAction.Restrict);
                    table.ForeignKey("FK_PayoutClaims_Users_ClaimedByUserId", x => x.ClaimedByUserId, "Users", "Id", onDelete: ReferentialAction.Restrict);
                    table.ForeignKey("FK_PayoutClaims_Users_ProcessedByUserId", x => x.ProcessedByUserId, "Users", "Id", onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "LoanReferences",
                columns: table => new
                {
                    Id        = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    LoanId    = table.Column<int>(type: "integer", nullable: false),
                    Name      = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    Mobile    = table.Column<string>(type: "character varying(15)", maxLength: 15, nullable: false),
                    Relation  = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    RefNumber = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LoanReferences", x => x.Id);
                    table.ForeignKey("FK_LoanReferences_Loans_LoanId", x => x.LoanId, "Loans", "Id", onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TeamMembers",
                columns: table => new
                {
                    Id        = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TeamId    = table.Column<int>(type: "integer", nullable: false),
                    UserId    = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TeamMembers", x => x.Id);
                    table.ForeignKey("FK_TeamMembers_Teams_TeamId", x => x.TeamId, "Teams", "Id", onDelete: ReferentialAction.Cascade);
                    table.ForeignKey("FK_TeamMembers_Users_UserId", x => x.UserId, "Users", "Id", onDelete: ReferentialAction.Restrict);
                });

            // ── Indexes ────────────────────────────────────────────────────────
            migrationBuilder.CreateIndex("IX_AuditLogs_CreatedAt",   "AuditLogs",   "CreatedAt");
            migrationBuilder.CreateIndex("IX_AuditLogs_EntityName",  "AuditLogs",   "EntityName");
            migrationBuilder.CreateIndex("IX_AuditLogs_UserId",      "AuditLogs",   "UserId");
            migrationBuilder.CreateIndex("IX_Users_Email",           "Users",       "Email", unique: true);
            migrationBuilder.CreateIndex("IX_Customers_Email",       "Customers",   "Email", unique: true);
            migrationBuilder.CreateIndex("IX_Customers_PanNumber",   "Customers",   "PanNumber", unique: true);
            migrationBuilder.CreateIndex("IX_Loans_LoanNumber",      "Loans",       "LoanNumber", unique: true);
            migrationBuilder.CreateIndex("IX_Loans_Status",          "Loans",       "Status");
            migrationBuilder.CreateIndex("IX_Loans_CreatedAt",       "Loans",       "CreatedAt");
            migrationBuilder.CreateIndex("IX_Loans_CustomerId",      "Loans",       "CustomerId");
            migrationBuilder.CreateIndex("IX_Loans_CreatedByUserId", "Loans",       "CreatedByUserId");
            migrationBuilder.CreateIndex("IX_Loans_Status_CreatedAt","Loans",       new[] { "Status", "CreatedAt" });
            migrationBuilder.CreateIndex("IX_PayoutRules_LoanType",  "PayoutRules", "LoanType");
            migrationBuilder.CreateIndex("IX_AppSettings_Key",       "AppSettings", "Key", unique: true);
            migrationBuilder.CreateIndex("IX_PasswordResetTokens_TokenHash",        "PasswordResetTokens", "TokenHash", unique: true);
            migrationBuilder.CreateIndex("IX_PasswordResetTokens_UserId_IsUsed",    "PasswordResetTokens", new[] { "UserId", "IsUsed" });
            migrationBuilder.CreateIndex("IX_TrackingEntries_LoanId",               "TrackingEntries", "LoanId");
            migrationBuilder.CreateIndex("IX_TrackingEntries_LoanId_CreatedAt",     "TrackingEntries", new[] { "LoanId", "CreatedAt" });
            migrationBuilder.CreateIndex("IX_LoanReferences_LoanId",               "LoanReferences", "LoanId");
            migrationBuilder.CreateIndex("IX_DsaPartners_MappedSalesUserId",        "DsaPartners", "MappedSalesUserId");
            migrationBuilder.CreateIndex("IX_Teams_LocationId",                     "Teams", "LocationId");
            migrationBuilder.CreateIndex("IX_Teams_TeamLeadUserId",                 "Teams", "TeamLeadUserId");
            migrationBuilder.CreateIndex("IX_TeamMembers_TeamId",                   "TeamMembers", "TeamId");
            migrationBuilder.CreateIndex("IX_TeamMembers_UserId",                   "TeamMembers", "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable("TeamMembers");
            migrationBuilder.DropTable("LoanReferences");
            migrationBuilder.DropTable("PayoutClaims");
            migrationBuilder.DropTable("Tickets");
            migrationBuilder.DropTable("Tasks");
            migrationBuilder.DropTable("TrackingEntries");
            migrationBuilder.DropTable("LoanStatusHistories");
            migrationBuilder.DropTable("LoanDocuments");
            migrationBuilder.DropTable("Loans");
            migrationBuilder.DropTable("Teams");
            migrationBuilder.DropTable("PasswordResetTokens");
            migrationBuilder.DropTable("DsaPartners");
            migrationBuilder.DropTable("PayoutRules");
            migrationBuilder.DropTable("AppSettings");
            migrationBuilder.DropTable("Customers");
            migrationBuilder.DropTable("Users");
            migrationBuilder.DropTable("Locations");
            migrationBuilder.DropTable("AuditLogs");
        }
    }
}
