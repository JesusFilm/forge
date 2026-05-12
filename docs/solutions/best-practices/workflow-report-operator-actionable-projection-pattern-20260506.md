---
title: "Operator-actionable structured projections in workflow reports — deduped/sorted lists alongside count triples"
date: 2026-05-06
problem_type: best_practice
component: background_job
root_cause: inadequate_documentation
resolution_type: workflow_improvement
severity: medium
module: apps/admin
tags:
  - workflow
  - workflow-report
  - operator-experience
  - cascade
  - dedup
  - useworkflow
  - reporting
  - best-practice
related_features:
  - feat-119
related_prs: []
related:
  - "docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md"
  - "docs/solutions/best-practices/per-parent-child-memoization-loadedartifact-pattern-20260505.md"
  - "docs/solutions/best-practices/bounded-parallelism-per-target-workflow-pattern-20260505.md"
  - "docs/solutions/runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md"
---

# Operator-actionable structured projections in workflow reports

## Problem

Fan-out workflows that classify per-target outcomes into a
`succeeded/skipped/failed` count triple regularly accumulate
**duplicate signals** that mean the same thing for the operator. R1 of
admin's embed-backfill is the canonical case: when manager hasn't yet
produced a `(video, edition)`'s `scene-analysis.json`, the group-level
cascade emits **L `skipped { reason: "artifact_missing" }` outcomes
per missing group** — one for each of the L locales the workflow was
about to index. The count triple shows `skipped: L`, the outcome list
shows L identical entries, and the operator has to deduplicate by
hand to see the unique set of upstream gaps to act on.

The cascade is correct — every per-target outcome is preserved so
dashboards built on `outcomes[].durationMs`, locale, and
`(target.videoId, target.locale)` keep working. The problem is that
the report is missing a **second view of the same data**: the
operator-actionable, deduped, sorted set of upstream gaps.

## Symptoms

- `outcomes[]` contains L identical (modulo locale/language) entries
  per missing group, giving the false impression of L distinct
  failures.
- Operators copy/paste the outcome list into a spreadsheet and dedupe
  by `target.cmsVideoId` (or whatever the stable id is) by hand
  before they can act.
- Downstream tools that want to "trigger remediation for the missing
  set" need a deduped list — every consumer reinvents the dedup.
- Adding a new outcome status (e.g., `skipped_unchanged` for content-
  hash skips) silently dilutes `skipped` further; the count gets
  fuzzier, the outcome list gets noisier, the operator-action signal
  gets weaker.

## What didn't work

- **Dedup at the cascade**. Tempting — emit one outcome per missing
  group instead of L — but breaks the per-target outcome contract
  documented in
  `docs/solutions/best-practices/per-parent-child-memoization-loadedartifact-pattern-20260505.md`.
  Dashboards that count outcomes per locale would silently report
  fewer outcomes than targets. The cascade's L-outcome shape is
  load-bearing for the dashboard contract.
- **Telling the operator to dedupe in jq / a downstream tool**.
  Works once. Doesn't compound. Each new consumer re-implements the
  dedup logic with subtly different invariants (which field is the
  stable id? sort order? include `failed` outcomes too?).
- **Adding a new outcome status to express "this is an upstream gap,
  the operator should enrich it"**. Conflates the bucket question
  ("did this target succeed or not?") with the action question
  ("what should the operator do next?"). The bucket triple stays
  clean if the action signal lives in a separate, parallel field.

## Solution

**Add a deduped, sorted projection of operator-actionable items as a
first-class field on the workflow report**, alongside the existing
`succeeded/skipped/failed` count triple and `outcomes[]` list. Dedup
at projection time, not in the cascade.

```ts
// In the workflow's report shape:
export type MissingArtifact = {
  readonly assetId: number // stable id for the operator to act on
  readonly coreId: string // human-readable cross-reference
  readonly kind: "scene-analysis" | "transcript" // what kind of action
}

export type SceneEmbeddingBackfillReport = {
  // ... existing fields (mappingGeneratedAt, totalTargets,
  //     localeFilter, outcomes, succeeded, skipped, failed) unchanged
  readonly missingArtifacts: ReadonlyArray<MissingArtifact>
}

// Pure projection at report-assembly time:
function deriveMissingArtifacts(
  outcomes: readonly BackfillOutcome[],
): MissingArtifact[] {
  const byAssetId = new Map<number, MissingArtifact>()
  for (const outcome of outcomes) {
    if (outcome.status !== "skipped") continue
    if (outcome.reason !== "artifact_missing") continue
    if (byAssetId.has(outcome.target.cmsVideoId)) continue // first-seen wins
    byAssetId.set(outcome.target.cmsVideoId, {
      assetId: outcome.target.cmsVideoId,
      coreId: outcome.target.coreId,
      kind: "scene-analysis",
    })
  }
  return Array.from(byAssetId.values()).sort((a, b) => a.assetId - b.assetId)
}
```

The `outcomes[]` list still contains L per-target entries (cascade
contract preserved). The new `missingArtifacts` field contains 1
entry per unique upstream gap, sorted by stable id, ready to pipe
into a remediation tool.

## Why this works

- **No new state**. The projection is a pure function over the
  already-collected `outcomes[]`. No second source of truth, no
  consistency-with-outcomes question. Re-running the workflow
  produces a deterministic projection from the same outcome shape.
- **Cascade contract intact**. Dashboards that read
  `outcomes[].locale` keep working. The L-outcome cascade is the
  source data; the projection is one specific view of it.
