---
title: "Dead invariant checks from sibling-port refactors: when a runtime assertion's input changes semantics, the check can become a no-op that still carries its original persuasive-looking error code"
last_updated: 2026-04-22
problem_type: best_practice
component: service_object
root_cause: logic_error
resolution_type: workflow_improvement
severity: medium
module: apps/admin
tags:
  - refactor
  - port-forward
  - dead-code
  - invariants
  - review-fix
  - admin-migration
  - sibling-port
related_features:
  - feat-009
  - feat-041
related:
  - "docs/solutions/best-practices/review-fix-round-2-sibling-call-site-regressions-20260421.md"
  - "docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md"
  - "docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md"
  - "docs/solutions/platform/admin-transcript-embeddings-vector-reuse-pattern.md"
date_learned: 2026-04-22
---

## Problem

When a module is ported from a sibling (R1 → R2, or one product area
to another), a runtime assertion can survive the port syntactically
while losing its semantic content. The assertion still compiles, the
error class still lists the original code variant, a ported test
still "covers" the case, but the guard itself is dead: its predicate
checks a construction-guaranteed invariant rather than the
data-driven invariant the sibling was protecting. The dead guard is
corrosive — it advertises an enforced rule it cannot enforce, and
three independent code-review passes can each flag a different
symptom of it while none names the real bug.

## Symptoms

Observed on PR #828 (R2 transcript embeddings in `apps/admin`,
2026-04-22) when admin's new transcript indexer was ported from the
R1 scene-embedding indexer:

### The ported check

```ts
// apps/admin/src/services/transcript-embedding.service.ts (R2, as shipped)
function assertNoDuplicateChunkIndexes(
  chunks: EmbeddingsResult["chunks"],
): void {
  const seen = new Set<number>()
  for (let i = 0; i < chunks.length; i += 1) {
    if (seen.has(i)) {
      throw new TranscriptIndexError(
        "duplicate_chunk_index",
        `chunk_index ${i} appears more than once in the artifact`,
      )
    }
    seen.add(i)
  }
}
```

`i` is monotonically increasing in a plain `for` loop, so
`seen.has(i)` is never true. The throw cannot fire.

### The sibling it was ported from

```ts
// apps/admin/src/services/scene-embedding.service.ts (R1)
function assertNoDuplicateSceneIndexes(scenes: readonly SceneAnalysis[]): void {
  const seen = new Set<number>()
  for (const scene of scenes) {
    if (seen.has(scene.sceneIndex)) {
      throw new SceneIndexError(
        "duplicate_scene_index",
        `scene_index ${scene.sceneIndex} appears more than once in the artifact`,
      )
    }
    seen.add(scene.sceneIndex)
  }
}
```

R1 iterates `scene.sceneIndex` — a value read from the upstream
artifact. Scenes can duplicate. The guard is real.

### The review pattern

Three code-review passes each caught a different symptom of the same
bug:

- **Correctness reviewer** noticed the loop was structurally dead
  (confidence 0.95).
- **Testing reviewer** noticed no test exercised the
  `duplicate_chunk_index` path (confidence 0.95).
- **Stack-specific TS reviewer** flagged the error-code union carrying
  an unreachable variant as an API-surface smell (testing_gap 0.95).

Each symptom had a natural-sounding individual fix ("add coverage",
"extract a helper", "rename the variant"). Only the first reviewer
named the real root cause: the check itself could never fire.

## What Didn't Work

- **Porting the R1 file verbatim and relying on compile-time type
  checking.** The assertion's signature is identical across the two
  modules, so TypeScript had nothing to say. The semantic difference
  (iterating an artifact field vs iterating a loop counter) lives
  below the type system.
- **Writing tests alongside the ported code.** The R2 test file
  never included a `duplicate_chunk_index` case, because there was no
  way to construct input that would hit the branch. The missing test
  looked like a coverage gap — but the real signal was that the
  branch itself was unreachable.
- **Trusting the tagged-union error class to document the real API.**
  `TranscriptIndexError.code` advertised `duplicate_chunk_index` as
  one of five variants the service could emit. The type said "this
  can happen"; the code said "it can't." Consumers reading the type
  alone would plan for an impossible case.

