---
title: "Use operation-specific Admin GraphQL clients for exceptional timeout budgets"
date: "2026-06-12"
category: "best-practices"
module: "apps/web Admin GraphQL client"
problem_type: "best_practice"
component: "service_object"
severity: "medium"
applies_when:
  - "One Admin GraphQL operation needs materially more timeout headroom than the default Web data layer"
  - "A production mitigation should stay bounded without globally widening every Admin GraphQL call"
  - "A server action or adapter can route a specific operation through a named Admin client"
tags: [admin-graphql, timeout, semantic-search, reliability, web]
related_components: [apps/web, apps/admin, packages/admin-graphql]
---

# Use operation-specific Admin GraphQL clients for exceptional timeout budgets

## Context

`apps/web/src/lib/admin-client.ts` centralizes Web's Admin GraphQL Apollo client, bearer header, and fetch timeout. That default is intentionally short so ordinary server-side reads fail fast when Admin is sick.

Semantic search is an exception. It can be healthy at several seconds and still exceed the general Web Admin timeout while Admin performance work is pending. The mitigation should not remove timeouts, lengthen every Admin call, or alter Admin ranking, retriever SQL, or Algolia behavior.

## Guidance

Keep the default Admin client on the normal timeout and add a named operation-specific client for the exceptional operation.

The durable shape:

1. Keep bearer parsing, endpoint config, cache construction, and lazy env access in `admin-client.ts`.
2. Extract client construction around a timeout parameter.
3. Preserve the default export for normal Admin GraphQL calls.
4. Export a named client for the exceptional operation.
5. Route only the operation adapter through that named client.

Simplified example:

```ts
const REQUEST_TIMEOUT_MS = 15_000
const SEMANTIC_SEARCH_REQUEST_TIMEOUT_MS = 45_000

function createTimeoutFetch(timeoutMs: number): typeof fetch {
  return (input, init) =>
    fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) })
}

function createLazyAdminClient(timeoutMs: number): ApolloClient {
  let realClient: ApolloClient | undefined
  return new Proxy({} as ApolloClient, {
    get(_target, prop, receiver) {
      realClient ??= createAdminClient(timeoutMs)
      return Reflect.get(realClient, prop, receiver)
    },
  })
}

export default createLazyAdminClient(REQUEST_TIMEOUT_MS)
export const semanticSearchAdminClient = createLazyAdminClient(
  SEMANTIC_SEARCH_REQUEST_TIMEOUT_MS,
)
```

Then the operation adapter makes the scope visible at the call site:

```ts
import { semanticSearchAdminClient } from "@/lib/admin-client"

export async function searchVideos(...) {
  return semanticSearchAdminClient.query({
    query: SEARCH_QUERY,
    variables,
    fetchPolicy: "no-cache",
  })
}
```

Tests need two layers:

- Admin client boundary: prove the default export still uses the default budget, the named client uses the longer budget, both clients keep independent budgets in one module instance, and the timeout signal reaches fetch.
- Operation adapter boundary: prove the exceptional adapter calls the named client rather than the default client.

The second test is easy to miss. Tests that call the named client directly still pass if the adapter later regresses to the default client.

## Why This Matters

A global timeout increase turns one slow operation into a system-wide resource-occupancy change. A no-timeout fetch can pin workers indefinitely. A named bounded client keeps the mitigation explicit and reversible while preserving the existing failure posture for unrelated Admin reads.

The adapter-level test protects the real production promise: the semantic search path must actually select the search-specific client. The client-level tests protect the implementation detail that makes that promise safe: separate lazy clients must not share a first-touch singleton or accidentally use the same timeout.

## When to Apply

- Use this when one Admin GraphQL operation has a justified latency profile that differs from the rest of the Web data layer.
- Keep the exceptional timeout lower than any outer server action, route, proxy, or platform budget with response-shaping headroom.
- Do not use this as a substitute for fixing the slow resolver, SQL, index, or retriever when that is the real durable work.
- Do not use this to widen browser-exposed behavior; Admin bearer access stays server-side.

## Examples

Good mitigation:

```ts
// Normal content, language metadata, recommendations, etc.
import adminClient from "@/lib/admin-client"

// Semantic search only.
import { semanticSearchAdminClient } from "@/lib/admin-client"
```

Avoid:

```ts
// Every Admin GraphQL call now waits for the slowest exceptional operation.
const REQUEST_TIMEOUT_MS = 45_000

// Or worse, no timeout at all.
fetch(input, init)
```

Review checklist:

- The default client still has the original timeout.
- The exceptional client is bounded.
- The exceptional adapter imports the exceptional client.
- Tests exercise both exports from one module instance.
- Tests fail if the adapter goes back to the default client.
- Local agent/developer guidance mentions the split so future agents choose the right client.

## Related

- [Outbound timeout must be shorter than the caller's upstream budget](./outbound-timeout-shorter-than-caller-budget-20260506.md)
- [Forge Algolia Search Modal Pattern](../architecture-patterns/forge-algolia-search-modal-20260610.md)
- [Admin hybrid search (R4) - port pattern](../platform/admin-hybrid-search-r4-pattern.md)
- [Admin semantic-video retrieval is transcript-backed after feat-192](../architecture-patterns/admin-semantic-video-transcript-evidence-pattern.md)
