---
title: "fix(admin): wire `prisma migrate deploy` into Railway predeploy hook for @forge/admin"
type: fix
status: superseded
date: 2026-04-29
superseded_by: docs/plans/2026-04-29-004-fix-admin-prod-migration-recovery-plan.md
---

> **Superseded by `docs/plans/2026-04-29-004-fix-admin-prod-migration-recovery-plan.md`
> on 2026-04-29.** This plan was hypothesis-driven (cause "suspected"
> dashboard override). The 004 plan is diagnosis-driven, adds Phase 1
> recovery, includes a sibling-service audit, and ships a dedicated
> solutions doc. Recovery completed against prod 2026-04-29 10:31 UTC
> via the 004 plan; the durable fix lives in the 004 PR.

# fix(admin): wire `prisma migrate deploy` into Railway predeploy hook for @forge/admin

## Overview

`apps/admin/railway.toml` already declares a `startCommand` that runs
`pnpm --filter @forge/admin db:migrate:deploy && node apps/admin/.next/standalone/apps/admin/server.js`,
yet the production deploy that landed PR #854 (commit `ce0ea169`)
booted with `pnpm start` → `next start` — the package.json default.
Migration `0009_keyword_first_lexical` therefore did not apply to
admin's prod DB even though the deploy was marked SUCCESS. The
runtime symptom is dormant only because `video_locale` is empty and
no consumer hits keyword-first mode yet.

This plan moves the migration step from the chained `startCommand`
shape into Railway's `preDeployCommand` (cleaner failure semantics,
preferred by the user's spec), restores the standalone Next.js
`startCommand`, diagnoses why admin's `railway.toml` was being
bypassed, and lands the verification + recovery runbook in
`apps/admin/CLAUDE.md`.

## Problem Frame

PR #854 deployed `0009_keyword_first_lexical` migration code but the
prod DB never got the migration applied. Two intertwined causes:

1. **Failure semantics in current shape.** Even when the chained
   `startCommand` IS honored, a failed migration crashes the
   container mid-startup. Railway's `restartPolicy` retries 3 times,
   then the deploy fails. Healthcheck timeout hides the real reason
   in deploy logs. The fail-loud signal arrives late.
2. **Config not being honored.** Deploy logs from `24f9be60`
   (2026-04-29 03:32-03:37Z) show `Starting Container` →
   `⚠ "next start" does not work with "output: standalone"` →
   `> @forge/admin@0.0.1 start /app/apps/admin` → `> next start`.
   That output comes from `apps/admin/package.json`'s `start` script,
   not from `apps/admin/railway.toml`'s `startCommand`. Sibling
   services (`apps/cms`, `apps/manager`, `apps/roadmap`) use the same
   per-service `railway.toml` pattern and are working, which suggests
   admin's bypass is a service-level dashboard override or a
   recent regression — not a repo-pattern issue.

The fix is mechanical (move to `preDeployCommand`, restore the
standalone start), but it requires confirming _why_ the existing toml
was being ignored — otherwise a fresh fix in the same file may also
be ignored.

## Requirements Trace

- **R1.** Every successful deploy of `@forge/admin` must apply pending
  Prisma migrations before traffic switches to the new image.
- **R2.** A migration failure must block traffic and surface as a
  loud, fail-fast deploy failure (not a crash-loop on the running
  container).
- **R3.** Re-deploys of the same image must be idempotent — no
  errors, no duplicate work, identical observable behavior.
- **R4.** The shape must be safe under future N>1 replicas. Two
  replicas booting in parallel must not race the migration.
- **R5.** A documented manual fallback must exist for emergency
  use (`railway run pnpm --filter @forge/admin db:migrate:deploy`).
- **R6.** Operational runbook in `apps/admin/CLAUDE.md` covers
  failure-mode recovery (`P3009`/`P3018` Prisma lock states),
  rollback semantics, and the smoke probe to verify a deploy
  applied migrations cleanly.

## Scope Boundaries

**In scope:**

- `apps/admin/railway.toml` restructure: `[deploy].preDeployCommand`
  - `[deploy].startCommand` (standalone-correct).
