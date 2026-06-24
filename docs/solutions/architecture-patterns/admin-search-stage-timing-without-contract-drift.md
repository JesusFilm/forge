---
title: "Admin search stage timing without public contract drift"
date: 2026-06-24
category: architecture-patterns
module: apps/admin
problem_type: architecture_pattern
component: service_object
severity: medium
applies_when:
  - "Admin search needs production latency evidence across REST, GraphQL, and internal eval callers"
  - "Per-query timing must survive strict eval artifacts without changing public response shapes"
tags:
  - admin
  - search
  - observability
  - latency
  - mastra
  - railway
---

# Admin Search Stage Timing Without Public Contract Drift

## Context

Admin search needed production evidence for `feat-175`: total request latency was
known to be high, but the system could not separate DB-backed retrieval,
fusion, hydration, trace persistence, and route overhead. The risky part was not
the timer itself. The risky part was adding useful per-query timing without
changing the public REST or GraphQL search payload, leaking query text, or
teaching Mastra's strict eval parser to reject old artifacts.

The successful shape keeps the timing summary internal to the service and eval
tooling:

- `searchWithTrace()` returns `{ response, trace, timings }`.
- Public REST and GraphQL routes log `timings` but still return only
  `response`.
- The internal eval route returns `{ ...response, timings }` because Mastra is
  the intended machine consumer.
- Mastra schemas accept optional timings so older artifacts remain readable.

## Guidance

### Put Timing Beside The Public Response, Not Inside It

Keep the public response type stable and attach observability to the internal
trace surface:

```ts
export type SearchWithTraceResult = {
  response: SearchResponse
  trace: SearchExecutionSummary
  timings: SearchTimingSummary
}

async search(params: SearchParams): Promise<SearchResponse> {
  const { response } = await this.searchWithTrace(params)
  return response
}
```

This lets existing public callers keep their exact JSON contract while routes
and internal eval tools still get the timing detail they need.

### Measure DB Retrieval At The Retriever Boundary

Wrap each retriever promise where the search orchestrator dispatches it. That
is the service-level DB retrieval boundary: it includes the SQL query and
Prisma/raw-query work for that retriever label, without forcing timing into
each SQL helper.

```ts
const timedRetrieval = (
  label: string,
  run: () => Promise<RankedItem[]>,
): Promise<RankedItem[]> => {
  const startedAt = nowMs()
  return Promise.resolve()
    .then(run)
    .then(
      (value) => {
        retrieverTimings.set(label, {
          label,
          status: "fulfilled",
          elapsedMs: elapsedMs(startedAt),
          resultCount: value.length,
        })
        return value
      },
      (error) => {
        retrieverTimings.set(label, {
          label,
          status: "rejected",
          elapsedMs: elapsedMs(startedAt),
          resultCount: 0,
        })
        throw error
      },
    )
}
```

Do not create fake timing records for retrievers that did not run. For example,
if query embedding fails, semantic DB retrievers are not dispatched, so they
should be absent from `timings.retrievers` rather than reported as `0ms`.

### Keep Embedding Latency Out Of The Timing Contract

Total search time still includes the embedding call because the user waits for
it. The explicit timing fields should not include `embeddingMs`,
`embedding_ms`, or a synonym when the requested measurement excludes embedding
latency. That means visible stage timings will not necessarily sum to total
time, and reports should label that clearly.

### Log In Railway-Friendly Key-Value Lines

Railway logsV2 has previously dropped JSON-shaped runtime logs from Next.js
route handlers. Emit parseable plain-string logs instead:

```text
[search] event=search_timing route=rest locale=en requested_mode=keyword-first search_mode=hybrid outcome=success result_count=10 total_ms=123 db_retrievals_ms=80 fusion_ms=1 hydration_ms=4 trace_write_ms=2 db_retriever_semantic_video_ms=77
```

Use a small formatter that owns all field names and sanitizes user-adjacent
values:

```ts
export function searchTimingLogValue(raw: unknown): string {
  const normalized = String(raw ?? "none")
    .replace(/[\r\n\t\s=]/g, "_")
    .slice(0, 64)
  return normalized.length > 0 ? normalized : "none"
}
```

Route inputs such as `mode` and `locale` should never be interpolated raw into
the timing line. Do not log the query text, raw vectors, bearer tokens, key ids,
user ids, IPs, or debug payloads.

### Extend Strict Eval Consumers In The Same Slice

If an internal Admin route returns a new optional object, update the Mastra
client and artifact schemas in the same PR:

```ts
export const AdminSearchResponseSchema = z
  .object({
    results: z.array(SearchResultSchema),
    hasMore: z.boolean(),
    query: z.string(),
    searchMode: z.enum(["hybrid", "keyword-only"]),
    timings: AdminSearchTimingsSchema.optional(),
  })
  .strict()
```

Then propagate timings through baseline cases, comparison outcomes, and
exploratory generated outcomes only when present. Optional fields keep old
artifacts compatible.

## Why This Matters

This pattern gives operators stage-level latency evidence without making public
search callers pay for an API change. It also keeps privacy and operational
logging concerns in one place: the service owns timing collection, the route
owns trace-write timing and log emission, and Mastra owns strict preservation
for later analysis.

The separation is important because the next performance move should be based
on production data. If DB retrieval dominates, SQL/index/window work is likely.
If trace persistence or hydration dominates, changing pgvector plans would be
noise. Without stable per-stage fields, those paths are hard to compare across
`keyword-first`, `hybrid`, and internal `semantic-only` searches.

## When To Apply

- A shared service feeds public routes and internal diagnostics.
- Operators need per-stage latency from production logs before optimizing.
- Public response contracts must remain byte-stable.
- A strict offline/eval client needs to preserve new diagnostic metadata.
- Some requested stage, such as embedding latency, must intentionally remain
  unreported even though it affects total time.

## Examples

Good boundaries:

- Service timing: total search service time, retrieval fan-out, individual
  retrievers, fusion, dilution cap, dedupe, mapping, hydration.
- Route timing: trace-write time for routes that write traces.
- Internal eval response: optional `timings` object for Mastra only.
- Public REST/GraphQL response: unchanged `SearchResponse`.

Avoid these shortcuts:

- Adding `timings` to the public REST or GraphQL search payload.
- Logging raw query text in a hot-path timing line.
- Returning `embeddingMs` when embedding latency is explicitly out of scope.
- Reporting skipped semantic retrievers as `0ms` DB calls.
- Updating Admin's internal route without updating Mastra's strict parser.

## Related

- [Railway logsV2 silences JSON-stringified payloads from Next.js App Router runtime route handlers](../runtime-errors/railway-logsv2-silences-nextjs-stdout-runtime-20260518.md)
- [Log-injection: sanitize user input before interpolating into structured warn lines](../security-issues/log-injection-sanitizer-user-input-structured-logs-20260429.md)
- [Admin hybrid search (R4) - port pattern](../platform/admin-hybrid-search-r4-pattern.md)
- [Admin hybrid search keyword-first mode - R4 extension pattern](../platform/admin-hybrid-search-keyword-first-r4-extension-pattern.md)
- `docs/plans/2026-06-24-001-feat-search-path-latency-logging-plan.md`
