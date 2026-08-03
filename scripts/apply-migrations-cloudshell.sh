#!/bin/bash

# Apply pending EF Core migrations to production PostgreSQL database
# This script uses AWS Secrets Manager to get credentials and psql to execute migrations
# Run this in AWS CloudShell (which has VPC access to RDS)

set -e

echo "🔧 LoanMS Database Migration Runner"
echo "=================================="
echo ""

# Get connection string from AWS Secrets Manager using AWS CLI
echo "📋 Retrieving database credentials from AWS Secrets Manager..."
DB_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id loanms/prod/db \
  --region ap-south-1 \
  --query 'SecretString' \
  --output text)

# Parse connection string components
DB_HOST=$(echo "$DB_SECRET" | grep -o 'Host=[^;]*' | cut -d= -f2)
DB_PORT=$(echo "$DB_SECRET" | grep -o 'Port=[^;]*' | cut -d= -f2 || echo "5432")
DB_NAME=$(echo "$DB_SECRET" | grep -o 'Database=[^;]*' | cut -d= -f2)
DB_USER=$(echo "$DB_SECRET" | grep -o 'Username=[^;]*' | cut -d= -f2)
DB_PASS=$(echo "$DB_SECRET" | grep -o 'Password=[^;]*' | cut -d= -f2)

echo "✓ Database: $DB_NAME"
echo "✓ Host: $DB_HOST"
echo "✓ User: $DB_USER"
echo ""

# Export for psql
export PGPASSWORD="$DB_PASS"

# Count pending migrations before applying
echo "📊 Checking current migration status..."
CURRENT_COUNT=$(psql \
  --host "$DB_HOST" \
  --port "$DB_PORT" \
  --username "$DB_USER" \
  --dbname "$DB_NAME" \
  --tuples-only \
  --command "SELECT COUNT(*) FROM \"__EFMigrationsHistory\";" \
  --set sslmode=require 2>/dev/null || echo "0")

echo "✓ Current migrations applied: $CURRENT_COUNT"
echo ""

# Show pending migrations
echo "📑 Migrations to be applied:"
PENDING=$(psql \
  --host "$DB_HOST" \
  --port "$DB_PORT" \
  --username "$DB_USER" \
  --dbname "$DB_NAME" \
  --command "
    WITH all_migrations AS (
      SELECT '20250101000000_InitialCreate' as id UNION
      SELECT '20260726000000_AddIncredIntegration' UNION
      SELECT '20260726010000_AddCustomerKycFields' UNION
      SELECT '20260728000000_AddDsaPartnerPhase1' UNION
      SELECT '20260729000000_AddIncredApplicationIdIndex' UNION
      SELECT '20260730000000_AddCustomerMonthlyObligations' UNION
      SELECT '20260730000000_AddDsaPartnerPhase2' UNION
      SELECT '20260730060000_AddPayoutClaimTypeAndIdempotency' UNION
      SELECT '20260730120000_AddTicketComments' UNION
      SELECT '20260730130000_AddBankMasterPersistence' UNION
      SELECT '20260730140000_AddAssignmentLog'
    )
    SELECT m.id FROM all_migrations m
    WHERE m.id NOT IN (SELECT \"MigrationId\" FROM \"__EFMigrationsHistory\")
    ORDER BY m.id;
  " \
  --set sslmode=require)

if [ -z "$PENDING" ]; then
  echo "✓ No pending migrations"
else
  echo "$PENDING"
fi

echo ""
echo "🚀 Applying migrations..."
echo ""

# Apply migrations from the SQL script
if [ -f "migrations-pending.sql" ]; then
  psql \
    --host "$DB_HOST" \
    --port "$DB_PORT" \
    --username "$DB_USER" \
    --dbname "$DB_NAME" \
    --file migrations-pending.sql \
    --set sslmode=require
  
  echo ""
  echo "✅ Migrations applied successfully!"
else
  echo "❌ migrations-pending.sql not found"
  exit 1
fi

echo ""
echo "✓ Final migration count:"
psql \
  --host "$DB_HOST" \
  --port "$DB_PORT" \
  --username "$DB_USER" \
  --dbname "$DB_NAME" \
  --tuples-only \
  --command "SELECT COUNT(*) FROM \"__EFMigrationsHistory\";" \
  --set sslmode=require

echo ""
echo "✓ Latest 5 migrations:"
psql \
  --host "$DB_HOST" \
  --port "$DB_PORT" \
  --username "$DB_USER" \
  --dbname "$DB_NAME" \
  --command "SELECT \"MigrationId\" FROM \"__EFMigrationsHistory\" ORDER BY \"MigrationId\" DESC LIMIT 5;" \
  --set sslmode=require

echo ""
echo "✅ Database migration complete!"
