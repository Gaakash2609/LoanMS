# API Response Debugging Checklist

## Frontend: Browser Network Tab

When you click "Proceed" on the wizard, these requests should fire in order:

### 1. **POST /api/wizard/validate**
- **Expected**: Checks for duplicate applications & field validation
- **Success Response** (200):
  ```json
  {
    "success": true,
    "data": {
      "valid": true,
      "emi": 5000.00,
      "totalPayable": 120000.00,
      "totalInterest": 20000.00
    }
  }
  ```
- **Error Response** (200 with success=false):
  ```json
  {
    "success": false,
    "errors": ["Mobile number must be exactly 10 digits.", "..."]
  }
  ```

### 2. **POST /api/wizard/submit** (only if validate succeeds)
- **Expected**: Creates/updates Loan + Customer + References
- **Success Response** (200):
  ```json
  {
    "success": true,
    "data": {
      "eFinId": "EFIN20261234567",
      "loanId": 42,
      "customerId": 15,
      "loanNumber": "EFIN20261234567",
      "monthlyEmi": 5000.00,
      "status": "Submitted"
    }
  }
  ```
- **Error Response** (400 or 200 with success=false):
  ```json
  {
    "success": false,
    "errors": ["Draft application not found.", "This application has already been submitted.", "..."]
  }
  ```

### 3. **POST /api/loans/{loanId}/documents** (optional, after submit)
- Uploads salary slip & bank statement if provided

---

## Server-Side: Application Logs

### Enable Detailed Logging

**Edit [LoanMS.API/appsettings.Development.json](LoanMS.API/appsettings.Development.json):**

```json
{
  "Serilog": {
    "MinimumLevel": {
      "Default": "Debug",
      "Override": {
        "Microsoft": "Information",
        "Microsoft.EntityFrameworkCore": "Debug"
      }
    }
  }
}
```

Then restart the API:
```bash
dotnet run --project LoanMS.API
```

### Watch for These Log Lines

**When validation fails:**
```
[10:30:45 WRN] Validation failed: Mobile number must be exactly 10 digits.
[10:30:45 INF] POST /api/wizard/validate returned 200 with success=false
```

**When DB save fails:**
```
[10:30:47 ERR] Wizard submit failed: DbUpdateException - ...
[10:30:47 ERR] Error: The INSERT statement conflicted with a FOREIGN KEY constraint.
```

**When DB save succeeds:**
```
[10:30:47 INF] SaveChangesAsync completed. Rows affected: 4
[10:30:47 INF] Loan created: LoanId=42, LoanNumber=EFIN20261234567
[10:30:47 INF] Customer found/created: CustomerId=15
[10:30:47 INF] Wizard submit succeeded. LoanId=42
```

**If connection string is missing:**
```
[10:30:00 ERR] Database connection failed: No connection string named 'DefaultConnection' found.
```

---

## Step-by-Step Debug Process

### **Step 1: Verify Database Connection**

```bash
# Terminal 1: Start the API with detailed logging
dotnet run --project LoanMS.API

# You should see:
# 1. Database provider selection:
#    "Using SQLite: loanms.db" 
#    OR
#    "Using PostgreSQL: host=..."

# 2. Health check success:
#    "Health check for database passed"
```

### **Step 2: Capture Frontend Request Payload**

Open **Browser DevTools → Network Tab**, then click "Proceed":

1. Find `POST /api/wizard/validate` request
2. Click it → **Request** tab
3. Scroll to **Request Body** — verify:
   - ✅ `mobile`: "98765XXXXX" (10 digits)
   - ✅ `pan`: "ABCDE1234F" (uppercase, correct format)
   - ✅ `fullName`: filled in
   - ✅ `amount`: > 0
   - ✅ `tenure`: 1–360
   - ✅ `loanRate`: > 0

### **Step 3: Check Validation Response**

Same request → **Response** tab:
- **If success:**
  ```json
  { "success": true, "data": { "valid": true, ... } }
  ```
