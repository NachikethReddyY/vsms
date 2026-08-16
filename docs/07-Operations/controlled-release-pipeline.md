# VSMS controlled production release pipeline

## Purpose and evidence boundary

VSMS uses a staged GitHub Actions release process for the production AWS target.
The workflow is implemented in `.github/workflows/deploy.yml` and
`.github/workflows/deploy-environment.yml`; infrastructure and least-privilege
roles are defined in `infrastructure/availability.yaml` and
`infrastructure/github-oidc-roles.yaml`.

This is repository evidence that the release controls are implemented. It is not
evidence that a particular AWS account is currently healthy or that 99.9%
availability has already been achieved. A release is production evidence only
after the workflow succeeds in the configured AWS environments and its retained
manifest is reviewed.

## Enforced release order

```text
Build, test, scan and digest-pin candidate image
    -> Register candidate migration task without changing live traffic
    -> Create and verify an encrypted RDS recovery snapshot
    -> Run exactly one dedicated migration task
    -> Run prisma migrate deploy and prisma migrate status
    -> Promote the same image digest to API and worker services
    -> Wait for ECS stability and /ready health checks
    -> Smoke-test health, readiness and an optional authenticated route
    -> Publish immutable frontend assets and index.html last
    -> Verify alarm state and retain a release evidence manifest
```

Any failed command stops progression. Production deployment starts only after
the same digest passes staging. GitHub concurrency groups prevent overlapping
releases to the same environment, and production should use a protected GitHub
Environment with a required human reviewer.

## Migration safety model

Migrations never run in API or worker startup. The one-off Fargate migration task
runs `pnpm deploy:migrate`, which performs production preflight checks, executes
`prisma migrate deploy`, and then requires `prisma migrate status` to exit
successfully. A non-zero task exit code blocks application promotion.

The migration task receives `DatabaseMigrationUrlSecret`, backed by the database
owner credentials. API, report-worker and domain-event-worker tasks receive only
`DatabaseRuntimeUrlSecret`, backed by the restricted `vsms_runtime` role. The
migration execution role can read only the migration secret; runtime task roles
cannot read it. GitHub launches the task through a separate migration OIDC role
and does not receive the database password.

Schema changes use expand-and-contract migrations:

1. Add backward-compatible columns, tables or indexes.
2. Deploy code that can operate with both schema versions.
3. Migrate or backfill data safely.
4. Remove obsolete schema only in a later release after rollback is no longer
   required.

An applied migration is immutable. If an applied migration is incorrect, the
team creates a new forward-fix migration instead of editing history.

## Recovery checkpoint and rollback

Before migrations, the workflow creates an encrypted manual RDS snapshot, waits
until its state is `available`, and records its identifier against the release
SHA. Snapshot creation failure stops the deployment. These checkpoints require
an operator-owned retention policy so old snapshots do not accumulate forever.

The previous backend image digest and frontend `index.html` version remain
available. If a post-migration gate fails, the workflow redeploys the previous
application digest and restores the previous frontend entry point. Database
migrations are not automatically reversed because destructive down-migrations
can worsen an incident. The application rollback therefore depends on
backward-compatible expansion; database correction uses a reviewed forward-fix.

A snapshot or point-in-time recovery is restored only to an isolated database.
The operator validates migration state, constraints, indexes, critical row
counts, authentication and core workflows before any controlled cutover.

## GitHub configuration

Repository variables:

- `AWS_BUILD_ROLE_ARN`
- `AWS_REGION`
- `ECR_REPOSITORY`

Variables in both the `staging` and `production` GitHub Environments:

- `AWS_STACK_NAME`
- `AWS_REGION`
- `AWS_DEPLOY_ROLE_ARN`
- `AWS_MIGRATION_ROLE_ARN`
- `AWS_VERIFY_ROLE_ARN`
- `AWS_CLOUDFORMATION_ROLE_ARN`
- `API_URL`
- `SMOKE_AUTH_PATH` when an authenticated smoke route is available

Environment secret:

- `SMOKE_BEARER_TOKEN` when `SMOKE_AUTH_PATH` is configured

The OIDC roles in `infrastructure/github-oidc-roles.yaml` replace static AWS
access keys. The repository and environment names supplied to that stack must
match the GitHub repository and protected environments exactly.

## Quality and release evidence

Pull requests execute dependency audits, contracts, tests, linting, builds,
fresh PostgreSQL migration preparation, `prisma migrate status`, and a
backward-compatibility migration check. Pushes to `main` additionally build and
scan one digest-pinned image with SBOM/provenance metadata, then promote that
same digest through staging and production.

Each environment retains stack outputs and either a release or rollback manifest
for 90 days. The successful manifest records the release SHA, immutable image,
recovery snapshot, service identities, endpoint checks and outcome. CloudWatch
alarms are managed separately; the release verifier checks that configured VSMS
alarms are not in `ALARM` state but does not create monitoring resources.

## Operator acceptance checklist

- Confirm the production GitHub Environment requires approval.
- Confirm OIDC trust is scoped to this repository and environment.
- Confirm the CloudFormation stack outputs required by the workflow exist.
- Confirm the current and candidate images use `@sha256:` digests.
- Confirm the runtime role has no DDL or migration-secret access.
- Confirm the recovery snapshot is encrypted and available.
- Confirm the migration task is the only migration runner.
- Confirm `prisma migrate status` is clean before promotion.
- Confirm ECS services are stable and the load balancer uses `/ready`.
- Confirm the release manifest and smoke-test evidence were retained.
- Exercise restore into an isolated database and record measured RPO/RTO.
