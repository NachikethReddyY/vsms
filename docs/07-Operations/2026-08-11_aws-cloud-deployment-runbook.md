# VSMS AWS cloud deployment runbook

This document records the 11 August 2026 synchronization and AWS deployment of VSMS from the school repository to the personal repository and then to Amplify, EC2, Cognito, and RDS.

## Current application release addendum

The later access-and-event-workflow release uses the same infrastructure. It must be pushed first to the school feature branch `nachiketh/access-and-event-workflow`, then as the identical commit to personal `main`. Amplify deploys the frontend from personal `main`; EC2 is updated from a clean `git archive` of that same commit. The release adds the four stable account types, event-specific duties, administrator reporting/management inheritance, Doctor-only clinical review assignment, one-step draft event creation, report filters, station defaults, and UI consistency documented in [2026-08-11-access-event-workflow.md](./2026-08-11-access-event-workflow.md).

Use variables derived from the committed revision so the archive, installation directory, and verification always agree:

```bash
cd /path/to/clean/vsms-worktree
release_sha="$(git rev-parse HEAD)"
release_short="$(git rev-parse --short=12 HEAD)"
release_archive="/tmp/vsms-${release_short}.tar.gz"

git archive --format=tar.gz --output="$release_archive" "$release_sha"
shasum -a 256 "$release_archive"

scp -i /Users/nr/Downloads/vsms.pem \
  "$release_archive" \
  ubuntu@52.4.124.186:/tmp/
```

On EC2, extract alongside the live release, install with the lockfile, generate Prisma Client, apply migrations using `/etc/vsms.env`, then replace the source using recoverable moves:

```bash
release_short='<12-character-commit>'
release_archive="/tmp/vsms-${release_short}.tar.gz"
release_dir="/opt/vsms-release-${release_short}"
rollback_dir="/opt/vsms-previous-$(date -u +%Y%m%dT%H%M%SZ)"

install -d -m 0755 "$release_dir"
tar -xzf "$release_archive" -C "$release_dir"
cd "$release_dir/backend"
pnpm install --frozen-lockfile

database_url="$(sudo sed -n 's/^DATABASE_URL=//p' /etc/vsms.env)"
test -n "$database_url"
DATABASE_URL="$database_url" pnpm prisma:generate
DATABASE_URL="$database_url" pnpm prisma:migrate

sudo systemctl stop \
  vsms-backend.service \
  vsms-domain-event-worker.service \
  vsms-report-worker.service
sudo mv /opt/vsms "$rollback_dir"
sudo mv "$release_dir" /opt/vsms
sudo chown -R ubuntu:ubuntu /opt/vsms
sudo install -d -m 0700 -o ubuntu -g ubuntu /opt/vsms/backend/logs
sudo systemctl start \
  vsms-backend.service \
  vsms-domain-event-worker.service \
  vsms-report-worker.service
```

Verify the migration and all services before accepting the deployment:

```bash
systemctl is-active vsms-backend.service
systemctl is-active vsms-domain-event-worker.service
systemctl is-active vsms-report-worker.service
curl --fail --silent https://vsms-52-4-124-186.nip.io/health

DATABASE_URL="$database_url" pnpm prisma migrate status
DATABASE_URL="$database_url" pnpm prisma db execute \
  --stdin <<'SQL'
SELECT template_key, name, active
FROM station_templates
WHERE template_key IN (
  'REGISTRATION', 'VISUAL_ACUITY', 'EYE_HEALTH',
  'CLINICAL_REVIEW', 'REFRACTION', 'COLOUR_VISION'
)
ORDER BY template_key;
SQL
```

The commands above are deliberately separate from the original local-PostgreSQL-to-RDS cutover. Do not restore the old database again for an ordinary application release.

> [!WARNING]
> Never commit AWS session credentials, the RDS master password, a complete `DATABASE_URL`, Cognito tokens, or `/etc/vsms.env`. The credentials used during the deployment were temporary AWS Academy credentials and are intentionally absent from this document.

> [!IMPORTANT]
> Keep the RDS-owned Secrets Manager entry. It is the source of truth for the RDS master credential. Its current rotation schedule is seven days. EC2 currently holds a static copy in root-owned `/etc/vsms.env`; refresh that file after a password rotation, or implement startup-time secret retrieval before using this deployment beyond the short-lived lab.

## Deployment outcome

| Component | Deployed value | Verified state |
|---|---|---|
| Personal repository | `NachikethReddyY/vsms` | School revision `8438da4` plus isolated PWA auth-routing fix `185b14a` |
| Frontend | `https://main.dg8qgdr6734ch.amplifyapp.com` | HTTP 200; Amplify job `11` succeeded at `185b14a` |
| API | `https://vsms-52-4-124-186.nip.io` | `/health` returns HTTP 200 |
| EC2 | `i-0ee982810f5f97cab`, `t3.small` | API and workers active |
| RDS | `vsms-postgres`, PostgreSQL 16.14 | Private, encrypted, Single-AZ, seven-day backups |
| Cognito | `us-east-1_80rhGEw7x` | Authorization-code flow with PKCE and Amplify callback |
| RDS snapshot | `vsms-postgres-post-cutover-20260811` | Available and encrypted |
| GitHub security scan | Run `31482743631` | Completed successfully |

The successful database transfer preserved one user and zero events and left all 39 Prisma migrations applied.

## Architecture

