#!/bin/bash
# Migration test on a COPY of an existing database, with legacy problem rows.
export PATH=/usr/lib/postgresql/18/bin:$PATH
H="-h 127.0.0.1 -p 5433 -U loanms"
D=loanms_dup_legacy
W=/home/aakash_gupta/dupwork
run() { psql $H -d $D -X "$@"; }

dropdb $H --if-exists $D
createdb $H -O loanms -T loanms_audit $D
echo "### 1. Copy of loanms_audit (pre-migration schema) + legacy seed"
run -q -f $W/mig_counts.sql
run -q -v ON_ERROR_STOP=1 -f $W/legacy_seed.sql && echo "legacy seed inserted"
run -q -f $W/mig_counts.sql

echo; echo "### 2. UP migration (legacy duplicates present)"
run -q -v ON_ERROR_STOP=1 -f $W/mig_up.sql; echo "UP exit=$?"
run -q -f $W/mig_checks.sql
run -q -f $W/mig_counts.sql

echo; echo "### 3. Legacy-data report (read-only)"
run -q -f $W/dup-reapply-archive-report.sql

echo; echo "### 4. Idempotency: re-run the UP body (history insert stripped)"
grep -v '__EFMigrationsHistory' $W/mig_up.sql | grep -v "VALUES ('20260924143037" > $W/mig_up_body.sql
run -q -v ON_ERROR_STOP=1 -f $W/mig_up_body.sql > /dev/null 2>&1; echo "re-run exit=$?"
run -q -f $W/mig_counts.sql

echo; echo "### 5. DOWN (rollback)"
run -q -v ON_ERROR_STOP=1 -f $W/mig_down.sql; echo "DOWN exit=$?"
run -q -f $W/mig_counts.sql
echo "L4 RejectedAt after DOWN (backfill kept by design):"
run -q -At -c "SELECT \"LoanNumber\" || ' ' || coalesce(\"RejectedAt\"::text,'NULL') FROM \"Loans\" WHERE \"LoanNumber\" IN ('LEG0004A','LEG0005A') ORDER BY 1"

echo; echo "### 6. UP again after rollback"
run -q -v ON_ERROR_STOP=1 -f $W/mig_up.sql > /dev/null 2>&1; echo "UP#2 exit=$?"
run -q -f $W/mig_counts.sql

echo; echo "### 7. apply-constraints BEFORE resolution (must refuse, change nothing)"
run -q -v ON_ERROR_STOP=1 -f $W/dup-reapply-archive-apply-constraints.sql 2>&1 | grep -E "ERROR|NOTICE"
run -q -f $W/mig_counts.sql

echo; echo "### 8. Simulated admin resolution, then apply-constraints"
run -q -v ON_ERROR_STOP=1 -f $W/mig_resolve.sql && echo "resolution applied"
run -q -v ON_ERROR_STOP=1 -f $W/dup-reapply-archive-apply-constraints.sql 2>&1 | grep -E "ERROR|NOTICE"
run -q -f $W/mig_counts.sql

echo; echo "### 9. DB-level guarantees (direct SQL)"
run -q -f $W/mig_dblevel.sql 2>&1
echo "### done"