- **If failure:**
  ```json
  { "success": false, "errors": [ "..." ] }
  ```
  → Read error messages; fix the field

### **Step 4: Check Submit Response**

Find `POST /api/wizard/submit` request → **Response** tab:
- **If success:**
  ```json
  { "success": true, "data": { "loanId": 42, ... } }
  ```
  → Loan was saved ✅

- **If failure:**
  ```json
  { "success": false, "errors": [ "..." ] }
  ```
  → See what error; check server logs for cause

### **Step 5: Verify Database Write**

```bash
# Check SQLite (if using local dev)
sqlite3 loanms.db
> SELECT COUNT(*) FROM Loans;
> SELECT * FROM Loans ORDER BY CreatedAt DESC LIMIT 1;

# OR check PostgreSQL (if configured)
psql -h localhost -U loanms_user -d loanms
> SELECT COUNT(*) FROM "Loans";
> SELECT * FROM "Loans" ORDER BY "CreatedAt" DESC LIMIT 1;
```

If you see a new row → **DB write succeeded** ✅

---

## Common Failure Scenarios

### Scenario A: Validation Error in Response

**Response:**
```json
{
  "success": false,
  "errors": ["Mobile number must be exactly 10 digits."]
}
```

**Fix:** 
- Review the error message
- Check the data entered in that wizard step
- Resubmit with corrected data

---

### Scenario B: Submit Returns Error

**Response:**
```json
{
  "success": false,
  "errors": ["Draft application not found."]
}
```

**Root Cause:** 
- `loanId` was sent but no Draft with that ID exists, OR
- Draft was already submitted (Status != Draft)

**Fix:**
- Start a new application (don't pass `loanId`)
- Or check if draft was already submitted

---

### Scenario C: HTTP 500 Error

**Response:**
```
Internal Server Error
```

**Server Log:**
```
[10:30:47 ERR] Wizard submit failed for user 5
[10:30:47 ERR] Error: The INSERT statement conflicted with a FOREIGN KEY constraint.
[10:30:47 ERR] Cannot add or update a child row: a foreign key constraint fails
```

**Root Cause:** 
- `CreatedByUserId` from JWT doesn't exist in Users table
- OR `CustomerId` doesn't match any Customer

**Fix:**
- Verify user is logged in (`CurrentUserId` > 0)
- Verify customer exists if resuming a draft

---

### Scenario D: No Response (Timeout)

**Browser DevTools:**
- Request shows "Pending..." then "Failed"
- No response body

**Cause:**
- API server not running
- Connection string invalid → DB connection fails
- Network unreachable

**Fix:**
```bash
# Check if API is running on port 7070
curl http://localhost:7070/health

# If fails, start it:
dotnet run --project LoanMS.API
```

---

## Key Files to Check

| File | What to Look For |
|------|------------------|
| [LoanMS.API/Controllers/WizardController.cs](LoanMS.API/Controllers/WizardController.cs#L234) | Line 234: `[HttpPost("submit")]` — the endpoint implementation |
| [LoanMS.API/Program.cs](LoanMS.API/Program.cs#L80-100) | Database provider selection & connection string setup |
| [LoanMS.API/appsettings.Development.json](LoanMS.API/appsettings.Development.json) | SQLite connection string for dev |
| [frontend/src/pages/NewApplicationPage.tsx](frontend/src/pages/NewApplicationPage.tsx#L1427) | Line 1427: `wizardApi.submit(buildPayload())` — the frontend call |
| [frontend/src/api/wizardApi.ts](frontend/src/api/wizardApi.ts#L75) | Line 75: `submit` endpoint definition |

---

## Next Steps

1. **Add logging** to `appsettings.Development.json` (set MinimumLevel to "Debug")
2. **Restart the API** (`dotnet run --project LoanMS.API`)
3. **Open DevTools** (F12) → **Network** tab
4. **Click Proceed** on the wizard
5. **Screenshot or paste the response JSON** from both `/validate` and `/submit`
6. **Check API console logs** for any errors
7. **Share the response** — that will tell us exactly where it's failing