```mermaid
flowchart LR
    operator[Operator<br/>AWS CLI and SSH]
    browser[Staff browser]

    subgraph aws[AWS us-east-1]
        amplify[Amplify<br/>React and Vite frontend]
        cognito[Cognito<br/>Hosted UI and staff groups]

        subgraph ec2[EC2 vsms-app]
            nginx[Nginx and Let's Encrypt]
            api[Express API<br/>vsms-backend.service]
            event_worker[Domain-event worker]
            report_worker[Report worker]
            nginx --> api
        end

        rds[(RDS PostgreSQL 16.14<br/>private and encrypted)]
        secrets[Secrets Manager<br/>RDS-owned master credential]

        api --> rds
        event_worker --> rds
        report_worker --> rds
        api --> cognito
        secrets -. credential source .-> rds
    end

    browser -->|HTTPS| amplify
    amplify -->|HTTPS API requests| nginx
    browser -->|managed login| cognito
    operator -->|AWS CLI| aws
    operator -->|restricted SSH| ec2
```

## Protecting credentials

Install temporary AWS Academy credentials with a secure editor rather than placing them in shell history:

```bash
install -d -m 700 ~/.aws
touch ~/.aws/credentials
chmod 600 ~/.aws/credentials
vim ~/.aws/credentials

aws configure set region us-east-1 --profile default
aws configure set output json --profile default
aws sts get-caller-identity --profile default
```

The expected account is `912904791907`. Do not copy the credential values into this repository.

The database connection has this shape, but the password must never be substituted into documentation:

```text
postgresql://vsms_admin:<RDS-MANAGED-PASSWORD>@vsms-postgres.cgr0muccs8en.us-east-1.rds.amazonaws.com:5432/vsms?schema=public
```

Prisma accepts `?schema=public`; `psql`, `pg_dump`, and `pg_restore` do not. Strip the query string before using a Prisma URL with PostgreSQL command-line tools.

## Synchronizing the repositories

The original checkout contained uncommitted work and pointed to the school repository over SSH. It was preserved rather than reset.

```bash
cd /Users/nr/developer/vsms

gh auth setup-git
git remote set-url origin https://github.com/soc-DBSP/react-nodejs-project2-cryptix.git
git remote add personal https://github.com/NachikethReddyY/vsms.git

git fetch --prune origin
git fetch --prune personal
git rev-list --left-right --count origin/main...personal/main
git push personal origin/main:refs/heads/main
git fetch personal main
git rev-parse origin/main personal/main
```

Impact:

- Personal `main` was fast-forwarded; no force push was used.
- Both remote references resolved to commit `8438da4`.
- Existing uncommitted authentication work in `/Users/nr/developer/vsms` was not overwritten.
- Git transport changed from unavailable SSH authentication to authenticated HTTPS.

For future deployment work, use a clean checkout rather than the dirty historical working tree:

```bash
cd /Users/nr/Developer
git clone https://github.com/NachikethReddyY/vsms.git vsms-deploy
cd vsms-deploy
git remote add school https://github.com/soc-DBSP/react-nodejs-project2-cryptix.git
git fetch school
git merge --ff-only school/main
git push origin main
```

## Validating the synchronized revision

Install and generate Prisma Client before testing:

```bash
pnpm --dir backend install --frozen-lockfile
pnpm --dir react-user-dashboard install --frozen-lockfile
DATABASE_URL='postgresql://vsms_test:local-only@127.0.0.1:5433/vsms_test' \
  pnpm --dir backend prisma:generate
```

Run the repository checks:

```bash
pnpm --dir backend prisma:validate
pnpm --dir backend openapi:lint
pnpm --dir backend contracts:check
pnpm --dir backend test
pnpm --dir backend test:integration

pnpm --dir react-user-dashboard lint
pnpm --dir react-user-dashboard test
pnpm --dir react-user-dashboard build
```

Observed setup issues:

- This Mac had `pnpm 11.20.0` but no `corepack`; direct `pnpm` commands worked.
- A fresh backend install required an explicit `prisma generate` before tests could load `@prisma/client`.
- Database-backed backend tests require the isolated PostgreSQL test service; they must never target RDS production.
- Frontend lint, tests, production build, and PWA generation passed. Vite reported a non-blocking large-chunk warning.

## Inventorying the AWS lab

The following read-only commands established what could be reused:

```bash
aws ec2 describe-instances \
  --profile default \
  --region us-east-1 \
  --query 'Reservations[].Instances[].{Id:InstanceId,State:State.Name,Type:InstanceType,PublicDns:PublicDnsName}' \
  --output table

aws amplify list-apps \
  --profile default \
  --region us-east-1 \
  --query 'apps[].{Id:appId,Name:name,Repository:repository,Domain:defaultDomain}' \
  --output table

aws cognito-idp list-user-pools \
  --profile default \
  --region us-east-1 \
  --max-results 60 \
  --query 'UserPools[].{Id:Id,Name:Name}' \
  --output table

aws rds describe-db-instances \
  --profile default \
  --region us-east-1 \
  --output table
```

Impact: the existing EC2 host, Amplify app, and Cognito stack were reused. No duplicate compute or authentication resources were created. RDS was the only missing application tier.

## Creating private RDS PostgreSQL

### Create the subnet group

```bash
aws rds create-db-subnet-group \
  --profile default \
  --region us-east-1 \
  --db-subnet-group-name vsms-db-subnets \
  --db-subnet-group-description 'VSMS RDS subnets' \
  --subnet-ids \
    subnet-014a820d2cce22725 \
    subnet-0d1fba4e575012076 \
    subnet-07af75d4d71a9226d \
  --tags Key=Project,Value=VSMS Key=Environment,Value=development
```

