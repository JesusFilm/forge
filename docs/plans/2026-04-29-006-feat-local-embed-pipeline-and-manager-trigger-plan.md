---
title: "feat: local embed pipeline + manager-side embed trigger parity"
type: feat
status: active
date: 2026-04-29
predecessors:
  - docs/plans/2026-04-19-001-feat-admin-scene-embeddings-infra-plan.md
  - docs/plans/2026-04-22-002-feat-admin-transcript-embeddings-infra-plan.md
---

# feat: local embed pipeline + manager-side embed trigger parity

## Overview

Two parallel changes that land together:

1. **Local-run path for admin's scene + transcript embedding backfills.**
   A direct-invoke CLI mirrors `apps/admin/src/scripts/run-sync.ts` so a
   developer can populate their local `forge_admin` Postgres with real
   embeddings against the freshly-synced Core data — no Cloudflare 524
   timeout, no GraphQL auth dance, no local `CMS_DATABASE_URL`. The
   `coreId → cms-video-id` mapping snapshot is downloaded once from
   admin's **prod** S3 bucket (`cms-storage-jbpuckp0lmqap`,
   `admin-migrations/core-id-mapping.json`) into admin's local-fallback
   storage path. Manager artifacts (`{assetId}/scene-analysis.json`,
   `{assetId}/embeddings.json`) are read live from prod manager S3
   using read-only creds plumbed into the local `.env`.

2. **Manager-side trigger parity.** Manager exposes the same two
   triggers (`triggerSceneEmbeddingBackfill`,
   `triggerTranscriptEmbeddingBackfill`) by **proxying to admin's
   GraphQL mutations** rather than duplicating the workflow. Admin
   remains the sole executor (it owns the destination Postgres
   schema). Manager's surface uses
   `Authorization: Bearer <WORKFLOW_API_KEY>` to authenticate
   service-to-service.

The local path enables real-data dev for embed-dependent features
(R4 hybrid search, R5 scene recommendations, the
`/watch/demo-keyword-search` canary, future AI features). The
manager-parity work removes a workflow gap: today an operator can
only trigger backfills from admin's UI/GraphQL surface; manager
operators have no equivalent path.

## Problem Frame

**Local-run gap.** The two embedding backfill workflows
(`apps/admin/src/workflows/sceneEmbeddingBackfill.ts`,
`apps/admin/src/workflows/transcriptEmbeddingBackfill.ts`) are
useworkflow jobs gated behind ADMIN-only GraphQL mutations and require:

- An ADMIN-authenticated session (no easy way to obtain locally).
- A `coreId → cms-video-id` mapping snapshot in S3 — the existing
  refresh CLI (`apps/admin/src/scripts/refresh-core-id-mapping.ts`)
  shells out to `pnpm --filter @forge/cms dump:core-id-mapping`,
  which needs `CMS_DATABASE_URL` (not set locally).
- Manager-bucket S3 credentials (`MANAGER_ARTIFACTS_S3_*`) — not in
  the local `.env`.

Today, a developer wanting embeddings in their local DB has no
practical path. The result: features that depend on embeddings
(search, recommendations, keyword-first canary) can only be
exercised against prod data through deployed previews.

**Manager-trigger gap.** Manager is the worker app where
`{assetId}/scene-analysis.json` and `{assetId}/embeddings.json`
artifacts originate. Operators inside manager who notice a need to
re-index a batch of assets (e.g. after a manager-side artifact
regeneration) have no in-app way to kick off admin's backfill — they
have to context-switch to admin's GraphQL surface or admin dashboard.
Operationally, the trigger should live next to the work.

The natural architecture is: **admin owns execution** (it owns the
destination Postgres schema, the indexers, the workflow steps);
**manager owns presentation** (the UI button / REST surface).
Behaviour is identical because there is one workflow.

## Requirements Trace

- **R1.** A new admin-side CLI runs `triggerSceneEmbeddingBackfill`
  and/or `triggerTranscriptEmbeddingBackfill` against any
  `DATABASE_URL` by direct-invoking the workflow function with a
  Prisma client. Mirrors `apps/admin/src/scripts/run-sync.ts`.
  Selection between R1, R2, or both is a CLI flag. Filters
  (`coreIds`, `locales` / `languages`) are CLI flags.
- **R2.** The mapping snapshot is sourced from prod admin S3, not
  rebuilt locally. A new admin-side CLI downloads
  `s3://cms-storage-jbpuckp0lmqap/admin-migrations/core-id-mapping.json`
  to admin's local-fallback path
  (`apps/admin/.tmp/objects/admin-migrations/core-id-mapping.json`)
  so the workflow's existing local-fallback storage layer picks it
  up unchanged.
- **R3.** Manager artifacts are read live from prod manager S3 over
  the network. The local `.env` gets read-only
  `MANAGER_ARTIFACTS_S3_*` creds (pulled from Railway). No artifact
  pre-caching, no offline-dev path in this plan.
- **R4.** Admin's two trigger mutations accept
  `Authorization: Bearer <WORKFLOW_API_KEY>` as an alternative to
  the ADMIN session gate. The bearer path resolves a service-account
  principal that satisfies the existing
  `write:scene-embeddings` / `write:transcript-embeddings`
  permission keys. Existing ADMIN-session callers keep working
  unchanged.
- **R5.** Manager exposes two trigger surfaces — REST endpoints
  parallel to admin's mutations — that proxy the call to admin's
  GraphQL endpoint with the bearer key. Input args + output shape
  match admin's mutations field-for-field. Manager surfaces the
  same per-target outcome envelope to its caller.
- **R6.** Local destination is the local Postgres pointed to by
  `DATABASE_URL`. Prod admin DB is never touched by the local path.
