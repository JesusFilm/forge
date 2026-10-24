---
title: "Mastra offline search eval orchestration boundary pattern"
date: "2026-05-27"
last_updated: "2026-06-02"
category: "architecture-patterns"
module: "apps/mastra, apps/admin"
problem_type: "architecture_pattern"
component: "service_object"
severity: "high"
applies_when:
  - "Mastra needs to evaluate Admin search quality without entering the live request path"
  - "A first baseline must be captured before promoted regression truth exists"
  - "Generated or trace-derived eval candidates may inform reports but must remain exploratory"
  - "Human-reviewed search eval candidates need sanitized durable regression truth"
  - "Offline reports need durable comparison artifacts without exposing raw trace text or secrets"
related_components:
  - "apps/mastra"
  - "apps/admin"
tags:
  - "mastra"
  - "search-eval"
  - "offline-eval"
  - "baseline-artifacts"
  - "admin-contracts"
  - "trace-redaction"
  - "judge-calibration"
  - "reports"
related_features:
  - "feat-138"
  - "feat-139"
  - "feat-140"
  - "feat-142"
  - "feat-155"
related:
  - "docs/solutions/platform/mastra-embedding-workflow-ownership-pattern.md"
  - "docs/solutions/platform/admin-search-trace-retention-pattern.md"
  - "docs/solutions/platform/admin-search-query-labeling-pattern.md"
  - "docs/solutions/integration-issues/mastra-eval-workflow-local-dev-contracts.md"
  - "docs/solutions/integration-issues/offline-workflow-batches-must-respect-consumer-write-limits.md"
  - "docs/solutions/best-practices/external-client-retry-parity-in-runner-fanout-20260512.md"
---

# Mastra Offline Search Eval Orchestration Boundary Pattern

## Context

Search evals need to compare production search behavior without becoming part
of production search. Admin remains the source of live search reality:
query-time embedding, ranking, pgvector storage, trace retention, and public
REST/GraphQL response shapes. Mastra owns the offline eval system: prompt sets,
baseline capture, comparison runs, judge orchestration, and report artifacts.

Feat-139 is the first baseline from scratch, not a migration of a trusted old
Admin baseline. The older Admin eval harness is useful as reference material
for judge calibration, pairwise comparison, search-client retry behavior, and
report categories, but it should not define durable regression truth.

Feat-140 adds the human-promotion step that turns seed, generated, trace, and
user-submitted candidates into durable regression truth. The ownership split
does not change: Admin owns storage, sanitization policy, retention, review
metadata, and regression loading; Mastra owns the operator-facing workflow and
must call Admin through authenticated HTTP only.

Mastra's native Evaluation area is the intended operator destination for this
domain. The installed Mastra packages expose Dataset, Scorer, and Experiment
APIs and storage tables, but feat-139 artifacts remain a backing layer until a
ticket actually writes native records. Do not tell operators that a baseline or
comparison appears in Overview, Datasets, Scorers, or Experiments unless native
Evaluation records were created.

## Guidance

Keep the offline eval domain local to Mastra. Define seed prompt cases,
baseline artifacts, comparison reports, judge outcomes, cost metadata, and
artifact validation under `apps/mastra/src/services/offline-search-eval/`.
Register a Mastra workflow and a service-bearer route for operators, but do not
import `apps/admin`, `apps/manager`, or `apps/auth` from Mastra.

Capture baselines from seed prompts only. The seed prompt set should be
committed, versioned, and ministry-representative: examples like `Bible
Project`, `Jesus`, `Who is Jesus?`, `videos for teens`, `resources for
parents`, `new believer`, `small group Bible study`, and locale or audience
intent prompts. Refuse to write the named baseline if any seed search has a
transient or failed Admin search result. A partial baseline looks convenient,
but it poisons every future comparison.

Treat generated, trace-derived, seed, and user-submitted candidates as pending
material until a human promotes them. Pending rows can be listed, inspected,
edited with sanitized fields, rejected, or archived through Admin contracts,
but they must not enter named baselines, comparison denominators, regression
gates, or native Mastra Datasets before promotion.

Make promotion an Admin-owned state transition, not a Mastra-side file write.
The promoted row should carry sanitized query text, expected-result notes,
sanitized source anchors, reviewer identity, review/promoted timestamps,
sanitization status, and safe run context. Mastra should read promoted rows
through Admin's candidate HTTP contract when building native eval datasets or
offline baseline artifacts; Admin must not reintroduce file-backed regression
truth under `apps/admin`.

Keep user-submitted source payloads out of exposed candidate provenance.
Submitting a prompt can store the prompt text as pending review input, but
free-form submission notes, source claims, vectors, tokens, or provider payloads
should not be copied into `labelProvenance`, `sourceAnchors`, or any field that
the review surface returns. Reviewers add safe anchors and expected-result
context through the sanitized edit contract.

