---
title: "AWS S3 NoSuchKey classification — typed error name first, Code legacy second, regex backstop"
date: 2026-05-06
problem_type: runtime_error
component: storage
root_cause: code_bug
resolution_type: code_fix
severity: high
module: apps/admin
tags:
  - admin
  - aws-sdk
  - s3
  - typed-errors
  - error-classification
  - manager-artifacts
  - embed-backfill
  - feat-119
related_prs: []
related_features:
  - feat-119
related:
  - "docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md"
  - "docs/solutions/best-practices/per-parent-child-memoization-loadedartifact-pattern-20260505.md"
  - "docs/solutions/best-practices/verify-infra-writes-via-independent-read-path-20260420.md"
  - "docs/solutions/database-issues/pgvector-bulk-insert-on-conflict-pattern-20260505.md"
  - "docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md"
  - "docs/solutions/best-practices/workflow-report-operator-actionable-projection-pattern-20260506.md"
---

# AWS S3 NoSuchKey classification — typed error name first, Code legacy second, regex backstop

## Problem

A service that classifies S3 read failures into "missing artifact" vs
"transport error" buckets cannot rely on the error MESSAGE — only on
the typed surface AWS SDK v3 actually exposes. The trap that surfaced
this rule:

```ts
// BEFORE (apps/admin/src/services/manager-artifacts.service.ts)
const message = error instanceof Error ? error.message : String(error)
if (/not found|missing|no such key|ENOENT|NoSuchKey/i.test(message)) {
  throw new ManagerArtifactError("artifact_missing", ...)
}
throw new ManagerArtifactError("artifact_read_failed", ...)
```

AWS SDK v3 emits the textual message **`"The specified key does not
exist."`** for a missing object — none of the regex tokens
(`not found`, `missing`, `no such key`, `ENOENT`, `NoSuchKey`) match
that exact phrase. Result: every NoSuchKey fell through to the
`artifact_read_failed` branch and surfaced in the workflow report as
`failed`. The feat-115 smoke run emitted **4,169 spurious `failed`
outcomes** (vs 1,780 succeeded) — every single one was the same
"upstream pipeline hasn't run yet" condition that should have been
classified as `skipped` and surfaced as a list of upstream gaps to
enrich, not as an alarm-worthy failure count.

## Symptoms

- Workflow report's `failed` count is dominated by the same error
  message, repeated thousands of times. Operators learn to ignore
  `failed` and miss real errors when they happen.
- `report.skipped` stays dishonestly always-zero, hiding the upstream
  data-readiness signal the workflow was supposed to surface.
- Adding a new outcome variant downstream (e.g., feat-118's
  `skipped_unchanged`) breaks immediately because the `skipped`
  bucket is being incorrectly populated only by a narrow set of
  edge-case errors.
- Ops dashboards built on `report.succeeded / skipped / failed`
  triple are unreliable for any decision more nuanced than
  "is anything moving."

## What didn't work

- **Adding more strings to the regex.** Matching `"does not exist"`
  would have caught the 2026 wording but rewords historically:
  AWS has rephrased the textual message at least once. A future SDK
  upgrade (or an S3-compatible provider that words it differently)
  re-introduces the bug.
- **Wrapping the workflow's per-target catch in another regex.**
  Pushes the same fragility one layer up; doesn't fix the contract
  the service-layer error is supposed to honor.
- **Adding a new error code variant** (`code: "s3_object_missing"`).
  The workflow doesn't care WHY an artifact is missing — it cares
  whether a missing artifact is a real failure (operator action
  needed) or an upstream gap (operator can ignore or trigger
  enrichment). Multiple codes for the same outcome bucket would
  force every workflow site to handle them all with no behavioral
  difference.

## Solution

A three-tier classifier helper inside the service module. Tier 1 is
the AWS SDK v3 typed surface, Tier 2 is the legacy `Code` field that
some older SDK paths and some S3-compatible providers still emit,
Tier 3 is a tightened regex backstop for non-AWS sources (local
fallback `ENOENT`, future alt-storage backends, test fixtures).

```ts
function isArtifactMissing(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    // Tier 1 — AWS SDK v3 typed surface. Stable across message rewordings.
    //   `name === "NoSuchKey"`  → GET miss
    //   `name === "NotFound"`   → HEAD miss (HeadObject vs GetObject)
    const name = (error as { name?: unknown }).name
    if (name === "NoSuchKey" || name === "NotFound") return true
    // Tier 2 — legacy `Code` field. Some older SDK paths and some
    // S3-compatible providers (MinIO, Backblaze B2, R2 in some
    // configs) still surface the error code on `Code` rather than
    // `name`. Cheap to keep; survives provider drift.
    const code = (error as { Code?: unknown }).Code
    if (code === "NoSuchKey" || code === "NotFound") return true
  }
  // Tier 3 — regex backstop for non-AWS sources. TIGHT — narrower
  // than the legacy `/not found|missing|no such key|ENOENT|NoSuchKey/i`
  // it replaced. Bare `missing` was dropped because it over-matched
  // ("missing field 'foo'" in unrelated bug messages got demoted to
  // skipped); `no such key` and `NoSuchKey` were dropped because the
  // typed branch above covers AWS verbatim.
  const message = error instanceof Error ? error.message : String(error)
  return /not found|does not exist|ENOENT/i.test(message)
}
```

Wire it at the service boundary:

```ts
try {
  bytes = await readManagerArtifact(assetId, "scene-analysis", "json")
} catch (error) {
  if (isArtifactMissing(error)) {
    throw new ManagerArtifactError("artifact_missing", ..., error)
  }
  throw new ManagerArtifactError("artifact_read_failed", ..., error)
}
```

The workflow's `instanceof ManagerArtifactError && error.code ===
"artifact_missing"` branching stays UNCHANGED — the typed-error
contract is the same; only the assignment logic changed. Per
[parallel-workflow-error-robustness-20260420.md](../best-practices/parallel-workflow-error-robustness-20260420.md).

## Why this works

- **Typed surface is stable across SDK upgrades.** AWS doesn't rename
  `error.name` lightly — it's a documented, machine-readable contract.
  Message text is documentation, not contract.
- **Tier ordering is defense-in-depth, not redundancy.** Each tier
  catches a real source the others miss: typed name covers AWS SDK v3
  verbatim, legacy `Code` covers older SDKs / S3-compatible providers,
  regex covers Node fs `ENOENT` and any future non-AWS backend.
- **Regex tightening removes a real bug.** Bare `missing` matched any
  error message containing "missing field" / "missing argument" /
  "missing required parameter" — those are bugs, not upstream gaps,
  and silently demoting them to skipped masks real failures from
  operators.

## Tests must throw the REAL typed shape

The single most important rule for testing this classifier:

```ts
// ✅ Correct — exercises the typed Tier 1 branch
readArtifactSpy.mockRejectedValueOnce(
  Object.assign(new Error("The specified key does not exist."), {
    name: "NoSuchKey",
  }),
)

// ❌ Wrong — passes the regex backstop (Tier 3) without touching
// Tier 1. Looks like a NoSuchKey test; isn't.
readArtifactSpy.mockRejectedValueOnce(new Error("NoSuchKey: object not found"))
```

A generic `new Error("NoSuchKey: ...")` passes today's regex (matches
`not found`) and would also pass any future regex that includes the
literal token `NoSuchKey` — but the typed branch is never exercised.
A real production failure where the SDK sets `name` correctly but the
message is reworded would silently misclassify, with no test failure.
This is the same trap captured in the SQL-shape mocked-vs-real-DB
lesson at
[pgvector-bulk-insert-on-conflict-pattern-20260505.md](../database-issues/pgvector-bulk-insert-on-conflict-pattern-20260505.md)
and the verify-via-real-read-path discipline at
[verify-infra-writes-via-independent-read-path-20260420.md](../best-practices/verify-infra-writes-via-independent-read-path-20260420.md):
mocked-shape coverage proves the BRANCH SHAPE works, real-shape
coverage proves the PRODUCTION CONTRACT works.

For this classifier specifically, both apps/admin's
`manager-artifacts.service.test.ts` (unit) AND a local smoke against
manager's real S3 with a known-missing assetId are needed before
shipping any change to the classifier itself.

## Where this applies

- **Any service in the repo that reads from S3 and classifies
  read failures into operator-facing buckets.** Today: admin's
  `readSceneAnalysisArtifact` and `readEmbeddingsArtifact`. Future
  candidates: web's asset uploads, mobile's asset downloads, any new
  cms → admin migration phase that introduces an S3 read.
- **Any service that branches on AWS SDK error type via message
  regex.** The same trap applies to `AccessDenied`, `Throttling`,
  `RequestTimeout`, etc. — typed `name` is always more reliable than
  message tokens.

## Cross-references

- `apps/admin/src/services/manager-artifacts.service.ts` — canonical
  application of this pattern; the `isArtifactMissing` helper lives
  here.
- `apps/admin/src/services/manager-artifacts.service.test.ts` —
  classifier-coverage describe blocks for both R1 and R2 paths,
  exercising all six error shapes (typed GET miss, typed HEAD miss,
  legacy code shape, ENOENT, unrelated transport, regex-tightness
  probe).
- `apps/admin/src/workflows/sceneEmbeddingBackfill.ts` and
  `transcriptEmbeddingBackfill.ts` — workflow consumers that branch on
  the typed `ManagerArtifactError` shape this pattern enforces.
- `docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md`
  — the canonical typed-error rule (literal-union `code`, exhaustive
  `switch + never`, tests-must-throw-real-class). This pattern extends
  the same surface to a new error origin (AWS SDK v3 typed errors).
- `docs/solutions/best-practices/per-parent-child-memoization-loadedartifact-pattern-20260505.md`
  §4 — the group-level cascade that emits L `skipped { artifact_missing }`
  outcomes per missing `(video, edition)`. The new
  `report.missingArtifacts` projection in feat-119 PR1 dedupes this
  cascade by `assetId`.
- `docs/solutions/database-issues/pgvector-bulk-insert-on-conflict-pattern-20260505.md`
  — feat-117's "mocked SQL-shape passes, real PG fails" lesson.
  Generalized: mocked tests prove SHAPE, real surface proves CONTRACT.
  Same discipline applies to AWS error shapes.

## See also (in `apps/admin/CLAUDE.md`)

- "Scene embeddings (R1 of admin migration playbook)" — R1 workflow's
  `readSceneAnalysisArtifact` consumer.
- "Transcript embeddings (R2 of admin migration playbook)" — R2
  workflow's `readEmbeddingsArtifact` consumer.