- **R7.** Documentation makes the local-run flow runnable from a
  fresh checkout in under 5 minutes given Railway access — a
  one-shot env pull, one-shot mapping pull, one CLI invocation.
- **R8.** No changes to `HybridSearchService`, retrievers, dedup,
  fusion, scene-embedding service, transcript-embedding service,
  or the indexer functions themselves. This plan is purely about
  invocation surfaces and local plumbing.

## Scope Boundaries

**In scope:**

- New CLI `apps/admin/src/scripts/pull-mapping-from-prod.ts` that
  downloads the prod mapping snapshot to local fallback.
- New CLI `apps/admin/src/scripts/run-embeds.ts` that direct-invokes
  the two workflow functions with a Prisma client.
- A bearer-key auth path on admin's two trigger mutations, integrated
  into admin's existing principal resolution (`src/auth/`) so the
  permission gate stays unified.
- New manager REST handlers
  (`apps/manager/src/app/api/admin-embeds/scene/route.ts`,
  `apps/manager/src/app/api/admin-embeds/transcript/route.ts`) that
  proxy to admin's GraphQL endpoint.
- Doppler env-var additions: a new
  `ADMIN_EMBED_TRIGGER_API_KEY` on manager's env (rotation-friendly
  single key rather than the comma-separated allowlist on admin).
- Local-dev `.env.example` updates capturing
  `MANAGER_ARTIFACTS_S3_*` and the optional
  `ADMIN_EMBED_TRIGGER_API_KEY` for local manager testing.
- Documentation: `apps/admin/CLAUDE.md` operational runbook update
  - a new `docs/solutions/platform/local-embed-pipeline-pattern-20260429.md`.

**Out of scope:**

- Pre-caching manager artifacts to a local fallback (rejected as a
  scope boundary). Local runs require network to manager S3.
- Any change to the indexer services, the workflow steps, or the
  embedding generation logic.
- A new shared `packages/embeddings` or similar abstraction.
- Manager UI surfaces (dashboard buttons, forms). REST endpoints
  ship now; a UI affordance is a separate ticket.
- Replacing the existing
  `apps/admin/src/scripts/refresh-core-id-mapping.ts`. That CLI
  remains the source-of-truth path for refreshing the prod snapshot
  (operator-driven, runs against cms PG). The new pull-from-prod CLI
  is a strict consumer of whatever that CLI most-recently uploaded.
- Cross-environment artifact sync (e.g., write embeddings produced
  locally back to prod admin DB). Local-only.
- A consumer-cutover step (R8 of the migration playbook). This plan
  ships the local-dev affordance + manager trigger; consumer
  cutover is unchanged.

## Context & Research

### Relevant Code and Patterns

**Admin (existing — extend or read-only consume):**

- `apps/admin/src/scripts/run-sync.ts` — direct-invoke pattern for
  `runSync()`. The new `run-embeds.ts` mirrors its shape: parses
  flags, builds a `PrismaClient` with the supplied `DATABASE_URL`,
  calls the workflow function, prints structured JSON, exits.
- `apps/admin/src/scripts/refresh-core-id-mapping.ts` — existing
  CLI that _uploads_ the mapping. The new `pull-mapping-from-prod.ts`
  reuses this file's S3 client setup and the
  `DEFAULT_CORE_ID_MAPPING_S3_KEY` constant from
  `@/services/core-id-mapping.constants`.
- `apps/admin/src/storage/s3.ts` — local-fallback storage layer.
  When `RAILWAY_S3_BUCKET` is unset, `getObject(key)` reads from
  `.tmp/objects/<key>`. The pull CLI writes there directly so the
  workflow's existing storage code path is unchanged.
- `apps/admin/src/workflows/sceneEmbeddingBackfill.ts` — the
  workflow function. Exported entry point with input type
  `SceneEmbeddingBackfillInput`. The new CLI calls this directly.
- `apps/admin/src/workflows/transcriptEmbeddingBackfill.ts` —
  parallel.
- `apps/admin/src/graphql/mutations/scene-embedding.ts` and
  `apps/admin/src/graphql/mutations/transcript-embedding.ts` — the
  two mutations whose authScope this plan extends.
- `apps/admin/src/auth/principal.ts` — `SYSTEM_PRINCIPAL` already
  exists for workflow-internal calls. The bearer-key path resolves
  a similar service-account principal at request time.
- `apps/admin/src/auth/permissions.ts` — permission ladder. The
  service-account principal mints a tier that satisfies the
  existing `write:scene-embeddings` /
  `write:transcript-embeddings` keys.
- `apps/admin/src/app/api/workflows/[...workflow]/route.ts` —
  existing bearer-key validation against
  `WORKFLOW_API_KEYS`. The pattern (CSV split, constant-time
  compare, rotation-friendly) is the template; the GraphQL path
  reuses the same env var and same comparator.
- `apps/admin/src/config/env.ts` — env validation. `WORKFLOW_API_KEYS`
  is already declared; no env schema change on admin.

**Manager (existing — extend):**

- `apps/manager/src/app/api/` — REST surface; new handlers slot in
  alongside the existing routes.
- `apps/manager/src/config/env.ts` — env validation; adds the
  `ADMIN_EMBED_TRIGGER_API_KEY` + `ADMIN_GRAPHQL_URL` fields.
- `apps/manager/src/app/api/jobs/...` — existing manager API
  pattern; mirror the response envelope shape for parity.

**Cross-cutting:**

- `apps/admin/CLAUDE.md` — sections "Scene embeddings (R1)",
  "Transcript embeddings (R2)" hold the existing operational
  runbooks. New section appended for local-run + manager trigger.

### Institutional Learnings

- `docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md`
  — R1 pattern doc; the workflow shape this plan invokes locally.
