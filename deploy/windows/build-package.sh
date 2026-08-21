#!/usr/bin/env bash
# Build the self-contained Windows 10/11 offline bundle:
#   ChemTrack-<version>-win64.zip
#
# Runs entirely on Linux. Requires: pnpm install done, a local PostgreSQL 16
# with the dev roles (chemtrack_owner/owner_dev with CREATEDB), plus a
# rehearsal superuser for the restore rehearsal:
#   CREATE ROLE chemtrack_super LOGIN SUPERUSER PASSWORD 'rehearsal_dev';
# Override any of the SNAP_*/REHEARSAL_* env vars below to match your setup.
#
# Usage: pnpm package:win [-- --xlsx /path/to/legacy.xlsx]

set -euo pipefail

# ---------------------------------------------------------------------------
# Pinned component versions (verify + bump deliberately)
# ---------------------------------------------------------------------------
NODE_VERSION="22.23.2"
NODE_SHA256="1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip"

PG_VERSION="16.14.0"
PG_JAR_SHA1="031f0c1319c2c9e3ec3482eb6db2112ff594ee29"
PG_JAR_URL="https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-windows-amd64/${PG_VERSION}/embedded-postgres-binaries-windows-amd64-${PG_VERSION}.jar"

# ---------------------------------------------------------------------------
# Local database endpoints (defaults match the dev environment)
# ---------------------------------------------------------------------------
SNAP_PG_HOST="${SNAP_PG_HOST:-localhost}"
SNAP_PG_PORT="${SNAP_PG_PORT:-5432}"
SNAP_OWNER_USER="${SNAP_OWNER_USER:-chemtrack_owner}"
SNAP_OWNER_PASSWORD="${SNAP_OWNER_PASSWORD:-owner_dev}"
REHEARSAL_SUPERUSER="${REHEARSAL_SUPERUSER:-chemtrack_super}"
REHEARSAL_SUPER_PASSWORD="${REHEARSAL_SUPER_PASSWORD:-rehearsal_dev}"
# Rehearsal reuses the dev role passwords so ALTER ROLE is a no-op locally.
REHEARSAL_OWNER_PASSWORD="${REHEARSAL_OWNER_PASSWORD:-owner_dev}"
REHEARSAL_APP_PASSWORD="${REHEARSAL_APP_PASSWORD:-app_dev}"

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
WIN="$REPO/deploy/windows"
CACHE="$WIN/cache"
STAGE="$WIN/stage"
XLSX="${XLSX:-}"
NO_DEMO=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --) shift ;; # pnpm passes the separator through
    --xlsx) XLSX="$2"; shift 2 ;;
    --no-demo) NO_DEMO=1; shift ;; # snapshot without demo labs/inventory
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

PKG_VERSION="$(node -p "require('$REPO/package.json').version")"
OUT_DIR_NAME="ChemTrack-${PKG_VERSION}-win64"
ZIP_PATH="$REPO/${OUT_DIR_NAME}.zip"

log() { printf '\n== %s\n' "$*"; }
die() { echo "FATAL: $*" >&2; exit 1; }

psql_owner() {
  PGPASSWORD="$SNAP_OWNER_PASSWORD" psql -h "$SNAP_PG_HOST" -p "$SNAP_PG_PORT" -U "$SNAP_OWNER_USER" "$@"
}

unix2dos_file() {
  # CRLF for Windows text files, idempotently.
  sed -i 's/\r*$/\r/' "$1"
}

# ---------------------------------------------------------------------------
log "Preflight"
# ---------------------------------------------------------------------------
cd "$REPO"
command -v zip >/dev/null || die "zip is required"
command -v unzip >/dev/null || die "unzip is required"
command -v pg_dump >/dev/null || die "pg_dump is required"
command -v curl >/dev/null || die "curl is required"
[[ -d node_modules ]] || die "run pnpm install first"
psql_owner -d postgres -c "SELECT 1" >/dev/null || die "cannot reach local PostgreSQL as $SNAP_OWNER_USER"
if [[ -z "$XLSX" ]]; then
  echo "No --xlsx given: snapshot will contain seed data only (no legacy import)."
