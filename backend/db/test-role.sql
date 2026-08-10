-- The disposable test role owns only this isolated database. It has enough
-- privilege for Prisma to rebuild its schema, but no server-wide admin rights.
REVOKE ALL ON DATABASE vsms_test FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE vsms_test TO vsms_test;
ALTER ROLE vsms_test NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