- `docs/solutions/platform/admin-transcript-embeddings-vector-reuse-pattern.md`
  — R2 pattern doc.
- `docs/solutions/platform/backfill-worker-pattern-manager-20260407.md`
  — manager's own backfill pattern; ports the operational vocabulary
  manager operators already know.
- `docs/solutions/security-issues/origin-header-soft-gate-not-security-boundary-20260429.md`
  — relevant only to the contrast: this plan uses a bearer key
  (real auth), not an Origin gate (soft flag). Documenting the
  delta in the new solutions doc avoids confusion with the
  search-debug origin gate.
- `docs/solutions/best-practices/dead-invariant-checks-from-sibling-port-20260422.md`
  — re-derive the auth invariants from admin's existing
  `WORKFLOW_API_KEYS` validator at
  `apps/admin/src/app/api/workflows/[...workflow]/route.ts` rather
  than reinventing.
- `apps/admin/CLAUDE.md` "Conventions" — env vars validated at
  `src/config/env.ts`; never read `process.env` directly. Plumb new
  vars through there.

### External References

Skipped — pure invocation-surface plumbing against admin's existing
workflow functions and a hand-written REST proxy on manager. Both
patterns have multiple in-repo precedents.

## Key Technical Decisions

- **Manager proxies admin, does not duplicate the workflow.** Admin
  owns the destination Postgres schema (`video_scene_locale`,
  `video_transcript`, `video_transcript_chunk`); only admin can
  write to it. Duplicating the workflow into manager would require
  sharing admin's DB credentials with manager, a second Prisma
  client targeting admin's schema, and ongoing two-place
  maintenance for any logic change. Single-executor + thin proxy
  trivially preserves identical behaviour.

- **Bearer-key auth via `WORKFLOW_API_KEYS`, not HMAC, not session.**
  Admin already validates this CSV at
  `apps/admin/src/app/api/workflows/[...workflow]/route.ts`. Reusing
  the env var keeps the auth surface unified. HMAC would add a new
  surface for marginal replay-protection benefit on a request that
  is idempotent and operator-driven. A long-lived service-account
  Better Auth session is heavier and adds session-renewal as an
  ops concern.

- **Service-account principal at the auth layer, not a new authScope.**
  When admin sees a valid bearer key, the request's principal
  resolves to a service-account flavour with a tier that satisfies
  the existing `write:scene-embeddings` /
  `write:transcript-embeddings` permission keys. The mutations
  themselves are unchanged. This keeps the permission ladder as
  the one source of truth and avoids a parallel
  `authScopes: { workflowKey: true }` path that would need to be
  remembered on every future ADMIN-only mutation.

- **CLI mirrors `run-sync.ts` shape exactly.** Same flag-parsing
  pattern (`--scope=...`), same redacted DATABASE_URL log line at
  start, same per-step structured JSON, same `--mapping-key=`
  override default for the prod-pulled snapshot. Operator
  ergonomics carry over verbatim.

- **Pull CLI writes to local-fallback path, not admin's S3.** The
  workflow's existing `loadCoreIdMapping(s3Key)` already reads
  through `apps/admin/src/storage/s3.ts`, which falls back to
  `.tmp/objects/<key>` when `RAILWAY_S3_BUCKET` is unset. The new
  CLI writes there directly. No workflow code path changes; no new
  storage backend.

- **Manager's REST proxy mirrors admin's mutation shape verbatim.**
  Request body fields = admin's mutation args. Response body =
  admin's mutation response, surfaced through. Status-code mapping:
  admin's GraphQL errors translate to 5xx; manager-side validation
  errors (missing key, env unset) become 4xx. Documentation in the
  new solutions doc carries the mapping.

- **Manager keeps a single bearer key (`ADMIN_EMBED_TRIGGER_API_KEY`),
  not a CSV.** Admin's CSV exists for zero-downtime rotation across
  multiple callers. Manager is one caller — a single key keeps the
  manager-side env shape simple. Rotation is a Doppler change on
  both apps simultaneously.

- **Live read of manager artifacts; no pre-cache.** Per planning
  decision. Local-dev requires network access to manager S3
  (read-only creds in `.env`). The trade-off is offline-dev
  unsupported; the gain is one fewer concept and one fewer surface
  to maintain.

- **Local DATABASE_URL is the destination — never prod admin.** The
  CLI does no safety check beyond the explicit env var (mirrors
  `run-sync.ts`). The "do not point this at prod" guarantee lives
  in operator discipline + the documentation, not in code. (cf.
  `run-sync.ts` line 18.)

- **R1 OpenRouter spend is local-environment opt-in.** Running R1
  locally requires `OPENROUTER_API_KEY` or `OPENAI_API_KEY` in
  `.env`. Cost projection: well under $0.01 for the full local
  catalog (≈800 editions × ≈3 locales × ≈25 scenes ≈ 60k embeddings
  at `text-embedding-3-small`). R2 is free.

## Open Questions

### Resolved During Planning

- **Manager parity architecture (proxy vs duplicate)?** Proxy.
  Forced by data ownership. Documented in Key Technical Decisions.
- **Auth pattern (bearer / HMAC / session)?** Bearer via
  `WORKFLOW_API_KEYS`. Per user decision.
- **Artifact source (live read / pre-cache / both)?** Live read
  only. Per user decision.
- **CLI placement (admin vs manager)?** Admin. The CLI is a
  developer affordance for the admin app; manager's parity is
  served by the new REST endpoints, not by giving manager a copy
  of the CLI.
