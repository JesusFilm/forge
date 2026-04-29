---
title: "Local embed pipeline + manager-trigger parity pattern"
date: 2026-04-29
category: platform
tags:
  - admin
  - manager
  - workflow
  - embeddings
  - local-dev
related_pr: null
plan: docs/plans/2026-04-29-006-feat-local-embed-pipeline-and-manager-trigger-plan.md
---

# Local embed pipeline + manager-trigger parity

## What it is

A pattern for running admin's R1 (scene) + R2 (transcript)
embedding backfills locally against any `DATABASE_URL`, plus a
parallel architecture for triggering the same workflows from
apps/manager without duplicating them. Both threads share the
underlying useworkflow function on admin; the local-dev path skips
GraphQL + auth, and the manager path proxies through admin's
GraphQL with a service-account bearer.

## Why it matters

Embed-dependent features (R4 hybrid search, R5 scene
recommendations, the keyword-first canary at
`/watch/demo-keyword-search`, future AI features) need real-data
testing during development. Without this pattern, the only path is
deployed previews — every iteration round-trips through Railway,
Cloudflare's 524 edge timeout, and admin's ADMIN-session gate.

Manager operators saw a parallel gap: artifacts originate in
manager (`{assetId}/scene-analysis.json`,
`{assetId}/embeddings.json`), but the trigger surface for indexing
them lived only on admin. Operators had to context-switch.

## How it works

### Local-run path (workstation → local Postgres)

Three components:

1. **`pull-mapping-from-prod.ts`** — downloads
   `s3://<admin-prod-bucket>/admin-migrations/core-id-mapping.json`
   to `apps/admin/.tmp/objects/admin-migrations/core-id-mapping.json`.
   No `CMS_DATABASE_URL` needed locally; the mapping is a
   point-in-time snapshot of cms's `coreId → cms-video-id`
   resolution that gets refreshed periodically by
   `refresh-core-id-mapping.ts` (which DOES need cms PG).

2. **Storage local-fallback trick** — admin's `src/storage/s3.ts`
   `getObject(key)` reads from `.tmp/objects/<key>` whenever
   `RAILWAY_S3_BUCKET` is unset. Workflow code path is unchanged;
   the local CLI just needs to write to that path.

3. **`run-embeds.ts`** — direct-invokes
   `runSceneEmbeddingBackfill` / `runTranscriptEmbeddingBackfill`
   with the in-process Prisma singleton, mirroring `run-sync.ts`'s
   shape. The workflow functions are exported and callable in
   non-runtime contexts (their tests prove this).

Manager artifacts (per-asset, ~10MB each) are read live from prod
manager S3 over the network — no offline-dev pre-cache. The bucket
is large; pre-caching the full corpus is impractical and not
needed for routine dev.

### Manager-trigger path (manager → admin GraphQL)

Manager exposes two thin REST handlers (`/api/admin-embeds/scene`,
`/api/admin-embeds/transcript`) that:

1. Validate the body with Zod (matches admin's GraphQL arg shapes
   field-for-field).
2. Gate manager-side via `authenticateRequest` (Strapi JWT or
   `MANAGER_API_KEY`).
3. POST to `${ADMIN_GRAPHQL_URL}/api/graphql` with
   `Authorization: Bearer ${ADMIN_EMBED_TRIGGER_API_KEY}`.
4. Surface admin's response envelope unchanged on success;
   translate GraphQL / network errors to 502.

Admin's GraphQL context resolves the bearer header against
`WORKFLOW_API_KEYS` (the same env that the workflow-callback
endpoint validates with HMAC) and mints a `WORKFLOW_TRIGGER`
principal that satisfies only
`write:scene-embeddings` + `write:transcript-embeddings` —
explicitly NOT a generic ADMIN role.

## Key design decisions

- **Admin owns execution; manager owns presentation.** Duplicating
  the workflow into manager would require sharing admin's DB
  credentials, a second Prisma client targeting admin's schema, and
  ongoing two-place maintenance. The proxy keeps data ownership
  unified.