- **One filter, one map, one dedup, one sort**. All four invariants
  are visible in one ~10-line helper. A future maintainer can reason
  about the shape without understanding the cascade internals.
- **Stable ordering compounds downstream**. Sort-ascending by stable
  id means the projection round-trips through JSON serialization +
  re-parsing identically across runs. PR2 of feat-119
  (`pnpm trigger-enrichment --from-report=<path>`) consumes this
  field directly; deterministic ordering removes a class of "why is
  the trigger seeing different IDs each run?" debugging surface.
- **Filter excludes `failed` outcomes**. A `failed` outcome is a
  real failure for the operator to investigate, NOT an upstream gap
  to enrich. The filter is the contract. If a future regression
  starts including `failed` outcomes in the projection, the operator
  re-triggers enrichment for things that are actually broken — much
  worse than the original cascade-duplication problem.

## When this pattern applies

- Any workflow whose report includes a `succeeded/skipped/failed` (or
  similar) count triple AND accumulates duplicate signals in one of
  those buckets via a cascade, group-level fan-out, or per-target
  retry pattern.
- Especially valuable when the duplicate signal corresponds to an
  **operator action** the workflow itself doesn't take (e.g.,
  trigger upstream enrichment, file a ticket, surface in a UI).

## When NOT to use this pattern

- Workflows where every outcome is genuinely unique (no cascade, no
  per-target fan-out producing parallel entries). The projection
  reduces to a 1:1 copy of the filtered outcomes — pointless.
- Workflows where the operator action is "look at the count, no
  individual items needed." E.g., a heartbeat probe whose only
  signal is `succeeded > 0`.
- Workflows where the projection field would expose data the
  consumer-facing surface intentionally hides. Keep the field local
  to the workflow report (typescript) AND the trigger mutation's
  JSON-scalar return; never expose it on a public read endpoint
  without an explicit decision.

## Prevention checklist (when designing or reviewing a new fan-out workflow)

1. **Does the cascade emit L outcomes per failure group?** If yes,
   you have the duplication problem. Plan the projection field
   alongside the report shape from day one — adding it later is a
   contract change.
2. **What's the stable id?** The dedup-by-id design only works if
   each projection entry has a single field that uniquely identifies
   the operator action target. For embed-backfill, that's
   `assetId` (the cms video PK). For other workflows: pick the field
   that the remediation tool indexes on.
3. **What's the kind/category discriminator?** When multiple
   workflows feed the same remediation surface (R1 + R2 both feed
   feat-119 PR2's `triggerManagerEnrichment`), each entry needs a
   `kind` literal so the consumer dispatches the right action.
4. **Sort-ascending by stable id.** Operators piping the JSON into a
   trigger expect deterministic order. Map iteration order is
   insertion-order-stable in V8 but the explicit sort is the
   contract.
5. **`outcomes[]` filter is the contract.** Document which outcomes
   feed the projection. For `missingArtifacts` it's
   `skipped { reason: "artifact_missing" }` ONLY. Adding a new
   outcome status without updating the filter silently changes the
   projection's semantics.
6. **Test the dedup.** Unit-test cases: zero outcomes → `[]`,
   N-locales-of-one-missing-group → 1 entry, two distinct groups →
   2 entries sorted ascending, mixed missing+present → only missing,
   `failed` outcomes excluded.
7. **JSON round-trip the field.** If a downstream consumer reads
   the report via stdout/file, lock in the JSON shape with a
   round-trip test against a fixture.
8. **Always emit `[]` not `undefined`** when the projection is
   empty. A non-nullable list lets consumers iterate without a
   nil-check.

## Cross-references

- `docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md`
  — typed-error rule that distinguishes which outcomes belong in the
  projection's filter. The classifier produces typed `ManagerArtifactError({ code: "artifact_missing" })`,
  the workflow's per-target catch routes that to
  `skipped { reason: "artifact_missing" }`, and the projection
  dedupes those.
- `docs/solutions/best-practices/per-parent-child-memoization-loadedartifact-pattern-20260505.md`
  §4 — the cascade SOURCE this projection dedupes. The cascade
  emits L outcomes per missing group precisely so dashboards see
  every locale-level data point; the projection collapses those L
  copies into one entry per unique parent.
- `docs/solutions/best-practices/bounded-parallelism-per-target-workflow-pattern-20260505.md`
  — sibling pattern about preserving positional alignment between
  inputs and per-target outcomes. The same outcome list this pattern
  projects from is constructed via `pLimit + Promise.allSettled`.
- `docs/solutions/runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md`
  — canonical example consumer. The classifier this projection
  filters on uses the typed-error helper documented there.

## Worked instance — feat-119 PR1

- `apps/admin/src/workflows/sceneEmbeddingBackfill.ts`
  (`SceneEmbeddingBackfillReport.missingArtifacts`,
  `deriveMissingArtifacts`)
- `apps/admin/src/workflows/transcriptEmbeddingBackfill.ts`
  (`TranscriptEmbeddingBackfillReport.missingArtifacts`)
- Tests in `*EmbeddingBackfill.test.ts` cover all the prevention-
  checklist scenarios (zero, single-group dedup, multi-group sort,
  failed-excluded, mixed runs).
- Local smoke evidence: `apps/admin/.tmp/smoke-pr1-*.json` shows the
  cascade emits 12 outcomes per missing `(2_0-Crushing, edition)`
  group across 12 locales, while `missingArtifacts.length === 1`.