Impact: RDS can place the database across three availability-zone subnets in the existing default VPC.

### Create database network access

```bash
aws ec2 create-security-group \
  --profile default \
  --region us-east-1 \
  --vpc-id vpc-05b26dd6a8561f15c \
  --group-name vsms-rds \
  --description 'PostgreSQL access from VSMS application only'

aws ec2 authorize-security-group-ingress \
  --profile default \
  --region us-east-1 \
  --group-id sg-0c358012ffee24daf \
  --ip-permissions \
  'IpProtocol=tcp,FromPort=5432,ToPort=5432,UserIdGroupPairs=[{GroupId=sg-0b5eed084c9b3868c,Description="PostgreSQL from vsms-app"}]'
```

Impact: PostgreSQL port 5432 accepts traffic from the `vsms-app` EC2 security group only. RDS has no public endpoint.

### Create the database

```bash
aws rds create-db-instance \
  --profile default \
  --region us-east-1 \
  --db-instance-identifier vsms-postgres \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 16.14 \
  --master-username vsms_admin \
  --manage-master-user-password \
  --db-name vsms \
  --allocated-storage 20 \
  --storage-type gp3 \
  --storage-encrypted \
  --db-subnet-group-name vsms-db-subnets \
  --vpc-security-group-ids sg-0c358012ffee24daf \
  --backup-retention-period 7 \
  --preferred-backup-window 18:00-18:30 \
  --preferred-maintenance-window sun:19:00-sun:19:30 \
  --no-publicly-accessible \
  --no-multi-az \
  --auto-minor-version-upgrade \
  --copy-tags-to-snapshot \
  --enable-cloudwatch-logs-exports postgresql upgrade \
  --tags Key=Name,Value=vsms-postgres Key=Project,Value=VSMS Key=Environment,Value=development
```

Impact:

- Creates an encrypted 20 GiB gp3 PostgreSQL 16.14 database.
- Creates an RDS-owned Secrets Manager secret for the master password.
- Enables seven-day automated backups and PostgreSQL/upgrade log exports.
- Uses Single-AZ `db.t3.micro`, appropriate for this lab but not high availability.

Do not click **Store a new secret** for the database password. RDS already created and owns the required secret shown in Secrets Manager.

### Wait for and inspect RDS

```bash
aws rds describe-db-instances \
  --profile default \
  --region us-east-1 \
  --db-instance-identifier vsms-postgres \
  --query 'DBInstances[0].{Status:DBInstanceStatus,Endpoint:Endpoint.Address,Port:Endpoint.Port,Encrypted:StorageEncrypted,Public:PubliclyAccessible,BackupRetention:BackupRetentionPeriod,Secret:MasterUserSecret.SecretStatus}' \
  --output json
```

Expected essentials:

```json
{
  "Status": "available",
  "Port": 5432,
  "Encrypted": true,
  "Public": false,
  "BackupRetention": 7,
  "Secret": "active"
}
```

## Building the RDS URL without exposing it

RDS-managed secret JSON contains the username and password but may omit the database endpoint and port. Query those fields from RDS instead of assuming they are present in the secret.

```bash
export VSMS_RDS_ENDPOINT="$(
  aws rds describe-db-instances \
    --profile default \
    --region us-east-1 \
    --db-instance-identifier vsms-postgres \
    --query 'DBInstances[0].Endpoint.Address' \
    --output text
)"

export VSMS_RDS_SECRET_ARN="$(
  aws rds describe-db-instances \
    --profile default \
    --region us-east-1 \
    --db-instance-identifier vsms-postgres \
    --query 'DBInstances[0].MasterUserSecret.SecretArn' \
    --output text
)"

rds_secret_json="$(
  aws secretsmanager get-secret-value \
    --profile default \
    --region us-east-1 \
    --secret-id "$VSMS_RDS_SECRET_ARN" \
    --query SecretString \
    --output text
)"

rds_database_url="$(
  printf '%s' "$rds_secret_json" |
    node -e '
      let input = "";
      process.stdin.on("data", chunk => input += chunk);
      process.stdin.on("end", () => {
        const secret = JSON.parse(input);
        const host = process.env.VSMS_RDS_ENDPOINT;
        process.stdout.write(
          `postgresql://${encodeURIComponent(secret.username)}:` +
          `${encodeURIComponent(secret.password)}@${host}:5432/vsms?schema=public`
        );
      });
    '
)"

case "$rds_database_url" in
  *undefined*) echo 'Invalid RDS URL' >&2; exit 1 ;;
esac

security add-generic-password \
  -U \
  -a vsms-app \
  -s vsms-rds-database-url \
  -w "$rds_database_url" >/dev/null

unset rds_secret_json rds_database_url
```

Impact: the complete connection string is stored in macOS Keychain without entering the repository or terminal output.

## Initial Amplify API configuration — superseded

The deployed frontend originally had no working API route. Job `9` temporarily embedded the public EC2 API URL directly into the frontend:

```bash
aws amplify update-app \
  --profile default \
  --region us-east-1 \
  --app-id dg8qgdr6734ch \
  --environment-variables \
    AMPLIFY_DIFF_DEPLOY=false,AMPLIFY_MONOREPO_APP_ROOT=react-user-dashboard,VITE_API_BASE_URL=https://vsms-52-4-124-186.nip.io/api/v1

aws amplify start-job \
  --profile default \
  --region us-east-1 \
  --app-id dg8qgdr6734ch \
  --branch-name main \
  --job-type RELEASE \
  --job-reason 'Configure production API endpoint'