elif [[ ! -f "$XLSX" ]]; then
  die "xlsx not found: $XLSX"
fi

mkdir -p "$CACHE"
rm -rf "$STAGE"
mkdir -p "$STAGE/$OUT_DIR_NAME"
DEST="$STAGE/$OUT_DIR_NAME"

# ---------------------------------------------------------------------------
log "Fetch runtimes (cached, checksum-pinned)"
# ---------------------------------------------------------------------------
NODE_ZIP="$CACHE/node-v${NODE_VERSION}-win-x64.zip"
if [[ ! -f "$NODE_ZIP" ]] || ! echo "$NODE_SHA256  $NODE_ZIP" | sha256sum -c - >/dev/null 2>&1; then
  curl -fL --retry 3 -o "$NODE_ZIP" "$NODE_URL"
fi
echo "$NODE_SHA256  $NODE_ZIP" | sha256sum -c - || die "node zip checksum mismatch"

mkdir -p "$DEST/runtime/node"
unzip -q -j -o "$NODE_ZIP" "node-v${NODE_VERSION}-win-x64/node.exe" "node-v${NODE_VERSION}-win-x64/LICENSE" -d "$DEST/runtime/node"
[[ -f "$DEST/runtime/node/node.exe" ]] || die "node.exe missing after extraction"

# PostgreSQL: prefer a manually dropped EDB binaries zip (full bin/ incl.
# psql); otherwise the verified zonky Maven Central archive.
EDB_ZIP="$(ls "$CACHE"/postgresql-16.*-windows-x64-binaries.zip 2>/dev/null | head -1 || true)"
mkdir -p "$DEST/pgsql"
if [[ -n "$EDB_ZIP" ]]; then
  log "Using manually provided EDB binaries: $EDB_ZIP (checksum NOT pinned — your responsibility)"
  TMP_EDB="$(mktemp -d)"
  unzip -q "$EDB_ZIP" -d "$TMP_EDB"
  cp -r "$TMP_EDB/pgsql/bin" "$TMP_EDB/pgsql/lib" "$TMP_EDB/pgsql/share" "$DEST/pgsql/"
  rm -rf "$TMP_EDB"
else
  PG_JAR="$CACHE/embedded-postgres-binaries-windows-amd64-${PG_VERSION}.jar"
  if [[ ! -f "$PG_JAR" ]] || ! echo "$PG_JAR_SHA1  $PG_JAR" | sha1sum -c - >/dev/null 2>&1; then
    curl -fL --retry 3 -o "$PG_JAR" "$PG_JAR_URL"
  fi
  echo "$PG_JAR_SHA1  $PG_JAR" | sha1sum -c - || die "postgres jar checksum mismatch"
  TMP_PG="$(mktemp -d)"
  unzip -q "$PG_JAR" -d "$TMP_PG"
  TXZ="$TMP_PG/postgres-windows-x86_64.txz"
  [[ -f "$TXZ" ]] || die "expected postgres-windows-x86_64.txz inside the zonky jar; found: $(ls "$TMP_PG")"
  tar -xJf "$TXZ" -C "$DEST/pgsql"
  rm -rf "$TMP_PG"
fi
for exe in initdb.exe pg_ctl.exe postgres.exe; do
  [[ -f "$DEST/pgsql/bin/$exe" ]] || die "pgsql/bin/$exe missing"
done
if ! ls "$DEST/pgsql/bin"/vcruntime140*.dll >/dev/null 2>&1; then
  echo "WARNING: vcruntime140.dll not bundled with postgres — target machines may need the VC++ 2015-2022 redistributable (documented in README-WINDOWS.md)."
fi

