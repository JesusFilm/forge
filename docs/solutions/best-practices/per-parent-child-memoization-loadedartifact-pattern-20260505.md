---
title: "Per-(parent, child) memoization via loadedArtifact parameter widening on a useworkflow indexer"
date: "2026-05-05"
category: "best-practices"
problem_type: "best_practice"
component: "background_job"
root_cause: "inadequate_documentation"
resolution_type: "workflow_improvement"
severity: "medium"
module: "apps/admin"
tags:
  - useworkflow
  - memoization
  - s3-cache
  - loadedartifact
  - backfill
  - group-cascade
  - embed-backfill
  - p-limit
  - best-practice
related_prs:
  - "JesusFilm/forge#882"
related_features:
  - "feat-115"
  - "feat-116"
  - "feat-117"
related:
  - "docs/solutions/best-practices/bounded-parallelism-per-target-workflow-pattern-20260505.md"
  - "docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md"
  - "docs/solutions/best-practices/batched-provider-input-position-stable-contract-20260505.md"
  - "docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md"
  - "docs/solutions/platform/admin-transcript-embeddings-vector-reuse-pattern.md"
---

# Per-(parent, child) memoization via loadedArtifact parameter widening on a useworkflow indexer

## Problem

A useworkflow backfill that fans out across `(parent, child)` flat targets — for admin's case `(video, edition, locale)` triples — was paying a per-target cost for an artifact that is structurally invariant across all children of the same parent. The scene-embedding backfill at `apps/admin/src/workflows/sceneEmbeddingBackfill.ts` was issuing one S3 GET per `(video, edition, locale)` even though `scene-analysis.json` is per `(video, edition)` — every locale in the same edition was reading the identical ~250 KB artifact. R1 prod telemetry recorded 24 S3 reads for 24 targets across 4 editions; the actual unique artifact count was 4.

Surfaced in PR #882 (Stage 1 of the embed-backfill performance plan, `feat-115`) and resolved in Stage 2 (`feat-116`).

## Symptoms

- S3 read count scales as N×L (parents × children-per-parent) instead of N
- Per-child `durationMs` carries an artifact-fetch tax that dominates short children
- Outcome reasons that should be a single shared signal ("artifact_missing for this edition") fan out as L identical strings, giving the operator the false impression of L distinct failures
- Bandwidth and S3 cost scale with child count rather than with parent count
- The per-child step's `"use step"` boundary memoizes nothing useful — every child re-fetches the same artifact

## What Didn't Work

- **A plain (non-step) per-group worker function calling the artifact reader directly.** The original Stage 2 design had `processGroup` as a plain async function called from workflow scope, with the S3 read inline. The aim was to avoid journaling the ~250 KB artifact JSON per group as a step result. **The useworkflow build plugin (`workflow-node-module-error`) rejects this shape**: any module reachable from workflow scope via plain (non-step) function calls is treated as workflow scope, and `s3.ts` imports `node:fs/promises` + `node:path` for its local-fallback path. The plugin error explicitly says "Move this function into a step function." A separate `_steps/load-manager-artifact.ts` module wrapping the readers in `"use step"` did NOT satisfy the plugin either — `processGroup` itself transitively reached `s3.ts` through `_internals.stepIndexEditionLocale → indexEditionScenes → readSceneAnalysisArtifact`, and the plugin treated that whole chain as workflow scope. The fix is to make `processGroup` itself a `"use step"`. Trade-off accepted: the per-group `BackfillOutcome[]` AND the loaded artifact get journaled, costing ~280 KB per group of journal storage. Across a 6,000-group full backfill that's ~1.7 GB extra — acceptable for the wall-time + cost wins.
- **Caching the artifact in module scope keyed by `cmsVideoId`.** Breaks isolation between concurrent backfills and leaks across replays — a replayed worker would see stale data from a sibling run. Also unsafe in environments where multiple workflows run in the same process.
- **An LRU at the storage layer (`s3.ts::getObject`).** Cross-request bleed risk; cache-eviction tuning surface; lifetime decoupled from the workflow that owns the data. Rejected in plan §Key Technical Decisions.
- **Per-child `Promise.allSettled` with the artifact fetched in parallel.** Same N S3 reads, same rate-limit pressure — concurrent rather than serial. Doesn't address the actual cost.

## Solution

Group flat targets at the workflow boundary, fetch once per group, pass the loaded value down via a first-class service parameter:

### 1. Pure data transform at the workflow boundary

`groupTargetsByVideoEdition(targets)` produces `BackfillGroup[]` typed as `Omit<BackfillTarget, "locale"> & { targets: readonly BackfillTarget[] }`. The `satisfies BackfillGroup` literal in the grouper makes a future field added to `BackfillTarget` surface as a compile error in the grouper. No Prisma access — replay-safe inside `"use workflow"`:

