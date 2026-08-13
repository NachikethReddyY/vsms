#!/bin/sh
set -eu

psql \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=ON_ERROR_STOP=1 \
  --set=role_password="$POSTGRES_PASSWORD" <<'SQL'
CREATE ROLE vsms_test
  LOGIN
  PASSWORD :'role_password'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION;
CREATE DATABASE vsms_test OWNER vsms_test;
REVOKE ALL ON DATABASE vsms_test FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE vsms_test TO vsms_test;
SQL
