-- Make audit_event append-only at the database level. Application discipline
-- is not enough for an audit trail: block UPDATE/DELETE with a trigger, and
-- strip those privileges from the runtime role when it exists (in production
-- the app connects as chemtrack_app; migrations run as the table owner).

CREATE OR REPLACE FUNCTION audit_event_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only (attempted %)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_event"
  FOR EACH ROW EXECUTE FUNCTION audit_event_immutable();

-- Runtime role privileges (skip silently if the role is absent, e.g. in CI).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chemtrack_app') THEN
    GRANT USAGE ON SCHEMA public TO chemtrack_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO chemtrack_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO chemtrack_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO chemtrack_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO chemtrack_app;
    REVOKE UPDATE, DELETE ON "audit_event" FROM chemtrack_app;
  END IF;
END;
$$;
