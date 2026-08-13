# Performance and recovery evidence — 2026-08-13

This evidence was produced with synthetic data in an isolated local database. It proves the application paths and backup/restore procedure, not AWS production capacity.

## Environment

- Apple Silicon host: 10 logical CPUs, 32 GiB memory
- Node.js API, PostgreSQL 18.4, loopback network
- 500 synthetic participants, five concurrent staff writers
- 500 participant status clients polling every five seconds while ten staff clients polled the live queue every ten seconds
- Thresholds: operational read p95 <= 250 ms, aggregate reporting p95 <= 350 ms, single-record write p95 <= 500 ms, 25-action offline screening batch p95 <= 7,500 ms, error rate <= 1%

## Results

| Scenario | Requests | Throughput/s | p50 ms | p95 ms | Errors |
| --- | ---: | ---: | ---: | ---: | ---: |
| Registration write | 500 | 234.70 | 19.74 | 28.35 | 0% |
| Registration read | 10 | 697.83 | 6.77 | 7.75 | 0% |
| Check-in write | 20 | 249.24 | 17.23 | 32.56 | 0% |
| Queue read | 10 | 324.29 | 9.95 | 22.23 | 0% |
| Screening sync write | 20 batches / 500 actions | 16.76 batches | 279.10 | 343.96 | 0% |
| Reporting read | 10 | 168.58 | 29.38 | 33.52 | 0% |
| Participant status poll | 2,997 | 99.89 | 7.30 | 22.28 | 0% |
| Staff queue poll | 31 | 1.03 | 16.66 | 32.09 | 0% |

All checked-in latency and error thresholds passed. The API process peaked at 259.3% host CPU (about 26% of the ten logical CPUs) and 419,424 KiB RSS (about 1.2% of host memory). PostgreSQL recorded no transaction rollbacks during the retained run.

## Backup and restore

- Critical source rows: 2 events, 500 participants, 1,000 event registrations, 520 queue entries, 500 screening results, 500 sync actions, and 2,070 audit logs.
- Custom-format backup completed in less than one reported second.
- Restore into `vsms_restore_test` completed in less than one reported second.
- Restore validation passed exact critical-row counts plus all 177 public constraints' identity/type/validation state and all 245 public index definitions.

The private synthetic dump is intentionally outside version control. The manual `Performance and Recovery Evidence` GitHub workflow uploads the same sanitized results, observations, and dump as a 30-day private Actions artifact.

## Remaining production proof

The deployed AWS API was unreachable during this audit and local AWS credentials were expired. Re-run the workflow-equivalent scenario against an authorized non-production AWS target and restore an RDS snapshot into an isolated instance before claiming production capacity, RPO, or RTO.
