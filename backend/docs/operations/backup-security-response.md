# Database backup security response

## Current repository action

`backend/backups/vsms-before-reset-20260730.sql` was removed from the working tree because it contained staff email addresses, password hashes, and token-related database rows. Backup file extensions are now ignored at both repository and backend scope. Runtime backups must be encrypted, access-controlled, retained outside the source tree, and restored only into an isolated environment.

Removing the file in a new commit does **not** erase it from existing Git objects, clones, forks, CI caches, or hosting-provider archives. This change intentionally does not rewrite history.

## Immediate rotation and containment

1. Treat every credential or bearer-token family represented in the snapshot as exposed. Disable the affected staff accounts or force password resets, revoke refresh-session families, invalidate active QR passes, and reissue only where needed.
2. Rotate database credentials, Cognito client secrets, application encryption keys, signing keys, and any environment secret that was present at the time of the export. Follow the encryption-key rotation runbook so old ciphertext is re-encrypted before retiring a key.
3. Review authentication, referral-delivery, QR, and administrative audit logs from the first commit containing the backup through completion of rotation. Record the incident and the identities performing each response action.
4. Remove copies from CI artifacts, build caches, developer file shares, and backup staging directories. Do not paste the SQL or discovered values into tickets or chat.

## Coordinated history purge (not performed here)

Schedule this as a repository-owner maintenance operation because it rewrites commit IDs and requires every clone and open branch to be cleaned or recreated.

```sh
git clone --mirror <repository-url> vsms-sanitized.git
cd vsms-sanitized.git
git filter-repo --path backend/backups/vsms-before-reset-20260730.sql --invert-paths
git push --force --mirror
```

After the force-push:

1. Ask the Git hosting provider to purge cached views and unreachable objects for the removed path.
2. Expire or delete CI caches and artifacts created from pre-purge commits.
3. Require collaborators to delete old clones and clone again; do not merge branches created from pre-purge history.
4. Run secret scanning across all refs, verify the file is absent with `git log --all -- backend/backups/vsms-before-reset-20260730.sql`, and confirm every credential rotation independently.
5. Preserve the incident record in the approved security system without storing the exposed values themselves.

## Backup policy

- Generate backups directly into an encrypted, restricted backup service; never under this repository.
- Use a dedicated least-privilege backup identity and log every export, restore, and deletion.
- Test restoration on synthetic or masked data where possible.
- Apply retention and cryptographic-erasure rules appropriate for medical and identity data.
