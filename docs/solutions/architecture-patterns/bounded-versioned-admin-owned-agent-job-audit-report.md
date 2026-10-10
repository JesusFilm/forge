---
title: "Bounded versioned Admin-owned audit reports for agent jobs"
date: 2026-08-11
category: architecture-patterns
module: "apps/mastra + apps/admin + apps/manager"
problem_type: architecture_pattern
component: database
severity: high
applies_when:
  - "A recurring agent job must explain which external evidence it evaluated and why it selected or rejected actions"
  - "Provider-derived queries or URLs need durable operator visibility under a hard privacy and retention ceiling"
  - "An operator list must remain lean while each job has comparatively heavy evidence detail"
  - "Machine decisions are immutable while later human decisions and experiment outcomes remain canonical elsewhere"
  - "The worker and durable system of record can deploy independently and must tolerate report-version skew"
related_components:
  - service_object
  - background_job
  - frontend_stimulus
  - assistant
tags:
  - seo
  - audit-log
  - versioned-report
  - lazy-detail
  - retention
  - privacy
  - admin-owned
  - graphql
---

# Bounded versioned Admin-owned audit reports for agent jobs

## Context

An agent run summary can say that recommendations were produced without
answering the operator's next questions: which provider scope was queried,
which candidates reached deterministic evaluation, why each candidate was
selected or rejected, and how the machine decision relates to later human
outcomes.

Raw provider responses and runtime traces are the wrong audit record. They are
unbounded, couple the product to provider payloads, may contain sensitive data,
and do not share the lifecycle of the canonical job. Forge therefore keeps one
strict audit projection on the canonical run while composing mutable human and
experiment outcomes from the Admin-owned ledger when the run is read.

## Guidance

### Persist an explanation, not an event stream

Every claimed live or dry-run job terminalizes with a strict, versioned report.
The report contains only allowlisted operator evidence: normalized provider
request scope, coverage, deterministic funnel totals, selected-first candidate
decisions, stable reason codes, proposal identities, and explicit omission
counts. Every collection and string is bounded, and serialized size is enforced
before and after the worker-to-Admin trust boundary.

Never persist raw provider bodies, headers, credentials, assertions, thrown
objects, signed URLs, IP addresses, direct identifiers, or model
chain-of-thought. Admin must independently parse, minimize, redact, canonicalize,
and re-fit the report rather than trusting the worker's projection.

### Make coverage and omissions truthful

Record the logical request fields needed to interpret a provider result, not
individual HTTP request bodies. For Search Console this includes property,
date window, dimensions, search type, data state, sanitized filters, configured
row cap, returned rows/pages, actual provider attempts, aggregation metadata,
incomplete-date metadata, typed status, and bounded caveats.

A capped result remains partial. Missing provider rows are unknown, never zero.
If evidence is trimmed, increment the matching omission counter so the visible
prefix cannot be mistaken for the full evaluated set.

### Preserve schema invariants through redaction

Validation before sanitization is not enough. A generic redactor can turn a
schema-valid value into an invalid one; for example, a phone-number pattern can
mistake a whole ISO date for a phone number. Treat allowlisted ISO date and
datetime values as typed scalars, keep them unchanged, and assert their exact
stored representation in the same regression test that proves sensitive free
text is still redacted.

The durable invariant belongs after the last value-changing boundary:

```ts
const validated = RunReportSchema.parse(input)
const sanitized = sanitizeRunReport(validated)
const stored = StoredRunReportSchema.parse(sanitized)
```

If a report cannot satisfy the stored schema after sanitization, fail closed
instead of committing a document that the read path can only classify as
malformed.

### Retain selected evidence first

Only candidates that reach the deterministic ranking stage need row-level
records. Earlier exclusions are mutually exclusive aggregate funnel counts.
Keep selected decisions first, followed by the largest deterministic prefix of
rejected decisions that fits. Trim lower-value detail in a fixed order and
preserve authoritative scalar totals and proposal identities.

```ts
const selected = decisions.filter((row) => row.outcome === "selected")
const rejected = decisions.filter((row) => row.outcome !== "selected")

report.queryDecisions = [...selected, ...largestFittingPrefix(rejected)]
report.omittedQueryDecisionCount += rejected.length - retainedRejected.length
```

