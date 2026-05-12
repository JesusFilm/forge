---
title: "Bounded parallelism pattern for admin per-target useworkflow loops"
category: "best-practices"
problem_type: "best_practice"
component: "background_job"
root_cause: "inadequate_documentation"
resolution_type: "documentation_update"
severity: "medium"
date: "2026-05-05"
tags:
  - admin
  - useworkflow
  - p-limit
  - promise-allsettled
  - parallelism
  - embed-backfill
  - R1
  - R2
  - ai-pipeline
  - performance
  - testing-patterns
  - prisma-connection-limit
module: "apps/admin"
affected_files:
  - "apps/admin/src/workflows/sceneEmbeddingBackfill.ts"
  - "apps/admin/src/workflows/transcriptEmbeddingBackfill.ts"
  - "apps/admin/src/workflows/sceneEmbeddingBackfill.test.ts"
  - "apps/admin/src/workflows/transcriptEmbeddingBackfill.test.ts"
  - "apps/admin/src/scripts/run-embeds.ts"
  - "apps/admin/src/config/env.ts"
  - "apps/admin/src/db/client.ts"
  - "apps/admin/CLAUDE.md"
related:
  - "docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md"
  - "docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md"
  - "docs/solutions/best-practices/prototype-defaults-vs-data-derived-enumeration-20260422.md"
  - "docs/solutions/best-practices/review-fix-round-2-sibling-call-site-regressions-20260421.md"
  - "docs/solutions/best-practices/admin-postgres-workflow-operations-pattern-20260501.md"
  - "docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md"
  - "docs/solutions/platform/admin-transcript-embeddings-vector-reuse-pattern.md"
  - "docs/solutions/platform/admin-experience-content-dump-pattern.md"
  - "docs/solutions/platform/backfill-worker-pattern-manager-20260407.md"
  - "docs/solutions/database-issues/pgvector-bulk-insert-on-conflict-pattern-20260505.md"
related_prs:
  - "JesusFilm/forge#882"
related_features:
  - "feat-115"
  - "feat-116"
  - "feat-117"
---

## Problem

How do you parallelize a per-target useworkflow loop in admin without (a) breaking per-target error isolation, (b) starving the shared Prisma `connection_limit=10` pool, (c) losing operational visibility on long backfills, and (d) shipping tests that _look_ like they guard the contract but silently pass even after a `Promise.all` regression?

`docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md` establishes the WHY (the no-`Promise.all` rule). This doc establishes the HOW: the concrete `pLimit + Promise.allSettled` shape, the env-var wiring, the streaming-log pattern, and the two specific tests that actually lock in the contract. Surfaced and operationalized in PR #882 (`feat-115`, Stage 1 of the embed-backfill performance plan).

## Symptoms (signals you're hitting this)

- A workflow's `for…of` per-target loop dominates wall time on long backfills (R1, R2, future per-target jobs).
- Operators complain there's no progress visibility during multi-hour runs — only a final summary line after everything settles.
- Postgres `pool_timeout` errors show up in logs when a backfill runs alongside live GraphQL/REST traffic.
- Test names like _"isolates failures from siblings"_ or _"records failed outcomes but keeps processing"_ exist, but a `Promise.all` regression in the workflow body would still leave them green — because the rejection is caught inside the per-target step's own `try/catch` and never reaches the outer `await`.
- Per-target failure outcomes show `durationMs: 0` in dashboards and you can't tell "instant fail" from "synthetic outcome from a step plumbing fault."
- Logs burst thousands of lines at the end of a long run instead of streaming as targets settle.

## What Didn't Work

- **Bare `Promise.all` over `targets.map(stepIndexFn)`.** One rejection aborts the whole batch — the antithesis of the per-target isolation contract. This is the rule the WHY doc establishes; this doc specifies HOW to do it correctly.
- **`Promise.allSettled` over `targets.map(stepIndexFn)` WITHOUT a concurrency cap.** Unbounded fan-out hammers OpenRouter rate limits (R1 has a provider call per scene, then per target with Stage 2's batching) AND Postgres connections (admin's main pool is `connection_limit=10`, see `apps/admin/src/db/client.ts`) simultaneously. R2 is DB-bound and saturates the pool faster.
- **Catching errors only inside the per-target step.** The outer `Promise.allSettled` rejected branch becomes unreachable from tests — sibling-isolation tests pass for both `allSettled` and `Promise.all`, defeating the regression-guard intent.
- **Logging in a post-`allSettled` for-loop.** Bursts thousands of log lines at the end of a multi-hour run, leaving operators blind during the actual work. Regresses an emergent property of the old sequential `for…of` (per-target log lines as a heartbeat).
- **Asserting `observedMaxInFlight <= N`.** A regression to sequential `for…of` yields `1`, which still passes `<= N`. The test silently green-lights the very regression it was written to catch.