- Diagnose and resolve whatever is causing `railway.toml` to be
  bypassed in the admin Railway service (dashboard override audit).
- `apps/admin/CLAUDE.md` Deployment + Migrations sections + a new
  "Predeploy migration hook" subsection with the runbook.

**Out of scope:**

- Same hook for `cms` / `manager` / `roadmap` (they have their own
  patterns; if they're miswired, that's a separate ticket).
- Any change to migration files, including `0009`. No `CONCURRENTLY`
  rewrite, no expression edits.
- Tatai's PR #846 (`fix/admin-core-sync-bulk-upsert`) — operational
  prereq for Core sync writing rows in prod; tracked separately.
- Triggering Core sync in prod (deferred until this PR + #846 land).
- Replacing `[deploy.env]` with dashboard env (already done; CLAUDE.md
  flags this).
- Alternative: app-startup migration (rejected — fails noisily, not
  loudly; and races at N>1).

## Context & Research

### Relevant Code and Patterns

- `apps/admin/railway.toml` — current shape: chained
  `startCommand = "<migrate> && <node standalone>"`. Migration step
  is present but evidently bypassed by the running deploy.
- `apps/admin/package.json` — scripts:
  - `start`: `next start` (the script the deploy is actually
    running — the warning in deploy logs comes from this).
  - `db:migrate:deploy`: `prisma migrate deploy`.
  - `postinstall`: `prisma generate`.
- `apps/admin/next.config.ts` — `output: "standalone"` is set;
  `typedRoutes: true`; wrapped with `withWorkflow` (workflow plugin).
- Sibling pattern (working today): `apps/cms/railway.toml`,
  `apps/manager/railway.toml`, `apps/roadmap/railway.toml`. Admin's
  shape mirrors them in form.
- `nixpacks.toml` at repo root — Nixpacks-level build config; check
  for any conflicts that might explain the bypass.
- Build command preserves the full repo at `/app/`, including
  `node_modules`, `prisma/`, `prisma/migrations/`. So
  `prisma migrate deploy` from inside the runtime container has
  what it needs — confirmed by the fact that the existing chained
  startCommand was designed to run it, and `railway run pnpm
--filter @forge/admin db:migrate:deploy` works from a dev's
  workstation against the same env.

### Institutional Learnings

- `docs/solutions/deployment/nextjs-pnpm-monorepo-railway-standalone.md`
  — the standalone-start + monorepo + pnpm story for admin.
- `apps/admin/CLAUDE.md` "Common pitfalls" — `[deploy.env]` in
  `railway.toml` is unreliable (use dashboard); standalone start
  must be `node .next/standalone/.../server.js`, not `next start`.
- `docs/solutions/database-issues/prisma-unsupported-placeholder-for-raw-sql-generated-columns-20260429.md`
  — relevant because schema.prisma now declares `titleTsv` /
  `descriptionTsv` placeholders for the new generated columns.
  After this hook lands and 0009 applies, the schema is in sync.
- `docs/solutions/database-issues/postgres-generated-column-drift-add-column-if-not-exists-20260429.md`
  — generated-column drift trap; non-recurring concern for this PR
  but worth a CLAUDE.md cross-link.
- `docs/solutions/best-practices/prisma-bulk-upsert-pattern-20260428.md`
  - sibling docs from PR #846 — relevant after this hook ships
    because Core sync prereq becomes unblocked.

### External References

Skipped — Railway's `preDeployCommand` semantics are well-documented
and the repo's existing per-service `railway.toml` pattern is enough
local signal. Salient facts: `preDeployCommand` runs in a fresh
container based on the deployed image, with the same env as the
main container, before traffic switches; non-zero exit fails the
deploy and the existing image keeps serving.

## Key Technical Decisions

1. **Use `preDeployCommand`, not chained `startCommand`.** Failure
   semantics: a failed migration in `preDeployCommand` keeps the
   existing image serving and surfaces a "Pre-deploy failed" Railway
   status. A failed migration in `startCommand` chain crashes the
   new container mid-boot, exhausts `restartPolicyMaxRetries=3`, and
   only then marks the deploy failed — slower, more confusing
   logs, brief partial-traffic risk. `preDeployCommand` is the
   user's stated preference.

2. **Keep `startCommand` standalone-correct.** The current toml
   already has the right standalone start
   (`HOSTNAME=0.0.0.0 node apps/admin/.next/standalone/apps/admin/server.js`).
   Once the toml is honored, the `next start` warning disappears as
   a side benefit.

3. **Diagnose-then-fix the bypass.** If admin's Railway service has a
   dashboard-level startCommand or "Custom Start Command" override,
   the toml will keep being ignored regardless of how clean it is.
   Step 1 of execution: inspect Railway's admin service settings
   for any service-level overrides via `railway-agent` or the
   dashboard, and clear them if present (operator-driven; capture
   the before/after).

4. **Concurrent-replica safety is automatic.** `preDeployCommand`
   runs once per deploy in a single container, not per replica.
   `_prisma_migrations`'s advisory lock additionally covers the
   never-observed edge case of two simultaneous deploys racing.
   N>1 future shape needs no extra plumbing.

5. **Manual `railway run` fallback stays viable.** It already works
   today and gives an operator a one-shot path that doesn't depend
   on triggering a redeploy. Document, don't replace.

6. **Forward-only rollback semantics.** Prisma migrations are
   forward-only. Rolling back to an earlier image leaves the schema
   ahead of the code. Today's contents — `0007`, `0008`, `0009` —
   are all additive (new tables, new columns, new indexes); no
   pre-0007 code references the new shape, so a code-side rollback
   is functionally safe. Document this clearly so a future migration
   that drops or renames knows the rule changes.

## Open Questions

### Resolved During Planning

- **Format: `railway.toml` or `railway.json`?** Stick with `railway.toml`
  — already in tree, mirrors siblings, both formats are supported.
- **`preDeployCommand` vs chained `startCommand`?** `preDeployCommand`
  per R2 (loud-fail) and the user's stated preference.
- **Where does prisma + migrations live in the runtime image?** At
  `/app/` (Nixpacks preserves the full repo). The existing chained
  startCommand referenced this path and was clearly designed for it;
  no extra `outputFileTracingIncludes` work is needed.
- **What about pnpm on PATH?** Available in the Nixpacks runtime
  image; the existing `railway run pnpm --filter @forge/admin
db:migrate:deploy` flow proves this.
- **Will the standalone start command warning disappear?** Yes —
  once the toml is honored, the deploy boots
  `node apps/admin/.next/standalone/apps/admin/server.js` directly,
  no `next start` wrapper.

### Deferred to Implementation

- **Why is admin's `railway.toml` being bypassed today?** Suspect a
  service-level dashboard override on the admin service. Confirm
  via `railway-agent` inspection of service settings. Possible
  alternates: monorepo "Root Directory" misconfig, recent Railway
  config-precedence change, or a stale start-command override left
  from an earlier troubleshooting session. Resolution path depends
  on what's found.
- **Does the existing `healthcheckPath = "/api/health"` resolve
  correctly?** `/api/health` is referenced in the toml but the
  search-feature health probe (`/api/search/health`) is the only
  health-shaped route called out in `apps/admin/CLAUDE.md` R4
  section. If `/api/health` doesn't exist, the deploy will pass
  preDeploy but fail healthcheck → traffic doesn't switch → the
  whole deploy still gets marked failed. Verify at execution: if
  missing, this is a sibling fix (or a follow-up).
- **Doppler env injection shape.** If admin uses a Doppler wrapper
  command instead of standard Railway env injection, the
  `preDeployCommand` may need the same wrapper. Verify against
  the working preDeploy on a sibling service (`cms`/`manager`)
  before merge.
- **Failure-mode coverage.** P3009 (failed previous migration row)
  and P3018 (migration cannot be applied) lock states need a
  documented recovery path in the runbook. Confirm the exact
  CLI invocation against the latest Prisma docs at execution time
  (`prisma migrate resolve --rolled-back <name>` vs
  `--applied <name>`).

## High-Level Technical Design

> _Directional guidance for review, not implementation specification.
> The implementing agent should treat this as context, not code to
> reproduce._

```toml
# apps/admin/railway.toml — target shape

[build]
builder = "NIXPACKS"
buildCommand = "pnpm install --frozen-lockfile && pnpm --filter @forge/admin... build && cp -r apps/admin/.next/static apps/admin/.next/standalone/apps/admin/.next/static"

[deploy]
# Migrations run in a fresh container based on the deployed image,
# BEFORE traffic switches. Non-zero exit blocks the deploy; the
# existing image keeps serving. Idempotent across redeploys —
# `prisma migrate deploy` is a no-op when there are no pending
# migrations. Concurrent-replica safe (runs once per deploy, not
# per replica).
preDeployCommand = "pnpm --filter @forge/admin db:migrate:deploy"

# Standalone Next.js boot — Nixpacks build copies the repo so this
# path is valid at runtime. Removes the `"next start" does not work
# with "output: standalone"` warning from the deploy logs.
startCommand = "HOSTNAME=0.0.0.0 node apps/admin/.next/standalone/apps/admin/server.js"

healthcheckPath = "/api/health"
healthcheckTimeout = 60
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

```
Deploy lifecycle (preDeploy success path):

  Image build              ──▶ Pre-deploy container         ──▶ Main container
  (existing buildCommand)      preDeployCommand:                startCommand:
                               pnpm prisma migrate deploy       node ...standalone/server.js
                               exit 0                           healthcheck /api/health
                                  │                                │
                                  ▼                                ▼
                               traffic switches              old image stops

Deploy lifecycle (preDeploy failure path):

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

## Implementation Units

- [ ] **Unit 1: Diagnose the bypass + restructure `apps/admin/railway.toml`**

**Goal:** Move the migration step from the chained `startCommand` into
`preDeployCommand`, restore the standalone-correct `startCommand`,
and confirm the toml is actually being honored by the admin Railway
service.

**Requirements:** R1, R2, R3, R4

**Dependencies:** None.

**Files:**

- Modify: `apps/admin/railway.toml`
- (No tests — this is config; behavior is verified via the post-deploy
  smoke probe documented in Unit 2.)

**Approach:**

1. Audit Railway service settings for `@forge/admin` (service id
   `bdb15048-1ca9-4217-ae01-ef7cc19ca6f4`) via `railway-agent` to
   identify any dashboard-level overrides on `Custom Start Command`,
   `Custom Build Command`, or `Pre-Deploy Command`. Capture the
   before-state in the PR description.
2. Clear any conflicting overrides so the per-service `railway.toml`
   becomes authoritative. Sibling services (`cms`, `manager`,
   `roadmap`) honor their `railway.toml` files; admin should match.
3. Rewrite the `[deploy]` block to split migrations (preDeploy) from
   start (standalone server). Keep `healthcheckPath`,
   `healthcheckTimeout`, `restartPolicyType`,
   `restartPolicyMaxRetries` unchanged in this PR — they're not
   in scope and changing them would expand blast radius.
4. Validate by deploying the PR to a Railway preview environment
   first if available. The deploy logs should show a separate
   pre-deploy step with `Applying migration ...` lines, then the
   main container booting `node ...standalone/...server.js` with
   no `"next start" does not work` warning.

**Patterns to follow:**

- Sibling per-service `railway.toml` files in `apps/cms`,
  `apps/manager`, `apps/roadmap` (working today; mirror the
  shape, not the contents — admin has unique build steps).

**Test scenarios:**

- _Happy path:_ PR redeploys cleanly; preDeploy log shows
  `Applying migration 0009_keyword_first_lexical`; main container
  boots without the `next start` warning; replica online; healthcheck
  passes.
- _No-pending migration redeploy:_ Same image redeployed → preDeploy
  logs `No pending migrations to apply`, exit 0, deploy succeeds,
  no behavior change.
- _Forced failure:_ Temporarily point at a bad `DATABASE_URL` (or
  use a preview env with a wrong env var) and confirm the deploy
  marks FAILED at the pre-deploy stage, the existing image keeps
  serving, and the failure is visible in Railway's UI.
- _Standalone start verification:_ After deploy, `curl
https://admin.jesusfilm.org/api/health` returns 200 (assuming
  /api/health exists; if not, treat as a sibling finding per the
  deferred questions).

