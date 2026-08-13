#!/bin/sh
set -eu

RESTORE_CONFIRMATION='RESTORE_ISOLATED_TEST_DATABASE'

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

[ "$#" -eq 1 ] || fail "Usage: sh scripts/restore-postgres-test.sh /absolute/path/backup.dump"
[ -n "${RESTORE_DATABASE_URL:-}" ] || fail "RESTORE_DATABASE_URL is required"
[ "${RESTORE_CONFIRM:-}" = "$RESTORE_CONFIRMATION" ] || fail "Set RESTORE_CONFIRM=$RESTORE_CONFIRMATION before restoring"
backup_file=$1
manifest_file="$backup_file.counts.tsv"
checksum_file="$backup_file.sha256"

configured_database=${RESTORE_DATABASE_URL%%\?*}
configured_database=${configured_database##*/}
case "$configured_database" in *_test) ;; *) fail "Restore target URL must end in _test" ;; esac
[ -f "$backup_file" ] || fail "Backup file does not exist"
[ -f "$manifest_file" ] || fail "Row-count manifest does not exist"
[ -f "$checksum_file" ] || fail "SHA-256 checksum does not exist"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"

checksum_line=$(cat "$checksum_file")
expected_hash=${checksum_line%%  *}
checksum_name=${checksum_line#*  }
case "$expected_hash" in ''|*[!a-f0-9]*) fail "Invalid SHA-256 checksum" ;; esac
[ "${#expected_hash}" -eq 64 ] || fail "Invalid SHA-256 checksum"
[ "$checksum_name" = "$(basename "$backup_file")" ] || fail "Checksum filename does not match backup"
actual_hash=$(sha256sum "$backup_file" | awk '{print $1}')
[ "$actual_hash" = "$expected_hash" ] || fail "Backup integrity verification failed"

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

command -v pg_restore >/dev/null 2>&1 || fail "pg_restore is required"
command -v psql >/dev/null 2>&1 || fail "psql is required"
target_database=$(psql "$RESTORE_DATABASE_URL" -Atq -v ON_ERROR_STOP=1 -c 'SELECT current_database()')
case "$target_database" in *_test) ;; *) fail "Restore target must end in _test" ;; esac

started_epoch=$(date +%s)
pg_restore --dbname="$RESTORE_DATABASE_URL" --clean --if-exists --no-owner --no-privileges --exit-on-error --single-transaction "$backup_file"

while IFS='	' read -r table_name expected_count; do
  actual_count=$(psql "$RESTORE_DATABASE_URL" -Atq -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.\"${table_name}\"")
  [ "$actual_count" = "$expected_count" ] || fail "Row-count validation failed for $table_name"
done < "$manifest_file"

unvalidated_constraints=$(psql "$RESTORE_DATABASE_URL" -Atq -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype IN ('p', 'u', 'f', 'c') AND NOT convalidated")
[ "$unvalidated_constraints" = "0" ] || fail "Constraint validation failed"

elapsed=$(( $(date +%s) - started_epoch ))
printf 'Restore validated for %s\nElapsed seconds: %s\n' "$target_database" "$elapsed"
