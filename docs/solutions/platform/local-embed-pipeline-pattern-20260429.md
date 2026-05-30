---
title: "Local embed pipeline + manager-trigger parity pattern"
date: 2026-04-29
last_updated: 2026-05-06
problem_type: developer_experience
category: platform
component: admin
root_cause: missing_tooling
resolution_type: tooling_addition
severity: medium
tags:
  - admin
  - manager
  - workflow
  - embeddings
  - local-dev
  - cli
  - graphql
  - bearer-auth
  - useworkflow
  - cross-app
  - s3-fallback
  - prisma
related_pr: 858
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

## Review findings (post-merge)

ce:review on PR #858 surfaced one P1 + several P2/P3 issues that
became permanent prevention rules for any future evolution of this
pattern. Captured here so future plans extending the surface inherit
them.

### Rules

1. **`WORKFLOW_TRIGGER_PERMISSIONS` allowlist must stay narrow.**
   The bearer path bypasses the editorial tier ladder via this
   `ReadonlySet<PermissionKey>`. Adding a key here grants every
   Manager-role JWT holder (and any `MANAGER_API_KEY` holder) access
   to the gated mutation via the manager proxy. The negative test in
   `apps/admin/src/auth/permissions.test.ts` does exhaustive
   `Record<PermissionKey, boolean>` iteration so adding a `PermissionKey`
   without updating the record fails to compile, and toggling it in
   the allowlist without thinking through the manager surface fails
   the assertion. Keep that test as the gate.

2. **Bearer length compare uses `Buffer.byteLength`, not string
   `.length`.** UTF-8 byte length ≠ UTF-16 code-unit length; a
   non-ASCII allowlist entry passing a string-length guard would
   crash inside `timingSafeEqual`'s equal-length precondition and
   surface as a 500 from `createContext`. The guard in
   `apps/admin/src/auth/workflow-bearer.ts` builds buffers up-front
   and compares on `.length` of the buffers. The non-ASCII test in
   `workflow-bearer.test.ts` locks this in.

3. **Cross-app GraphQL fetch needs an explicit timeout.** Default
   `fetch()` has no timeout; manager workers would pin indefinitely
   against a hung admin / Cloudflare edge. `AbortSignal.timeout(15_000)`
   in `apps/manager/src/lib/admin-embed-trigger.ts` is the lightest
   fix; the timeout error is mapped to `network_error` with
   `retryable: true` so callers can distinguish from upstream
   rejection.

4. **Discriminated unions exposed across app boundaries normalize
   their failure shape.** Every non-ok variant of `AdminTriggerEnvelope`
   carries `messages: string[]` + `retryable: boolean` so callers
   fan-in via a single access. The shared route handler at
   `apps/manager/src/lib/admin-embed-route.ts` uses
   `switch (result.reason)` with `const _exhaustive: never = result`
   in the default branch — adding a new variant becomes a compile
   error.

5. **Local-run CLIs that touch real data need explicit env-var
   safety + SIGTERM cleanup.** `run-embeds.ts` enforces
   `DATABASE_URL` presence, redacts it in start logs, and disconnects
   prisma cleanly on Ctrl-C / SIGTERM with exit code 130. Idempotent
   upserts make re-runs safe — operators can interrupt and resume
   without partial-write concerns. Imports are above the `try` so
   the `finally` always sees a bound prisma reference instead of
   masking missing init behind a cast.

6. **Direct-invoke of `"use workflow"` functions is dev/test-only.**
   The build-time directive transform makes direct invocation throw
   in production runtime. Tests + `run-embeds.ts` exploit the same
   inert-in-non-runtime property, but a deployed code path that
   direct-invokes will break at runtime. See
   `docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md`.

   **Corollary (added 2026-05-17 after PR #967):** AND `"use workflow"`
   functions must not call `start()` on **sibling** workflows from inside
   their own `"use step"` bodies. Nested `start()` re-enters
   `workflow/api` and requires a workflow runtime at the inner boundary
   — which the CLI shim's direct-invoke path explicitly does not have.
   If two workflows need to share per-item work, extract a plain async
   service helper and have each workflow's step body call it directly.
   The single-trigger workflow becomes a thin shim around the helper;
   the backfill loop's step body calls the helper inline. See
   [`docs/solutions/best-practices/workflow-step-body-calls-service-not-sibling-workflow-20260517.md`](../best-practices/workflow-step-body-calls-service-not-sibling-workflow-20260517.md)
   for the worked instance (`embedExperienceLocale` between
   `runExperienceEmbedding` and `runExperienceEmbeddingBackfill`).

7. **HTTP status semantics on the proxy.** 503 (not 500) for
   `config_missing` (manager env not set) — operator-fixable
   misconfig is service-unavailable, not unexpected error. 502 for
   upstream admin failures (admin acting as gateway target).

### Architectural diagram (multi-producer, single store)

The pattern generalises beyond the two trigger surfaces shipped in
plan 006. Future producers (e.g., manager's `videoEnrichment`
dispatching to admin instead of writing to cms) should use the same
trigger path:

```
admin run-embeds CLI ───┐
(local dev)             │
admin GraphQL trigger ──┤
(production / cron)     ├──▶ admin Postgres (.embedding columns + HNSW)
manager REST proxy ─────┤    Single embed store; admin owns writes
(operator UI)           │
manager enrichment* ────┘
(* candidate plan 007 — replaces sceneEmbeddingSync's cms write)
```

Manager's `videoEnrichment` workflow currently writes vectors to
cms's `scene_embeddings` table (via `sceneEmbeddingSync`). cms is
sunsetting; that path should be replaced by a call to admin's
trigger mutation using the bearer plumbing this PR added. Tracked
as a future plan; the infrastructure for it now exists.

### Cross-references

- `docs/solutions/platform/optional-railway-s3-local-fallback.md` —
  the predecessor storage-toggle pattern this CLI piggybacks on.
- `docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md`
  — the foundational caveat the local-run path relies on.
- `docs/solutions/auth/spike-auth-header-must-be-env-gated.md` —
  the principal-mint-from-headers rule the bearer path honors
  (allowlist gated by env-presence; never satisfies tier checks).
- `docs/solutions/platform/backfill-worker-pattern-manager-20260407.md`
  — explicitly rejected the local-CLI approach for manager scale.
  Plan 006 reintroduces it for admin local-dev only because
  admin-side concurrency is irrelevant locally; the rejection
  reasoning still applies for manager-side production backfills.
- `docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md`
  — feat-119 PR2 added the **inverse direction**: admin → manager
  outbound dispatch (`triggerManagerEnrichment` mutation →
  `/api/admin-trigger/{scene-analysis,transcript}` endpoints). The
  Railway deploy-ordering invariant documented there ("receiver
  deploys keyring entry FIRST, then caller") applies symmetrically
  to BOTH directions: this document's manager-side proxy needs
  admin's `WORKFLOW_API_KEYS` keyring entry deployed first too,
  before manager's `ADMIN_EMBED_TRIGGER_API_KEY`. Curl-verify the
  503 → 401 transition on either direction's receiver to confirm
  the keyring loaded before deploying the caller's bearer var.
