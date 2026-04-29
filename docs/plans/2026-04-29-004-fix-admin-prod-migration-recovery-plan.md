---
title: "fix(admin): recover prod migration drift and harden Railway predeploy hook"
type: fix
status: active
date: 2026-04-29
supersedes: docs/plans/2026-04-29-003-fix-admin-prisma-migrate-on-deploy-plan.md
---

# fix(admin): recover prod migration drift and harden Railway predeploy hook

## Overview

`@forge/admin` prod is in a confirmed broken state: three migrations
(`0007_admin_core_sync_coverage`, `0008_reference_locale_rows`,
`0009_keyword_first_lexical`) have shipped in the deployed Prisma
client but have never been applied to the prod DB. Every Core-sync
phase fails on missing columns/tables; `systemStatus` is also broken.

Root cause is now confirmed (not hypothesised): a Railway dashboard
**Custom Start Command** override on the `@forge/admin` service —
`pnpm --filter @forge/admin start` — silently shadows
`apps/admin/railway.toml`'s chained `startCommand`. The toml's
`db:migrate:deploy && node ...standalone/server.js` step has never
run in prod. Deploy logs from PR #854 (commit `24f9be60`,
2026-04-29 03:32-03:37 UTC) show `next start` running with the
"output: standalone" warning at every container boot.

This plan delivers the recovery and the durable fix in two phases:

- **Phase 1 — Recovery (operator-driven, hours):** capture the
  Railway service config, verify Prisma migration state, clear the
  dashboard override, redeploy, and smoke-probe the result. No PR
  required; the existing toml's chained `startCommand` is the
  recovery path because it already declares the migration step.
- **Phase 2 — Durable fix (PR cycle):** move the migration step
  from the chained `startCommand` into Railway's
  `preDeployCommand`, restore the standalone Next.js
  `startCommand`, audit the sibling per-service `railway.toml`
  files for shadow overrides (document only, no behaviour change),
  publish a dedicated solutions doc on the
  override-shadows-toml trap, and update `apps/admin/CLAUDE.md`
  with the operational runbook.

Phase 1 does **not** depend on Phase 2 landing. The operator can
clear the dashboard override and recover prod immediately. Phase 2
makes the recovery durable so the same drift cannot accumulate
silently again.

## Problem Frame

PR #854 (keyword-first lexical search) shipped on 2026-04-29 and a
post-merge `triggerSync(scope:"all", incremental:false)` exposed
that none of the last three migrations had ever been applied.
Sample errors observed in deploy logs and the live sync attempt:

- `The column "audio_preview_value" does not exist in the current database.` (0008)
- `The table "public.continent_locale" does not exist in the current database.` (0008)
- `The column "osis_id" does not exist in the current database.` (0007)
- `The column "video_dub_download.source" does not exist in the current database.` (0007)
- `The table "public.language_locale" does not exist in the current database.` (0008)
- 62s "Transaction not found" in keywords phase — downstream of the same root cause.

The deployed Prisma client expects all three migrations applied;
the prod DB is stuck at `0006_hybrid_search_gin`. PR #851's
description claimed a Core coverage audit pass on 2026-04-28
(2,301 languages / 1,088 videos / 376,400 dub downloads) — that
must have been a preview environment or a manual `railway run`
against a working tree, not the live prod path. Prod has been
silently broken since #851 shipped.

The bypass mechanism is now confirmed: a **service-level Custom
Start Command** in the Railway dashboard takes precedence over
`apps/admin/railway.toml`. Sibling services
(`apps/cms`, `apps/manager`, `apps/roadmap`) have their own
per-service `railway.toml` files of similar shape but their actual
prod behaviour vs dashboard config has not yet been audited.

## Requirements Trace

- **R1.** Phase 1 brings prod up to migration `0009` and re-enables
  Core sync without requiring any PR merge.
- **R2.** Phase 1 captures the **full** `@forge/admin` Railway
  service config (start, build, predeploy, healthcheck, env)
  before any change is made, so additional shadow overrides cannot
  silently bite the recovery.
- **R3.** Phase 1 verifies `_prisma_migrations` is in a clean
  baseline before redeploy. Any "started but not finished" row is
  resolved with `prisma migrate resolve` (forward-only; never
  `migrate dev`) before redeploy.
- **R4.** Phase 1 verifies `pg_trgm` extension privilege on the
  prod DB role before redeploying — `0009` is the first migration
  that needs it. A missing privilege is resolved out-of-band before
  redeploy, not during.
- **R5.** Phase 1 verifies on each successful redeploy that all
  three migrations applied via SQL smoke probes (see Unit 5).
- **R6.** Phase 2 makes every successful `@forge/admin` deploy
  apply pending migrations **before** traffic switches —
  `preDeployCommand`, not chained `startCommand`.
- **R7.** Phase 2 surfaces a failed migration as a loud, fail-fast
  deploy failure (existing image keeps serving) — not a
  crash-loop on the new container.
- **R8.** Phase 2 is idempotent across re-deploys of the same image
  (`migrate deploy` no-op on no-pending) and safe at N>1 replicas
  (single pre-deploy container, not per-replica).
- **R9.** Phase 2 documents the manual `railway run` migration
  fallback and the `P3009`/`P3018` recovery paths in
  `apps/admin/CLAUDE.md`.
- **R10.** Phase 2 audits sibling services (`apps/cms`,
  `apps/manager`, `apps/roadmap`) for the same dashboard-override
  trap. Findings are recorded; behaviour is **not** changed in
  this PR. If shadow overrides are found, follow-up tickets are
  filed per affected service.
- **R11.** Phase 2 publishes a dedicated solutions doc capturing
  the "dashboard override silently shadows committed config"
  trap so the institutional learning is durable.

## Scope Boundaries

**In scope:**

- Phase 1 operator runbook and recovery (executed against prod
  via railway-agent + Doppler-fronted SQL).
- Phase 2 PR: `apps/admin/railway.toml` restructure
  (`preDeployCommand` + standalone `startCommand`),
  `apps/admin/CLAUDE.md` Deployment + Migrations + runbook updates,
  sibling audit findings, and the new solutions doc.
- Marking `docs/plans/2026-04-29-003-fix-admin-prisma-migrate-on-deploy-plan.md`
  superseded.

**Out of scope (hard):**

- Any change to `apps/admin/prisma/schema.prisma`. Drift is
  schema-vs-DB; the fix is to apply migrations, not edit the schema.
- Any modification to migration files `0007`, `0008`, `0009`
  (no `CONCURRENTLY` rewrite, no expression edits).
- Running `prisma migrate dev` against any deployed environment.
  Forward-only via `migrate deploy` only.
- Behaviour changes to `apps/cms`, `apps/manager`, `apps/roadmap`
  Railway services. Audit captures findings only; fixes are
  separate tickets.
