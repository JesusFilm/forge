---
title: "Workflow step bodies call plain helpers, never nested `start()` — preserves CLI-shim runtime independence"
category: best-practices
module: apps/admin
date: 2026-05-17
last_updated: 2026-05-17
tags:
  - useworkflow
  - workflows
  - embeddings
  - cli-shim
  - run-embeds
  - composition-pattern
  - sibling-symmetry
  - ce-review
  - pr-967
  - pr-966
problem_type: best_practice
component: background_job
root_cause: wrong_api
resolution_type: code_fix
severity: medium
applies_when: >
  Adding a new useworkflow backfill in apps/admin whose per-target step body
  needs to do the same work as an existing per-unit workflow. The step body MUST
  call a plain async service helper — never `start(siblingWorkflow, [...])`.
  Nested `start()` inside a `"use step"` body silently breaks the
  `pnpm --filter @forge/admin run-embeds` CLI shim (tsx mode treats
  `"use workflow"` as inert, so nested `start()` re-enters `workflow/api` and
  requires a running runtime that the CLI doesn't provide). Verify symmetry
  with sibling backfills under `apps/admin/src/workflows/` —
  `sceneEmbeddingBackfill.ts` and `transcriptEmbeddingBackfill.ts` both call
  plain service functions (`indexEditionScenes`, `indexEditionTranscript`)
  from their step bodies. Rule: workflow step → plain service function.
  Never workflow step → nested workflow.
---

## Problem

A workflow step body (`"use step"`) in `runExperienceEmbeddingBackfill` dispatched a sibling workflow via `start(runExperienceEmbedding, [...])` once per target. Because the CLI shim `pnpm --filter @forge/admin run-embeds` direct-invokes the backfill workflow (the `"use workflow"` directive is inert in the tsx runtime), every per-target iteration re-entered `workflow/api`'s `start()` with no workflow runtime configured — silently breaking the documented "runtime-independent CLI" invariant and adding RPC layering that the sibling R1/R2 backfills had explicitly avoided.

## Symptoms

- **CLI invocation stalls or 500s mid-loop.** `pnpm --filter @forge/admin run-embeds --pipeline=experience` would either hang on the first per-target `start()` (waiting for a runtime that isn't there) or fail with an opaque "no workflow runtime configured" error after target #1. The local-dev path documented in [`apps/admin/CLAUDE.md`](../../../apps/admin/CLAUDE.md) "Running embeds locally (R1 + R2)" would be quietly broken for R3 only.
- **Production per-target latency creep.** Each `await run.returnValue` is an extra HTTP hop through admin's workflow runtime. For an N-target backfill, that's N extra round-trips beyond what R1/R2 incur. Slower batches, more failure surface, no functional gain.
- **Replay/lifecycle coupling.** The outer step's durability boundary became entangled with the inner workflow's lifecycle — a retry of the outer step would re-issue a fresh inner `start()`, creating duplicate inner workflow runs with no idempotency key.
- **Test suite was green.** Unit tests mocked `start()` to return synthetic `{ returnValue }` shapes, so the nested-dispatch path "worked" in tests while the real CLI/runtime contract was broken. Classic mocked-shape-vs-real-contract trap.

## What Didn't Work

- **"Reuse-by-dispatch felt natural."** The original author saw that `runExperienceEmbedding` already existed as a per-locale workflow and reached for `start(runExperienceEmbedding, [...])` as the reuse mechanism. The reasoning — "it's already a workflow, just call it from the backfill" — sounded like good DRY but ignored that workflow-to-workflow dispatch is an RPC boundary, not a function call.
- **Mocked unit tests gave false confidence.** The backfill's tests stubbed `start` to return canned outcomes. Every branch (`succeeded` / `failed` / `skipped`) had coverage. Nothing in the test surface could distinguish "nested dispatch works" from "nested dispatch is impossible in the CLI runtime" because the runtime itself was mocked away.
- **CI didn't exercise the CLI path.** `run-embeds` is invoked by humans + cron in dev, not by CI. The inert-directive CLI invariant has no automated guard — it's an oral-tradition contract from `apps/admin/CLAUDE.md`.
- **Looking at R1/R2 as "different enough to diverge."** Scene + transcript backfills call `indexEditionScenes` / `indexEditionTranscript` directly because those were always plain functions. R3 felt special because the per-locale flow was already wrapped as a workflow. That perceived asymmetry was the trap — the right move was to flatten R3 to match R1/R2, not invent a new pattern.
- **The reliability persona in `ce:review` caught it** (P2, confidence 0.88), not unit tests, not the type checker, not CI. The signal came from cross-file pattern recognition: "sibling backfills don't do this, why does this one?"

## Solution

Extract a plain async service function as the shared seam. Both the single-trigger workflow and the backfill step body call the helper directly. No nested `start()`.

**Before** (`apps/admin/src/workflows/experienceEmbeddingBackfill.ts`):

```ts
async function stepEmbedTarget(target): Promise<ExperienceEmbeddingBackfillOutcome> {
  "use step"
  const startedAt = Date.now()
  try {
    const run = await start(runExperienceEmbedding, [
      { localeId: target.experienceLocaleId } satisfies ExperienceEmbeddingInput,
    ])
    const result: ExperienceEmbeddingOutput = await run.returnValue
    return { status: "succeeded", target, dimensions: result.dimensions, /* ... */ }
  } catch (err) {
    return { status: "failed", target, reason: /* ... */ }
  }
}
```

**After** — new helper at `apps/admin/src/services/embeddings.service.ts`:

```ts
export type EmbedExperienceLocaleResult = {
  localeId: string
  dimensions: number
  model: string
}

export async function embedExperienceLocale(
  localeId: string,
  options?: { prisma?: PrismaClient },
): Promise<EmbedExperienceLocaleResult> {
  const client = options?.prisma ?? defaultPrisma
  const locale = await client.experienceLocale.findUniqueOrThrow({
    where: { id: localeId },
    select: {
      id: true,
      title: true,
      metaDescription: true,
      ogTitle: true,
      ogDescription: true,
      blocks: true,
    },
  })
  const text = buildExperienceEmbeddingText(locale)
  const generated = await generateExperienceEmbedding(text)
  await writeExperienceLocaleEmbedding({
    prisma: client,
    localeId,
    embedding: generated.embedding,
    user: SYSTEM_PRINCIPAL,
  })
  return { localeId, dimensions: generated.dimensions, model: generated.model }
}
```

**After** — `runExperienceEmbedding` collapses to a thin shim:

```ts
export async function runExperienceEmbedding(
  input: ExperienceEmbeddingInput,
): Promise<ExperienceEmbeddingOutput> {
  "use workflow"
  const result = await stepEmbed(input.localeId)
  return {
    localeId: result.localeId,
    dimensions: result.dimensions,
    model: result.model,
    updated: true,
  }
}

async function stepEmbed(
  localeId: string,
): Promise<EmbedExperienceLocaleResult> {
  "use step"
  return embedExperienceLocale(localeId)
}
```

**After** — backfill step body calls the helper directly:

```ts
async function stepEmbedTarget(
  target,
): Promise<ExperienceEmbeddingBackfillOutcome> {
  "use step"
  const startedAt = Date.now()
  try {
    const result = await embedExperienceLocale(target.experienceLocaleId)
    return {
      status: "succeeded",
      target,
      dimensions: result.dimensions,
      model: result.model /* ... */,
    }
  } catch (err) {
    return {
      status: "failed",
      target,
      reason: err instanceof Error ? err.message : String(err) /* ... */,
    }
  }
}
```

Net change: one new service function, one workflow flattened to a shim, one backfill step de-nested. **Zero behavior change in production** — only the CLI invariant is restored and per-target RPC overhead is removed.

## Why This Works

A plain async service function is the right shared seam because it carries **no execution-context requirements**. It runs identically whether invoked from:

- A workflow step (durability + replay handled by the outer `"use step"`)
- A backfill loop's step body (same — the outer step is the boundary)
- A CLI shim with inert `"use workflow"` directives (just a function call, no runtime needed)
- A test (no mocking infrastructure beyond Prisma / the embedding client)

The workflow directive (`"use workflow"`) and step directive (`"use step"`) are **deployment-time decorations** on a service-layer function. They add durability and replay semantics at one boundary. Nesting `start()` inside a step means stacking two such boundaries — and the inner boundary needs the runtime that the outer boundary's CLI invocation explicitly opts out of. By contrast, calling the service helper directly keeps exactly one runtime-aware boundary per call stack, which is what both production AND the CLI shim expect.

The rule generalizes: **directives decorate; services compose.** Share work between workflows by sharing services, never by dispatching siblings.

## Prevention

### Codified rule

> **Workflow step bodies call plain service functions. They do not call `start()` on sibling workflows.** If two workflows need to share per-item work, extract a service helper and have each workflow's step body call it directly. The single-trigger workflow becomes a thin shim; the loop workflow's step body calls the helper inline.

### Positive examples (canonical sibling shape)

- `apps/admin/src/workflows/sceneEmbeddingBackfill.ts` — `stepIndexEditionLocale` calls `indexEditionScenes(prisma, {...})` directly.
- `apps/admin/src/workflows/transcriptEmbeddingBackfill.ts` — per-target step calls `indexEditionTranscript(prisma, {...})` directly.
- Post-PR-#967: `apps/admin/src/workflows/experienceEmbeddingBackfill.ts` now matches. The shared helper lives at `apps/admin/src/services/embeddings.service.ts::embedExperienceLocale`.

### Lint / test invariant (feasible)

Add a static check that scans `apps/admin/src/workflows/**/*.ts` for any function annotated with `"use step"` whose body contains a call to `start(` from `workflow/api`. Sketch:

```ts
// apps/admin/src/workflows/__tests__/step-bodies-have-no-nested-start.test.ts
it("no workflow step body calls start() on a sibling workflow", () => {
  const stepFunctions = collectStepFunctions("apps/admin/src/workflows/**/*.ts")
  for (const fn of stepFunctions) {
    expect(
      fn.body,
      `${fn.file}:${fn.name} contains nested start() — extract a service helper`,
    ).not.toMatch(/\bstart\s*\(/)
  }
})
```

A simpler ratchet: a CI grep that fails if any file under `apps/admin/src/workflows/` contains both `"use step"` and `start(` in the same function block.

### Documentation hooks

- Add a "Workflow step bodies" subsection to `apps/admin/CLAUDE.md` near the existing "Running embeds locally (R1 + R2)" section, stating the rule + cross-linking the two sibling files as positive examples.
- Cross-reference from `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — this is another instance of mocked-shape passing while runtime contract broke.

### CLI-shim invariant (preserve explicitly)

`apps/admin/CLAUDE.md`'s "Running embeds locally" contract: **workflows invoked from the CLI must not require a workflow runtime mid-loop.** Nested `start()` violates this directly. Any future workflow that the CLI shim invokes must keep its step bodies runtime-free — only the outer driver depends on directives being honored, and the CLI's inert-directive path ensures even that is just function execution.

### Test-quality blind spot to call out

**Dispatch tests that mock `start()` cannot catch nested-`start()` bugs.** If a workflow's tests rely on `vi.mock("workflow/api", () => ({ start: vi.fn(...) }))`, then by construction those tests cannot tell you whether the production runtime would accept the dispatch shape, whether the CLI runtime would refuse it, or whether the nesting is even meaningful. Add a real-invocation smoke (e.g., a tsx-runtime test that imports the workflow file and exercises the inert-directive path with a stubbed Prisma + embedding client) for any workflow that the CLI shim invokes. This is the same blind spot called out for AWS S3 NoSuchKey classification, PG `jsonb_array_elements_text` resolution, and producer-consumer report-file contracts — log it as another worked instance under the META solution `mocked-shape-vs-real-contract-discipline-20260506.md`.

## Pointers

- Parent canonical doc on inert directives: [`docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md`](workflow-dispatch-test-mode-divergence-20260421.md) — covers "test the dispatch at the consumer→workflow boundary." This doc is its corollary: the same inert-directive property creates a NEW failure mode when `start()` is nested inside a step body.
- CLI-shim invariant source: [`docs/solutions/platform/local-embed-pipeline-pattern-20260429.md`](../platform/local-embed-pipeline-pattern-20260429.md) — Rule 6 names the genus; this doc names a specific species inside a `"use step"` body.
- Sibling backfill pattern (parallel loop shape inside which the helper sits): [`docs/solutions/best-practices/bounded-parallelism-per-target-workflow-pattern-20260505.md`](bounded-parallelism-per-target-workflow-pattern-20260505.md).
- Per-target outcome contract (helper must surface typed errors back to the loop, not throw raw): [`docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md`](parallel-workflow-error-robustness-20260420.md).
- The META home for mocked-shape-vs-real-contract: [`docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`](mocked-shape-vs-real-contract-discipline-20260506.md) — this PR is another worked instance.
- Sibling-call-site discipline (the helper extraction had to update two call sites in lockstep): [`docs/solutions/best-practices/review-fix-round-2-sibling-call-site-regressions-20260421.md`](review-fix-round-2-sibling-call-site-regressions-20260421.md).
- The PR that introduced the bug: [PR #966](https://github.com/JesusFilm/forge/pull/966) (`refactor(admin): decouple experience embeddings from cms`).
- The PR that fixed it: [PR #967](https://github.com/JesusFilm/forge/pull/967) (`refactor(admin): extract embedExperienceLocale helper + ce:review fixes`).
