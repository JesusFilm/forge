---
id: "feat-119"
title: "Embed Backfill — Classify NoSuchKey + emit missingArtifacts list + decoupled enrichment trigger"
owner: "nisal"
priority: "P2"
status: "complete"
start_date: "2026-05-06"
duration: 4
depends_on: []
blocks:
  - "feat-120"
  - "feat-125"
tags:
  - "admin"
  - "manager"
  - "ai-pipeline"
  - "observability"
  - "manager-artifacts"
---

## Problem

Surfaced by the smoke run for `feat-115` (PR #882). A 10-minute scoped run produced **4,169 `scene_index_failed` outcomes vs 1,780 `scene_index_complete`** — but every single failure was the same shape:

```json
{
  "event": "scene_index_failed",
  "reason": "failed to read scene-analysis artifact for assetId=N: The specified key does not exist."
}
```

The "failures" are **not real failures** — they're upstream-data-readiness signals. Manager hasn't run scene-analysis against those `assetId`s yet. The admin embed job is correctly tolerating the gap (per-target isolation works), but it's labeling the outcome with the wrong word in the report's `succeeded / skipped / failed` triple. Two consequences:

**Operator signal degrades.** `report.failed` becomes meaningless (mostly benign data gaps); `report.skipped` becomes dishonestly always-zero. Operators learn to ignore both, then miss real failures when they happen.

### Architectural context — why the artifact is missing

R1 + R2 are downstream consumers of two **separate pipelines** in two **separate apps**. The embed job intentionally does NOT generate scene-analysis or transcript content; that work happens upstream in manager.

```
            ┌──────────────────────────────────────────────────────┐
            │  apps/manager (the enrichment side)                  │
            │  1. Mux video transcode finishes                     │
            │  2. Manager's scene-analysis pipeline runs:          │
            │       • reads frames from Mux                        │
            │       • runs multimodal vision model per scene       │
            │       • segments video into chapters/scenes          │
            │       • generates per-scene description text         │
            │  3. Manager writes `{assetId}/scene-analysis.json`   │
            │     to its S3 bucket                                 │
            └──────────────────────────────────────────────────────┘
                            │  (S3 read-only across the boundary)
                            ▼
            ┌──────────────────────────────────────────────────────┐
            │  apps/admin (the embedding / search side)            │
            │  1. R1 reads `{assetId}/scene-analysis.json`         │
            │     from manager's S3                                │
            │  2. For each scene description text:                 │
            │       • calls OpenRouter `text-embedding-3-small`    │
            │       • gets back a 1536-d vector                    │
            │  3. Writes (VideoScene, VideoSceneLocale) rows to    │
            │     admin's Postgres with the vector column          │
            └──────────────────────────────────────────────────────┘
```

The boundary is **read-only S3**. By design (per `apps/admin/CLAUDE.md` and `apps/manager/CLAUDE.md`):

- Manager owns expensive content compute (vision models, transcoding, transcript chunking).
- Admin owns the retrieval surface (Postgres + pgvector + GraphQL search).
- No cross-app workflow triggers exist today. Each side iterates independently.

So `NoSuchKey` semantically means: **"manager hasn't enriched this asset yet — there's nothing to embed."** No amount of re-running the embed job will produce the file; it only ever appears when manager's enrichment pipeline runs.

### Why the bug exists

`apps/admin/src/services/manager-artifacts.service.ts:80,210` classifies missing artifacts via **regex string-match on the error message**:

```ts
if (/not found|missing|no such key|ENOENT|NoSuchKey/i.test(message)) {
  throw new ManagerArtifactError("artifact_missing", ...)  // → skipped
}
throw new ManagerArtifactError("artifact_read_failed", ...)  // → failed
```

AWS S3's textual error message is **`"The specified key does not exist."`** That phrase doesn't match any of the regex tokens. The AWS SDK exposes the typed error via `error.name === "NoSuchKey"` (and historically `error.Code`), but the regex is matching the _message_, not the _type_. Result: every NoSuchKey falls through to the `artifact_read_failed` branch and surfaces as a `failed` outcome.

## Entry Points — Read These First

1. **`apps/admin/src/services/manager-artifacts.service.ts`** — the regex classifier on lines 80 (R1) and 210 (R2). Both branches need to use the same shared helper.
2. **`apps/admin/src/storage/s3.ts:292`** — `readManagerArtifact` is what throws the underlying AWS SDK error. The `GetObjectCommand` call at line 305 is where AWS surfaces `NoSuchKey` with `error.name === "NoSuchKey"`.
3. **`apps/admin/src/workflows/sceneEmbeddingBackfill.ts:300+`** — `stepIndexEditionLocale` already routes `ManagerArtifactError("artifact_missing")` → `skipped`. No changes needed here in Phase 1; the fix is upstream of the step.
4. **`apps/admin/CLAUDE.md`** "Scene embeddings (R1)" + "Transcript embeddings (R2)" + "Triggering embeds from manager" sections — the architectural rationale this ticket builds on. Update with the post-fix outcome shape.
5. **`apps/manager/CLAUDE.md`** — for Phase 2: the manager-side scene-analysis trigger surface (does not exist for admin → manager direction today).
6. **PR #882 smoke-run evidence** — `apps/admin/.tmp/smoke-run.log` from the 2026-05-05 run captured the 4,169 false-failed outcomes that surfaced this.

## Grep These

```
grep -rn "NoSuchKey\|artifact_missing\|artifact_read_failed" apps/admin/src/
grep -rn "ManagerArtifactError" apps/admin/src/
grep -rn "GetObjectCommand\|@aws-sdk/client-s3" apps/admin/src/
grep -rn "scene-analysis\|enrichment\|trigger.*scene-analysis" apps/manager/src/
```

## What To Build

Two PRs, **stacked on the same feature branch**, shipped sequentially. PR1 makes the embed report's signal honest and adds an actionable list of missing artifacts. PR2 introduces a **decoupled** trigger endpoint the operator calls explicitly with that list — embed and enrichment workflows stay independent. Default operator workflow is a **two-step manual flow**, not an auto-orchestrator.

```
1. Operator runs embed backfill   (PR1)
2. Operator inspects report       (PR1: missingArtifacts list)
3. Operator decides which to enrich
4. Operator calls trigger-enrich  (PR2: GraphQL mutation / CLI)
5. Manager runs its pipeline on its own schedule
6. Operator re-runs embed later   (artifacts now present → succeed)
```

The embed workflow has zero knowledge of the enrichment workflow. The trigger endpoint has zero knowledge of the embed workflow. Costs are explicit (operator sees the list, decides what to spend on).

---

### PR1 — Classify NoSuchKey + emit `missingArtifacts` list (P2, ~1 day)

**Scope:** classification fix + structured list in the workflow report. Behavior-only flip (a `failed` outcome reclassifies as `skipped`) plus an additive field on the report. No env vars, no infra changes, no admin↔manager dispatch.

**Implementation:**

1. Extract a single shared helper in `apps/admin/src/services/manager-artifacts.service.ts`:

   ```ts
   function isArtifactMissing(error: unknown): boolean {
     // Prefer AWS SDK's typed-error surface — survives any wording
     // change in S3's textual `message`. AWS SDK v3 throws errors
     // with `name === "NoSuchKey"` or `name === "NotFound"` (HEAD vs
     // GET semantics), and historically `Code === "NoSuchKey"`.
     if (typeof error === "object" && error !== null) {
       const name = (error as { name?: unknown }).name
       if (name === "NoSuchKey" || name === "NotFound") return true
       const code = (error as { Code?: unknown }).Code
       if (code === "NoSuchKey" || code === "NotFound") return true
     }
     // Fallback for non-AWS error sources (local-fallback `localRead`
     // path's ENOENT, future alt-storage backends, test fixtures).
     // Adds "does not exist" to catch S3's textual rendering too in
     // case the typed surface changes.
     const message = error instanceof Error ? error.message : String(error)
     return /not found|missing|no such key|does not exist|ENOENT/i.test(message)
   }
   ```

2. Replace both inline regex checks at the existing classifier sites (R1 + R2 paths in `manager-artifacts.service.ts`) with `if (isArtifactMissing(error)) { ... }`.

3. **Add a `missingArtifacts` field to the workflow report** in both `apps/admin/src/workflows/sceneEmbeddingBackfill.ts` and `apps/admin/src/workflows/transcriptEmbeddingBackfill.ts`:

   ```ts
   type MissingArtifact = {
     readonly assetId: number
     readonly coreId: string
     readonly kind: "scene-analysis" | "transcript"
   }

   type BackfillReport = {
     readonly succeeded: number
     readonly skipped: number
     readonly failed: number
     readonly outcomes: ReadonlyArray<BackfillOutcome>
     readonly missingArtifacts: ReadonlyArray<MissingArtifact>
   }
   ```

   - Derived from the `skipped { reason: "artifact_missing" }` outcomes only (NOT from `failed` outcomes; the report must remain trustworthy).
   - **Deduped by `assetId`** — R1's group-level cascade emits L outcomes per missing `(video, edition)` for L locales; the operator wants the unique set of upstream gaps, not L copies.
   - **Stable ordering**: sort by `assetId` ascending so operator output and CLI piping (PR2's `--from-report`) are deterministic.
   - `kind` is a literal, set per workflow (`"scene-analysis"` for R1, `"transcript"` for R2). Keep the type narrow so PR2's trigger endpoint can match on it without re-deriving.

4. **Surface `missingArtifacts` in the GraphQL trigger response** for both `triggerSceneEmbeddingBackfill` and `triggerTranscriptEmbeddingBackfill`. The new field is additive: the existing `succeeded / skipped / failed / outcomes` fields stay byte-identical. `schema.test.ts` `embed|vector|similarit` leak guard stays green — `missingArtifacts` exposes only `{ assetId, coreId, kind }`.

5. **Tests in `manager-artifacts.service.test.ts`** (classifier):
   - **Typed AWS-shape error** — `Object.assign(new Error("The specified key does not exist."), { name: "NoSuchKey" })` → `artifact_missing`.
   - **Code-shape error** — `{ Code: "NoSuchKey" }` legacy AWS shape → `artifact_missing`.
   - **HEAD shape** — `{ name: "NotFound" }` → `artifact_missing`.
   - **Local ENOENT** — `Object.assign(new Error("ENOENT: file not found"), { code: "ENOENT" })` → `artifact_missing` via regex fallback.
   - **Unrelated** — `new Error("connection reset")` → `artifact_read_failed`. Asserts the regex no longer over-matches.
   - **R2 path** — same coverage on the `readEmbeddingsArtifact` branch.

6. **Tests in workflow files** (sceneEmbeddingBackfill.test.ts + transcriptEmbeddingBackfill.test.ts):
   - Two locales of the same `(video, edition)` cascade as `skipped { artifact_missing }`; `report.missingArtifacts` has length 1, not 2 — dedup by `assetId` proven.
   - Two distinct `(video, edition)` groups missing → `report.missingArtifacts` has length 2, sorted by `assetId` ascending.
   - A workflow with zero missing artifacts emits `missingArtifacts: []` (NOT `undefined`).
   - `failed { reason: <real error> }` outcomes do NOT appear in `missingArtifacts` — only the `skipped { reason: "artifact_missing" }` outcomes do.

7. **Solutions doc**: `docs/solutions/runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md`. Captures:
   - Why string-matching error messages is fragile (AWS reworded NoSuchKey textually historically; future SDK upgrades may rework again).
   - The typed-error + regex-fallback shape (`error.name === "NoSuchKey" | "NotFound"`, then `error.Code` for legacy, then regex backstop for non-AWS sources).
   - Reusable for any future S3-reading service in the repo.
   - Cross-link bidirectionally with `parallel-workflow-error-robustness-20260420.md` (the typed-error rule this extends to a new error surface).

8. `apps/admin/CLAUDE.md` updates — R1 and R2 sections gain a one-liner: "Missing manager artifacts (NoSuchKey) classify as `skipped` with `reason: artifact_missing`. The workflow report's `missingArtifacts` field surfaces the deduped set of upstream gaps. Re-running the embed workflow does NOT produce the artifact — operator must explicitly trigger enrichment via PR2's `triggerManagerEnrichment` mutation."

**Local smoke (PR1):**

- `pnpm --filter @forge/admin typecheck && lint && vitest run` ✓
- `pnpm --filter @forge/admin pull:mapping` to refresh the core-id snapshot.
- `pnpm run-embeds` against local Postgres + manager's S3 (read-only) targeting `2_0-Crushing` (`cmsVideoId=790`, confirmed-missing per feat-117 smoke). Pre-fix baseline was 12 R2 targets `failed`. Post-fix expectation: 12 `skipped { reason: "artifact_missing" }`, `report.failed → 0`, `report.missingArtifacts.length === 1` (single dedup'd entry for assetId=790).
- Same run against a coreId where scene-analysis.json DOES exist (e.g., `2_0-ComingHome` per feat-116 smoke) — confirms success path is unchanged.
- Mixed run: both coreIds in one invocation. Confirm `missingArtifacts` contains only the missing-asset entry, ordered by `assetId`.
- Idempotency: re-run the same backfill. Identical DB state, identical `missingArtifacts` (modulo any post-PR2 enrichment).

**Constraints (PR1):**

- The `triggerSceneEmbeddingBackfill` / `triggerTranscriptEmbeddingBackfill` GraphQL response shape is **additive only** — existing fields stay byte-identical. Adding `missingArtifacts` MUST NOT remove or rename any existing field.
- The `BackfillOutcome` discriminated union is unchanged — no new variants. Only the _assignment logic_ changes (NoSuchKey → `skipped` instead of `failed`).
- The exhaustive `switch + never` reducer in `processOutcomes` stays unchanged.
- Idempotency contract preserved.
- Vector / embedding leak guard (`schema.test.ts`) stays green.

---

### PR2 — Decoupled enrichment-trigger endpoint (P2, ~1.5 days, **stacked on PR1**)

**Scope:** new admin → manager outbound HTTPS surface. Operator (or future caller) supplies a list of `assetId`s and a `kind`; the endpoint dispatches enrichment jobs in manager. **Completely independent** of the embed workflows — no new code paths in `sceneEmbeddingBackfill.ts` or `transcriptEmbeddingBackfill.ts`. The link between the two is the operator: they read PR1's `missingArtifacts` and decide which assets to enrich.

**Architectural note:** This is the first admin → manager outbound dispatch in the repo. Until now the boundary has been intentionally read-only-S3. The new seam is deliberate but narrow — manager owns scheduling, queueing, idempotency, and cost; admin's role is "request enrichment for these asset IDs," nothing more. If manager is unreachable, admin's `triggerManagerEnrichment` returns a typed error per assetId; the embed workflow remains entirely unaffected.

**Implementation:**

1. **Manager — new REST endpoints** (likely under `apps/manager/src/api/admin-trigger/`):
   - `POST /api/admin-trigger/scene-analysis` — request body `{ assetIds: number[] }`. Returns `{ results: Array<{ assetId: number, managerJobId: string, status: "started" | "already_in_flight" | "not_found" }> }`.
   - `POST /api/admin-trigger/transcript` — same shape.
   - **Auth**: bearer header `Authorization: Bearer <key>`. Key matched against a new manager keyring entry (mirrors the `WORKFLOW_API_KEYS` pattern admin already uses in reverse).
   - **Idempotency**: manager checks its own job table — if an in-flight scene-analysis (or transcript) job already exists for `assetId`, return that job's ID with `status: "already_in_flight"` instead of starting a new one. Prevents duplicate vision-model compute when two operators (or a retry) trigger the same assetId.
   - **Validation**: `assetIds` must be non-empty array of positive integers; reject with HTTP 400 otherwise. Unknown assetId (no `Asset` row in manager's DB) → `status: "not_found"` per-id (NOT a 4xx for the whole request — partial success is normal).

2. **Admin — new GraphQL mutation** in the trigger-mutations module:

   ```graphql
   enum ManagerEnrichmentKind {
     SCENE_ANALYSIS
     TRANSCRIPT
   }

   type ManagerEnrichmentDispatchResult {
     assetId: Int!
     managerJobId: String
     status: ManagerEnrichmentDispatchStatus!
   }

   enum ManagerEnrichmentDispatchStatus {
     STARTED
     ALREADY_IN_FLIGHT
     NOT_FOUND
     DISPATCH_FAILED
   }

   type Mutation {
     triggerManagerEnrichment(
       assetIds: [Int!]!
       kind: ManagerEnrichmentKind!
     ): [ManagerEnrichmentDispatchResult!]!
   }
   ```

   - Validates input (non-empty list, positive integers, dedup).
   - Calls the matching manager REST endpoint with bearer auth.
   - Maps the manager response to the GraphQL result shape. On HTTP failure / network error / auth failure: returns one synthetic result per requested `assetId` with `status: DISPATCH_FAILED` and the same `assetId` echoed back; per-id error reasons go to the structured log, NOT the GraphQL response (operator already knows what they asked for).
   - Auth on the admin side reuses the existing GraphQL trigger-key middleware (`WORKFLOW_API_KEYS`). Operator-as-caller posture identical to other trigger mutations.

3. **Admin — new CLI** `apps/admin/scripts/trigger-enrichment.ts` (or wherever `pnpm run-embeds` lives — mirror that shape):
   - `pnpm trigger-enrichment --asset-ids=1,2,3 --kind=scene-analysis`
   - `pnpm trigger-enrichment --from-report=.tmp/last-embed-report.json --kind=scene-analysis` — reads the JSON report from a previous embed run, extracts `missingArtifacts` filtered by `kind`, dedups, fires the trigger. This is the operator's ergonomic path for the two-step flow.
   - Prints results in a tabular format (assetId | managerJobId | status) plus a one-line summary (`X started, Y already in-flight, Z dispatch failed, W not found`).

4. **New env var on admin**: `MANAGER_TRIGGER_API_KEY`. Set on Railway's `forge-admin` service. Matching keyring entry on `forge-manager`. **Deploy ordering matters** — manager's keyring entry MUST land before admin's env var is set, or admin's first call will 401. Document this explicitly in the PR description.

5. **Structured log per dispatch** (admin side): one JSON line per request with `event=enrichment_triggered, assetId, kind, managerJobId, status, durationMs`. Operator audits cost via this.

6. **Solutions doc**: `docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md`. Captures:
   - The decoupled, operator-in-the-loop, two-step flow as a deliberate choice over an auto-orchestrator (cost / blast-radius / scheduling-ownership rationale).
   - The admin → manager auth + idempotency-by-in-flight-job pattern, reusable for any future cross-app dispatch.
   - The Railway deploy-ordering gotcha (manager keyring before admin env var).
   - Cross-link with `local-embed-pipeline-pattern-20260429.md` (the reverse-direction manager → admin proxy this mirrors).

7. `apps/admin/CLAUDE.md` and `apps/manager/CLAUDE.md` both updated:
   - Document the new bidirectional surface (manager → admin trigger proxies for embed; admin → manager trigger proxy for enrichment).
   - Document the operator's two-step workflow.
   - Pin the deploy-ordering invariant.

**Local smoke (PR2):**

- Local manager + local admin running side-by-side. Local `MANAGER_TRIGGER_API_KEY` set in `apps/admin/.env`; matching keyring entry in manager's local config.
- **Happy path** — call `triggerManagerEnrichment(assetIds: [790], kind: SCENE_ANALYSIS)`. Manager job kicks off (verify in manager's job table). `{assetId, managerJobId, status: STARTED}`. Wait for the local vision-model run to complete and for `{790}/scene-analysis.json` to appear in S3. Re-run PR1's embed backfill against `2_0-Crushing` — previously-skipped asset now succeeds.
- **Idempotency** — call `triggerManagerEnrichment(assetIds: [790], kind: SCENE_ANALYSIS)` twice within 1s. Second call returns `status: ALREADY_IN_FLIGHT` with the first call's `managerJobId`. No duplicate vision-model run.
- **Auth failure** — wrong `MANAGER_TRIGGER_API_KEY` → admin returns one `DISPATCH_FAILED` per asset, structured log line includes the 401. Workflow unaffected (it never knows).
- **Manager unreachable** — kill local manager mid-call → admin returns `DISPATCH_FAILED` per asset with a typed `ManagerUnreachableError` in the log.
- **Bad input** — empty `assetIds` → GraphQL validation error (NOT a manager call). Negative or zero `assetId` → validation error. Mixed valid + nonexistent assetIds → per-id results (`STARTED`, `NOT_FOUND`).
- **CLI happy path** — pipe a real PR1 `missingArtifacts` JSON: `pnpm trigger-enrichment --from-report=.tmp/last-embed-report.json --kind=scene-analysis`. Output table + summary line correct.
- **Decoupling proof** — confirm zero changes to `sceneEmbeddingBackfill.ts` or `transcriptEmbeddingBackfill.ts`. Diff scoped to `apps/manager/src/api/admin-trigger/` + `apps/admin/src/graphql/manager-trigger.*` (or wherever the trigger mutations live) + `apps/admin/scripts/trigger-enrichment.ts` + env-var wiring + tests + docs.

**Constraints (PR2):**

- **No coupling to embed workflows.** The enrichment-trigger endpoint MUST NOT be called from inside `sceneEmbeddingBackfill.ts` or `transcriptEmbeddingBackfill.ts`. The two stay independent. Operator is the only orchestrator.
- **No silent dispatch.** Every call emits a structured log line.
- **Idempotency contract preserved.** Two calls for the same assetId in flight produce one manager job, not two.
- **Manager is the scheduler.** Admin does not poll, does not wait for completion, does not retry — fire and forget. Operator re-runs the embed workflow when ready (or whenever).
- **Default behavior of existing surfaces is unchanged.** No new flags on `triggerSceneEmbeddingBackfill` / `triggerTranscriptEmbeddingBackfill`. No `autoEnrichOnMissing` knob, no polling, no `pLimit`-slot decisions, no new outcome variants on `BackfillOutcome`.
- **Vector / embedding leak guard stays green.** `triggerManagerEnrichment` exposes only `{ assetId, managerJobId, status }`.
- **Manager-side bearer-auth shape mirrors `WORKFLOW_API_KEYS`** — same hashing, same keyring loading pattern, same env-var convention. No reinvention.

---

### Sequencing

- **PR1** branches off `origin/main` (`feat/embed-backfill-artifact-missing-classification`). Lands first.
- **PR2** stacks on PR1 (`feat/embed-backfill-enrichment-trigger-endpoint`, branched off PR1's branch). Lands after PR1 merges, rebased onto main.
- **PR3 (closure)**: branches off `main` post-merge, flips feat-119 to `complete`, updates `docs/roadmap/README.md`.
- All three PRs are local-only smoke for now (no prod core-sync exists yet to run the full embed corpus against). PR descriptions include explicit pre-merge prod-readiness checklists so the eventual prod rollout is mechanical.

## Constraints

(Per-PR constraints live with their PR sections above. Cross-cutting invariants for the whole feature:)

- **Embed workflows and enrichment trigger stay decoupled.** No code path inside `sceneEmbeddingBackfill.ts` or `transcriptEmbeddingBackfill.ts` calls `triggerManagerEnrichment`. The operator is the orchestrator.
- **GraphQL response shapes are additive only.** No removed or renamed fields on existing `triggerSceneEmbeddingBackfill` / `triggerTranscriptEmbeddingBackfill` responses.
- **Vision-model invariants preserved.** Manager's existing scene-analysis pipeline remains the single source of vision-model output; admin neither runs vision models nor caches their output.
- **Embedding-model invariants preserved.** Admin still re-embeds via OpenRouter `text-embedding-3-small` (1536d). Vectors are never copied from manager.
- **`schema.test.ts` `embed|vector|similarit` leak guard stays green.** New fields (`missingArtifacts`, `triggerManagerEnrichment` types) expose only structural identifiers, never vector / embedding data.
- **No silent dispatch.** Every `triggerManagerEnrichment` call emits a structured log per dispatched assetId.
- **Idempotency.** Two calls for the same `(assetId, kind)` in flight produce one manager job, not two.

## Verification

### Completion evidence

Verified 2026-05-19 during the Compound Engineering work loop. The
implementation already landed on `main` in the expected stacked PRs:

- PR #892 / `87d2b985` — `feat(admin): classify NoSuchKey as artifact_missing + emit missingArtifacts list (feat-119 PR1)`.
- PR #893 / `e56aceac` — `feat(admin): decoupled enrichment-trigger endpoint + GraphQL mutation + CLI (feat-119 PR2)`.

Focused validation on the current checkout:

- `pnpm --filter @forge/admin test -- manager-artifacts.service.test.ts sceneEmbeddingBackfill.test.ts transcriptEmbeddingBackfill.test.ts graphql/mutations/manager-enrichment.test.ts graphql/mutations/scene-embedding.test.ts graphql/mutations/transcript-embedding.test.ts services/manager-trigger.service.test.ts` — 7 files / 137 tests passed.
- `pnpm --filter @forge/manager test -- admin-trigger-auth.test.ts admin-trigger-route.test.ts app/api/admin-trigger/scene-analysis/route.test.ts app/api/admin-trigger/transcript/route.test.ts` — 4 files / 42 tests passed.

### PR1

- `pnpm --filter @forge/admin typecheck && lint && vitest run` ✓
- Unit tests in `manager-artifacts.service.test.ts` cover all five error shapes (typed `NoSuchKey`, typed `NotFound`, legacy `Code`, local `ENOENT`, unrelated generic). All classify correctly.
- Workflow tests prove `missingArtifacts` is deduped by `assetId`, sorted ascending, and excludes `failed` outcomes.
- Local smoke against `2_0-Crushing` (cmsVideoId=790): pre-fix 12 R2 `failed` → post-fix 12 `skipped { artifact_missing }`, `report.failed === 0`, `report.missingArtifacts.length === 1`.
- Idempotency: re-run produces identical DB state and identical `missingArtifacts`.
- Solutions doc `docs/solutions/runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md` lands alongside the PR.
- `apps/admin/CLAUDE.md` R1 + R2 sections updated.

### PR2

- `pnpm --filter @forge/manager typecheck && lint && vitest run` ✓
- `pnpm --filter @forge/admin typecheck && lint && vitest run` ✓
- Manager endpoint tests: bearer-auth (valid / missing / wrong key), idempotency-by-in-flight-job, validation rejection (empty list, negative IDs), per-id `not_found` for unknown assetIds.
- Admin GraphQL tests: input validation, manager-reachable happy path, manager-401 → all `DISPATCH_FAILED`, manager-unreachable → all `DISPATCH_FAILED` with typed log line.
- Local smoke end-to-end: PR1's `missingArtifacts` JSON → `triggerManagerEnrichment` → manager job table populated → vision-model completes locally → S3 artifact appears → PR1's embed backfill re-run on the same asset now `succeeded`.
- CLI smoke: `--asset-ids` direct path AND `--from-report` JSON-piped path both produce correct results table + summary line.
- Decoupling proof: `git diff main...HEAD` for PR2 shows zero changes to `sceneEmbeddingBackfill.ts`, `transcriptEmbeddingBackfill.ts`, `BackfillOutcome` discriminant union.
- Solutions doc `docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md` lands alongside the PR.
- `apps/admin/CLAUDE.md` and `apps/manager/CLAUDE.md` both updated with the new bidirectional trigger surface and deploy-ordering invariant.
- PR description includes explicit Railway deploy-ordering checklist (manager keyring entry → admin env var) and rollback procedure.

## Future Considerations

- **Scheduled auto-enrich-gaps job.** With PR2's trigger endpoint as a primitive, a future ticket could add a cron-style job that reads recent embed reports and fires `triggerManagerEnrichment` against accumulated gaps during low-traffic windows. Stays decoupled from the embed workflow itself.
- **Manager-side per-day quota for admin-triggered enrichments.** A future ticket might cap the daily admin-triggered vision-model spend so a runaway operator-driven bulk run doesn't blow through budget.
- **Direct embedding reuse from cms during R8 cutover.** During the cms → admin migration, there may be a window where embedding artifacts already exist in cms's storage. A separate ticket could explore reading cms's embeddings directly during R8 cutover instead of regenerating them. Out of scope here.
- **`triggerManagerEnrichment` accessibility from admin UI.** Today it's a GraphQL mutation + CLI. A future ticket could add a small admin-UI button "enrich missing artifacts from this report" wired to PR2's mutation. No backend changes required.
