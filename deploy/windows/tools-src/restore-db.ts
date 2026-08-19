// Snapshot restorer for the Windows offline bundle.
//
// The bundled portable PostgreSQL (zonky binaries) ships WITHOUT psql or
// pg_restore, so the installer restores the plain-SQL snapshot through this
// tool instead. It is esbuild-bundled with ZERO externals (node-postgres is
// pure JS), so it runs anywhere the packaged node.exe runs.
//
// The snapshot is produced by pg_dump --inserts (no COPY blocks — the
// simple-query protocol cannot replay COPY FROM stdin). Roles and CREATE
// DATABASE cannot run inside a transaction, so they are issued as separate
// statements; the rest of the dump replays as ONE simple-query message,
// which PostgreSQL wraps in an implicit transaction (atomic restore).
//
// Usage:
//   node restore-db.cjs --pgport 5433 --superuser chemtrack_super \
//     --pwfile <path> --dump <snapshot.sql.gz> \
//     --owner-password <pw> --app-password <pw> [--dbname chemtrack] [--host 127.0.0.1]

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Client } from "pg";

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  if (fallback !== undefined) return fallback;
  console.error(`Missing required argument --${name}`);
  process.exit(2);
}

const host = arg("host", "127.0.0.1");
const port = Number(arg("pgport", "5433"));
const superuser = arg("superuser", "chemtrack_super");
const pwfile = arg("pwfile");
const dumpPath = arg("dump");
const dbname = arg("dbname", "chemtrack");
const ownerPassword = arg("owner-password");
const appPassword = arg("app-password");

const superPassword = readFileSync(pwfile, "utf8").split(/\r?\n/)[0].trim();

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function connect(database: string): Promise<Client> {
  const client = new Client({ host, port, user: superuser, password: superPassword, database });
  await client.connect();
  return client;
}

async function main() {
  // --- Phase 1: roles + database, on the maintenance DB -----------------
  const admin = await connect("postgres");
  try {
    const existing = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbname]);
    if (existing.rowCount && existing.rowCount > 0) {
      console.error(
        JSON.stringify({
          ok: false,
          error: `Database "${dbname}" already exists — refusing to overwrite. ` +
            `Use the installer's --reset flow to start over.`,
        }),
      );
      process.exit(3);
    }

    for (const [role, password] of [
      ["chemtrack_owner", ownerPassword],
      ["chemtrack_app", appPassword],
    ] as const) {
      const has = await admin.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [role]);
      if (has.rowCount && has.rowCount > 0) {
        await admin.query(`ALTER ROLE ${role} WITH LOGIN PASSWORD ${quoteLiteral(password)}`);
      } else {
        await admin.query(`CREATE ROLE ${role} WITH LOGIN PASSWORD ${quoteLiteral(password)}`);
      }
    }
    await admin.query(`CREATE DATABASE ${dbname} OWNER chemtrack_owner`);
  } finally {
    await admin.end();
  }

  // --- Phase 2: replay the snapshot into the new database ---------------
  const raw = gunzipSync(readFileSync(dumpPath)).toString("utf8");
  // pg_dump >= 16.10 emits psql meta-command lines (\restrict, \unrestrict,
  // \connect). The server does not understand backslash commands — strip
  // every line that starts with one.
  const sql = raw
    .split("\n")
    .filter((line) => !line.startsWith("\\"))
    .join("\n");

  const db = await connect(dbname);
  try {
    // Single multi-statement simple query = implicit transaction = atomic.
    await db.query(sql);

    // pg_dump >= 15 empties search_path for the session (set_config at the
    // top of the dump); restore it before running unqualified statements.
    await db.query(`SET search_path TO public`);

    // The dump's ACL section restores recorded grants; re-assert the runtime
    // grants explicitly for belt-and-braces.
    await db.query(`GRANT USAGE ON SCHEMA public TO chemtrack_app`);
    await db.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO chemtrack_app`);
    await db.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO chemtrack_app`);
    await db.query(`REVOKE UPDATE, DELETE ON "audit_event" FROM chemtrack_app`);

    const containers = await db.query(`SELECT count(*)::int AS n FROM container`);
    const events = await db.query(`SELECT coalesce(max(seq), 0)::bigint AS max_seq, count(*)::int AS n FROM audit_event`);
    const users = await db.query(`SELECT count(*)::int AS n FROM "user"`);
    console.log(
      JSON.stringify({
        ok: true,
        database: dbname,
        containers: containers.rows[0].n,
        auditEvents: events.rows[0].n,
        auditMaxSeq: String(events.rows[0].max_seq),
        users: users.rows[0].n,
      }),
    );
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error?.message ?? error) }));
  process.exit(1);
});
