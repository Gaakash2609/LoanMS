# Production Database Schema Mismatch - Root Cause & Fix

## 🚨 Root Cause Identified

**The wizard submission fails with HTTP 500 because the production PostgreSQL database schema is missing 3 columns from the Customers table:**

```
Npgsql.PostgresException (0x80004005): 42703: column c.FatherName does not exist
```

The code queries for:
- `FatherName`
- `Gender`
- `ResidenceType`

But these columns don't exist in the production database `loanms` in ap-south-1.

---

## 📊 Environment Details

**Production Environment:**
- **Database**: PostgreSQL on Amazon RDS
- **Endpoint**: `loanms-staging.cp8c8okmwou1.ap-south-1.rds.amazonaws.com:5432`
- **Database Name**: `loanms`
- **Username**: `loanms_admin`
- **Region**: ap-south-1

**ECS Cluster:**
- **Cluster**: `loanms-prod`
- **Service**: `loanms-api`
- **Task Definition**: `loanms-prod` (versions 1-28)

---

## ✅ Quick Fix: Add Missing Columns

### Option 1: Direct SQL Execution (Fastest)

Connect to the production database and run:

```sql
ALTER TABLE "Customers" ADD COLUMN IF NOT EXISTS "Gender" character varying(1);
ALTER TABLE "Customers" ADD COLUMN IF NOT EXISTS "FatherName" character varying(150);
ALTER TABLE "Customers" ADD COLUMN IF NOT EXISTS "ResidenceType" character varying(40);

-- Verify the columns were added
SELECT column_name, data_type FROM information_schema.columns 
WHERE table_name = 'Customers' AND column_name IN ('Gender', 'FatherName', 'ResidenceType') 
ORDER BY column_name;
```

**Access the database using:**
```bash
psql -h loanms-staging.cp8c8okmwou1.ap-south-1.rds.amazonaws.com \
     -U loanms_admin \
     -d loanms \
     -p 5432
# Password: Loan8140
```

### Option 2: Using Entity Framework Migrations

If you want to use EF Core migrations instead (recommended for audit trail):

```bash
cd /Users/pradnyesh/Downloads/LoanMs-MudraHub-17-7

# First, fix the build errors (missing IHttpClientFactory)
# Then run:

dotnet ef database update \
  --project LoanMS.Infrastructure \
  --startup-project LoanMS.API \
  --configuration Release \
  --connection "Host=loanms-staging.cp8c8okmwou1.ap-south-1.rds.amazonaws.com;Port=5432;Database=loanms;Username=loanms_admin;Password=Loan8140;SSL Mode=Require;Trust Server Certificate=true;"
```

### Option 3: Redeploy with Auto-Migration

If `Program.cs` has database migration on startup:

```bash
AWS_PROFILE=loan aws ecs update-service \
  --cluster loanms-prod \
  --service loanms-api \
  --region ap-south-1 \
  --force-new-deployment
```

This will restart the service, which should apply migrations if configured in `Program.cs`.

---

## 🔍 Migration Source

The missing columns come from this migration:

**File**: `LoanMS.Infrastructure/Migrations/20260726010000_AddCustomerKycFields.cs`

```csharp
protected override void Up(MigrationBuilder migrationBuilder)
{
    migrationBuilder.AddColumn<string>(
        name: "Gender",
        table: "Customers",
        type: "character varying(1)",
        maxLength: 1,
        nullable: true);

    migrationBuilder.AddColumn<string>(
        name: "FatherName",
        table: "Customers",
        type: "character varying(150)",
        maxLength: 150,
        nullable: true);

    migrationBuilder.AddColumn<string>(
        name: "ResidenceType",
        table: "Customers",
        type: "character varying(40)",
        maxLength: 40,
        nullable: true);
}
```

---

## 📋 Verification Steps (After Fix)

Once the columns are added, verify the fix by:

1. **Check columns exist**:
   ```sql
   SELECT column_name, data_type FROM information_schema.columns 
   WHERE table_name = 'Customers' 
   ORDER BY column_name;
   ```

2. **Test the wizard API**:
   - Go to https://app.MudraHub.com
   - Try submitting a new loan application
   - Check browser DevTools → Network tab for `/api/wizard/submit`
   - Should return **200** with `success: true`

3. **Check CloudWatch logs**:
   ```bash
   AWS_PROFILE=loan aws logs filter-log-events \
     --log-group-name /ecs/loanms-prod \
     --region ap-south-1 \
     --start-time $(($(date +%s) - 600))000 \
     --query 'events[?contains(message, `Wizard Submit Succeeded`)].message' \
     --output text
   ```

---

## 🚀 Next Steps

**Recommended Action:**  
1. Apply the SQL fix using Option 1 (fastest)
2. Test the wizard submission in the browser
3. Monitor `/ecs/loanms-prod` logs for any errors
4. Confirm no more 500 errors on `/api/wizard/submit`

---

## 📝 Additional Notes

- The schema mismatch likely occurred because a migration was created but not applied to the production database before deployment
- All other API endpoints (`/api/dsa`, `/api/cibil/check`, etc.) will also start working once this is fixed
- The FatherName column is used for KYC (Know Your Customer) data capture in the wizard
- Gender and ResidenceType are additional customer profile fields
