---
id: "feat-119"
title: "Embed Backfill — Classify NoSuchKey as artifact_missing + opt-in enrichment-on-demand"
owner: "nisal"
priority: "P2"
status: "not-started"
start_date: "2026-05-06"
duration: 4
depends_on: []
blocks:
  - "feat-118"
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

1. **Operator signal degrades.** `report.failed` becomes meaningless (mostly benign data gaps); `report.skipped` becomes dishonestly always-zero. Operators learn to ignore both, then miss real failures when they happen.
2. **Stage 4 (`feat-118`) breaks immediately.** Its new `skipped_unchanged` outcome rolls into the `skipped` bucket. With today's classifier, a re-run of a corpus with mostly-missing artifacts reports `0 skipped` instead of `~70k skipped`. The whole point of `feat-118` (cheap, observable re-runs) is undermined.

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

### Phase 1 — Classify NoSuchKey correctly (P2, ~1 day)

**Scope:** small, focused fix. Ship as a standalone PR (or bundled with `feat-115` if convenient). No new dependencies, no API surface changes.

**Implementation:**

1. Extract a single shared helper in `manager-artifacts.service.ts`:

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

2. Replace both inline regex checks (lines 80, 210) with `if (isArtifactMissing(error)) { ... }`.

3. Tests in `manager-artifacts.service.test.ts`:
   - **Typed AWS-shape error** — throw `Object.assign(new Error("The specified key does not exist."), { name: "NoSuchKey" })`. Assert classifier returns `artifact_missing` (NOT `artifact_read_failed`).
   - **Code-shape error** — `{ Code: "NoSuchKey" }` legacy AWS SDK shape. Assert same.
   - **Local ENOENT** — `Object.assign(new Error("ENOENT: file not found"), { code: "ENOENT" })`. Assert same (regex-fallback path).
   - **Generic unrelated error** — `new Error("connection reset")`. Assert classifier returns `artifact_read_failed` (NOT misclassified).
   - **R2 path** — same coverage on the `readEmbeddingsArtifact` branch.

4. New solutions doc: `docs/solutions/runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md`. Captures:
   - Why string-matching error messages is fragile (AWS reworded NoSuchKey textually at least once historically; future SDK upgrades may rework again).
   - The typed-error fallback pattern (`error.name === "NoSuchKey"` then regex backstop).
   - Cross-references: the manager-artifacts service, the workflow per-target outcome contract.
   - Reusable for any future S3-reading service in the repo (web/asset uploads, mobile/asset downloads, etc.).

5. `apps/admin/CLAUDE.md` updates — R1 and R2 sections gain a one-liner: "Missing manager artifacts (NoSuchKey) classify as `skipped` with `reason: artifact_missing`, not `failed`. Re-running the workflow does not produce the artifact; that requires manager-side enrichment."

**Verification:**

- `pnpm --filter @forge/admin typecheck && lint && vitest run` ✓
- Re-run the `feat-115` smoke run: the same 4,169-ish "failures" should now show as `skipped` with `reason: artifact_missing`, and `report.failed` should drop to a near-zero count reflecting only genuine errors.

### Phase 2 — Opt-in enrichment-on-demand (proposed; defer if scope grows)

**Scope:** larger architectural addition. Adds a NEW admin → manager trigger direction so an operator can say "enrich missing artifacts as you find them, then embed." Requires manager-side API additions; depends on Phase 1's classification correctness.

**Default stays unchanged.** This is an OPT-IN flag the operator must explicitly set. The default behavior remains "skip on missing artifact, do not trigger upstream work."

**Why this is opt-in, not automatic:**

| Concern                             | Why opt-in matters                                                                                                                                                                                                                                                         |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cost / blast radius**             | OpenRouter embedding for a scene description is ~50 ms and pennies. Manager's scene-analysis is _minutes per video_ + vision-model compute cost. A cheap parallel-fan-out embed job auto-triggering hundreds of enrichments as a side effect is an unbounded cost surface. |
| **Architectural seam**              | Today admin → manager has zero outbound dispatch. Adding it is a deliberate coupling that didn't exist; if manager goes down, admin's backfill becomes flaky too.                                                                                                          |
| **Manager owns its own scheduling** | Manager has its own prioritization, queueing, and budget for what to enrich. The embed job shouldn't unilaterally decide that.                                                                                                                                             |

**Trigger surface (admin → manager):**

- New optional GraphQL mutation argument: `triggerSceneEmbeddingBackfill(input, autoEnrichOnMissing: Boolean = false)` and the same on `triggerTranscriptEmbeddingBackfill`.
- New optional CLI flag: `pnpm run-embeds --auto-enrich-on-missing`.
- When `true`, the workflow's per-target step:
  1. Reads the artifact. If `NoSuchKey`, instead of returning `skipped`, dispatches a manager-side scene-analysis (R1) or transcript-embedding (R2) job for that `assetId`.
  2. Polls for the artifact's appearance (or manager's job status if a status endpoint exists).
  3. On appearance → re-reads → continues to embedding step → returns `succeeded` with new field `triggeredEnrichment: true`.
  4. On timeout / enrichment-failure → returns `failed` with new typed reason `enrichment_failed` or `enrichment_timed_out`.

**Manager-side work (likely the bigger half of Phase 2):**

- Confirm whether manager exposes a per-assetId scene-analysis trigger today. If not, add one — likely a thin REST endpoint `POST /api/admin-trigger/scene-analysis` mirroring the existing manager-trigger proxy pattern in reverse.
- Auth shape: same bearer-key model that already protects admin's GraphQL trigger surface (`WORKFLOW_API_KEYS`). New env var on `forge-admin`: `MANAGER_TRIGGER_API_KEY` matching an entry in manager's keyring.
- Idempotency: manager-side check "is there already an in-flight scene-analysis job for this assetId? if so, return its job-id and let admin watch it instead of starting a new one." Avoids duplicate compute when admin retries or two operators trigger simultaneously.