aws amplify list-jobs \
  --profile default \
  --region us-east-1 \
  --app-id dg8qgdr6734ch \
  --branch-name main \
  --max-results 5 \
  --query 'jobSummaries[].{Id:jobId,Status:status,Commit:commitId}' \
  --output table
```

Impact: job `9` made ordinary API calls reach EC2, but it also made the browser's OAuth callback request cross-site. This caused the sign-in state-cookie failure documented later. **Do not reuse this absolute API setting.** It was superseded by job `10`, which uses `VITE_API_BASE_URL=/api/v1` with the Amplify reverse-proxy rule.

## Preparing the EC2 release

The EC2 deployment under `/opt/vsms` was a copied tree rather than a Git checkout. A clean archive was therefore created from the synchronized commit:

```bash
cd /Users/nr/developer/vsms
git archive \
  --format=tar.gz \
  --output=/tmp/vsms-8438da4.tar.gz \
  origin/main

shasum -a 256 /tmp/vsms-8438da4.tar.gz
```

Expected SHA-256:

```text
a6c1a9cacd0d2fae4f1176553c934f825d508d1ff28ba189d768f23b273b348d
```

Upload and install it without replacing the active release:

```bash
scp -i /Users/nr/Downloads/vsms.pem \
  /tmp/vsms-8438da4.tar.gz \
  ubuntu@52.4.124.186:/tmp/

ssh -i /Users/nr/Downloads/vsms.pem ubuntu@52.4.124.186 '
  set -eu
  test "$(sha256sum /tmp/vsms-8438da4.tar.gz | cut -d" " -f1)" = \
    "a6c1a9cacd0d2fae4f1176553c934f825d508d1ff28ba189d768f23b273b348d"

  sudo install -d -m 0755 -o ubuntu -g ubuntu /opt/vsms-release-8438da4
  tar -xzf /tmp/vsms-8438da4.tar.gz -C /opt/vsms-release-8438da4

  cd /opt/vsms-release-8438da4/backend
  pnpm install --frozen-lockfile
  DATABASE_URL="$(sudo sed -n "s/^DATABASE_URL=//p" /etc/vsms.env)" \
    pnpm prisma:generate
'
```

Impact: the new release was prepared alongside the running application. The live source was untouched until the database backup and restore succeeded.

## Migrating local PostgreSQL to RDS

### Capture the live source connection

The original `/etc/vsms.env.before-rds` did not yield a usable URL during one diagnostic. The still-running backend process was the authoritative source:

```bash
backend_pid="$(pgrep -f '/opt/vsms/backend/server.js' | head -1)"

old_database_url="$({
  sudo sh -c "tr '\\0' '\\n' < /proc/$backend_pid/environ" |
    sed -n 's/^DATABASE_URL=//p'
})"
```

This value must remain in a shell variable and must not be printed.

### Strip Prisma query parameters for PostgreSQL tools

```bash
strip_query() {
  printf '%s' "$1" |
    node -e '
      let value = "";
      process.stdin.on("data", chunk => value += chunk);
      process.stdin.on("end", () => {
        const url = new URL(value);
        url.search = "";
        process.stdout.write(url.toString());
      });
    '
}

old_psql_url="$(strip_query "$old_database_url")"
new_psql_url="$(strip_query "$new_database_url")"
```

### Back up, restore, and migrate

The final successful backup directory was under the Ubuntu user's home. `/var/lib/vsms` initially belonged to root with mode `0700`, so shell redirection there failed before any dump was written.

```bash
install -d -m 0700 /home/ubuntu/vsms-backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump_file="/home/ubuntu/vsms-backups/local-before-rds-$stamp.sql.gz"

old_users="$(psql "$old_psql_url" -Atc 'select count(*) from public.users;')"
old_events="$(psql "$old_psql_url" -Atc 'select count(*) from public.events;')"

new_tables="$({
  psql "$new_psql_url" -Atc \
    "select count(*) from information_schema.tables where table_schema='public';"
})"
test "$new_tables" = '0'

sudo systemctl stop vsms-backend.service

pg_dump "$old_psql_url" \
  --format=plain \
  --no-owner \
  --no-privileges |
  gzip -9 > "$dump_file"

gzip -t "$dump_file"
chmod 0600 "$dump_file"

gzip -dc "$dump_file" |
  sed '/^SET transaction_timeout =/d' |
  psql --set ON_ERROR_STOP=1 "$new_psql_url"

restored_users="$(psql "$new_psql_url" -Atc 'select count(*) from public.users;')"
restored_events="$(psql "$new_psql_url" -Atc 'select count(*) from public.events;')"

test "$restored_users" = "$old_users"
test "$restored_events" = "$old_events"

cd /opt/vsms-release-8438da4/backend
DATABASE_URL="$new_database_url" pnpm prisma:migrate
```

The `transaction_timeout` line was removed because the EC2 PostgreSQL 18 client emitted a setting unsupported by the PostgreSQL 16 RDS server.

Observed result:

```text
SOURCE COUNTS users=1 events=0
RESTORED COUNTS users=1 events=0
39 migrations found
All migrations have been successfully applied
```

### Replace the release and restart

The successful cutover used recoverable moves rather than deleting the old application:

```bash
stamp='20260811T114245Z'

sudo cp -a /etc/vsms.env "/etc/vsms.env.rollback-$stamp"

# Replace only DATABASE_URL in /etc/vsms.env using the unredacted Keychain value.
# Do not put the value in the repository or this document.
sudo chmod 0600 /etc/vsms.env
sudo chown root:root /etc/vsms.env

