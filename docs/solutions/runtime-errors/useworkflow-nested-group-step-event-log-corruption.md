---
title: "useworkflow group workers must be single durable steps"
date: "2026-06-18"
category: runtime-errors
module: apps/admin
problem_type: runtime_error
component: background_job
symptoms:
  - "Production GraphQL trigger returned HTTP 200 with errors ['Unexpected error.'] after the transcript embedding backfill started"
  - "Railway logs showed Workflow run failed with 1 uncommitted operation(s) for the processGroup step"
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
  - step-wrapper
---

# useworkflow group workers must be single durable steps

## Problem

The production transcript embedding backfill failed after it successfully started because the grouped worker was itself a `"use step"` and then called helpers that also created durable `"use step"` operations. The production workflow runtime rejected that nested step shape as an invalid event log, so a full-corpus backfill could not complete even though local checks were green.

## Symptoms

- Admin GraphQL returned a success-shaped HTTP response with `triggerTranscriptEmbeddingBackfill: null` and `errors: ["Unexpected error."]` after roughly 103 seconds.
- Production logs showed the backfill start line, including `totalTargets=208073`, `groupCount=1452`, and `concurrency=1`, then some per-target skip/fail logs, then a workflow runtime failure.
- The runtime error included `Workflow run failed with 1 uncommitted operation(s): step "step//./src/workflows/transcriptEmbeddingBackfill//processGroup"` and `Unconsumed event in event log`.
- The earlier hotfix that coerced `TRANSCRIPT_EMBEDDING_CONCURRENCY` from string to number was necessary but separate. It fixed `p-limit` input validation, then exposed this deeper production-only workflow composition bug.

## What Didn't Work

- **Stopping after the env coercion hotfix.** The first failure was real: Railway env vars arrive as strings and `p-limit` requires a number. After that fix deployed, the retry reached the group-processing phase and failed for a different reason.
- **Keeping `processGroup` as an inline step inside the workflow file.** The worker needed Node-only services such as transcript source resolution, S3 artifact reads, and Mastra launch code. Making the helper plain inside the workflow file risked dragging those imports into workflow compilation, while leaving it as a nested step corrupted the production event log.
- **Trusting local workflow-body tests alone.** Vitest runs the function body in an inert-directive mode; it does not replay the durable event log the same way production does. The nested shape only failed once the compiled workflow runtime executed it.

## Solution

Move the grouped worker into one external step wrapper and make that wrapper the only durable boundary for per-group work.

```ts
// apps/admin/src/workflows/transcriptEmbeddingBackfill.ts
import { stepProcessTranscriptEmbeddingGroup } from "./_steps/process-transcript-embedding-group"

const settled = await Promise.allSettled(
  groups.map((group) =>
    limit(() =>
      stepProcessTranscriptEmbeddingGroup(group, input.mode ?? "idempotent"),
    ),
  ),
)
```

```ts
// apps/admin/src/workflows/_steps/process-transcript-embedding-group.ts
export async function stepProcessTranscriptEmbeddingGroup(
  group: BackfillGroup,
  mode: MastraTranscriptEmbeddingMode,
): Promise<BackfillOutcome[]> {
  "use step"

  const outcomes: BackfillOutcome[] = []
  for (const target of group.targets) {
    const subtitleResolution = await resolveSubtitleTranscriptSource(
      prisma,
      target,
    )
    // Resolve subtitle first, fall back to manager transcript source, then
    // launch Mastra and return typed per-target outcomes.
  }
  return outcomes
}
```

The guard test is intentionally simple and source-level because this is a structural workflow constraint:

```ts
it("uses one external group step so production workflow steps are not nested", async () => {
  const source = await readFile(
    new URL("./transcriptEmbeddingBackfill.ts", import.meta.url),
    "utf8",
  )

  expect(source).toContain("stepProcessTranscriptEmbeddingGroup")
  expect(source).not.toMatch(/\basync function processGroup\b/)
})
```

## Why This Works

Production sees one durable operation for each active group: `stepProcessTranscriptEmbeddingGroup`. Inside that boundary the code can call plain async helpers, load subtitle or manager transcript sources, launch Mastra, and emit typed outcomes without creating child workflow steps.

The split also keeps the workflow file import graph cleaner. `transcriptEmbeddingBackfill.ts` owns orchestration, grouping, bounded parallelism, and reporting. `_steps/process-transcript-embedding-group.ts` owns Node-only group work and can import Prisma, S3-backed manager artifact readers, subtitle resolvers, and Mastra client services without forcing those details into the top-level workflow body.

## Prevention

- Treat grouped backfill workers as one durable step boundary. Do not create child `"use step"` functions from inside a per-group `"use step"` body.
- If a group worker needs Node-only services, put it in an external `_steps/*` wrapper and import that single wrapper from the workflow file.
- Add a structural guard test when fixing this class of bug. It should assert the workflow calls the external step wrapper and no longer defines the old inline grouped step.
- Build or smoke the production workflow enough to exercise workflow manifest and step discovery. Local unit tests are still useful, but they cannot prove production event-log validity.

## Related

- [Workflow step bodies call plain helpers, never nested start](../best-practices/workflow-step-body-calls-service-not-sibling-workflow-20260517.md)
- [Bounded parallelism pattern for admin per-target useworkflow loops](../best-practices/bounded-parallelism-per-target-workflow-pattern-20260505.md)
- [useworkflow directives are inert in tests but enforced in production](../best-practices/workflow-dispatch-test-mode-divergence-20260421.md)
- [Per-parent child memoization via loadedArtifact parameter widening](../best-practices/per-parent-child-memoization-loadedartifact-pattern-20260505.md)
