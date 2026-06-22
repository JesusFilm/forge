---
title: "useworkflow group fanout must run inside one durable step"
date: "2026-06-18"
last_updated: "2026-06-20"
category: runtime-errors
module: apps/admin
problem_type: runtime_error
component: background_job
symptoms:
  - "Production GraphQL trigger returned HTTP 200 with errors ['Unexpected error.'] after the transcript embedding backfill started"
  - "Railway logs showed Workflow run failed with 1 uncommitted operation(s) for processGroup, then for stepProcessTranscriptEmbeddingGroup"
  - "Workflow runtime reported Unconsumed event in event log and called the event log corrupted or invalid"
  - "Local unit tests and type checks passed because they exercised the workflow body without the production event-log runtime"
root_cause: wrong_api
resolution_type: code_fix
severity: high
related_components:
  - apps/admin/src/workflows/transcriptEmbeddingBackfill.ts
  - apps/admin/src/workflows/_steps/process-transcript-embedding-group.ts
  - apps/admin/src/workflows/transcriptEmbeddingBackfill.test.ts
tags:
  - admin
  - useworkflow
  - workflows
  - transcript-embeddings
  - backfill
  - event-log
  - single-step
---

# useworkflow group fanout must run inside one durable step

## Problem

The production transcript embedding backfill failed after it successfully started because the workflow body dynamically called the same `"use step"` group worker once per `(video, edition)` group. The production workflow runtime gave those repeated calls the same step identity and rejected the resulting event log, so a full-corpus backfill could not complete even though local checks were green.

## Symptoms

- Admin GraphQL returned a success-shaped HTTP response with `triggerTranscriptEmbeddingBackfill: null` and `errors: ["Unexpected error."]` after roughly 103 seconds.
- Production logs showed the backfill start line, including `totalTargets=208073`, `groupCount=1452`, and `concurrency=1`, then some per-target skip/fail logs, then a workflow runtime failure.
- The runtime error included `Workflow run failed with 1 uncommitted operation(s): step "step//./src/workflows/transcriptEmbeddingBackfill//processGroup"` and `Unconsumed event in event log`.
- Moving `processGroup` to an external `stepProcessTranscriptEmbeddingGroup` wrapper changed the failing step id but did not fix the class: production then failed with `step "//./src/workflows/_steps/process-transcript-embedding-group//stepProcessTranscriptEmbeddingGroup"`.
- The earlier hotfix that coerced `TRANSCRIPT_EMBEDDING_CONCURRENCY` from string to number was necessary but separate. It fixed `p-limit` input validation, then exposed this deeper production-only workflow composition bug.

## What Didn't Work

- **Stopping after the env coercion hotfix.** The first failure was real: Railway env vars arrive as strings and `p-limit` requires a number. After that fix deployed, the retry reached the group-processing phase and failed for a different reason.
- **One external step per group.** Moving the per-group worker to `_steps/process-transcript-embedding-group.ts` kept Node-only imports out of the workflow file, but the workflow still called the same `"use step"` function from `groups.map(...)`. Production rejected the repeated dynamic step events.
- **Trusting local workflow-body tests alone.** Vitest runs the function body in an inert-directive mode; it does not replay the durable event log the same way production does. The repeated-step shape only failed once the compiled workflow runtime executed it.

## Solution

Move the whole grouped fanout into one external step wrapper. The workflow calls `stepProcessTranscriptEmbeddingGroups(...)` exactly once. That plural step owns `pLimit + Promise.allSettled` internally and calls a plain per-group helper.

```ts
// apps/admin/src/workflows/transcriptEmbeddingBackfill.ts
import { stepProcessTranscriptEmbeddingGroups } from "./_steps/process-transcript-embedding-group"

const outcomes = await stepProcessTranscriptEmbeddingGroups(
  groups,
  input.mode ?? "idempotent",
  concurrency,
)
```

