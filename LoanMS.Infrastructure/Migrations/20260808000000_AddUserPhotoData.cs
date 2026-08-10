using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Adds Users.PhotoData (text — base64 image data URL). Previously the
    /// profile photo/customization data set on the User Profile page
    /// (LoanMS.API/wwwroot/js/user-profile.js, window.USER_PROFILES) only
    /// ever lived in the browser's localStorage under 'efin_user_profiles'
    /// — invisible to any other device/browser, and permanently lost if
    /// browser data was cleared. Additive only — one new nullable column,
    /// no changes to any existing column.
    ///
    /// IMPORTANT — written as idempotent raw SQL (ADD COLUMN IF NOT EXISTS),
    /// matching 20260806000000_AddUserProfileFields / 20260806010000_
    /// AddLoanWizardStep, so Up() stays safe to run even if this column was
    /// ever added out-of-band directly on the database. text (not
    /// varchar(n)) — base64-encoded images can run to hundreds of KB and
    /// must not be truncated.
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260808000000_AddUserPhotoData")]
    public partial class AddUserPhotoData : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "ALTER TABLE \"Users\" ADD COLUMN IF NOT EXISTS \"PhotoData\" text;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE \"Users\" DROP COLUMN IF EXISTS \"PhotoData\";");
        }
    }
}