Trace-derived generated candidates need an even stricter rule: they may
contribute retained counts and redacted source-mix metadata, but they should
not be searched, judged, serialized into reports, or promoted with raw query
text. Admin may store raw trace query text only on generated `TRACE` candidate
rows, bounded by the trace `retentionExpiresAt` and purge path, so reviewers can
inspect and sanitize while the raw trace is still allowed to exist. Redact at
both boundaries:

- Admin candidate listing should null `queryText`, clear hint/anchor/judge
  metadata, and return only a redacted provenance marker for `TRACE` rows.
- Mastra report serialization should keep trace-derived generated outcomes
  redacted, with no raw query, public/raw hash, source payload, vector, bearer,
  provider prompt, or scoring debug field.
- Native Evaluation and baseline artifacts should receive only promoted,
  sanitized text.

Use Admin HTTP as the search execution primitive. Add internal, authenticated,
bounded Admin routes when Mastra needs new read behavior:

- `POST /api/internal/search-eval/search` runs Admin search without recording a
  production trace and without changing public `/api/search` or GraphQL shapes.
- `GET /api/internal/search-eval/candidates` returns bounded staged candidates
  through a review-safe projection.
- `GET /api/internal/search-eval/candidates/:id` returns review-safe detail.
- `PATCH /api/internal/search-eval/candidates/:id` edits sanitized review
  fields only; server-owned status must use action routes.
- `POST /api/internal/search-eval/candidates/:id/promote` promotes sanitized
  truth.
- `POST /api/internal/search-eval/candidates/:id/reject` and
  `/archive` move bad or duplicate rows to terminal non-gate states.
- Existing trace and catalog context contracts remain Admin-owned and
  bearer-gated.

When retiring the old Admin harness, separate implementation names from wire
contracts. Delete file-backed runners, fixtures, baseline truth, judge helpers,
and package scripts from Admin once Mastra owns offline eval execution. Keep
surviving Admin services as flat HTTP-contract helpers instead of under a
`search-eval/` harness directory. Do not rename existing unversioned response
literals just to match new internal module names: for example, a catalog-context
locale profile can continue returning `source: "harness"` until a versioned or
dual-accepted contract moves every caller together.

Rename optional harness-era environment variables only when the variable is
scoped to the same deployable and tests lock the migration down. The Admin
trace classifier can use a clearer `OPENROUTER_QUERY_CLASSIFIER_MODEL` because
it is an Admin-local optional feature, while Mastra judge configuration remains
Mastra-owned. Add negative regression tests for removed Admin keys and package
scripts so the retired CLI cannot quietly reappear.

Make report artifacts boring and strict. Store them under Mastra's configured
artifact root, validate safe names and schema shape before read/write, enforce
caps on case counts and result sizes, and write via temp file plus atomic
rename. Include enough metadata to explain a run later: prompt-set version,
query-set source, baseline name, Admin search URL sanitized of credentials and
query strings, search mode, result limit, content type, judge model,
calibration status, cost estimate, timings, locale mix, prompt-source mix,
generated-candidate behavior, and search configuration mismatch.

Include an explicit native Evaluation projection in each report while the
integration is artifact-only. The projection should name the intended Dataset,
Scorer, and Experiment, but keep native IDs as `null` and mark the status as
`custom_artifact_only` until code has actually created Mastra Evaluation
records. This gives feat-142 a stable bridge without creating a misleading
operator experience in Studio.

For promoted truth, document the future Dataset item shape but keep native
writes deferred until feat-142 creates real records. A promoted item should map
to workflow input (`query`, `locale`, source, search options), ground truth
(`expectedResultNotes`, `sourceAnchors`), and safe metadata (`candidateId`,
sanitization status, reviewer identity, reviewed/promoted timestamps, and safe
run context). Native Dataset, Scorer, and Experiment IDs stay `null` until the
sync job actually populates them.

Validate both sides of the report contract at runtime. The workflow output
schema should expose the report shape, and artifact writes should reject
malformed report payloads before the file is persisted. TypeScript types alone
are not enough for a JSON artifact that future operators and agents will read
outside the current process.

Separate judge uncertainty from search quality. Pairwise A/B and swapped
judgments can collapse into wins, losses, ties, both-irrelevant, and judge
disagreements. Provider failures are a separate `judge-failure` category, not
a tie and not ordinary disagreement. Exclude judge disagreements and provider
failures from net win-rate style denominators so reports do not manufacture
confidence.

Do not let compare failures appear green. If current seed search or judge calls
fail during comparison, write the report artifact first, then return a typed
failure with `reportPath`. Operators get the evidence, while Studio and
service callers see a red/non-200 outcome instead of treating a degraded
comparison as production-ready.

Keep retry parity across every Admin HTTP client used in the eval runner.
Search and candidate-list reads should retry transport, `429`, and `5xx`
failures with bounded backoff and honor Admin's `Retry-After` window. A report
that silently dropped candidate reads or seed searches because one client did
not retry is worse than a loud failed run.

