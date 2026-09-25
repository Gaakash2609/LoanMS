# Applications list sometimes empty ("0 total / No applications found") — 2026-09-24

Symptom: same account, same minute — one load shows all applications, the next shows 0.
Data was never missing; the request was failing and the UI displayed the failure as an empty list.

## Changes
Frontend
- `pages/LoansPage.tsx` — a failed request now shows "Couldn't load applications" + **Try again** (count shows "—"),
  never "0 / No applications found". If a refresh fails but older data exists, the old rows stay with a Retry note.
- `hooks/useLoans.ts` — auto-retry (3x, backoff) on transient failures (network, 401/408/429/5xx); refetch on window focus / reconnect.
- `api/axios.ts` — token refresh hardened: adopts newer tokens written by another tab; signs out ONLY when the server
  rejects the refresh token (not on network blip / 429 / 5xx); fixed `isRefreshing` never resetting when no refresh token.
- `store/authStore.ts` — open tabs stay in sync via the `storage` event (server keeps one rotating refresh token per user).

Backend
- `LoanMS.API/Program.cs` — `UseForwardedHeaders` (X-Forwarded-For, ForwardLimit=1). Behind the ALB all users shared ONE
  IP, so the per-IP rate limits (login 5/15min, refresh 60/15min, auth 200/min) were one company-wide bucket.

## To confirm on prod next time it happens
DevTools -> Network -> `GET /api/loans` status (401/429/502/503/504/timeout?) and CloudWatch logs for that minute.
