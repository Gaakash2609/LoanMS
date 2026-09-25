#!/usr/bin/env python3
"""LoanMS customer-duplicate / re-application / archive — API end-to-end on REAL PostgreSQL.

Runs against the API (http://127.0.0.1:5199) backed by PostgreSQL DB loanms_dup_e2e.
Every check prints PASS/FAIL; DB state is asserted with psql, not just re-read via the API.
"""
import json, subprocess, sys, threading, time, urllib.request, urllib.error, random

BASE = "http://127.0.0.1:5199"
DB = ["psql", "-h", "127.0.0.1", "-p", "5433", "-U", "loanms", "-d", "loanms_dup_e2e", "-X", "-q", "-At", "-c"]
RESULTS = []
STATUS_LOG = []
RUN = random.randint(1000, 9999)  # keeps identifiers unique per run


def sql(q):
    out = subprocess.run(DB + [q], capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(out.stderr)
    return out.stdout.strip()


def call(method, path, token=None, body=None, xff=None, raw=False):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    if xff:
        req.add_header("X-Forwarded-For", xff)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            status, text = r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        status, text = e.code, e.read().decode("utf-8", "replace")
    STATUS_LOG.append((method, path, status))
    if raw:
        return status, text
    try:
        return status, json.loads(text) if text else {}
    except ValueError:
        return status, {"_raw": text}


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else "   -> " + str(detail)[:600]))


def login(email, passwords, ip):
    for pw in passwords:
        s, b = call("POST", "/api/auth/login", body={"email": email, "password": pw}, xff=ip)
        if s == 200 and b.get("data", {}).get("accessToken"):
            return b["data"]["accessToken"]
    raise RuntimeError(f"login failed for {email}: {s} {b}")


def pan(tag):  # valid PAN: 5 letters, 4 digits, 1 letter
    return f"{tag[:5].upper():A<5}"[:5] + f"{RUN:04d}" + "Z"


def wiz(name, mobile, pan_, email, sales="Default Sales", loan_id=None, loc=None):
    d = {"fullName": name, "mobile": mobile, "pan": pan_, "email": email, "amount": 300000,
         "loanType": "personal_loan", "loanRate": 12, "tenure": 24, "salesPerson": sales}
    if loan_id:
        d["loanId"] = loan_id
    if loc:
        d["locationId"] = loc
    return d


def backdate(loan_id, interval):
    """Move a rejection into the past: RejectedAt AND its history transition together."""
    sql(f'update "Loans" set "RejectedAt" = now() - interval \x27{interval}\x27 where "Id"={loan_id}')
    sql(f'update "LoanStatusHistories" set "CreatedAt" = now() - interval \x27{interval}\x27 where "LoanId"={loan_id} and "ToStatus"=\x27Rejected\x27')


def err(b):
    return (b.get("errorCode") or "", " ".join(b.get("errors") or []) or b.get("message") or "")