Treat trace provenance as server-owned. Admin should reject non-trace
candidates that carry trace-looking source anchors, trace labels, or
trace-sample generation model stamps. This does not prove arbitrary text is
not from a trace, but it closes the obvious laundering path while feat-140
defines human promotion and stronger provenance semantics.

## Why This Matters

The eval runner should be allowed to fail loudly without affecting users. Admin
search outages, rate limits, bad artifacts, missing judge configuration, or
provider failures should produce offline failure reasons and report categories,
not degraded public search availability.

The boundary also protects future regression truth. Before feat-140, generated
and trace-derived candidates are useful signals, not approved test cases.
Reports should make those signals easy to review later without silently
promoting them into gates.

## When to Apply

- Building a Mastra workflow that evaluates Admin production behavior from the
  outside.
- Capturing the first baseline before a promoted human-reviewed query set
  exists.
- Adding new eval reports that consume production traces, generated candidates,
  or Admin search output.
- Reviewing changes that might move live query embedding, retrieval, or public
  response shaping into Mastra.

## Examples

Baseline capture should be seed-only and all-or-nothing:

```ts
const seedCases = seedPromptsForLocales(locales)
const searchedCases = await searchSeedCases(seedCases)

if (searchedCases.some((caseResult) => caseResult.searchFailure)) {
  return {
    ok: false,
    reason: "admin_read_failed",
    retryable: true,
  }
}

await artifactStore.writeBaseline(baselineName, {
  kind: "baseline",
  cases: searchedCases,
  metadata,
})
```

Trace candidate responses should be allowlisted, not partially redacted:

```ts
if (candidate.source === "trace") {
  return {
    ...candidate,
    queryText: null,
    expectedResultHints: [],
    sourceAnchors: [],
    labelProvenance: { source: "trace", redacted: true },
    judgeSummary: null,
  }
}
```

Promotion should overwrite the raw candidate query with sanitized truth so a
promoted trace-derived row can outlive raw-trace retention:

```ts
await prisma.searchEvalCandidate.updateMany({
  where: {
    id,
    promotionStatus: "GENERATED",
  },
  data: {
    promotionStatus: "PROMOTED",
    queryText: sanitizedQueryText,
    sanitizedQueryText,
    sanitizedExpectedResultNotes,
    sanitizedSourceAnchors,
    sanitizationStatus: "SANITIZED",
    reviewerIdentity,
    reviewedAt: now,
    promotedAt: now,
    promotionRunContext: safeRunContext,
  },
})
```

Route body caps should protect chunked requests too. Checking only
`Content-Length` is insufficient because chunked bodies may omit it:

```ts
const reader = request.body.getReader()
let totalBytes = 0

while (true) {
  const { done, value } = await reader.read()
  if (done) break
  totalBytes += value.byteLength
  if (totalBytes > MAX_BODY_BYTES) {
    await reader.cancel().catch(() => undefined)
    return payloadTooLarge()
  }
}
```

## Code Anchors

- Mastra workflow route:
  `apps/mastra/src/mastra/workflows/offline-search-eval.ts` and
  `apps/mastra/src/mastra/index.ts`.
- Mastra candidate review workflow:
  `apps/mastra/src/mastra/workflows/search-eval-candidate-review.ts`.
- Mastra eval domain:
  `apps/mastra/src/services/offline-search-eval/runner.ts`,
  `artifacts.ts`, `judge.ts`, `report.ts`, `seed-prompt-set.ts`, and
  `types.ts`.
- Native Mastra Evaluation APIs:
  `apps/mastra/node_modules/@mastra/core/dist/datasets/index.d.ts`,
  `apps/mastra/node_modules/@mastra/core/dist/evals/base.d.ts`, and
  `apps/mastra/node_modules/mastra/dist/commands/api/route-metadata.generated.d.ts`.
- Mastra Admin HTTP clients:
  `apps/mastra/src/services/admin-search-eval-client.ts`.
- Admin no-trace eval search:
  `apps/admin/src/app/api/internal/search-eval/search/route.ts`.
- Admin candidate read/write contract:
  `apps/admin/src/app/api/internal/search-eval/candidates/route.ts` and
  `apps/admin/src/app/api/internal/search-eval/candidates/[id]/route.ts`,
  action routes under `candidates/[id]/`, and
  `apps/admin/src/services/search-eval-candidates.ts`.
- Trace sampling contract:
  `apps/admin/src/app/api/internal/search-traces/sample/route.ts`.

## Related

- `docs/solutions/platform/mastra-embedding-workflow-ownership-pattern.md`
- `docs/solutions/platform/admin-search-trace-retention-pattern.md`
- `docs/solutions/platform/admin-search-query-labeling-pattern.md`
- `docs/solutions/integration-issues/mastra-eval-workflow-local-dev-contracts.md`
- `docs/solutions/integration-issues/offline-workflow-batches-must-respect-consumer-write-limits.md`
- `docs/solutions/best-practices/external-client-retry-parity-in-runner-fanout-20260512.md`