- **Plan filename sequence?** 006 (today's date already has 001–005).

### Deferred to Implementation

- **Exact shape of the service-account principal.** Whether to add a
  new principal flavour to `apps/admin/src/auth/principal.ts` (e.g.
  `SERVICE_ACCOUNT_PRINCIPAL` parameterised by which permission
  key the bearer enables) or to extend the existing
  `SYSTEM_PRINCIPAL` to participate in request-context resolution.
  Plan-default: a small dedicated principal flavour to keep
  workflow-internal usage (`SYSTEM_PRINCIPAL`) distinct from
  request-bound usage. Confirm at implementation when reading the
  current `SYSTEM_PRINCIPAL` shape.
- **Rate-limit posture on manager's REST proxy.** Admin's GraphQL
  endpoint already rate-limits; manager could rely on that or add
  its own bucket. Plan-default: rely on admin; revisit if manager
  starts seeing accidental amplification.
- **GraphQL operation string for manager's proxy.** Hand-rolled
  POST with a string literal (mirroring
  `apps/admin/src/app/watch/demo-keyword-search/search-operation.ts`
  precedent) vs. introducing manager's own gql.tada / codegen path
  against admin's schema. Plan-default: hand-rolled. Promotion to
  codegen is a follow-up gated on a second cross-app GraphQL
  consumer.
- **Whether the pull CLI should also support a `--from=manager`
  read of `embeddings.json` to a local fallback.** Out of scope per
  R3, but if R3 is later relaxed for offline dev, the same CLI
  pattern applies. Defer.
- **Logging shape for the local CLI.** Plan-default: identical to
  `run-sync.ts` structured-JSON output. Confirm in implementation.
- **Whether to expose the local-CLI as a `pnpm run …` script in
  `apps/admin/package.json`.** Plan-default: yes (same shape as
  `refresh:core-id-mapping`). Decide on the script names at
  implementation; suggested: `pnpm pull:mapping`, `pnpm run-embeds`.

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance
> for review, not implementation specification. The implementing
> agent should treat it as context, not code to reproduce._

```
LOCAL-RUN PATH

  workstation
     │
     ├─ pnpm pull:mapping
     │    │
     │    ├─→ S3 (prod admin):   GET cms-storage-jbpuckp0lmqap/admin-migrations/core-id-mapping.json
     │    └─→ local FS:          apps/admin/.tmp/objects/admin-migrations/core-id-mapping.json
     │
     └─ pnpm run-embeds --pipeline=transcript --locale=en
          │
          ├─ DATABASE_URL=postgresql://forge:forge@db:5432/forge_admin
          ├─ MANAGER_ARTIFACTS_S3_* (read-only prod creds)
          ├─ OPENROUTER_API_KEY  (R1 only)
          │
          ├─ direct-invoke runTranscriptEmbeddingBackfill({
          │     mappingS3Key: "admin-migrations/core-id-mapping.json",
          │     coreIds?, languages?,
          │   })
          │     ↓
          │     storage/s3.getObject(key) → local-fallback (the file we just pulled)
          │     ↓
          │     manager-artifacts.service → live S3 GET to manager bucket
          │     ↓
          │     transcript-embedding.service.indexEditionTranscript(...) → local Postgres


MANAGER TRIGGER PATH (prod or local manager → admin)

  manager UI / curl
     │
     ├─ POST manager/api/admin-embeds/scene
     │    body: { coreIds?, locales?, mappingS3Key? }
     │
     └─ manager handler
          │
          ├─ validate body
          ├─ build GraphQL operation (hand-rolled)
          │
          └─ POST admin/api/graphql
                Authorization: Bearer ${ADMIN_EMBED_TRIGGER_API_KEY}
                body: { query, variables: <admin mutation args> }
                  ↓
                  admin context resolves principal:
                    if Authorization: Bearer matches WORKFLOW_API_KEYS
                       → service-account principal (tier satisfies write:scene-embeddings)
                    else if Better Auth session present
                       → ADMIN session principal (existing path)
                    else
                       → public principal (mutation rejected)
                  ↓
                  triggerSceneEmbeddingBackfill resolver runs unchanged
                  ↓
                  per-target outcomes returned
                ↓
          (re-serialise to manager's REST envelope, return to caller)
```

The two paths share zero code execution-side; they share the
_workflow_ code at admin (one workflow, one indexer). That's where
identical-behaviour guarantees come from.

## Implementation Units

### Unit 1: Pull-mapping-from-prod CLI

- [ ] **Unit 1: Pull-mapping-from-prod CLI**

**Goal:** Provide a one-shot operator command that downloads the
prod admin mapping snapshot to admin's local-fallback storage path
so subsequent local workflow invocations can read it through the
existing `storage/s3.ts` `getObject` path with no code changes.

**Requirements:** R2, R7

**Dependencies:** None.

**Files:**

- Create: `apps/admin/src/scripts/pull-mapping-from-prod.ts`
- Create: `apps/admin/src/scripts/pull-mapping-from-prod.test.ts`
- Modify: `apps/admin/package.json` — add `pull:mapping` script
  invoking the CLI via `tsx`.

**Approach:**

- CLI accepts `--bucket=`, `--key=`, `--out=` flags with sensible
  defaults pointing at prod admin's S3 (`cms-storage-jbpuckp0lmqap`,
  `admin-migrations/core-id-mapping.json`,
  `apps/admin/.tmp/objects/admin-migrations/core-id-mapping.json`).
- Reads `RAILWAY_S3_*` from `process.env` directly (mirrors
  `refresh-core-id-mapping.ts` — bypasses the admin env validator
  so the CLI runs in environments without a full env matrix).
- Same S3 client construction pattern as
  `refresh-core-id-mapping.ts::uploadToS3` — `S3Client` +
  `NodeHttpHandler` with 5s connect / 30s request timeouts.
- Writes the downloaded bytes to the resolved local path via
  `mkdir -p` + `writeFile`.