```ts
function groupTargetsByVideoEdition(
  targets: readonly BackfillTarget[],
): BackfillGroup[] {
  const groupMap = new Map<
    string,
    { group: BackfillGroup; targets: BackfillTarget[] }
  >()
  for (const target of targets) {
    const key = `${target.videoId}::${target.videoEditionId}`
    let entry = groupMap.get(key)
    if (entry === undefined) {
      const targetsArr: BackfillTarget[] = []
      // `satisfies BackfillGroup` makes a future field added to
      // BackfillTarget surface as a compile error here.
      const group = {
        videoId: target.videoId,
        videoEditionId: target.videoEditionId,
        coreId: target.coreId,
        cmsVideoId: target.cmsVideoId,
        targets: targetsArr,
      } satisfies BackfillGroup
      entry = { group, targets: targetsArr }
      groupMap.set(key, entry)
    }
    entry.targets.push(target)
  }
  return Array.from(groupMap.values(), (e) => e.group)
}
```

### 2. Per-group worker is itself a `"use step"`

```ts
async function processGroup(group: BackfillGroup): Promise<BackfillOutcome[]> {
  "use step"
  const groupStartedAt = Date.now()

  // The artifact load + per-child fan-out are journaled by useworkflow
  // as part of this step's input/result graph. Required by the build
  // plugin: any code reachable from workflow scope via plain
  // (non-step) functions is treated as workflow scope, and `s3.ts`
  // imports Node-only modules (`node:fs/promises`, `node:path`) for
  // its local-fallback path which are forbidden there. Making
  // `processGroup` a `"use step"` cleanly demarcates scope.
  let loadedArtifact: SceneAnalysisResult
  try {
    loadedArtifact = await stepLoadSceneAnalysisArtifact(group.cmsVideoId)
  } catch (error) {
    // Group-level cascade — see §4 below.
    return cascadeLoadFailureToChildren(group, error, groupStartedAt)
  }

  // Per-child fan-out with the loaded artifact in scope. Sequential
  // inside the group so the artifact stays bounded to one stack frame
  // and the per-child step's timing measurement is honest.
  const outcomes: BackfillOutcome[] = []
  for (const target of group.targets) {
    const outcome = await _internals.stepIndexEditionLocale(
      target,
      loadedArtifact,
    )
    logOutcome(outcome)
    outcomes.push(outcome)
  }
  return outcomes
}
```

The `stepLoadSceneAnalysisArtifact` wrapper lives in a separate `_steps/load-manager-artifact.ts` module so the workflow file doesn't directly import the underlying `readSceneAnalysisArtifact` reader. This is belt-and-suspenders against the build plugin's import-graph reachability check — by the time we made `processGroup` a step, the separate-file move was redundant for the build, but it keeps the workflow module's import surface clean and documents the constraint inline:

```ts
// apps/admin/src/workflows/_steps/load-manager-artifact.ts
export async function stepLoadSceneAnalysisArtifact(
  cmsVideoId: number,
): Promise<SceneAnalysisResult> {
  "use step"
  return readSceneAnalysisArtifact(String(cmsVideoId))
}
```

**Replay durability note:** because `processGroup` is now a step, the loaded artifact AND the per-child outcomes get journaled as the step's input/result graph (~280 KB per group). On worker restart mid-backfill, completed groups replay from the journal; only incomplete groups re-execute. Operators monitoring useworkflow journal storage should expect ~1.7 GB per full 6,000-group backfill — small relative to the wall-time + cost wins, but worth knowing.

### 3. Service-side parameter widening

Add a first-class `loadedArtifact?: T` to the indexer's input. The service short-circuits the S3 read when supplied:

```ts
export type IndexEditionScenesInput = {
  // …
  /**
   * Pre-loaded scene-analysis artifact. When provided, the service
   * skips the S3 read. Workflow fetches once per (video, edition)
   * group and passes the same artifact into each per-locale invocation
   * — collapsing S3 reads from N×L to N. Tests can also use this to
   * inject a fixture without touching S3.
   */
  loadedArtifact?: SceneAnalysisResult
  /** Required when `loadedArtifact` is not set. */
  cmsVideoId?: number
}

let artifact: SceneAnalysisResult
if (input.loadedArtifact !== undefined) {
  artifact = input.loadedArtifact
} else {
  // Legacy fallback for ad-hoc callers / tests / future paths.
  artifact = await readSceneAnalysisArtifact(String(cmsVideoId))
}
```

Renamed from a previously test-only `artifactOverride?` to make non-test use first-class. Cleanest Stage-2 shape: rename, collapse the test path through the same field. The reviewer-confirmed pattern is: a test-only escape hatch that becomes load-bearing in production should be renamed to its production semantics.

### 4. Group-level failure cascade

