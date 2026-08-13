#!/bin/sh
set -eu

RESTORE_CONFIRMATION='RESTORE_ISOLATED_TEST_DATABASE'

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

[ "$#" -eq 1 ] || fail "Usage: sh scripts/restore-postgres-test.sh /absolute/path/backup.dump"
command -v pg_restore >/dev/null 2>&1 || fail "pg_restore is required"
command -v psql >/dev/null 2>&1 || fail "psql is required"
[ -n "${RESTORE_DATABASE_URL:-}" ] || fail "RESTORE_DATABASE_URL is required"
[ "${RESTORE_CONFIRM:-}" = "$RESTORE_CONFIRMATION" ] || fail "Set RESTORE_CONFIRM=$RESTORE_CONFIRMATION before restoring"
backup_file=$1
manifest_file="$backup_file.counts.tsv"
schema_file="$backup_file.schema.tsv"

configured_database=${RESTORE_DATABASE_URL%%\?*}
configured_database=${configured_database##*/}
case "$configured_database" in *_test) ;; *) fail "Restore target URL must end in _test" ;; esac
[ -f "$backup_file" ] || fail "Backup file does not exist"
[ -f "$manifest_file" ] || fail "Row-count manifest does not exist"
[ -f "$schema_file" ] || fail "Schema manifest does not exist"

manifest_entries=0
seen_tables=''
while IFS='	' read -r table_name expected_count; do
  case "$table_name" in events|participants|event_registrations|queue_entries|screening_results|sync_actions|audit_logs) ;; *) fail "Unexpected table in manifest" ;; esac
  case " $seen_tables " in *" $table_name "*) fail "Duplicate table in manifest" ;; esac
  case "$expected_count" in ''|*[!0-9]*) fail "Invalid row count in manifest" ;; esac
  seen_tables="$seen_tables $table_name"
  manifest_entries=$((manifest_entries + 1))
done < "$manifest_file"
[ "$manifest_entries" -eq 7 ] || fail "Manifest must contain every critical table exactly once"

target_database=$(psql "$RESTORE_DATABASE_URL" -Atq -v ON_ERROR_STOP=1 -c 'SELECT current_database()')
case "$target_database" in *_test) ;; *) fail "Restore target must end in _test" ;; esac

started_epoch=$(date +%s)
pg_restore --dbname="$RESTORE_DATABASE_URL" --clean --if-exists --no-owner --no-privileges --exit-on-error --single-transaction "$backup_file"

while IFS='	' read -r table_name expected_count; do
  actual_count=$(psql "$RESTORE_DATABASE_URL" -Atq -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.\"${table_name}\"")
  [ "$actual_count" = "$expected_count" ] || fail "Row-count validation failed for $table_name"
done < "$manifest_file"

restored_schema=$(mktemp "${TMPDIR:-/tmp}/vsms-restored-schema.XXXXXX")
trap 'rm -f -- "$restored_schema"' EXIT HUP INT TERM
psql "$RESTORE_DATABASE_URL" -Atq -F '	' -v ON_ERROR_STOP=1 -c "
  SELECT 'CONSTRAINT', c.conrelid::regclass::text, c.conname, c.contype::text, c.convalidated::text
  FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace
  WHERE n.nspname = 'public' AND c.contype IN ('p', 'u', 'f', 'c')
  UNION ALL
  SELECT 'INDEX', tablename, indexname, '', indexdef
  FROM pg_indexes
  WHERE schemaname = 'public'
  ORDER BY 1, 2, 3
" > "$restored_schema"
cmp -s "$schema_file" "$restored_schema" || fail "Constraint or index parity validation failed"

elapsed=$(( $(date +%s) - started_epoch ))
printf 'Restore validated for %s with exact row-count, constraint, and index parity\nElapsed seconds: %s\n' "$target_database" "$elapsed"