**Verification:**

- Railway deploy log shows preDeploy + start as distinct steps.
- `_prisma_migrations` row exists for `0009_keyword_first_lexical`
  with `finished_at` non-null.
- `pg_extension` row exists for `pg_trgm`.
- Both new GIN indexes (`video_locale_lexical_weighted_idx`,
  `video_locale_title_trgm_idx`) exist on `video_locale`.
- `next start` warning gone from boot logs.
- The chained-startCommand artifact is removed; only the new
  preDeploy + standalone-start shape remains.

---

- [ ] **Unit 2: Update `apps/admin/CLAUDE.md` (Deployment + Migrations + Runbook)**

**Goal:** Document the preDeploy hook, the standalone start, the
forward-only rollback rule, the failure-mode recovery playbook, and
the post-deploy smoke probe so the next operator (or future agent)
doesn't have to re-derive any of this.

**Requirements:** R5, R6

**Dependencies:** Unit 1.

**Files:**

- Modify: `apps/admin/CLAUDE.md`
  - "Deployment" section: replace the brief
    "Railway service `forge-admin`..." paragraph with the new
    preDeploy + standalone-start shape, cross-linked to
    `railway.toml`.
  - "Migrations" section: add forward-only rule, P3009/P3018
    recovery path, manual `railway run` fallback.
  - New "Predeploy migration hook (operational runbook)"
    subsection: smoke probe queries, expected healthy outputs,
    failure signals + rollback triggers.

