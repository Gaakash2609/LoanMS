# Perfios / Bank Statement — Full Report Persistence & Reload (2026-09-14)

Reference = Vanilla JS (`wwwroot/js/perfios*.js`, `wwwroot/perfios/*`); Target = React.

## Root cause (confirmed by source trace)
- Vanilla `renderPerfiosReport(data)` (perfios-renderer.js) renders the FULL report
  (txns / ABB / target / salary / ACH / ECS / NEFT / UPI / cheque / bounce / FinOne /
  analysis / breakup / EOD / accounts / validation) from an IN-MEMORY object
  (`window._lastPerfiosReport`). Reports→Perfios (`reports-tabs.js`) reads that same
  in-memory var. So Vanilla itself loses the full report on refresh.
- `pfv9ConfirmAttachment` POSTs to `/loans/{id}/perfios-report` but sends **only 10
  summary fields**. Backend `PerfiosReport` entity/DTO store only that summary.
- React mirrors this: `PerfiosUploadResult` (full) → `PerfiosAnalysisResults` (rich,
  16 tabs) live only. `perfiosApi.save` / `perfiosSaveRequest` send summary only.
  `PerfiosReportCard` (Reports→Perfios) reads summary only → after refresh the full
  report is gone; only a small summary <dl> shows.

User requirement: full required report data must persist and reload from backend into
Reports→Perfios, surviving refresh. Not localStorage/cache. Save failure must not be
silently swallowed.

## Plan / status
- [x] Baseline: backend build clean, tsc clean, 209 vitest pass.
- [x] BE: `PerfiosReport.ReportDataJson` (text, nullable) + DTOs + controller passthrough.
- [x] BE: migration `AddPerfiosReportData` (idempotent ADD COLUMN) + snapshot sync.
- [x] FE: `perfiosApi` reportDataJson field.
- [x] FE: `utils/perfios/persist.ts` serialize/deserialize (Date<->epoch) + unit test (3 pass).
- [x] FE: `PerfiosAnalysisResults` save includes reportDataJson; readOnly mode added.
- [x] FE: `NewApplicationPage` perfiosSaveRequest includes reportDataJson; submit-time
      save failure now surfaces a warning (no silent swallow).
- [x] FE: `LoanDetailPage` Reports→Perfios renders full report from persisted JSON,
      summary fallback for legacy rows.
- [x] Verify: dotnet build clean; tsc clean; 212 vitest pass; prod build clean
      (PerfiosAnalysisResults own chunk, no pdfjs pulled); my files lint 0 warnings.
- [x] REAL POSTGRES E2E (fresh DB, MigrateAsync from zero): migration applied,
      ReportDataJson text column present; create customer+loan → POST full report →
      GET readback full round-trip → psql confirms blob contains full report →
      fresh GET (refresh) still returns full report. ALL GREEN.

## Resolved (was: open decision)
- The 0–100 "Health" score ring in `PerfiosAnalysisResults` had NO Vanilla
  equivalent (Vanilla's renderer only shows PASS/WARN/FAIL counts). Per the
  standing "no extra React UI/metric vs Vanilla" rule it was REMOVED — replaced
  by the same pass/warn/fail count badges Vanilla shows (`#pfr-validation-badge`).
  No health-score ring / progress meter remains.

## Independent re-verification (2026-09-14, this session)
- Source-of-truth = the delivered ZIP's own extracted tree (not the report).
- Frontend: `tsc --noEmit` clean; `vitest run` 212/212 pass (incl. persist round-trip
  3/3); `vite build` clean — PerfiosAnalysisResults its own 20.68 kB chunk, pdfjs stays
  in its own 434 kB chunk (not pulled into it). Built asset hash matches committed bundle.
- Backend: `dotnet build` clean (0 errors).
- REAL PostgreSQL E2E on a FRESH DB (MigrateAsync from zero, not EnsureCreated):
  `ReportDataJson text` column created by the migration; login → create customer →
  create loan → POST full report → GET readback returns the COMPLETE report (2 txns,
  salary, accountInfo=HDFC Bank, abbData month, validChecks pass) → second GET (refresh)
  still full; `psql` confirms the 1248-byte blob physically in the column (contains
  "HDFC Bank" and "NEFT SALARY ACME"). Summary-only fallback path unchanged for legacy
  rows. ALL GREEN.