def main():
    loc_pune = int(sql('select min("Id") from "Locations" where "Code"=\'E2EPUN\''))
    tok = {
        "admin": login("admin@efin.com", ["Admin@123"], "10.9.0.1"),
        "manager": login("manager@efin.com", ["Manager@123", "Admin@123"], "10.9.0.2"),
        "sales": login("sales@efin.com", ["Sales@123", "Admin@123"], "10.9.0.3"),
        "sales2": login("sales2@e2e.test", ["Admin@123"], "10.9.0.4"),
        "zonal": login("zonal@e2e.test", ["Admin@123"], "10.9.0.5"),
        "risk": login("risk@e2e.test", ["Admin@123"], "10.9.0.6"),
    }
    uid = {k: int(sql(f'select "Id" from "Users" where "Email"=\'{e}\'')) for k, e in
           [("admin", "admin@efin.com"), ("zonal", "zonal@e2e.test"), ("sales", "sales@efin.com")]}
    print(f"run={RUN} logged in: {', '.join(tok)}")

    # ── B. Duplicate application: global identity, every path ─────────────────
    P1, M1 = pan("ALPHA"), f"98{RUN:04d}0001"
    s, b = call("POST", "/api/wizard/submit", tok["sales"], wiz("Alpha One", M1, P1, f"alpha{RUN}@e2e.test", loc=loc_pune))
    check("B1 first application for a new customer → 200", s == 200, (s, b))
    L1 = b.get("data", {}).get("loanId")
    L1num = b.get("data", {}).get("loanNumber")

    s, b = call("POST", "/api/wizard/submit", tok["sales2"],
                wiz("Alpha Typed Diff", M1, " " + P1.lower() + " ", f"other{RUN}@e2e.test", sales="E2E Other Sales"))
    code, msg = err(b)
    check("B2 other user, same PAN (lower/space) + same mobile → 409 ACTIVE_APPLICATION_EXISTS",
          s == 409 and code == "ACTIVE_APPLICATION_EXISTS", (s, b))
    check("B2b message is user-friendly and hides another user's application number",
          msg.startswith("Active application exists") and L1num not in msg, msg)

    s, b = call("POST", "/api/wizard/draft", tok["sales2"],
                wiz("Alpha Draft", M1, P1, f"other{RUN}@e2e.test", sales="E2E Other Sales"))
    check("B3 draft autosave for the same customer → 409", s == 409 and err(b)[0] == "ACTIVE_APPLICATION_EXISTS", (s, b))

    s, b = call("GET", f"/api/loans/duplicate-check?pan={P1.lower()}", tok["sales2"])
    d = b.get("data", {})
    check("B4 duplicate-check (UX) reports the block, no loan number for another user",
          s == 200 and d.get("hasDuplicate") and not d.get("loanNumber"), (s, b))

    cust1 = int(sql(f'select "Id" from "Customers" where "PanNormalized"=\'{P1}\''))
    s, b = call("POST", "/api/loans", tok["admin"], {"customerId": cust1, "requestedAmount": 100000,
                                                      "interestRate": 12, "tenureMonths": 12, "loanType": "Personal"})
    check("B5 POST /api/loans for a customer with an active application → 409", s == 409, (s, b))

    s, b = call("GET", f"/api/customers/check-pan?pan={P1.lower()}", tok["sales2"])
    txt = json.dumps(b)
    check("B6 check-pan is global + normalised, and returns no customer data",
          s == 200 and b["data"]["exists"] and b["data"]["matchStatus"] == "match" and "Alpha" not in txt and "alpha" not in txt, (s, b))
    s, b = call("GET", f"/api/customers/check-mobile?mobile=%2B91{M1}", tok["sales2"])
    check("B7 check-mobile (normalised +91) → exists", s == 200 and b["data"]["exists"], (s, b))
    check("B8 exactly one customer for PAN P1", sql(f'select count(*) from "Customers" where "PanNormalized"=\'{P1}\'') == "1")
    check("B9 blocked submit was audited (ApplicationBlocked)",
          int(sql('select count(*) from "AuditLogs" where "Action"=\'ApplicationBlocked\'')) >= 1)

    # ── C. RejectedAt server-side + 45-day rule ────────────────────────────────
    s, b = call("PATCH", f"/api/loans/{L1}/reject", tok["admin"], {"reason": "policy", "rejectedAt": "2020-01-01T00:00:00Z"})
    check("C1 reject → 200", s == 200, (s, b))
    age = float(sql(f'select extract(epoch from now()-"RejectedAt") from "Loans" where "Id"={L1}'))
    check("C2 RejectedAt set server-side NOW (payload's 2020 date ignored)", 0 <= age < 120, age)

    s, b = call("POST", "/api/wizard/submit", tok["sales2"], wiz("Alpha Again", M1, P1, f"alpha{RUN}@e2e.test", sales="E2E Other Sales"))
    code, msg = err(b)
    check("C3 new application right after rejection → 409 REAPPLY_COOLDOWN with date",
          s == 409 and code == "REAPPLY_COOLDOWN" and "Re-application allowed after" in msg and "IST" in msg, (s, b))

    backdate(L1, "44 days")
    s, b = call("POST", "/api/wizard/submit", tok["sales2"], wiz("Alpha Again", M1, P1, f"alpha{RUN}@e2e.test", sales="E2E Other Sales"))
    check("C4 day 44 after rejection → still 409", s == 409 and err(b)[0] == "REAPPLY_COOLDOWN", (s, b))

    backdate(L1, "45 days 1 minute")
    s, b = call("POST", "/api/wizard/submit", tok["sales2"], wiz("Alpha Again", M1, P1, f"alpha{RUN}@e2e.test", sales="E2E Other Sales"))
    check("C5 45 days after rejection → 200", s == 200, (s, b))
    L2 = b.get("data", {}).get("loanId")
    check("C6 re-application reused the SAME customer (no duplicate)",
          sql(f'select count(*) from "Customers" where "PanNormalized"=\'{P1}\'') == "1"
          and sql(f'select count(*) from "Loans" where "CustomerId"={cust1}') == "2")

    # ── D. Archive ──────────────────────────────────────────────────────────────
    s, b = call("PATCH", f"/api/loans/{L1}/archive", tok["sales"], {"reason": "x"})
    check("D1 Sales archive → 403", s == 403, (s, b))
    s, b = call("PATCH", f"/api/loans/{L1}/archive", tok["manager"], {"reason": "x"})
    check("D1b Manager archive → 403", s == 403, (s, b))
    s, b = call("PATCH", f"/api/loans/{L2}/archive", tok["admin"], {"reason": "x"})
    check("D2 archive an ACTIVE application → 409 ARCHIVE_NOT_ALLOWED", s == 409 and err(b)[0] == "ARCHIVE_NOT_ALLOWED", (s, b))
    s, b = call("PATCH", f"/api/loans/{L1}/archive", tok["admin"], {"reason": "   "})
    check("D3 archive without a reason → 400", s == 400 and err(b)[0] == "REASON_REQUIRED", (s, b))
    s, b = call("PATCH", f"/api/loans/{L1}/archive", tok["risk"], {"reason": "x"})
    check("D4 ProductTeam → 404 (existing RBAC: ProductTeam has no loan visibility)", s == 404, (s, b))
    s, b = call("PATCH", f"/api/loans/{L1}/archive", tok["zonal"], {"reason": "Duplicate lead (e2e)"})
    check("D5 Zonal Manager (own location) archives the rejected application → 200", s == 200, (s, b))
    row = sql(f'select "IsArchived","ArchivedByUserId","ArchiveReason","Status",("RejectedAt" is not null) from "Loans" where "Id"={L1}')
    check("D6 archive persisted in DB (flag, who, reason); status + RejectedAt untouched",
          row == f"t|{uid['zonal']}|Duplicate lead (e2e)|Rejected|t", row)
    check("D7 audit row (who/why) + timeline row written",
          sql(f'select count(*) from "AuditLogs" where "Action"=\'Archived\' and "EntityId"=\'{L1}\' and "UserId"={uid["zonal"]} and "Reason"=\'Duplicate lead (e2e)\'') == "1"
          and sql(f'select count(*) from "LoanStatusHistories" where "LoanId"={L1} and "Comment" like \'[ARCHIVED]%\'') == "1")
    s, b = call("PATCH", f"/api/loans/{L1}/archive", tok["admin"], {"reason": "again"})
    check("D8 archive twice → 409", s == 409, (s, b))

    s, b = call("GET", "/api/loans?pageSize=100", tok["admin"])
    ids = [i["id"] for i in b["data"]["items"]]
    check("D9 default list (another user) hides the archived application", L1 not in ids and L2 in ids, ids)
    s, b = call("GET", "/api/loans?pageSize=100&archived=only", tok["admin"])
    ids = [i["id"] for i in b["data"]["items"]]
    check("D10 Archived view lists it", L1 in ids and L2 not in ids and all(i["isArchived"] for i in b["data"]["items"]), ids)
    s, t = call("GET", "/api/loans/export", tok["admin"], raw=True)
    s2, t2 = call("GET", "/api/loans/export?archived=only", tok["admin"], raw=True)
    check("D11 export excludes archived; archived export includes it", s == 200 and L1num not in t and s2 == 200 and L1num in t2)
    s, b = call("GET", "/api/loans/dashboard", tok["admin"])
    arch = int(sql('select count(*) from "Loans" where "IsArchived"'))
    total_ops = int(sql('select count(*) from "Loans" where not "IsDeleted" and not "IsArchived"'))
    check("D12 dashboard totals exclude archived", b["data"]["totalLoans"] == total_ops and arch >= 1, (b["data"]["totalLoans"], total_ops))
    s, b = call("GET", "/api/loans/%d" % L1, tok["admin"])
    check("D13 archived application still opens (history view) with archive info",
          s == 200 and b["data"]["isArchived"] and b["data"]["archiveReason"] == "Duplicate lead (e2e)" and b["data"]["archivedByName"], (s, b.get("data", {}).get("archivedByName")))
    s, b = call("PATCH", f"/api/loans/{L1}/reopen", tok["admin"], {"reason": "x"})
    check("D14 archived application cannot be re-opened → 409", s == 409, (s, b))
    s, b = call("GET", "/api/reports/summary", tok["admin"])
    check("D15 reports endpoint works with the archive scope", s == 200, s)

    # Archive must NOT reset the cooldown: fresh customer, reject, archive, re-apply.
    P2, M2 = pan("BRAVO"), f"98{RUN:04d}0002"
    s, b = call("POST", "/api/wizard/submit", tok["sales"], wiz("Bravo", M2, P2, f"bravo{RUN}@e2e.test", loc=loc_pune))
    LB = b["data"]["loanId"]
    call("PATCH", f"/api/loans/{LB}/reject", tok["admin"], {"reason": "x"})
    s, b = call("PATCH", f"/api/loans/{LB}/archive", tok["admin"], {"reason": "cleanup"})
    s2, b2 = call("POST", "/api/wizard/submit", tok["sales"], wiz("Bravo", M2, P2, f"bravo{RUN}@e2e.test"))
    check("D16 archived + rejected < 45 days → new application still 409", s == 200 and s2 == 409 and err(b2)[0] == "REAPPLY_COOLDOWN", (s, s2, b2))
    backdate(LB, "46 days")
    s2, b2 = call("POST", "/api/wizard/submit", tok["sales"], wiz("Bravo", M2, P2, f"bravo{RUN}@e2e.test"))
    check("D17 archived + rejected ≥ 45 days → 200", s2 == 200, (s2, b2))

    # Only-archived (closed) → allowed immediately.
    P3, M3 = pan("CHARL"), f"98{RUN:04d}0003"
    s, b = call("POST", "/api/wizard/submit", tok["sales"], wiz("Charlie", M3, P3, f"charlie{RUN}@e2e.test"))
    LC = b["data"]["loanId"]
    call("PATCH", f"/api/loans/{LC}/override-status", tok["admin"], {"newStatus": "Closed", "reason": "e2e close"})
    s, b = call("PATCH", f"/api/loans/{LC}/archive", tok["admin"], {"reason": "closed file"})
    s2, b2 = call("POST", "/api/wizard/submit", tok["sales"], wiz("Charlie", M3, P3, f"charlie{RUN}@e2e.test"))
    check("D18 only archived CLOSED application → new application allowed immediately", s == 200 and s2 == 200, (s, b, s2, b2))
    LC2 = b2["data"]["loanId"]
    s, b = call("PATCH", f"/api/loans/{LC}/override-status", tok["admin"], {"newStatus": "Submitted", "reason": "x"})
    check("D19 archived + another active: archived one can't be reactivated → 409", s == 409, (s, b))

    # ── E. Customer conflict / needs review ────────────────────────────────────
    P4, M4 = pan("DELTA"), f"98{RUN:04d}0004"
    P5, M5 = pan("ECHOO"), f"98{RUN:04d}0005"
    call("POST", "/api/wizard/submit", tok["sales"], wiz("Delta", M4, P4, f"delta{RUN}@e2e.test"))
    call("POST", "/api/wizard/submit", tok["sales"], wiz("Echo", M5, P5, f"echo{RUN}@e2e.test"))
    before = sql('select count(*) from "Customers"')
    s, b = call("POST", "/api/wizard/submit", tok["sales2"], wiz("Mixed", M5, P4, f"mixed{RUN}@e2e.test", sales="E2E Other Sales"))
    check("E1 PAN of one customer + mobile of another → 409 CUSTOMER_NEEDS_REVIEW",
          s == 409 and err(b)[0] == "CUSTOMER_NEEDS_REVIEW" and "admin review" in err(b)[1], (s, b))
    check("E2 nothing merged / no new customer; both records unchanged",
          sql('select count(*) from "Customers"') == before
          and sql(f'select "PhoneNormalized" from "Customers" where "PanNormalized"=\'{P4}\'') == M4
          and sql(f'select "PanNormalized" from "Customers" where "PhoneNormalized"=\'{M5}\'') == P5)
    check("E3 needs-review attempt audited (identifiers masked)",
          sql(f'select count(*) from "AuditLogs" where "Action"=\'CustomerNeedsReview\' and "NewValues" not like \'%{P4}%\'') != "0")

    # Soft-deleted customer → needs review, not resurrected.
    P6, M6 = pan("FOXTR"), f"98{RUN:04d}0006"
    sql(f'insert into "Customers" ("FullName","Email","Phone","PanNumber","PanNormalized","PhoneNormalized","CreatedAt","IsDeleted") '
        f'values (\'Old Deleted\',\'olddel{RUN}@e2e.test\',\'{M6}\',\'{P6}\',\'{P6}\',\'{M6}\',now(),true)')
    s, b = call("POST", "/api/wizard/submit", tok["admin"], wiz("Old Deleted", M6, P6, f"olddel{RUN}@e2e.test"))
    check("E4 soft-deleted customer match → 409 needs review, record stays deleted",
          s == 409 and err(b)[0] == "CUSTOMER_NEEDS_REVIEW" and sql(f'select "IsDeleted" from "Customers" where "PanNormalized"=\'{P6}\'') == "t", (s, b))

    # ── F. Draft resume / soft-delete / delete paths ───────────────────────────
    P7, M7 = pan("GOLFF"), f"98{RUN:04d}0007"
    s, b = call("POST", "/api/wizard/draft", tok["sales"], wiz("Golf", M7, P7, f"golf{RUN}@e2e.test"))
    D7 = b["data"]["loanId"]
    c7 = int(sql(f'select "CustomerId" from "Loans" where "Id"={D7}'))
    sql(f'insert into "Loans" ("LoanNumber","LoanType","Status","RequestedAmount","InterestRate","TenureMonths","CustomerId","CreatedByUserId","CreatedAt","IsDeleted","RejectedAt") '
        f'values (\'E2EREJ{RUN}\',\'Personal\',\'Rejected\',1,1,1,{c7},1,now(),false,now()-interval \'5 days\')')
    s, b = call("POST", "/api/wizard/submit", tok["sales"], wiz("Golf", M7, P7, f"golf{RUN}@e2e.test", loan_id=D7))
    check("F1 resuming an old draft cannot bypass a 5-day-old rejection → 409", s == 409 and err(b)[0] == "REAPPLY_COOLDOWN", (s, b))
    sql(f'update "Loans" set "IsDeleted"=true where "LoanNumber"=\'E2EREJ{RUN}\'')
    s, b = call("POST", "/api/wizard/submit", tok["sales"], wiz("Golf", M7, P7, f"golf{RUN}@e2e.test", loan_id=D7))
    check("F2 soft-deleting the rejected application does NOT lift the cooldown → 409", s == 409 and err(b)[0] == "REAPPLY_COOLDOWN", (s, b))
    s, b = call("DELETE", f"/api/customers/{c7}", tok["admin"])
    check("F3a permanent customer delete with an active draft → refused (existing rule)", s == 400 and "active loans" in err(b)[1], (s, b))
    s, b = call("DELETE", f"/api/loans/{D7}", tok["sales"])
    check("F4 discarding the draft (soft delete) → 200", s == 200, (s, b))
    s, b = call("GET", f"/api/loans/duplicate-check?pan={P7}", tok["sales"])
    check("F5 soft-deleted DRAFT no longer counts as active (still cooldown from rejection)",
          b["data"].get("code") == "REAPPLY_COOLDOWN", b)
    s, b = call("DELETE", f"/api/customers/{c7}", tok["admin"])
    check("F3b permanent customer delete refused inside the 45-day window (new rule)",
          s == 400 and "45-day" in err(b)[1] and sql(f'select count(*) from "Customers" where "Id"={c7}') == "1", (s, b))

    # ── G. Status transitions recalculate ──────────────────────────────────────
    P8, M8 = pan("HOTEL"), f"98{RUN:04d}0008"
    s, b = call("POST", "/api/wizard/submit", tok["sales"], wiz("Hotel", M8, P8, f"hotel{RUN}@e2e.test"))
    L8 = b["data"]["loanId"]
    call("PATCH", f"/api/loans/{L8}/override-status", tok["admin"], {"newStatus": "Disbursed", "reason": "e2e"})
    s, b = call("POST", "/api/wizard/submit", tok["sales"], wiz("Hotel", M8, P8, f"hotel{RUN}@e2e.test"))
    check("G1 Disbursed (running loan) blocks a new application", s == 409 and err(b)[0] == "ACTIVE_APPLICATION_EXISTS", (s, b))
    call("PATCH", f"/api/loans/{L8}/override-status", tok["admin"], {"newStatus": "Closed", "reason": "e2e"})
    s, b = call("POST", "/api/wizard/submit", tok["sales"], wiz("Hotel", M8, P8, f"hotel{RUN}@e2e.test"))
    check("G2 after Close a new application is allowed at once", s == 200, (s, b))
    L8b = b["data"]["loanId"]
    call("PATCH", f"/api/loans/{L8b}/reject", tok["admin"], {"reason": "x"})
    s, b = call("PATCH", f"/api/loans/{L8b}/reopen", tok["admin"], {"reason": "wrong reject"})
    check("G3 reopen → 200 and RejectedAt history kept",
          s == 200 and sql(f'select ("RejectedAt" is not null) || \'|\' || "Status" from "Loans" where "Id"={L8b}') == "true|Submitted", (s, b))
    s, b = call("PATCH", f"/api/loans/{L8}/override-status", tok["admin"], {"newStatus": "Submitted", "reason": "x"})
    check("G4 admin override Closed→active while another is active → 409", s == 409, (s, b))

    # ── H. Concurrency ─────────────────────────────────────────────────────────
    P9, M9 = pan("INDIA"), f"98{RUN:04d}0009"
    variants = [M9]  # Submit enforces the wizard 10-digit format; formatted variants go through the draft path (H4)
    users = [("sales", "Default Sales"), ("sales2", "E2E Other Sales"), ("admin", "Default Sales")]
    out, lock = [], threading.Lock()

    def fire(i):
        u, sp = users[i % len(users)]
        pan_v = P9 if i % 2 == 0 else " " + P9.lower() + " "
        s, b = call("POST", "/api/wizard/submit", tok[u], wiz(f"India {i}", variants[i % len(variants)], pan_v, f"india{RUN}@e2e.test", sales=sp))
        with lock:
            out.append((s, err(b)[0]))
    th = [threading.Thread(target=fire, args=(i,)) for i in range(12)]
    [t.start() for t in th]; [t.join() for t in th]
    ok = sum(1 for s, _ in out if s == 200); conflict = sum(1 for s, _ in out if s == 409); bad = [x for x in out if x[0] >= 500]
    check(f"H1 12 parallel submits, brand-new customer → exactly 1×200, 11×409, 0×5xx (got {ok}/{conflict}/{len(bad)})",
          ok == 1 and conflict == 11 and not bad, out)
    check("H2 DB: exactly one customer and one active application for that person",
          sql(f'select count(*) from "Customers" where "PanNormalized"=\'{P9}\' or "PhoneNormalized"=\'{M9}\'') == "1"
          and sql(f'select count(*) from "Loans" l join "Customers" c on c."Id"=l."CustomerId" where c."PanNormalized"=\'{P9}\' and not l."IsDeleted" and l."Status" not in (\'Rejected\',\'Closed\')') == "1")

    cid = int(sql(f'select "Id" from "Customers" where "PanNormalized"=\'{P3}\''))
    sql(f'update "Loans" set "Status"=\'Closed\' where "Id"={LC2}')   # free the customer's active slot
    out2 = []

    def fire2(i):
        s, b = call("POST", "/api/loans", tok["admin"], {"customerId": cid, "requestedAmount": 50000 + i,
                                                         "interestRate": 12, "tenureMonths": 12, "loanType": "Personal"})
        with lock:
            out2.append(s)
    th = [threading.Thread(target=fire2, args=(i,)) for i in range(10)]
    [t.start() for t in th]; [t.join() for t in th]
    check(f"H3 10 parallel POST /api/loans for one customer → 1×201, 9×409 (got {sorted(out2)})",
          out2.count(201) == 1 and out2.count(409) == 9, out2)

    P10, M10 = pan("JULIE"), f"98{RUN:04d}0010"
    out3 = []

    def fire3(i):
        u, sp = users[i % len(users)]
        s, b = call("POST", "/api/wizard/draft", tok[u], wiz(f"Juliet {i}", [M10, "+91" + M10, "0" + M10, M10[:5] + " " + M10[5:]][i % 4], P10, f"juliet{RUN}@e2e.test", sales=sp))
        with lock:
            out3.append(s)
    th = [threading.Thread(target=fire3, args=(i,)) for i in range(8)]
    [t.start() for t in th]; [t.join() for t in th]
    check(f"H4 8 parallel NEW drafts for one person → 1×200, 7×409 (got {sorted(out3)})", out3.count(200) == 1 and out3.count(409) == 7, out3)
    check("H5 DB: one customer, one draft",
          sql(f'select count(*) from "Customers" where "PanNormalized"=\'{P10}\'') == "1"
          and sql(f'select count(*) from "Loans" l join "Customers" c on c."Id"=l."CustomerId" where c."PanNormalized"=\'{P10}\' and not l."IsDeleted"') == "1")

    # ── Z. Never a raw 500 ─────────────────────────────────────────────────────
    fives = [x for x in STATUS_LOG if x[2] >= 500]
    check(f"Z1 no 5xx in {len(STATUS_LOG)} API calls", not fives, fives)

    passed = sum(1 for _, ok in RESULTS if ok)
    print(f"\nSUMMARY: {passed}/{len(RESULTS)} checks passed")
    sys.exit(0 if passed == len(RESULTS) else 1)


if __name__ == "__main__":
    main()
