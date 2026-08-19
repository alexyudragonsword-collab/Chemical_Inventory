# ChemTrack — Laboratory Chemical Inventory System

Every bottle accounted for. One record per physical container; a user sees the
whole estate but can only change what is in their own custody; any chemical can
be located across every lab in two clicks.

Built with Next.js (App Router) + TypeScript + PostgreSQL + Prisma.

## Core concepts

- **Container as unit** — one record per physical bottle, with a printed QR
  label (`/labels/print?codes=…`). Substances hold the chemical identity (CAS,
  GHS classification, SDS documents); containers hold quantity, lot, expiry,
  location and custodian.
- **Custody model** — a user's editable set = containers where they are the
  named custodian, plus containers in labs where they hold the manager flag.
  Everything else renders read-only with a *Request transfer* action. The
  single authority is `src/server/authz.ts`; both the UI render modes and
  every Server Action guard call it.
- **Audit chain** — every add/deduct/transfer/dispose/correction/denied
  attempt is an `audit_event` row in a global SHA-256 hash chain. The table is
  append-only at the database level (trigger + REVOKE). Verify with
  `pnpm verify:audit` or the button in Admin → Audit trail.
- **Witness rule** — controlled substances and corrections above 20% require a
  second person to confirm with their own credentials; enforced inside the
  transaction (`src/server/audit.ts`).
- **Safety as data** — GHS classification is structured data driving labels
  and the three-state storage-compatibility matrix (compatible / segregate /
  never together). Placement is checked at check-in and re-checked nightly.

## Development

Requirements: Node 22+, pnpm, PostgreSQL 16.

```bash
cp .env.example .env             # adjust DATABASE_URL etc.
pnpm install
pnpm prisma migrate dev          # creates schema + audit triggers
pnpm db:seed                     # demo data — see accounts below
pnpm dev                         # http://localhost:3000
pnpm worker                      # background jobs (separate terminal)
```

Demo accounts (password `chemtrack-demo`): `admin@lab.internal` (Admin),
`li.wei@lab.internal` (Lab Manager B2-14), `m.tan@lab.internal` (Custodian),
`r.iyer@lab.internal` (Lab User), `ehs@lab.internal` (EHS Officer),
`viewer@lab.internal` (Viewer).

Tests: `pnpm test` (Vitest), `pnpm typecheck`.

## Legacy data import

The importer understands the old system's print-style "Chemical by Permit"
export (one sheet per lab, sections per permit category):

```bash
pnpm import:legacy -- --file Chemical_by_Permit.xlsx --dry-run --report review.csv
# review the report with the lab managers — this is the go/no-go gate
pnpm import:legacy -- --file Chemical_by_Permit.xlsx
```

Duplicate Sub IDs across permit sections merge into one container with a
permit-category mapping; unit spellings are normalized (ambiguous ones flagged,
never guessed); location spellings collapse onto canonical codes with raw
aliases preserved; unknown custodians/PIs land in **Admin → Import fixup**.
Import is idempotent per file hash. Every source row is kept verbatim in
`import_row`.

Substances arrive without CAS numbers (the legacy export has none) — enrich
them in the fixup worklist.

## Deployment (internal server)

```bash
cp .env.example .env   # set POSTGRES_OWNER_PASSWORD, POSTGRES_APP_PASSWORD, AUTH_SECRET
docker compose build
docker compose run --rm migrate          # prisma migrate deploy as the owner role
docker compose up -d                     # app (:3000) + worker + postgres
docker compose run --rm app node_modules/.bin/tsx prisma/seed.ts   # optional demo data
```

The app connects as `chemtrack_app`, which has no UPDATE/DELETE on
`audit_event`; migrations run as the owner. **Back up both** the `pgdata`
volume (`pg_dump`) and the `files` volume (SDS uploads).

Worker schedule: 02:00 compatibility re-check · 02:30 alert sweep · 03:00
quantity-drift check · monthly regulated-substances return email (configure
`SMTP_HOST`, `EHS_REPORT_RECIPIENTS`) · 5-min housekeeping.

## Deliberately deferred

Institutional SSO (OIDC hook points in `src/lib/auth.ts` + `auth_provider`
table), TOTP step-up for controlled substances (`restricted` render mode and
`totpSecret` already exist), PubChem-assisted CAS enrichment, and everything
mobile.