## Solution

The canonical workflow body shape, lifted from `apps/admin/src/workflows/sceneEmbeddingBackfill.ts` (R1) — R2 (`transcriptEmbeddingBackfill.ts`) is the same shape with different domain types:

```ts
import pLimit from "p-limit"
import { env } from "@/config/env"

/**
 * Default per-target concurrency. Override via env var. Sized below
 * admin's documented `connection_limit=10` Prisma pool to leave
 * headroom for concurrent GraphQL/REST traffic; local dev can crank
 * to 20+ via the env override.
 */
export const DEFAULT_SCENE_EMBEDDING_CONCURRENCY = 5

export async function runSceneEmbeddingBackfill(
  input: SceneEmbeddingBackfillInput,
): Promise<SceneEmbeddingBackfillReport> {
  "use workflow"

  const mapping = await stepLoadMapping(input.mappingS3Key)
  const targets = await stepEnumerateTargets(/* ... */, mapping)

  // Bounded parallelism. `pLimit(N) + Promise.allSettled` is the
  // documented robustness shape — never bare `Promise.all` (one
  // rejection would abort the entire batch).
  const concurrency =
    env.SCENE_EMBEDDING_CONCURRENCY ?? DEFAULT_SCENE_EMBEDDING_CONCURRENCY
  const limit = pLimit(concurrency)

  // Structured start log so the workflow's effective concurrency is
  // observable from any trigger path (GraphQL mutation or local CLI).
  console.log(
    JSON.stringify({
      workflow: "scene-embedding-backfill",
      event: "start",
      mappingGeneratedAt: mapping.generatedAt,
      totalTargets: targets.length,
      concurrency,
      localeFilter: /* ... */,
    }),
  )

  // `Promise.allSettled` preserves input order, so `outcomes[i]`
  // aligns positionally with `targets[i]`. Per-completion logging
  // streams progress (instead of bursting at the end), restoring the
  // visibility the sequential `for…of` had.
  const batchStartedAt = Date.now()
  const settled = await Promise.allSettled(
    targets.map((target) =>
      limit(() =>
        // Deliberately do NOT catch here. The step already returns a
        // typed `failed` outcome for every error it can see; an
        // unexpected throw past that boundary should propagate as a
        // `rejected` settled result so the synthetic-failed branch
        // below records it (with real elapsed time) and the
        // per-target isolation contract is observable to tests.
        _internals.stepIndexEditionLocale(target).then((o) => {
          logOutcome(o)
          return o
        }),
      ),
    ),
  )

  const outcomes: BackfillOutcome[] = settled.map((result, i) => {
    if (result.status === "fulfilled") return result.value
    const target = targets[i]!
    const synthetic: BackfillOutcome = {
      status: "failed",
      target,
      locale: target.locale,
      reason:
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason),
      // Real elapsed batch time, NOT 0 — dashboards built on
      // `outcomes[].durationMs` aren't polluted by the defensive
      // branch firing.
      durationMs: Date.now() - batchStartedAt,
    }
    logOutcome(synthetic)
    return synthetic
  })

  return stepReport({ /* ... */, outcomes })
}
```

The `_internals` export at the bottom of the file is the testability hook:

```ts
// `stepIndexEditionLocale` is referenced through `_internals` from
// the workflow body so tests can `vi.spyOn(_internals, "stepIndexEditionLocale")`
// to force a `Promise.allSettled` rejection — the only way to
// exercise the synthetic-failed defensive branch, since the real
// step body catches everything internally.
export const _internals = {
  stepReport,
  stepIndexEditionLocale,
  toSucceeded,
  logOutcome,
}
```

The workflow body **must** call `_internals.stepIndexEditionLocale(target)`, not the bare `stepIndexEditionLocale(target)` import — only the `_internals.X` form is spy-reachable from a test file.

### The three tests that genuinely guard the contract

From `apps/admin/src/workflows/sceneEmbeddingBackfill.test.ts`:

**1. Per-target indexer error → step's internal try/catch converts it to `failed`, siblings continue.** This is the per-target step coverage. It proves the inner try/catch works; it does _not_ distinguish `allSettled` from `Promise.all`.

