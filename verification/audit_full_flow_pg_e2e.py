#!/usr/bin/env python3
"""Full user-journey audit on REAL PostgreSQL (2026-09-26):
Wizard (draft -> resume -> validate -> submit) -> Documents -> Documents Check -> Income Check ->
Bank Details Check -> ECS Return -> Underwriting -> Verification (FI) -> Offer -> Deviation ->
Credit Approval -> Sanction -> Acceptance (NACH + Agreement) -> Disbursement.

Every step is driven through the same API calls the React UI makes, and asserted against the API
response AND PostgreSQL. Each check states the CORRECT expected behaviour, so a FAIL is a defect.
Negative checks cover unauthorised roles, skipped stages and browser-asserted flags.

Runs inside WSL: API on $API_URL (default http://127.0.0.1:5299), psql 127.0.0.1:5433/$PGDB.
Tokens are minted with the API's Jwt:Key (no /login, so the login rate limit is untouched).
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.request, urllib.error, uuid, random, string

API = os.environ.get("API_URL", "http://127.0.0.1:5299")
KEY = os.environ.get("JWT_KEY", "e2e-offer-workflow-verification-key-0123456789abcdef")
PGDB = os.environ.get("PGDB", "loanms_audit2")
PSQL = ["psql", "-h", "127.0.0.1", "-p", "5433", "-U", "loanms", "-d", PGDB, "-v", "ON_ERROR_STOP=0", "-tA"]
RESULTS = []
RUN = str(int(time.time()))[-6:]

def sql(q):
    r = subprocess.run(PSQL + ["-c", q], capture_output=True, text=True,
                       env={**os.environ, "PATH": "/usr/lib/postgresql/18/bin:" + os.environ["PATH"]})
    return r.stdout.strip()

def b64(d): return base64.urlsafe_b64encode(d).rstrip(b"=").decode()

def token(uid, role, name="E2E"):
    now = int(time.time())
    payload = {"sub": str(uid), "userId": str(uid), "role": role,
               "http://schemas.microsoft.com/ws/2008/06/identity/claims/role": role,
               "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name": name,
               "email": f"{name}@efin.test", "jti": str(uuid.uuid4()),
               "iss": "LoanMS.API", "aud": "LoanMS.Client", "nbf": now - 5, "iat": now - 5, "exp": now + 7200}
    si = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()) + "." + b64(json.dumps(payload).encode())
    return si + "." + b64(hmac.new(KEY.encode(), si.encode(), hashlib.sha256).digest())

def call(method, path, tok, body=None, idem=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("Authorization", "Bearer " + tok)
    req.add_header("Content-Type", "application/json")
    if idem: req.add_header("Idempotency-Key", idem)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            try: return r.status, json.loads(raw or b"{}")
            except Exception: return r.status, {"raw": raw.decode(errors="replace")}
    except urllib.error.HTTPError as e:
        raw = e.read()
        try: return e.code, json.loads(raw or b"{}")
        except Exception: return e.code, {"raw": raw.decode(errors="replace")}

def upload(path, tok, fields, filename, content, ctype):
    boundary = "----e2e" + uuid.uuid4().hex
    parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in fields.items()]
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: {ctype}\r\n\r\n'.encode() + content + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    req = urllib.request.Request(API + path, data=b"".join(parts), method="POST")
    req.add_header("Authorization", "Bearer " + tok)
    req.add_header("Content-Type", "multipart/form-data; boundary=" + boundary)
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try: return e.code, json.loads(raw or b"{}")
        except Exception: return e.code, {"raw": raw.decode(errors="replace")}

def check(name, cond, detail=""):
    RESULTS.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  -> {str(detail)[:400]}"), flush=True)

def msg(r): return (r.get("message") or "") + " " + " ".join(r.get("errors") or [])

# ── wait for API ──────────────────────────────────────────────────────────────
for _ in range(120):
    try: urllib.request.urlopen(API + "/api/health", timeout=3); break
    except urllib.error.HTTPError: break
    except Exception: time.sleep(5)

# ── Users (one per role; cloned from the seeded admin row, role overwritten) ──
admin_id = int(sql("SELECT \"Id\" FROM \"Users\" WHERE \"Email\"='admin@efin.com';"))
cols = sql("SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name='Users' AND column_name NOT IN ('Id','Email','Role','FullName','EmployeeCode');")
role_is_int = sql("SELECT data_type FROM information_schema.columns WHERE table_name='Users' AND column_name='Role';") in ("integer", "smallint")
ROLE_NUM = {"Admin": 0, "Manager": 1, "Sales": 2, "Dsa": 3, "Partner": 4, "LoginTeam": 5, "TeamLeader": 6,
            "Accounts": 7, "LocationHead": 8, "OperationManager": 9, "ProductTeam": 10}
# Every audit user works at the audit Location, so the location-scoped roles
# (Credit Evaluation Officer / Manager, Zonal Manager, Team Leader, BDM) see the
# application exactly as their real colleagues at that branch would.
loc_id = int(sql(f"""INSERT INTO "Locations" ("Name","City","State","IsActive","CreatedAt","IsDeleted") VALUES ('Audit Loc {RUN}','Pune','Maharashtra',true,now(),false) RETURNING "Id";""").splitlines()[0])
def user(role, tag):
    email = f"{tag}.{RUN}@audit.test"; name = f"{tag.title()} Audit {RUN}"
    rv = ROLE_NUM[role] if role_is_int else f"'{role}'"
    sql(f'INSERT INTO "Users" ({cols},"Email","Role","FullName") SELECT {cols},\'{email}\',{rv},\'{name}\' FROM "Users" WHERE "Id"={admin_id};')
    uid = int(sql(f"SELECT \"Id\" FROM \"Users\" WHERE \"Email\"='{email}';"))
    sql(f'UPDATE "Users" SET "LocationId"={loc_id}, "LocationName"=\'Audit Loc {RUN}\' WHERE "Id"={uid};')
    return uid, token(uid, role, name), name

T_ADMIN = token(admin_id, "Admin", "ChiefAdmin")
SALES_ID, T_SALES, SALES_NAME = user("Sales", "bde")
SALES2_ID, T_SALES2, _ = user("Sales", "bde2")
CEO_ID, T_CEO, _ = user("LoginTeam", "ceo")          # Credit Evaluation Officer
CEM_ID, T_CEM, _ = user("OperationManager", "cem")   # Credit Evaluation Manager
ZM_ID, T_ZM, _ = user("LocationHead", "zm")          # Zonal Manager
_, T_ACC, _ = user("Accounts", "acc")                # Payout & Reconciliation Officer
_, T_PT, _ = user("ProductTeam", "pt")               # Product & Risk Officer
_, T_TL, _ = user("TeamLeader", "tl")
_, T_MGR, _ = user("Manager", "bdm")
# Credit Evaluation Manager scope (G-04): loans at its mapped Location AND handled by
# a member of the Login team it leads — so it leads the CEO's Login team.
team_id = int(sql(f"""INSERT INTO "Teams" ("Name","Type","LocationId","TeamLeadUserId","CreatedAt","IsDeleted","IsActive") VALUES ('Audit Login Team {RUN}','Login',{loc_id},{CEM_ID},now(),false,true) RETURNING "Id";""").splitlines()[0])
sql(f'INSERT INTO "TeamMembers" ("TeamId","UserId","CreatedAt","IsDeleted") VALUES ({team_id},{CEO_ID},now(),false);')
sql(f'INSERT INTO "UserLocations" ("UserId","LocationId","CreatedAt","IsDeleted") VALUES ({CEM_ID},{loc_id},now(),false);')
# Zonal Manager scope: every application at its Admin-assigned Location(s) (UserLocations).
sql(f'INSERT INTO "UserLocations" ("UserId","LocationId","CreatedAt","IsDeleted") VALUES ({ZM_ID},{loc_id},now(),false);')

bank_rows = []
for nm in (f"Audit HDFC {RUN}", f"Audit ICICI {RUN}"):
    bank_rows.append(int(sql(f"""INSERT INTO "Banks" ("BankName","IsActive","IsIncred","IsElite","MinCibil","AcceptNtc","MaxLoanAmt","MinTenure","MaxTenure","FoirLimit","PfRequired","MinAge","MaxAge","MinExpMonths","EmpTypesJson","CompTypesJson","CreatedAt","IsDeleted")
      VALUES ('{nm}',true,false,false,650,true,5000000,12,60,60,false,21,60,6,'[]','[]',now(),false) RETURNING "Id";""").splitlines()[0]))
HDFC, ICICI = bank_rows
HDFC_NAME = f"Audit HDFC {RUN}"

def pan():
    return "".join(random.choice(string.ascii_uppercase) for _ in range(5)) + f"{random.randint(1000, 9999)}" + random.choice(string.ascii_uppercase)
def mobile(): return "9" + "".join(random.choice(string.digits) for _ in range(9))

def wizard_payload(**over):
    p = {"fullName": f"Ravi Audit {RUN}", "mobile": mobile(), "email": f"ravi{RUN}{random.randint(0,9999)}@audit.test",
         "pan": pan(), "aadhar": "".join(random.choice(string.digits) for _ in range(12)), "dob": "1990-05-15", "gender": "Male",
         "fatherName": "Suresh", "city": "Pune", "state": "Maharashtra", "street1": "12 MG Road", "street2": "Camp", "zip": "411001",
         "homeType": "Owned by Self / Spouse", "empType": "SALARIED", "compName": "Acme Ltd", "compType": "Private Limited",
         "salary": 85000, "obligations": 5000, "desig": "Engineer", "officeEmail": "ravi@acme.test",
         "loanType": "personal_loan", "amount": 500000, "loanRate": 12, "tenure": 36, "purpose": "Home renovation",
         "r1Name": "Anil Kumar", "r1Mobile": mobile(), "r1Relation": "Friend",
         "r2Name": "Sunita Rao", "r2Mobile": mobile(), "r2Relation": "Colleague",
         "salesPerson": SALES_NAME, "source": "Direct", "channel": "direct", "lenderName": HDFC_NAME,
         "locationId": loc_id, "productData": {"mother": "Kamla"},
         "selectedBanks": [{"bankName": HDFC_NAME, "tempApplicationNumber": "", "remarks": "Selected from eligibility match at origination"}]}
    p.update(over)
    return p

print(f"=== RUN {RUN}  API {API}  DB {PGDB} ===")

# ═════════════════════════════════════════════════════════════════════════════
# W — WIZARD
# ═════════════════════════════════════════════════════════════════════════════
# W1 — permission: roles without canCreateApp can neither autosave nor submit
for tag, tok in (("Payout&Recon", T_ACC), ("Product&Risk", T_PT), ("TeamLeader", T_TL), ("BDM", T_MGR)):
    s, r = call("POST", "/api/wizard/draft", tok, wizard_payload())
    check(f"W1 {tag}: wizard draft autosave refused (403)", s == 403, (s, r))
    s, r = call("POST", "/api/wizard/submit", tok, wizard_payload())
    check(f"W1 {tag}: wizard submit refused (403)", s == 403, (s, r))
    s, r = call("POST", "/api/wizard/validate", tok, wizard_payload())
    check(f"W1 {tag}: wizard validate (duplicate lookup) refused (403)", s == 403, (s, r))
leaked = sql(f"SELECT count(*) FROM \"Loans\" l JOIN \"Customers\" c ON c.\"Id\"=l.\"CustomerId\" WHERE c.\"FullName\"='Ravi Audit {RUN}';")
check("W1 PG: no draft/customer rows created by unauthorised roles", leaked == "0", leaked)

# W2 — draft autosave (Steps 1..6) by the BDE, then resume
base = wizard_payload()
step1 = {k: base[k] for k in ("fullName", "mobile", "email", "pan", "salesPerson", "source", "channel", "locationId", "loanType")}
step1["step"] = 1
s, r = call("POST", "/api/wizard/draft", T_SALES, step1)
draft_id = (r.get("data") or {}).get("loanId")
check("W2 draft autosave step 1 -> 200 Draft", s == 200 and draft_id and r["data"]["status"] == "Draft", (s, r))
s, r = call("POST", "/api/wizard/draft", T_SALES, {**base, "loanId": draft_id, "step": 6})
check("W2 draft autosave step 6 updates SAME draft", s == 200 and r["data"]["loanId"] == draft_id, (s, r))
row = sql(f'SELECT "Status","WizardStep","RequestedAmount","TenureMonths","LocationId" FROM "Loans" WHERE "Id"={draft_id};')
check("W2 PG: draft persisted (Draft, step 6, 500000.00, 36, location)", row == f"Draft|6|500000.00|36|{loc_id}", row)
refs = sql(f'SELECT count(*) FROM "LoanReferences" WHERE "LoanId"={draft_id} AND NOT "IsDeleted";')
check("W2 PG: both references saved on the draft", refs == "2", refs)
s, r = call("GET", f"/api/wizard/draft/{draft_id}", T_SALES)
d = r.get("data") or {}
check("W2 resume: GET draft returns the saved fields (PAN, refs, productData)", s == 200 and d.get("pan") == base["pan"] and d.get("r2Name") == "Sunita Rao"
      and (d.get("productData") or {}).get("mother") == "Kamla", (s, d))
s, r = call("GET", "/api/wizard/drafts", T_SALES)
check("W2 drafts list shows the draft", s == 200 and any(x.get("loanId", x.get("id")) == draft_id for x in (r.get("data") or [])), (s, r))
# W3 — another BDE cannot read or overwrite the draft
s, r = call("GET", f"/api/wizard/draft/{draft_id}", T_SALES2)
check("W3 other BDE: GET foreign draft -> 404", s == 404, (s, r))
s, r = call("POST", "/api/wizard/draft", T_SALES2, {**base, "loanId": draft_id, "fullName": "Hijack"})
own = sql(f'SELECT c."FullName" FROM "Loans" l JOIN "Customers" c ON c."Id"=l."CustomerId" WHERE l."Id"={draft_id};')
check("W3 other BDE: autosave with foreign draft id does not touch it", own == base["fullName"], own)
s, r = call("POST", "/api/wizard/submit", T_SALES2, {**base, "loanId": draft_id})
check("W3 other BDE: submit foreign draft -> 404", s == 404, (s, r))

# W4 — /validate follows Vanilla Step 6 (amount + tenure; interest rate is optional)
s, r = call("POST", "/api/wizard/validate", T_SALES, {**base, "loanId": draft_id, "loanRate": 0})
check("W4 validate: blank interest rate is not a blocker (Vanilla step 6)", s == 200, (s, r))

# W5 — server-side final-submit rules (Vanilla validateStep 1/3/7/9)
def must_reject(label, over, needle):
    s, r = call("POST", "/api/wizard/submit", T_SALES, wizard_payload(**over))
    check(f"W5 submit without {label} -> 400", s == 400 and needle.lower() in msg(r).lower(), (s, r))
must_reject("PAN", {"pan": ""}, "PAN")
must_reject("Location", {"locationId": None}, "Location")
must_reject("Reference 2", {"r2Name": "", "r2Mobile": "", "r2Relation": ""}, "Reference 2")
must_reject("Reference 1 relationship", {"r1Relation": ""}, "Reference 1")
must_reject("a selected bank", {"selectedBanks": [], "lenderName": None}, "bank")
must_reject("more than 2 banks (Personal Loan)", {"selectedBanks": [{"bankName": f"B{i}"} for i in range(3)]}, "bank")
must_reject("date of birth", {"dob": ""}, "birth")
must_reject("gender", {"gender": ""}, "Gender")
must_reject("Aadhaar", {"aadhar": ""}, "Aadhaar")
must_reject("email", {"email": ""}, "Email")

# W6 — final submit of the resumed draft
s, r = call("POST", "/api/wizard/submit", T_SALES, {**base, "loanId": draft_id})
check("W6 submit resumed draft -> 200 Submitted (same record)", s == 200 and r["data"]["loanId"] == draft_id and r["data"]["status"] == "Submitted", (s, r))
LOAN = draft_id
row = sql(f'SELECT "Status","CreatedByUserId","AssignedToUserId","LocationId","SelectedLenderNames" FROM "Loans" WHERE "Id"={LOAN};')
check("W6 PG: Submitted, created by + assigned to the BDE, location, lender", row == f"Submitted|{SALES_ID}|{SALES_ID}|{loc_id}|{HDFC_NAME}", row)
lines = sql(f"""SELECT string_agg("BankName", ',') FROM "LoanBankLines" WHERE "LoanId"={LOAN} AND NOT "IsDeleted";""")
check("W6 PG: Step-9 bank persisted as bank line by the submit itself", lines == HDFC_NAME, lines)
hist = sql(f'SELECT "FromStatus"||\'>\'||"ToStatus" FROM "LoanStatusHistories" WHERE "LoanId"={LOAN} ORDER BY "Id" DESC LIMIT 1;')
check("W6 PG: status history Draft>Submitted", hist == "Draft>Submitted", hist)
s, r = call("PUT", f"/api/loans/{LOAN}/bank-lines", T_SALES, {"bankLines": [{"bankName": HDFC_NAME, "tempApplicationNumber": ""}]})
check("W6 BDE has no bank-lines write access (the wizard must not depend on it)", s == 403, (s, r))
# W7 — duplicate / 45-day guard
s, r = call("POST", "/api/wizard/submit", T_SALES, wizard_payload(pan=base["pan"]))
check("W7 second application for same PAN while one is active -> 409 blocked", s == 409, (s, r))
# W8 — reload persistence
s, r = call("GET", f"/api/loans/{LOAN}", T_SALES)
check("W8 reload: loan readable by its BDE with Submitted status", s == 200 and r["data"]["status"] == "Submitted", (s, r))

# ═════════════════════════════════════════════════════════════════════════════
# S — POST-SUBMIT STAGES
# ═════════════════════════════════════════════════════════════════════════════
PDF = b"%PDF-1.4\n% audit document\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
# S1 Documents
s, r = upload(f"/api/loans/{LOAN}/documents", T_SALES, {"documentType": "bank_statement"}, "bank.pdf", PDF, "application/pdf")
doc_id = ((r.get("data") or {}).get("id")) if isinstance(r.get("data"), dict) else None
check("S1 BDE uploads bank statement", s in (200, 201) and doc_id, (s, r))
s, r = upload(f"/api/loans/{LOAN}/documents", T_SALES, {"documentType": "salary_slip"}, "slip.pdf", PDF, "application/pdf")
check("S1 BDE uploads salary slip", s in (200, 201), (s, r))
s, r = call("PATCH", f"/api/loans/{LOAN}/documents/{doc_id}/verify", T_SALES, {})
check("S1 BDE cannot verify a document (403)", s == 403, (s, r))
s, r = call("PATCH", f"/api/loans/{LOAN}/documents/{doc_id}/verify", T_CEO, {})
check("S1 Credit Evaluation Officer verifies the document", s == 200, (s, r))
dv = sql(f'SELECT "Status" FROM "LoanDocuments" WHERE "Id"={doc_id};')
check("S1 PG: document verification persisted", dv.lower() == "verified", dv)

# S2 Documents Check — a browser cannot assert the flag; recording the check sets it (server)
s, r = call("PATCH", f"/api/loans/{LOAN}/overview", T_CEO, {"documentChecked": True})
check("S2 Documents flag without a recorded Documents check -> refused", s in (400, 409), (s, r))
s, r = call("PATCH", f"/api/loans/{LOAN}/overview", T_ACC, {"bankChecked": True, "ecsReturn": True, "nachDone": True})
check("S2 Payout officer cannot set verification flags", s in (400, 403, 409), (s, r))
flags = sql(f'SELECT "DocumentChecked","BankChecked","EcsReturn","NachDone" FROM "Loans" WHERE "Id"={LOAN};')
check("S2 PG: no flag was set by the refused calls", flags == "f|f|f|f", flags)
def track(tok, name, comment="", sub="", status="COMPLETE"):
    return call("POST", f"/api/loans/{LOAN}/tracking", tok, {"name": name, "stage": "Credit Evaluation Officer", "assignedUser": "",
                                                              "status": status, "comment": comment, "subNote": sub})
def flag(col): return sql(f'SELECT "{col}" FROM "Loans" WHERE "Id"={LOAN};')
s, r = track(T_CEO, "EFIN — Documents", "All documents verified")
check("S2 Documents check recorded -> server sets DocumentChecked (no 2nd call)", s in (200, 201) and flag("DocumentChecked") == "t", (s, r, flag("DocumentChecked")))
s, r = call("PATCH", f"/api/loans/{LOAN}/overview", T_CEO, {"documentChecked": True})
check("S2 re-asserting a recorded check is accepted (idempotent)", s == 200, (s, r))

# S3 Income Check (server-derived; the BDE may run it — Vanilla sales_executive)
s, r = call("PATCH", f"/api/loans/{LOAN}/overview", T_CEO, {"incomeChecked": True})
check("S3 browser cannot assert Income Checked (flag stays false)", flag("IncomeChecked") == "f", flag("IncomeChecked"))
s, r = track(T_SALES, "EFIN-Income Check - CPA", "Salary / Income Details:\nAverage Monthly Salary: 85000\n\nRemark: ok")
check("S3 BDE records the income check note", s in (200, 201), (s, r))
s, r = call("POST", f"/api/loans/{LOAN}/income-verification/run", T_SALES, {})
iv = r.get("data") or {}
check("S3 BDE runs the income verification (persisted)", s == 200 and iv.get("id"), (s, r))
s, r = call("GET", f"/api/loans/{LOAN}/income-verification", T_SALES)
check("S3 BDE can read the income verification result", s == 200, (s, r))
if iv.get("state") == "ManualReviewRequired":
    s, r = call("POST", f"/api/loans/{LOAN}/income-verification/{iv['id']}/manual-review", T_SALES, {"decision": "Approved", "reason": "x"})
    check("S3 BDE cannot complete income manual review", s in (403, 404), (s, r))
    s, r = call("POST", f"/api/loans/{LOAN}/income-verification/{iv['id']}/manual-review", T_CEM, {"decision": "Approved", "reason": "Salary credits verified"})
    check("S3 Credit Evaluation Manager completes income review", s == 200, (s, r))
check("S3 PG: IncomeChecked derived true by the server", flag("IncomeChecked") == "t", flag("IncomeChecked"))

# S4 Bank Details Check (Credit Evaluation Officer)
ACCT = "123456789012"
note = f"Bank Name: HDFC Bank\nAccount Holder Name: Ravi Audit\nAccount Number: {ACCT}\nIFSC Code: HDFC0001234\nCheck Type: Disbursement Account\nResult: Okay to Process"
s, r = track(T_CEO, "EFIN- Bank Details Check", "", note)
check("S4 bank details check recorded -> BankChecked set by server", s in (200, 201) and flag("BankChecked") == "t", (s, r, flag("BankChecked")))

# S6a Underwriting prerequisites — Lender Details line (Zonal Manager has canAddBank) + all checks
s, r = call("PUT", f"/api/loans/{LOAN}/bank-lines", T_CEO, {"bankLines": [{"bankName": HDFC_NAME, "tempApplicationNumber": "T1", "applicationNumber": "HDFC-APP-1", "approvedLoan": 500000}]})
check("S6 Credit Evaluation Officer has no canAddBank (403)", s == 403, (s, r))
s, r = call("PUT", f"/api/loans/{LOAN}/bank-lines", T_ZM, {"bankLines": [{"bankName": HDFC_NAME, "tempApplicationNumber": "T1", "applicationNumber": "HDFC-APP-1", "approvedLoan": 500000}]})
check("S6 Zonal Manager saves Lender Details (application no. + approved loan)", s == 200, (s, r))
s, r = call("PATCH", f"/api/loans/{LOAN}/status", T_CEO, {"newStatus": "UnderReview", "comment": "uw"})
check("S6 Underwriting blocked while the ECS check is missing (owner flow: checks first)", s in (400, 409) and "ECS" in msg(r), (s, r))

# S5 ECS Return — done by the BDE (Vanilla sales_executive)
s, r = call("PATCH", f"/api/loans/{LOAN}/overview", T_CEO, {"ecsReturn": True})
check("S5 ECS flag without a recorded ECS check -> refused", s in (400, 409), (s, r))
s, r = track(T_SALES, "EFIN-Charge", "No ECS Found", "Task marked as complete.")
check("S5 BDE records ECS return -> EcsReturn set by server", s in (200, 201) and flag("EcsReturn") == "t", (s, r, flag("EcsReturn")))

# S6 Underwriting
s, r = call("POST", f"/api/loans/{LOAN}/workflow/move-to-offer", T_CEO, {})
check("S6 cannot jump from Submitted straight to Offer", s in (400, 409), (s, r))
s, r = call("PATCH", f"/api/loans/{LOAN}/status", T_SALES, {"newStatus": "UnderReview"})
check("S6 BDE cannot move to Underwriting", s in (400, 403), (s, r))
s, r = call("PATCH", f"/api/loans/{LOAN}/status", T_CEO, {"newStatus": "UnderReview", "comment": "Moved to underwriting"})
check("S6 Credit Evaluation Officer moves to Underwriting", s == 200 and r["data"]["status"] == "UnderReview", (s, r))
track(T_CEO, "EFIN-Underwriting", "Moved to underwriting", " ")
s, r = track(T_CEO, "EFIN-Charge", "late ECS note")
check("S6 CPA check entry at Under Review is kept as a note", s in (200, 201), (s, r))

# S7 Verification (FI report required for Personal loans before Offer) — first a PENDING result
s, r = call("POST", f"/api/loans/{LOAN}/workflow/move-to-offer", T_CEO, {})
check("S7 Offer blocked until FI report", s in (400, 409) and "FI" in msg(r), (s, r))
s, r = call("PATCH", f"/api/loans/{LOAN}/overview", T_CEO, {"fiReportChecked": True})
check("S7 FI flag without a recorded FI report -> refused", s in (400, 409), (s, r))
s, r = track(T_CEO, "EFIN- FI report", "FI initiated", "Final Resi Address - Positive\nFinal Office Address - Pending")
track(T_CEO, "EFIN- FI report", "Office FI is still pending.", "")   # the UI's follow-up system note (same name, no results)
check("S7 FI report recorded -> FiReportChecked set by server (Vanilla final_report)", s in (200, 201) and flag("FiReportChecked") == "t", (s, r))
s, r = call("POST", f"/api/loans/{LOAN}/workflow/move-to-offer", T_SALES, {})
check("S7 BDE cannot move to Offer", s in (403, 404), (s, r))
s, r = call("POST", f"/api/loans/{LOAN}/workflow/move-to-offer", T_CEO, {"comment": "Verification complete"})
check("S7 Verification complete -> Offer", s == 200, (s, r))
check("S7 PG: status Offer", flag("Status") == "Offer", flag("Status"))

# S8 Offers
def offer(bank, roi, tok=T_CEO):
    return call("POST", f"/api/loans/{LOAN}/workflow/offers", tok, {"bankId": bank, "loanAmount": 500000, "tenureMonths": 36, "baseRoi": 13, "offeredRoi": roi,
                "processingFeePct": 1, "gstPct": 18, "insuranceAmount": 0, "pfInBundled": False, "insuranceInBundled": False, "btAmount": 0, "stampDuty": 500})
s, r = offer(HDFC, 12, T_SALES)
check("S8 BDE cannot create an offer", s in (403, 404), (s, r))
s, r = offer(HDFC, 12); s2, r2 = offer(ICICI, 11)
check("S8 two lender offers created", s == 200 and s2 == 200, (s, r, s2, r2))
offers = {o["bankId"]: o for o in r2["data"]["offers"]}
off = offers[ICICI]
s, r = call("POST", f"/api/loans/{LOAN}/workflow/offers/{off['id']}/select", T_SALES, {"expectedVersion": off["version"]})
check("S8 BDE (application access) selects the final offer", s == 200, (s, r))
off = {o["bankId"]: o for o in r["data"]["offers"]}[ICICI]
check("S8 selected offer is Final", off["status"] == "Final", off)

# S9 Deviation (ICICI rule: min ROI 11.5 -> offered 11 breaches)
s, r = call("POST", "/api/deviation-rules", T_ADMIN, {"name": f"ICICI ROI floor {RUN}", "bankId": ICICI, "deviationType": "ROI", "metric": "ROI_MIN_PCT",
            "limitValue": 11.5, "priority": 3, "effectiveFrom": "2026-01-01T00:00:00Z", "maxApprovableBreach": 2})
check("S9 deviation rule created by Chief Admin", s == 200, (s, r))
s, r = call("POST", f"/api/loans/{LOAN}/workflow/re-evaluate", T_CEO, {})
off = {o["bankId"]: o for o in (r.get("data") or {}).get("offers", [])}.get(ICICI, off)
check("S9 re-check marks deviation Required on the final offer", off.get("deviationStatus") == "Required", off)
s, r = call("POST", f"/api/loans/{LOAN}/workflow/offers/{off['id']}/credit-approval", T_CEM, {"decision": "Approve", "revisionNo": off["current"]["revisionNo"]})
check("S9 credit approval blocked while a deviation is required", s in (400, 409), (s, r))
s, r = call("POST", f"/api/loans/{LOAN}/workflow/offers/{off['id']}/deviations", T_CEO, {"deviationType": "ROI", "reason": "Salary account holder"}, str(uuid.uuid4()))
devs = (r.get("data") or {}).get("deviations") or []
dev = devs[-1] if devs else {}
check("S9 deviation raised -> Decision stage", s == 200 and sql(f'SELECT "Status" FROM "Loans" WHERE "Id"={LOAN};') == "Decision", (s, r))
s, r = call("POST", f"/api/loans/{LOAN}/workflow/deviations/{dev.get('id')}/decide", T_CEO, {"approve": True})
check("S9 raiser cannot approve own deviation (403)", s == 403, (s, r))
s, r = call("POST", f"/api/loans/{LOAN}/workflow/deviations/{dev.get('id')}/decide", T_SALES, {"approve": True})
check("S9 BDE cannot approve a deviation", s in (403, 404), (s, r))
s, r = call("POST", f"/api/loans/{LOAN}/workflow/deviations/{dev.get('id')}/decide", T_ZM, {"approve": True, "comment": "Approved by ZM"})
check("S9 Zonal Manager approves the deviation -> back to Offer", s == 200 and sql(f'SELECT "Status" FROM "Loans" WHERE "Id"={LOAN};') == "Offer", (s, r))

# S10 Credit approval (maker-checker: offer creator = CEO cannot approve)
off = {o["bankId"]: o for o in call("GET", f"/api/loans/{LOAN}/workflow", T_ADMIN)[1]["data"]["offers"]}[ICICI]
rev = off["current"]["revisionNo"]
s, r = call("POST", f"/api/loans/{LOAN}/workflow/offers/{off['id']}/credit-approval", T_CEO, {"decision": "Approve", "revisionNo": rev})
check("S10 offer maker cannot credit-approve own terms (403)", s == 403, (s, r))
s, r = call("POST", f"/api/loans/{LOAN}/workflow/offers/{off['id']}/credit-approval", T_SALES, {"decision": "Approve", "revisionNo": rev})
check("S10 BDE cannot credit-approve", s in (403, 404), (s, r))
s, r = call("POST", f"/api/loans/{LOAN}/workflow/offers/{off['id']}/credit-approval", T_CEM, {"decision": "Approve", "revisionNo": rev, "comment": "OK"}, str(uuid.uuid4()))
check("S10 Credit Evaluation Manager credit-approves -> Approved", s == 200 and sql(f'SELECT "Status" FROM "Loans" WHERE "Id"={LOAN};') == "Approved", (s, r))

# S11 Sanction
s, r = call("POST", f"/api/loans/{LOAN}/workflow/sanctions", T_SALES)
check("S11 BDE cannot generate the sanction", s in (403, 404), (s, r))
s, r = call("POST", f"/api/loans/{LOAN}/workflow/sanctions", T_CEO, None, "san-" + RUN)
sans = (r.get("data") or {}).get("sanctions") or []
san = next((x for x in sans if x["status"] == "Active"), {})
check("S11 sanction generated (Active, SAN- number)", s == 200 and (san.get("sanctionNumber") or "").startswith("SAN-"), (s, r))
s, r = call("PUT", f"/api/loans/{LOAN}/sanction-detail", T_ADMIN, {"sanctionLoanAmt": 1})
check("S11 sanctioned terms immutable while sanction active (409)", s == 409, (s, r))

# S12 Acceptance: deal confirmation (FI must be complete and not Negative/Pending) + NACH + customer agreement
s, r = call("PATCH", f"/api/loans/{LOAN}/overview", T_CEO, {"nachDone": True, "customerAgreementDone": True})
check("S12 NACH/Agreement flags without recorded entries -> refused", s in (400, 409), (s, r))
s, r = call("PATCH", f"/api/loans/{LOAN}/status", T_CEO, {"newStatus": "Acceptance", "comment": "Deal confirmation email sent"})
check("S12 Acceptance blocked while the FI office result is Pending (latest REPORT, not the follow-up note)",
      s in (400, 409) and "FI" in msg(r), (s, r))
s, r = track(T_CEO, "EFIN- FI report", "Office FI cleared", "Final Resi Address - Positive\nFinal Office Address - Positive")
check("S12 updated FI report recorded at Approved", s in (200, 201), (s, r))
track(T_CEO, "EFIN-Customer Confirmation", "Deal confirmation sent — awaiting customer reply", "Status moved to Acceptance on deal confirmation send")
s, r = call("PATCH", f"/api/loans/{LOAN}/status", T_CEO, {"newStatus": "Acceptance", "comment": "Deal confirmation email sent"})
check("S12 Approved -> Acceptance with an active sanction + positive FI", s == 200 and r["data"]["status"] == "Acceptance", (s, r))
s, r = track(T_CEO, "EFIN-Nach", "NACH registered"); s2, r2 = track(T_CEO, "EFIN-Customer Agreement", "Agreement signed")
check("S12 NACH + Agreement recorded -> flags set by server", s in (200, 201) and s2 in (200, 201)
      and flag("NachDone") == "t" and flag("CustomerAgreementDone") == "t", (s, r, s2, r2))

# S13 Disbursement
san = next(x for x in call("GET", f"/api/loans/{LOAN}/workflow", T_ADMIN)[1]["data"]["sanctions"] if x["status"] == "Active")
disb = {"amount": san["netDisbursement"], "disbursementDate": time.strftime("%Y-%m-%dT00:00:00Z"), "bankAccountNumber": ACCT, "ifsc": "HDFC0001234",
        "accountHolderName": "Ravi Audit", "utr": f"UTRAUD{RUN}", "lenderReference": "LAN-1", "mode": "NEFT"}
s, r = call("POST", f"/api/loans/{LOAN}/workflow/disbursements", T_SALES, disb)
check("S13 BDE cannot disburse", s in (403, 404), (s, r))
s, r = call("POST", f"/api/loans/{LOAN}/workflow/disbursements", T_ACC, disb)
check("S13 Payout officer cannot disburse", s in (403, 404), (s, r))
s, r = call("POST", f"/api/loans/{LOAN}/workflow/disbursements", T_ZM, {**disb, "amount": san["netDisbursement"] + 1})
check("S13 amount above net disbursement refused", s in (400, 409), (s, r))
s, r = call("POST", f"/api/loans/{LOAN}/workflow/disbursements", T_ZM, disb, "disb-" + RUN)
check("S13 Zonal Manager disburses -> Disbursed", s == 200 and sql(f'SELECT "Status" FROM "Loans" WHERE "Id"={LOAN};') == "Disbursed", (s, r))
s, r = call("POST", f"/api/loans/{LOAN}/workflow/disbursements", T_ZM, disb, "disb-" + RUN)
check("S13 idempotent repeat creates no second disbursement", sql(f'SELECT count(*) FROM "Disbursements" WHERE "LoanId"={LOAN};') == "1", (s, r))

# X — history / timeline / final lock
hist = sql(f"""SELECT string_agg("ToStatus", '>' ORDER BY "Id") FROM "LoanStatusHistories" WHERE "LoanId"={LOAN};""")
check("X status history covers the whole journey", all(x in hist for x in ("Submitted", "UnderReview", "Offer", "Decision", "Approved", "Acceptance", "Disbursed")), hist)
tl = sql(f"""SELECT string_agg(DISTINCT "Name", ' | ') FROM "TrackingEntries" WHERE "LoanId"={LOAN} AND NOT "IsDeleted";""")
check("X timeline has check + workflow rows", all(x in tl for x in ("EFIN — Documents", "EFIN- Bank Details Check", "EFIN-Charge", "EFIN-Final Offer Check")), tl)
s, r = call("PATCH", f"/api/loans/{LOAN}/overview", T_CEO, {"bankChecked": False})
check("X verification flags frozen after disbursement", s in (400, 409), (s, r))
s, r = call("PATCH", f"/api/loans/{LOAN}/status", T_ADMIN, {"newStatus": "UnderReview"})
check("X disbursed application cannot be moved back", s in (400, 409), (s, r))

passed = sum(1 for _, ok in RESULTS if ok)
print(f"\n=== {passed} / {len(RESULTS)} passed ===")
sys.exit(0 if passed == len(RESULTS) else 1)