- Prints a structured JSON line on success
  (`{event:"pull-mapping.complete", bucket, key, bytes, outPath}`)
  and exits 0; logs the same redacted bucket the operator passed.

**Patterns to follow:**

- `apps/admin/src/scripts/refresh-core-id-mapping.ts` —
  `NodeHttpHandler` timeouts, `DEFAULT_CORE_ID_MAPPING_S3_KEY`
  constant import path, env-direct-read pattern.
- `apps/admin/src/scripts/run-sync.ts` — flag-parsing pattern
  (`--name=value`), redacted-URL log line at start.

**Test scenarios:**

- Happy path: a fixture S3 client returns a JSON body; CLI writes
  the file at the configured local path; structured success line
  emitted.
- Missing creds: `RAILWAY_S3_ACCESS_KEY_ID` unset → CLI exits
  non-zero with a clear error message naming the missing var.
- Object not found: S3 returns `NoSuchKey` → CLI exits non-zero
  with a one-line message including the bucket + key.
- Custom `--out` path: CLI honours and writes there.
- `--bucket` / `--key` overrides take precedence over defaults.

**Verification:**

- `pnpm --filter @forge/admin pull:mapping` against a real prod
  admin bucket downloads the file and the workflow's
  `loadCoreIdMapping(DEFAULT_CORE_ID_MAPPING_S3_KEY)` resolves
  successfully on a subsequent run.
- All test scenarios green in vitest.

---

### Unit 2: Run-embeds direct-invoke CLI

- [ ] **Unit 2: Run-embeds direct-invoke CLI**

**Goal:** Provide a workstation CLI that invokes
`triggerSceneEmbeddingBackfill` and/or
`triggerTranscriptEmbeddingBackfill` directly (bypassing GraphQL

- auth), against any `DATABASE_URL`, with the same flag UX as
  `run-sync.ts`.

**Requirements:** R1, R6, R7

**Dependencies:** Unit 1 (mapping must exist locally first), but
the CLI itself does not depend on Unit 1 — it just expects the
mapping to be there.

**Files:**

- Create: `apps/admin/src/scripts/run-embeds.ts`
- Create: `apps/admin/src/scripts/run-embeds.test.ts`
- Modify: `apps/admin/package.json` — add `run-embeds` script.
- Modify: `apps/admin/.env.example` — append `MANAGER_ARTIFACTS_S3_*`
  - commentary on `OPENROUTER_API_KEY` requirement for R1.

**Approach:**

- CLI flags:
  - `--pipeline=scene|transcript|both` (required; no default to
    avoid surprise spend).
  - `--mapping-key=admin-migrations/core-id-mapping.json` (default).
  - `--core-id=<id>` (repeatable; accumulates).
  - `--locale=<bcp47>` (R1 only; repeatable).
  - `--language=<bcp47>` (R2 only; repeatable; named differently
    from `--locale` to mirror the workflow input shape — admin's
    R1 uses `locales` axis, R2 uses `languages` axis).
- Builds a `PrismaClient` from `DATABASE_URL` (same
  redacted-URL-log pattern as `run-sync.ts`).
- Calls the workflow function (the exported async function in
  `apps/admin/src/workflows/{scene,transcript}EmbeddingBackfill.ts`
  — name + signature TBD at implementation; the workflow function
  is the same one the GraphQL resolver calls).
- Accumulates per-target outcomes and prints them as structured
  JSON at the end (same shape the GraphQL mutation returns).
- `--pipeline=both` runs scene then transcript serially; one
  failure does not halt the other.

**Patterns to follow:**

- `apps/admin/src/scripts/run-sync.ts` —
  flag-parsing, redacted DATABASE_URL log, structured JSON output,
  `prisma.$disconnect()` in `finally`.
- `apps/admin/src/graphql/mutations/scene-embedding.ts` and
  `apps/admin/src/graphql/mutations/transcript-embedding.ts` — the
  shape of the call into the workflow function, which the CLI
  mirrors.

**Test scenarios:**

- `--pipeline=scene` calls scene workflow only; transcript untouched.
- `--pipeline=transcript` calls transcript workflow only; scene
  untouched.
- `--pipeline=both` runs both serially.
- `--core-id=A --core-id=B` filters as expected.
- Missing `DATABASE_URL` → exit code 2 with clear error.
- Missing pipeline flag → exit code 2 with clear error.
- Workflow throws → exit code 1, fatal-event JSON line printed,
  prisma disconnects.

**Verification:**

- Local run: `pull:mapping` → `run-embeds --pipeline=transcript`
  populates `video_transcript` + `video_transcript_chunk` in local
  DB. R2 is free, so this is the cheapest verification path.
- Re-run is idempotent (workflow upserts on composite keys).
- CLI exits 0 on success; non-zero on fatal failure.

---

### Unit 3: Bearer-key auth on admin's trigger mutations

- [ ] **Unit 3: Bearer-key auth on admin's trigger mutations**

**Goal:** Allow admin's two trigger mutations to be invoked with a
service-to-service `Authorization: Bearer <WORKFLOW_API_KEY>`
header, via principal resolution at request-context creation. The
existing ADMIN-session path is unchanged. The mutations themselves
are unchanged.

**Requirements:** R4, R5 (prerequisite for manager proxy in Unit 4)

**Dependencies:** None on prior units; required by Unit 4.

**Files:**

- Modify: `apps/admin/src/auth/principal.ts` — add a service-account
  principal flavour suitable for request-bound resolution. Tier
  satisfies the existing two embed-trigger permission keys.