sudo mv /opt/vsms "/opt/vsms-previous-$stamp"
sudo mv /opt/vsms-release-8438da4 /opt/vsms
sudo chown -R ubuntu:ubuntu /opt/vsms
sudo install -d -m 0700 -o ubuntu -g ubuntu /opt/vsms/backend/logs

sudo systemctl daemon-reload
sudo systemctl start vsms-backend.service
curl --fail --silent https://vsms-52-4-124-186.nip.io/health
```

Impact:

- The API now runs commit `8438da4` against private RDS.
- The prior source tree, environment, and compressed PostgreSQL dump remain available for rollback.
- The first Nginx request during restart returned a temporary 502; the retry returned HTTP 200.
- Local PostgreSQL was stopped only after the restarted API proved it was using RDS.

## Aligning Cognito with Amplify

The existing Cognito stack still used a localhost callback. Update it with the previous template and the live Amplify origin:

```bash
aws cloudformation update-stack \
  --profile default \
  --region us-east-1 \
  --stack-name vsms-staff-development \
  --use-previous-template \
  --parameters \
    ParameterKey=EnvironmentName,UsePreviousValue=true \
    ParameterKey=FrontendUrl,ParameterValue=https://main.dg8qgdr6734ch.amplifyapp.com
```

The matching backend settings in root-owned `/etc/vsms.env` are:

```text
COGNITO_REDIRECT_URI=https://main.dg8qgdr6734ch.amplifyapp.com/auth/callback
COGNITO_LOGOUT_URI=https://main.dg8qgdr6734ch.amplifyapp.com
CORS_ORIGINS=https://main.dg8qgdr6734ch.amplifyapp.com
PUBLIC_APP_ORIGIN=https://main.dg8qgdr6734ch.amplifyapp.com
```

Restart and verify:

```bash
sudo systemctl restart vsms-backend.service
curl --fail --silent https://vsms-52-4-124-186.nip.io/health

aws cognito-idp describe-user-pool-client \
  --profile default \
  --region us-east-1 \
  --user-pool-id us-east-1_80rhGEw7x \
  --client-id 7edl9gil1d8o53onuqbqs2in89 \
  --query 'UserPoolClient.{CallbackURLs:CallbackURLs,LogoutURLs:LogoutURLs,OAuthFlows:AllowedOAuthFlows,OAuthScopes:AllowedOAuthScopes,OAuthEnabled:AllowedOAuthFlowsUserPoolClient}' \
  --output json
```

Verified behavior:

- Callback is the Amplify `/auth/callback` route.
- Logout returns to the Amplify origin.
- OAuth flow is `code` with scopes `openid`, `email`, and `profile`.
- The API-generated authorize URL uses PKCE method `S256`.

### Keep authentication same-origin with Amplify rewrites

Most of the production redirect chain was configured without application-code changes. The frontend defaults to the relative API prefix `/api/v1`, and Amplify already had these two routing rules:

| Order | Source | Target | Status | Purpose |
|---|---|---|---|---|
| 1 | `/api/<*>` | `https://vsms-52-4-124-186.nip.io/api/<*>` | `200` | Reverse-proxy API requests through the Amplify hostname |
| 2 | SPA route regular expression | `/index.html` | `200` | Serve the React application for client-side routes such as `/auth/callback` |

The first build used an absolute `VITE_API_BASE_URL` pointing directly at the EC2 hostname. That made the callback an XHR from `amplifyapp.com` to `nip.io`. The API's secure `SameSite=Lax` OAuth cookies correctly did not accompany that cross-site XHR, so the backend rejected the callback state. The **Start a new sign-in** link then repeated the same broken route.

Keep the browser-side API URL relative and let Amplify perform the server-side proxy:

```bash
aws amplify update-app \
  --profile default \
  --region us-east-1 \
  --app-id dg8qgdr6734ch \
  --environment-variables \
    AMPLIFY_DIFF_DEPLOY=false,AMPLIFY_MONOREPO_APP_ROOT=react-user-dashboard,VITE_API_BASE_URL=/api/v1

aws amplify start-job \
  --profile default \
  --region us-east-1 \
  --app-id dg8qgdr6734ch \
  --branch-name main \
  --job-type RELEASE \
  --job-reason 'Use Amplify same-origin API proxy for Cognito cookies'
```

Amplify job `10` completed with `SUCCEED`. Verify the active configuration and proxy without exposing cookie values:

```bash
aws amplify get-app \
  --profile default \
  --region us-east-1 \
  --app-id dg8qgdr6734ch \
  --query 'app.{Environment:environmentVariables,Rules:customRules}' \
  --output json

curl --fail --silent \
  https://main.dg8qgdr6734ch.amplifyapp.com/api/v1/auth/config-status

curl --silent --show-error --dump-header - --output /dev/null \
  'https://main.dg8qgdr6734ch.amplifyapp.com/api/v1/auth/authorize?returnTo=%2Fevents' \
  | awk 'BEGIN{IGNORECASE=1} /^HTTP\// || /^location:/ {print} /^set-cookie:/ {line=$0; sub(/=[^;]*/, "=<redacted>", line); print line}'
```

Expected results:

- The config endpoint returns HTTP 200.
- The authorize endpoint returns HTTP 302 to Cognito.
- `vsms_oauth_state`, `vsms_oauth_verifier`, and `vsms_oauth_return_to` are set on the Amplify hostname with `Secure`, `HttpOnly`, and `SameSite=Lax` as applicable.
- Cognito returns to `https://main.dg8qgdr6734ch.amplifyapp.com/auth/callback`.
- The callback calls the relative `/api/v1/auth/callback`, so the OAuth cookies are sent and the state check can succeed.