**Approach:**

- Mirror the format used by R1/R2/R3 operational runbooks already
  in CLAUDE.md (numbered steps, "Common things to remember"
  bullet list at the bottom).
- Cross-reference: existing solution docs
  (`prisma-unsupported-placeholder-...`,
  `postgres-generated-column-drift-...`,
  `nextjs-pnpm-monorepo-railway-standalone`) so a reader walking the
  failure path lands on the right institutional learning.
- Smoke probe queries reuse the three from PR #854's post-deploy
  checklist; centralize them here so they're not orphaned in a PR
  description.
- Failure-mode runbook covers:
  - P3009 (`Migration ... was rolled back, please review`) →
    `railway run pnpm --filter @forge/admin prisma migrate resolve
--rolled-back <name>` after fixing the underlying cause.
  - P3018 (migration cannot be applied — typically a logical
    error in the migration SQL) → fix the migration in a follow-up
    PR; do NOT use `--applied` to fake-resolve a real failure.
  - Network egress / DATABASE_URL absence → fail-loud at preDeploy;
    operator confirms env in dashboard.
  - `pg_trgm` extension privilege missing → preDeploy fails on
    `0009`; resolve out-of-band (platform team grants `CREATE`
    on the role) and redeploy.

**Patterns to follow:**

- Existing R1/R2/R3 operational runbooks in `apps/admin/CLAUDE.md`
  (Scene embeddings, Transcript embeddings, Experience content
  dump). Same numbered-steps + "Common things to remember"
  shape.

