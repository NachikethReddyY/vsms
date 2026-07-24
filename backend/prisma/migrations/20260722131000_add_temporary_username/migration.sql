-- Temporary issue #7 login identifier. The platform reference ERD moves this
-- field to User_Credentials; a later identity migration must preserve values.
ALTER TABLE "users" ADD COLUMN "username" VARCHAR(100);

UPDATE "users"
SET "username" = left(
  regexp_replace(lower(split_part("email", '@', 1)), '[^a-z0-9._-]', '-', 'g')
  || '-' || left("user_id"::text, 8),
  100
)
WHERE "username" IS NULL;

ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
ALTER TABLE "users" ADD CONSTRAINT "users_username_normalized_check"
  CHECK (username = lower(btrim(username)) AND username ~ '^[a-z0-9][a-z0-9._-]{2,99}$');
