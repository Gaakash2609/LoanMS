#!/usr/bin/env python3
"""Offer -> Deviation -> Credit Approval -> Sanction -> Disbursement E2E on REAL PostgreSQL.

Runs inside WSL against the API (dotnet run, Database__Provider=postgresql) on :5099 (launchSettings) and
psql on 127.0.0.1:5433 / loanms_offer_e2e. Tokens are minted with the API's own Jwt:Key
(no /login calls, so the 5-per-15-min login rate limit is not consumed). Every assertion is
checked against the API response AND, where it matters, directly in PostgreSQL.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.request, urllib.error, uuid

API = os.environ.get("API_URL", "http://localhost:5099")
KEY = os.environ.get("JWT_KEY", "e2e-offer-workflow-verification-key-0123456789abcdef")
PSQL = ["psql", "-h", "127.0.0.1", "-p", "5433", "-U", "loanms", "-d", "loanms_offer_e2e", "-v", "ON_ERROR_STOP=0", "-tA"]
RESULTS = []

def sql(q):
    r = subprocess.run(PSQL + ["-c", q], capture_output=True, text=True, env={**os.environ, "PATH": "/usr/lib/postgresql/18/bin:" + os.environ["PATH"]})
    return (r.stdout.strip(), r.stderr.strip())

def b64(d): return base64.urlsafe_b64encode(d).rstrip(b"=").decode()

def token(uid, role, name="E2E"):
    header = {"alg": "HS256", "typ": "JWT"}
    now = int(time.time())
    payload = {"sub": str(uid), "userId": str(uid), "role": role,
               "http://schemas.microsoft.com/ws/2008/06/identity/claims/role": role,
               "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name": name,
               "email": f"{name}@efin.test", "jti": str(uuid.uuid4()),
               "iss": "LoanMS.API", "aud": "LoanMS.Client", "nbf": now - 5, "iat": now - 5, "exp": now + 3600}
    si = b64(json.dumps(header).encode()) + "." + b64(json.dumps(payload).encode())
    return si + "." + b64(hmac.new(KEY.encode(), si.encode(), hashlib.sha256).digest())

def call(method, path, tok, body=None, idem=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("Authorization", "Bearer " + tok)
    req.add_header("Content-Type", "application/json")
    if idem: req.add_header("Idempotency-Key", idem)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try: return e.code, json.loads(raw or b"{}")
        except Exception: return e.code, {"raw": raw.decode(errors="replace")}

def upload(path, tok, fields, filename, content, ctype):
    boundary = "----e2e" + uuid.uuid4().hex
    parts = []
    for k, v in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: {ctype}\r\n\r\n'.encode() + content + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    req = urllib.request.Request(API + path, data=b"".join(parts), method="POST")
    req.add_header("Authorization", "Bearer " + tok)
    req.add_header("Content-Type", "multipart/form-data; boundary=" + boundary)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try: return e.code, json.loads(raw or b"{}")
        except Exception: return e.code, {"raw": raw.decode(errors="replace")}

def check(name, cond, detail=""):
    RESULTS.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  -> {detail}"))

# ── wait for API ──────────────────────────────────────────────────────────────
for _ in range(120):
    try:
        urllib.request.urlopen(API + "/api/health", timeout=3); break
    except urllib.error.HTTPError: break
    except Exception: time.sleep(5)

migs, _ = sql('SELECT "MigrationId" FROM "__EFMigrationsHistory" ORDER BY 1 DESC LIMIT 1;')
check("PG: latest migration applied = AddBureauUploadOfferValidityTaskPause", migs.endswith("AddBureauUploadOfferValidityTaskPause"), migs)
newcols, _ = sql("SELECT string_agg(table_name||'.'||column_name, ',' ORDER BY table_name, column_name) FROM information_schema.columns WHERE (table_name, column_name) IN (('Banks','OfferValidityDays'),('Tasks','PausedAt'),('Tasks','PauseReason'),('BureauReports','UploadedByUserId'),('ApplicationOffers','LatestEvaluationJson'),('ApplicationOffers','LatestEvaluatedAt'));")
check("PG: completion columns present (6)", len(newcols.split(",")) == 6, newcols)
trg, _ = sql("SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_%' AND NOT tgisinternal;")
check("PG: 13 workflow triggers installed", trg == "13", trg)
chk, _ = sql("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='CK_Loans_Status';")
check("PG: CK_Loans_Status excludes NI/Cancelled", "Offer" in chk and "NI" not in chk and "Cancelled" not in chk, chk)

admin_id, _ = sql("SELECT \"Id\" FROM \"Users\" WHERE \"Email\"='admin@efin.com';")
admin_id = int(admin_id)
cols, _ = sql("SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name='Users' AND column_name NOT IN ('Id','Email','Role','FullName','EmployeeCode');")
def clone_user(email, role, name):
    sql(f'INSERT INTO "Users" ({cols},"Email","Role","FullName") SELECT {cols},\'{email}\',\'{role}\',\'{name}\' FROM "Users" WHERE "Id"={admin_id} ON CONFLICT DO NOTHING;')
    out, err = sql(f"SELECT \"Id\" FROM \"Users\" WHERE \"Email\"='{email}';")
    return int(out)
role_col, _ = sql("SELECT data_type FROM information_schema.columns WHERE table_name='Users' AND column_name='Role';")
def role_val(r):
    if role_col in ("integer", "smallint"):
        return {"Admin": 0, "LoginTeam": 5, "LocationHead": 8, "OperationManager": 9, "Accounts": 7, "Partner": 4}[r]
    return r
ceo = clone_user("ceo.e2e@efin.test", role_val("LoginTeam"), "Credit Officer E2E")
acc = clone_user("acc.e2e@efin.test", role_val("Accounts"), "Payout Officer E2E")
admin2 = clone_user("admin2.e2e@efin.test", role_val("Admin"), "Chief Admin Two E2E")
T_ADMIN = token(admin_id, "Admin", "ChiefAdmin")
T_ADMIN2 = token(admin2, "Admin", "ChiefAdminTwo")
T_CEO = token(ceo, "LoginTeam", "CreditOfficer")
T_ACC = token(acc, "Accounts", "PayoutOfficer")
mgr_id, _ = sql("SELECT \"Id\" FROM \"Users\" WHERE \"Email\"='manager@efin.com';")
T_MGR = token(int(mgr_id), "Manager", "BDM")
sales_id, _ = sql("SELECT \"Id\" FROM \"Users\" WHERE \"Email\"='sales@efin.com';")
T_SALES = token(int(sales_id), "Sales", "BDE")

# ── Lenders ───────────────────────────────────────────────────────────────────
bank_ids = []
RUN = str(int(time.time()))[-6:]
for i, name in enumerate([f"E2E HDFC {RUN}", f"E2E ICICI {RUN}", f"E2E IDFC {RUN}", f"E2E InCred {RUN}"]):
    out, err = sql(f"""INSERT INTO "Banks" ("BankName","IsActive","IsIncred","IsElite","MinCibil","AcceptNtc","MaxLoanAmt","MinTenure","MaxTenure","FoirLimit","PfRequired","MinAge","MaxAge","MinExpMonths","EmpTypesJson","CompTypesJson","CreatedAt","IsDeleted")
      VALUES ('{name}',true,false,false,700,false,5000000,12,60,50,false,21,60,6,'[]','[]',now(),false) RETURNING "Id";""")
    if not out: print("BANK INSERT ERROR:", err); sys.exit(2)
    bank_ids.append(int(out.splitlines()[0]))
HDFC, ICICI, IDFC, INCRED = bank_ids

# ── Deviation rules through the API ──────────────────────────────────────────
def rule(bank, typ, metric, limit, name):
    return call("POST", "/api/deviation-rules", T_ADMIN, {"name": name, "bankId": bank, "deviationType": typ, "metric": metric,
        "limitValue": limit, "priority": 10, "effectiveFrom": "2026-01-01T00:00:00Z", "approvalRequired": True, "conditions": []})
for b in (HDFC, IDFC, INCRED):
    s, r = rule(b, "ROI", "ROI_MIN_PCT", 10, "ROI floor 10")
check("API: rule create (Admin) 200", s == 200, r)
s, r = rule(ICICI, "ROI", "ROI_MIN_PCT", 14, "ICICI ROI floor 14")
icici_rule = r["data"]["id"]
s, r = call("POST", "/api/deviation-rules", T_SALES, {"name": "x", "bankId": HDFC, "deviationType": "ROI", "metric": "ROI_MIN_PCT", "limitValue": 5, "priority": 3, "effectiveFrom": "2026-01-01T00:00:00Z"})
check("API: BDE cannot manage rules (403)", s == 403, (s, r))
s, r = rule(ICICI, "ROI", "ROI_MIN_PCT", 14, "ICICI ROI floor 14")
check("API: overlapping duplicate rule refused (409)", s == 409, (s, r))
s, r = rule(IDFC, "CIBIL", "CIBIL_MIN", 750, "IDFC bureau CIBIL 750")
check("API: IDFC CIBIL rule created", s == 200, (s, r))
idfc_cibil_rule = r["data"]["id"]

# Lender offer validity (owner decision: configured per lender, in days)
s, r = call("PUT", f"/api/banks/{HDFC}", T_ADMIN, {"bankName": f"E2E HDFC {RUN}", "offerValidityDays": 30})
check("API: lender offer validity saved", s == 200, (s, r))
s, r = call("PUT", f"/api/banks/{HDFC}", T_ADMIN, {"bankName": f"E2E HDFC {RUN}", "offerValidityDays": 400})
check("API: offer validity > 365 refused (400)", s == 400, (s, r))
out, _ = sql(f'SELECT "OfferValidityDays" FROM "Banks" WHERE "Id"={HDFC};')
check("PG: Banks.OfferValidityDays = 30", out == "30", out)

# ── Application ──────────────────────────────────────────────────────────────
pan = "PQRST" + str(int(time.time()) % 10000).zfill(4) + "K"
s, r = call("POST", "/api/customers", T_ADMIN, {"fullName": "Asha E2E", "email": f"asha{int(time.time())}@x.test", "phone": "98" + str(int(time.time()))[-8:],
    "panNumber": pan, "monthlyIncome": 100000, "employmentType": "SALARIED", "cibilScore": 780})
check("API: customer created", s in (200, 201), (s, r))
cust = r["data"]["id"]
s, r = call("POST", "/api/loans", T_ADMIN, {"customerId": cust, "loanType": "Personal", "requestedAmount": 500000, "interestRate": 12,
    "tenureMonths": 36, "purpose": "E2E", "loginUserId": ceo})
check("API: loan created", s in (200, 201), (s, r))
loan = r["data"]["id"]
s, r = call("PATCH", f"/api/loans/{loan}/submit", T_ADMIN)
s, r = call("PUT", f"/api/loans/{loan}/bank-lines", T_ADMIN, {"bankLines": [{"bankName": f"E2E HDFC {RUN}", "tempApplicationNumber": "T1", "applicationNumber": "APP1", "approvedLoan": 500000}]})
s, r = call("PATCH", f"/api/loans/{loan}/status", T_ADMIN, {"newStatus": "UnderReview", "comment": "uw"})
check("API: loan in UnderReview", s == 200 and r["data"]["status"] == "UnderReview", (s, r))

s, r = call("POST", f"/api/loans/{loan}/workflow/move-to-offer", T_CEO, {})
check("API: move-to-offer blocked until checks done (409)", s == 409 and "Documents check" in (r.get("message") or ""), (s, r))
s, r = call("PATCH", f"/api/loans/{loan}/overview", T_ADMIN, {"documentChecked": True, "incomeChecked": True, "bankChecked": True, "ecsReturn": True, "fiReportChecked": True})
s, r = call("POST", f"/api/loans/{loan}/workflow/move-to-offer", T_CEO, {})
check("API: IncomeChecked is not client-settable (still blocked on Income check)", s == 409 and "Income check" in (r.get("message") or ""), (s, r))
# IncomeChecked is derived only from an authoritative IncomeVerification run (Perfios / salary
# slip pipeline, not reproducible here) — simulate that outcome directly in PostgreSQL.
sql(f'UPDATE "Loans" SET "IncomeChecked"=true WHERE "Id"={loan};')
s, r = call("POST", f"/api/loans/{loan}/workflow/move-to-offer", T_CEO, {"reason": "Verification complete"})
check("API: move-to-offer 200", s == 200 and r["data"]["loanStatus"] == "Offer", (s, r))
out, _ = sql(f'SELECT "Status" FROM "Loans" WHERE "Id"={loan};')
check("PG: Loans.Status = Offer", out == "Offer", out)

def offer(bank, roi=12, **kw):
    b = {"bankId": bank, "loanAmount": 500000, "tenureMonths": 36, "baseRoi": 13, "offeredRoi": roi, "processingFeePct": 1, "gstPct": 18,
         "insuranceAmount": 5000, "pfInBundled": False, "insuranceInBundled": False, "btAmount": 0, "stampDuty": 500}
    b.update(kw)
    return call("POST", f"/api/loans/{loan}/workflow/offers", T_CEO, b)
s1, r1 = offer(HDFC); s2, r2 = offer(ICICI); s3, r3 = offer(IDFC); s4, r4 = offer(INCRED)
check("API: 3 offers created", (s1, s2, s3) == (200, 200, 200), (s1, s2, s3))
check("API: 4th active offer blocked (409 OFFER_LIMIT)", s4 == 409 and r4.get("errorCode") == "OFFER_LIMIT", (s4, r4))
s5, r5 = offer(HDFC, roi=11.5)
check("API: second active offer same lender blocked (409)", s5 == 409, (s5, r5))
offers = {o["bankId"]: o for o in r3["data"]["offers"]}
check("API: EMI computed by backend = 16607.15", offers[HDFC]["current"]["emi"] == 16607.15, offers[HDFC]["current"])
out, _ = sql(f'SELECT "Emi","NetDisbursement","ProcessingFeeAmount","GstAmount" FROM "ApplicationOfferRevisions" r JOIN "ApplicationOffers" o ON o."Id"=r."OfferId" WHERE o."LoanId"={loan} AND o."BankId"={HDFC};')
check("PG: revision money columns exact (numeric)", out == "16607.15|488600.00|5000.00|900.00", out)
check("API: ICICI deviation Required, HDFC NotRequired", offers[ICICI]["deviationStatus"] == "Required" and offers[HDFC]["deviationStatus"] == "NotRequired", offers)
import datetime
want = (datetime.datetime.now(datetime.timezone.utc).date() + datetime.timedelta(days=30)).isoformat()
check("API: HDFC offer valid-until pre-set from lender validity (today + 30)", (offers[HDFC].get("validUntil") or "").startswith(want), offers[HDFC].get("validUntil"))
check("API: IDFC offer without validity config has none", offers[IDFC].get("validUntil") is None, offers[IDFC].get("validUntil"))
cib = [c for c in offers[IDFC]["evaluation"]["checks"] if c["deviationType"] == "CIBIL"]
check("API: no bureau report -> IDFC CIBIL check MissingData, deviation Required (customer-typed CIBIL 780 ignored)",
      offers[IDFC]["deviationStatus"] == "Required" and cib and cib[0]["status"] == "MissingData", offers[IDFC]["evaluation"])

# Bureau report upload (owner decision: the only CIBIL source)
PDF = b"%PDF-1.4\n% E2E bureau report\n"
bf = {"creditScore": "780", "bureauProvider": "CIBIL", "reportDate": time.strftime("%Y-%m-%d")}
s, r = upload(f"/api/loans/{loan}/workflow/bureau-report", T_SALES, bf, "cibil.pdf", PDF, "application/pdf")
check("API: BDE cannot upload a bureau report (403/404)", s in (403, 404), (s, r))
s, r = upload(f"/api/loans/{loan}/workflow/bureau-report", T_CEO, {**bf, "creditScore": "950"}, "cibil.pdf", PDF, "application/pdf")
check("API: score outside 300-900 refused (400)", s == 400, (s, r))
s, r = upload(f"/api/loans/{loan}/workflow/bureau-report", T_CEO, bf, "cibil.pdf", b"MZ not a pdf at all", "application/pdf")
check("API: file whose bytes are not a PDF refused (400)", s == 400 and "does not match" in (r.get("message") or ""), (s, r))
s, r = upload(f"/api/loans/{loan}/workflow/bureau-report", T_CEO, bf, "cibil.pdf", PDF, "application/pdf")
check("API: bureau report uploaded by Credit Evaluation Officer", s == 200 and r["data"]["bureauReport"]["creditScore"] == 780, (s, r))
idfc_after = [o for o in r["data"]["offers"] if o["bankId"] == IDFC][0]
check("API: re-check bumps the version only where the outcome changed", idfc_after["version"] == offers[IDFC]["version"] + 1
      and [o for o in r["data"]["offers"] if o["bankId"] == ICICI][0]["version"] == offers[ICICI]["version"], r["data"]["offers"])
offers = {o["bankId"]: o for o in r["data"]["offers"] if o["isActive"]}
check("API: IDFC re-checked -> deviation NotRequired after bureau 780", idfc_after["deviationStatus"] == "NotRequired" and idfc_after["latestEvaluatedAt"], idfc_after)
out, _ = sql(f'SELECT count(*), max("CreditScore"), max("UploadedByUserId") FROM "BureauReports" WHERE "CustomerId"={cust} AND "IsActive";')
check("PG: one active BureauReports row, score 780, uploader recorded", out == f"1|780|{ceo}", out)
out, _ = sql(f'SELECT count(*) FROM "LoanDocuments" WHERE "LoanId"={loan} AND "DocumentType"=\'Bureau Report\' AND NOT "IsDeleted";')
check("PG: report file registered in LoanDocuments", out == "1", out)
out, _ = sql(f'SELECT "DeviationStatus", "LatestEvaluatedAt" IS NOT NULL FROM "ApplicationOffers" WHERE "LoanId"={loan} AND "BankId"={IDFC};')
check("PG: IDFC offer DeviationStatus NotRequired + LatestEvaluatedAt set", out == "NotRequired|t", out)

# DB trigger: 4th active offer via raw SQL
out, err = sql(f"""INSERT INTO "ApplicationOffers" ("LoanId","BankId","LenderName","ProductKey","LoanType","Status","DeviationStatus","ApprovalStatus","CurrentRevisionNo","Version","CreatedByUserId","CreatedAt","IsDeleted")
  VALUES ({loan},{INCRED},'x','personal_loan','Personal','Available','Required','Pending',1,1,{admin_id},now(),false);""")
check("PG trigger: 4th active offer refused at DB level", "at most 3 active lender offers" in err, err)
out, err = sql(f'UPDATE "ApplicationOfferRevisions" SET "Emi"=1 WHERE "OfferId"={offers[HDFC]["id"]};')
check("PG trigger: offer revision UPDATE refused", "immutable" in err, err)
out, err = sql(f'DELETE FROM "ApplicationOfferRevisions" WHERE "OfferId"={offers[HDFC]["id"]};')
check("PG trigger: offer revision DELETE refused", "immutable" in err, err)
out, err = sql(f"UPDATE \"Loans\" SET \"Status\"='NI' WHERE \"Id\"={loan};")
check("PG CHECK: application status 'NI' impossible", "CK_Loans_Status" in err, err)
out, err = sql(f"INSERT INTO \"LoanStatusHistories\" (\"LoanId\",\"FromStatus\",\"ToStatus\",\"ChangedByUserId\",\"CreatedAt\",\"IsDeleted\") VALUES ({loan},'Offer','Cancelled',{admin_id},now(),false);")
check("PG CHECK: status history 'Cancelled' impossible", "CK_LoanStatusHistories_ToStatus" in err, err)

# Select ICICI (needs deviation) — Sales (application access) may confirm
ic = offers[ICICI]
s, r = call("POST", f"/api/loans/{loan}/workflow/offers/{ic['id']}/select", T_ADMIN, {"expectedVersion": ic["version"]})
check("API: final offer selected", s == 200 and [o for o in r["data"]["offers"] if o["id"] == ic["id"]][0]["status"] == "Final", (s, r))
s, r = call("POST", f"/api/loans/{loan}/workflow/offers/{offers[HDFC]['id']}/select", T_ADMIN, {})
check("API: second final selection refused (409)", s == 409, (s, r))
out, _ = sql(f"SELECT count(*) FROM \"ApplicationOffers\" WHERE \"LoanId\"={loan} AND \"Status\"='Final';")
check("PG: exactly one Final offer", out == "1", out)

s, r = call("POST", f"/api/loans/{loan}/workflow/offers/{ic['id']}/credit-approval", T_ADMIN, {"decision": "Approve", "revisionNo": 1})
check("API: credit approval blocked while deviation unresolved (409)", s == 409 and r.get("errorCode") == "DEVIATION_UNRESOLVED", (s, r))

idem = str(uuid.uuid4())
s, r = call("POST", f"/api/loans/{loan}/workflow/offers/{ic['id']}/deviations", T_CEO, {"deviationType": "ROI", "reason": "Salary a/c holder"}, idem)
check("API: deviation raised -> Decision", s == 200 and r["data"]["loanStatus"] == "Decision", (s, r))
s, r = call("POST", f"/api/loans/{loan}/workflow/offers/{ic['id']}/deviations", T_CEO, {"deviationType": "ROI", "reason": "dup"}, idem)
out, _ = sql(f'SELECT count(*) FROM "OfferDeviations" WHERE "LoanId"={loan};')
check("API+PG: idempotent raise (same key) -> 1 row", s == 200 and out == "1", (s, out))
dev = r["data"]["deviations"][0]
check("API: approver assigned is not the raiser", dev["assignedApproverId"] != ceo, dev)
s, r = call("POST", f"/api/loans/{loan}/workflow/deviations/{dev['id']}/decide", T_CEO, {"approve": True})
check("API: raiser self-approval refused (403)", s == 403 and r.get("errorCode") == "SELF_APPROVAL", (s, r))
s, r = call("POST", f"/api/loans/{loan}/workflow/deviations/{dev['id']}/decide", T_MGR, {"approve": True})
check("API: BDM cannot decide deviation (403/404)", s in (403, 404), (s, r))
s, r = call("GET", f"/api/loans/{loan}/workflow/deviations/{dev['id']}/eligible-approvers", T_MGR)
check("API: BDM cannot list approvers for reassignment (403/404)", s in (403, 404), (s, r))
s, r = call("GET", f"/api/loans/{loan}/workflow/deviations/{dev['id']}/eligible-approvers", T_ADMIN)
ids = [u["userId"] for u in (r.get("data") or [])]
check("API: eligible approvers exclude the raiser, include the second Chief Admin", s == 200 and ceo not in ids and admin2 in ids, (s, r))
target = admin2 if dev["assignedApproverId"] != admin2 else admin_id
s, r = call("POST", f"/api/loans/{loan}/workflow/deviations/{dev['id']}/reassign", T_ADMIN, {"approverUserId": ceo, "reason": "x"})
check("API: reassign to the raiser refused (400)", s == 400, (s, r))
s, r = call("POST", f"/api/loans/{loan}/workflow/deviations/{dev['id']}/reassign", T_ADMIN, {"approverUserId": target, "reason": "Approver on leave"})
check("API: deviation reassigned", s == 200 and r["data"]["deviations"][0]["assignedApproverId"] == target and r["data"]["deviations"][0]["assignmentState"] == "Reassigned", (s, r))
out, _ = sql(f'SELECT count(*) FILTER (WHERE NOT "IsCompleted" AND "AssignedToUserId"={target}), count(*) FILTER (WHERE "IsCompleted") FROM "Tasks" WHERE "LoanId"={loan} AND NOT "IsDeleted";')
check("PG: approval task moved to the new approver (old one closed)", out.split("|")[0] == "1" and int(out.split("|")[1]) >= 1, out)
T_TARGET = T_ADMIN2 if target == admin2 else T_ADMIN
s, r = call("POST", f"/api/loans/{loan}/workflow/deviations/{dev['id']}/decide", T_TARGET, {"approve": True, "comment": "Approved by reassigned CA"})
check("API: deviation approved -> back to Offer", s == 200 and r["data"]["loanStatus"] == "Offer", (s, r))
out, err = sql(f"UPDATE \"OfferDeviations\" SET \"Reason\"='tampered' WHERE \"Id\"={dev['id']};")
check("PG trigger: decided deviation is final", "is final" in err, err)

s, r = call("POST", f"/api/loans/{loan}/workflow/offers/{ic['id']}/credit-approval", T_CEO, {"decision": "Approve", "revisionNo": 1})
check("API: maker (terms creator) cannot credit-approve (403)", s == 403, (s, r))
s, r = call("POST", f"/api/loans/{loan}/workflow/offers/{ic['id']}/credit-approval", T_ADMIN, {"decision": "Approve", "revisionNo": 1, "comment": "OK"}, str(uuid.uuid4()))
check("API: credit approval -> Approved", s == 200 and r["data"]["loanStatus"] == "Approved", (s, r))
out, _ = sql(f'SELECT "ApprovedAmount","InterestRate","MonthlyEmi" FROM "Loans" WHERE "Id"={loan};')
check("PG: loan approved terms persisted", out == "500000.00|12.00|16607.15", out)
out, err = sql(f'UPDATE "CreditApprovals" SET "Comment"=\'x\' WHERE "LoanId"={loan};')
check("PG trigger: credit approval immutable", "immutable" in err, err)

s, r = call("POST", f"/api/loans/{loan}/workflow/sanctions", T_MGR)
check("API: BDM cannot generate sanction (403/404)", s in (403, 404), (s, r))
s, r = call("POST", f"/api/loans/{loan}/workflow/sanctions", T_CEO, None, "san-" + idem)
check("API: sanction generated", s == 200 and r["data"]["sanctions"][0]["status"] == "Active", (s, r))
san = r["data"]["sanctions"][0]
s, r = call("POST", f"/api/loans/{loan}/workflow/sanctions", T_CEO)
check("API: second active sanction refused (409)", s == 409, (s, r))
out, err = sql(f'UPDATE "Sanctions" SET "LoanAmount"=1 WHERE "Id"={san["id"]};')
check("PG trigger: sanction snapshot immutable", "immutable" in err, err)
out, err = sql(f'DELETE FROM "Sanctions" WHERE "Id"={san["id"]};')
check("PG trigger: sanction delete refused", "immutable" in err, err)
s, r = call("PUT", f"/api/loans/{loan}/sanction-detail", T_ADMIN, {"sanctionLoanAmt": 1})
check("API: sanction-detail edit locked while sanction active (409)", s == 409, (s, r))
s, r = call("PATCH", f"/api/loans/{loan}/approve", T_ADMIN, {})
check("API: retired /approve answers 409 with directions", s == 409 and "Offers" in (r.get("message") or ""), (s, r))
s, r = call("PATCH", f"/api/loans/{loan}/disburse", T_ADMIN, {})
check("API: retired /disburse answers 409", s == 409, (s, r))

net = san["netDisbursement"]
disb = {"amount": net, "disbursementDate": time.strftime("%Y-%m-%dT00:00:00Z"), "bankAccountNumber": "123456789012", "ifsc": "HDFC0001234",
        "accountHolderName": "Asha E2E", "utr": "UTRE2E0001", "lenderReference": "LAN-9", "mode": "NEFT"}
s, r = call("POST", f"/api/loans/{loan}/workflow/disbursements", T_CEO, disb)
check("API: disbursement blocked until NACH + agreement (409)", s == 409 and "Nach" in (r.get("message") or ""), (s, r))
call("PATCH", f"/api/loans/{loan}/overview", T_ADMIN, {"nachDone": True, "customerAgreementDone": True})
s, r = call("POST", f"/api/loans/{loan}/workflow/disbursements", T_CEO, disb)
check("API: disbursement blocked until Bank Details Check is 'Okay to Process' (409)", s == 409 and "not verified" in (r.get("message") or ""), (s, r))
def bank_check(acct, result):
    note = f"Bank Name: HDFC Bank\nAccount Holder Name: Asha E2E\nAccount Number: {acct}\nIFSC Code: HDFC0001234\nCheck Type: Disbursement Account\nResult: {result}"
    return call("POST", f"/api/loans/{loan}/tracking", T_CEO, {"name": "EFIN- Bank Details Check", "stage": "Credit Evaluation Officer", "status": "COMPLETE", "comment": "", "subNote": note})
s, r = bank_check("999988887777", "Okay to Process")
check("API: bank details check posted to the timeline", s in (200, 201), (s, r))
s, r = call("POST", f"/api/loans/{loan}/workflow/disbursements", T_CEO, disb)
check("API: disbursement to an account other than the verified one refused (409)", s == 409 and "does not match" in (r.get("message") or ""), (s, r))
bank_check("123456789012", "Okay to Process")
s, r = call("POST", f"/api/loans/{loan}/workflow/disbursements", T_ACC, disb)
check("API: Payout officer cannot disburse (403)", s == 403, (s, r))
dkey = "disb-" + idem
s, r = call("POST", f"/api/loans/{loan}/workflow/disbursements", T_CEO, disb, dkey)
check("API: disbursed", s == 200 and r["data"]["loanStatus"] == "Disbursed", (s, r))
s, r = call("POST", f"/api/loans/{loan}/workflow/disbursements", T_CEO, disb, dkey)
out, _ = sql(f'SELECT count(*) FROM "Disbursements" WHERE "LoanId"={loan};')
check("API+PG: idempotent disbursement replay -> 1 row", s == 200 and out == "1", (s, out))
s, r = call("POST", f"/api/loans/{loan}/workflow/disbursements", T_CEO, disb, "other-key")
check("API: second disbursement refused (409)", s == 409, (s, r))
d = r and call("GET", f"/api/loans/{loan}/workflow", T_ADMIN)[1]["data"]["disbursements"][0]
check("API: account masked in response", d["bankAccountNumber"] == "XXXXXXXX9012", d)
out, err = sql(f'UPDATE "Disbursements" SET "Amount"=1 WHERE "LoanId"={loan};')
check("PG trigger: disbursement amount immutable", "immutable" in err, err)
s, r = call("POST", f"/api/loans/{loan}/workflow/sanctions/{san['id']}/cancel", T_CEO, {"reason": "x", "cancellationType": "Revoke"})
check("API: disbursed sanction cannot be revoked (409)", s == 409, (s, r))
s, r = call("POST", f"/api/loans/{loan}/workflow/disbursements/{d['id']}/reverse", T_ADMIN, {"reason": "Wrong beneficiary"})
check("API: disbursement reversed -> Approved", s == 200 and r["data"]["loanStatus"] == "Approved", (s, r))
out, _ = sql(f'SELECT string_agg("Type"||\':\'||"Status", \',\' ORDER BY "Id") FROM "Disbursements" WHERE "LoanId"={loan};')
check("PG: original kept (Reversed) + reversal row", out == "Disbursement:Reversed,Reversal:Completed", out)

# Timeline / history / audit persisted
out, _ = sql(f'SELECT string_agg(DISTINCT "Name", \',\') FROM "TrackingEntries" WHERE "LoanId"={loan};')
for n in ["EFIN-Offer Created", "EFIN-Offer Selected", "EFIN-Deviation", "EFIN-Approved Deviation", "EFIN-Approved", "EFIN-Sanction Generated", "EFIN-Disbursed", "EFIN-Disbursement Reversed",
          "EFIN-Bureau Report Uploaded", "EFIN-Deviation Re-evaluated", "EFIN-Deviation Reassigned"]:
    check(f"PG timeline: {n}", n in out, out)
out, _ = sql(f'SELECT string_agg("ToStatus", \'>\' ORDER BY "Id") FROM "LoanStatusHistories" WHERE "LoanId"={loan};')
check("PG history: ...UnderReview>Offer>Decision>Offer>Approved>Disbursed>Approved", out.endswith("UnderReview>Offer>Decision>Offer>Approved>Disbursed>Approved"), out)
out, _ = sql(f"SELECT count(*) FROM \"AuditLogs\" WHERE \"EntityName\" IN ('Loan','ApplicationOffer','OfferDeviation','Sanction','Disbursement','CreditApproval') AND \"UserId\" IS NOT NULL;")
check("PG audit rows written", int(out) >= 8, out)

# Rule versioning on PG
s, r = call("POST", f"/api/deviation-rules/{icici_rule}/versions", T_ADMIN, {"name": "ICICI ROI floor 13.5", "bankId": ICICI, "deviationType": "ROI", "metric": "ROI_MIN_PCT",
    "limitValue": 13.5, "priority": 10, "effectiveFrom": "2026-01-01T00:00:00Z", "approvalRequired": True, "conditions": [], "changeReason": "Committee"})
check("API: rule new version", s == 200 and r["data"]["version"] == 2, (s, r))
out, err = sql(f'UPDATE "DeviationRules" SET "LimitValue"=1 WHERE "Id"={icici_rule};')
check("PG trigger: rule version content immutable", "immutable" in err, err)

# ── Concurrency on real PostgreSQL: two users confirm different offers at the same instant ──
import threading
s, r = call("POST", "/api/customers", T_ADMIN, {"fullName": "Race E2E", "email": f"race{RUN}@x.test", "phone": "97" + str(int(time.time()))[-8:],
    "panNumber": "RACEK" + RUN[-4:] + "Z", "monthlyIncome": 90000, "employmentType": "SALARIED"})
cust2 = r["data"]["id"]
s, r = call("POST", "/api/loans", T_ADMIN, {"customerId": cust2, "loanType": "Personal", "requestedAmount": 300000, "interestRate": 12, "tenureMonths": 24, "loginUserId": ceo})
loan2 = r["data"]["id"]
call("PATCH", f"/api/loans/{loan2}/submit", T_ADMIN)
call("PUT", f"/api/loans/{loan2}/bank-lines", T_ADMIN, {"bankLines": [{"bankName": f"E2E HDFC {RUN}", "tempApplicationNumber": "T2", "applicationNumber": "APP2", "approvedLoan": 300000}]})
call("PATCH", f"/api/loans/{loan2}/status", T_ADMIN, {"newStatus": "UnderReview"})
call("PATCH", f"/api/loans/{loan2}/overview", T_ADMIN, {"documentChecked": True, "bankChecked": True, "ecsReturn": True, "fiReportChecked": True})
sql(f'UPDATE "Loans" SET "IncomeChecked"=true WHERE "Id"={loan2};')
call("POST", f"/api/loans/{loan2}/workflow/move-to-offer", T_CEO, {})
for b in (HDFC, IDFC):
    call("POST", f"/api/loans/{loan2}/workflow/offers", T_CEO, {"bankId": b, "loanAmount": 300000, "tenureMonths": 24, "baseRoi": 13, "offeredRoi": 12,
        "processingFeePct": 1, "gstPct": 18, "insuranceAmount": 0, "btAmount": 0, "stampDuty": 0})
o2 = call("GET", f"/api/loans/{loan2}/workflow", T_ADMIN)[1]["data"]["offers"]
# A rule change re-checks live offers of THAT lender on Offer-stage applications
s, r = call("POST", f"/api/deviation-rules/{idfc_cibil_rule}/versions", T_ADMIN, {"name": "IDFC bureau CIBIL 760", "bankId": IDFC, "deviationType": "CIBIL", "metric": "CIBIL_MIN",
    "limitValue": 760, "priority": 10, "effectiveFrom": "2026-01-01T00:00:00Z", "approvalRequired": True, "conditions": [], "changeReason": "Policy"})
check("API: IDFC CIBIL rule v2", s == 200 and r["data"]["version"] == 2, (s, r))
out, _ = sql(f'SELECT string_agg("BankId"::text||\':\'||("LatestEvaluatedAt" IS NOT NULL)::text, \',\' ORDER BY "BankId") FROM "ApplicationOffers" WHERE "LoanId"={loan2};')
check("PG: rule change re-evaluated only the IDFC offer", out == f"{HDFC}:false,{IDFC}:true", out)
out, _ = sql(f"SELECT count(*) FROM \"TrackingEntries\" WHERE \"LoanId\"={loan2} AND \"Name\"='EFIN-Deviation Re-evaluated';")
check("PG: no timeline noise when the outcome did not change", out == "0", out)

# Hold pauses the application's open tasks; complete refused; unhold resumes
s, r = call("POST", "/api/tasks", T_ADMIN, {"title": "E2E collect PD", "loanId": loan2, "assignedToUserId": ceo, "priority": "Medium"})
check("API: task created on loan2", s in (200, 201), (s, r))
task_id = int(sql(f'SELECT max("Id") FROM "Tasks" WHERE "LoanId"={loan2};')[0])
s, r = call("PATCH", f"/api/loans/{loan2}/hold", T_ADMIN, {"reason": "Customer travelling"})
check("API: loan2 on hold", s == 200, (s, r))
out, _ = sql(f'SELECT "PausedAt" IS NOT NULL, "PauseReason" FROM "Tasks" WHERE "Id"={task_id};')
check("PG: open task paused with the hold reason", out.startswith("t|") and "Customer travelling" in out, out)
s, r = call("PATCH", f"/api/tasks/{task_id}/complete", T_CEO)
check("API: paused task cannot be completed (409)", s == 409, (s, r))
s, r = call("PATCH", f"/api/loans/{loan2}/unhold", T_ADMIN, {"reason": "Back"})
out, _ = sql(f'SELECT "PausedAt" IS NULL FROM "Tasks" WHERE "Id"={task_id};')
check("API+PG: unhold resumes the task", s == 200 and out == "t", (s, out))
o2 = call("GET", f"/api/loans/{loan2}/workflow", T_ADMIN)[1]["data"]["offers"]
codes = []
def sel(oid, tok):
    codes.append(call("POST", f"/api/loans/{loan2}/workflow/offers/{oid}/select", tok, {})[0])
th = [threading.Thread(target=sel, args=(o2[0]["id"], T_ADMIN)), threading.Thread(target=sel, args=(o2[1]["id"], T_CEO))]
[t.start() for t in th]; [t.join() for t in th]
out, _ = sql(f"SELECT count(*) FROM \"ApplicationOffers\" WHERE \"LoanId\"={loan2} AND \"Status\"='Final';")
check("PG concurrency: 2 simultaneous selections -> exactly one wins (200 + 409), one Final row", sorted(codes) == [200, 409] and out == "1", (codes, out))
# Idempotent sanction replay under concurrency is covered by the unique IdempotencyKey index:
out, _ = sql("SELECT count(*) FROM pg_indexes WHERE indexname LIKE '%IdempotencyKey%' AND tablename IN ('OfferDeviations','CreditApprovals','Sanctions','Disbursements');")
check("PG: idempotency-key unique indexes present (5)", out == "5", out)

print()
passed = sum(1 for _, ok in RESULTS if ok)
print(f"RESULT: {passed}/{len(RESULTS)} passed on real PostgreSQL (loan id {loan})")
sys.exit(0 if passed == len(RESULTS) else 1)
