#!/bin/sh
# Creates the limited runtime role on first database initialisation.
# The audit_append_only migration grants table privileges and revokes
# UPDATE/DELETE on audit_event for this role.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE ROLE chemtrack_app LOGIN PASSWORD '${POSTGRES_APP_PASSWORD:-app_dev}';
  GRANT USAGE ON SCHEMA public TO chemtrack_app;
EOSQL
