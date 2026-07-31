# Backend-only features (no frontend UI yet)

This file tracks backend-complete features that currently have **no consuming
UI** in either the React app (`frontend/src`) or the legacy static app
(`LoanMS.API/wwwroot/js`). Found during the PHASE 6 final audit — documented
here so it isn't mistaken for a bug in a future review.

## Report Targets
- **Backend:** `GET /api/reports/targets`, `PUT /api/reports/targets` —
  `ReportsController.cs`. Fully implemented, persisted to PostgreSQL/SQLite via
  `AppSetting`/targets table, RBAC-restricted per existing conventions.
- **Frontend:** No references found anywhere in `frontend/src` or
  `LoanMS.API/wwwroot/js` to `/api/reports/targets`.
- **Status:** Backend-complete, frontend-pending. Not wired up yet.

## Assignment Logs
- **Backend:** `GET /api/assignmentlog` — `AssignmentLogController.cs`. Fully
  implemented, persisted to PostgreSQL/SQLite, `[Authorize(Roles =
  "Admin,Manager")]`.
- **Frontend:** No references found anywhere in `frontend/src` or
  `LoanMS.API/wwwroot/js` to `/api/assignmentlog`.
- **Status:** Backend-complete, frontend-pending. Not wired up yet.

If UI work for either of these is in scope for an upcoming phase, this file
can be deleted once a page/section consumes the endpoint. Until then, treat
"no UI" as the current, intentional state rather than a missed integration.
