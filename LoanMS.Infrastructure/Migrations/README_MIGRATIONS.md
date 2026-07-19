# EF Core Migration Guide

## ⚡ Quick Start (Development)

The app uses `EnsureCreated()` on first run which automatically creates
all tables from the model — no migration command needed for development.

## 🏭 Production Migration (Required for PostgreSQL)

### Step 1: Install EF tools
```bash
dotnet tool install --global dotnet-ef
dotnet tool update --global dotnet-ef
```

### Step 2: Set environment for PostgreSQL
```bash
# Windows
set Database__Provider=postgresql
set ConnectionStrings__PostgreSQL=Host=localhost;Database=loanms;Username=loanms_user;Password=your_password
set ASPNETCORE_Jwt__Key=your_64char_key_here
set ASPNETCORE_ENVIRONMENT=Development

# Linux/macOS
export Database__Provider=postgresql
export ConnectionStrings__PostgreSQL="Host=localhost;Database=loanms;Username=loanms_user;Password=your_password"
export ASPNETCORE_Jwt__Key=your_64char_key_here
```

### Step 3: Create initial migration
```bash
cd LoanMS.API
dotnet ef migrations add InitialCreate \
  --project ../LoanMS.Infrastructure \
  --startup-project . \
  --output-dir Migrations
```

### Step 4: Apply migration
```bash
dotnet ef database update \
  --project ../LoanMS.Infrastructure \
  --startup-project .
```

### Step 5: Verify
```bash
dotnet ef migrations list \
  --project ../LoanMS.Infrastructure \
  --startup-project .
```

## 🔄 Schema Updates (Future)

```bash
# Create a new migration after model changes
dotnet ef migrations add AddNewFeature \
  --project ../LoanMS.Infrastructure \
  --startup-project LoanMS.API

# Apply
dotnet ef database update --project ../LoanMS.Infrastructure --startup-project LoanMS.API

# Rollback (revert last migration)
dotnet ef database update PreviousMigrationName \
  --project ../LoanMS.Infrastructure \
  --startup-project LoanMS.API
```

## 🗄️ SQLite (Default / Development)

No migration needed — `EnsureCreated()` handles SQLite automatically.
The `loanms.db` file is created in the app's working directory on first run.

## ✅ Both databases are compatible

The same migration works for both SQLite and PostgreSQL.
Switch by changing `Database:Provider` in appsettings.
