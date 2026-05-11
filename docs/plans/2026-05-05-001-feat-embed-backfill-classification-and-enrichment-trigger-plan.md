---
title: "feat-119: NoSuchKey classification + missingArtifacts list + decoupled enrichment trigger"
type: feat
status: active
date: 2026-05-05
origin: docs/roadmap/content-discovery/feat-119-embed-backfill-artifact-missing-classification-and-opt-in-enrichment.md
---

# feat-119: NoSuchKey classification + missingArtifacts list + decoupled enrichment trigger

## Overview

Two stacked PRs against `apps/admin` and (PR2 only) `apps/manager`. PR1 makes the embed-backfill report's signal honest by classifying AWS S3 `NoSuchKey` failures as `skipped { reason: "artifact_missing" }` instead of `failed`, and adds a structured `missingArtifacts: ReadonlyArray<{ assetId, coreId, kind }>` field to the workflow report so an operator gets an actionable list of upstream gaps. PR2 introduces the **first admin → manager outbound dispatch** — a decoupled trigger endpoint the operator calls explicitly with a list of `assetId`s (typically copied from PR1's report) to fire enrichment jobs in manager. The two PRs stay deliberately decoupled: PR2 adds zero code paths in the embed workflows. The operator is the orchestrator of the two-step flow.

## Problem Frame

