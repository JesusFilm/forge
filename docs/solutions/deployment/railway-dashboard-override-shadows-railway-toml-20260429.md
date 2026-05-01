---
title: Railway dashboard config silently shadows per-service `apps/<svc>/railway.toml` — five PRs of admin migrations skipped before detection
date: 2026-04-29
tags: [railway, deployment, migrations, prisma, monorepo, infrastructure, mcp]
category: deployment
severity: high
related:
  - platform/railway-mcp-staged-config-never-commits-20260420.md
  - best-practices/verify-infra-writes-via-independent-read-path-20260420.md
  - deployment/nextjs-pnpm-monorepo-railway-standalone.md
  - database-issues/prisma-unsupported-placeholder-for-raw-sql-generated-columns-20260429.md
---

## Problem

For ~1 week (2026-04-23 through 2026-04-29) the `@forge/admin` Railway
service silently skipped every Prisma migration shipped to prod.
`apps/admin/railway.toml` declared a chained startCommand —
`pnpm --filter @forge/admin db:migrate:deploy && node …standalone/server.js`
— but Railway never read that file. The actual runtime startCommand,
set as a dashboard-level **Custom Start Command** override, was
`pnpm --filter @forge/admin start` — a `next start` invocation that
never ran migrations.

Five PRs landed in that window, each adding a Prisma migration:

| Migration                              | PR            | Author | Date       |
| -------------------------------------- | ------------- | ------ | ---------- |
| `0004_transcript_embeddings`           | #828 (R2)     | Nisal  | 2026-04-23 |
| `0005_r3_experience_cms_dump_snapshot` | #834 (R3)     | Nisal  | 2026-04-23 |
| `0006_hybrid_search_gin`               | #837 (R4)     | Nisal  | 2026-04-24 |
| `0007_admin_core_sync_coverage`        | #851 (R0)     | Tatai  | 2026-04-29 |
| `0008_reference_locale_rows`           | #851 (R0)     | Tatai  | 2026-04-29 |
| `0009_keyword_first_lexical`           | #854 (R4-ext) | Nisal  | 2026-04-29 |

Each PR shipped, deploy was marked SUCCESS, no migration ever applied.
The drift didn't surface until R0 sync (the first PR whose code
actually wrote rows that depended on the new columns) ran in prod
on 2026-04-29 — `triggerSync(scope:"all", incremental:false)` wrote
**0 rows across all 5 phases** in 78.9s, all phases erroring on
missing columns/tables (`audio_preview_value`, `continent_locale`,
`osis_id`, `video_dub_download.source`, `language_locale`, etc.).

Two separate engineers, five reviewed PRs, six accumulated migrations.
The trap survived every code review.

## Root cause

Railway discovers `railway.toml` only at the **repo root** by default.
A per-service file at `apps/<svc>/railway.toml` is invisible unless
the service's **Config-as-code Path** is explicitly set in the
Railway dashboard. The `@forge/admin` service had never had that path
configured. The toml was therefore dead config from the day the
service was created.

In parallel, the same dashboard had a service-level **Custom Start
Command** override of `pnpm --filter @forge/admin start`. This was
the only effective `startCommand` the service ever had — it ran
`next start`, ignored the toml's intended chained command, and
emitted the `"next start" does not work with "output: standalone"`
warning at every container boot (visible in deploy logs but not
surfaced as an error).

The two issues compound: a dead toml AND a misleading dashboard
override. Either alone would have caused a different failure
shape; together they produced a silent, persistent skip.

### Detection signal that should have caught this earlier

Every successful @forge/admin deployment record had:

```
"configFile": null
```

That field shows what config file Railway actually read for the
deploy. `null` means "no railway.toml was honored." It was visible
on every deploy but never inspected. A future check should treat
`configFile: null` on a service that ships a per-service toml as a
flag, not a default.

## Recovery (2026-04-29)

The recovery is operator-driven, ~10 minutes once the diagnosis is
clear:

1. **Audit the service config** via `railway-agent` (or
   `getServiceConfigTool`) for the production env. Capture every
   dashboard-level override on Custom Start / Build / Pre-Deploy
   Commands, Healthcheck, Restart Policy, Watch Patterns, Replicas,
   Root Directory.
