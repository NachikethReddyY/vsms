# Performance and recovery kit

No production or AWS measurement has been run by this repository. All latency, throughput, recovery-time, and recovery-point evidence remains **pending** until an authorized isolated target executes the commands below and retains their output.

## Run the isolated 500-participant scenario

The checked-in scenario is [performance/isolated-500.json](../performance/isolated-500.json). It uses only documented API routes, creates 500 synthetic participants in an isolated `vsms_test` database, then measures these representative operations:

- registration write and read: `POST` / `GET /api/v1/registrations`;
- registration check-in and queue handoff/read: `PATCH /api/v1/registrations/{id}/status`, `POST` / `GET /api/v1/queues`;
- screening sync write: `POST /api/v1/events/{eventId}/sync/screening`, in the contract maximum of 25 actions per batch; and
- aggregate reporting read: `GET /api/v1/events/reports/operations`.

The runner stores only aggregate throughput, p50, p95, and error-rate data in a mode-`0600` JSON evidence file. It does not write bearer tokens, participant IDs, response bodies, or credentials to that file.

Set up a fresh, authorized local test database before starting the API. The database name must end in `_test`.

```sh
export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/vsms_test'
export JWT_ACCESS_SECRET='replace-with-a-local-test-secret-at-least-32-characters'
export NODE_ENV=test
export LOCAL_HTTPS=false
export COGNITO_STAFF_SYNC_MODE=local-only
export PERF_FIXTURE_FILE=/tmp/vsms-performance-fixture.json
pnpm --dir backend prisma:migrate
PERF_FIXTURE_CONFIRM=CREATE_SYNTHETIC_TEST_DATA pnpm --dir backend perf:prepare
export PERF_AUTHORIZATION="Bearer $(pnpm --dir backend perf:token)"
```

Run the API in one terminal and the scenario in another.

```sh
pnpm --dir backend start
```

```sh
pnpm --dir backend perf:check
VSMS_LOAD_TEST_ACKNOWLEDGEMENT=SYNTHETIC_LOAD_TEST \
  PERF_RESULTS_FILE=/tmp/vsms-performance-results.json \
  pnpm --dir backend perf:run
```

The runner refuses to write until it sees the explicit acknowledgement, a target label ending in `_test`, a credential-free base URL, a valid fixture, and a bearer token. Remote authorized non-production targets additionally require `VSMS_LOAD_TEST_REMOTE_NONPRODUCTION=YES`; change the checked-in target label and base URL only to another isolated target ending in `_test`. It never treats this opt-in as proof that a target is authorized.

The fixture script refuses to overwrite an existing fixture and only creates synthetic records in a `_test` database. It intentionally does not clean them up automatically: keeping the event makes the measured operations and evidence reproducible. Dispose of the isolated database under the environment owner's retention policy when the evidence is no longer needed.

The application currently limits mutations to 60 requests per minute on the event and queue route groups. A concurrent 500-participant run may therefore record deliberate `429` responses for queue or screening writes; retain that as rate-limit evidence, not database-capacity evidence. Do not relax the limiter outside an isolated authorized target.

## Back up and prove a restore

Backups must go to an encrypted, access-controlled directory outside this repository. The backup command does not print credentials and records a timing plus an adjacent mode-`0600` manifest of critical row counts.

```sh
export DATABASE_URL='postgresql://backup-user:password@db-host:5432/vsms'
export VSMS_BACKUP_DIR=/absolute/secure/backups
pnpm --dir backend backup:postgres
```

Restore only into an isolated database whose actual and URL-selected names end in `_test`. The restore script fails before it invokes PostgreSQL if the URL does not select such a database. It uses `pg_restore --clean --if-exists`, compares counts for events, participants, registrations, queue entries, screening results, sync actions, and audit logs, and rejects unvalidated public constraints.

```sh
export RESTORE_DATABASE_URL='postgresql://restore-user:password@db-host:5432/vsms_restore_test'
pnpm --dir backend restore:postgres:test /absolute/secure/backups/vsms-vsms-20260810T000000Z.dump
```

The dump and its `.counts.tsv` manifest must remain together. A successful command is restore evidence only for that specific backup, target, and time; record its JSON or terminal output alongside the authorized change record. No backup or restore has been executed by this change.

## Observe and decide

During an authorized run, capture host and database observations at the same time as the JSON evidence:

```sh
ps -o pid,%cpu,rss,command -p "$(pgrep -f 'node server.js')"
psql "$DATABASE_URL" -c "SELECT datname,numbackends,xact_commit,xact_rollback,blks_read,blks_hit FROM pg_stat_database WHERE datname=current_database()"
psql "$DATABASE_URL" -c "SELECT state,count(*) FROM pg_stat_activity WHERE datname=current_database() GROUP BY state"
```

For containerized local PostgreSQL, also use `docker stats` and retain the output. Use `EXPLAIN (ANALYZE, BUFFERS)` only on an isolated database and only after the load run identifies a specific slow route or query.

Same-host deployment remains a single point of failure: one host can take down the API process, PostgreSQL, local backup staging, and network attachment together. The scripts reduce accidental destructive restore risk; they do not provide off-host durability, automated failover, or a tested RPO/RTO.

Move to managed RDS with Multi-AZ and at least two stateless API instances before accepting a 500-participant event in production if any authorized 500-participant run misses p95 <= 500 ms for writes, p95 <= 250 ms for reads, error rate <= 1%, or if sustained CPU exceeds 70%, memory exceeds 80%, or restore time exceeds the agreed event RTO. These are adoption thresholds, not measured results.

## Current evidence status

| Evidence | Status |
| --- | --- |
| 500-participant latency/load metrics | Pending authorized execution |
| CPU, memory, and database observations | Pending authorized execution |
| PostgreSQL backup timing | Pending authorized execution |
| Isolated restore timing, row-count, and constraint validation | Pending authorized execution |
