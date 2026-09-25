#!/bin/bash
# Runs the freshly built API against a brand-new PostgreSQL database, so the
# app's own startup MigrateAsync() applies the FULL migration chain.
export PATH=/usr/lib/postgresql/18/bin:$PATH
DB=loanms_dup_e2e
if [ "$1" = "fresh" ]; then
  dropdb -h 127.0.0.1 -p 5433 -U loanms --if-exists $DB
  createdb -h 127.0.0.1 -p 5433 -U loanms -O loanms $DB
fi
export ASPNETCORE_ENVIRONMENT=Development
export Database__Provider=postgresql
export ConnectionStrings__PostgreSQL="Host=127.0.0.1;Port=5433;Database=$DB;Username=loanms"
export ASPNETCORE_Jwt__Key=ThisIsALocalDevOnlySecretKey_ChangeMe_32CharsMin
export ASPNETCORE_URLS=http://127.0.0.1:5199
cd /home/aakash_gupta/loanms_dup_artifacts/bin/LoanMS.API/debug
exec /usr/local/bin/dotnet LoanMS.API.dll --contentRoot "/mnt/c/Users/Aakash Gupta/LoanMS-Work-2026-09-24-dup-reapply-archive/loanms/LoanMS/LoanMS.API" > /home/aakash_gupta/dupwork/api.log 2>&1