2. **Set the dashboard `Custom Start Command`** to the chained
   recovery value:
   ```
   pnpm --filter @forge/admin db:migrate:deploy && \
     HOSTNAME=0.0.0.0 node apps/admin/.next/standalone/apps/admin/server.js
   ```
   via `mcp__railway__updateServiceTool` — note this writes to a
   staged patch buffer.
3. **Flush the staged patch** with
   `mcp__railway__accept-deploy(environmentId)`. Do NOT use
   `mcp__railway__redeploy` — see
   [`platform/railway-mcp-staged-config-never-commits-20260420.md`](../platform/railway-mcp-staged-config-never-commits-20260420.md).
4. **Watch the deploy log.** Expect:
   ```
   > @forge/admin@0.0.1 db:migrate:deploy /app/apps/admin
   > prisma migrate deploy
   ...
   Applying migration `0004_transcript_embeddings`
   Applying migration `0005_r3_experience_cms_dump_snapshot`
   Applying migration `0006_hybrid_search_gin`
   Applying migration `0007_admin_core_sync_coverage`
   Applying migration `0008_reference_locale_rows`
   Applying migration `0009_keyword_first_lexical`
   All migrations have been successfully applied.
   ▲ Next.js 16.2.4
   ✓ Ready in 0ms
   ```
5. **Verify** with `prisma migrate status` (via `railway run`) — every
   migration listed as applied, none pending.

The recovery deploy of 2026-04-29 (id `02a481c6-5ece-4116-aa6a-1f275a0df5ed`)
applied all six pending migrations in 7.3s, healthcheck passed in
16.5s, total deploy time 7m. Service online, no errors, no
`next start` warning.

## Sibling exposure (audited 2026-04-29)

Same project, same trap-shape. None broken today; latent risk varies.

| Service          | Dashboard Custom Start Command           | Latent risk                                                                                                                                   |
| ---------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `@forge/admin`   | (fixed today) chained migrate+standalone | Resolved                                                                                                                                      |
| `@forge/cms`     | `pnpm --filter @forge/cms start`         | Low — Strapi v5 manages its own schema; no Prisma migrations in `apps/cms/`                                                                   |
| `@forge/manager` | `pnpm --filter @forge/manager start`     | **Medium** — uses Prisma; if anyone adds a migration without verifying it applied in prod, manager will silently drift the same way admin did |
| `@forge/roadmap` | (none — defaults)                        | None — read-only viewer over `docs/roadmap/`; no DB                                                                                           |

For each, `apps/<svc>/railway.toml` exists but is also dead config
(none of the services have **Config-as-code Path** set). The cms and
manager dashboard overrides are functionally correct for their app
shape (no migrations expected on every boot), so the trap is dormant
rather than active.

**Recommendation:** file separate follow-up tickets per service to
either (a) set Config-as-code Path so the toml becomes authoritative,
or (b) delete the dead toml and document the dashboard as canonical.
Do NOT change behaviour as part of admin's recovery PR — blast radius.

## Symptoms checklist

If you see any of the following on a Railway service that has a
per-service `railway.toml`:

- ✗ Deploy log boots `next start` despite toml declaring
  `node …standalone/…/server.js`.
- ✗ The `"next start" does not work with "output: standalone"`
  warning appears at every container start.
- ✗ Deploy logs do NOT show `Applying migration` lines, even when the
  toml declares a `prisma migrate deploy && …` chained startCommand.
- ✗ Deployment record's `configFile` field is `null`.
- ✗ Deployment record's `startCommand` field is the dashboard
  override, not the toml value.
- ✗ Schema-mismatch errors (`The column X does not exist`,
  `The table X does not exist`) appear at runtime even though the
  Prisma client expects those columns/tables.
- ✗ A long-dormant feature ships with empty tables, then breaks loudly
  the first time anything writes rows that exercise the new schema.

…the service is in this trap. Audit dashboard overrides + check
`configFile` before iterating on hypotheses about the runtime errors.

## Prevention

### Service-creation checklist

When creating a new Railway service that will use a per-service
`railway.toml`:

1. **Set Config-as-code Path explicitly** to the relative path of the
   toml (e.g., `apps/admin/railway.toml`). Without this, the toml is
   dead.
2. **Audit dashboard-level overrides immediately after creation.** Any
   dimension Railway "auto-detected" should match the toml byte-for-
   byte, or the toml should be cleared. Mismatch = future trap.
3. **Smoke-deploy with a sentinel.** Add a `console.log("railway.toml-honored: <commit>")`
   line to the boot path, redeploy, and grep deploy logs for it.
   Confirms toml is being read.
4. **Capture `configFile` in a post-deploy assertion.** A
   `configFile: null` on a service that ships a toml is a config
   smell to investigate, not a default.

### Migration discipline (specifically for Prisma services)

The trap survived 5 PRs because no one verified migrations actually
applied. Every PR that adds a migration should include a post-merge
verification step:

1. After the deploy of the PR completes, run `railway run pnpm --filter @forge/<svc> exec prisma migrate status`
   against prod (or read deploy logs for `Applying migration` lines).
2. If `migrate status` reports the new migration as `Pending` or
   `Following migrations have not yet been applied`, STOP. The deploy
   pipeline is not honoring migrate-deploy. Don't ship downstream PRs
   until the pipeline is fixed.
3. Add this verification to the PR description's "Post-deploy
   monitoring" section as a required check, not a nice-to-have.

### Engineering bar

Don't trust toml-as-source-of-truth on a Railway service. Either:

- Wire Config-as-code Path so the toml IS authoritative, and keep
  the toml as the single source. Or:
- Delete the toml and document the dashboard as authoritative,
  including the exact dashboard values in `apps/<svc>/CLAUDE.md`.

A toml-that-looks-authoritative-but-isn't is the worst of both
worlds. That was admin's state for ~6 months.

## Why the institutional learning was missed

Two existing solutions docs already covered adjacent shapes of this
trap:

- [`platform/railway-mcp-staged-config-never-commits-20260420.md`](../platform/railway-mcp-staged-config-never-commits-20260420.md)
  documents the staged-patch flush requirement
  (`updateServiceTool` + `accept-deploy`).
- [`best-practices/verify-infra-writes-via-independent-read-path-20260420.md`](../best-practices/verify-infra-writes-via-independent-read-path-20260420.md)
  documents the meta-pattern: write-tool ACK is not state change.

Both were authored 9 days before the recovery. Neither was loaded
during initial diagnosis on 2026-04-29 — the agent reproduced the
same staged-patch trap (one extra failed deploy cycle) before
searching solutions and finding the existing docs.

The recurrence is itself the learning: **before any railway-mcp write,
search `docs/solutions/platform/railway-*` and
`docs/solutions/deployment/railway-*`.** Memory breadcrumb for future
sessions:
[`feedback_railway_mcp_accept_deploy.md`](../../../home/vscode/.claude/projects/-workspace/memory/feedback_railway_mcp_accept_deploy.md)
in agent memory points at both docs.

## Related

- [`platform/railway-mcp-staged-config-never-commits-20260420.md`](../platform/railway-mcp-staged-config-never-commits-20260420.md)
- [`best-practices/verify-infra-writes-via-independent-read-path-20260420.md`](../best-practices/verify-infra-writes-via-independent-read-path-20260420.md)
- [`deployment/nextjs-pnpm-monorepo-railway-standalone.md`](nextjs-pnpm-monorepo-railway-standalone.md) — standalone-vs-`next start` boot pattern
- [`database-issues/prisma-unsupported-placeholder-for-raw-sql-generated-columns-20260429.md`](../database-issues/prisma-unsupported-placeholder-for-raw-sql-generated-columns-20260429.md) — the schema.prisma vs raw-SQL drift companion (relevant because 0009's tsvector columns triggered this exact drift trap)
- `docs/plans/2026-04-29-004-fix-admin-prod-migration-recovery-plan.md` — the recovery plan
- `docs/plans/2026-04-29-003-fix-admin-prisma-migrate-on-deploy-plan.md` — superseded predecessor plan (was hypothesis-only)