**Test scenarios:**

- _Doc renders:_ No broken cross-links. New section appears
  between Migrations and the next R-section.
- _Operator dry-run:_ A reader following the runbook on a clean
  preview deploy reproduces the SUCCESS state (smoke queries
  return expected rows). Performed by hand at PR-open time, not
  as a test asset.

**Verification:**

- CLAUDE.md updated.
- Cross-links resolve.
- Runbook's smoke queries match the SQL in PR #854's post-deploy
  checklist (single source of truth henceforth).
- No content from the existing Deployment / Migrations sections
  silently dropped.

## System-Wide Impact

- **Interaction graph:** Adds a pre-deploy step (~2-30s for an
  empty migration; up to a few minutes once R0 lands data). No
  callback / middleware / observer changes. No app code changes.
- **Error propagation:** Failed migration → deploy fails → existing
  image keeps serving. No partial-state window. Recovery is
  operator-driven via the runbook.
- **State lifecycle risks:** Forward-only migrations + rollback to
  earlier image leaves schema ahead. With today's content (0007,
  0008, 0009 all additive), rolling back code is functionally safe.
  A future migration that drops or renames changes this rule —
  CLAUDE.md flags the rule but a future PR will need a deeper
  rollback playbook.
- **API surface parity:** None. cms/manager/roadmap unchanged.
- **Integration coverage:** Smoke probe in the runbook is the
  cross-layer check. No automated test surface fits a config
  change of this shape.

