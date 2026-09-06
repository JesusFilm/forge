---
title: Deterministic dual-signal monitoring for localized Watch soft 404s
date: 2026-09-04
category: architecture-patterns
module: apps/mastra + apps/admin + apps/manager + packages/watch-url-policy
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - An explicit analytics failure event is absent or partially deployed while an older deterministic signal already contains useful evidence
  - A recurring monitor must separate valid public routes from typo traffic using canonical admission data
  - Provider evidence needs bounded HTTP corroboration before becoming an operator alert
  - Workflow execution and the operator dashboard must not share storage
  - Classification is a closed evidence problem that should remain deterministic and auditable
related_components:
  - background_job
  - database
  - authentication
  - frontend
tags:
  - watch-route
  - soft-404
  - ga4
  - mastra
  - route-manifest
  - dual-signal
  - alert-ledger
  - live-probe
---

# Deterministic dual-signal monitoring for localized Watch soft 404s

## Context

Public Watch “page not found” traffic is not one clean signal. The production
investigation that led to this pattern found no rows for the exact GA4
`page_not_found` event, while the localized not-found page-title signal under
`/watch/*` contained 9,701 views across 8,734 rows. Watch also serves some
missing pages as soft 404s, so HTTP status alone cannot distinguish a real page
from not-found HTML.

This is an evidence-reconciliation problem, not a language-model judgment
problem. The implementation is a scheduled Mastra workflow with structured
inputs and outputs, not a registered agent
(`apps/mastra/src/mastra/workflows/watch-route-alerts.ts:27`). Mastra collects
and validates evidence, Admin owns durable alert truth, and Manager reads an
authenticated projection.

## Guidance

### Use a workflow when the decisions are finite evidence invariants

Use deterministic orchestration when classification depends on a finite route
grammar, an authoritative manifest, provider-quality flags, and HTTP
observations. This keeps schedules, leases, retries, completeness, and lifecycle
transitions reproducible. The Watch monitor is registered with a daily schedule
and never imports a model or agent
(`apps/mastra/src/mastra/workflows/watch-route-alerts.ts:582`).

Execution mode should also be explicit. `off` performs no provider or Admin
work, `dry_run` records bounded diagnostics without changing alert lifecycle,
and `live` performs the durable control loop
(`apps/mastra/src/mastra/workflows/watch-route-alerts.ts:303`).

### Keep both telemetry lanes during instrumentation migration

Treat the preferred event and the existing observable behavior as separate
evidence lanes until measured coverage proves that a cutover is safe. The
explicit lane reads `page_not_found` with event counts. The fallback lane reads
the complete generated catalog of localized not-found titles with page views.
Both are restricted to `/watch/*`
(`apps/mastra/src/services/google-analytics-client.ts:293`).

Do not add unlike counts. Aggregation preserves explicit event count when that
lane is present and otherwise preserves page views; active users use the
maximum rather than being summed across overlapping rows
(`apps/mastra/src/mastra/workflows/watch-route-alerts.ts:229`). The report keeps
`EVENT_COUNT` and `PAGE_VIEWS` visibly distinct
(`apps/mastra/src/mastra/workflows/watch-route-alerts.ts:272`).

Completeness is part of the evidence. Thresholding, provider “other” rows,
response caps, request-budget exhaustion, mixed title-chunk failures, or
inconsistent property timezones make a successful lane partial; failure of
every title chunk fails the lane
(`apps/mastra/src/services/google-analytics-client.ts:374`). A complete zero-row
lane is useful evidence; an incomplete zero-row lane is unknown and must not
close an alert.

### Generate localized fallback evidence from the owning catalogs

Do not hand-maintain translated title strings. The generator reads every Web
message catalog, requires a nonblank `WatchNotFound.metadataTitle`, deduplicates
the values, and writes a shared artifact
(`packages/watch-url-policy/scripts/generate-not-found-titles.mjs:17`). A
Web-side parity test rebuilds the set independently and compares it exactly, so
translation changes cannot silently stale the GA filter
(`apps/web/src/lib/watch-not-found-titles.test.ts:17`).

Chunk the generated set to provider limits instead of weakening the match. The
GA client uses 50-title chunks. Mixed success is partial evidence; failure of
every chunk fails the lane
(`apps/mastra/src/services/google-analytics-client.ts:18`).

### Separate syntax, exact admission, and plausibility

Route syntax and route existence answer different questions. The shared policy
first rejects paths outside Watch, reserved subtrees, unsafe characters,
noncanonical `.html` shapes, repeated or trailing slashes, and unsupported
segment counts (`packages/watch-url-policy/src/routes.ts:91`). A syntactically
valid page remains only a candidate until it is checked against the Admin-owned
Watch Route Manifest.

For a supported-route failure, require the exact manifest relationship:
content plus language, parent plus episode plus default-English availability,
or parent plus episode plus the requested language
(`apps/mastra/src/mastra/workflows/watch-route-alerts.ts:109`). A route that is
not exactly admitted may still be plausible only when the relevant combination
is known—for example, known content with known language, or a known
parent/episode pair. Random combinations remain aggregate-only noise
(`apps/mastra/src/mastra/workflows/watch-route-alerts.ts:157`).

Use only fresh route truth. The workflow rejects stale or implausibly
future-dated manifests before doing provider work
(`apps/mastra/src/mastra/workflows/watch-route-alerts.ts:392`).

### Probe only normalized, allowlisted public paths

