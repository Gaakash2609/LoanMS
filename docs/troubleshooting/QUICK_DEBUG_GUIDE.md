# Quick Start: Pinpoint Exact API Responses

## 1️⃣ Enable Debug Logging (Backend)

**Edit [LoanMS.API/appsettings.Development.json](LoanMS.API/appsettings.Development.json):**

Replace:
```json
{
  "Jwt": { ... },
  "AllowedHosts": "*"
}
```

With:
```json
{
  "Serilog": {
    "MinimumLevel": {
      "Default": "Debug",
      "Override": {
        "Microsoft": "Information",
        "Microsoft.EntityFrameworkCore": "Debug"
      }
    },
    "WriteTo": [
      {
        "Name": "Console",
        "Args": { "outputTemplate": "[{Timestamp:HH:mm:ss} {Level:u3}] {Message:lj}{NewLine}{Exception}" }
      }
    ]
  },
  "Jwt": { ... },
  "AllowedHosts": "*"
}
```

## 2️⃣ Start the API with Logging

```bash
cd /Users/pradnyesh/Downloads/LoanMs-MudraHub-17-7

# Terminal 1: Start API
dotnet run --project LoanMS.API

# Expected first output:
# [10:30:00 INF] Using SQLite: loanms.db
# OR
# [10:30:00 INF] Using PostgreSQL: host=localhost;...
```

## 3️⃣ Start the Frontend

```bash
# Terminal 2: Start frontend
cd frontend
npm run dev

# Frontend should be at http://localhost:5173
```

## 4️⃣ Open Browser DevTools

```
F12 → Network Tab
```

Leave DevTools open during the entire wizard flow.

## 5️⃣ Go Through the Wizard & Click Proceed

In browser:
1. Navigate to `http://localhost:5173`
2. Login
3. Click "New Application"
4. Fill out all steps (mobile, PAN, name, salary, loan amount, references, etc.)
5. Click **Proceed** / **Submit**

**Watch TWO places simultaneously:**

### Place A: Browser Console

```
F12 → Console Tab

You should see logs like:
[API Request] POST /api/wizard/validate {
  mobile: "9876543210",
  pan: "ABCDE1234F",
  amount: 50000,
  ...
}

[API Response] 200 /api/wizard/validate {
  success: true,
  data: { valid: true, emi: 1234.56, ... }
}

[API Request] POST /api/wizard/submit { ... }

[API Response] 200 /api/wizard/submit {
  success: true,
  data: {
    loanId: 42,
    loanNumber: "EFIN20261234567",
    customerId: 15,
    ...
  }
}
```

### Place B: Terminal 1 (API Logs)

```
You should see:
[10:35:10 INF] Wizard Submit Started - UserId: 5, Mobile: 9876543210, Pan: ABCD***, Amount: 50000, LoanType: personal_loan
[10:35:10 DBG] DB Transaction opened. LoanId (if resuming): null
[10:35:10 INF] Customer saved - CustomerId: 15, Changes: 1
[10:35:10 INF] Loan saved - LoanId: 42, LoanNumber: EFIN20261234567, Status: Submitted, Changes: 1
[10:35:10 DBG] Final DB save completed - Changes: 8
[10:35:10 INF] Wizard Submit Succeeded - LoanId: 42, LoanNumber: EFIN20261234567, CustomerId: 15
[10:35:10 INF] health: GET /health responded 200 in 1.23ms
```

---

## 6️⃣ Verification Checklist

### If you see "Success" logs:

✅ **Database write succeeded** — Check the DB to confirm:

```bash
# SQLite (local dev):
sqlite3 loanms.db "SELECT * FROM Loans ORDER BY CreatedAt DESC LIMIT 1;"

# Should show your new loan

# PostgreSQL:
psql -h localhost -U loanms_user -d loanms
> SELECT * FROM "Loans" ORDER BY "CreatedAt" DESC LIMIT 1;
```

### If you see validation errors in the response:

❌ **Request body has invalid data** — Check:
- Mobile: must be exactly 10 digits
- PAN: must match format ABCDE1234F
- Name: must not be empty
- Amount: must be > 0
- Tenure: must be 1–360
- At least one reference required (name + mobile)

### If you see "Draft application not found":

❌ **Trying to resume a draft that doesn't exist or was already submitted** — Check:
- Are you starting a NEW application (loanId should be empty)?
- If resuming, does that draft still exist in the DB?

### If you see HTTP 500 error:

❌ **Server-side exception** — Look at API logs for:
```
[10:35:10 ERR] Wizard submission failed for user 5
[10:35:10 ERR] Error: The INSERT statement conflicted with a FOREIGN KEY constraint
[10:35:10 ERR] Cannot add or update a child row: foreign key constraint fails
```

This usually means:
- `CreatedByUserId` (from JWT) doesn't exist in Users table
- OR `CustomerId` doesn't match any customer

---

## 📋 What to Share (If Still Failing)

Copy & paste:

1. **Browser Console output** (from "Place A" above)
2. **API Terminal output** (from "Place B" above)
3. **Database query result** (last loan created)
4. **Exact error message** from either response or logs

Example:

```
FRONTEND CONSOLE:
[API Request] POST /api/wizard/submit { mobile: "9876543210", pan: "ABCDE1234F", amount: 50000, ... }
[API Response] 200 /api/wizard/submit { success: false, errors: ["Applicant name is required."] }

API SERVER LOGS:
[10:35:10 WRN] Wizard Submit Validation Failed - Errors: Applicant name is required.

DATABASE:
sqlite3 loanms.db "SELECT COUNT(*) FROM Loans;"
0  ← No new loan created
```

---

## 🔧 Troubleshooting

### API doesn't start:

```bash
dotnet build LoanMS.sln
dotnet run --project LoanMS.API
```

If error mentions "connection string", check [LoanMS.API/appsettings.Development.json](LoanMS.API/appsettings.Development.json):
```json
"ConnectionStrings": { "DefaultConnection": "Data Source=loanms.db" }
```

### Frontend won't connect to API:

```bash
# Check if API is running
curl http://localhost:7070/health

# Should return: { "status": "Healthy" }

# If not running, start it in Terminal 1
```

### Database file locked error:

```bash
# Close any other DB connections
# Restart the API
# Clear browser cache (F12 → Application → Cache)
```

---

## 📊 Expected Final State (If Successful)

**Browser shows:**
- ✅ Confirmation screen with "Application EFIN20261234567 submitted successfully"
- ✅ "Your Application ID" displayed

**Database contains:**
```sql
Loans table:
  ID: 42
  LoanNumber: EFIN20261234567
  Status: Submitted
  RequestedAmount: 50000
  CustomerId: 15
  CreatedByUserId: 5

Customers table:
  ID: 15
  FullName: John Doe
  Phone: 9876543210
  PanNumber: ABCDE1234F
  MonthlyIncome: 80000

LoanReferences table:
  LoanId: 42
  RefNumber: 1
  Name: Reference Name
  Mobile: 9999999999

LoanStatusHistory table:
  LoanId: 42
  FromStatus: Draft
  ToStatus: Submitted
  Comment: "Application submitted via EFIN Wizard by..."
```

---

## ✅ All Set!

Now run through the wizard and capture the exact responses. This will pinpoint exactly where the issue is.