## Solution

Delete the dead check and the unreachable error variant. The
invariant it claimed to enforce is now documented as a construction
guarantee — a shape the code's author must preserve, not a runtime
condition the code can police.

### The fix

```ts
// apps/admin/src/services/transcript-embedding.service.ts (R2, post-fix)
export class TranscriptIndexError extends Error {
  constructor(
    readonly code:
      | "forbidden"
      | "missing_cms_video_id"
      | "dimension_mismatch"
      | "empty_chunk_text",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "TranscriptIndexError"
  }
}

// Chunk index uniqueness is not asserted: the indexer derives
// chunkIndex from the loop counter rather than the opaque
// `chunk.chunkId`, so duplicates are impossible by construction.
// Uniqueness of the upstream `chunkId` is not a contract admin
// enforces — it's manager-side bookkeeping that the artifact may
// reuse across re-chunks.
```

Three places were cleaned up in lockstep:

1. **Service module.** Function body deleted; error-code variant
   dropped from the union; a narrative comment explains _why_ the
   check is absent so a future contributor doesn't port the ancestor
   again.
2. **Workflow comment.** The catch-block's per-error-variant list
   still enumerated `duplicate_chunk_index` as a reachable
   `TranscriptIndexError.code`. Trimmed to match the new union.
   (This one was caught by round-2 review scoped to the fix commit
   diff — see the related doc on sibling-call-site regressions.)
3. **Plan doc.** Three references to the retired variant remained in
   the canonical plan at `docs/plans/2026-04-22-002-...`. Revised to
   preserve the historical reasoning alongside the current design, so
   a future reader sees WHY the check was dropped rather than being
   tempted to re-introduce it.

## Why This Works

The underlying principle: **an invariant that is guaranteed by code
structure is not the same kind of object as an invariant that must
be checked at runtime.** A runtime guard protects a module from
inputs; a structure guarantee is a property of the module's own
construction. Conflating the two is how a port-forward refactor
loses semantic content: the sibling had a data-driven check, the
port has a counter-driven loop, and the check is mechanically
retained long after its motivating constraint is gone.

Three properties make this failure mode especially sticky:

1. **Types don't catch it.** The function signature and the error
   union look correct. TypeScript has no way to detect "this branch
   is unreachable given the caller's loop shape."
2. **Tests don't catch it.** You cannot write a test that triggers a
   branch with no satisfying input. The missing test looks like a
   coverage gap when it's really a correctness indicator.
3. **Code review easily fans out.** A single root cause can surface
   as multiple symptoms (dead branch, missing coverage, unreachable
   type variant). Each symptom invites its own small fix. Only a
   reviewer who traces the control flow to the caller catches the
   real cause.

## Prevention

### For the author

When porting a runtime assertion from a sibling module, **re-derive
the invariant before copying the check.** Ask:

1. What data field was the sibling asserting over?
2. Does the equivalent field exist in the new module, and does it
   have the same semantics? (Same name is not the same semantics.)
3. Is the new module's version of the field data-driven, or is it
   structure-driven (a loop counter, a row id generated locally,
   etc.)?
4. If structure-driven: **delete the check.** Replace with a doc
   comment on the calling code explaining that the invariant is
   structural.

The "port the test alongside the code" habit works against you here.
A ported test reinforces the illusion that the ported check is
meaningful. Port the test only after confirming the underlying check
still enforces the same invariant.

### For reviewers

When three reviewers each flag a different symptom of the same code
— a dead branch, a missing test, an unreachable type variant — pause
and ask whether they're all describing one root cause. Synthesis
quality during `ce:review` depends on this check: the merge step
should notice that "flag the code, flag the test, flag the type" is
a triple pointing at a single underlying hollow.

If you see a "no-op if" in a review diff (`if (condition-that-can't-be-true)`),
treat it as a correctness finding, not a style nit. Code that
advertises an invariant it cannot enforce is more dangerous than
missing coverage on a live branch — you're optimizing for a test
that can't be written.