- Modify: `apps/admin/src/graphql/context.ts` (or wherever Yoga
  `createContext` resolves the principal — confirm path at
  implementation) — when
  `Authorization: Bearer <key>` matches one of the values in
  `WORKFLOW_API_KEYS`, resolve the request's principal to the
  service-account flavour. Constant-time compare against the CSV
  exactly as `app/api/workflows/[...workflow]/route.ts` does.
- Modify: `apps/admin/src/auth/permissions.ts` — extend the
  permission matrix entry for the two embed-trigger keys to include
  the service-account tier (or equivalent affirmative entry on
  whatever shape the matrix uses).
- Test: `apps/admin/src/auth/principal.test.ts` (new or extend) —
  service-account principal resolution + permission satisfaction.
- Test: `apps/admin/src/graphql/context.test.ts` (new or extend) —
  bearer-header → service-account principal; missing key →
  public; invalid key → public (NOT a 401 — keeps the surface
  uniform with the public path; the mutation rejects on
  permission, not on auth).

**Approach:**

- The bearer-header check happens at context creation, BEFORE
  scope-auth runs. By the time a resolver is invoked, the
  `principal` field carries either the service-account flavour or
  the existing session/public flavour.
- Constant-time compare via the same helper used in
  `app/api/workflows/[...workflow]/route.ts` (or import from
  there if it's currently a private helper — extract if necessary).
- `WORKFLOW_API_KEYS` is already declared in
  `src/config/env.ts`; no schema change.
- Schema-level test (`schema.test.ts` or sibling) confirms the two
  trigger mutations still require the existing permission key —
  this is a regression guard that prevents a future drift where the
  bearer path becomes a wider bypass.

**Patterns to follow:**

- `apps/admin/src/app/api/workflows/[...workflow]/route.ts` — the
  existing bearer-key validator. Extract or mirror its
  CSV-split + constant-time-compare helper.
- `apps/admin/src/auth/principal.ts::SYSTEM_PRINCIPAL` — the shape
  of an internal-only principal; the new service-account principal
  is its request-bound cousin.

**Test scenarios:**

- Valid bearer matching a key in the CSV → service-account
  principal resolves; mutation runs, returns the same envelope as
  an ADMIN-session call.
- Missing bearer → public principal; mutation rejects via existing
  permission gate.
- Invalid bearer → public principal; mutation rejects (uniform
  with the missing-bearer path).
- Bearer with no `WORKFLOW_API_KEYS` env set → public principal
  (CSV is empty allowlist).
- ADMIN session present with no bearer → existing path holds;
  mutation runs.
- ADMIN session present AND a bearer → ADMIN session wins (or
  service-account wins; document the precedence; pick the
  lower-privilege resolution by default to make the test
  deterministic).
- Bearer used on a non-trigger mutation (e.g.
  `triggerExperienceContentDump`) → check whether the matrix entry
  for that mutation's permission key includes the service-account
  tier; if not, mutation rejects. This is the regression guard
  ensuring the bearer path doesn't become a global bypass.

**Verification:**

- All test scenarios green.
- `schema.test.ts` regression guard (or equivalent) passes.
- A manual `curl /api/graphql -H "Authorization: Bearer <key>"`
  against a dev admin invokes the mutation successfully.

---

### Unit 4: Manager REST trigger surfaces

- [ ] **Unit 4: Manager REST trigger surfaces**

**Goal:** Expose manager-side REST endpoints that proxy to admin's
two trigger mutations using the bearer key from Unit 3. Input args

- response envelope match admin's mutations field-for-field.

**Requirements:** R5

**Dependencies:** Unit 3.

**Files:**

- Create: `apps/manager/src/app/api/admin-embeds/scene/route.ts` —
  POST handler.
- Create: `apps/manager/src/app/api/admin-embeds/scene/route.test.ts`.
- Create: `apps/manager/src/app/api/admin-embeds/transcript/route.ts`
  — POST handler.
- Create: `apps/manager/src/app/api/admin-embeds/transcript/route.test.ts`.
- Modify: `apps/manager/src/config/env.ts` — declare
  `ADMIN_EMBED_TRIGGER_API_KEY` (required) and `ADMIN_GRAPHQL_URL`
  (required, defaults to admin's prod GraphQL URL when absent —
  TBD at implementation).
- Modify: `apps/manager/.env.example` — append the two new vars.

**Approach:**

- Each handler:
  - Validates the JSON body against a small Zod schema mirroring
    admin's GraphQL args (`coreIds?`, `locales?` /
    `languages?`, `mappingS3Key?`).
  - Builds a hand-rolled GraphQL operation string + variables.
  - POSTs to `${ADMIN_GRAPHQL_URL}/api/graphql` with
    `Authorization: Bearer ${ADMIN_EMBED_TRIGGER_API_KEY}` and
    `Content-Type: application/json`.
  - Translates admin's response:
    - GraphQL `errors[]` → 502 with a JSON body listing the error
      messages.
    - Network failure → 502 with a network error message.
    - Successful `data.<mutation>` → 200 with the mutation
      response verbatim under `{ result: ... }`.
  - Manager-side validation failures return 400.
- The two handlers share a small helper for the GraphQL fetch +
  error translation; placement TBD (route-local vs
  `apps/manager/src/lib/graphql-client.ts` — promote on second
  consumer following the same convention as the demo route).

**Patterns to follow:**

- `apps/admin/src/app/watch/demo-keyword-search/graphql-client.ts`
  — the hand-rolled fetch wrapper precedent. The manager-side
  version is functionally identical, on the manager side.
- `apps/manager/src/app/api/jobs/...` — manager's existing API
  handler shape, env validation usage, and response envelope
  conventions.

**Test scenarios:**

- Happy path scene: valid body → admin returns success → manager
  returns 200 with the unwrapped mutation response.