## Risks & Dependencies

- **Bypass diagnosis is the unknown.** If a Railway dashboard
  override is the cause and the admin owner can't clear it without
  permission, this PR is operationally blocked even though the
  code change is correct. Mitigation: confirm via `railway-agent`
  before merge; flag as a release-owned step in the PR description.
- **Image must contain `prisma/` + migrations + Prisma engine.**
  Today's Nixpacks build preserves the full repo, so this is
  satisfied. A future build optimization that strips the runtime
  image (Docker multi-stage, slim standalone) would break this hook
  silently. Mitigation: a CLAUDE.md note that any build-output
  optimization must preserve `prisma/migrations/` and `node_modules/.bin/prisma`.
- **`/api/health` healthcheck path may not exist.** If absent, the
  deploy will pass preDeploy but fail healthcheck → traffic
  doesn't switch → the deploy is marked failed even though the
  migration applied. Mitigation: verify the path during execution
  or change to `/api/search/health` (R4-installed and known to
  work). This is in scope for Unit 1's verification.
- **Doppler env shape.** If admin uses a Doppler wrapper command
  the preDeploy needs to use the same wrapper. Mitigation: confirm
  against a working sibling preDeploy.
- **`pg_trgm` extension privilege.** First admin migration to need
  it. If the prod role lacks `CREATE` on the database, 0009 fails
  loud at preDeploy. Mitigation: pre-deploy privilege check (covered
  in PR #854's checklist).

## Documentation / Operational Notes

- CLAUDE.md updates land as part of Unit 2.
- PR description should include: the before/after of any Railway
  dashboard overrides cleared, the deploy log excerpt showing the
  new preDeploy step, the smoke probe results from a preview
  deployment, and the residual-risk list above.
- Recommend a 24h soak after merge before triggering Core sync —
  gives the predeploy hook time to prove on a non-search deploy
  cadence that it doesn't regress anything else.
- Out-of-scope follow-ups to capture in the PR description:
  - Same hook audit for `cms` / `manager` / `roadmap` (are they
    actually applying migrations on deploy? — verify with their
    deploy logs).
  - Healthcheck-path correctness audit if `/api/health` is missing.
  - Future-rollback playbook for when a non-additive migration
    lands.
  - PR #846 (`fix/admin-core-sync-bulk-upsert`) merge — operational
    prereq for Core sync writing rows in prod.

## Sources & References

- PR #854 — keyword-first port whose deploy surfaced this gap.
- `apps/admin/railway.toml` (current shape; the file the toml-bypass
  diagnosis is centered on).
- `apps/admin/CLAUDE.md` — Deployment, Migrations, Common pitfalls.
- `apps/admin/next.config.ts` — `output: "standalone"`.
- `apps/admin/package.json` — `db:migrate:deploy`, `start`, `postinstall`.
- Sibling `railway.toml` files in `apps/cms`, `apps/manager`,
  `apps/roadmap` (pattern reference).
- `docs/solutions/deployment/nextjs-pnpm-monorepo-railway-standalone.md`
- `docs/solutions/database-issues/prisma-unsupported-placeholder-for-raw-sql-generated-columns-20260429.md`
- Railway docs: `preDeployCommand` semantics, `restartPolicy`,
  healthcheck contract.
- Prisma docs: `prisma migrate deploy`, P3009 / P3018 recovery via
  `prisma migrate resolve`.
