---
title: "Canonical server search analytics with supplemental RUM"
date: "2026-07-01"
last_updated: "2026-08-06"
category: "architecture-patterns"
module: "apps/web and apps/admin"
problem_type: "architecture_pattern"
component: "tooling"
severity: "medium"
applies_when:
  - "A user-facing workflow needs exact product analytics counts despite browser analytics sampling"
  - "Browser RUM can add UI or click context but must not be the source of truth"
  - "Observability delivery must not add latency or failure modes to the request path"
  - "A database-backed analytics sink needs backpressure without losing Next.js response-lifecycle retention"
tags:
  - "datadog"
  - "rum"
  - "search"
  - "observability"
  - "analytics"
  - "fire-and-forget"
  - "nextjs"
  - "bounded-queue"
related_components:
  - "apps/web/src/lib/search-actions.ts"
  - "apps/web/src/lib/watch-search-analytics.ts"
  - "apps/web/src/observability/datadog-logs.ts"
  - "apps/web/src/components/DatadogRum.tsx"
  - "apps/admin/src/services/search-trace.service.ts"
  - "apps/admin/src/services/search-trace-write-queue.ts"
---

# Canonical Server Search Analytics With Supplemental RUM

## Context

Watch search needed product analytics for top queries, no-result searches,
failures, latency, result counts, and clicked results. Browser RUM is useful
for frontend context, but sampling and blockers make it the wrong canonical
source for submitted-search counts. The right split is: log every search that
reaches the server action from the server, then use RUM for correlated browser
context such as result clicks.

This came up in `feat-197`, where Watch search analytics had to be separate
from Mastra eval sampling and could not slow the visible search response.

## Guidance

Put the canonical analytics event at the server action or route that already
owns the submitted request and final outcome. Emit exactly one event for each
accepted search or load-more request, and classify it from the server result:

```ts
safeScheduleWatchSearchAnalyticsEvent({
  outcome,
  query: response.query,
  requestType,
  resultCount,
  resultSource: response.resultSource,
  searchRequestId: analytics.searchRequestId,
  surface: analytics.surface,
})
```

Schedule delivery after the response path and swallow both sync and async
delivery failures. Build expensive payload details and send to Datadog inside
the scheduled callback so the search path pays only the cheap eligibility
check:

```ts
afterFn(() => {
  try {
    const event = buildWatchSearchAnalyticsLogEvent(input)
    if (!event) return
    void Promise.resolve(send(event)).catch(() => {})
  } catch {
    // Analytics must never affect the response path.
  }
})
```

When the sink is a database instead of a log socket, add bounded process
backpressure without detaching the accepted write from Next.js. The queue must
return one completion promise per accepted item, resolve it only after the
worker settles, and register that same promise with `after()`:

```ts
const completion = queue.enqueueWithCompletion(trace)
if (!completion) {
  recordQueueFull()
  return false
}
try {
  after(() => completion)
} catch {
  void completion // CLI and unit-test contexts have no request lifecycle
}
return true
```

The Admin Watch Search queue implements this contract in
`apps/admin/src/services/search-trace-write-queue.ts:33-67` and attaches each
accepted write in
`apps/admin/src/services/search-trace.service.ts:648-668`. The GraphQL resolver
enqueues after search and returns the response without awaiting persistence
(`apps/admin/src/graphql/queries/watch-search.ts:277-295`).

Do not make the `after()` callback merely enqueue and return. That keeps the
queue push alive, not the database write. Also do not restore a short
request-side timeout around each queued write: timed-out writes keep consuming
database connections after the caller gives up and can recreate the pool
pressure the queue exists to prevent. Let the single bounded worker await each
write to completion, reject excess analytics work at capacity, and emit an
operator-visible queue-full signal. Search results and the public response
contract remain independent of analytics success.

Use a stable anonymous request id to join supplemental browser events back to
the canonical server event. The browser can generate the id for continuity, but
the server should validate or replace malformed ids before logging.

Keep exact query text in the canonical server log only. Result-click RUM events
should carry result id, slug, type, title, position, source, language context,
and `searchRequestId`, but not the exact query text. That keeps click telemetry
useful without multiplying query-text surfaces.

Do not treat client analytics objects as trusted domain data. Derive language
fields from server-side language options or validated public slugs. Accept
optional Watch context only from a trusted sanitized provider; if no such
provider exists yet, omit it from canonical server logs while leaving the
emitter contract ready for it.

Keep reusable UI components presentational. A generic result card should expose
an `onResultClick` callback; the Watch search overlay or wrapper should decide
whether that click becomes a Datadog RUM action.

## Why This Matters

Server-side analytics preserve exact search counts even when RUM is sampled,
blocked, or unavailable. This is what makes top-search and no-result analysis
usable for product decisions.

Fire-and-forget delivery protects the request path. Datadog being slow,
misconfigured, or unavailable should not change search latency, response shape,
or visible UI state.

For database-backed traces, bounded serialization also protects the database
pool. Next.js `after()` supplies response-lifecycle retention; it does not add
durability across a process crash. A process-local queue is therefore suitable
for best-effort analytics only, with queue-full and write-failure counters that
make loss visible.

The trust boundary prevents analytics convenience from becoming a data-leak
path. Exact queries are already sensitive enough; identity-like client fields,
tokens, cookies, session ids, IPs, and arbitrary Watch context do not belong in
canonical product analytics.

## When to Apply

- A viewer-facing or customer-facing workflow needs analytics counts that must
  survive browser sampling.
- The server already sees the submitted request and the final outcome.
- Browser RUM is still valuable for clicks, UI context, or session replay
  correlation.
- Observability must be best-effort and cannot participate in request success.

## Examples

`feat-197` implemented this for Watch search:

- `runSearch` emits canonical server-side `watch_search` logs for search and
  load-more outcomes.
- `watch-search-analytics.ts` builds bounded structured attributes and schedules
  delivery through `after()`.
- `datadog-logs.ts` sends structured syslog payloads to the Datadog Agent and
  guards socket setup and send failures.
- `SearchOverlay` emits `watch_search.result_clicked` RUM actions with the same
  `searchRequestId` used by the server event.
- `VideoCard` remains presentation-only through an `onResultClick` callback.

## Related

- `docs/operations/watch-search-analytics-datadog.md`
- `docs/roadmap/content-discovery/feat-197-watch-search-query-outcome-logging.md`
- `docs/solutions/platform/admin-search-trace-retention-pattern.md`
- `docs/solutions/platform/admin-search-query-labeling-pattern.md`
- `docs/solutions/best-practices/in-memory-slot-reservation-fire-and-forget-20260506.md`
- `docs/operations/typesense-watch-search-production-readiness.md`