### For the review-fix loop

The round-2 pass here caught the stale workflow comment and stale
plan-doc references that the round-1 fix left behind. This is the
exact sibling-call-site-regression pattern documented in
`docs/solutions/best-practices/review-fix-round-2-sibling-call-site-regressions-20260421.md`:
round-1 fixes that remove a concept tend to leave stale references
one grep away. The fix commit above was accompanied by a
`grep duplicate_chunk_index /workspace` sweep that surfaced both
stale references. Without the scoped round-2 review, the fix would
have shipped half-done.

**Apply the grep sweep after any round-1 fix that removes a
publicly-named concept (error code, permission key, enum variant,
exported type).** The grep is trivially cheap and catches the class
of drift that round-1 reviewers cannot see because they're focused on
the diff they were given, not the residue the diff leaves behind.

### For the next sibling port

Future R3–R9 stages of the admin migration playbook
(`docs/brainstorms/2026-04-19-admin-migration-playbook-requirements.md`)
will repeat this port pattern. Treat every ported runtime assertion
as suspect until the author documents the invariant's semantic
source in a comment. The comment cost is a line or two; the
alternative is another dead check.

## Verification

- `rg -n 'duplicate_chunk_index' apps/ packages/ docs/` — zero hits
  after the fix. Full-repo grep is the definition-of-done for any
  fix that retires a named concept.
- The `TranscriptIndexError.code` union compiles against its call
  sites with only the reachable variants. A synthetic attempt to
  throw the retired variant fails at compile time (stronger than
  runtime).
- The workflow's catch-block comment lists only currently-reachable
  `TranscriptIndexError` codes. A future contributor reading the
  comment will believe the error story it narrates.

## Appendix: preserving error-class exports through `vi.mock`

A small secondary learning from the same fix: the round-1 fix replaced
a fake error class in a test file with the real `TranscriptIndexError`
imported from the service module. The test file already had a module
mock on that same service. Naive mocking drops all exports, including
the error class the test now needs. The idiom that preserves
error-class exports alongside a function mock:

```ts
vi.mock("@/services/transcript-embedding.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/services/transcript-embedding.service")
    >()
  return {
    ...actual, // keep the real TranscriptIndexError class reachable
    indexEditionTranscript: vi.fn(async () => ({
      editionId: "edition-stub",
      language: "en",
      chunksIndexed: 3,
      embeddingsWritten: 3,
      chunksPruned: 0,
      model: "openai/text-embedding-3-small",
      dimensions: 1536,
    })),
  }
})
```

This differs from the `vi.hoisted` pattern in
`docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md`:
`vi.hoisted` is for mocks that need the spy to exist at hoist time;
`importOriginal` is for mocks that need the other exports to stay
reachable from the mocked module. Use `importOriginal` when the
production code and the test both need the same error class for
`instanceof` branching or typed-error assertions.

## Related

- `apps/admin/src/services/scene-embedding.service.ts` — the R1
  sibling with a genuine `assertNoDuplicateSceneIndexes` check
  (iterates `scene.sceneIndex`, which can duplicate).
- `apps/admin/src/services/transcript-embedding.service.ts` — the R2
  module this learning describes. Post-fix, the dead check is gone
  and a comment documents why.
- `docs/solutions/best-practices/review-fix-round-2-sibling-call-site-regressions-20260421.md`
  — the meta-pattern for catching stale references left behind by
  round-1 fixes. This learning is a concrete instance of that
  pattern's value.
- `docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md`
  — another learning about port-forward hazards: there, a directive
  that is inert in tests but enforced in production creates a
  category of bug that passes CI and crashes in prod. Sibling
  category.
- `docs/solutions/platform/admin-scene-embeddings-indexer-pattern.md`
  — R1 pattern being ported in the admin-migration playbook.
- `docs/solutions/platform/admin-transcript-embeddings-vector-reuse-pattern.md`
  — R2 pattern where this dead check originally landed.
- `docs/brainstorms/2026-04-19-admin-migration-playbook-requirements.md`
  — the playbook (R1–R9) that will continue producing sibling ports.
