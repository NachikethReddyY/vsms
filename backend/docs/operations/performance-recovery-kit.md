# Performance and recovery kit

An isolated local run completed on 2026-08-13; its sanitized evidence is retained in [docs/2026-08-13-performance-recovery.md](../../docs/2026-08-13-performance-recovery.md). No production or AWS load test has been run.

## Run the isolated 500-participant scenario

The checked-in scenario is [performance/isolated-500.json](../performance/isolated-500.json). It uses only documented API routes, creates 500 synthetic participants in an isolated `vsms_perf_test` database, then measures these representative operations:

- registration write and read: `POST` / `GET /api/v1/registrations`;
- registration check-in and queue handoff/read: `POST /api/v1/qr/manual-checkin` and `GET /api/v1/queues/events/{eventId}`;
- screening sync write: `POST /api/v1/events/{eventId}/sync/screening`, in the contract maximum of 25 actions per batch; and
- aggregate reporting read: `GET /api/v1/events/reports/operations`.

The runner stores only aggregate throughput, p50, p95, and error-rate data in a mode-`0600` JSON evidence file. It does not write bearer tokens, participant IDs, response bodies, or credentials to that file.

Set up a fresh, authorized local test database before starting the API. The database name must end in `_test`.

```sh
export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/vsms_perf_test'
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

The runner refuses to write until it sees the explicit acknowledgement, a target label ending in `_test`, a credential-free base URL, a valid fixture, and a bearer token. It refuses proxy environment variables so the evaluated URL cannot be silently forwarded. Remote authorized non-production targets additionally require `VSMS_LOAD_TEST_REMOTE_NONPRODUCTION=YES`; change the checked-in target label and base URL only to another isolated target ending in `_test`. It never treats this opt-in as proof that a target is authorized.

The fixture script refuses to overwrite an existing fixture and only creates synthetic records in a `_test` database. It intentionally does not clean them up automatically: keeping the event makes the measured operations and evidence reproducible. Dispose of the isolated database under the environment owner's retention policy when the evidence is no longer needed.

The application keeps its production-shaped security limits enabled. Five concurrent staff writes model the available screening desks while all 500 participants poll every five seconds. Public status checks are capped at 15 requests per token and 10,000 requests per source IP per minute, which permits one event-network NAT to serve the expected 6,000 checks per minute without exposing the other QR operations. The scenario checks in 20 newly registered participants through the QR API, below its 30-request-per-minute limit, and measures screening writes against the fixture's 500 already checked-in synthetic registrations. Do not relax the limiters for a load run.

## Back up and prove a restore

Backups must go to an encrypted, access-controlled directory outside this repository. The backup command does not print credentials and records a timing plus adjacent mode-`0600` manifests of critical row counts, public constraint identity/type/validation state, and complete index definitions.

```sh
export DATABASE_URL='postgresql://backup-user:password@db-host:5432/vsms'
export VSMS_BACKUP_DIR=/absolute/secure/backups
pnpm --dir backend backup:postgres
```

Restore only into an isolated database whose actual and URL-selected names end in `_test`. The restore script fails before it invokes PostgreSQL if the URL does not select such a database. It uses `pg_restore --clean --if-exists` and compares counts for events, participants, registrations, queue entries, screening results, sync actions, and audit logs plus the source constraint/index manifest.

```sh
export RESTORE_DATABASE_URL='postgresql://restore-user:password@db-host:5432/vsms_restore_test'
export RESTORE_CONFIRM=RESTORE_ISOLATED_TEST_DATABASE
pnpm --dir backend restore:postgres:test /absolute/secure/backups/vsms-vsms-20260810T000000Z.dump
```

The dump and its `.counts.tsv` and `.schema.tsv` manifests must remain together. Restore requires the exact confirmation above, uses one `pg_restore --single-transaction` transaction, compares critical row counts plus every public constraint and index definition, and rolls back on restore failure. Backup refuses an existing timestamped dump or manifest rather than overwriting it. A successful command is restore evidence only for that specific backup, target, and time; record its terminal output alongside the authorized change record.

## Observe and decide

During an authorized run, capture host and database observations at the same time as the JSON evidence:

```sh
ps -o pid,%cpu,rss,command -p "$(pgrep -f 'node server.js')"
psql "$DATABASE_URL" -c "SELECT datname,numbackends,xact_commit,xact_rollback,blks_read,blks_hit FROM pg_stat_database WHERE datname=current_database()"
psql "$DATABASE_URL" -c "SELECT state,count(*) FROM pg_stat_activity WHERE datname=current_database() GROUP BY state"
```

For containerized local PostgreSQL, also use `docker stats` and retain the output. Use `EXPLAIN (ANALYZE, BUFFERS)` only on an isolated database and only after the load run identifies a specific slow route or query.

The documented AWS deployment separates the EC2 API from encrypted RDS, but one API instance is still an availability bottleneck. The scripts reduce accidental destructive restore risk; they do not provide automated failover or establish a production RPO/RTO.

The current deployment already uses encrypted RDS. Add Multi-AZ and at least two stateless API instances before accepting a 500-participant event in production if an authorized AWS run misses p95 <= 500 ms for single-record writes, p95 <= 7,500 ms for a maximum 25-action offline screening batch, p95 <= 250 ms for operational reads, p95 <= 350 ms for the aggregate operations report, error rate <= 1%, or if sustained normalized CPU exceeds 70%, memory exceeds 80%, or restore time exceeds the agreed event RTO.

## Current evidence status

| Evidence | Status |
| --- | --- |
| 500-participant latency/load metrics | Passed locally; all p95 and error thresholds met |
| CPU, memory, and database observations | Captured locally; see retained evidence |
| PostgreSQL backup timing | Passed locally |
| Isolated restore timing, row-count, constraint, and index parity | Passed locally |
| AWS capacity and managed-backup recovery | Pending refreshed AWS access and an agreed production-safe test window |

The manual `Performance and Recovery Evidence` GitHub workflow runs this same kit against PostgreSQL 16, retains sanitized measurements and the synthetic backup as a private Actions artifact, and fails if the checked-in latency/error thresholds or restore checks fail. Its result proves the isolated code path; production capacity still requires a separately authorized run in the deployed environment.