```ts
it("isolates a per-target indexer error: errors caught inside stepIndexEditionLocale → outcome stays `failed`, siblings continue", async () => {
  vi.mocked(indexEditionScenes)
    .mockResolvedValueOnce(ok("en"))
    .mockRejectedValueOnce(new Error("kaboom"))
    .mockResolvedValueOnce(ok("es"))

  const report = await runSceneEmbeddingBackfill({
    /* ... */
  })

  expect(report.succeeded).toBe(2)
  expect(report.failed).toBe(1)
  expect(indexEditionScenes).toHaveBeenCalledTimes(3)
})
```

**2. Step-level rejection via `_internals` spy → outer `allSettled` rejected branch fires.** **This is the test that genuinely distinguishes `Promise.allSettled` from `Promise.all`.** Under `Promise.all`, the workflow body's `await` would throw and `stepReport` would never run; under `Promise.allSettled`, the workflow synthesizes a `failed` outcome and the report comes back normally.

```ts
it("uses Promise.allSettled (not Promise.all) — a step-level rejection is recorded as a synthetic failed outcome instead of aborting the batch", async () => {
  vi.spyOn(_internals, "stepIndexEditionLocale").mockImplementation(
    async (target) => {
      if (target.coreId === "core-b") {
        // Genuine rejection that escapes the step boundary.
        throw new Error("step plumbing fault")
      }
      return okOutcome(target, 5)
    },
  )

  const report = await runSceneEmbeddingBackfill({
    /* ... */
  })

  expect(report.succeeded).toBe(2)
  expect(report.failed).toBe(1)
  const failedOutcome = report.outcomes.find((o) => o.status === "failed")
  expect(failedOutcome?.reason).toBe("step plumbing fault")
  // Synthetic outcome carries real elapsed batch time, not 0.
  expect(failedOutcome?.durationMs).toBeGreaterThanOrEqual(0)
})
```

**3. Concurrency-cap timing test asserting BOTH bounds: `observedMaxInFlight === N` (exact equality, not `<= N`).**

```ts
it("caps concurrent in-flight indexer calls at SCENE_EMBEDDING_CONCURRENCY (and uses parallelism, not sequential)", async () => {
  let inFlight = 0
  let observedMaxInFlight = 0

  vi.mocked(indexEditionScenes).mockImplementation(async (_prisma, args) => {
    inFlight += 1
    observedMaxInFlight = Math.max(observedMaxInFlight, inFlight)
    await new Promise((resolve) => setTimeout(resolve, 25))
    inFlight -= 1
    return {
      /* ... */
    }
  })

  await runSceneEmbeddingBackfill({
    /* ... */
  })

  // Mocked env to SCENE_EMBEDDING_CONCURRENCY=2.
  // Exact equality: catches BOTH a regression to sequential
  // (would yield 1) AND a regression that drops the pLimit cap
  // (would yield 3).
  expect(observedMaxInFlight).toBe(2)
})
```

### The mocked-env override pattern

The concurrency-cap test needs a small, deterministic value (`2`); production default is `5`. Mock `@/config/env` BEFORE the workflow imports so `pLimit(env.X ?? DEFAULT)` reads the override:

```ts
vi.mock("@/config/env", () => ({
  env: { SCENE_EMBEDDING_CONCURRENCY: 2 },
}))
```

### `restoreAllMocks` in the parallelism `beforeEach`

`vi.spyOn(_internals, ...)` in test 2 must not bleed into test 3. Module-level `vi.mock` factories survive `restoreAllMocks` — only the spy is reverted:

```ts
beforeEach(() => {
  vi.restoreAllMocks()
  ;(prisma as unknown as PrismaStub).$queryRaw.mockReset()
  vi.mocked(indexEditionScenes).mockReset()
})
```

## Why This Works