# ---------------------------------------------------------------------------
log "Build app (prisma generate with windows engine + next build)"
# ---------------------------------------------------------------------------
pnpm prisma generate >/dev/null
WIN_ENGINE_SRC="$(find node_modules/.pnpm -path '*/.prisma/client/query_engine-windows.dll.node' | head -1)"
[[ -n "$WIN_ENGINE_SRC" ]] || die "query_engine-windows.dll.node not generated — check binaryTargets in prisma/schema.prisma"
pnpm build >/dev/null
[[ -f .next/standalone/server.js ]] || die "standalone build missing"

# ---------------------------------------------------------------------------
log "Build database snapshot (migrate + seed + legacy import + audit gate)"
# ---------------------------------------------------------------------------
TMPDB="chemtrack_pkg_$$"
psql_owner -d postgres -c "CREATE DATABASE $TMPDB" >/dev/null
cleanup_tmpdb() { psql_owner -d postgres -c "DROP DATABASE IF EXISTS $TMPDB" >/dev/null 2>&1 || true; }
trap cleanup_tmpdb EXIT

SNAP_URL="postgresql://$SNAP_OWNER_USER:$SNAP_OWNER_PASSWORD@$SNAP_PG_HOST:$SNAP_PG_PORT/$TMPDB"
DATABASE_URL="$SNAP_URL" pnpm db:migrate >/dev/null
DATABASE_URL="$SNAP_URL" SEED_DEMO="$([[ "$NO_DEMO" == 1 ]] && echo 0 || echo 1)" pnpm db:seed >/dev/null
if [[ -n "$XLSX" ]]; then
  DATABASE_URL="$SNAP_URL" pnpm import:legacy -- --file "$XLSX" | tail -3
fi
DATABASE_URL="$SNAP_URL" pnpm verify:audit | tail -1

mkdir -p "$DEST/db"
PGPASSWORD="$SNAP_OWNER_PASSWORD" pg_dump -h "$SNAP_PG_HOST" -p "$SNAP_PG_PORT" -U "$SNAP_OWNER_USER" \
  --inserts --rows-per-insert=500 --encoding=UTF8 "$TMPDB" | gzip -9 > "$DEST/db/snapshot.sql.gz"
[[ -s "$DEST/db/snapshot.sql.gz" ]] || die "snapshot dump is empty"

# ---------------------------------------------------------------------------
log "Stage app (dereference symlinks, flatten node_modules, prune)"
# ---------------------------------------------------------------------------
cp -rL .next/standalone "$DEST/app"
rm -f "$DEST/app/.env" "$DEST/app/.env."* 2>/dev/null || true
cp -r .next/static "$DEST/app/.next/static"
[[ -d public ]] && cp -r public "$DEST/app/public"

node "$WIN/flatten-node-modules.mjs" "$DEST/app/node_modules"

# Prune dead weight before smoke tests, so the pruned tree is what we verify.
rm -rf "$DEST/app/node_modules/sharp" "$DEST/app/node_modules/@img" "$DEST/app/node_modules/typescript"
cp "$WIN_ENGINE_SRC" "$DEST/app/node_modules/.prisma/client/query_engine-windows.dll.node"

# ---------------------------------------------------------------------------
log "Bundle tools with esbuild"
# ---------------------------------------------------------------------------
mkdir -p "$DEST/app/tools"
# ESM deps (node-cron v4) read import.meta.url at module top level, which is
# undefined in CJS output — define it to a banner-injected equivalent.
ESBUILD_COMMON=(--bundle --platform=node --format=cjs --target=node22 --log-level=warning \
  --tsconfig="$REPO/tsconfig.json" --alias:@="$REPO/src" \
  --external:@prisma/client --external:.prisma --define:process.env.NODE_ENV='"production"' \
  --banner:js="const __import_meta_url = require('node:url').pathToFileURL(__filename).href;" \
  --define:import.meta.url=__import_meta_url)
