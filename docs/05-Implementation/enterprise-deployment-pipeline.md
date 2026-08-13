# Enterprise deployment pipeline and deployment scripts

## 1. Purpose

VSMS previously exposed package commands that installed dependencies, changed the database, seeded demonstration data, and started the API as one operation. That approach was convenient for local setup but unsafe for production because the release was not immutable, database seeding could be invoked accidentally, worker processes were not promoted as one release, and there was no staged approval, verification evidence, or automatic application rollback.

The implementation replaces that command with a controlled delivery pipeline. Package scripts now perform one small operation each, while GitHub Actions coordinates the production release. This separation makes failures observable and ensures that a release cannot silently skip migration, worker stability, readiness, security, or audit-evidence gates.

## 2. Implemented release sequence

```text
Approved merge to main
        |
        v
Contracts, tests, lint, build, migration safety check
        |
        v
Build image once -> ECR scan -> SBOM/provenance attestation
        |
        v
Staging OIDC roles -> one-off migration -> API and worker rollout
        |
        v
/ready + authenticated smoke + alarm gate -> frontend index last
        |
        v
Protected production approval -> promote the same image digest
        |
        v
Release manifest retained as audit evidence
```

The parent workflow is `.github/workflows/deploy.yml`. The reusable environment workflow is `.github/workflows/deploy-environment.yml`. Staging and production therefore execute the same release procedure, and production receives the exact container digest that passed staging.

## 3. Deployment scripts

The deployment scripts were redesigned as atomic controls rather than a large shell command.

| Command | Purpose | Production control |
|---|---|---|
| `pnpm deploy:preflight` | Validates the environment, full Git SHA, and digest-pinned image before release activity. | Rejects unknown environments, non-production runtime mode, zero/short SHAs, and mutable image tags. |
| `pnpm deploy:migrate` | Applies pending Prisma migrations in the one-off ECS migration task. | Runs preflight first and requires a remote PostgreSQL URL with `sslmode=require`. Only the migration execution role can read the owner URL. |
| `pnpm deploy:smoke` | Retries liveness, database readiness, and an optional safe authenticated API request. | Requires HTTPS by default, never prints the bearer token, and fails the release after a bounded timeout. |
| `pnpm deploy:verify` | Validates the generated release manifest before it becomes audit evidence. | Requires a commit, digest, actor, approval environment, timestamps, service/migration records, and passed smoke/security evidence. |
| `pnpm setup:demo` | Creates local demonstration data. | Uses `assert-non-production.js` and refuses execution when either `NODE_ENV` or `DEPLOY_ENVIRONMENT` is production. |

The same safeguard is applied to `prisma:push`, `prisma:seed`, and `seed`. The ambiguous `deploy`, `deploy:prod`, and `db:setup` commands were removed. Prisma `migrate deploy` was retained only behind the explicit production preflight and is launched by an isolated ECS task rather than every API replica.

`check-migrations.js` inspects new migration SQL before deployment. Destructive statements such as `DROP`, `TRUNCATE`, rename operations, and type changes fail the gate unless a deliberately named reviewed exception is supplied. This enforces an expand-and-contract workflow: first add compatible structures, deploy compatible applications, and remove obsolete structures in a later release.

## 4. Immutable build and software-supply-chain controls

The backend Docker image is built once from the frozen pnpm lockfile. It is labelled with the source commit, pushed to ECR, and then referenced as `repository@sha256:digest`. CloudFormation rejects image parameters that are not digest-pinned. BuildKit generates an SBOM and maximum-mode provenance, ECR scanning blocks critical findings, and GitHub creates a registry-backed build attestation.

All runtime processes use the approved digest:

- API service;
- report worker;
- domain-event worker;
- lifecycle-email worker when enabled;
- one-off migration task, using the candidate digest before service promotion.

This provides integrity because staging and production cannot resolve a mutable tag to different content.

## 5. Short-lived AWS access and least privilege

`infrastructure/github-oidc-roles.yaml` defines distinct GitHub OIDC roles for build, environment deployment, migration launch, and read-only verification. The trust policies require the exact repository and either the `main` branch or named `staging`/`production` GitHub environment. No permanent AWS access key is stored in GitHub.

The runtime roles remain separate from pipeline roles. API tasks receive the restricted runtime database URL, not the RDS owner credential. The migration execution role is the only ECS role that reads the owner URL. Cognito administration is limited to the configured user pool, EFS writes are limited to the encrypted backup access point, SES sending is limited to the verified identity, and SNS confirmation is limited to configured topic ARNs.

## 6. Readiness, rollback, and workers

The container uses `/health` to prove that the Node process is alive. The ALB and Route 53 use `/ready`, which also checks PostgreSQL before admitting traffic. ECS keeps two API tasks and uses a 100/200 rolling policy, deployment circuit breaker, and automatic rollback.

CloudWatch alarms cover target 5xx percentage, p95 response time above the one-second requirement, unhealthy targets, RDS CPU/storage/connections, worker failures, domain-event dead letters, stopped ECS tasks, RDS availability/failover events, and synthetic readiness. Critical API and worker alarms are attached to ECS deployment rollback. Notifications are delivered through an encrypted SNS topic.