Amplify stores build/deployment artifacts in AWS-managed S3 and serves them through its managed hosting layer. The route behavior above is controlled by **Amplify custom rules**, not by editing application source and not by configuring a separate user-owned S3 website redirect. The SPA fallback is a rewrite (`200`), not a browser redirect (`301` or `302`), so the visible callback URL remains intact while `index.html` loads.

#### PWA navigation exception required for `/api/*`

Job `10` exposed one remaining browser-only conflict. Direct `curl` requests reached the Amplify proxy, but the installed Workbox service worker registered its SPA `NavigationRoute` before its API `NetworkOnly` rule. A browser navigation to `/api/v1/auth/authorize` was therefore answered with cached `index.html`, and React displayed **Page not found**.

This required one build-configuration line. No authentication component, API controller, database model, or business workflow changed:

```diff
 workbox: {
   navigateFallback: 'index.html',
+  navigateFallbackDenylist: [/^\/api\//i],
   runtimeCaching: [
```

The isolated fix was committed only to the personal repository:

```text
185b14af65f5e42cdf9c5b1b4488960a38553cb0
fix(auth): exclude API routes from PWA navigation fallback
```

Amplify auto-deployed it as job `11`; build, deploy, and verify all returned `SUCCEED`. Validate the generated worker and real browser navigation:

```bash
curl --fail --silent \
  'https://main.dg8qgdr6734ch.amplifyapp.com/sw.js?deploy=11' \
  | grep -F 'denylist:[/^\/api\//i]'
```

Then hard-refresh the Amplify home page once, or use a new private window, before selecting **Sign in**. The old worker may continue controlling a tab that stayed open during deployment. The verified route is now:

```text
Amplify Sign in link
  -> /api/v1/auth/authorize
  -> Amplify /api/<*> reverse proxy
  -> EC2/Nginx/Express authorize route
  -> Cognito managed sign-in
  -> Amplify /auth/callback
  -> Amplify /api/<*> reverse proxy
  -> EC2 token exchange and session cookies
  -> /events
```

### Verify the first administrator

`admin@vsms.local` already existed, so creating a duplicate would have produced a conflict. It was verified in both authorization stores:

| Store | Required state | Verified state |
|---|---|---|
| PostgreSQL | Active local profile with application role | `ACTIVE`, system role `ADMIN`, role `ADMINISTRATOR` |
| Cognito | Enabled, confirmed identity in mapped group | `CONFIRMED`, enabled, group `Admin` |

The Cognito subject and PostgreSQL `cognito_sub` also match. This two-sided role agreement is required because VSMS intersects the local roles with the Cognito token groups before granting access.

Verify Cognito without displaying credentials:

```bash
aws cognito-idp admin-get-user \
  --profile default \
  --region us-east-1 \
  --user-pool-id us-east-1_80rhGEw7x \
  --username admin@vsms.local \
  --query '{Username:Username,Status:UserStatus,Enabled:Enabled,Attributes:UserAttributes[?Name==`sub` || Name==`email` || Name==`name`]}' \
  --output json

aws cognito-idp list-users-in-group \
  --profile default \
  --region us-east-1 \
  --user-pool-id us-east-1_80rhGEw7x \
  --group-name Admin \
  --query 'Users[].{Username:Username,Status:UserStatus,Enabled:Enabled}' \
  --output table
```

After signing in as this administrator, use the VSMS Staff screen to create additional people. That application route creates the PostgreSQL profile, assigns the application role, creates the Cognito identity, and adds the mapped Cognito group as one audited workflow. Do not create routine staff independently in only Cognito or only PostgreSQL; a one-sided account will not receive effective access.

## Giving EC2 AWS permissions

The EC2 instance initially had no IAM instance profile, so Cognito administrator operations could not obtain signed AWS credentials.

```bash
aws ec2 associate-iam-instance-profile \
  --profile default \
  --region us-east-1 \
  --instance-id i-0ee982810f5f97cab \
  --iam-instance-profile Name=LabInstanceProfile

aws ec2 describe-iam-instance-profile-associations \
  --profile default \
  --region us-east-1 \
  --query 'IamInstanceProfileAssociations[].{State:State,InstanceId:InstanceId,Profile:IamInstanceProfile.Arn}' \
  --output table
```

Impact: the EC2-hosted AWS SDK can call Cognito without static AWS keys. A signed `ListGroups` request succeeded. `LabInstanceProfile` is deliberately lab-scoped and broader than a production least-privilege role; replace it outside AWS Academy.

## Running the background workers

The repository architecture requires separate domain-event and report workers. The lifecycle-email worker remained disabled because `LIFECYCLE_EMAIL_ENABLED=false`.

The installed units use this pattern:

```ini
[Unit]
Description=VSMS background worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=/opt/vsms/backend
EnvironmentFile=/etc/vsms.env
ExecStart=/usr/bin/node /opt/vsms/backend/scripts/domain-event-worker.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=15
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/vsms /opt/vsms/backend/logs

[Install]
WantedBy=multi-user.target
```

Actual worker scripts:

| Unit | Script |
|---|---|
| `vsms-domain-event-worker.service` | `scripts/domain-event-worker.js` |
| `vsms-report-worker.service` | `scripts/report-worker.js` |

Enable and inspect them:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now \
  vsms-domain-event-worker.service \
  vsms-report-worker.service