- Triggering Core sync from inside this workflow (operator action
  after Phase 1 completes).
- PR #846 (Core sync bulk upsert refactor) — separate ticket; not
  blocking now that the real prod issue is migration drift, not
  transaction timeouts.
- Per-locale `tsvector` configs / multilingual lexical recall
  (R6+).
- R8 consumer cutover.

## Context & Research

### Relevant Code and Patterns

- `apps/admin/railway.toml` — current shape: chained
  `startCommand = "pnpm --filter @forge/admin db:migrate:deploy && HOSTNAME=0.0.0.0 node apps/admin/.next/standalone/apps/admin/server.js"`.
  This is the file the dashboard override is shadowing.
- `apps/admin/package.json`:
  - `start`: `next start` — what the dashboard override actually
    runs (and the source of the `output: standalone` warning).
  - `db:migrate:deploy`: `prisma migrate deploy`.
  - `postinstall`: `prisma generate`.
- `apps/admin/next.config.ts` — `output: "standalone"` set;
  standalone server lives at
  `apps/admin/.next/standalone/apps/admin/server.js`.
- Sibling per-service tomls (audit targets): `apps/cms/railway.toml`,
  `apps/manager/railway.toml`, `apps/roadmap/railway.toml`.
- `apps/admin/CLAUDE.md` — Deployment, Migrations, and Common
  pitfalls sections. Already flags `[deploy.env]` unreliability and
  the standalone-vs-`next start` rule. New runbook section in
  Phase 2 extends this.
- Nixpacks build preserves the full repo at `/app/` — `prisma/`,
  `prisma/migrations/`, `node_modules/.bin/prisma` all available
  to both the existing chained `startCommand` and a future
  `preDeployCommand`.
- Service IDs (used by railway-agent calls in Phase 1):
  - project `forge` = `98952497-a4d9-4714-8fe8-0cdbff3147c9`
  - service `@forge/admin` = `bdb15048-1ca9-4217-ae01-ef7cc19ca6f4`
  - prod env = `5f41e037-90e4-4674-a3ea-66bbd05fb3b4`

### Institutional Learnings

- `docs/solutions/deployment/nextjs-pnpm-monorepo-railway-standalone.md`
  — the standalone-start + monorepo + pnpm story this plan inherits.
- `docs/solutions/database-issues/prisma-unsupported-placeholder-for-raw-sql-generated-columns-20260429.md`
  — relevant because `0009` adds `Unsupported(...)` placeholders
  for the new generated columns. Once `0009` applies, the schema
  is in sync.
- `docs/solutions/database-issues/postgres-generated-column-drift-add-column-if-not-exists-20260429.md`
  — generated-column drift trap; non-recurring concern for this PR
  but worth a CLAUDE.md cross-link.
- `docs/solutions/best-practices/dead-invariant-checks-from-sibling-port-20260422.md`
  — pattern reminder for the sibling audit (find what's actually
  honored vs what the file claims).

### External References

Skipped — Railway `preDeployCommand` semantics, Prisma `migrate
deploy` / `migrate resolve` behaviour, and the standalone start
shape are all already documented in the codebase via the
inherited 003 plan and the solutions docs above. Adding generic
external references would dilute the diagnosis-driven framing.

### Origin / Predecessor