```ts
// apps/admin/src/workflows/_steps/process-transcript-embedding-group.ts
async function processTranscriptEmbeddingGroup(
  group: BackfillGroup,
  mode: MastraTranscriptEmbeddingMode,
): Promise<BackfillOutcome[]> {
  // Plain helper. No "use step" directive.
}

export async function stepProcessTranscriptEmbeddingGroups(
  groups: readonly BackfillGroup[],
  mode: MastraTranscriptEmbeddingMode,
  concurrency: number,
): Promise<BackfillOutcome[]> {
  "use step"

  const limit = pLimit(concurrency)
  const settled = await Promise.allSettled(
    groups.map((group) =>
      limit(() => processTranscriptEmbeddingGroup(group, mode)),
    ),
  )

  return flattenGroupOutcomes(settled, groups)
}
```

The guard test is intentionally simple and source-level because this is a structural workflow constraint:

```ts
it("uses one external groups step so production workflow steps are not dynamically repeated", async () => {
  const source = await readFile(
    new URL("./transcriptEmbeddingBackfill.ts", import.meta.url),
    "utf8",
  )

  expect(source).toMatch(/stepProcessTranscriptEmbeddingGroups\(\s*groups,/)
  expect(source).not.toMatch(/\bstepProcessTranscriptEmbeddingGroup\(/)
  expect(source).not.toMatch(/Promise\.allSettled\(\s*groups\.map/)
  expect(source).not.toMatch(/\basync function processGroup\b/)
})
```

## Why This Works

Production sees one durable operation for the whole fanout: `stepProcessTranscriptEmbeddingGroups`. Inside that boundary the code can use ordinary async control flow, call a plain per-group helper many times, load subtitle or manager transcript sources, launch Mastra, and emit typed outcomes without creating repeated workflow step events.

The split also keeps the workflow file import graph cleaner. `transcriptEmbeddingBackfill.ts` owns mapping, enumeration, grouping, the start log, and reporting. `_steps/process-transcript-embedding-group.ts` owns Node-only fanout work and can import Prisma, S3-backed manager artifact readers, subtitle resolvers, Mastra client services, and `p-limit` without forcing those details into the top-level workflow body.

## Prevention

- Do not call the same `"use step"` function dynamically from
  `groups.map(...)` or any other parallel fanout in workflow scope.
- Keep repeated in-step group work as plain helpers when the whole workload can
  finish comfortably inside the worker step runtime budget.
- If one plural step grows too large for production, split the workload into
  target-bounded sequential step calls at workflow scope. Keep each step's
  internal fanout small, and use workflow-level `sleep()` for long waits.
- If the fanout needs Node-only services, put the plural wrapper in an external `_steps/*` module and import only that single wrapper from the workflow file.
- Add a structural guard test when fixing this class of bug. It should assert the workflow calls the plural external step wrapper once and no longer performs `Promise.allSettled(groups.map(...step...))` in workflow scope.
- Build or smoke the production workflow enough to exercise workflow manifest and step discovery. Local unit tests are still useful, but they cannot prove production event-log validity.

Update on 2026-06-20: the enriched transcript backfill outgrew the single
plural step and failed at the Graphile worker boundary around 300 seconds.
That newer fix keeps the event-log lesson here, but changes the shape from
"one giant plural step" to "sequential target-bounded plural steps." See
[Transcript embedding backfills need cancellable resume batches](../workflow-issues/transcript-embedding-backfill-cancel-and-resume-operations.md)
for the operational pattern.

## Related

- [Workflow step bodies call plain helpers, never nested start](../best-practices/workflow-step-body-calls-service-not-sibling-workflow-20260517.md)
- [Bounded parallelism pattern for admin per-target useworkflow loops](../best-practices/bounded-parallelism-per-target-workflow-pattern-20260505.md)
- [useworkflow directives are inert in tests but enforced in production](../best-practices/workflow-dispatch-test-mode-divergence-20260421.md)
- [Per-parent child memoization via loadedArtifact parameter widening](../best-practices/per-parent-child-memoization-loadedartifact-pattern-20260505.md)