- Happy path transcript: same.
- Missing env var (`ADMIN_EMBED_TRIGGER_API_KEY` unset) → 500 at
  handler boot OR clear validation failure on first request
  (decide at implementation; plan-default: env-validation throws at
  module load, so handler returns 500 once with a clear message).
- Validation error in body (e.g. `coreIds` not an array) → 400.
- Admin returns GraphQL error → 502 with admin's error messages
  surfaced in the body.
- Admin endpoint network failure → 502.
- Admin returns ADMIN-permission rejection (i.e. bearer key was
  valid but the mutation's permission gate refused) → 502 with
  the underlying error message; surfaces as a misconfiguration
  signal.

**Verification:**

- All test scenarios green.
- `curl -X POST http://localhost:3001/api/admin-embeds/transcript
-H "Content-Type: application/json" -d '{"coreIds":["..."],
"languages":["en"]}'` against a dev manager pointing at a dev
  admin returns a parseable 200 response that matches admin's
  mutation envelope.

---

### Unit 5: Documentation + memory + .env.example updates

- [ ] **Unit 5: Documentation + memory + .env.example updates**

**Goal:** Capture the new local-run flow and manager trigger
surfaces in `apps/admin/CLAUDE.md`, write a solutions doc, update
`.env.example` files for both apps, and add a memory breadcrumb
so future sessions surface the new path.

**Requirements:** R7

**Dependencies:** Units 1–4.

**Files:**

- Modify: `apps/admin/CLAUDE.md` — append a new section under the
  R1/R2 sections titled "Running embeds locally" with the
  three-step runbook (`pnpm pull:mapping` → set
  `MANAGER_ARTIFACTS_S3_*` (+ optionally `OPENROUTER_API_KEY`) →
  `pnpm run-embeds --pipeline=...`). Cross-reference to the new
  solutions doc.
- Modify: `apps/admin/CLAUDE.md` — append a new section
  "Triggering embeds from manager" cross-referencing manager's
  REST endpoints and the bearer-auth posture.
- Modify: `apps/manager/CLAUDE.md` — add a section pointing at the
  new REST endpoints + linking to admin's runbook.
- Create: `docs/solutions/platform/local-embed-pipeline-pattern-20260429.md`
  — one canonical pattern doc covering the local-fallback storage
  trick, the direct-invoke CLI shape, the bearer-auth pattern, and
  the manager-proxy architecture.
- Modify: `apps/admin/.env.example` — already covered in Unit 2;
  cross-check.
- Modify: `apps/manager/.env.example` — already covered in Unit 4;
  cross-check.
- Update: user memory (`MEMORY.md` index entry + a new memory file)
  — operator pointer at the new runbook so future sessions don't
  re-derive the env requirements.

**Approach:**

- Solutions doc covers:
  - The local-fallback trick: how `apps/admin/src/storage/s3.ts`
    transparently reads from `.tmp/objects/<key>` when
    `RAILWAY_S3_BUCKET` is unset, and why the pull CLI exploits
    it.
  - The direct-invoke pattern: how `run-embeds.ts` mirrors
    `run-sync.ts`, why GraphQL is bypassed for local dev (no auth
    dance, no Cloudflare 524).
  - The bearer-auth pattern: where it lives, why
    `WORKFLOW_API_KEYS` is reused, why the service-account
    principal model.
  - The manager-proxy architecture: why duplication was rejected,
    where the workflow logic lives, how response shape parity is
    achieved.
- CLAUDE.md sections favour pointer-to-runbook over duplication.

**Test scenarios:**

- N/A (documentation). Manual: a fresh-checkout developer can run
  the local-embed flow following `apps/admin/CLAUDE.md` alone in
  under 5 minutes given Railway access (R7 acceptance criterion).

**Verification:**

- A second developer (or a fresh agent session) succeeds at the
  R7 5-minute setup using only the CLAUDE.md runbook.
- Solutions doc filename matches convention.
- Memory entry resolves on a future session lookup for "embed
  local".

## System-Wide Impact

- **Interaction graph:** The local CLIs add no production interaction.
  Manager's REST endpoints add a new caller to admin's GraphQL
  endpoint over the network; admin's existing rate-limiting on
  `/api/graphql` covers this.
- **Error propagation:** Each layer surfaces its own errors with
  appropriate status codes. Manager surfaces admin's errors
  unchanged (no swallowing). Local CLIs surface workflow per-target
  outcomes verbatim.
- **State lifecycle risks:** None new. Workflow upserts are
  idempotent (existing R1/R2 invariants). Local writes are isolated
  to whatever DB `DATABASE_URL` points at.
- **API surface parity:** Manager's REST endpoints mirror admin's
  GraphQL mutations. Future admin-side mutation-shape changes
  require coordinated manager-side updates — captured as a
  CLAUDE.md note alongside the manager runbook.
- **Integration coverage:** Local end-to-end run is the
  highest-fidelity test. CI stays at the unit level (each CLI test
  uses a fixture S3 client + mocked workflow). Real integration
  test against prod manager S3 + admin DB is operator-driven.
- **Affected stakeholders:**
  - **Developers:** new local-dev path for embed-dependent
    features.
  - **Operators:** manager-side trigger removes a context-switch
    when re-indexing a batch from manager.
  - **Future R-stages:** the local-fallback + direct-invoke
    pattern generalises to any future workflow that wants the same
    affordance.

## Risks & Dependencies

- **Mapping snapshot staleness.** The pull CLI takes a point-in-time
  snapshot. If cms's catalogue grows after the pull but before the
  local run, new videos won't be indexable until a refresh. Same
  failure mode as prod's usage of the snapshot (the workflow
  silently skips unmapped coreIds); just visible to the developer.
  Documented in the runbook as a "re-pull when adding new videos
  to local DB".
