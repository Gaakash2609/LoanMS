# LoanMS — Deploy notes

## Release 2026-09-26 — Offer → Deviation → Credit Approval → Sanction → Disbursement (DEPLOYED)

Deployed to production on 2026-09-26 as ECS task definition **`loanms-prod:94`**, image
`loanms:offerworkflow-20260926`. Full record: §6 of
[LOANMS_OFFER_TO_DISBURSEMENT_FINAL_REPORT_2026-09-25.md](LOANMS_OFFER_TO_DISBURSEMENT_FINAL_REPORT_2026-09-25.md).

- **Backup taken first:** RDS snapshot `loanms-pre-offerworkflow-20260926-0350`.
- **Migrations:** `20260925041918_AddOfferWorkflowAndStatusChecks` and
  `20260925091531_AddBureauUploadOfferValidityTaskPause`, applied by the API at start-up. For a manual
  run use `deploy/migrations/20260925_OfferWorkflow_Complete.idempotent.sql` (safe to run twice). The first
  migration refuses to run if any application or status-history row holds a status outside `LoanStatus`
  (e.g. NI / Cancelled).
- **Rollback:** `update-service` back to `loanms-prod:93`, but only before any application reaches the new
  `Offer` stage; the previous version cannot read that status. After that, fix forward.
- **Still to do by the owner:** sign in to production and open a loan's **Offers** tab; set each lender's
  "Offer validity (days)" in Lender Configuration; create the lender deviation rules (Policy & Product →
  Deviation Rules). Until a lender has rules, its offers go to manual review.

## How to deploy this package again

Build and push from the folder that contains `LoanMS.slnx` (use a clean copy: no `node_modules`, `bin` or
`obj`, because the Dockerfile copies the folders as they are):

```bash
aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin 664418956749.dkr.ecr.ap-south-1.amazonaws.com
docker buildx build --platform linux/amd64 -f deploy/docker/Dockerfile -t 664418956749.dkr.ecr.ap-south-1.amazonaws.com/loanms:<tag> --push .
```

Register a new revision copied from the **currently running** task definition with only the image changed,
then `aws ecs update-service --region ap-south-1 --cluster loanms-prod --service loanms-api --task-definition loanms-prod:<new-revision>`.

---

# Earlier release — audit release, 2026-09-23

This package is `LoanMS-Debug.zip` (received 2026-09-23) plus the audit
commits recorded in [AUDIT_PROGRESS.md](AUDIT_PROGRESS.md). Every fix, its root
cause and how it was verified is listed there.

## Before you deploy

- **No database migration is needed.** No migration files changed, and
  `dotnet ef migrations has-pending-model-changes` reports "No changes". The
  running `loanms-staging` RDS schema works as-is, so skip the migration task.
- The React bundle in `LoanMS.API/wwwroot/react` is committed and matches a
  fresh `npm run build` byte-for-byte. The Dockerfile rebuilds it from
  `frontend/src` in any case.
- Verified in the audit session: backend build clean, `dotnet test` 396/396,
  frontend `tsc` clean, `vitest` 312/312. The audit fixes were also exercised
  end to end on PostgreSQL 18.

## Deploy (same path as before: ECR → ECS `loanms-prod` / `loanms-api`)

Run these from the folder that contains `LoanMS.slnx`:

```bash
aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin 664418956749.dkr.ecr.ap-south-1.amazonaws.com
docker buildx build --platform linux/amd64 -f deploy/docker/Dockerfile -t 664418956749.dkr.ecr.ap-south-1.amazonaws.com/loanms:audit-2026-09-23 --push .
```

Then register a new revision of the `loanms-prod` task definition. Start from
the **currently running** revision (it has the live secrets and settings) and
change only the image to `loanms:audit-2026-09-23`. Then point the service at
that revision:

```bash
aws ecs update-service --region ap-south-1 --cluster loanms-prod --service loanms-api --task-definition loanms-prod:<new-revision>
```

**Rollback:** run `update-service` again with the previous revision number.
No schema changed, so rolling back is safe.

## Smoke test after deploy

1. `GET /health` returns 200. `/` serves the React app. `/index.html` now
   redirects to `/` (the legacy shell is retired).
2. Log in as an Admin. Open Applications and apply an Advanced Filter (it now
   runs on the server), then export (all matching rows, not just 10).
3. Open a loan. For Admins only, the **More** menu shows
   **Delete customer permanently**. Do not run it on real data unless you mean
   it: the delete is permanent.
4. Click a failing action, such as saving an invalid form. An error toast must
   appear. Silent failures were one of the two critical issues.

## Behaviour changes users will notice

- **Customer delete** is Admin-only and **permanent**. It removes the
  customer, their loans, documents, S3 files, history, tasks, tickets, payout
  claims and bureau data. It is refused while any loan is not Closed or
  Rejected, and the dialog makes you type the customer's name to confirm.
- App-wide success and error toasts. The legacy confirmations are back for
  closing or reopening a ticket and for rejecting a payout.
- Applications filters, export, reports and dashboard breakdowns all use
  server-side filtering.
- Brand colours are now blue `#0a589a` (including the browser-tab icon) and red `#e31e25`. Approved shows green
  and Disbursed shows brand blue.
- Visibility (IDOR) checks were added across tracking, AI, InCred, tasks,
  payout, customers and DSA KYC documents. Users now get a 403 or 404 where
  they previously saw other people's loans.
- A deactivated user's session can no longer be refreshed.
- Two simultaneous status changes on the same loan now return
  `409 "This record was changed by someone else just now"`. Previously both
  could succeed.
- Zero or negative approved amounts, sanction amounts and bank-line amounts are
  rejected.
- The dead Bureau API endpoints are removed. The Bureau tables are kept.

## Production actions still required (cannot be done from code)

1. **Rotate the seed account passwords** for `admin@efin.com`,
   `manager@efin.com` and `sales@efin.com`. Also set `Seed__AdminPassword`,
   `Seed__ManagerPassword` and `Seed__SalesPassword` in the task definition.
   Without them, the code falls back to `Admin@123`, `Manager@123` and
   `Sales@123`.
2. **Settings → Roles & Permissions → Save** once. The backend permission check
   allows an action when its setting is missing (fail-open). Whether to fix
   this in code is still an open decision; see module 1 in AUDIT_PROGRESS.md.
3. **Rotate the InCred, AI and SMTP secrets.** Before this release they could
   have been written in plain text to `AuditLogs` rows.
4. **Set the `incred_webhook_secret` setting** and give InCred the same value
   for the `X-Webhook-Token` header. While it is unset, webhooks are accepted
   unauthenticated and a warning is logged.

## Not verified in the audit (no credentials on the audit machine)

The code paths for live AWS S3, SMTP, the InCred API and the AI providers were
tested only against local and in-memory substitutes. Check each of them once
after the deploy: upload and download a document, send a test email, run an
InCred refresh and an AI run.