A group-level load failure must produce one outcome per child in `group.targets` with the right classification. Without the cascade, the report's `succeeded/skipped/failed` triple becomes meaningless when the load fails:

```ts
const isMissing =
  error instanceof ManagerArtifactError && error.code === "artifact_missing"
const reason = isMissing
  ? "artifact_missing"
  : error instanceof Error
    ? error.message
    : String(error)
const durationMs = Date.now() - groupStartedAt
return group.targets.map((target) => {
  const outcome: BackfillOutcome = isMissing
    ? { status: "skipped", target, locale: target.locale, reason, durationMs }
    : { status: "failed", target, locale: target.locale, reason, durationMs }
  logOutcome(outcome)
  return outcome
})
```

Branch on the typed error class + literal-union `code` discriminant — never on error message regex. See `parallel-workflow-error-robustness-20260420.md` for the typed-error rule this extends.

### 5. pLimit boundary moves up one level

`pLimit(env.SCENE_EMBEDDING_CONCURRENCY ?? 5) + Promise.allSettled` now bounds concurrent GROUPS, not flat targets. Inside a group, per-child work is sequential `for…of` so the artifact stays scoped to one stack frame and per-child `durationMs` is honest:

```ts
const limit = pLimit(concurrency)
const settled = await Promise.allSettled(
  groups.map((group) => limit(() => processGroup(group))),
)
```

The bounded-parallelism prevention checklist (`bounded-parallelism-per-target-workflow-pattern-20260505.md`) still holds; the multi-child-per-group concurrency-cap test variant locks in the per-child-sequential-inside-group invariant.

### 6. Synthetic-failed cascade for the WHOLE group

`settled.flatMap` maps a rejected group to L synthetic `failed` outcomes (one per child), each with `Date.now() - batchStartedAt` so dashboards built on `outcomes[].durationMs` aren't polluted with `0`s when the defensive branch fires:

```ts
const outcomes: BackfillOutcome[] = settled.flatMap((result, i) => {
  const group = groups[i]!
  if (result.status === "fulfilled") return result.value
  const reason =
    result.reason instanceof Error
      ? result.reason.message
      : String(result.reason)
  const durationMs = Date.now() - batchStartedAt
  return group.targets.map((target) => {
    const synthetic: BackfillOutcome = {
      status: "failed",
      target,
      locale: target.locale,
      reason,
      durationMs,
    }
    logOutcome(synthetic)
    return synthetic
  })
})
```

## Why This Works

- **The artifact's identity is `(parent)`, not `(parent, child)`** — so the natural grouping axis is parent. Once enumeration produces flat targets, the grouper inverts that flattening at zero cost (Map insertion preserves enumeration order, `Array.from(groupMap.values(), e => e.group)` preserves it through to the workflow body).
- **Service parameter widening is the right contract surface, not workflow internals** — callers (workflow, tests, future ad-hoc paths) get one input shape; legacy callers without `loadedArtifact` still work via the fallback. Renaming the test-only field eliminates the "is this test-only or production?" ambiguity.
- **Sequential children inside a group caps memory** — the loaded artifact + per-child working set stays bound to one stack frame; net concurrent indexer load stays ≤ N (one per active group), well under the documented `connection_limit=10` Prisma pool.
- **Group-level cascade preserves the per-target outcome contract** — operators see L outcomes per group regardless of whether the failure was per-child or shared, so the report aggregates the same way and dashboards built on the outcome shape don't need conditional logic.
- **`satisfies BackfillGroup` enforces drift safety** — a future field added to `BackfillTarget` (e.g. `cmsLanguageId`) automatically appears in `Omit<BackfillTarget, "locale">` and the grouper literal becomes incomplete, so the compiler catches the missing-field case at the construction site.

## Verification

R1 smoke against local Postgres (Stage 2 PR, 2026-05-05):