- **Manager artifact bucket size + bandwidth.** Live read pulls
  per-asset JSON over the public network. R2 (transcripts) is
  ~10MB per asset; full local backfill is ~10GB across the catalog.
  R1 (scene-analysis) is smaller. Bandwidth + cost are minimal but
  not zero. Operator runs scoped subsets via `--core-id=` flags
  for routine dev.
- **Bearer key leakage.** `ADMIN_EMBED_TRIGGER_API_KEY` is a
  long-lived production credential. Doppler is the only authoritative
  store. Local manager dev SHOULD use a separate dev-only key
  scoped to a dev admin instance (see deferred follow-up). Mitigated
  by treating the key as a Tier-1 secret in the bearer
  classification used by admin's `WORKFLOW_API_KEYS` rotation
  pattern.
- **Permission-matrix drift over time.** If a new ADMIN-only
  mutation is added later that touches a different permission key,
  the bearer-auth path won't grant access automatically — that's
  intentional. The risk is the inverse: someone widens the
  service-account principal's tier and accidentally grants the
  bearer caller access to mutations they shouldn't have. Mitigated
  by the schema-level regression test in Unit 3.
- **Manager proxy version drift.** If admin's mutation args
  change, manager's hand-rolled operation string drifts silently.
  The risk surfaces at runtime as a GraphQL error (admin returns
  the validation error verbatim). Mitigated by:
  - Unit 4 test scenario covering admin-side GraphQL errors
    surfacing through manager.
  - Documentation note in `apps/manager/CLAUDE.md` pointing at
    admin's mutation file as the source of truth.
- **Local runs hitting prod manager S3 quota.** Manager's bucket
  may have rate limits or per-account egress caps. A team-wide
  habit of frequent local backfills could surprise the bill or
  trip a rate limit. Mitigated by scoped `--core-id=` runs for
  routine dev; full-catalog runs flagged as one-shot.

## Documentation / Operational Notes

- After Unit 5, `apps/admin/CLAUDE.md` carries the canonical local
  runbook + manager-trigger pointer.
- After Unit 5, `apps/manager/CLAUDE.md` carries the manager-side
  REST surface documentation.
- The new solutions doc
  (`docs/solutions/platform/local-embed-pipeline-pattern-20260429.md`)
  is the durable architectural reference future R-stages can copy
  from when needing the same local-dev affordance.
- PR description records:
  - End-to-end timing of a local R2 backfill on a freshly-synced
    `forge_admin` (rows / minute / total bytes).
  - End-to-end timing of a local R1 backfill (rows / minute /
    OpenRouter spend).
  - Confirmation that
    `curl -H "Authorization: Bearer ..." admin/api/graphql` against
    the trigger mutations works end-to-end.
  - Confirmation that
    `curl manager/api/admin-embeds/transcript` round-trips through
    to admin and returns the expected envelope.

### Out-of-scope follow-ups (PR description should list these)

- Manager dashboard UI button for the trigger (REST surface is
  enough for ops; UI is a separate ticket).
- Pre-cache + offline-dev support (rejected per planning).
- Promotion of the hand-rolled GraphQL fetch helper to a shared
  `src/lib/graphql-client.ts` in either app (gated on a second
  consumer per the demo-route convention).
- Codegen-typed manager → admin operations (gated on operation
  count).
- Replacing `refresh-core-id-mapping.ts` with a "pull-from-prod-or-
  rebuild" hybrid (out of scope; existing CLI is the authoritative
  refresh path against cms PG).
- Cross-environment artifact sync (writing locally-produced
  embeddings back to prod admin DB).
- A safety check that warns when `DATABASE_URL` looks like prod on
  the local CLIs (operator discipline today; consider in a future
  hardening pass).
- Rate-limit posture on manager's REST proxy (today: rely on
  admin's existing limits).
- Service-account principal flavour generalisation if other
  internal callers want the same auth shape.

## Sources & References

- **Predecessor plans:**
  - `docs/plans/2026-04-19-001-feat-admin-scene-embeddings-infra-plan.md`
    (R1 origin)
  - `docs/plans/2026-04-22-002-feat-admin-transcript-embeddings-infra-plan.md`
    (R2 origin)
- **Authoritative pattern docs:**
  - `docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md`
  - `docs/solutions/platform/admin-transcript-embeddings-vector-reuse-pattern.md`
  - `docs/solutions/platform/backfill-worker-pattern-manager-20260407.md`
- **Admin code (consume — do not modify):**
  - `apps/admin/src/scripts/run-sync.ts`
  - `apps/admin/src/scripts/refresh-core-id-mapping.ts`
  - `apps/admin/src/storage/s3.ts`
  - `apps/admin/src/workflows/sceneEmbeddingBackfill.ts`
  - `apps/admin/src/workflows/transcriptEmbeddingBackfill.ts`
  - `apps/admin/src/services/core-id-mapping.service.ts`
  - `apps/admin/src/services/manager-artifacts.service.ts`
  - `apps/admin/src/app/api/workflows/[...workflow]/route.ts`
  - `apps/admin/src/auth/principal.ts`
  - `apps/admin/src/auth/permissions.ts`
  - `apps/admin/src/config/env.ts`
- **Admin code (extend in Unit 3):**
  - admin's GraphQL context creation (path TBD at implementation)
  - `apps/admin/src/graphql/mutations/scene-embedding.ts`
  - `apps/admin/src/graphql/mutations/transcript-embedding.ts`
- **Manager code (extend in Unit 4):**
  - `apps/manager/src/app/api/`
  - `apps/manager/src/config/env.ts`
- **Related precedent:**
  - `apps/admin/src/app/watch/demo-keyword-search/graphql-client.ts`
    (hand-rolled GraphQL fetch precedent; manager mirrors).
