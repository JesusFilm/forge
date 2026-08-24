---
title: "Preserve GraphQL error status through the Watch search client"
date: "2026-08-24"
category: "integration-issues"
module: "apps/web Watch search"
problem_type: "integration_issue"
component: "frontend_stimulus"
symptoms:
  - "Web showed connection guidance for rate limits, server failures, timeouts, and unknown search errors."
  - "Admin returned a machine-readable GraphQL error status, but the browser client discarded it before rendering feedback."
root_cause: "wrong_api"
resolution_type: "code_fix"
severity: "medium"
related_components:
  - "apps/web/src/lib/watch-search-client.ts"
  - "apps/web/src/components/FloatingSearchController.tsx"
  - "apps/web/src/components/SearchOverlay.tsx"
tags:
  - "watch-search"
  - "graphql"
  - "error-classification"
  - "rate-limiting"
  - "web"
---

# Preserve GraphQL error status through the Watch search client

## Problem

Admin can return Watch search failures in an HTTP 200 GraphQL response. The
machine-readable cause lives in `errors[].extensions`, including an HTTP-style
status for rate limiting. Web previously reduced every response with GraphQL
errors to a generic exception, so the UI could not distinguish a rate limit
from a network failure.

## Symptoms

- A rate-limited user was told to check their connection and could retry
  immediately, which did not resolve the failure.
- Server failures, timeouts, and unknown failures received the same network
  guidance.
- Loading more results lost the same error information as the initial search.

## What Didn't Work

- Checking only `response.ok` misses GraphQL failures returned inside an HTTP
  200 response.
- Treating every thrown `fetch` error as a network failure misclassifies request
  timeouts and aborts.
- Keeping only a display string in React state discards the error kind needed
  to choose accurate guidance.

## Solution

Model the browser boundary with a Web-owned typed error. Classify both the HTTP
response and the GraphQL error payload before the response leaves the search
client:

```ts
export type WatchSearchErrorKind =
  | "rate_limited"
  | "server_error"
  | "network_error"
  | "unknown"

if (payload.errors?.length) {
  const error = payload.errors[0]!
  throw new WatchSearchRequestError(
    error.message ?? "Watch search failed",
    watchSearchGraphqlErrorKind(error),
  )
}
```

Carry the error kind alongside the localized display message for both initial
search and pagination. Render wait-and-retry guidance only for a rate limit,
connection guidance only for a network failure, and neutral failure copy for
server, timeout, and unknown failures.

## Why This Works

GraphQL transport success and operation success are separate contracts. The
HTTP status describes the request transport, while `errors[].extensions`
preserves the operation's structured failure semantics. Reading both at the
browser boundary prevents later UI layers from guessing the cause from a
human-readable message.

The UI still owns localized wording, but it receives a stable error kind rather
than raw backend text. This keeps presentation separate from the Admin error
shape without losing the information Admin already supplies.

## Prevention

- For GraphQL clients, test HTTP failures and HTTP 200 responses containing
  structured GraphQL errors as separate cases.
- Give each classifier branch a fixture that only that branch can satisfy.
- Preserve typed error state through initial requests, pagination, and retry
  paths instead of retaining only a display string.

## Related Issues

- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