pnpm exec esbuild src/worker/index.ts            "${ESBUILD_COMMON[@]}" --outfile="$DEST/app/tools/worker.cjs"
pnpm exec esbuild scripts/import/cli.ts          "${ESBUILD_COMMON[@]}" --outfile="$DEST/app/tools/import-legacy.cjs"
pnpm exec esbuild scripts/verify-audit-chain.ts  "${ESBUILD_COMMON[@]}" --outfile="$DEST/app/tools/verify-audit.cjs"
pnpm exec esbuild deploy/windows/tools-src/restore-db.ts \
  --bundle --platform=node --format=cjs --target=node22 --log-level=warning \
  --external:pg-native --outfile="$DEST/app/tools/restore-db.cjs"

# ---------------------------------------------------------------------------
log "Linux verification: restore rehearsal + server & worker smoke"
# ---------------------------------------------------------------------------
RTDB="chemtrack_rehearsal_$$"
PWFILE="$(mktemp)"
echo "$REHEARSAL_SUPER_PASSWORD" > "$PWFILE"
cleanup_rehearsal() {
  PGPASSWORD="$REHEARSAL_SUPER_PASSWORD" psql -h "$SNAP_PG_HOST" -p "$SNAP_PG_PORT" -U "$REHEARSAL_SUPERUSER" -d postgres \
    -c "DROP DATABASE IF EXISTS $RTDB" >/dev/null 2>&1 || true
  rm -f "$PWFILE"
  cleanup_tmpdb
}
trap cleanup_rehearsal EXIT

RESTORE_OUT="$(node "$DEST/app/tools/restore-db.cjs" \
  --host "$SNAP_PG_HOST" --pgport "$SNAP_PG_PORT" \
  --superuser "$REHEARSAL_SUPERUSER" --pwfile "$PWFILE" \
  --dump "$DEST/db/snapshot.sql.gz" --dbname "$RTDB" \
  --owner-password "$REHEARSAL_OWNER_PASSWORD" --app-password "$REHEARSAL_APP_PASSWORD")"
echo "restore rehearsal: $RESTORE_OUT"
echo "$RESTORE_OUT" | grep -q '"ok":true' || die "restore rehearsal failed"

RT_URL="postgresql://$SNAP_OWNER_USER:$SNAP_OWNER_PASSWORD@$SNAP_PG_HOST:$SNAP_PG_PORT/$RTDB"
DATABASE_URL="$RT_URL" node "$DEST/app/tools/verify-audit.cjs" | tail -1 | grep -q "Audit chain OK" \
  || die "audit chain verification failed on the RESTORED database"

# Server smoke against the restored DB.
SMOKE_PORT=3466
DATABASE_URL="$RT_URL" AUTH_SECRET="package-smoke" AUTH_TRUST_HOST=true PORT=$SMOKE_PORT HOSTNAME=127.0.0.1 \
  node "$DEST/app/server.js" > "$STAGE/server-smoke.log" 2>&1 &
SERVER_PID=$!
sleep 4
HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$SMOKE_PORT/sign-in" || true)"
kill "$SERVER_PID" 2>/dev/null || true
[[ "$HTTP_CODE" == "200" ]] || die "server smoke failed (HTTP $HTTP_CODE) — see $STAGE/server-smoke.log"
echo "server smoke: /sign-in -> 200"

# Worker smoke: boot-time alert sweep must complete.
DATABASE_URL="$RT_URL" timeout 60 node "$DEST/app/tools/worker.cjs" > "$STAGE/worker-smoke.log" 2>&1 &
WORKER_PID=$!
for _ in $(seq 1 30); do
  grep -q "alert-sweep ok" "$STAGE/worker-smoke.log" 2>/dev/null && break
  sleep 1
done
kill "$WORKER_PID" 2>/dev/null || true
grep -q "alert-sweep ok" "$STAGE/worker-smoke.log" || die "worker smoke failed — see $STAGE/worker-smoke.log"
echo "worker smoke: alert sweep ok"