### Keep immutable machine truth separate from mutable business truth

The completed report freezes what the machine observed and decided. Human
approvals, rejections, draft or ticket materialization, experiment activation,
and evaluation outcomes continue to evolve in their canonical ledger records.
Join those records when one run is read instead of copying mutable state into
the report.

Dry-run proposal references use an explicit would-propose disposition and do
not claim a persisted version. Live completion lets Admin replace pending
references with canonical new-or-reused proposal versions inside the fenced
transaction.

### Split lean history from lazy detail

The all-runs query selects trusted scalar columns and small report
discriminators only. It must not load report bodies. Fetch and validate one
typed report only when an operator opens a stable detail route. Represent
legacy, malformed, future-version, running, suppressed, and expired reports as
typed availability states rather than returning raw JSON or failing the whole
page.

Query text is a narrower permission than run summaries. Keep detailed evidence
behind an authenticated operator boundary; do not reuse it as a general agent
tool or expose it to model telemetry.

### Give evidence detail a shorter lifecycle than the ledger

Compact request and query detail in place after the approved short retention
window while preserving run identity, policy/schema versions, scalar totals,
coverage, suppression state, and proposal identities. The scheduler rewrite
must be bounded, oldest-first, compare-and-set, and idempotent.

Enforce expiry on reads as a second boundary. If production retention health is
not proven, terminalize the run with a summary-only state instead of retaining
new query detail. A scheduler outage must not silently extend sensitive
evidence exposure.

### Make terminal completion replay-safe

When a completion response is ambiguous, retry the byte-identical fenced
completion first. Admin can then distinguish a committed replay from a stale or
conflicting worker. If completion remains unresolved, best-effort terminalize a
sanitized failure rather than intentionally leaving the job active.

## Why This Matters

The pattern makes agent jobs explainable without turning observability into a
privacy, integrity, or performance liability. Operators see the evidence and
reasoning relevant to action, partial provider coverage remains honest, dry-run
behavior remains comparable to live behavior, and historical list cost does not
grow with detailed reports.

Keeping the machine report immutable while composing current business outcomes
also prevents a stale audit artifact from misrepresenting later approvals,
materializations, or experiment results.

## When to Apply

- A workflow needs one readable audit artifact per job.
- Provider evidence contains query text, URLs, or other sensitive values.
- Operators need exact safe request scope and deterministic decision reasons.
- Dry-run and live execution should share the same analysis path.
- Machine decisions are followed by mutable human or experiment outcomes.
- Historical summaries must stay cheap while detail loads on demand.
- Completion may be retried after an uncertain response.
- Detailed evidence needs a shorter retention policy than the business ledger.

## Examples

A Search Console request record can preserve the logical scope and coverage
interpretation without storing provider rows:

```ts
{
  propertyId,
  startDate,
  endDate,
  dimensions: ["query", "page"],
  searchType: "web",
  configuredRowCap,
  returnedRowCount,
  pageCount,
  requestCount,
  capReached,
  status: capReached ? "partial" : "available",
  caveats: capReached
    ? ["Configured row cap reached before an empty page."]
    : [],
}
```

The list/detail boundary is structural:

```text
run history -> scalar summary plus availability discriminator
run detail  -> one typed bounded report plus current ledger outcomes
```

## Related

- [Mastra SEO experiment ledger boundary](./mastra-seo-experiment-ledger-boundary.md)
- [Admin search trace retention](../platform/admin-search-trace-retention-pattern.md)
- [Operator-actionable workflow report projections](../best-practices/workflow-report-operator-actionable-projection-pattern-20260506.md)
- [Lean bulk and lazy per-item GraphQL fetch](../design-patterns/lean-bulk-lazy-per-item-graphql-fetch-20260604.md)
- [Manager automation dry-run report boundary](../integration-issues/manager-automation-dry-run-report-boundary-20260413.md)
- [Bound durable workflow step payloads before persistence](../workflow-issues/bound-durable-workflow-step-payloads-before-persistence.md)
- [Frontend page-load performance verification](../conventions/frontend-change-page-load-performance-verification.md)
- [Feature plan](../../plans/2026-08-11-002-feat-seo-run-audit-log-plan.md)