- **`pLimit(N) + Promise.allSettled`**: structural enforcement of the "no batch abort" rule. `pLimit` bounds concurrency; `allSettled` keeps sibling failures isolated. Neither alone is sufficient — bare `pLimit` over `Promise.all` still aborts on first rejection; bare `allSettled` saturates the pool.
- **Concurrency default = 5 (against `connection_limit=10`)**: leaves headroom for concurrent GraphQL/REST traffic on the same Prisma pool. Operationalizes the "≤ floor(`connection_limit` / 2)" rule. Each per-target step opens at most one connection at a time, so 5 concurrent steps cap pool usage at 5/10 — half the pool stays available for live traffic. Local dev can crank via env override; prod defaults are conservative because backfills coexist with user load.
- **Step internal try/catch + outer `allSettled` defensive branch**: layered safety. The step covers known errors with typed `failed` outcomes (the 99% case). The outer branch covers framework / step-plumbing faults that bypass the step's try/catch (the 1% case that still must not abort the batch). Both branches are reachable in tests; both produce correctly-shaped `BackfillOutcome` rows.
- **`_internals` export**: the _only_ way to make the outer defensive branch testable. Without it, `Promise.all` regressions go undetected — the inner try/catch absorbs every test-injected rejection before it reaches the outer `await`, so a regression silently passes the per-target isolation tests. The `_internals.X` indirection is the seam the test needs.
- **`observedMaxInFlight === N` (exact, not `<= N`)**: detects both directions of regression. `<= 2` allows `1` (sequential regression) AND `2` (correct) AND silently masks the most common regression mode. Exact equality forces a failure if anyone replaces `pLimit + allSettled` with a `for…of` "to simplify."
- **Real `durationMs` on synthetic-failed**: dashboards built on `outcomes[].durationMs` (latency p50/p95, slow-target detection) can't distinguish "instant fail" from "synthetic outcome from a step plumbing fault" if the latter reports `0`. `Date.now() - batchStartedAt` carries the real elapsed time.
- **Streaming `logOutcome` inside the `limit()` callback `.then()`**: long runs (hours, tens of thousands of targets) need real-time progress signal. Bursting at the end is a regression of an _emergent property_ of the old sequential `for…of` loop — operators relied on per-target log lines as a heartbeat. `logOutcome` sits OUTSIDE the per-target try/catch, so it's wrapped in its own defensive try/catch (a `JSON.stringify` throw on a circular structure or BigInt would otherwise halt the run).
- **`Promise.allSettled` preserves input order**: `outcomes[i]` aligns positionally with `targets[i]` even though per-target work completes out of order. Downstream `stepReport` aggregation and any operator-side joins on `(target, outcome)` rely on this; documented in the workflow comment so future maintainers don't re-sort defensively.
- **Length-0 array → "omitted"**: `coreIds: []` and `locales: []` are treated as undefined, not "match nothing." A GraphQL caller who accidentally passes `[]` would otherwise silently run zero work with a success-shaped report. Defensive normalization at the workflow boundary.

## When NOT to apply this pattern

`apps/admin/src/workflows/experienceContentDump.ts` (R3) intentionally **stays sequential**. Its per-target work dispatches a downstream `runExperienceEmbedding` workflow plus reads from cms's read-only role — the bottleneck is upstream cms, not admin. Parallelizing R3 would just queue at cms and add concurrent pressure on a fragile read role. See `docs/solutions/platform/admin-experience-content-dump-pattern.md` for the deliberate sequential-`for…of` decision.

Not every per-target loop benefits from this pattern. The prerequisites are:

1. The per-target step is the wall-time bottleneck (not a downstream service or an upstream read pool).
2. The shared resource pool (Prisma, OpenRouter rate limits) has measured headroom.
3. Operators want real-time progress visibility on long runs.

When all three hold, apply the pattern. When they don't, sequential `for…of` is the correct shape — and `parallel-workflow-error-robustness-20260420.md` still applies (no `Promise.all`, even sequentially).

## Prevention (checklist for the next agent adding bounded parallelism)

1. ☐ Use `pLimit(env.X_CONCURRENCY ?? DEFAULT)` + `Promise.allSettled` — never bare `Promise.all`, never bare `pLimit + Promise.all`, never bare `Promise.allSettled` without a cap.
2. ☐ Pick `DEFAULT` ≤ floor(`connection_limit` / 2) of the Prisma pool the workflow shares with live traffic. Document the rationale in a JSDoc comment on the constant — future maintainers must understand the budget calculus, not just the number.
3. ☐ Stream `logOutcome` inside the `limit()` callback's `.then()` (after the inner await, before returning the outcome). Wrap the body of `logOutcome` in its own try/catch so a `JSON.stringify` throw can't halt the run.
4. ☐ Capture `batchStartedAt = Date.now()` outside the `targets.map`; use it for `durationMs` on the synthetic-failed branch. Never `0`.
5. ☐ Export the per-target step function via `_internals` AND call it as `_internals.stepX(target)` from the workflow body — not the bare imported reference. The indirection is what makes the outer defensive branch test-reachable.
6. ☐ Emit a structured `event=start` log carrying the resolved concurrency, total target count, and any input filters at workflow entry. Closes the agent-native gap where only the local CLI logged this previously.
7. ☐ Treat length-0 array filters (`coreIds: []`, `locales: []`) as "omitted" at the workflow boundary.
8. ☐ Write at LEAST these three tests:
   - **Per-target indexer error** (mock the inner indexer to reject) → step's internal try/catch converts to `failed`; siblings continue. Proves the inner catch works.
   - **Step-level rejection** via `vi.spyOn(_internals, "stepX").mockImplementation(...)` that throws → outer `allSettled` rejected branch fires; synthetic outcome produced with `durationMs >= 0`. **A `Promise.all` regression would fail this test.** This is the load-bearing test of the whole pattern.
   - **Concurrency-cap timing test** asserting `observedMaxInFlight === N` (exact equality). Mock `@/config/env` to `N=2` for determinism; have the mocked indexer increment/decrement an in-flight counter around a `setTimeout(25)`.