After backend services stabilize, the workflow builds the frontend against the promoted API. Hashed assets receive a one-year immutable cache policy, `index.html` is uploaded last with `no-store`, and only runtime entry files are invalidated. S3 versioning retains prior objects for rollback. Expand-and-contract backend changes keep the previous offline-capable frontend/service worker compatible during staged adoption.

Automatic rollback restores the previous application digest when a post-migration gate fails. The database is not automatically rolled back because destructive down-migrations can lose participant data. Instead, backward-compatible expansion ensures the previous application can continue using the expanded schema.

## 7. Deployment audit trail

For each environment, the pipeline produces a 90-day release evidence artifact containing:

- environment, commit SHA, immutable image URI, workflow URL, actor, and approval environment;
- start and completion timestamps;
- previous image and new image;
- migration command and deployed services;
- migration task definition and CloudFormation stack identity;
- smoke, security, immutable-image, and CloudWatch alarm results;
- final success or rollback outcome.

The manifest deliberately excludes database URLs, tokens, and secret values. CloudFormation stack events, GitHub environment approvals, ECR attestations, CloudWatch alarms, and the manifest together form the operational audit trail.

## 8. NFR and CIA alignment

| Requirement | Implemented deployment evidence | Remaining operational proof |
|---|---|---|
| API response <= 1 second | p95 ALB alarm and release verification gate | Retain representative 500-participant staging load-test results for each material performance change. |
| 99.9% availability | Two API tasks, Multi-AZ data services, `/ready`, rolling replacement, circuit breaker, alarm rollback, and synthetic health check | Measure monthly SLI/error budget; the controls support the objective but do not by themselves prove achieved uptime. |
| OWASP Top 10 | Frozen dependencies, CI/security gates, SBOM, image scan, OIDC, least privilege, secret injection, TLS-only smoke tests, and safe errors | Review scanner findings and threat model changes in each release. |
| Offline-capable reliability | Previous-client-compatible expand-and-contract releases and frontend entry point deployed last | Run offline upgrade/synchronization acceptance tests against the previous service-worker version. |
| 500 participants per event | Autoscaling and a performance gate location in the release process | Execute the production-like workload in staging and retain p95/error evidence. |
| Full audit trail | Signed provenance, GitHub approval history, CloudFormation events, release manifest, alarms, and rollback metadata | Export evidence to the organisation's retention store if 90 days is insufficient. |

CIA triad alignment is direct. Confidentiality is protected by OIDC, scoped secrets, least-privilege task roles, encryption, and HTTPS. Integrity is protected by digest-pinned artifacts, SBOM/provenance, migration controls, protected approvals, and evidence validation. Availability is protected by redundant tasks and data services, readiness routing, worker supervision, monitoring, and automatic application rollback.

## 9. Required GitHub configuration

Create `staging` and `production` environments. Configure a required reviewer and deployment branch protection for production. Define these repository/environment variables:

- repository: `AWS_BUILD_ROLE_ARN`, `AWS_REGION`, `ECR_REPOSITORY`;
- each environment: `AWS_STACK_NAME`, `AWS_DEPLOY_ROLE_ARN`, `AWS_MIGRATION_ROLE_ARN`, `AWS_VERIFY_ROLE_ARN`, `AWS_CLOUDFORMATION_ROLE_ARN`, `API_URL`, and `SMOKE_AUTH_PATH`;
- each environment secret: `SMOKE_BEARER_TOKEN`, using a dedicated least-privilege test identity and rotation policy.

Before the first automated release, bootstrap the infrastructure stack and OIDC roles manually under an approved administrator session. The OIDC role template depends on the stack-specific cluster, task-role, bucket, distribution, and task-definition ARNs; it is intentionally not self-bootstrapping.

## 10. Validation and limitations

Repository tests in `.vsms/tests/deployment-scripts.test.js`, `deployment-infrastructure.test.js`, and `deployment-workflow.test.js` verify production guards, digest enforcement, credential isolation, role scoping, alarms, worker consistency, release ordering, and secret-free evidence generation.

The workflow is executable after AWS and GitHub environment values are provisioned. It cannot prove a live deployment from a developer machine without those external accounts, approvals, domains, and credentials. Blue/green or canary traffic shifting remains a later improvement; the current rolling strategy is appropriate once its alarm and smoke gates are operational.

## References

- Prisma, "Deploying database changes with Prisma Migrate": https://www.prisma.io/docs/orm/prisma-client/deployment/deploy-database-changes-with-prisma-migrate
- GitHub, "OpenID Connect in Amazon Web Services": https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws
- GitHub, "Using artifact attestations to establish provenance for builds": https://docs.github.com/en/actions/concepts/security/artifact-attestations
- AWS, "Health checks for Application Load Balancer target groups": https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html
- AWS, "Amazon ECS deployment types": https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-types.html

Implementation authored by gpt-5.6-sol through T3 Code.
