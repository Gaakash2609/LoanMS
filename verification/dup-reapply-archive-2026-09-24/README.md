# Verification — customer duplicate / re-application / archive (2026-09-24)

Real PostgreSQL 18 (WSL, user-owned cluster on port 5433). Outputs of the actual runs are the
`RESULT_*.txt` files in this folder.

| Script | What it proves |
|---|---|
| `mig_test.sh` (+ `legacy_seed.sql`, `mig_*.sql`, `mig_up.sql`, `mig_down.sql`) | Migration on a **copy** of an existing DB (`createdb -T loanms_audit`) with legacy problem rows: UP succeeds with WARNINGs instead of failing, raw values untouched, RejectedAt backfilled only from the exact history transition, report lists every conflict, UP body re-run is idempotent, DOWN rolls back, UP again works, apply-constraints refuses while duplicates exist and succeeds after resolution, DB-level unique guarantees reject a 2nd active application / a duplicate normalised PAN while allowing rejected / deleted / NULL-PAN rows. |
| `api_run.sh fresh` | Starts the API on a brand-new DB — the app's own `MigrateAsync` applies the full 57-migration chain. |
| `seed_e2e_users.sql` | Adds ProductTeam, LocationHead (with a Location) and a second Sales user (password = seeded admin's). |
| `e2e.py` | 56 API checks against that DB incl. parallel-request concurrency, asserting DB state with `psql`. |

`mig_up.sql` / `mig_down.sql` were generated with
`dotnet ef migrations script 20260921075433_ExtendLoanObligationsForCreditReview 20260924143037_AddCustomerIdentityKeysAndApplicationArchive` (and the reverse).

`stage_and_run.sh` copies the scripts into `~/dupwork` inside WSL (CR/BOM stripped) and runs one of them,
e.g. `wsl bash ~/stage_and_run.sh e2e.py`. Paths inside the scripts are this machine's; adjust for another.