9. ☐ Reset spies in the parallelism describe block's `beforeEach` (`vi.restoreAllMocks()`); module-level `vi.mock` factories survive — only the spy is reverted.
10. ☐ Update the workflow's section in `apps/admin/CLAUDE.md` documenting the new env var, the resolved-concurrency log event name, and the `Promise.allSettled` invariant. Future agents grep CLAUDE.md before reading source.
11. ☐ Cross-reference `docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md` (the WHY) in this doc and vice-versa (the HOW).

## Cross-references

- `apps/admin/src/workflows/sceneEmbeddingBackfill.ts` — canonical implementation (R1).
- `apps/admin/src/workflows/transcriptEmbeddingBackfill.ts` — same shape, different domain (R2).
- `apps/admin/src/workflows/sceneEmbeddingBackfill.test.ts` — canonical test shape including `vi.spyOn(_internals, ...)`.
- `apps/admin/src/workflows/experienceContentDump.ts` — counter-example: stays sequential intentionally (R3). Deliberate decision documented in `docs/solutions/platform/admin-experience-content-dump-pattern.md`.
- `apps/admin/src/db/client.ts` — documents the `connection_limit=10` Prisma pool that constrains the concurrency default.
- `apps/admin/CLAUDE.md` — R1 and R2 sections updated post-PR with the env vars and the `Promise.allSettled` invariant.
- `docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md` — the prior learning that established "no `Promise.all`"; this doc complements it.
- `docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md` — dispatch-level test rule; bounded-parallelism tests must NOT regress dispatch tests.
- `docs/solutions/best-practices/prototype-defaults-vs-data-derived-enumeration-20260422.md` — the data-derived enumeration the parallel loop iterates.
- `docs/solutions/best-practices/review-fix-round-2-sibling-call-site-regressions-20260421.md` — predicts the failure mode the test-the-contract section guards against.
- `docs/solutions/best-practices/admin-postgres-workflow-operations-pattern-20260501.md` — Postgres World runtime + heartbeat context; per-target `outcomes[].durationMs` plugs into the same observability surface.
- `docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md` — R1 indexer pattern that this parallelizes.
- `docs/solutions/platform/admin-transcript-embeddings-vector-reuse-pattern.md` — R2 indexer pattern that this parallelizes.
- `docs/solutions/platform/backfill-worker-pattern-manager-20260407.md` — earlier (manager-side) backfill pattern; durability layer this sits on top of.
- `docs/solutions/best-practices/per-parent-child-memoization-loadedartifact-pattern-20260505.md` — Stage 2 evolution. Lifts the pLimit boundary from per-target to per-`(video, edition)` GROUP, fetches the manager-artifacts S3 read once per group, threads the loaded artifact down via a service `loadedArtifact` parameter. The 11-item prevention checklist in the present doc still applies — re-validate against the new shape (concurrent groups instead of concurrent targets) when adopting.
- `docs/solutions/best-practices/batched-provider-input-position-stable-contract-20260505.md` — Stage 2 sibling pattern for the per-`(video, locale)` batched OpenRouter call.
- PR #882 — originating PR (`feat-115`, Stage 1 of embed-backfill performance plan).
- Stage 2 PR (`feat-116`) — applies the boundary lift.

## See Also

- `docs/solutions/best-practices/external-client-retry-parity-in-runner-fanout-20260512.md` — failure mode of this pattern: when ≥2 external clients share the same `pLimit()` fan-out but have asymmetric retry policies, the runner's per-item try/catch silently corrupts the persisted data.