The live probe is corroborating evidence, not a crawler. It builds the URL from
the configured origin, verifies the exact host and safe DNS resolution, uses a
bounded GET with manual redirects, and never persists a response body
(`apps/mastra/src/services/watch-route-probe.ts:4`). Only 404/410 is a hard
missing response. The probe labels an allowlisted 2xx HTML response as
`healthy_html`; only the recovery path accepts that result as recovery evidence,
after a complete GA window omitted the route. Redirects, network failures,
non-HTML responses, and unexpected statuses remain inconclusive
(`apps/mastra/src/services/watch-route-probe.ts:46`).

Reuse one cached DNS resolver per property run while keeping every candidate
behind the same validator
(`apps/mastra/src/mastra/workflows/watch-route-alerts.ts:346`). This controls DNS
fan-out without relaxing the SSRF boundary.

### Make Admin the strict durable boundary

Claim before reading providers. Admin derives the run identity from execution
mode, property, reporting window, and contract version, and an expired lease is
reclaimed by rotating its token and generation
(`apps/admin/src/services/watch-route-alert.service.ts:471`). Workload assertion
JTIs are consumed in the same transaction as claim or completion
(`apps/admin/src/services/watch-route-alert.service.ts:448`).

The receiver owns the completion schema. Admin requires a versioned report
containing exactly one explicit-event lane and one localized-title lane with the
correct count kinds and bounded caveats
(`apps/admin/src/services/watch-route-alert.service.ts:68`). It derives the
terminal status from those lanes and rejects caller status or windows that do
not agree (`apps/admin/src/services/watch-route-alert.service.ts:603`).

Only a complete live run may recover alerts or advance per-property progress.
Recovery also requires an explicit healthy, same-origin HTML re-probe
(`apps/admin/src/services/watch-route-alert.service.ts:656`). Manager derives
health from the same complete-lane rule rather than trusting a stale success
label (`apps/admin/src/services/watch-route-alert.service.ts:322`).

### Budget from measured volume, then preserve partial outcomes

Provider budgets must be compared with production cardinality before live
enablement. The measured fallback had 8,734 rows, so the workflow uses a
20,000-row ceiling rather than the original 1,000-row draft bound
(`apps/mastra/src/mastra/workflows/watch-route-alerts.ts:72`). One property also
shares a finite request budget across the explicit lane, localized-title chunks,
and pagination (`apps/mastra/src/mastra/workflows/watch-route-alerts.ts:73`).

Bound the other fan-out axes too: active properties, new candidates, recovery
re-probes, provider attempts, probe concurrency, response bytes, and timeout.
Candidate and provider-evidence caps produce partial runs; an excessive active
property configuration is rejected. Keep re-probes on an oldest-first bounded
rotation so an incomplete daily slice does not become false recovery.

## Why This Matters

A single-signal monitor would have reported no issues while the explicit event
was empty. A title-only monitor would become stale during telemetry rollout and
would conflate page views with events. Keeping both lanes visible provides
coverage now without disguising the migration state.

The two-stage syntax and manifest classifier, followed by HTTP corroboration,
avoids the opposite errors. Syntax-only validation turns typo traffic into
incidents. Exact-manifest-only validation discards broken combinations made
entirely from known components. HTTP-only validation accepts soft 404s as
healthy. Each stage answers a different question; the probe describes current
behavior but does not override the analytics-backed alert verdict.

The durable boundary prevents false recovery: GA omission alone cannot close
an alert, partial reads cannot advance progress, stale workers cannot complete
after lease reclamation, and Manager needs neither GA credentials nor Mastra
storage access.

## When to Apply

- A production failure is observable through analytics only after a request.
- A preferred custom event is missing or partially deployed while an older
  deterministic signal remains available.
- Localized UI copy is part of a fallback detector and must track many message
  catalogs.
- Route existence depends on exact producer-owned relationships rather than
  pathname syntax alone.
- A public site can render soft-error HTML with a successful HTTP status.
- Operators need durable open/recovered episodes and source-health context.
- Provider cardinality requires both row and request budgets.

Do not use this pattern to promise discovery before the first viewer.
Analytics is post-request evidence. A literal zero-viewer guarantee requires a
separate deploy-time or publish-time synthetic route gate.

## Examples

### Supported route failure

```text
GA4 path: /watch/jesus.html/french.html
syntax: canonical Watch page
manifest: exact content-language pair exists
analytics: not-found observation exists
result: supported-route failure, with HTTP evidence attached
```

### Plausible stale or broken route

```text
GA4 path: /watch/known-film.html/known-language.html
syntax: canonical Watch page
manifest: both components exist, but the exact pair does not
result: plausible missing route
```

### Partial evidence does not recover

```text
explicit event lane: complete, zero rows
localized title lane: partial because the request budget was exhausted
existing alert probe: 2xx HTML
run status: partial
result: alert remains open; property progress does not advance
```

Keep both lanes until production runs show that the explicit event covers the
same route failures and the localized lane adds no unique actionable paths over
an agreed observation period. Make removal a reviewed contract-version change,
not an automatic reaction to the first nonzero event result.

## Related

- `docs/solutions/architecture-patterns/admin-owned-watch-route-manifest-20260530.md`
- `docs/solutions/architecture-patterns/mastra-seo-experiment-ledger-boundary.md`
- `docs/solutions/architecture-patterns/bounded-versioned-admin-owned-agent-job-audit-report.md`
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
- `docs/solutions/best-practices/buffered-http-response-byte-cap-oom-guard-20260629.md`
- `docs/solutions/conventions/public-watch-url-two-segment-contract-20260608.md`
- `docs/solutions/logic-errors/completeness-claim-must-consume-every-drop-counter.md`
- `docs/plans/2026-09-04-1506-feat-watch-route-alerts-plan.md`
- `docs/roadmap/platform/feat-455-watch-route-alerts.md`
