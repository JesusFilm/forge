---
title: "Parallel workflow error robustness: typed-error classification + Promise.allSettled for per-item best-effort"
category: "best-practices"
problem_type: "best_practice"
component: "background_job"
root_cause: "inadequate_documentation"
resolution_type: "workflow_improvement"
severity: "medium"
module: "apps/admin"
tags:
  - workflow
  - error-handling
  - promise-allsettled
  - typed-errors
  - useworkflow
  - backfill
  - best-practice
date: "2026-04-20"
related_prs:
  - "JesusFilm/forge#798"
related_docs:
  - "docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md"
  - "docs/solutions/platform/backfill-worker-pattern-manager-20260407.md"
---

# Parallel workflow error robustness

Two failure modes that appear in every fan-out workflow and both have the
same fix shape: use the type system, not strings. Surfaced during
ce:review of R1 scene-embedding backfill (PR #798); generalizes to any
workflow that (a) fans out N sub-operations and (b) classifies failures
into buckets for reporting.

## Problem

Fan-out workflows — backfill jobs, bulk indexers, per-target
enrichers — routinely make two mistakes that look harmless in isolation
and compound at scale:

1. **`Promise.all` over per-item work**, so a single transient failure
   aborts the entire batch even though the remaining items could have
   succeeded.
2. **Error-message regex classification** (`if (/not found/i.test(err.message))`)
   to decide skipped-vs-failed outcomes, which silently misclassifies
   unrelated errors whose messages happen to match.

Both produce workflows that look robust in happy-path tests but behave
unexpectedly in production — one turns partial failure into total
failure, the other turns real failures into silent skips.

## Symptoms

- A single 429 or transient 5xx from an embedding/LLM provider aborts
  the whole edition-locale target, even though the next scene's call
  would have succeeded.
- Prisma P2025 `Record not found` errors silently downgraded to
  "skipped" because the error message happens to contain "not found".
- Workflow report shows `succeeded=0, skipped=N` in a run where the
  truth is `failed=5, succeeded=N-5`, hiding real outages from the
  operator.
- Comment in the code reads "one scene failing is fine, we keep going"
  while the implementation does the exact opposite (`Promise.all`
  reject propagates).

## What Didn't Work

- **Wrapping the whole step in a try/catch**: catches the error at the
  workflow level, but by then the Promise.all has already poisoned the
  batch. The step still completes with zero writes.
- **Matching error messages with regex**: fragile to wording changes,
  over-matches, and couples the workflow to prose that the service
  layer is free to change.
- **Retrying the whole step**: amplifies cost on every retry (re-pays
  for all the successful-this-run embeddings) and doesn't narrow the
  failure signal.

## Solution

### 1. Promise.allSettled for per-item best-effort fan-out

When each sub-operation is independently meaningful and a single
failure shouldn't abort the batch, use `Promise.allSettled` and
partition the results. Count skipped items explicitly and surface
them in the report so partial progress is visible.

```typescript
// BEFORE: one failure aborts the whole edition-locale target
const prepared = await Promise.all(
  artifact.scenes.map(async (scene) => {
    const sourceText = scene.description.trim()
    if (!sourceText) throw new SceneIndexError("empty_description", ...)
    const generated = await generateEmbedding(sourceText)
    return { scene, sourceText, generated }
  }),
)

// AFTER: per-scene best-effort; skipped items explicit in the result
const results = await Promise.allSettled(
  artifact.scenes.map(async (scene) => {
    const sourceText = scene.description.trim()
    const generated = await generateEmbedding(sourceText)
    return { scene, sourceText, generated }
  }),
)

const prepared: Array<...> = []
let scenesSkipped = 0
for (let i = 0; i < results.length; i += 1) {
  const result = results[i]!
  if (result.status === "fulfilled") {
    prepared.push(result.value)
  } else {
    scenesSkipped += 1
    console.error(JSON.stringify({
      event: "scene_embed_failed",
      sceneIndex: artifact.scenes[i]!.sceneIndex,
      reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
    }))
  }
}
```

**Keep synchronous pre-validation separate.** Errors that reject the
whole batch intentionally (duplicate scene index, empty descriptions,
schema violations) stay in a synchronous pass _before_ the fan-out.
`Promise.allSettled` is for "independent I/O that might flake", not
for swallowing input-validation bugs.

### 2. Typed-error classification via `instanceof` + discriminant

When a workflow classifies errors into skipped/failed buckets, branch
on a typed error class + its `code` discriminant — never on the error
message.

```typescript
// BEFORE: regex-match on error.message — brittle, over-matches
try {
  await indexEditionScenes(...)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (/artifact_missing/.test(message) || /not found/i.test(message)) {
    return { status: "skipped", reason: "artifact_missing", ... }
  }
  return { status: "failed", reason: message, ... }
}

// AFTER: instanceof + discriminant
try {
  await indexEditionScenes(...)
} catch (error) {
  if (
    error instanceof ManagerArtifactError &&
    error.code === "artifact_missing"
  ) {
    return { status: "skipped", reason: "artifact_missing", ... }
  }
  const reason = error instanceof Error ? error.message : String(error)
  return { status: "failed", reason, ... }
}
```

The error class must carry a literal-union `code` field for this to
work:

```typescript
export class ManagerArtifactError extends Error {
  constructor(
    readonly code:
      | "artifact_missing"
      | "artifact_invalid"
      | "artifact_read_failed",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "ManagerArtifactError"
  }
}
```

**Tests must throw the real error class.** A test that throws
`new Error("artifact_missing: ...")` passes the old regex path but
fails the new `instanceof` path — if the workflow test rejects with a
plain `Error`, you're testing the fiction, not the behavior. Use
`vi.mocked(indexer).mockRejectedValueOnce(new ManagerArtifactError("artifact_missing", "..."))`
so the discriminator is exercised honestly.

### 3. Exhaustive switch on outcome unions

If you accumulate outcomes into a discriminated union for reporting,
use `switch` with a `never` fallthrough so a new variant fails to
compile until every reducer handles it.

```typescript
type BackfillOutcome =
  | { status: "succeeded"; ... }
  | { status: "skipped";   ... }
  | { status: "failed";    ... }

for (const outcome of outcomes) {
  switch (outcome.status) {
    case "succeeded": succeeded += 1; break
    case "skipped":   skipped += 1;   break
    case "failed":    failed += 1;    break
    default: {
      const _exhaustive: never = outcome
      throw new Error(`Unhandled variant: ${JSON.stringify(_exhaustive)}`)
    }
  }
}
```

Chained `if / else if / else` defeats this check and silently routes a
future "retried" variant into the last branch.

## Why This Works

- **Promise.allSettled honors the per-item contract.** One item's
  failure is the workflow's unit of bad-news; the batch survives so
  operators see partial progress as partial, not nothing.
- **`instanceof` + `code` is a machine-checkable contract.** Renaming
  an error message in the service layer no longer silently changes
  workflow behavior. TypeScript narrows `error.code` to the literal
  union inside the `instanceof` branch, so a typo fails to compile.
- **Exhaustive `switch` with `never` binds every future union
  expansion to a code review.** You can't add a new outcome status
  without touching the reducers.

## Prevention

- When writing a fan-out workflow, ask: "if one item fails, should the
  batch complete for the rest?" If yes → `Promise.allSettled` with
  explicit skipped count. If no → `Promise.all` and document why.
- When writing a new typed error class, always include a literal-union
  `code` field and wire the classification against it, not the message.
  One class can distinguish many outcomes via `code`.
- In workflow tests, reject with the _real_ error class, not a generic
  `new Error("code: message")`. Otherwise the classification path
  isn't actually tested.
- Discriminated unions get `switch` + `never`. `if / else if / else`
  is a maintenance trap.

## Prevention: tests

```typescript
// Assert the real typed error is classified as skipped.
vi.mocked(indexEditionScenes).mockRejectedValueOnce(
  new ManagerArtifactError(
    "artifact_missing",
    "scene-analysis artifact not found for assetId=1",
  ),
)
// Run workflow, assert report.skipped === 1.

// Assert an unrelated "not found" error is NOT demoted to skipped.
vi.mocked(indexEditionScenes).mockRejectedValueOnce(
  new Error("Record to update not found."), // Prisma P2025 shape
)
// Run workflow, assert report.failed === 1 and report.skipped === 0.
```

## Related

- `docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md` —
  R1 of admin migration playbook; first concrete application of these
  patterns in `apps/admin`.
- `docs/solutions/platform/backfill-worker-pattern-manager-20260407.md`
  — earlier backfill-worker patterns (claim-then-start, output-table
  as progress tracker). These complement the current doc: this one
  covers per-item robustness, that one covers workflow durability.
- `docs/brainstorms/2026-04-19-admin-migration-playbook-requirements.md`
  — parent migration playbook (R1–R9) that will exercise these patterns
  repeatedly as additional work streams (R2 transcript embeddings,
  R4 hybrid search, R6 personalization ingest) follow the same shape.
