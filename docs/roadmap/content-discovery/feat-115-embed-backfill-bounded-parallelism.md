---
id: "feat-115"
title: "Embed Backfill — Stage 1 — Bounded Parallelism on Per-Target Loop"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-05-04"
duration: 1
depends_on: []
blocks:
  - "feat-116"
tags:
  - "admin"
  - "ai-pipeline"
  - "performance"
---

## Resolution

**Shipped:** 2026-05-05 via [PR #882](https://github.com/JesusFilm/forge/pull/882) (`perf(admin): parallelize embed-backfill per-target loop (feat-115)`). Stage 1 of the four-stage embed-backfill performance plan ([`docs/plans/2026-05-04-002-refactor-admin-embed-backfill-performance-plan.md`](../../plans/2026-05-04-002-refactor-admin-embed-backfill-performance-plan.md)).

**What landed.** Both R1 (`apps/admin/src/workflows/sceneEmbeddingBackfill.ts`) and R2 (`apps/admin/src/workflows/transcriptEmbeddingBackfill.ts`) replaced the sequential `for…of` over `(video, edition, locale)` targets with `pLimit(N)` + `Promise.allSettled`. Per-target error isolation preserved: `artifact_missing` still classifies as `skipped`, every other error stays `failed`, no rejection aborts sibling targets.

- Two new env vars wired through `apps/admin/src/config/env.ts` as `z.coerce.number().int().positive().optional()`:
  - `SCENE_EMBEDDING_CONCURRENCY` (default `5`)
  - `TRANSCRIPT_EMBEDDING_CONCURRENCY` (default `5`)
- Defaults shipped at **5**, not the **10** the PR body originally cited. The bounded-parallelism doc that landed alongside this PR locks in the `≤ floor(connection_limit / 2)` rule against admin's `connection_limit=10` Prisma pool — half the pool stays available for live GraphQL/REST traffic.
- `pnpm --filter @forge/admin run-embeds` CLI start event now logs `sceneConcurrency` / `transcriptConcurrency` for operator visibility.
- `apps/admin/CLAUDE.md` R1 + R2 subsections updated to document the env vars and the `Promise.allSettled` invariant.
- `_internals` export added to both workflows so the outer-`allSettled` defensive branch is test-reachable via `vi.spyOn(_internals, "stepIndexEditionLocale")` — the only test shape that genuinely distinguishes `Promise.allSettled` from `Promise.all`.

**Pattern doc.** PR #882 also shipped [`docs/solutions/best-practices/bounded-parallelism-per-target-workflow-pattern-20260505.md`](../../solutions/best-practices/bounded-parallelism-per-target-workflow-pattern-20260505.md) — the canonical HOW that complements the prior 04/20 WHY doc. Stage 2 (`feat-116`) and any future per-target useworkflow loop must honor its 11-item prevention checklist.

**Residual risk surfaced.** Stage 1's smoke run revealed that S3 `NoSuchKey` errors (upstream-data-readiness gaps) classify as `failed` instead of `skipped`, polluting operator signal. Tracked separately as [`feat-119`](feat-119-embed-backfill-artifact-missing-classification-and-opt-in-enrichment.md) (P2). Out of scope for Stages 2–3.

**Stage 2 unblocked.** `feat-116` (S3 artifact memoization + batched OpenRouter) is the natural next block.

## Problem

R1 (scene) and R2 (transcript) embed-backfill workflows iterate `(video, edition, locale)` triples sequentially with `for…of`. At ~1,088 videos × ~30 locales avg the per-target loop is the dominant wall-time cost. Parallelization is documented-rule-bound: `docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md` says "no `Promise.all`" because one rejection kills the batch. The right shape is `p-limit(N)` + `Promise.allSettled` — bounded concurrency, every per-target outcome captured independently, no full-batch abort on a single failure.

Expected speedup: **5-10×** on R1 (gated by OpenRouter rate limits, not us); **10-20×** on R2 (DB-bound).

## Entry Points — Read These First

1. `apps/admin/src/workflows/sceneEmbeddingBackfill.ts` — R1 workflow body; the `for…of` over enumerated targets is what we replace.
2. `apps/admin/src/workflows/transcriptEmbeddingBackfill.ts` — R2 workflow; same shape.
3. `apps/admin/src/scripts/run-embeds.ts` — the local CLI; direct-invokes the workflow function bodies bypassing useworkflow runtime. Must continue to work unchanged.
4. `docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md` — the no-`Promise.all` rule and the `allSettled` pattern.
5. `docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md` — every `start()` call site has a dispatch-level test; do not regress.

## Grep These

```
grep -rn "for (const target of" apps/admin/src/workflows/
grep -rn "Promise.allSettled\|Promise.all\|p-limit\|pLimit" apps/admin/src/
grep -rn "SCENE_EMBEDDING_CONCURRENCY\|TRANSCRIPT_EMBEDDING_CONCURRENCY" apps/admin/src/
```

## What To Build

- Add `p-limit` to `apps/admin/package.json` if not present.
- Replace the per-target `for…of` in `sceneEmbeddingBackfill.ts` and `transcriptEmbeddingBackfill.ts` with:

  ```ts
  const limit = pLimit(env.SCENE_EMBEDDING_CONCURRENCY ?? 10)
  const settled = await Promise.allSettled(
    targets.map((t) => limit(() => indexEditionScenes(t))),
  )
  // Map settled results to the existing outcomes[] shape (succeeded/skipped/failed).
  ```

- Add env vars `SCENE_EMBEDDING_CONCURRENCY` and `TRANSCRIPT_EMBEDDING_CONCURRENCY` to `apps/admin/src/config/env.ts` (zod-validated, optional, default 10). Surface in CLI output (`run-embeds.start` event).
- Preserve the existing per-outcome shape (`{ action: "indexed" | "skipped_unchanged", … }` / `{ reason: "artifact_missing" | … }`). The change is internal; the GraphQL trigger response and CLI return JSON must be byte-identical except for ordering.
- Update CLAUDE.md R1 + R2 subsections with the concurrency env-var name and the rule that the workflow uses `allSettled`, not `Promise.all`.

## Constraints

- **Do NOT** use bare `Promise.all` — one rejection would abort the entire batch (per the workflow-robustness solutions doc).
- Per-target idempotency must remain intact: re-running any subset must produce identical DB state. Both workflows already use composite-key upserts; nothing to change.
- Concurrency `N` must be env-tunable so prod can ramp conservatively (start at 5) while local can crank (20+).
- Dispatch tests for `triggerSceneEmbeddingBackfill` and `triggerTranscriptEmbeddingBackfill` must stay green — no GraphQL surface change.
- Outcome ordering may differ from sequential. If any test asserts specific ordering, it's a bug in the test (the documented contract is per-target isolation, not order); fix the test.

## Verification

- `pnpm --filter @forge/admin typecheck` ✓
- `pnpm --filter @forge/admin lint` ✓
- `pnpm --filter @forge/admin vitest run src/workflows/sceneEmbeddingBackfill src/workflows/transcriptEmbeddingBackfill` — all green; new test asserts that two intentionally-failing target promises do not abort the run.
- Local benchmark: a `pnpm core-sync:run --full` followed by `pnpm run-embeds --pipeline=both --locale=en` completes meaningfully faster than the pre-change baseline (capture wall-time before/after).
- New test asserts `pLimit` cap: with concurrency=2 and three targets that each take ≥10ms, the third target's start time is ≥ the first target's end time (timing assertion, generous epsilon).
