#!/bin/bash
# Usage: stage_and_run.sh <script-in-dupwork> [args...]
# Copies every scratchpad .sh/.sql/.py into ~/dupwork (CR/BOM stripped), then runs the named script.
SRC=/mnt/c/Users/AAKASH~1/AppData/Local/Temp/claude/C--Users-Aakash-Gupta-Downloads/5c9e2e7f-7c96-4530-a4a5-5e5747c1cae4/scratchpad
W=/home/aakash_gupta/dupwork
mkdir -p $W
for f in $SRC/*.sh $SRC/*.sql $SRC/*.py; do
  [ -f "$f" ] || continue
  b=$(basename "$f")
  cp "$f" "$W/$b"
  sed -i 's/\r//; 1s/^\xEF\xBB\xBF//' "$W/$b"
done
export PATH=/usr/lib/postgresql/18/bin:$PATH
cd $W
s=$1; shift
case "$s" in
  *.py)  exec python3 "$W/$s" "$@" ;;
  *.sql) exec psql -h 127.0.0.1 -p 5433 -U loanms -d "${1:-loanms_dup_e2e}" -X -q -v ON_ERROR_STOP=1 -f "$W/$s" ;;
  *)     exec bash "$W/$s" "$@" ;;
esac