**Concurrency interaction with `pLimit(N)`:**

The wait inside the per-target callback would hold the `pLimit` slot for the entire enrichment duration (minutes). With concurrency=5, five long enrichments stall the entire batch behind them. Two viable shapes:

- **(a) Hold the slot.** Simplest. Acceptable when operator uses `--auto-enrich-on-missing` against a small scoped set (e.g., specific `--core-id` flags); not acceptable for a full corpus run.
- **(b) Release the slot during wait.** Limit is held only for "synchronous" work (S3 read, OpenRouter call, DB write); during enrichment-wait the slot frees so other targets progress. Requires a separate in-flight enrichment-bookkeeping table (so a target waiting on enrichment isn't double-embedded by a sibling target watching the same `assetId`). More code, more correct behavior.

Recommendation: ship (a) first as the minimum viable opt-in. Document that `--auto-enrich-on-missing` is intended for scoped runs, not the full corpus. (b) lands as a follow-up if the pattern proves valuable.

**Outcome shape additions:**

```ts
type BackfillOutcome =
  | { status: "succeeded"; ...; triggeredEnrichment?: true; enrichmentDurationMs?: number }
  | { status: "skipped"; reason: "artifact_missing" | ... }    // unchanged
  | {
      status: "failed";
      reason: "enrichment_failed" | "enrichment_timed_out" | ...; // new variants
      ...
    }
```

`schema.test.ts` GraphQL leak guard stays green — no new fields exposing vectors / embeddings.

**Sequencing within feat-119:**

- Phase 1 lands first as a small standalone PR. Verifies the smoke-run signal becomes useful.
- Phase 2 is design-grade until the team decides the cost-benefit is worth the architectural seam crossing. If the team proceeds, **split Phase 2 off as a separate ticket (`feat-120` or similar)** — it's genuinely a different size and risk profile from Phase 1.

## Constraints

- **Phase 1 must NOT change the GraphQL surface.** The `triggerSceneEmbeddingBackfill` / `triggerTranscriptEmbeddingBackfill` JSON shape stays byte-identical. The only observable change is `outcome.status` flipping from `"failed"` → `"skipped"` for the missing-artifact case.
- **Phase 2 default stays opt-out.** Adding `autoEnrichOnMissing: false` as the default preserves the existing contract; only an explicit `true` triggers the new behavior.
- **Idempotency contract preserved.** Re-running with the same `coreIds` / `locales` filters must produce identical DB state regardless of `autoEnrichOnMissing`. The flag affects whether enrichment is _attempted_, not the deduplication of writes.
- **No silent admin → manager dispatch.** Phase 2's `autoEnrichOnMissing: true` must emit a structured log per dispatch (`event=enrichment_triggered`, `assetId`, `managerJobId`) so operators can audit the cost.
- **Vision model invariants preserved.** Manager's existing scene-analysis pipeline is the single source of vision-model output; admin doesn't second-guess scene boundaries or descriptions.
- **Embedding model invariants preserved.** Admin still re-embeds via OpenRouter `text-embedding-3-small` (1536d). Vectors are NEVER copied from manager for R1.
- **`schema.test.ts` `embed|vector|similarit` leak guard stays green.** New GraphQL fields (`triggeredEnrichment`, `enrichmentDurationMs`, new failure reasons) must not leak any vector / embedding surface.

## Verification

### Phase 1

- `pnpm --filter @forge/admin typecheck && lint && vitest run` ✓
- New unit tests in `manager-artifacts.service.test.ts` cover the four error shapes (typed `NoSuchKey`, legacy `Code`, local `ENOENT`, unrelated generic). All four classify correctly.
- Re-run the `feat-115` smoke (the one PR #882 captured): expect `report.failed` to drop by ~95%+ as the missing-artifact targets reclassify to `skipped`, and `report.skipped` to grow correspondingly.
- Solutions doc `docs/solutions/runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md` lands alongside the PR.
- `apps/admin/CLAUDE.md` R1 + R2 subsections updated with the post-fix outcome shape.

### Phase 2 (if pursued)

- New e2e test (or operator-driven smoke) that triggers a scoped backfill with `autoEnrichOnMissing: true` against ~3 known-missing `assetId`s, observes manager's enrichment kick off, observes the embed job complete with `triggeredEnrichment: true` outcomes.
- Failure-mode test: simulated manager dispatch failure → workflow returns `failed { reason: "enrichment_failed" }`, sibling targets unaffected.
- Timeout test: enrichment that exceeds the configured per-target timeout → `failed { reason: "enrichment_timed_out" }`.
- Cost-audit log review: `event=enrichment_triggered` JSON line per dispatched enrichment, with `assetId` and `managerJobId`.
- Solutions doc `docs/solutions/platform/admin-manager-enrichment-on-demand-pattern-<date>.md` lands alongside the PR.

## Future Considerations

- **Admin-side enrichment dispatch as a primitive.** If Phase 2 lands and the pattern proves useful, the same dispatch surface could power a scheduled "auto-enrich gaps overnight" job — operator sets it to backfill missing artifacts during low-traffic windows without an interactive operator.
- **Manager-side enrichment-on-demand quota.** A future ticket might add a per-day budget for admin-triggered enrichments so a runaway bulk backfill doesn't blow through the vision-model spend.
- **Direct embedding reuse from cms during R8 cutover.** During the cms → admin migration, there may be a window where embedding artifacts already exist in cms's storage. A separate ticket could explore reading cms's embeddings directly during R8 cutover instead of regenerating them. Out of scope here.