# Linux engine no longer needed — Windows engine must remain.
rm -f "$DEST/app/node_modules/.prisma/client/"libquery_engine-*.so.node
rm -f "$DEST/app/node_modules/@prisma/engines/"libquery_engine-*.so.node 2>/dev/null || true
[[ -f "$DEST/app/node_modules/.prisma/client/query_engine-windows.dll.node" ]] || die "windows engine missing after prune"

# ---------------------------------------------------------------------------
log "Assemble template, manifest checks, zip"
# ---------------------------------------------------------------------------
cp -r "$WIN/dist-template/." "$DEST/"
find "$DEST" -maxdepth 3 \( -name '*.bat' -o -name '*.ps1' -o -name '*.vbs' -o -name '*.template' -o -name 'README-WINDOWS.md' \) \
  -print0 | while IFS= read -r -d '' f; do unix2dos_file "$f"; done

GIT_SHA="$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)"
cat > "$DEST/VERSION.txt" << EOF
ChemTrack $PKG_VERSION (win64 offline bundle)
Built: $(date -u +%Y-%m-%dT%H:%M:%SZ) from commit $GIT_SHA
Node: v$NODE_VERSION (win-x64)
PostgreSQL: $PG_VERSION (zonky embedded binaries)
Prisma: $(node -p "require('$REPO/node_modules/@prisma/client/package.json').version")
Snapshot: $( [[ "$NO_DEMO" == 1 ]] && echo "reference data + accounts (no demo inventory)" || echo "seed data" )$( [[ -n "$XLSX" ]] && echo " + legacy import ($(basename "$XLSX"))" )
EOF
unix2dos_file "$DEST/VERSION.txt"

# Manifest assertions.
for f in \
  install.bat start.bat stop.bat status.bat enable-lan.bat disable-lan.bat \
  autostart-on.bat autostart-off.bat run-tool.bat README-WINDOWS.md VERSION.txt \
  setup/install.ps1 setup/lib.ps1 scripts/start.ps1 scripts/stop.ps1 scripts/status.ps1 \
  scripts/enable-lan.ps1 scripts/disable-lan.ps1 scripts/autostart-on.ps1 scripts/autostart-off.ps1 \
  scripts/launch-hidden.vbs config/chemtrack.env.template \
  runtime/node/node.exe pgsql/bin/pg_ctl.exe pgsql/bin/initdb.exe pgsql/bin/postgres.exe \
  app/server.js app/tools/worker.cjs app/tools/import-legacy.cjs app/tools/verify-audit.cjs \
  app/tools/restore-db.cjs app/node_modules/.prisma/client/query_engine-windows.dll.node \
  db/snapshot.sql.gz; do
  [[ -e "$DEST/$f" ]] || die "manifest check failed: $f missing"
done

# No symlinks anywhere; path-length headroom for Windows MAX_PATH.
SYMLINKS="$(find "$DEST" -type l | head -5)"
[[ -z "$SYMLINKS" ]] || die "symlinks remain in package: $SYMLINKS"
LONGEST_REL="$(cd "$STAGE" && find "$OUT_DIR_NAME" -printf '%p\n' | awk '{ if (length($0) > m) { m = length($0); line = $0 } } END { print m, line }')"
LONGEST_LEN="${LONGEST_REL%% *}"
echo "longest relative path: $LONGEST_LEN chars"
[[ "$LONGEST_LEN" -lt 180 ]] || die "path too long for Windows MAX_PATH headroom: $LONGEST_REL"

rm -f "$ZIP_PATH"
(cd "$STAGE" && zip -qrX "$ZIP_PATH" "$OUT_DIR_NAME")
SIZE_MB="$(du -m "$ZIP_PATH" | cut -f1)"

log "DONE: $ZIP_PATH (${SIZE_MB} MB)"
echo "Hand it to a Windows 10/11 machine and follow README-WINDOWS.md."
