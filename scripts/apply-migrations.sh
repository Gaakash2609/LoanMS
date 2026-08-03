#!/bin/bash

# Apply pending migrations to production PostgreSQL database via AWS Secrets Manager credentials

set -e

# Get connection string from AWS Secrets Manager
DB_SECRET=$(aws secretsmanager get-secret-value \
  --profile loan \
  --secret-id loanms/prod/db \
  --region ap-south-1 \
  --query 'SecretString' \
  --output text)

# Parse connection string
DB_HOST=$(echo "$DB_SECRET" | grep -o 'Host=[^;]*' | cut -d= -f2)
DB_PORT=$(echo "$DB_SECRET" | grep -o 'Port=[^;]*' | cut -d= -f2)
DB_NAME=$(echo "$DB_SECRET" | grep -o 'Database=[^;]*' | cut -d= -f2)
DB_USER=$(echo "$DB_SECRET" | grep -o 'Username=[^;]*' | cut -d= -f2)
DB_PASS=$(echo "$DB_SECRET" | grep -o 'Password=[^;]*' | cut -d= -f2)

echo "✓ Connecting to: $DB_HOST:$DB_PORT/$DB_NAME"
echo "✓ User: $DB_USER"

# Export for psql
export PGPASSWORD="$DB_PASS"

# Run migrations
echo ""
echo "Applying migrations..."
psql \
  --host "$DB_HOST" \
  --port "$DB_PORT" \
  --username "$DB_USER" \
  --dbname "$DB_NAME" \
  --file migrations-pending.sql \
  --set sslmode=require

echo ""
echo "✓ Migrations applied successfully!"
echo ""
echo "Verifying migration history..."
psql \
  --host "$DB_HOST" \
  --port "$DB_PORT" \
  --username "$DB_USER" \
  --dbname "$DB_NAME" \
  --command "SELECT \"MigrationId\", \"ProductVersion\" FROM \"__EFMigrationsHistory\" ORDER BY \"MigrationId\" DESC LIMIT 5;" \
  --set sslmode=require