- **Reuse `WORKFLOW_API_KEYS`.** Admin already validates this CSV
  on its workflow-callback endpoint with HMAC. The new bearer-on-
  GraphQL path uses the same env var as a plain-bearer allowlist.
  Doppler rotates one key; both surfaces pick it up.

- **Service-account principal at the auth layer, not a new
  authScope.** When admin sees a valid bearer, the request's
  `principal` resolves to `WORKFLOW_TRIGGER`. The mutation's
  existing `authScopes: { hasPermission: 'write:scene-embeddings' }`
  is unchanged; the permission-check helper has an explicit
  allowlist for the workflow-trigger role. No `meetsTier`
  modifications — workflow-trigger never satisfies tier-based
  checks.

- **Permission allowlist is narrow.** Only the two embed-trigger
  keys. Adding new mutations to `WORKFLOW_TRIGGER_PERMISSIONS`
  widens the bearer caller's blast radius and is a deliberate
  decision.

- **Session wins over bearer.** A logged-in admin session is never
  downgraded by the presence of a bearer header. The bearer path
  applies only when there's no session.

- **Local DATABASE_URL is the destination.** Mirrors `run-sync.ts`
  posture: no in-script prod-URL detection. Operator discipline
  - the explicit env var are the safety. Future hardening could add
    a `DATABASE_URL` pattern check (e.g. warn on `*.proxy.rlwy.net`).

## Files

**Admin:**

- `apps/admin/src/scripts/pull-mapping-from-prod.ts` — local CLI
  for the prod S3 download.
- `apps/admin/src/scripts/run-embeds.ts` — local CLI for the
  direct-invoke run.
- `apps/admin/src/auth/workflow-bearer.ts` — bearer-key validator.
- `apps/admin/src/auth/principal.ts` — adds the `WORKFLOW_TRIGGER`
  role + principal constant.
- `apps/admin/src/auth/permissions.ts` —
  `WORKFLOW_TRIGGER_PERMISSIONS` allowlist + `hasPermission` early
  return.
- `apps/admin/src/graphql/context.ts` — wires bearer-header check
  into context creation.

**Manager:**

- `apps/manager/src/lib/admin-embed-trigger.ts` — GraphQL POST
  helper with discriminated outcome.
- `apps/manager/src/app/api/admin-embeds/scene/route.ts` — REST
  endpoint.
- `apps/manager/src/app/api/admin-embeds/transcript/route.ts` —
  REST endpoint.

## Related learnings

- `docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md`
  — R1's workflow shape that this pattern invokes.
- `docs/solutions/platform/admin-transcript-embeddings-vector-reuse-pattern.md`
  — R2's vector-reuse posture (why R2 is free locally).
- `docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md`
  — workflow direct-invoke caveat (works in test/dev, not in
  production runtime). The local CLI relies on the same
  direct-invoke property tests use.

## Operational notes

- **Env rotation:** `WORKFLOW_API_KEYS` (admin) +
  `ADMIN_EMBED_TRIGGER_API_KEY` (manager) — rotate together via
  Doppler. Admin's CSV supports zero-downtime rotation (multiple
  valid keys at once); manager carries a single key.
- **Mapping refresh cadence:** the prod snapshot is refreshed by
  `refresh:core-id-mapping`. Pull a fresh local copy whenever
  cms's catalogue grows materially; otherwise the existing snapshot
  stays valid (Strapi SERIAL ids don't change).
- **Cost:** R2 local backfill is free (vector reuse). R1 local
  backfill spends OpenRouter credits — projected well under $0.01
  for the full local catalogue at current scale.
- **Bandwidth:** local R1+R2 over the full catalogue pulls ~10GB
  of artifact JSON from manager S3. Operator runs scoped subsets
  via `--core-id=` flags for routine dev; full-catalog runs are
  one-shot.