- **Supersedes:** `docs/plans/2026-04-29-003-fix-admin-prisma-migrate-on-deploy-plan.md`.
  The 003 plan was written when the bypass cause was suspected
  but unconfirmed. It carried hypotheses ("Suspect a service-
  level dashboard override on the admin service") that have now
  been confirmed against deploy logs. Rather than amend it in
  place — which would entangle the original hypothesis-driven
  framing with the new diagnosis-driven scope (Phase 1 + sibling
  audit + solutions doc) — this plan replaces it. Phase 2's
  `apps/admin/railway.toml` restructure and `apps/admin/CLAUDE.md`
  intent carry forward from 003 essentially unchanged. Marking the
  predecessor `superseded` is a unit in this plan.

## Key Technical Decisions

1. **Supersede 003, do not extend.** Keeping two active plans on
   the same problem creates a dual source of truth. The Phase 2
   restructure is essentially what 003 prescribed; the value 003
   carried (rationale on `preDeployCommand` failure semantics,
   forward-only rollback rule, P3009/P3018 recovery shape) is
   re-stated here so this plan stands alone. 003 gets
   `status: superseded` and a `superseded_by:` pointer.

2. **Phase 1 uses the existing toml's chained `startCommand`,
   not a new shape.** The toml already declares
   `db:migrate:deploy && ...` — once the dashboard override is
   cleared, that path runs. Conflating recovery with redesign
   would extend the time prod is broken. Phase 2 is where the
   shape changes.

3. **Phase 2 moves migrate to `preDeployCommand`, not chained
   `startCommand`.** Failure semantics: a failed migration in
   `preDeployCommand` keeps the existing image serving and surfaces
   a "Pre-deploy failed" Railway status. A failed migration in
   `startCommand` chain crashes the new container mid-boot,
   exhausts `restartPolicyMaxRetries=3`, and only then marks the
   deploy failed — slower, more confusing logs, brief partial-
   traffic risk. Concurrent-replica-safe automatically
   (`preDeployCommand` runs once per deploy, not per replica).

4. **Sibling audit is document-only.** The hard constraint
   forbids behaviour changes for `cms`/`manager`/`roadmap` in
   this PR. Audit findings (full service config dumps + per-
   service "honored vs shadowed" verdict) land in this plan, the
   PR description, and the new solutions doc. If overrides are
   found, follow-up tickets are filed per service. This bounds
   the blast radius and unblocks the admin-only fix on its own
   review cycle.

5. **Phase-1 → Phase-2 sequencing is safe in any order.** If
   Phase 1 runs first and clears the dashboard override, the
   existing chained `startCommand` applies migrations on every
   subsequent deploy. When Phase 2 merges and the toml changes
   shape to `preDeployCommand` + standalone `startCommand`,
   Railway picks up the new shape and migrations continue to
   apply. Both shapes apply migrations; both are
   forward-compatible with each other. Operator does not need
   to wait for Phase 2 review before unblocking prod.

6. **Solutions doc lives at
   `docs/solutions/deployment/railway-dashboard-override-shadows-railway-toml-20260429.md`.**
   The `deployment/` category matches the existing
   `nextjs-pnpm-monorepo-railway-standalone.md` peer; the date
   suffix matches repo convention.

7. **Forward-only rollback rule.** Today's pending migrations
   (0007, 0008, 0009) are all additive (new tables, new columns,
   new indexes); no pre-0007 code references the new shape, so a
   code-side rollback to a pre-0007 image after migrations apply
   is functionally safe. CLAUDE.md flags this rule clearly so a
   future migration that drops or renames knows the rule changes.

## Open Questions

### Resolved During Planning

- **Supersede or extend 003?** Supersede (key decision #1).
- **Sibling audit scope?** Audit-and-document only; no behaviour
  change in this PR (key decision #4, R10).
- **Solutions doc category and slug?** `docs/solutions/deployment/`
  with the slug `railway-dashboard-override-shadows-railway-toml-20260429.md`
  (key decision #6).
- **Phase 1 path: existing chained `startCommand` or jump straight
  to `preDeployCommand`?** Existing chained `startCommand` (key
  decision #2). Recovery uses what's already in tree; redesign is
  Phase 2.
- **Operator → migrate deploy invocation?** No. Recovery happens
  by clearing the dashboard override and letting the toml's
  chained `startCommand` run on the next redeploy. Manual
  `railway run pnpm --filter @forge/admin db:migrate:deploy`
  remains the documented fallback for emergency use only.

### Deferred to Implementation

- **`_prisma_migrations` baseline state.** The failed sync attempt
  threw Prisma client errors (missing columns), not migration-
  apply errors, so the table is _expected_ to show 0001-0006 with
  `finished_at` non-null and no in-progress rows. Confirm via
  Phase-1 Unit 2 before clearing the override; if a row is
  "started but not finished", recover with
  `prisma migrate resolve --rolled-back <name>` (Unit 2 captures
  the exact CLI shape against current Prisma docs at execution
  time).
- **`pg_trgm` privilege on prod DB role.** First migration to
  need it (`0009`). Phase-1 Unit 3 verifies. If missing, the
  platform team grants `CREATE` on the database before the
  redeploy fires.
- **Doppler env wrapper on `preDeployCommand`.** If admin's
  Railway service uses a Doppler wrapper command instead of
  Railway's standard env injection, the `preDeployCommand` may
  need the same wrapper. Verify against working sibling
  preDeploys (if any exist after the audit) before merging
  Phase 2.
- **`/api/health` route existence.** `apps/admin/railway.toml`
  references `healthcheckPath = "/api/health"`. CLAUDE.md's R4
  section calls out `/api/search/health` instead. If
  `/api/health` doesn't exist, preDeploy will pass but
  healthcheck will fail and the deploy will be marked failed
  even though the migration applied. Phase 2 Unit 1 verifies and
  either updates the path or files a sibling fix.
- **Worst-case migration time vs Railway deploy window.** All
  three pending migrations are additive against an essentially
  empty DB (`video` / `video_locale` are 0 rows in prod per CLAUDE.md
  R4 notes; reference tables are small). 0009's STORED-column
  ALTER on a 0-row `video_locale` is instant; GIN builds on empty
  tables are instant. Realistic worst case: <30s. If the
  Railway deploy window is tighter than that for any reason
  (e.g., a future R0 backfill puts data behind these probes),
  Phase 2 Unit 1 flags it.
- **Additional dashboard overrides on `@forge/admin`.** The
  Custom Start Command is confirmed; build command, healthcheck
  path, and predeploy override states are not. Phase-1 Unit 1
  captures the full dump before any change; if more overrides
  appear, they are captured + decided in-flight (clear all
  shadow overrides on `@forge/admin`; document on siblings).

## High-Level Technical Design

> _This illustrates the intended approach and is directional
> guidance for review, not implementation specification. The
> implementing agent should treat it as context, not code to
> reproduce._

### Phase 1 — Recovery flow

```
Operator                Railway dashboard           @forge/admin runtime
   │                          │                           │
   │ 1. railway-agent dump ──▶│                           │
   │ ◀── service config ──────│                           │
   │                          │                           │
   │ 2. SQL probe ───────────────────────────────────────▶│
   │ ◀── _prisma_migrations baseline ─────────────────────│
   │                          │                           │
   │ 3. SQL probe ───────────────────────────────────────▶│
   │ ◀── pg_trgm privilege ───────────────────────────────│
   │                          │                           │
   │ 4. clear Custom Start ──▶│                           │
   │    Command override      │                           │
   │                          │                           │
   │ 5. trigger redeploy ────▶│ ── new container ──▶      │
   │                          │                           │
   │                          │   railway.toml honored:   │
   │                          │   pnpm db:migrate:deploy  │
   │                          │     ── applies 0007       │
   │                          │     ── applies 0008       │
   │                          │     ── applies 0009       │
   │                          │   && node ...standalone   │
   │                          │      /server.js           │
   │                          │                           │
   │ 6. SQL smoke probes ────────────────────────────────▶│
   │ ◀── 0007/0008/0009 applied ──────────────────────────│
   │ ◀── pg_trgm present ─────────────────────────────────│
   │ ◀── generated cols + GIN indexes ────────────────────│
```

Operator stops here. Triggering Core sync is a separate operator
action, not part of this plan's workflow.

### Phase 2 — Durable shape

```
Image build              ──▶ Pre-deploy container         ──▶ Main container
(existing buildCommand)      preDeployCommand:                startCommand:
                             pnpm prisma migrate deploy       node ...standalone/server.js
                             exit 0                           healthcheck /api/health
                                │                                │
                                ▼                                ▼
                             traffic switches              old image stops

Failure path:

Image build              ──▶ Pre-deploy container         ──┐
(existing buildCommand)      preDeployCommand:               │  exit ≠ 0 → deploy
                             pnpm prisma migrate deploy      │  marked FAILED
                             exit 1 (P3009 / P3018 / ...)   ─┘
                                                            │
                                                            ▼
                                            old image keeps serving;
                                            new image never receives traffic;
                                            operator runs runbook recovery.
```

Target `apps/admin/railway.toml` shape (directional):

```toml
[build]
builder = "NIXPACKS"
buildCommand = "pnpm install --frozen-lockfile && pnpm --filter @forge/admin... build && cp -r apps/admin/.next/static apps/admin/.next/standalone/apps/admin/.next/static"

[deploy]
preDeployCommand = "pnpm --filter @forge/admin db:migrate:deploy"
startCommand = "HOSTNAME=0.0.0.0 node apps/admin/.next/standalone/apps/admin/server.js"
healthcheckPath = "/api/health"
healthcheckTimeout = 60
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

## Implementation Units

> Phase 1 units are operator-driven (no code; ce:work walks the
> operator through railway-agent calls and SQL probes). Phase 2
> units are PR-driven.

### Phase 1 — Recovery (operator-driven)

- [ ] **Unit 1: Pre-flight Railway service config dump for `@forge/admin`**

**Goal:** Capture the full Railway service configuration before
any change so additional shadow overrides cannot bite the recovery.

**Requirements:** R2

**Dependencies:** None.

**Files:**

- No code changes. Findings recorded in the PR description for
  Phase 2 and in the new solutions doc (Unit 9).

**Approach:**

1. Use `railway-agent` against project `forge` (id
   `98952497-a4d9-4714-8fe8-0cdbff3147c9`), env `production`
   (id `5f41e037-90e4-4674-a3ea-66bbd05fb3b4`), service
   `@forge/admin` (id `bdb15048-1ca9-4217-ae01-ef7cc19ca6f4`).
2. Dump every settings dimension Railway exposes for the service:
   `Custom Start Command`, `Custom Build Command`, `Custom
Pre-Deploy Command`, `Healthcheck Path`, `Healthcheck Timeout`,
   `Restart Policy`, `Replicas`, `Root Directory`, `Watch Paths`,
   any custom env that overlaps with toml `[deploy.env]`.
3. Compare every dimension against `apps/admin/railway.toml`.
   Flag every dimension where dashboard ≠ toml as a "shadow
   override".

**Test scenarios:**

- _Confirmed shadow:_ `Custom Start Command = "pnpm --filter
@forge/admin start"` while toml says `db:migrate:deploy && node
...standalone/server.js`. Already known; capture verbatim for
  the solutions doc.
- _Surprise shadow:_ any other dimension where dashboard ≠ toml.
  Capture and decide in-flight whether to clear it as part of
  the same recovery (default: clear all shadow overrides on
  `@forge/admin`).

**Verification:**

- Full settings dump captured (paste-ready for the PR description).
- Per-dimension verdict: `honored` / `shadowed` / `n/a`.
- Override clearing list assembled for Unit 4.

---

- [ ] **Unit 2: Verify `_prisma_migrations` baseline**

**Goal:** Confirm no migration row is in a "started but not
finished" state before triggering a redeploy that would run
`migrate deploy`.

**Requirements:** R3

**Dependencies:** Unit 1 (so the operator already has railway-
agent + Doppler-fronted SQL access scoped to prod).

**Files:**

- No code changes. SQL output recorded for the PR description.

**Approach:**

1. Run a read-only SQL probe against prod:
   `SELECT migration_name, started_at, finished_at, applied_steps_count, rolled_back_at, logs
 FROM _prisma_migrations ORDER BY started_at;`.
2. Expected baseline: rows for `0001_init` through
   `0006_hybrid_search_gin` with `finished_at IS NOT NULL` and
   `rolled_back_at IS NULL`. No rows for `0007`/`0008`/`0009`.
3. If any row has `finished_at IS NULL` (in-progress) or
   `rolled_back_at IS NOT NULL` (rolled back), STOP. Resolve via
   `prisma migrate resolve --rolled-back <migration_name>` (or
   `--applied` only if the row is genuinely applied and Prisma
   thinks it isn't — never to fake-resolve a real failure).
   Confirm exact CLI invocation against current Prisma docs at
   execution time.

**Test scenarios:**

- _Clean baseline:_ 6 rows, all `finished_at` non-null, no rollbacks.
- _Stuck row:_ a row with `finished_at IS NULL`. Recover before
  Unit 4. Document the recovery sequence used in the PR description
  and solutions doc — it's institutional knowledge worth capturing.

**Verification:**

- SQL output pasted into the PR description.
- Baseline state explicit (`clean` or `recovered via <command>`).

---

- [ ] **Unit 3: Verify `pg_trgm` extension privilege on prod role**

**Goal:** `0009_keyword_first_lexical` is the first admin migration
that needs `pg_trgm`. A missing extension or a missing `CREATE`
privilege would fail the redeploy mid-`migrate deploy`. Verify
before triggering the redeploy.

**Requirements:** R4

**Dependencies:** Unit 1.

**Files:**

- No code changes.

**Approach:**

1. Read-only SQL probes against prod:
   `SELECT extname FROM pg_extension WHERE extname = 'pg_trgm';` and
   `SELECT current_user, has_database_privilege(current_user, current_database(), 'CREATE');`.
2. If `pg_trgm` already present → no action; redeploy will skip
   `CREATE EXTENSION` cleanly (it's `IF NOT EXISTS`).
3. If `pg_trgm` absent and the role has `CREATE` → no action;
   `0009` will install it during `migrate deploy`.
4. If `pg_trgm` absent and the role lacks `CREATE` → STOP. The
   platform team grants `CREATE` on the database (or installs
   `pg_trgm` directly out-of-band) before Unit 4 fires.

**Verification:**

- Output of both probes recorded in the PR description.
- Outcome explicit (`already installed` / `role has CREATE` /
  `granted out-of-band by platform team`).

---

- [ ] **Unit 4: Clear the dashboard override(s) and redeploy**

**Goal:** Make `apps/admin/railway.toml` the authoritative
configuration for the `@forge/admin` service and trigger a redeploy
that exercises the chained `startCommand`'s migrate step.

**Requirements:** R1

**Dependencies:** Units 1, 2, 3.

**Files:**

- No code changes.

**Approach:**

1. Via the Railway dashboard (or `railway-agent` if it supports
   override mutations), clear the `Custom Start Command` override
   (`pnpm --filter @forge/admin start`) on the `@forge/admin`
   service. Clear any additional shadow overrides identified in
   Unit 1 unless one is intentional (e.g., a healthcheck path
   override that's required because `/api/health` doesn't exist —
   in which case capture that finding for Phase 2 Unit 1).
2. Capture before/after screenshots or text dumps for the PR
   description.
3. Trigger a redeploy — either by pushing an empty deploy via
   Railway dashboard OR by re-deploying the latest build of the
   current image. **Do not** push a new git commit to trigger;
   the change is dashboard-only and an unrelated commit would
   muddy bisection.
4. Watch deploy logs in real time. The container start should
   show: `> @forge/admin db:migrate:deploy` (or the equivalent
   pnpm-filtered output) → `Applying migration "0007_..."` → `..."0008_..."`
   → `..."0009_..."` → `Your database is now in sync with your schema.`
   → `node apps/admin/.next/standalone/apps/admin/server.js` boot →
   healthcheck pass. The `"next start" does not work with "output:
standalone"` warning should NOT appear.

**Test scenarios:**

- _Happy path:_ migrations apply, container boots cleanly,
  healthcheck passes, deploy marked SUCCESS.
- _Migration error:_ `migrate deploy` fails (e.g., privilege
  issue surfaced despite Unit 3, or a content surprise). Container
  crash-loops up to `restartPolicyMaxRetries`, deploy marked
  FAILED. The previous image keeps serving traffic UP TO the point
  the new image was rolled out (the chained `startCommand` shape
  still has the failure-semantic limitation Phase 2 fixes).
  Operator captures Prisma error code and recovers via the
  documented `migrate resolve` path; if the failure is a content
  surprise, this is a different problem and Phase 2's `preDeploy`
  shape would have caught it sooner.
- _Healthcheck failure:_ migrations apply but `/api/health`
  doesn't exist. Deploy marked FAILED at healthcheck stage even
  though the DB is now in sync. This is the "deferred to
  implementation" /api/health question; if it materialises,
  Phase 2 Unit 1 takes over.

**Verification:**

- Deploy log excerpt captured showing the migrate step running
  (paste-ready for the PR description and solutions doc).
- No `next start` warning in the boot log.

---

- [ ] **Unit 5: Post-deploy SQL smoke probes**

**Goal:** Verify the three pending migrations applied cleanly
before declaring Phase 1 complete.

**Requirements:** R5

**Dependencies:** Unit 4.

**Files:**

- No code changes. SQL output recorded for the PR description and
  the new solutions doc; SQL is also embedded in
  `apps/admin/CLAUDE.md` in Phase 2 Unit 2 as a single source of
  truth.

**Approach:**

Run these four probes against prod via Doppler-fronted `psql` /
`railway run`:

1. **Migrations applied:**
   `SELECT migration_name, finished_at FROM _prisma_migrations
 WHERE migration_name IN ('0007_admin_core_sync_coverage',
 '0008_reference_locale_rows', '0009_keyword_first_lexical')
 ORDER BY migration_name;`
   — three rows, all `finished_at` non-null.
2. **`pg_trgm` extension present:**
   `SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_trgm';`
   — one row.
3. **0007/0008 schema columns/tables present:**
   - `SELECT column_name FROM information_schema.columns WHERE
table_name = 'language' AND column_name = 'audio_preview_value';`
   - `SELECT column_name FROM information_schema.columns WHERE
table_name = 'bible_book' AND column_name = 'osis_id';`
   - `SELECT column_name FROM information_schema.columns WHERE
table_name = 'video_dub_download' AND column_name = 'source';`
   - `SELECT to_regclass('public.continent_locale');`
   - `SELECT to_regclass('public.language_locale');`
     — all return non-null / one row each.
4. **0009 generated columns + GIN indexes present:**
   - `SELECT column_name, generation_expression FROM information_schema.columns
 WHERE table_name = 'video_locale' AND column_name IN ('title_tsv', 'description_tsv');`
     — two rows with `generation_expression` non-null.
   - `SELECT indexname FROM pg_indexes WHERE tablename = 'video_locale'
 AND indexname IN ('video_locale_lexical_weighted_idx', 'video_locale_title_trgm_idx');`
     — two rows.

**Verification:**

- All four probes return the expected rows. Output captured for
  the PR description and the solutions doc. If any probe fails,
  STOP — Phase 1 is not complete, and the recovery path is to
  diagnose the specific failure (likely Prisma client error or
  partial migration apply) before declaring success.

---

### Phase 2 — Durable fix (PR cycle)

- [ ] **Unit 6: Restructure `apps/admin/railway.toml`**

**Goal:** Move the migrate step into `preDeployCommand`, restore
the standalone Next.js `startCommand`, and inherit the failure
semantics defined in R6/R7/R8.

**Requirements:** R6, R7, R8

**Dependencies:** Phase 1 complete (so the change applies to a
prod that's already in sync). Phase 1 → Phase 2 is order-safe
either way (Key Decision #5), but landing Phase 2 against an
already-recovered prod removes one unknown from review.

**Files:**

- Modify: `apps/admin/railway.toml`

**Approach:**

1. Replace the chained `startCommand` with two distinct
   directives: `preDeployCommand = "pnpm --filter @forge/admin
db:migrate:deploy"` and `startCommand = "HOSTNAME=0.0.0.0 node
apps/admin/.next/standalone/apps/admin/server.js"`.
2. Keep `healthcheckPath`, `healthcheckTimeout`,
   `restartPolicyType`, `restartPolicyMaxRetries` unchanged in
   this PR — they're not in scope and changing them would expand
   blast radius. If `/api/health` is missing (deferred question),
   handle as a sibling fix or follow-up.
3. Delete the `[deploy.env]` block if it's still present (CLAUDE.md
   already flags `[deploy.env]` as unreliable; env lives in the
   Railway dashboard / Doppler).
4. Validate by deploying the PR's branch to a Railway preview
   environment first if available. The deploy logs should show a
   distinct pre-deploy step running `Applying migration ...`
   lines (or `No pending migrations to apply` if everything is
   already in sync from Phase 1), followed by the main container
   booting `node ...standalone/...server.js` cleanly with no
   `next start` warning.

**Patterns to follow:**

- Sibling per-service `railway.toml` files in `apps/cms`,
  `apps/manager`, `apps/roadmap` for the pattern shape (not the
  contents — admin has unique build steps).

**Test scenarios:**

- _No pending migration redeploy (steady state):_ preDeploy logs
  `No pending migrations to apply`, exit 0, deploy succeeds, no
  behaviour change. (Expected post-Phase-1 state.)
- _Forced failure:_ point at a bad `DATABASE_URL` on a preview
  env and confirm the deploy marks FAILED at the pre-deploy
  stage, the existing image keeps serving, and the failure is
  visible in Railway's UI as `Pre-deploy failed`.
- _Standalone boot:_ `curl <preview>/api/health` returns 200 (or
  the appropriate sibling fix lands per the deferred question).

**Verification:**

- `apps/admin/railway.toml` shows `preDeployCommand` +
  standalone-correct `startCommand`. The chained-startCommand
  artifact is removed.
- A preview deploy produces a Railway log excerpt matching the
  expected shape (paste-ready for the PR description).
- N>1-replica safety satisfied automatically (`preDeployCommand`
  runs once per deploy in a single container, not per replica).

---

- [ ] **Unit 7: Update `apps/admin/CLAUDE.md` (Deployment +
      Migrations + new operational runbook)**

**Goal:** Document the new shape, the failure-mode recovery
playbook, the manual `railway run` fallback, the forward-only
rollback rule, and the Phase-1 SQL smoke probes so the next
operator (or future agent) doesn't re-derive any of this.

**Requirements:** R9

**Dependencies:** Unit 6.

**Files:**

- Modify: `apps/admin/CLAUDE.md`
  - **Deployment** section: replace the "Railway service
    `forge-admin`..." paragraph with the new
    `preDeployCommand` + standalone-`startCommand` shape;
    cross-link to `railway.toml`.
  - **Migrations** section: add the forward-only rule, the
    `P3009`/`P3018` recovery path, the manual `railway run`
    fallback, and a cross-link to the new solutions doc.
  - New **"Predeploy migration hook (operational runbook)"**
    subsection: Phase-1 SQL smoke probes (centralised here so
    they're not orphaned in a PR description), expected
    healthy outputs, failure signals + rollback triggers.
  - **Common pitfalls**: append a bullet on
    "Dashboard override silently shadows `railway.toml`" with a
    cross-link to the new solutions doc.

**Approach:**

- Mirror the format used by R1/R2/R3 operational runbooks already
  in CLAUDE.md (numbered steps, "Common things to remember"
  bullet list at the bottom).
- Failure-mode runbook covers:
  - **P3009** (`Migration ... was rolled back, please review`) →
    `railway run pnpm --filter @forge/admin prisma migrate
resolve --rolled-back <name>` after fixing the underlying
    cause.
  - **P3018** (migration cannot be applied — typically a logical
    error in the migration SQL) → fix the migration in a
    follow-up PR; do NOT use `--applied` to fake-resolve a real
    failure.
  - **Network egress / `DATABASE_URL` absence** → fail-loud at
    preDeploy; operator confirms env in dashboard.
  - **`pg_trgm` extension privilege missing** → preDeploy fails
    on a future `pg_trgm`-needing migration (already addressed
    on prod via Phase-1 Unit 3); resolve out-of-band (platform
    team grants `CREATE` on the role) and redeploy.

**Patterns to follow:**

- Existing R1/R2/R3 operational runbooks in
  `apps/admin/CLAUDE.md` (Scene embeddings, Transcript
  embeddings, Experience content dump). Same numbered-steps +
  "Common things to remember" shape.

**Test scenarios:**

- _Doc renders:_ no broken cross-links; new section appears in a
  natural location.
- _Operator dry-run:_ a reader following the runbook on a clean
  preview deploy reproduces the SUCCESS state (smoke queries
  return expected rows). Performed by hand at PR-open time, not
  as a test asset.

**Verification:**

- Cross-links resolve (solutions doc, sibling CLAUDE.md
  references).
- Smoke queries match Phase-1 Unit 5 byte-for-byte (single source
  of truth henceforth).
- No content from existing Deployment / Migrations sections
  silently dropped — re-read CLAUDE.md sections before commit.

---

- [ ] **Unit 8: Audit sibling Railway services (`cms`, `manager`,
      `roadmap`) for shadow overrides**

**Goal:** Find out whether the same dashboard-override-shadows-toml
trap is silently active on the other three services. Capture
findings; do not change behaviour.

**Requirements:** R10

**Dependencies:** None (independent of admin recovery).

**Files:**

- Modify: this plan file (`docs/plans/2026-04-29-004-...md`) —
  add an "Audit findings" appendix at the end.
- Modify: the new solutions doc (Unit 9) — capture findings in
  the "Sibling exposure" section.
- The PR description for Phase 2 includes the appendix verbatim.

**Approach:**

For each of `apps/cms`, `apps/manager`, `apps/roadmap`:

1. Use `railway-agent` to dump the full Railway service config
   for the corresponding production service.
2. Diff dashboard config against `apps/<service>/railway.toml`
   on every dimension (start, build, predeploy, healthcheck,
   restart policy, replicas, root directory, env-overlap).
3. Inspect recent deploy logs (last 3-5 deploys) for the same
   tell as admin: any `next start` warning where the toml
   declares a standalone start; missing `Applying migration`
   lines where the toml declares a migrate step.
4. Per-service verdict: `honored` (toml runs in prod) or
   `shadowed` (some dimension is overridden) — and if shadowed,
   which dimension(s).
5. **Do not** clear any override or modify any service. If a
   shadow override is found on a sibling, file a follow-up
   ticket (one per service) with the audit evidence.

**Patterns to follow:**

- The same audit shape used in Phase-1 Unit 1 for `@forge/admin`.

**Test scenarios:**

- _All clean:_ every sibling honors its toml. Capture and move
  on.
- _Sibling shadowed:_ document the dimension(s); file a
  follow-up ticket; do NOT clear in this PR.

**Verification:**

- Per-sibling verdict captured in the plan appendix and the
  solutions doc.
- Follow-up ticket numbers (if any) cross-linked.

---

- [ ] **Unit 9: Author the solutions doc on the override-
      shadows-toml trap**

**Goal:** Capture the institutional learning so a future engineer
hitting the same symptom (deploy logs say `next start` despite
toml saying otherwise; migrations not applying despite toml
chaining them) finds the doc instead of re-deriving the diagnosis.

**Requirements:** R11

**Dependencies:** Phase 1 complete (so the doc is written from
real diagnosis, not hypothesis); Unit 8 (so the "Sibling exposure"
section is grounded).

**Files:**

- Create: `docs/solutions/deployment/railway-dashboard-override-shadows-railway-toml-20260429.md`

**Approach:**

Doc structure (following the pattern of existing
`docs/solutions/deployment/` peers):

1. **Symptom** — what the operator sees (deploy logs show one
   command running while `railway.toml` declares a different
   one; the warning text from `next start` against `output:
standalone`; downstream migration drift symptoms).
2. **Root cause** — Railway's service-level dashboard config
   takes precedence over per-service `railway.toml`. The toml
   becomes effectively dead config until the override is
   cleared; nothing in Railway's UI flags the conflict.
3. **Diagnosis** — the railway-agent dump shape (link to
   Phase-1 Unit 1), the deploy-log tells, and the SQL probes
   that confirm migration drift after the fact.
4. **Recovery** — clear the shadow override(s); redeploy;
   smoke-probe with the queries embedded in `apps/admin/CLAUDE.md`.
5. **Prevention** — `preDeployCommand` shape (link to the
   restructured `apps/admin/railway.toml`); CLAUDE.md cross-link;
   audit cadence recommendation (every cross-cutting Railway
   change should re-dump the affected service's config).
6. **Sibling exposure** — capture Unit 8 findings (cms / manager
   / roadmap honored vs shadowed verdict).
7. **Cross-links** — `nextjs-pnpm-monorepo-railway-standalone.md`,
   `apps/admin/CLAUDE.md` Deployment + Migrations sections, this
   plan, the superseded 003 plan.

**Patterns to follow:**

- `docs/solutions/deployment/nextjs-pnpm-monorepo-railway-standalone.md`
  for tone, structure, and frontmatter shape.

**Verification:**

- Doc renders cleanly; cross-links resolve.
- Sibling exposure section grounded in Unit 8 findings.
- A reader hitting the same symptom in the future would land on
  this doc via grep on `next start` + `railway.toml` + `output:
standalone`.

---

- [ ] **Unit 10: Mark the predecessor plan superseded**

**Goal:** Single source of truth — readers landing on the 003
plan see immediately that this 004 plan supersedes it.

**Requirements:** Key Decision #1.

**Dependencies:** None.

**Files:**

- Modify: `docs/plans/2026-04-29-003-fix-admin-prisma-migrate-on-deploy-plan.md`

**Approach:**

1. Set frontmatter `status: superseded`.
2. Add frontmatter `superseded_by:
docs/plans/2026-04-29-004-fix-admin-prod-migration-recovery-plan.md`.
3. Add a one-line preamble at the top of the body:
   `> Superseded by docs/plans/2026-04-29-004-fix-admin-prod-migration-recovery-plan.md
   > on 2026-04-29 — this plan was hypothesis-driven; the 004 plan is
   > diagnosis-driven and adds Phase 1 recovery + sibling audit + solutions doc.`

**Verification:**

- 003 frontmatter shows `status: superseded` and the
  `superseded_by` pointer.
- Preamble line appears at the top of the body.

## System-Wide Impact

- **Interaction graph:** Phase 1 changes the running prod
  configuration of one Railway service. Phase 2 changes deploy
  pipeline shape for the same service (adds a pre-deploy step,
  ~2-30s on an empty migration; minutes once R0 lands data). No
  app code changes; no callback / middleware / observer changes.
  Sibling audit (Unit 8) may surface follow-up tickets for cms /
  manager / roadmap.
- **Error propagation:**
  - Phase 1: a failed `migrate deploy` in the chained
    `startCommand` crashes the new container; `restartPolicy`
    retries 3 times; deploy marked FAILED. Existing image still
    serving up to the point of rollout. (This is exactly the
    failure-semantic limitation Phase 2 fixes.)
  - Phase 2: a failed `migrate deploy` in `preDeployCommand`
    keeps the existing image serving and surfaces a
    "Pre-deploy failed" Railway status. No partial-state window.
    Recovery is operator-driven via the runbook (Unit 7).
- **State lifecycle risks:** Forward-only Prisma migrations.
  Rolling back to an earlier image after a successful migration
  apply leaves the schema ahead of the code. Today's contents
  (0007, 0008, 0009) are all additive (new tables, new columns,
  new indexes); pre-0007 code does not reference the new shape,
  so a code-side rollback is functionally safe. CLAUDE.md (Unit 7)
  flags this rule; a future migration that drops or renames will
  need a different rollback playbook.
- **API surface parity:** None. cms / manager / roadmap surface
  unchanged in this PR.
- **Integration coverage:** SQL smoke probes (Phase-1 Unit 5,
  embedded in CLAUDE.md by Phase-2 Unit 7) are the cross-layer
  check. No automated test surface fits a config change of this
  shape.

## Risks & Dependencies

- **Worst-case migration time vs Railway deploy window.** Pending
  migrations are additive against an essentially empty DB; 0009's
  STORED-column ALTER on a 0-row `video_locale` is instant; GIN
  builds on empty tables are instant. Realistic worst case: <30s.
  _Mitigation:_ Phase 1 Unit 4 watches the deploy log in real
  time; if the pre-deploy step exceeds the Railway deploy
  timeout (default 10 min, very high ceiling), the operator
  switches to the manual `railway run` fallback documented in
  Unit 7.
- **`pg_trgm` extension privilege.** First admin migration to
  need it. _Mitigation:_ Phase 1 Unit 3 verifies before redeploy.
- **Additional dashboard overrides on `@forge/admin` we haven't
  seen.** _Mitigation:_ Phase 1 Unit 1 captures the full dump
  before any change.
- **`_prisma_migrations` weird state from the failed sync
  attempt.** Sync was Prisma client errors, not migration-apply
  errors, so unlikely. _Mitigation:_ Phase 1 Unit 2 verifies
  before redeploy; recovery via `prisma migrate resolve` if
  needed.
- **`/api/health` route may not exist.** _Mitigation:_ if Phase 1
  Unit 4 surfaces a healthcheck-stage failure, treat as a
  sibling fix in Phase 2 Unit 6 or as a follow-up ticket.
- **Doppler env wrapper shape on `preDeployCommand`.**
  _Mitigation:_ verify against working sibling preDeploys after
  the audit (Unit 8) and before merging Phase 2.
- **Image must contain `prisma/` + migrations + Prisma engine.**
  Today's Nixpacks build preserves the full repo, so this is
  satisfied. A future build optimization that strips the runtime
  image (Docker multi-stage, slim standalone) would break the hook
  silently. _Mitigation:_ CLAUDE.md (Unit 7) notes that any build-
  output optimisation must preserve `prisma/migrations/` and
  `node_modules/.bin/prisma`.

## Documentation / Operational Notes

- CLAUDE.md updates land as part of Unit 7.
- The new solutions doc lands as part of Unit 9.
- 003 plan superseded as part of Unit 10.
- PR description (Phase 2) must include:
  - **Before/after** of the Railway dashboard settings on
    `@forge/admin` (Phase 1 Unit 1 dump + post-Unit-4 dump).
  - **Deploy log excerpt** showing the migrate step running
    cleanly (Phase 1 Unit 4 capture).
  - **Smoke-probe SQL output** proving 0007/0008/0009 applied
    (Phase 1 Unit 5 capture).
  - **Sibling audit findings** (Unit 8) with verdict per service
    and follow-up ticket links if any.
  - **Cross-link** to the new solutions doc.
- Recommend a 24h soak after Phase 2 merge before the operator
  triggers Core sync — gives the predeploy hook time to prove on
  a non-search deploy cadence that it doesn't regress anything else.
- Out-of-scope follow-ups to capture in the PR description:
  - Healthcheck-path correctness audit if `/api/health` is missing.
  - Future-rollback playbook for when a non-additive migration
    lands.
  - PR #846 (`fix/admin-core-sync-bulk-upsert`) — operational
    follow-up; not blocking.

## Sources & References

- **Predecessor plan (superseded):** `docs/plans/2026-04-29-003-fix-admin-prisma-migrate-on-deploy-plan.md`
- Related code:
  - `apps/admin/railway.toml`
  - `apps/admin/CLAUDE.md`
  - `apps/admin/next.config.ts`
  - `apps/admin/package.json`
  - `apps/cms/railway.toml`, `apps/manager/railway.toml`, `apps/roadmap/railway.toml`
- Related PRs:
  - PR #854 — keyword-first port whose deploy surfaced the drift.
  - PR #851 — Tatai's R0 Core sync entity coverage; introduced 0007/0008.
  - PR #846 — Core sync bulk upsert refactor; out of scope here.
- Institutional learnings:
  - `docs/solutions/deployment/nextjs-pnpm-monorepo-railway-standalone.md`
  - `docs/solutions/database-issues/prisma-unsupported-placeholder-for-raw-sql-generated-columns-20260429.md`
  - `docs/solutions/database-issues/postgres-generated-column-drift-add-column-if-not-exists-20260429.md`
- Service IDs:
  - project `forge` = `98952497-a4d9-4714-8fe8-0cdbff3147c9`
  - service `@forge/admin` = `bdb15048-1ca9-4217-ae01-ef7cc19ca6f4`
  - prod env = `5f41e037-90e4-4674-a3ea-66bbd05fb3b4`
- External (no fetch needed; semantics already inherited from 003
  plan + solutions docs):
  - Railway `preDeployCommand` semantics
  - Prisma `migrate deploy`, `migrate resolve --rolled-back/--applied`
  - Prisma error codes `P3009`, `P3018`

## Execution Outcome (2026-04-29)

Phase 1 completed against prod between 09:55 and 10:31 UTC.
Recovery deploy `02a481c6-5ece-4116-aa6a-1f275a0df5ed` SUCCESS at
10:31:44 UTC, applying six pending migrations (`0004_transcript_embeddings`
through `0009_keyword_first_lexical`) in 7.3s. Healthcheck passed in
16.5s. No errors. No `next start` warning. Service online, single
replica, serving traffic.

Two findings shifted Phase 2 scope:

1. **`apps/admin/railway.toml` was never honored.** Every successful
   deployment record showed `configFile: null`. Railway only
   auto-discovers `railway.toml` at the repo root; the per-service
   file at `apps/admin/railway.toml` was invisible to Railway from
   day one. The dashboard `Custom Start Command` was the only
   effective `startCommand` the service ever had. Phase 2 Unit 6
   accordingly rewrites the toml to a "dead config" warning instead
   of restructuring it as planned, and defers wiring up
   "Config-as-code Path" to a follow-up.
2. **Drift was wider than diagnosed.** Plan §Problem Frame stated
   prod was at `0006_hybrid_search_gin`. Recovery logs proved prod
   was at `0003_scene_embeddings` — six migrations behind, not
   three. The shadow-override trap had been silently skipping
   migrations since R2 (2026-04-23, PR #828), not since #851
   (2026-04-29). Across two engineers (Nisal, Tatai) and five PRs,
   no migration shipped to prod between 2026-04-23 and 2026-04-29.
   The drift only surfaced when Tatai's R0 sync wrote rows that
   exercised columns from migrations 0007/0008 — the first request
   to actually touch the new schemas.

The recovery applied exactly what was intended across all six
migrations. None were orphan/accidental; every migration was
committed as part of a legitimate, reviewed PR. Migration list and
authorship verified against `git log` per migration directory.

### Recovery sequence (actual)

| Step                         | Action                                                                                       | Outcome                                                                                                                                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-flight audit             | `railway-agent` dump of @forge/admin service config (Unit 1)                                 | Confirmed dashboard `Custom Start Command = pnpm --filter @forge/admin start`, no other shadow overrides                                                                                                         |
| First override-clear attempt | `updateServiceTool({ startCommand: null })` + `redeploy(...)`                                | Failed — `redeploy` snapshotted unchanged canonical config; deploy `3b1408a1` ran the OLD command. Reproduced the staged-patch trap from `platform/railway-mcp-staged-config-never-commits-20260420.md`.         |
| `accept-deploy` (first)      | `mcp__railway__accept-deploy(environmentId)` to flush the cleared override                   | Deploy `e3819150` snapshotted `startCommand: null` correctly, but Railpack failed with `No start command detected` because toml was never honored — confirmed `configFile: null`. Reverted to deploy `3b1408a1`. |
| Set chained startCommand     | `updateServiceTool({ startCommand: "<chained>" })` + `accept-deploy(...)`                    | Deploy `02a481c6` snapshotted the chained command. SUCCESS at 10:31:44.                                                                                                                                          |
| Verification                 | Runtime logs grep for `Applying migration` + `All migrations have been successfully applied` | Confirmed 0004-0009 applied.                                                                                                                                                                                     |

### Sibling audit findings (Unit 8)

Read-only audit via `railway-agent` against `production` env on
2026-04-29 confirmed:

| Service          | Custom Start Command                         | Latent risk                                                                                                                                                                                                                                         | Recommendation                                                                                                                                                          |
| ---------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@forge/admin`   | (recovered today) chained migrate+standalone | Resolved                                                                                                                                                                                                                                            | Out of scope                                                                                                                                                            |
| `@forge/cms`     | `pnpm --filter @forge/cms start`             | **Low** — Strapi v5 manages its own schema; no Prisma migrations in `apps/cms/`. The dashboard override is functionally correct for Strapi's app shape.                                                                                             | File a follow-up ticket to either wire Config-as-code Path or delete the dead `apps/cms/railway.toml`. No behaviour change in this PR.                                  |
| `@forge/manager` | `pnpm --filter @forge/manager start`         | **Medium** — manager uses Prisma. If anyone adds a migration to `apps/manager/prisma/migrations/` without verifying it applied in prod, manager will silently drift the same way admin did. The dashboard override has no `db:migrate:deploy` step. | File a follow-up ticket to either wire Config-as-code Path or update the dashboard `Custom Start Command` to chain `db:migrate:deploy`. No behaviour change in this PR. |
| `@forge/roadmap` | (none — uses defaults)                       | **None** — read-only viewer over `docs/roadmap/`; no DB.                                                                                                                                                                                            | None — clean config.                                                                                                                                                    |

All four services have `apps/<svc>/railway.toml` present but dead.
None have "Config-as-code Path" set on the service. Same trap shape
across the project; varying severity by app concern.

### Lessons captured

- **Repeat of an existing-and-solved-trap.** Two solutions docs from
  2026-04-20 (`platform/railway-mcp-staged-config-never-commits-20260420.md`
  and `best-practices/verify-infra-writes-via-independent-read-path-20260420.md`)
  documented the staged-patch flush requirement. Neither was loaded
  during initial diagnosis on 2026-04-29; the agent reproduced the
  exact failure mode (one extra failed deploy cycle) before searching
  solutions and finding the existing docs. A memory breadcrumb
  (`feedback_railway_mcp_accept_deploy.md`) now points future
  sessions at both docs before any railway-mcp write.
- **Adjacent trap surfaced.** The dashboard-override-shadows-toml
  pattern is _narrower_ than the staged-patch trap. The new solutions
  doc (`deployment/railway-dashboard-override-shadows-railway-toml-20260429.md`)
  cross-links the existing 2026-04-20 docs and adds the
  `configFile: null` detection signal + the per-service-toml-not-honored
  caveat. Authored as Phase 2 Unit 9.
- **Migration-discipline gap.** Five PRs across two engineers shipped
  with the same correct assumption ("a migration in this PR will
  auto-apply"). None verified post-deploy. The recurrence is itself
  the learning: PR templates / CLAUDE.md migration sections need a
  required `prisma migrate status` smoke probe before declaring a
  migration-touching PR complete. Captured in
  `apps/admin/CLAUDE.md` Migrations / runbook section (Phase 2
  Unit 7).
