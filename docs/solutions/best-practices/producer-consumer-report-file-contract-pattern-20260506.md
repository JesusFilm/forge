---
title: Producer-consumer report-file contract — typed-literal alignment between stacked PRs
date: 2026-05-06
tags:
  - architecture
  - cli
  - testing
  - cross-pr-contract
related:
  - docs/solutions/best-practices/workflow-report-operator-actionable-projection-pattern-20260506.md
  - docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md
  - docs/solutions/runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md
  - docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md
---

# Producer-consumer report-file contract pattern

## The shape

When a PR splits into a "produce a report" half (typically the
existing workflow gaining a `--report-out=<path>` flag) and a
"consume a report" half (typically a follow-up CLI gaining
`--from-report=<path>`), the file format becomes the **contract**
between two PRs that ship weeks apart, run in different
environments, and have NO direct compile-time linkage.

The pattern works when both halves dedupe on the same stable
identity (`{ assetId, coreId, kind }` in feat-119) and the consumer
filters on a discriminator (e.g. `--kind`). It fails — silently —
when the discriminator's literal value drifts between producer and
consumer.

## What goes wrong

feat-119 split into PR1 (producer) and PR2 (consumer). PR1 emitted:

```ts
// apps/admin/src/workflows/sceneEmbeddingBackfill.ts:632
{ assetId, coreId, kind: "scene-analysis" }
```

and:

```ts
// apps/admin/src/workflows/transcriptEmbeddingBackfill.ts:590
{ assetId, coreId, kind: "transcript" }
```

PR2 implemented `extractMissingArtifactsFromReport(report, kind)`
that filtered the report's `missingArtifacts` array. The author
wrote, in good faith:

```ts
// PR2 trigger-enrichment.ts (BEFORE fix):
const reportKindMatch = kind === "scene-analysis" ? "scene" : "transcript"
// ...later:
if (e.kind !== reportKindMatch) continue
```

The transcript half worked. The scene-analysis half silently
matched zero entries because PR1's literal was `"scene-analysis"`
(the full string), not `"scene"` as PR2 assumed.

The **test fixture used the WRONG literal** (matching PR2's
buggy expectation), so the test was self-confirming:

```ts
// PR2 test fixture (BEFORE fix):
sceneMissing: [
  { assetId: 1, coreId: "c-1", kind: "scene" }, // matches the bug
]
```

This is a **textbook mocked-shape-vs-real-contract failure** (cf.
[the META doc](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md))
applied to a cross-PR file format. The mock confirmed the buggy
filter's behavior; production data would never have matched. The
operator workflow `pnpm trigger-enrichment --from-report=<path>
--kind=scene-analysis` would have errored with `no missing
artifacts of kind=scene-analysis found` despite the report
containing them — silent under-trigger.

Caught by ce:review's correctness-reviewer with confidence 0.95
(traced producer at `sceneEmbeddingBackfill.ts:632` to consumer at
`trigger-enrichment.ts:99-100`). Fixed by dropping the rename
entirely — the literal is the same on both sides because the wire
shape (manager's URL path `/api/admin-trigger/scene-analysis`)
already uses that literal, so the kind enum is consistent
end-to-end.

## The pattern

When two stacked PRs share a file-format contract:

1. **Pick ONE source of truth for every discriminator literal.**
   Don't rename through layers — if the producer emits
   `kind: "scene-analysis"`, the consumer filters on
   `kind === "scene-analysis"`. The wire shape (URL paths, GraphQL
   enums, env variables) typically dictates the literal; align both
   sides to it.

2. **If the producer and consumer cannot share a TypeScript
   import** (e.g. they live in different deploy units, like a CMS
   workflow + a CLI in the same monorepo but transitively depending
   on different config envs), do ONE of:
   - **Re-export the literal-union type** from a shared neutral
     module both halves can import. The compile error on drift is
     the cheapest possible alarm.
   - **Add a round-trip integration test** with a real producer
     fixture (or, ideally, a snapshot of a real production report)
     that exercises the consumer's filter. Hand-rolled fixtures
     diverge from production faster than developers notice.
   - **Document the producer's literal-union exhaustively at the
     consumer's filter site** with a comment pointing at the
     producer file and line. Compile errors don't catch this; a
     human reading the consumer's filter must see "this literal
     came from $producer:$line — keep them in sync".

3. **Test fixtures must match the producer's actual literals,
   not the consumer's assumptions.** The mocked-shape-vs-real-
   contract META rule applies verbatim: every typed-discriminator
   branch needs at least one test where ONLY the right literal can
   match — otherwise deleting either side's literal wouldn't fail
   any test.

## Worked instance from feat-119 PR2 (after fix)

```ts
// apps/admin/src/scripts/trigger-enrichment.ts
//
// Wire shape: PR1 stamps the literal `kind: "scene-analysis"` on
// R1's report (apps/admin/src/workflows/sceneEmbeddingBackfill.ts:632)
// and `kind: "transcript"` on R2's (transcriptEmbeddingBackfill.ts:590).
// Both literals match the kind enum used by manager's route paths
// (`/api/admin-trigger/{scene-analysis,transcript}`) so this filter
// is a straight equality check on the requested `--kind` value.
export function extractMissingArtifactsFromReport(
  report: unknown,
  kind: Kind,
): ParsedReportItems {
  // ...
  if (e.kind !== kind) continue // straight equality, no rename
  // ...
}
```

```ts
// apps/admin/src/scripts/trigger-enrichment.test.ts
sceneMissing: [
  { assetId: 1, coreId: "c-1", kind: "scene-analysis" }, // matches PR1
]
```

The test fixture now uses the actual production literal. If PR1
ever changes its literal (e.g. `"scene"` for brevity), the
consumer test breaks immediately — exactly the alarm the
producer-consumer contract requires.

## When the pattern applies

- Workflow report → operator CLI follow-up (feat-119: PR1 → PR2)
- Webhook payload → handler in a different service
- Snapshot file → restore tool (DB exports, mapping snapshots)
- Configuration file → loader in a different release cadence

Any case where two halves of a contract live in code that doesn't
share a common type import deserves either re-exported types,
real-fixture round-trip tests, or exhaustive comments.

## See also

- [Mocked shape vs. real contract discipline (META)](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md)
  — the foundational rule this pattern is a corollary of.
- [Workflow report operator-actionable projection pattern](../best-practices/workflow-report-operator-actionable-projection-pattern-20260506.md)
  — PR1's producer-side pattern that creates the surface this
  doc consumes.
- [Admin → manager enrichment-trigger endpoint](../platform/admin-manager-enrichment-trigger-endpoint-20260506.md)
  — the cross-app trigger surface that motivated this PR's
  producer-consumer split.