- 24 targets / 4 (video, edition) groups / 0 failures / 14.7s wall-time
- 4 S3 reads (vs Stage 1's 24) — collapsed from per-target to per-group
- 24 batched OpenRouter calls (vs Stage 1's ~84 per-scene per-target)
- DB: `2_0-ComingHome` 60/60 locale rows + `2_0-Crushing` 24/24 locale rows have non-NULL `embedding`

R2 cascade verification (transcript backfill against same fixture, no provider call):

- 24 cascaded `failed` outcomes across 4 groups proved the group cascade fires correctly
- Identical `durationMs` across all members of each group (479ms × 5/7 outcomes one edition, 492ms × 5/7 the other) — the group-level S3 read failed once per group and `processGroup` synthesized per-child outcomes
- The `failed` (vs `skipped`) classification was the pre-existing `feat-119` NoSuchKey gap (out of scope for Stage 2)

Unit tests that lock in the contract (per workflow):

- `Stage 2: ONE s3.getObject per (video, edition) group across N locales (NOT per locale)`
- `Stage 2: TWO groups produce TWO s3.getObject calls (one per group)`
- `Stage 2: a group-level artifact_missing cascades to skipped outcomes for every locale in the group`
- `Stage 2: a group-level non-missing artifact error cascades to failed outcomes for every locale in the group`
- `Stage 2: per-locale work inside a group runs sequentially — multi-locale groups do NOT multiply concurrent indexer calls beyond the cap`
- Start-log shape test asserting `groupCount` is present alongside `concurrency`, `totalTargets`, etc.

## Prevention (checklist for the next agent applying this pattern)

1. **Identify the artifact's identity axis.** If it's `(parent)` and you're paying per-child to fetch it, you have this problem. If it's `(parent, child)`, this pattern doesn't apply — keep the per-child fetch.
2. **Add the load-once parameter to the service input as `loadedArtifact?: T`** — first-class, not test-only. Document that callers passing it short-circuit the fetch. Keep the fetch fallback so legacy/ad-hoc callers still work.
3. **Group flat targets at the workflow boundary with a pure function.** Type the result as `Omit<Target, "child"> & { targets: readonly Target[] }` so a future field added to `Target` surfaces as a compile error in the grouper via `satisfies`.
4. **Make the per-group worker function itself a `"use step"`.** The useworkflow build plugin treats any module reachable from workflow scope via plain (non-step) functions as workflow scope; if your storage layer imports Node-only modules (`node:fs`, `node:path`, etc.), the plugin will reject the build. The `"use step"` directive on the worker function cleanly demarcates scope so the storage layer's Node imports are seen as step-runtime (where Node modules are allowed). Side-effect: the worker's input/result graph (artifact + outcomes) gets journaled per group. For a ~250 KB artifact + ~30 KB outcomes per group × 6,000 groups, that's ~1.7 GB of journal storage per full backfill. Acceptable for the wall-time wins; document it in the worker's JSDoc so a future agent doesn't naively un-step it.
5. **Run children sequentially inside the group.** This caps memory to one artifact + one child's working set per active group. Concurrent groups are the unit of parallelism, not concurrent children of the same group.
6. **Move the pLimit boundary up to GROUPS, not children.** Update the concurrency doc/comment so an operator inspecting env vars knows the unit changed. Add a `groupCount` field to the workflow's `event=start` log so an operator inspecting trigger logs can see the artifact-fetch fan-in independently of total target count.
7. **Cascade group-level load failures to per-child outcomes with classification preserved.** Branch on the typed error class (`error instanceof ManagerArtifactError && error.code === "artifact_missing"`), not on message regex. The report's succeeded/skipped/failed triple must stay meaningful.
8. **Add a "single S3 read per group" test** that mocks the storage call, runs a multi-child group, and asserts call count = 1.
9. **Add a "multi-child-per-group concurrency-cap" test variant.** Two groups × 3+ children each at concurrency=2 — `observedMaxInFlight === N` (exact equality) must hold. A regression that fans out per-child work in parallel inside `processGroup` would jump to 6, failing the test.
10. **Add a group-level cascade test** that forces `readArtifact` to throw, asserts L cascaded outcomes, identical `durationMs` per group, and the right classification.
11. **Add a code comment in the per-group worker explaining WHY it's a `"use step"`.** The plugin constraint is non-obvious from reading the function body alone — without the comment, a future agent looking to reduce journal storage will naively un-step it and break the build. Reference the build plugin's error class (`workflow-node-module-error`) so the comment is grep-able when CI breaks.

## Cross-references

- `docs/solutions/best-practices/bounded-parallelism-per-target-workflow-pattern-20260505.md` — the HOW for the per-target pLimit + allSettled boundary that this pattern lifts up one level. Stage 2 is a direct evolution; cross-link bidirectionally.
- `docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md` — the WHY for typed-error classification + Promise.allSettled. The group-level cascade extends the same rule to a new failure-cascade shape.
- `docs/solutions/best-practices/batched-provider-input-position-stable-contract-20260505.md` — the sibling Stage 2 pattern; both apply to the same R1 indexer call site.
- `docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md` — R1 indexer that this pattern parallelizes the artifact load on. The indexer signature now accepts `loadedArtifact`.
- `docs/solutions/platform/admin-transcript-embeddings-vector-reuse-pattern.md` — R2 sibling. Same `loadedArtifact` parameter on `indexEditionTranscript`.
- `apps/admin/src/workflows/sceneEmbeddingBackfill.ts` — canonical Stage 2 implementation (R1).
- `apps/admin/src/workflows/transcriptEmbeddingBackfill.ts` — same shape (R2; no provider call).
- PR #882 — Stage 1 (the per-target loop this pattern reshapes).
- Stage 2 PR (`feat-116`) — originating PR.