systemctl is-active vsms-backend.service
systemctl is-active vsms-domain-event-worker.service
systemctl is-active vsms-report-worker.service

sudo journalctl \
  -u vsms-domain-event-worker.service \
  -u vsms-report-worker.service \
  --since '-10 minutes' \
  --no-pager
```

Impact: queued domain events and report exports can now be processed independently of HTTP requests.

## Verifying the running deployment

### Public health

```bash
curl -sS -o /dev/null -w 'frontend=%{http_code}\n' \
  https://main.dg8qgdr6734ch.amplifyapp.com/

curl -sS -o /dev/null -w 'api=%{http_code}\n' \
  https://vsms-52-4-124-186.nip.io/health
```

Expected:

```text
frontend=200
api=200
```

### Service status

```bash
ssh -i /Users/nr/Downloads/vsms.pem ubuntu@52.4.124.186 '
  systemctl is-active vsms-backend.service
  systemctl is-active vsms-domain-event-worker.service
  systemctl is-active vsms-report-worker.service
  systemctl is-active postgresql.service || true
'
```

Expected:

```text
active
active
active
inactive
```

### Prove the API uses RDS without exposing credentials

```bash
backend_pid="$(pgrep -f '/opt/vsms/backend/server.js' | head -1)"

running_database_url="$({
  sudo sh -c "tr '\\0' '\\n' < /proc/$backend_pid/environ" |
    sed -n 's/^DATABASE_URL=//p'
})"

printf '%s' "$running_database_url" |
  node -e '
    let value = "";
    process.stdin.on("data", chunk => value += chunk);
    process.stdin.on("end", () => {
      const url = new URL(value);
      console.log({
        host: url.hostname,
        port: url.port,
        database: url.pathname,
        schema: url.searchParams.get("schema"),
        credentialsPresent: Boolean(url.username && url.password)
      });
    });
  '
```

Expected safe output identifies the RDS host, port 5432, database `/vsms`, schema `public`, and confirms credentials are present without printing them.

### Verify RDS and backups

```bash
aws rds describe-db-instances \
  --profile default \
  --region us-east-1 \
  --db-instance-identifier vsms-postgres \
  --query 'DBInstances[0].{Status:DBInstanceStatus,Engine:Engine,Version:EngineVersion,Class:DBInstanceClass,Encrypted:StorageEncrypted,Public:PubliclyAccessible,BackupRetention:BackupRetentionPeriod,Logs:EnabledCloudwatchLogsExports,SecretStatus:MasterUserSecret.SecretStatus}' \
  --output json

aws rds describe-db-snapshots \
  --profile default \
  --region us-east-1 \
  --db-snapshot-identifier vsms-postgres-post-cutover-20260811 \
  --query 'DBSnapshots[0].{Status:Status,Percent:PercentProgress,Encrypted:Encrypted}' \
  --output json
```

The post-cutover snapshot reached `available`, `100%`, and `Encrypted=true`.

### Verify GitHub security scanning

```bash
gh run view 31482743631 \
  --repo NachikethReddyY/vsms \
  --json status,conclusion,url,workflowName
```

Expected conclusion: `success`.

## Rolling back

Rollback material retained on EC2:

```text
/opt/vsms-previous-20260811T114245Z
/etc/vsms.env.rollback-20260811T114245Z
/home/ubuntu/vsms-backups/local-before-rds-20260811T114245Z.sql.gz
```

To return the API to the previous source and local database configuration:

```bash
sudo systemctl stop \
  vsms-backend.service \
  vsms-domain-event-worker.service \
  vsms-report-worker.service

sudo mv /opt/vsms /opt/vsms-failed-rollback
sudo mv /opt/vsms-previous-20260811T114245Z /opt/vsms
sudo install \
  -m 0600 \
  -o root \
  -g root \
  /etc/vsms.env.rollback-20260811T114245Z \
  /etc/vsms.env

