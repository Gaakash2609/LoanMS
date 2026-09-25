using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddBureauUploadOfferValidityTaskPause : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "PauseReason",
                table: "Tasks",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "PausedAt",
                table: "Tasks",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "UploadedByUserId",
                table: "BureauReports",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "OfferValidityDays",
                table: "Banks",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "LatestEvaluatedAt",
                table: "ApplicationOffers",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LatestEvaluationJson",
                table: "ApplicationOffers",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PauseReason",
                table: "Tasks");

            migrationBuilder.DropColumn(
                name: "PausedAt",
                table: "Tasks");

            migrationBuilder.DropColumn(
                name: "UploadedByUserId",
                table: "BureauReports");

            migrationBuilder.DropColumn(
                name: "OfferValidityDays",
                table: "Banks");

            migrationBuilder.DropColumn(
                name: "LatestEvaluatedAt",
                table: "ApplicationOffers");

            migrationBuilder.DropColumn(
                name: "LatestEvaluationJson",
                table: "ApplicationOffers");
        }
    }
}
