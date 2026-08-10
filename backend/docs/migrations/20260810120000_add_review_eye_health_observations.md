# Migration `20260810120000_add_review_eye_health_observations`

## Change

```sql
ALTER TABLE "reviews" ADD COLUMN "eye_health_observations" JSONB;
```

Adds an optional JSONB column on `reviews` for reviewer addendum observations (`Review.eyeHealthObservations`). Screener station results continue to live in `screening_results.result_data`.

## Forward / data compatibility

| Concern | Behaviour |
|---|---|
| Existing review rows | Column is nullable; existing rows remain valid with `NULL`. |
| Application reads | `serializeReview` / decision responses treat missing values as `null`. |
| Application writes | Review decision Zod accepts optional `eyeHealthObservations`. Decisions without the field leave the column `NULL`. |
| Screener EYE_HEALTH results | Stored only on `screening_results`; this migration does not rewrite or migrate historical screening JSON. |
| Downtime | Additive column; online deploy is compatible with mixed old/new app versions that ignore unknown JSON or omit the field. |

## Failure / rollback validation

**Apply (forward)**

```bash
pnpm --dir backend prisma:migrate
# or: pnpm --dir backend exec prisma migrate deploy
```

**Verify**

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'reviews' AND column_name = 'eye_health_observations';
-- expect: jsonb, YES
```

**Rollback (manual; Prisma does not auto-generate down)**

```sql
ALTER TABLE "reviews" DROP COLUMN IF EXISTS "eye_health_observations";
```

Then remove or mark the migration as rolled back in `_prisma_migrations` only if you intentionally rewind that environment.

**Rollback risk**

- Dropping the column permanently discards any reviewer addendum JSON written after deploy.
- Screener `screening_results` for `EYE_HEALTH` are unaffected.
- Safe when the column is still unused or after an intentional data-retention decision.

## Local validation performed

- Migration applied successfully on local Postgres during development.
- Review decision unit tests cover optional observations validation.
- Review integration tests persist and read `eyeHealthObservations` when provided.