Surfaced by the smoke run for `feat-115` (PR #882): a 10-minute scoped run produced 4,169 `scene_index_failed` outcomes vs 1,780 succeeded — but every single failure was the same NoSuchKey shape, meaning manager hadn't yet enriched those assets. The "failures" are upstream-data-readiness signals, not real failures.

Two consequences:

1. **Operator signal degrades.** `report.failed` becomes meaningless (mostly benign data gaps); `report.skipped` becomes dishonestly always-zero. Real failures get drowned out.
2. **Stage 4 (`feat-118`, content-hash skip) breaks immediately** — its new `skipped_unchanged` outcome rolls into the `skipped` bucket, but with today's classifier `report.skipped === 0` for a corpus full of missing artifacts.

Root cause: `manager-artifacts.service.ts` regex-matches the AWS error _message_ (`/not found|missing|no such key|ENOENT|NoSuchKey/i.test(message)`), but AWS SDK v3's textual message is `"The specified key does not exist."` — none of those tokens match. The typed surface (`error.name === "NoSuchKey"`) is what should be branched on.

The opportunity: once PR1 makes the classification honest, the workflow can also surface the deduped set of upstream gaps as a first-class report field. PR2 then provides a primitive (`triggerManagerEnrichment(assetIds, kind)`) that the operator calls with that list to close the loop manually — no automatic admin → manager dispatch from inside the embed workflow.

## Requirements Trace

(See origin: `docs/roadmap/content-discovery/feat-119-embed-backfill-artifact-missing-classification-and-opt-in-enrichment.md`)

**PR1 — classification + report**

- R1.1 NoSuchKey (AWS SDK v3 typed `error.name`) classifies as `ManagerArtifactError("artifact_missing")` instead of `"artifact_read_failed"`.
- R1.2 Legacy `error.Code === "NoSuchKey"` and `error.name === "NotFound"` (HEAD/GET shape) classify as `artifact_missing`.
- R1.3 Local-fallback `ENOENT` keeps classifying as `artifact_missing` via regex backstop (no behavior regression).
- R1.4 Unrelated errors (network reset, 503, ACL denial, etc.) classify as `artifact_read_failed` (regex no longer over-matches).
- R1.5 `BackfillReport` carries a new `missingArtifacts: ReadonlyArray<{ assetId, coreId, kind }>` field on both R1 (scene) and R2 (transcript) workflows.
- R1.6 `missingArtifacts` is deduped by `assetId`, sorted ascending, derived only from `skipped { reason: "artifact_missing" }` outcomes (excluding `failed` outcomes — report stays honest).
- R1.7 `triggerSceneEmbeddingBackfill` / `triggerTranscriptEmbeddingBackfill` GraphQL response includes `missingArtifacts` (additive only, JSON-scalar return preserved — no new typed Pothos object, no leak-guard surgery).
- R1.8 New `--report-out=<path>` CLI flag on `pnpm run-embeds` writes the final report JSON to a file, so PR2's `--from-report` has a stable input.
- R1.9 New solutions doc `docs/solutions/runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md` cross-linked with `parallel-workflow-error-robustness-20260420.md`.
- R1.10 `apps/admin/CLAUDE.md` R1+R2 sections updated.

**PR2 — decoupled enrichment trigger**

- R2.1 New manager endpoint `POST /api/admin-trigger/scene-analysis` accepting `{ assetIds: number[] }`, bearer-auth, returning `[{ assetId, managerJobId, status: "started" | "already_in_flight" | "not_found" }]`.
- R2.2 New manager endpoint `POST /api/admin-trigger/transcript` (same shape; underlying pipeline is a new transcript-only path — the existing `/api/enrich` is too heavy).
- R2.3 Manager-side bearer-auth via new env var `ADMIN_TRIGGER_API_KEYS` (CSV, zero-downtime rotation), validated with `Buffer.byteLength + timingSafeEqual` per existing manager-auth convention.
- R2.4 In-flight idempotency: manager checks for an existing in-flight `EnrichmentJob` for the requested `assetId` (and the matching pipeline kind); if one exists, return its job ID with `status: "already_in_flight"`.
- R2.5 New admin GraphQL mutation `triggerManagerEnrichment(assetIds: [Int!]!, kind: ManagerEnrichmentKind!): [ManagerEnrichmentDispatchResult!]!`.
- R2.6 Admin holds single env var `MANAGER_TRIGGER_API_KEY` + new env var `MANAGER_API_BASE_URL` (e.g., `https://manager.jesusfilm.org`).
- R2.7 New admin permission key `write:manager-enrichment-trigger` added to `WORKFLOW_TRIGGER_PERMISSIONS` allowlist; matrix-level negative test ensures no accidental drift.
- R2.8 New admin CLI `pnpm trigger-enrichment` accepting `--asset-ids=1,2,3 --kind=scene-analysis` AND `--from-report=<path> --kind=…` (reads PR1's report, extracts deduped assetIds matching the kind).
- R2.9 Structured per-dispatch log line `event=enrichment_triggered, assetId, kind, managerJobId, status, durationMs`.
- R2.10 New solutions doc `docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md` documenting the inverted cross-app pattern + Railway deploy ordering.
- R2.11 Both `apps/admin/CLAUDE.md` and `apps/manager/CLAUDE.md` updated with the new bidirectional trigger surface and deploy-ordering invariant.
- R2.12 **Hard constraint**: PR2 modifies zero lines in `sceneEmbeddingBackfill.ts`, `transcriptEmbeddingBackfill.ts`, or the `BackfillOutcome` discriminated union. Diff scope verifiable via `git diff main...HEAD`.

**Cross-cutting**

- R3.1 Both PRs ship local-only smoke; no prod smoke (no prod core-sync run yet to seed the corpus). PR descriptions carry a pre-merge prod-readiness checklist.
- R3.2 `schema.test.ts` `embed|vector|similarit` leak guard stays green throughout.
- R3.3 Idempotency contract preserved on existing trigger mutations and DB writes.
- R3.4 Vision-model and embedding-model invariants preserved (no copying, no caching).

## Scope Boundaries

- **Not scoped**: Auto-orchestrator inside the embed workflow that polls for enrichment completion and re-fires the embed step. Embed and enrichment stay manually orchestrated.
- **Not scoped**: New `BackfillOutcome` variants (`enrichment_failed`, `enrichment_timed_out`, etc.) — these were proposed in the original ticket but are no longer needed under the decoupled shape.
- **Not scoped**: `pLimit`-slot release-during-wait variant (b) — there is no wait inside the embed workflow at all.
- **Not scoped**: Cms-side embedding reuse during R8 cutover.
- **Not scoped**: Per-day budget / quota for admin-triggered enrichments. Future ticket if usage justifies it.
- **Not scoped**: Admin-UI button for "enrich missing artifacts." PR2 ships GraphQL + CLI; UI is a future ticket calling the same primitive.
- **Not scoped**: `feat-118` (Stage 4, content-hash skip). PR1's classification fix unblocks it but Stage 4 lands separately.
- **Not scoped**: Prod smoke. Local smoke only; PR descriptions document prod-readiness so eventual rollout is mechanical.

## Context & Research

### Relevant Code and Patterns

**PR1 surface (apps/admin):**

- `apps/admin/src/services/manager-artifacts.service.ts` — current regex classifier at the R1 site (around line 80, `readSceneAnalysisArtifact`) and R2 site (around line 210, `readEmbeddingsArtifact`). Both branches use the same regex; both will route through a new shared `isArtifactMissing(error: unknown): boolean` helper.
- `apps/admin/src/services/manager-artifacts.service.ts` — `ManagerArtifactError` class at lines 47–59. Literal-union `code` is `"artifact_missing" | "artifact_invalid" | "artifact_read_failed"`. **No new code variant** — the AWS-typed branch maps to the existing `artifact_missing`.
- `apps/admin/src/storage/s3.ts::readManagerArtifact` — underlying reader. AWS SDK v3 throws errors with `name === "NoSuchKey"` on GET miss and `name === "NotFound"` on HEAD miss.
- `apps/admin/src/workflows/sceneEmbeddingBackfill.ts` — `BackfillTarget` (lines 104-118), `BackfillGroup` (128-130), `BackfillOutcome` discriminated union (132-154), `SceneEmbeddingBackfillReport` (156-169). Group cascade in `processGroup` (442-507) already branches on `error instanceof ManagerArtifactError && error.code === "artifact_missing"`; the cascade emits L `skipped { reason: "artifact_missing" }` outcomes per missing group. **`missingArtifacts` derives from these outcomes — no new state, just a projection.** Exhaustive `switch + never` reducer in `stepReport` at lines 562-602.
- `apps/admin/src/workflows/transcriptEmbeddingBackfill.ts` — mirrors the above with `language` instead of `locale`. `processGroup` cascade at 427-488; reducer at 544-584.
- `apps/admin/src/graphql/mutations/scene-embedding.ts` and `transcript-embedding.ts` — Pothos `builder.mutationFields(...)` with `type: "JSON"` (typeless scalar return). Authed via `authScopes: { hasPermission: "write:scene-embeddings" | "write:transcript-embeddings" }`.
- `apps/admin/src/graphql/schema.test.ts` — leak guard `expect(key).not.toMatch(/embed|vector|similarit/i)` runs over field keys per scanned type. JSON-scalar returns bypass field-scan; PR1's additive `missingArtifacts` field on the JSON payload doesn't trigger the guard.
- `apps/admin/src/scripts/run-embeds.ts` — bespoke argv parser (`parseSingle`, `parseRepeated`); registered as `"run-embeds": "tsx src/scripts/run-embeds.ts"` in `apps/admin/package.json`. Currently writes JSON-line events to stdout only and a final `run-embeds.complete` JSON object — **no file output**.
- `apps/admin/src/services/manager-artifacts.service.test.ts`, `apps/admin/src/workflows/sceneEmbeddingBackfill.test.ts`, `apps/admin/src/workflows/transcriptEmbeddingBackfill.test.ts` — test mocks via `vi.mocked(readSceneAnalysisArtifact).mockRejectedValueOnce(new ManagerArtifactError(...))`. Tests must throw the **real** AWS SDK error class (or a faithful shape) for the typed-error path to be exercised.

**PR2 surface (apps/admin + apps/manager):**

- `apps/manager/src/app/api/admin-embeds/scene/route.ts` and `apps/manager/src/app/api/admin-embeds/transcript/route.ts` — the **reverse-direction** proxy. Calls `proxyAdminEmbedTrigger` from `apps/manager/src/lib/admin-embed-route.ts`. PR2's new endpoints sit alongside as `apps/manager/src/app/api/admin-trigger/scene-analysis/route.ts` and `apps/manager/src/app/api/admin-trigger/transcript/route.ts`.
- `apps/manager/src/lib/auth.ts` — `authenticateRequest` accepts Strapi JWT or single `MANAGER_API_KEY` via `timingSafeEqual` after `Buffer` conversion. PR2 introduces a sibling validator `validateAdminTriggerBearer` that checks against the new CSV `ADMIN_TRIGGER_API_KEYS`.
- `apps/manager/src/lib/admin-embed-route.ts` — the reverse-direction error envelope shape: 200 `{ result }` / 400 `{ error, details? }` / 401 `{ error }` / 502 `{ error, reason: "graphql_error"|"network_error"|"parse_error", messages, retryable }` / 503 `{ error, reason: "config_missing", messages, retryable }`. **PR2 mirrors this discriminated envelope exactly** for the new admin-trigger routes.
- `apps/manager/src/app/api/scene-analysis/route.ts` — existing per-asset trigger. Body is `{ videoId, assetId, muxAssetId, subtitleUrl, videoLabel, bibleVerses? }`; uses `next/server` `after()` to background-run `runSceneAnalysisPipeline`. PR2's new endpoint either calls into this or invokes the pipeline directly. **Caveat**: existing endpoint requires `subtitleUrl` already populated; PR2 must derive it on the manager side from CMS metadata, since admin only has `assetId`.
- `apps/manager/src/workflows/sceneAnalysisPipeline.ts` — `runSceneAnalysisPipeline(input)`. Pipeline writes via `writeArtifact({ assetId, artifactType: "scene-analysis", ... })`.
- `apps/manager/src/lib/state.ts` — `EnrichmentJob` lifecycle (`createJob/getJob/listJobs/updateJob/updateStepStatus`) backed by Strapi GraphQL. **No native `assetId` idempotency-check column today** — PR2's idempotency check is implemented as a `listJobs({ status: "running" }) + filter` query on the manager side (or a new lightweight in-memory dedupe if Strapi-roundtrip is too slow).
- `apps/manager/src/services/embeddings.ts` and `apps/manager/src/services/transcription.ts` — for the transcript endpoint, PR2 needs to invoke the transcription leg only (NOT the full `/api/enrich` flow). This means a new manager-internal "transcript-only" entry point that runs transcription → embeddings without scene-analysis.
- `apps/admin/src/graphql/mutations/manager-enrichment.ts` — **NEW FILE**. Pothos `builder.mutationFields((t) => ({ triggerManagerEnrichment: t.field({ ... }) }))` with `JSON` scalar return + `authScopes: { hasPermission: "write:manager-enrichment-trigger" }`.
- `apps/admin/src/auth/permissions.ts` — `WORKFLOW_TRIGGER_PERMISSIONS` ReadonlySet at lines 162-165. Add `"write:manager-enrichment-trigger"` and update the compile-time `permissionMatrix` exhaustive iteration in `permissions.test.ts` so the negative test covers the new key.
- `apps/admin/src/services/manager-trigger.service.ts` — **NEW FILE**. The HTTPS client that admin's GraphQL resolver calls. Wraps the outbound POST with `AbortSignal.timeout(15_000)`, single bearer header, discriminated `ManagerTriggerEnvelope` return per kind. Mirror admin-embed-trigger.ts on manager side (`apps/manager/src/lib/admin-embed-trigger.ts`).
- `apps/admin/src/scripts/trigger-enrichment.ts` — **NEW FILE**. Same `parseSingle`/`parseRepeated` pattern as `run-embeds.ts`. Registered as `"trigger-enrichment": "tsx src/scripts/trigger-enrichment.ts"` in `apps/admin/package.json`.
- `apps/admin/src/config/env.ts` — new `MANAGER_API_BASE_URL: z.string().url()` and `MANAGER_TRIGGER_API_KEY: z.string().min(1).optional()`.
- `apps/manager/src/config/env.ts` — new `ADMIN_TRIGGER_API_KEYS: z.string().min(1).optional()` (CSV, parsed at use-site).

**Infrastructure:**

- Manager → admin uses the public Cloudflare-fronted URL (`https://admin.jesusfilm.org/api/graphql`). PR2 mirrors: admin → manager uses public URL `https://manager.jesusfilm.org`. Railway internal DNS could be cleaner but the public URL pattern is established and the ms-level latency premium is negligible for fire-and-forget dispatch.
- Railway env-var changes via the railway-MCP must end with `accept-deploy(envId)` per memory; never `redeploy` alone. `getServiceConfigTool` masks values whether committed or staged — verify via runtime, not readback.

### Institutional Learnings

- **`docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md`** — typed-error + literal-union `code` rule. PR1's `isArtifactMissing` helper extends the same surface to a new error origin (AWS SDK v3 typed errors). Tests must throw the _real_ AWS SDK shape, not a generic `new Error("NoSuchKey: ...")` — that would make the test pass via the regex backstop while the typed path stays untested.
- **`docs/solutions/best-practices/per-parent-child-memoization-loadedartifact-pattern-20260505.md`** §4 — the group-level cascade where `missingArtifacts` derives from. `processGroup` already emits L `skipped { reason: "artifact_missing" }` outcomes per missing group; PR1's report-derivation collapses the L cascade entries into one `MissingArtifact` per `assetId`.
- **`docs/solutions/best-practices/batched-provider-input-position-stable-contract-20260505.md`** — sibling Stage 2 pattern. Reinforces the literal-union `code` discipline; PR1's AWS-typed branch maps to the existing `artifact_missing` code rather than introducing a new one.
- **`docs/solutions/best-practices/verify-infra-writes-via-independent-read-path-20260420.md`** — mocked-success ≠ real success. Generalized "verify via real read path." The mocked-vs-real-error-shape lesson for PR1 is a sibling instance; **compound candidate** for a meta-pattern doc post-feat-119.
- **`docs/solutions/database-issues/pgvector-bulk-insert-on-conflict-pattern-20260505.md`** (feat-117) — the same mocked-vs-real lesson applied to SQL. Mocked SQL-shape tests pass while real PG-function-resolution / enum-case fails. Same discipline applies to PR1: mocked AWS errors throw `new Error("NoSuchKey")` and pass the regex path, while real `error.name === "NoSuchKey"` fails the typed path. **Local smoke against real S3 is mandatory.**
- **`docs/solutions/platform/local-embed-pipeline-pattern-20260429.md`** — manager → admin trigger pattern. PR2 inverts this. Load-bearing rules to mirror inverted: caller-side single key + receiver-side CSV; `AbortSignal.timeout(15_000)`; discriminated envelope with `messages: string[] + retryable: boolean`; `Buffer.byteLength + timingSafeEqual` bearer compare; narrow service-account principal allowlist with exhaustive `Record<PermissionKey, boolean>` negative test; 502 vs 503 status semantics (`graphql_error|network_error|parse_error` vs `config_missing`); SIGTERM cleanup with exit 130 in CLI; idempotent upserts so re-runs are safe.
- **`docs/solutions/auth/spike-auth-header-must-be-env-gated.md`** — principal-mint-from-headers must be allowlist-gated by env-presence and never satisfy tier checks. PR2's manager-side `validateAdminTriggerBearer` follows this.
- **`docs/solutions/best-practices/throwaway-operator-harness-deletion-contract-20260430.md`** — single-folder discipline for operator tooling. PR2's CLI script lives co-located with `run-embeds.ts` under `apps/admin/src/scripts/`.
- **`docs/solutions/platform/railway-mcp-staged-config-never-commits-20260420.md`** + memory `feedback_railway_mcp_accept_deploy.md` — every railway-MCP write ends with `accept-deploy(envId)`. Verify via runtime, not readback. **Compound candidate**: paired-env-var deploy ordering for cross-app dependencies has no prior solution doc.
- **`docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md`** — `"use workflow"` direct-invoke is dev/test-only. Applies to admin's CLI side; not relevant to PR2's `triggerManagerEnrichment` mutation (manager runs its own runtime).
- **`apps/admin/CLAUDE.md` "Permission system"** — every new `builder.prismaObject` needs `@classification abac-gated|public-shape` JSDoc. PR1 keeps `JSON` scalar return — no new prismaObject, no classification needed. PR2's `triggerManagerEnrichment` mutation also returns `JSON` scalar — same deal.

### External References

External research skipped — the codebase patterns (typed-error, manager-trigger proxy direction, pLimit + allSettled, exhaustive `switch + never`) are already well-established locally. AWS SDK v3 NoSuchKey shape is documented in @aws-sdk/client-s3 types and confirmed by `error.name === "NoSuchKey"` in production logs from `feat-117` smoke. No external best-practice doc materially adds to the established repo patterns.

## Key Technical Decisions

### D1. Wrap AWS-typed errors at the storage-service boundary, not in the workflow

**Decision:** `isArtifactMissing(error: unknown): boolean` is a private helper inside `apps/admin/src/services/manager-artifacts.service.ts`. The classifier sites at lines ~80 and ~210 call the helper. Workflows continue to branch on `error instanceof ManagerArtifactError && error.code === "artifact_missing"` — they never see raw AWS error shapes.

**Rationale:** The service is the boundary that knows about S3. Moving the typed-error knowledge into workflows would couple workflows to the AWS SDK. Wrapping at the boundary preserves the existing `ManagerArtifactError` contract; `code` stays a 3-variant literal union (`"artifact_missing" | "artifact_invalid" | "artifact_read_failed"`) — no new code variant needed.

**Alternatives considered:**

- _Add a new `code: "s3_object_missing"` variant._ Rejected — `artifact_missing` is the workflow-relevant outcome regardless of why the artifact is missing (NoSuchKey vs ENOENT vs Local fallback). Multiple codes would force every workflow site to handle them all, with no behavioral difference.
- _Branch in the workflow on `error.name === "NoSuchKey"` directly._ Rejected — leaks AWS SDK knowledge into workflow code that has nothing to do with S3.

### D2. Keep the regex as a fallback, not a primary

**Decision:** `isArtifactMissing` checks AWS-typed surface FIRST (`error.name === "NoSuchKey" | "NotFound"`, `error.Code === "NoSuchKey"`), THEN falls back to a regex backstop covering local-fallback `ENOENT` and any future alt-storage backends or test fixtures. The regex tokens are tightened to `/not found|missing|no such key|does not exist|ENOENT/i` (adds `does not exist` to catch S3's textual rendering even when the typed surface fails to populate).

**Rationale:** Defense-in-depth. The AWS SDK has reworded NoSuchKey textually historically; future SDK upgrades may rework again. Typed surface is primary because it's stable across message changes; regex backstop catches non-AWS sources (local-fallback `localRead`, unit-test fixtures that return `Object.assign(new Error("..."), { code: "ENOENT" })`). The regex never over-matches into `failed`-worthy errors because the typed branch fires first for the common case.

**Alternatives considered:**

- _Drop the regex entirely._ Rejected — local-fallback `localRead` throws Node `ENOENT` errors that don't have AWS-typed shape. Regression risk if the regex is removed.
- _Match on `error instanceof NoSuchKey` (AWS SDK class)._ Rejected — requires importing `@aws-sdk/client-s3`'s class into the service, which couples the service to the SDK at type-import level, not just at runtime; also `instanceof` across SDK-version boundaries is fragile.

### D3. Derive `missingArtifacts` from outcomes, don't track it separately

**Decision:** `missingArtifacts` is computed at report-assembly time from `outcomes.filter(o => o.status === "skipped" && o.reason === "artifact_missing")`, deduped by `assetId`, sorted ascending. The dedup-and-sort logic lives in a small helper in each workflow file.

**Rationale:** No new state, no new tracking surface, no consistency-with-outcomes question. The derivation is a pure projection over the already-trustworthy outcome list. Keeps the report a single source of truth.

**Alternatives considered:**

- _Track missing assets in a per-group `Set<assetId>` during the cascade._ Rejected — duplicates state. The cascade already emits `skipped` outcomes; computing the projection at the end is cheap (O(N) over outcomes).
- _Put dedup inside the cascade itself (emit only one outcome per missing asset, NOT L outcomes)._ Rejected — breaks the `per-target outcome contract` documented in the loadedartifact-cascade doc. Operators rely on N×L outcomes for dashboards; collapsing them in the cascade would change dashboard semantics. Collapsing only in the new `missingArtifacts` field preserves the contract.

### D4. Keep the GraphQL trigger return type as `JSON` scalar (don't introduce a typed Pothos report object)

**Decision:** `triggerSceneEmbeddingBackfill` and `triggerTranscriptEmbeddingBackfill` continue to return `JSON` scalar. The new `missingArtifacts` field is just additional JSON content; downstream callers see the new field on the parsed JSON without any schema change.

**Rationale:** "Additive only" constraint is honored trivially. No new Pothos type means no `@classification` JSDoc, no leak-guard surgery, no schema-test changes. The internal TypeScript type for `BackfillReport` carries the static type, so admin-side callers (CLI, future UI) get full type safety; external GraphQL consumers see opaque JSON either way.

**Alternatives considered:**

- _Introduce a typed `BackfillReportType` Pothos object._ Rejected — bigger surface (classification JSDoc, schema.test.ts updates, every existing test that asserts return type changes), no immediate downstream consumer, no concrete benefit beyond GraphQL introspection. Future ticket if a UI needs typed introspection over the report shape.

### D5. PR1 emits a `--report-out=<path>` flag on `pnpm run-embeds` so PR2 has a stable file input

**Decision:** PR1 adds an optional `--report-out=<path>` argument to `apps/admin/src/scripts/run-embeds.ts`. When set, the final `run-embeds.complete` JSON is written to the path (parent directory created if missing). When unset, behavior is unchanged (stdout-only, current contract).

**Rationale:** PR2's `--from-report=<path>` needs a stable file format. Today the script emits JSON-lines to stdout — PR2 piping `pnpm run-embeds | jq ...` would work but is brittle. A first-class `--report-out` flag is one new line of CLI surface, cleanly separates the two concerns, and lets the operator choose where to dump the report (e.g., `.tmp/last-embed-report.json`).

**Alternatives considered:**

- _PR2 reads from stdin, operator pipes the script output._ Rejected — script's stdout has multiple JSON-lines events plus the final summary; parsing requires knowing which line is the final one. Brittle.
- _PR2 always reads from a fixed `.tmp/last-embed-report.json` path._ Rejected — couples PR2 to a magic path. `--from-report` flag with the operator choosing the path is more explicit.
- _Make `--report-out` mandatory in PR1._ Rejected — would break existing operators running `pnpm run-embeds` without the flag.

### D6. Manager `/api/admin-trigger/{scene-analysis,transcript}` accepts a list of `assetId`s with per-id results

**Decision:** Request body is `{ assetIds: number[] }`. Response is `{ results: Array<{ assetId: number, managerJobId: string | null, status: "started" | "already_in_flight" | "not_found" | "validation_failed", error?: string }> }`. HTTP 200 even on partial failure (bad assetIds among good ones). HTTP 4xx only for whole-request validation failure (empty list, malformed body).

**Rationale:** The operator's input is a list (PR1's `missingArtifacts`). One round-trip per `assetId` would be N×latency; one round-trip with a list is constant. Per-id results preserve the granular signal — operator sees which assets started, which were already in flight, which were unknown. HTTP 200 + partial-failure is the right shape because partial success is the common case (not an error condition).

**Alternatives considered:**

- _One assetId per request._ Rejected — N round-trips for N assets is wasteful given the operator usually has a list.
- _Return the first failure as HTTP 4xx._ Rejected — masks per-asset signal. Operator wants the whole report.
- _Different endpoints for `single` vs `batch`._ Rejected — list-of-one is a clean degenerate case; no need for two endpoints.

### D7. Manager-side idempotency check via `EnrichmentJob` query, not a new dedup table

**Decision:** Manager's idempotency check is a query against `EnrichmentJob` filtered by `status: "running"` and matching the requested asset (mux/asset linkage). If a matching in-flight job exists, return its `documentId` with `status: "already_in_flight"`. If none exists, create a new job and return its `documentId` with `status: "started"`.

**Rationale:** Reuses existing manager state. No new dedup table, no new schema migration, no new lifecycle to maintain. The `EnrichmentJob` Strapi content type already has the lifecycle (`createJob/updateStepStatus`); the new endpoint just gates on it.

**Alternatives considered:**

- _New `AdminTriggerDispatch` Strapi content type._ Rejected — duplicates state; `EnrichmentJob` is already the source of truth for in-flight enrichment work. New content type would require sync logic between the two.
- _In-memory dedup (Map<assetId, jobId> with TTL)._ Rejected — doesn't survive process restart; multiple manager instances behind a load balancer would dedupe inconsistently.

### D8. Manager-side new endpoint runs the pipeline directly, doesn't proxy `/api/scene-analysis`

**Decision:** `POST /api/admin-trigger/scene-analysis` calls `runSceneAnalysisPipeline(input)` directly via `next/server` `after()` (mirror existing `POST /api/scene-analysis`). The new endpoint derives `subtitleUrl` and `videoLabel` from CMS metadata internally before invoking the pipeline (admin only sends `assetId`).

**Rationale:** The existing `POST /api/scene-analysis` requires `subtitleUrl` already populated. Forwarding admin's call to it would require admin to derive `subtitleUrl` from CMS — but admin doesn't have direct CMS access for asset metadata, manager does. The cleanest split: admin sends just `assetId`; manager looks up the asset's CMS metadata and supplies the rest. Calling the pipeline directly avoids the existing endpoint's input-shape constraint.

**Alternatives considered:**

- _Forward to `/api/scene-analysis` after admin enriches the input._ Rejected — admin shouldn't have CMS access for this single use case.
- _Modify `/api/scene-analysis` to accept just `assetId` and derive the rest internally._ Tempting but expands the surface of an existing endpoint; cleaner to introduce a new one with the simpler input.

For transcript, the manager-side path is genuinely new — `apps/manager/src/services/embeddings.ts` and `apps/manager/src/services/transcription.ts` exist but no standalone transcript-only entry point. PR2 introduces `runTranscriptOnlyPipeline(input)` (or similar) in `apps/manager/src/workflows/`, called by the new endpoint.

### D9. Admin GraphQL mutation returns `JSON` scalar (consistent with existing trigger pattern)

**Decision:** `triggerManagerEnrichment` is registered with `type: "JSON"` like the existing `triggerSceneEmbeddingBackfill`. Internal type is `Promise<ManagerEnrichmentDispatchResult[]>`; resolver returns the array as a JSON value.

**Rationale:** Consistency with existing trigger mutations. Same alternatives-considered as D4.

### D10. CLI `pnpm trigger-enrichment` mirrors `pnpm run-embeds` shape

**Decision:** New file `apps/admin/src/scripts/trigger-enrichment.ts` registered as `"trigger-enrichment": "tsx src/scripts/trigger-enrichment.ts"`. Argv parsing via the existing bespoke `parseSingle/parseRepeated` helpers (extracted to a shared module if not already, otherwise copied per existing convention). Flags:

- `--asset-ids=1,2,3` (comma-separated, repeatable as `--asset-ids=1 --asset-ids=2,3`)
- `--from-report=<path>` (reads PR1's report JSON, extracts `missingArtifacts`, filters by `--kind`)
- `--kind=scene-analysis|transcript` (mandatory)
- `--admin-graphql-url=<url>` (defaults to `process.env.ADMIN_GRAPHQL_URL`)

**Rationale:** Mirroring existing scripts. Operator already knows the shape from `run-embeds`. SIGTERM cleanup with exit 130, `DATABASE_URL` not required (this script doesn't touch DB).

**Alternatives considered:**

- _Use `commander` or `yargs`._ Rejected — repo convention is bespoke parsing; introducing a parser library is scope creep.
- _Single positional argument instead of `--kind` flag._ Rejected — explicit named flag is more discoverable and matches existing `run-embeds` pattern.

### D11. Asymmetric env-var naming: caller-side single key, receiver-side CSV

**Decision:**

| App     | Role           | Env var                   | Type          |
| ------- | -------------- | ------------------------- | ------------- |
| admin   | caller (PR2)   | `MANAGER_TRIGGER_API_KEY` | single string |
| manager | receiver (PR2) | `ADMIN_TRIGGER_API_KEYS`  | CSV           |
| admin   | caller (PR2)   | `MANAGER_API_BASE_URL`    | URL           |

**Rationale:** Mirrors the existing reverse-direction asymmetry (`ADMIN_EMBED_TRIGGER_API_KEY` single on manager-caller, `WORKFLOW_API_KEYS` CSV on admin-receiver). CSV on receiver enables zero-downtime rotation: write new key alongside old, deploy both apps, then remove old. Single key on caller avoids ambiguity about which key to send.

### D12. Admin permission key + matrix-level negative test

**Decision:** Add `"write:manager-enrichment-trigger"` as a new `PermissionKey` literal-union member. Add to `WORKFLOW_TRIGGER_PERMISSIONS` ReadonlySet in `apps/admin/src/auth/permissions.ts`. Update `permissions.test.ts` exhaustive `Record<PermissionKey, boolean>` iteration so a future `PermissionKey` addition without a deliberate `WORKFLOW_TRIGGER_PERMISSIONS` decision fails to compile.

**Rationale:** Mirrors existing pattern. Negative test enforces that a future agent adding a new permission key thinks deliberately about whether it should be bearer-callable.

### D13. Decoupling proof in the PR2 description

**Decision:** PR2 description includes `git diff main...HEAD --stat` filtered to admin's `workflows/` and `BackfillOutcome` discriminant union — this should be empty. This becomes the explicit decoupling proof.

**Rationale:** The hard constraint "PR2 must NOT modify embed workflows" is easy to violate accidentally during refactoring. A diff-stat in the PR description is the cheapest verification.

## Open Questions

### Resolved During Planning

- _Should PR2 introduce a typed Pothos report object?_ No — keep `JSON` scalar (D4, D9).
- _Should we add a new `code: "s3_object_missing"` to `ManagerArtifactError`?_ No — map AWS-typed shape to existing `artifact_missing` (D1).
- _Should `missingArtifacts` be tracked separately or derived?_ Derived from outcomes (D3).
- _How does PR2 get the assetIds list?_ PR1 emits `--report-out=<path>`; PR2 reads via `--from-report=<path>`. Decoupled file format, no fragile stdout piping (D5).
- _What's the manager-side endpoint shape?_ New `route.ts` files mirroring the existing `/api/admin-embeds/` reverse direction; auth via new sibling validator and CSV env var (D6, D11).
- _Idempotency mechanism?_ Query existing `EnrichmentJob` table; no new content type (D7).
- _Transcript pipeline path?_ New `runTranscriptOnlyPipeline` in manager (no standalone transcript trigger exists today). Scope acknowledged (D8).
- _Manager-internal CMS metadata derivation?_ Manager looks up `subtitleUrl` and `videoLabel` from CMS internally — admin only sends `assetId` (D8).

### Deferred to Implementation

- Exact field name for the "kind" enum member values: `"scene-analysis" | "transcript"` (kebab-case) vs `"sceneAnalysis" | "transcript"` (camelCase). Confirm against existing `BackfillOutcome.reason` casing during implementation; bias toward camelCase if existing reasons are camelCase, kebab if they are kebab.
- Exact name of the new admin permission key (`write:manager-enrichment-trigger` vs `dispatch:manager-enrichment` vs `write:manager-enrichment`). Confirm by inspecting existing permission-key naming convention in `apps/admin/src/auth/permissions.ts` during implementation.
- Whether `runTranscriptOnlyPipeline` is best implemented as (a) a new top-level workflow file in `apps/manager/src/workflows/`, or (b) extracting the transcription leg from the existing `videoEnrichment.ts` flow. Decide during implementation based on the actual `videoEnrichment.ts` shape — if it's already split into composable steps, extract; if it's monolithic, write a parallel workflow.
- Whether to factor out `parseSingle`/`parseRepeated` from `run-embeds.ts` into a shared `apps/admin/src/scripts/_argv.ts` module, or copy per existing repo convention. Decide based on maintainer preference during implementation; copy is a safe default (matches current style).
- Exact regex tokens to remove from the fallback. Current regex includes `NoSuchKey` token which is now redundant given the typed branch. Decide whether to keep for defense-in-depth or remove for clarity. Suggest removing `NoSuchKey` and `no such key` since typed branch covers them — but verify no test fixture relies on the regex catching them.

## Implementation Units

### PR1 — `feat/embed-backfill-artifact-missing-classification` (off origin/main)

- [ ] **Unit 1: `isArtifactMissing` helper + classifier integration**

**Goal:** Replace both regex sites in `manager-artifacts.service.ts` with a shared helper that branches on AWS-typed surface first, regex fallback second.

**Requirements:** R1.1, R1.2, R1.3, R1.4

**Dependencies:** None

**Files:**

- Modify: `apps/admin/src/services/manager-artifacts.service.ts`
- Test: `apps/admin/src/services/manager-artifacts.service.test.ts`

**Approach:**

- Add private `isArtifactMissing(error: unknown): boolean` near top of `manager-artifacts.service.ts`. Type-narrow `error` via `typeof error === "object" && error !== null` then check `name`, `Code`, fall through to message-regex.
- Replace `if (/not found|missing|no such key|ENOENT|NoSuchKey/i.test(message))` at both sites with `if (isArtifactMissing(error))`.
- Tighten regex tokens: drop `no such key|NoSuchKey` (typed branch covers); add `does not exist`.

**Patterns to follow:**

- `parallel-workflow-error-robustness-20260420.md` typed-error rule.
- `pgvector-bulk-insert-on-conflict-pattern-20260505.md` mocked-vs-real discipline.

**Test scenarios:**

- Typed AWS GET miss: `Object.assign(new Error("The specified key does not exist."), { name: "NoSuchKey" })` → `artifact_missing`.
- Typed AWS HEAD miss: `Object.assign(new Error("..."), { name: "NotFound" })` → `artifact_missing`.
- Legacy code shape: `Object.assign(new Error("..."), { Code: "NoSuchKey" })` → `artifact_missing`.
- Local fallback: `Object.assign(new Error("ENOENT: ..."), { code: "ENOENT" })` → `artifact_missing` via regex.
- Unrelated: `new Error("connection reset by peer")` → `artifact_read_failed`.
- Unrelated, message contains "missing field": `new Error("missing field 'foo'")` → still `artifact_read_failed` because `isArtifactMissing` doesn't match this. (Confirms regex is tight enough.)
- Cover BOTH `readSceneAnalysisArtifact` (R1) and `readEmbeddingsArtifact` (R2) call paths.

**Verification:**

- `pnpm --filter @forge/admin vitest run src/services/manager-artifacts.service.test.ts` passes all 12+ cases (6 shapes × 2 paths).
- Existing tests continue to pass.

- [ ] **Unit 2: `missingArtifacts` projection in workflows + GraphQL response**

**Goal:** Surface deduped, sorted list of missing-artifact assetIds in the workflow report and on the GraphQL trigger response (additive only).

**Requirements:** R1.5, R1.6, R1.7, R3.2, R3.3

**Dependencies:** Unit 1

**Files:**

- Modify: `apps/admin/src/workflows/sceneEmbeddingBackfill.ts` (extend `BackfillReport`, add projection helper)
- Modify: `apps/admin/src/workflows/transcriptEmbeddingBackfill.ts` (same)
- Test: `apps/admin/src/workflows/sceneEmbeddingBackfill.test.ts`
- Test: `apps/admin/src/workflows/transcriptEmbeddingBackfill.test.ts`
- Test: `apps/admin/src/graphql/schema.test.ts` (verify leak guard still passes)

**Approach:**

- Add new `MissingArtifact` type local to each workflow file: `{ readonly assetId: number; readonly coreId: string; readonly kind: "scene-analysis" | "transcript" }` (kind literal differs per file).
- Extend `SceneEmbeddingBackfillReport` and `TranscriptEmbeddingBackfillReport` types with `readonly missingArtifacts: ReadonlyArray<MissingArtifact>`.
- Add private helper `deriveMissingArtifacts(outcomes: BackfillOutcome[]): MissingArtifact[]`:
  1. Filter outcomes to `status === "skipped" && reason === "artifact_missing"`.
  2. Map each to `{ assetId: outcome.target.cmsVideoId, coreId: outcome.target.coreId, kind: <literal> }`.
  3. Dedup by `assetId` (keep first; `Map<number, MissingArtifact>`).
  4. Sort ascending by `assetId`.
- Wire into `stepReport`: add `missingArtifacts: deriveMissingArtifacts(outcomes)` to the assembled report.
- GraphQL is automatic — `JSON` scalar passes the new field through.

**Patterns to follow:**

- `per-parent-child-memoization-loadedartifact-pattern-20260505.md` group-cascade dedup-at-projection rule.

**Test scenarios:**

- Two locales of the same `(video, edition)` group cascade as `skipped { artifact_missing }`. `report.missingArtifacts.length === 1`. The single entry's `assetId === target.cmsVideoId`, `coreId === target.coreId`, `kind === "scene-analysis"` (or `"transcript"`).
- Two distinct `(video, edition)` groups, both missing, with different cmsVideoIds. `report.missingArtifacts.length === 2`, sorted ascending by `assetId`.
- All targets succeed → `missingArtifacts: []` (NOT `undefined`).
- Mixed: 1 group missing (cascade L outcomes), 1 group succeeded → `missingArtifacts.length === 1`, only the missing entry.
- A `failed { reason: <real S3 error> }` outcome is NOT in `missingArtifacts` (only `skipped { artifact_missing }`).
- `schema.test.ts` `embed|vector|similarit` leak guard still passes (additive JSON-scalar field).

**Verification:**

- New workflow tests all pass.
- `pnpm --filter @forge/admin vitest run src/graphql/schema.test.ts` passes unchanged.
- Manual sanity: run `pnpm --filter @forge/admin typecheck` confirms `BackfillReport` types are exported correctly and consumers (CLI, tests) see the new field.

- [ ] **Unit 3: `--report-out=<path>` flag on `pnpm run-embeds`**

**Goal:** Operator can dump the final report JSON to a file, providing PR2's `--from-report` with a stable input.

**Requirements:** R1.8

**Dependencies:** Unit 2

**Files:**

- Modify: `apps/admin/src/scripts/run-embeds.ts`
- Test: `apps/admin/src/scripts/run-embeds.test.ts` (create if missing — argv-parsing happy-path tests)

**Approach:**

- Add `--report-out=<path>` to the existing argv-parser. When present:
  1. Resolve to absolute path.
  2. Ensure parent directory exists (mkdir recursive).
  3. After the final `run-embeds.complete` event, `fs.writeFile(path, JSON.stringify(report, null, 2))`.
- Stdout output unchanged (preserves existing behavior).
- Errors writing the file: log a `run-embeds.report_out_error` event but do NOT fail the script — the report is already in stdout.

**Patterns to follow:**

- Existing `parseSingle` argv pattern in `run-embeds.ts`.

**Test scenarios:**

- `--report-out=.tmp/r.json` creates the file with the full report JSON.
- File parent directory missing → script creates it.
- Invalid path (e.g., `/dev/full` ENOSPC simulation) → script logs error event, still exits successfully, stdout still emits final report.
- No flag → unchanged behavior (no file written).

**Verification:**

- New CLI test passes.
- Run locally: `pnpm --filter @forge/admin run-embeds --pipeline=scene --core-id=2_0-Crushing --report-out=.tmp/test.json`. File exists with expected shape.

- [ ] **Unit 4: Solutions doc + CLAUDE.md updates**

**Goal:** Capture the typed-error + regex-fallback pattern as a reusable doc; update `apps/admin/CLAUDE.md` R1+R2 sections.

**Requirements:** R1.9, R1.10

**Dependencies:** Unit 1

**Files:**

- Create: `docs/solutions/runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md`
- Modify: `apps/admin/CLAUDE.md`

**Approach:**

- New doc captures: problem (regex matches _message_ not _type_), solution (typed-name first, code fallback, regex backstop), tests-must-throw-real-class rule, cross-references with `parallel-workflow-error-robustness-20260420.md` and `verify-infra-writes-via-independent-read-path-20260420.md`.
- `apps/admin/CLAUDE.md` R1 and R2 sections gain a one-liner: `"Missing manager artifacts (NoSuchKey) classify as skipped { reason: artifact_missing }. The workflow report's missingArtifacts field surfaces the deduped set of upstream gaps. Re-running the embed workflow does NOT produce the artifact — operator must explicitly trigger enrichment via PR2's triggerManagerEnrichment mutation."`
- Add to "Known Patterns" section of root CLAUDE.md: `AWS S3 NoSuchKey classification: typed-error name first, Code legacy second, regex backstop — see docs/solutions/runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md.`

**Patterns to follow:**

- `parallel-workflow-error-robustness-20260420.md` doc structure.

**Test scenarios:**

- N/A (docs).

**Verification:**

- Doc reads cleanly, has problem + solution + tests + cross-references.
- CLAUDE.md updates render correctly.

### PR2 — `feat/embed-backfill-enrichment-trigger-endpoint` (stacked on PR1)

- [ ] **Unit 5: Manager-side bearer-auth validator + env var**

**Goal:** Manager validates incoming admin-trigger calls against a new CSV env var, mirroring admin's `WORKFLOW_API_KEYS` shape but on the receiver side.

**Requirements:** R2.3, R2.11

**Dependencies:** None (orthogonal to embed work)

**Files:**

- Modify: `apps/manager/src/config/env.ts` (add `ADMIN_TRIGGER_API_KEYS: z.string().min(1).optional()`)
- Create: `apps/manager/src/lib/admin-trigger-auth.ts` (new validator function)
- Modify: `apps/manager/.env.example` (document new var)
- Test: `apps/manager/src/lib/admin-trigger-auth.test.ts`

**Approach:**

- `validateAdminTriggerBearer(request: Request): Promise<{ ok: true } | { ok: false, status: 401 | 503, message: string }>`:
  - Returns `{ ok: false, status: 503, message: "config_missing" }` if `ADMIN_TRIGGER_API_KEYS` env var unset.
  - Extracts `Authorization: Bearer <key>` header. Missing → `{ ok: false, status: 401 }`.
  - CSV-parses the env var (`split(",").map(trim).filter(len > 0)`). Iterates with `Buffer.byteLength + timingSafeEqual` to find a match. None → `{ ok: false, status: 401 }`.

**Patterns to follow:**

- `apps/manager/src/lib/auth.ts::authenticateRequest` (existing single-key plain-compare via `timingSafeEqual`).
- `apps/admin/src/auth/workflow-bearer.ts::isValidWorkflowBearer` (existing CSV split-and-compare on receiver side).
- `local-embed-pipeline-pattern-20260429.md` cross-app auth invariants.

**Test scenarios:**

- No env var → 503 `config_missing`.
- Env var set, no `Authorization` header → 401.
- Env var set, header present, key matches one of CSV entries → ok.
- Env var set, header present, key matches none of CSV → 401.
- Env var set with multiple keys (rotation case), header matches the second one → ok.
- Bearer header with extra whitespace, mixed case → handled per existing `auth.ts` conventions.

**Verification:**

- New test passes.
- Existing manager auth tests untouched.

- [ ] **Unit 6: Manager `POST /api/admin-trigger/scene-analysis` endpoint**

**Goal:** Manager exposes a new endpoint that accepts a list of `assetId`s, validates the bearer, checks idempotency against `EnrichmentJob`, dispatches scene-analysis pipeline runs.

**Requirements:** R2.1, R2.4, R2.8 (partial)

**Dependencies:** Unit 5

**Files:**

- Create: `apps/manager/src/app/api/admin-trigger/scene-analysis/route.ts`
- Create: `apps/manager/src/lib/admin-trigger-route.ts` (shared helper for both endpoints — request parsing, validation, idempotency check, response shape)
- Test: `apps/manager/src/app/api/admin-trigger/scene-analysis/route.test.ts`

**Approach:**

- `route.ts` is thin: parse body, call `validateAdminTriggerBearer`, call `processAdminTriggerRequest({ kind: "scene-analysis", assetIds, dispatch: dispatchSceneAnalysisFor })`, return JSON.
- `processAdminTriggerRequest` (in `admin-trigger-route.ts`):
  1. Validate `assetIds: number[]` (non-empty, all positive integers, dedupe).
  2. For each assetId in parallel (Promise.all is fine, no shared state):
     - Look up the asset's CMS metadata to derive `subtitleUrl, muxAssetId, videoLabel, videoId` (or whatever the pipeline needs).
     - If asset not found in CMS → push `{ assetId, status: "not_found" }`.
     - Otherwise check `EnrichmentJob` table for an in-flight job matching the asset → if found, push `{ assetId, managerJobId: <doc>, status: "already_in_flight" }`.
     - If no in-flight: create a new `EnrichmentJob`, kick off `runSceneAnalysisPipeline(input)` via `next/server` `after()` (fire-and-forget), push `{ assetId, managerJobId: <new doc>, status: "started" }`.
  3. Return `{ results: [...] }`.
- Error envelope mirrors `admin-embed-route.ts` shape (200/400/401/502/503; discriminated `messages + retryable`).

**Patterns to follow:**

- `apps/manager/src/app/api/admin-embeds/scene/route.ts` route structure.
- `apps/manager/src/lib/admin-embed-route.ts` discriminated envelope shape.
- `apps/manager/src/app/api/scene-analysis/route.ts` `after()` background dispatch pattern.
- `apps/manager/src/lib/state.ts::createJob` and `listJobs` for idempotency check.

**Test scenarios:**

- Happy path: 3 valid assetIds, all not-in-flight → 3 `started` results, 3 new `EnrichmentJob` rows, pipeline kicks off.
- Idempotency: same call twice within 1s → second call returns `already_in_flight` for all, no new jobs.
- Mixed: 2 not-in-flight + 1 already-running + 1 unknown → respective statuses.
- Empty `assetIds` → 400 `validation_failed`.
- Negative or zero `assetId` → 400 `validation_failed`.
- Malformed JSON body → 400.
- Missing bearer → 401.
- Wrong bearer → 401.
- Env var unset → 503 `config_missing`.

**Verification:**

- All test cases pass.
- Manual smoke against local manager + Postgres confirms `EnrichmentJob` rows created and `runSceneAnalysisPipeline` invoked.

- [ ] **Unit 7: Manager `POST /api/admin-trigger/transcript` endpoint + transcript-only pipeline**

**Goal:** Mirror Unit 6 for transcript. Requires a new internal "transcript-only" pipeline since none exists.

**Requirements:** R2.2, R2.4

**Dependencies:** Unit 5, Unit 6 (shared `admin-trigger-route.ts`)

**Files:**

- Create: `apps/manager/src/app/api/admin-trigger/transcript/route.ts`
- Create: `apps/manager/src/workflows/transcriptOnlyPipeline.ts` (or extend an existing module — defer the structural decision to implementation time, see Open Questions)
- Test: `apps/manager/src/app/api/admin-trigger/transcript/route.test.ts`
- Test: `apps/manager/src/workflows/transcriptOnlyPipeline.test.ts`

**Approach:**

- Route file structure identical to Unit 6, dispatching to `dispatchTranscriptOnlyFor` instead.
- `runTranscriptOnlyPipeline(input)`:
  - Either a thin wrapper extracting transcript+embeddings from `videoEnrichment.ts`, OR a parallel workflow file. Decide based on `videoEnrichment.ts` shape during implementation (see deferred questions).
  - Writes `{assetId}/transcript-embeddings.json` (or whatever the existing artifact path is) via `writeArtifact`.

**Patterns to follow:**

- Unit 6.
- Existing `videoEnrichment.ts` transcript leg.

**Test scenarios:**

- Same as Unit 6, but for transcript pipeline.
- Plus: transcript-only pipeline correctly skips scene-analysis (NOT triggered).
- Plus: artifact written to expected S3 path.

**Verification:**

- Tests pass.
- Manual smoke confirms only transcript artifacts are produced.

- [ ] **Unit 8: Admin permission key + outbound HTTPS client**

**Goal:** Admin gains a new permission key for the trigger mutation; the resolver calls manager via a typed HTTPS client.

**Requirements:** R2.5, R2.6, R2.7, R2.9

**Dependencies:** None (can land alongside Unit 5 in parallel, but logically a PR2 step)

**Files:**

- Modify: `apps/admin/src/auth/permissions.ts` (add `"write:manager-enrichment-trigger"` permission key + `WORKFLOW_TRIGGER_PERMISSIONS` allowlist entry + `permissionMatrix` row)
- Modify: `apps/admin/src/auth/permissions.test.ts` (negative test for new permission via `Record<PermissionKey, boolean>` exhaustive iteration)
- Modify: `apps/admin/src/config/env.ts` (add `MANAGER_API_BASE_URL`, `MANAGER_TRIGGER_API_KEY`)
- Modify: `apps/admin/.env.example`
- Create: `apps/admin/src/services/manager-trigger.service.ts` (HTTPS client)
- Test: `apps/admin/src/services/manager-trigger.service.test.ts`

**Approach:**

- `manager-trigger.service.ts`:
  - `triggerManagerEnrichment(assetIds: number[], kind: "scene-analysis" | "transcript"): Promise<ManagerEnrichmentDispatchResult[]>`.
  - Reads `MANAGER_API_BASE_URL` and `MANAGER_TRIGGER_API_KEY`. If either missing → throw a typed `ManagerTriggerConfigError`.
  - POSTs to `<base>/api/admin-trigger/<kind>` with `Authorization: Bearer <key>`, `Content-Type: application/json`, body `{ assetIds }`.
  - `AbortSignal.timeout(15_000)`.
  - Map response to typed `ManagerEnrichmentDispatchResult[]`.
  - On HTTP non-2xx, network error, parse error → return synthetic `[{ assetId, status: "dispatch_failed", error: <typed reason> }]` per requested assetId, log `event=enrichment_triggered, status: dispatch_failed, ...`.
  - On success, log `event=enrichment_triggered` per result.

**Patterns to follow:**

- `apps/manager/src/lib/admin-embed-trigger.ts` (reverse-direction client, mirror inverted).
- `local-embed-pipeline-pattern-20260429.md` discriminated envelope + 15s timeout.

**Test scenarios:**

- Happy path: mock `fetch` returns 200 + `{ results: [...] }` → typed array returned.
- HTTP 401 → all results marked `dispatch_failed`.
- HTTP 503 → all `dispatch_failed`, log emits `config_missing`.
- Network timeout → all `dispatch_failed`, retryable=true.
- Malformed response (not JSON) → all `dispatch_failed`, parse_error.
- Missing env vars → typed config error thrown, NO HTTP call attempted.

**Verification:**

- All tests pass.
- `permissions.test.ts` matrix iteration covers new key.

- [ ] **Unit 9: Admin GraphQL `triggerManagerEnrichment` mutation**

**Goal:** Operators (and future UI callers) can trigger enrichment via a single GraphQL mutation.

**Requirements:** R2.5

**Dependencies:** Unit 8

**Files:**

- Create: `apps/admin/src/graphql/mutations/manager-enrichment.ts`
- Modify: `apps/admin/src/graphql/schema.ts` (side-effect import)
- Test: `apps/admin/src/graphql/mutations/manager-enrichment.test.ts`
- Test: `apps/admin/src/graphql/schema.test.ts` (verify leak guard, mutation appears in introspection)

**Approach:**

- Pothos `builder.mutationFields((t) => ({ triggerManagerEnrichment: t.field({ ... }) }))` with:
  - `type: "JSON"` (consistent with existing trigger mutations, D9).
  - `authScopes: { hasPermission: "write:manager-enrichment-trigger" }`.
  - `args: { assetIds: t.arg.intList({ required: true }), kind: t.arg.string({ required: true, validate: (v) => v === "scene-analysis" || v === "transcript" }) }`.
  - `resolve: async (_, { assetIds, kind }) => { return manager-trigger.service.triggerManagerEnrichment(assetIds, kind) }`.

**Patterns to follow:**

- `apps/admin/src/graphql/mutations/scene-embedding.ts` resolver shape.

**Test scenarios:**

- Authenticated bearer → mutation invokes service, returns array of results.
- Wrong/missing bearer → unauth error from existing middleware.
- Empty `assetIds` → resolver delegates to service which validates and surfaces the error via the result shape (status: "validation_failed").
- `kind` other than `"scene-analysis" | "transcript"` → GraphQL validation error.
- Schema introspection: mutation appears, leak guard passes.

**Verification:**

- All tests pass.
- `pnpm --filter @forge/admin typecheck` clean.

- [ ] **Unit 10: Admin CLI `pnpm trigger-enrichment`**

**Goal:** Operator can run `pnpm --filter @forge/admin trigger-enrichment --asset-ids=… | --from-report=…`.

**Requirements:** R2.8

**Dependencies:** Unit 9

**Files:**

- Create: `apps/admin/src/scripts/trigger-enrichment.ts`
- Modify: `apps/admin/package.json` (`scripts: { "trigger-enrichment": "tsx src/scripts/trigger-enrichment.ts" }`)
- Test: `apps/admin/src/scripts/trigger-enrichment.test.ts`

**Approach:**

- Argv parsing via `parseSingle/parseRepeated` (copy from `run-embeds.ts` per existing convention).
- Flags:
  - `--asset-ids=1,2,3` repeatable.
  - `--from-report=<path>` reads PR1's JSON, extracts `missingArtifacts`, filters by `--kind`, dedupes, takes assetIds.
  - `--kind=scene-analysis|transcript` (mandatory).
  - `--admin-graphql-url=<url>` (defaults to `process.env.ADMIN_GRAPHQL_URL`).
  - `--workflow-api-key=<key>` (defaults to `process.env.WORKFLOW_API_KEY` or first entry of `WORKFLOW_API_KEYS`).
- Mutually exclusive: `--asset-ids` and `--from-report`. If both → exit non-zero with clear error.
- Calls admin's GraphQL endpoint via fetch with bearer, parses response, prints results table + summary.
- SIGTERM cleanup: log `script.shutdown` event, exit 130.

**Patterns to follow:**

- `apps/admin/src/scripts/run-embeds.ts` argv + structured-log shape.
- `apps/admin/src/scripts/pull-mapping-from-prod.ts` env-var defaults.

**Test scenarios:**

- `--asset-ids=1,2,3 --kind=scene-analysis` → 3 assetIds dispatched, results table printed.
- `--from-report=fixture.json --kind=scene-analysis` → reads fixture, filters by kind, dispatches.
- `--from-report=fixture.json --kind=transcript` → filters to transcript-kind entries.
- Both `--asset-ids` and `--from-report` → exit non-zero.
- Neither `--asset-ids` nor `--from-report` → exit non-zero.
- Bad path for `--from-report` → exit non-zero with file-not-found error.
- `--from-report` JSON missing `missingArtifacts` field → exit non-zero with informative error.
- Network error reaching admin GraphQL → exit non-zero.

**Verification:**

- New tests pass.
- Manual smoke: `pnpm --filter @forge/admin trigger-enrichment --asset-ids=790 --kind=scene-analysis` against local admin + manager confirms job kicks off.

- [ ] **Unit 11: Solutions doc + CLAUDE.md updates + Railway deploy-ordering note**

**Goal:** Capture the inverted cross-app trigger pattern; document the deploy-ordering invariant.

**Requirements:** R2.10, R2.11

**Dependencies:** Units 5-10 (the substantive code shape needs to land first)

**Files:**

- Create: `docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md`
- Modify: `apps/admin/CLAUDE.md` (new "Triggering manager enrichment from admin" section)
- Modify: `apps/manager/CLAUDE.md` (new "Receiving admin-trigger requests" section)
- Modify: `CLAUDE.md` (root) — add Known Patterns entry

**Approach:**

- New doc captures: the operator-in-the-loop two-step flow, the inverted cross-app auth pattern (caller-single-key + receiver-CSV mirroring `WORKFLOW_API_KEYS` direction), the discriminated envelope shape, the in-flight idempotency by `EnrichmentJob` query, the transcript-only pipeline rationale.
- Deploy-ordering invariant: "Set `ADMIN_TRIGGER_API_KEYS` on manager Railway service first, `accept-deploy(envId)`, verify via curl with bad+good bearer (runtime-check, NOT readback). THEN set `MANAGER_TRIGGER_API_KEY` + `MANAGER_API_BASE_URL` on admin, `accept-deploy(envId)`. Verify by triggering a manual enrichment dispatch via GraphQL."
- Cross-link with `local-embed-pipeline-pattern-20260429.md` (sibling, reverse direction).
- `apps/admin/CLAUDE.md` and `apps/manager/CLAUDE.md` get sibling sections referencing the new doc and pinning the deploy ordering.

**Test scenarios:**

- N/A (docs).

**Verification:**

- Doc renders, cross-references resolve.
- Both CLAUDE.md files updated.

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

### Two-step operator workflow (cross-PR sequence)

```mermaid
sequenceDiagram
    actor Op as Operator
    participant Admin as apps/admin
    participant ManagerS3 as Manager S3
    participant Manager as apps/manager
    participant ManagerJob as EnrichmentJob (Strapi)

    Note over Op,Admin: Step 1: Run embed backfill (PR1 surface)
    Op->>Admin: pnpm run-embeds --core-id=… --report-out=.tmp/r.json
    Admin->>ManagerS3: GET {assetId}/scene-analysis.json
    ManagerS3-->>Admin: 404 NoSuchKey
    Admin->>Admin: classify as artifact_missing
    Admin->>Op: report.missingArtifacts: [{ assetId, coreId, kind }, …]
    Note over Admin: file written: .tmp/r.json

    Note over Op,Admin: Step 2: Operator decides which to enrich
    Op->>Op: inspect report; pick assetIds

    Note over Op,Manager: Step 3: Dispatch enrichment (PR2 surface)
    Op->>Admin: pnpm trigger-enrichment --from-report=.tmp/r.json --kind=scene-analysis
    Admin->>Admin: triggerManagerEnrichment GraphQL mutation
    Admin->>Manager: POST /api/admin-trigger/scene-analysis Bearer …
    Manager->>Manager: validateAdminTriggerBearer
    Manager->>ManagerJob: query in-flight jobs for these assetIds
    ManagerJob-->>Manager: status per asset
    Manager->>Manager: for each NOT in-flight: createJob + after(runSceneAnalysisPipeline)
    Manager-->>Admin: { results: [{ assetId, managerJobId, status }, …] }
    Admin-->>Op: results table

    Note over Manager,ManagerS3: Step 4: Manager runs pipeline on its own schedule
    Manager->>Manager: runSceneAnalysisPipeline(assetId, …)
    Manager->>ManagerS3: PUT {assetId}/scene-analysis.json
    Manager->>ManagerJob: updateJob status: complete

    Note over Op,Admin: Step 5: Operator re-runs embed
    Op->>Admin: pnpm run-embeds --core-id=… (later)
    Admin->>ManagerS3: GET {assetId}/scene-analysis.json
    ManagerS3-->>Admin: 200 + JSON
    Admin->>Admin: index, embed, write
    Admin->>Op: report.missingArtifacts now smaller
```

### PR1 — `isArtifactMissing` decision tree

```
caught error in readSceneAnalysisArtifact / readEmbeddingsArtifact
  │
  ▼
isArtifactMissing(error)?
  ├── error.name === "NoSuchKey"   ─► true  ─► throw ManagerArtifactError("artifact_missing")
  ├── error.name === "NotFound"    ─► true  ─► throw ManagerArtifactError("artifact_missing")
  ├── error.Code === "NoSuchKey"   ─► true  ─► throw ManagerArtifactError("artifact_missing")
  ├── error.Code === "NotFound"    ─► true  ─► throw ManagerArtifactError("artifact_missing")
  ├── /not found|missing|does not exist|ENOENT/i.test(message)  ─► true  ─► throw ManagerArtifactError("artifact_missing")
  └── otherwise                    ─► throw ManagerArtifactError("artifact_read_failed")
```

### PR2 — Three auth surfaces

```
       ┌──────────────────────┐
       │  operator (CLI / UI) │
       └──────────┬───────────┘
                  │ Authorization: Bearer <WORKFLOW_API_KEYS entry>
                  │ + permission "write:manager-enrichment-trigger"
                  ▼
       ┌──────────────────────────────────────────┐
       │  apps/admin: triggerManagerEnrichment    │
       │   (Pothos mutation, JSON scalar)         │
       └──────────┬───────────────────────────────┘
                  │ Authorization: Bearer ${MANAGER_TRIGGER_API_KEY}
                  │ POST ${MANAGER_API_BASE_URL}/api/admin-trigger/<kind>
                  │ AbortSignal.timeout(15_000)
                  ▼
       ┌──────────────────────────────────────────┐
       │  apps/manager: validateAdminTriggerBearer│
       │   (CSV via ADMIN_TRIGGER_API_KEYS)       │
       │   timingSafeEqual on Buffer.byteLength   │
       └──────────┬───────────────────────────────┘
                  │ valid
                  ▼
       ┌──────────────────────────────────────────┐
       │  processAdminTriggerRequest              │
       │   for each assetId:                      │
       │     • lookup CMS metadata                │
       │     • check EnrichmentJob in-flight      │
       │     • after(runPipeline) if not in-flight│
       │   return [{ assetId, jobId, status }]    │
       └──────────────────────────────────────────┘
```

## System-Wide Impact

- **Interaction graph:**
  - PR1: `manager-artifacts.service.ts` → workflows (existing edge, no shape change). New edge: workflows → `JSON` GraphQL response (additive field). New edge: `run-embeds.ts` → filesystem (`--report-out`).
  - PR2: New edges: operator → admin GraphQL → manager REST → `EnrichmentJob` Strapi → `runSceneAnalysisPipeline` / `runTranscriptOnlyPipeline` → S3.
- **Error propagation:**
  - PR1: AWS-typed errors wrap into `ManagerArtifactError("artifact_missing")` at the service boundary. Workflows continue to branch on `instanceof + code` (unchanged). The new field on the report is purely additive — error propagation path is unchanged.
  - PR2: Three failure tiers — admin GraphQL auth/validation; admin → manager HTTPS (network/timeout/parse); manager-side validation/idempotency/pipeline-dispatch. Each emits the correct status code per the discriminated envelope. Operator sees per-asset status in the response; full failure detail lives in structured logs.
- **State lifecycle risks:**
  - PR1: None new. `missingArtifacts` is a pure projection; no new persisted state.
  - PR2: New `EnrichmentJob` rows from admin-trigger dispatch. Idempotency check ensures no duplicate jobs per assetId. Concurrent admin-trigger calls for the same assetId are safe — second caller sees `already_in_flight`.
- **API surface parity:**
  - PR1: GraphQL response is additive. Internal TypeScript types updated; no other consumers.
  - PR2: New mutation, new REST endpoints, new env vars on both apps, new permission key, new CLI script. No removed/renamed surfaces.
- **Integration coverage:**
  - PR1: Unit tests + workflow tests cover the projection logic and classification branches. Local smoke against real S3 verifies the typed-AWS-error path that mocked tests can't (`pgvector-bulk-insert` lesson applied).
  - PR2: Unit tests for each new module + integration test where admin's CLI hits a local manager via the full HTTP path. Local smoke confirms end-to-end (PR1 report → CLI → admin GraphQL → manager REST → pipeline → S3 write → re-run embed succeeds).

## Risks & Dependencies

- **R-A. AWS SDK error-shape drift across SDK versions.** Mitigation: typed-name primary + Code legacy + regex backstop. Compounding doc captures the full surface so future SDK upgrades have a known reference.
- **R-B. Mocked-vs-real divergence.** Tests that throw `new Error("NoSuchKey: ...")` would pass the typed branch via the regex backstop, hiding a real-shape regression. Mitigation: explicit test scenarios that throw the _real_ shape (`Object.assign(new Error("..."), { name: "NoSuchKey" })`); local smoke against real S3 is mandatory.
- **R-C. Manager `EnrichmentJob` idempotency check is slow.** Querying Strapi GraphQL for in-flight jobs adds latency to every admin-trigger call. If P95 > 500ms, consider an in-memory cache with short TTL on the manager side. Defer to runtime measurement during local smoke.
- **R-D. Transcript-only pipeline doesn't exist today.** PR2 introduces `runTranscriptOnlyPipeline`. Risk: extracting from `videoEnrichment.ts` may surface coupling we hadn't anticipated. Mitigation: prefer parallel workflow file over extraction if the existing flow is monolithic; deferred to implementation.
- **R-E. Manager-side CMS metadata lookup latency.** `subtitleUrl, muxAssetId, videoLabel` derivation requires a CMS query per assetId. Mitigation: batch the CMS lookup (single query for all assetIds in the request) where Strapi supports it.
- **R-F. Cross-app deploy ordering.** Setting `MANAGER_TRIGGER_API_KEY` on admin before `ADMIN_TRIGGER_API_KEYS` is configured on manager → first call 401s. Mitigation: documented invariant in the new solutions doc; PR2 description includes the explicit sequence; verify-via-runtime (NOT readback) per memory.
- **R-G. `JSON` scalar return makes type drift invisible to GraphQL consumers.** Adding fields silently is the upside; removing/renaming silently is the downside. Mitigation: PR descriptions explicitly enumerate added fields; no fields are removed in this work.
- **R-H. Existing `run-embeds` CLI consumers parsing stdout.** Some operator tooling may parse the final `run-embeds.complete` line. The new `missingArtifacts` field is additive and doesn't break parsers, but flag in PR1 description for transparency.
- **R-I. Stacking PR2 on PR1 means PR2's review surface includes PR1 commits.** Mitigation: PR2 description references PR1 explicitly and notes "rebased onto main once PR1 merges." Standard stacked-PR practice in the repo.

## Pre-merge prod-readiness checklist (PR1)

- [ ] `pnpm --filter @forge/admin typecheck && lint && vitest run` clean.
- [ ] Local smoke against real S3 (`2_0-Crushing` cmsVideoId=790 + `2_0-ComingHome` cmsVideoId=789): `report.failed === 0`, `report.skipped === N` (matches missing count), `report.missingArtifacts.length === 1`, `--report-out` writes valid JSON.
- [ ] Mixed run (one missing + one present): per-coreId outcomes correct, dedup proven.
- [ ] Idempotency re-run: identical DB state, identical `missingArtifacts`.
- [ ] `apps/admin/CLAUDE.md` R1+R2 updated.
- [ ] Solutions doc lands.
- [ ] PR description includes:
  - Before/after report shape comparison.
  - `--report-out` example invocation + sample output.
  - Confirmation that no env vars or infrastructure changes are required for prod.
  - Rollback procedure: pure code revert (no env, no migration, no infra).

## Pre-merge prod-readiness checklist (PR2)

- [ ] `pnpm --filter @forge/admin typecheck && lint && vitest run` clean.
- [ ] `pnpm --filter @forge/manager typecheck && lint && vitest run` clean.
- [ ] Local smoke end-to-end: PR1's report → CLI `--from-report` → admin GraphQL → manager REST → `EnrichmentJob` row created → pipeline runs → S3 artifact written → re-run embed against same asset succeeds.
- [ ] Idempotency smoke: two CLI invocations within 1s for the same assetId → second sees `already_in_flight`, no duplicate job rows.
- [ ] Auth-failure smoke: wrong `MANAGER_TRIGGER_API_KEY` → all `dispatch_failed`, log line emitted, embed workflow unaffected.
- [ ] Manager-unreachable smoke: kill local manager mid-call → `dispatch_failed` per asset, retryable=true, embed workflow unaffected.
- [ ] CLI mutual-exclusion: `--asset-ids` + `--from-report` together → non-zero exit with clear error.
- [ ] Decoupling proof: `git diff main...HEAD --stat -- apps/admin/src/workflows apps/admin/src/services/manager-artifacts.service.ts` shows no PR2-side changes (workflows untouched).
- [ ] Both CLAUDE.md files updated.
- [ ] Solutions doc lands.
- [ ] PR description includes:
  - **Railway deploy ordering** (explicit, copy-paste runbook):
    1. Set `ADMIN_TRIGGER_API_KEYS` on **manager** Railway service via railway-MCP `updateServiceTool`. `accept-deploy(envId)`. Wait for healthcheck.
    2. Verify with `curl -X POST https://manager.jesusfilm.org/api/admin-trigger/scene-analysis -H "Authorization: Bearer <wrong>" → 401`. Then `curl ... -H "Authorization: Bearer <correct>" -d '{"assetIds":[]}' → 400 validation_failed` (proves bearer accepted).
    3. Set `MANAGER_TRIGGER_API_KEY` and `MANAGER_API_BASE_URL` on **admin** Railway service. `accept-deploy(envId)`. Wait for healthcheck.
    4. Smoke via admin GraphQL: `mutation { triggerManagerEnrichment(assetIds: [<known-asset>], kind: "scene-analysis") { ... } }` → manager job appears.
  - **Rollback procedure**:
    1. Revert PR2 commit on admin.
    2. Remove `MANAGER_TRIGGER_API_KEY` and `MANAGER_API_BASE_URL` from admin Railway. `accept-deploy(envId)`.
    3. Optionally remove `ADMIN_TRIGGER_API_KEYS` from manager Railway. `accept-deploy(envId)`.
    4. PR2's manager routes will 404 once code reverted; existing manager surfaces unaffected.
  - **Observability**: `event=enrichment_triggered` log shape, manager's existing `EnrichmentJob` lifecycle logs, plus admin's structured `event=admin-trigger.dispatch_failed` for failure auditing.
  - **Decoupling proof line**: paste the empty `git diff` confirming workflows/BackfillOutcome unchanged.

## Documentation Plan

- `docs/solutions/runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md` (PR1).
- `docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md` (PR2).
- `apps/admin/CLAUDE.md` updates (PR1 + PR2).
- `apps/manager/CLAUDE.md` updates (PR2).
- Root `CLAUDE.md` "Known Patterns" entry (PR1 + PR2).
- PR1 + PR2 + PR3 (closure) descriptions.

## Sources & References

- **Origin document:** [`docs/roadmap/content-discovery/feat-119-embed-backfill-artifact-missing-classification-and-opt-in-enrichment.md`](../../roadmap/content-discovery/feat-119-embed-backfill-artifact-missing-classification-and-opt-in-enrichment.md)
- Solutions docs (PR1):
  - `docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md`
  - `docs/solutions/best-practices/per-parent-child-memoization-loadedartifact-pattern-20260505.md`
  - `docs/solutions/best-practices/batched-provider-input-position-stable-contract-20260505.md`
  - `docs/solutions/best-practices/verify-infra-writes-via-independent-read-path-20260420.md`
  - `docs/solutions/database-issues/pgvector-bulk-insert-on-conflict-pattern-20260505.md`
- Solutions docs (PR2):
  - `docs/solutions/platform/local-embed-pipeline-pattern-20260429.md` (mirrors inverted)
  - `docs/solutions/auth/spike-auth-header-must-be-env-gated.md`
  - `docs/solutions/best-practices/throwaway-operator-harness-deletion-contract-20260430.md`
  - `docs/solutions/platform/railway-mcp-staged-config-never-commits-20260420.md`
- Code touchpoints:
  - `apps/admin/src/services/manager-artifacts.service.ts` (lines ~47–59, ~80, ~210)
  - `apps/admin/src/workflows/{sceneEmbeddingBackfill,transcriptEmbeddingBackfill}.ts`
  - `apps/admin/src/graphql/mutations/{scene-embedding,transcript-embedding}.ts`
  - `apps/admin/src/scripts/run-embeds.ts`
  - `apps/admin/src/auth/{permissions,workflow-bearer}.ts`
  - `apps/manager/src/app/api/admin-embeds/{scene,transcript}/route.ts`
  - `apps/manager/src/app/api/scene-analysis/route.ts`
  - `apps/manager/src/lib/{auth,admin-embed-route,admin-embed-trigger,state}.ts`
  - `apps/manager/src/workflows/sceneAnalysisPipeline.ts`
  - `apps/manager/src/services/{embeddings,transcription}.ts`
- Related PRs:
  - feat-115 (#882) — surfaced the misclassification.
  - feat-116 (#885) — group cascade where `missingArtifacts` derives from.
  - feat-117 (#889) — bulk SQL writes; mocked-vs-real lesson.
  - manager → admin trigger pattern PR (per `local-embed-pipeline-pattern-20260429.md`).
- Memory:
  - `feedback_railway_mcp_accept_deploy.md` — railway-MCP must end with `accept-deploy`, never `redeploy`.
  - `project_admin_migration_status.md` — admin migration playbook context.
