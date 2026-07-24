-- Intentionally non-executable legacy entry point.
--
-- The database is owned by Prisma migrations in ../prisma/migrations. The old
-- SQL bootstrap used incompatible integer identities and plaintext passwords.
-- Refuse accidental use instead of silently creating an insecure parallel schema.
DO $$
BEGIN
  RAISE EXCEPTION 'Do not run backend/db/init.sql; use npm run prisma:migrate';
END
$$;