sudo systemctl start postgresql.service
sudo systemctl start vsms-backend.service
curl --fail --silent https://vsms-52-4-124-186.nip.io/health
```

Do not delete RDS, its secret, the old source tree, or the compressed dump until the application has completed acceptance testing.

## Troubleshooting

| Symptom | Cause observed in this deployment | Resolution |
|---|---|---|
| AWS CLI reports `ExpiredToken` | Old AWS Academy session remained in `~/.aws/credentials` | Replace the complete default credential block and verify with STS |
| Git fetch reports `Permission denied (publickey)` | Repository remotes used SSH without a usable key | Use authenticated HTTPS remotes via `gh auth setup-git` |
| `@prisma/client did not initialize yet` | Fresh pnpm install had not generated Prisma Client | Run `pnpm --dir backend prisma:generate` |
| `psql: invalid URI query parameter: schema` | Prisma-only `?schema=public` was passed to libpq | Strip the query string for `psql`, `pg_dump`, and `pg_restore` |
| URL contained `undefined:undefined` | RDS-managed secret omitted host and port | Query endpoint/port from `describe-db-instances` and rebuild the URL |
| Backup file permission denied under `/var/lib/vsms` | Parent directory was root-owned mode `0700` | Use `/home/ubuntu/vsms-backups`, mode `0700`, dump mode `0600` |
| Old backup file produced an empty database URL | Saved file was not the authoritative running configuration | Read `DATABASE_URL` from the running backend process environment without printing it |
| Temporary Nginx 502 during cutover | API process was restarting | Retry health until the systemd service becomes active |
| Login redirects to localhost | Cognito stack and EC2 environment were not aligned with Amplify | Update `FrontendUrl` and all matching backend origins |
| Cognito login returns to “Sign-in couldn't be completed” | Absolute frontend API URL made the callback XHR cross-site, withholding `SameSite=Lax` OAuth cookies | Use `VITE_API_BASE_URL=/api/v1`, retain the Amplify `/api/<*>` proxy rule, rebuild, then hard-refresh the open page |
| “Start a new sign-in” opens React “Page not found” at `/api/v1/auth/authorize` | Workbox SPA navigation fallback intercepted the API navigation before Amplify | Add `navigateFallbackDenylist: [/^\/api\//i]`, deploy job `11`, then hard-refresh once |
| Fixed route still shows the old page in an already-open tab | The tab is controlled by the pre-job-11 service worker | Close all tabs for the Amplify site and open it in a new private window, or hard-refresh and retry |

## Evidence, findings, and deployment path

### Evidence

| ID | Observation | Reproduction command | Result |
|---|---|---|---|
| E-001 | Personal repository contains the school release plus the routing fix | Inspect personal `main` history | School base `8438da4`; isolated fix `185b14a` |
| E-002 | Public services respond | `curl` frontend and `/health` | Both returned HTTP 200 |
| E-003 | API uses RDS | Parse running process `DATABASE_URL` and query `current_database()` | Host is `vsms-postgres...rds.amazonaws.com`; user is `vsms_admin` |
| E-004 | Database migration preserved data | Compare source and restored counts | `users=1`, `events=0` on both sides |
| E-005 | Runtime topology is active | `systemctl is-active` for API and workers | All three services active; local PostgreSQL inactive |
| E-006 | Cognito production flow is aligned | `describe-user-pool-client` and authorize URL inspection | Amplify callback, code flow, PKCE S256 |
| E-007 | Security automation passed | `gh run view 31482743631` | Workflow conclusion `success` |
| E-008 | Recovery points exist | RDS snapshot query plus EC2 dump validation | Encrypted snapshot available; gzip dump valid |
| E-009 | Same-origin auth proxy and PWA exception are active | Inspect live `sw.js`, then select Sign in in a clean browser | Worker denies `/api/*` from SPA fallback; browser reaches Cognito managed sign-in |
| E-010 | First administrator is aligned | Query local profile, Cognito identity, and `Admin` group | Active `ADMINISTRATOR`; confirmed Cognito identity; matching subject |

### Findings

#### F-001 — Cloud deployment is operational

- Status: validated
- Evidence: E-001 through E-010
- Impact: the synchronized personal revision is served by Amplify and EC2, uses private RDS, authenticates through Cognito, and has background processing and recovery points.
- Confidence: high

#### F-002 — Secrets Manager entry is required

- Status: validated
- Evidence: E-003 and E-008
- Impact: deleting the RDS-owned secret removes the managed master credential and disrupts recovery and rotation workflows.
- Remediation: retain the secret; never create a duplicate manual database secret unless the deployment architecture is intentionally changed.
- Confidence: high

#### F-003 — Current deployment is demonstration-grade

- Status: accepted risk
- Evidence: E-002, E-003, and E-005
- Impact: Single-AZ RDS, AWS Academy's broad `LabRole`, default Amplify/nip.io hostnames, static EC2 database configuration, and disabled lifecycle email are not a long-term production operating model.
- Remediation: for persistent hosting, use Multi-AZ RDS, a least-privilege EC2 role, a custom domain, startup-time secret retrieval, and configured lifecycle email where required.
- Confidence: high

### Deployment path

1. Synchronize school `main` into personal `main` — evidence E-001.
2. Reuse the existing Amplify, EC2, and Cognito resources — evidence E-002 and E-006.
3. Create private encrypted RDS and its RDS-owned secret — evidence E-003 and E-008.
4. Back up local PostgreSQL and restore it into RDS — evidence E-004.
5. Apply Prisma migrations and atomically replace the EC2 release — evidence E-003 and E-005.
6. Align Amplify, API CORS, Cognito callback/logout, and PKCE — evidence E-002 and E-006.
7. Route `/api/*` through Amplify so the OAuth state cookies remain same-origin — evidence E-009.
8. Verify the first administrator on both sides of authorization — evidence E-010.
9. Start workers, attach the lab instance role, and verify recovery/security controls — evidence E-005, E-007, and E-008.

Residual risks are listed in F-003 and must be reconsidered before processing real health information or extending the deployment beyond the AWS Academy lab.

## Final operational checklist

- [x] Personal repository contains the selected school commit plus the isolated PWA routing fix.
- [x] Frontend returns HTTP 200.
- [x] API health returns HTTP 200.
- [x] RDS is private and encrypted.
- [x] RDS password is managed by Secrets Manager.
- [x] Database data and migration counts were verified.
- [x] API and required workers are active.
- [x] Cognito callback and logout URLs match Amplify.
- [x] Amplify proxies `/api/*`; frontend API base is relative `/api/v1`.
- [x] `admin@vsms.local` is active locally, confirmed in Cognito, and in the `Admin` group.
- [x] EC2 can make signed Cognito administrator calls.
- [x] Automated backups, database logs, local dump, and encrypted snapshot exist.
- [x] GitHub security scan completed successfully.
- [ ] Refresh EC2 `DATABASE_URL` after RDS rotates the master password, or implement startup-time secret retrieval.
- [ ] Complete browser acceptance testing with each required staff role.
- [ ] Remove rollback copies only after acceptance testing and retention approval.
