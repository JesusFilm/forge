---
title: Outbound timeout must be shorter than the caller's upstream budget
date: 2026-05-06
category: best-practices
problem_type: best_practice
component: cross-app-http-client
root_cause: nested-timeout-budgets-not-explicitly-allocated
resolution_type: code_fix
severity: medium
tags:
  - timeout
  - cross-app
  - reliability
  - typed-error
related:
  - docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md
  - docs/solutions/platform/local-embed-pipeline-pattern-20260429.md
  - docs/solutions/runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md
  - docs/solutions/best-practices/buffered-http-response-byte-cap-oom-guard-20260629.md
---

# Outbound timeout must be shorter than the caller's upstream budget

## Problem

A server-route handler made a downstream call (Apollo to Strapi
GraphQL) without an explicit per-call timeout. The upstream caller
(admin's outbound HTTPS client) had a 15-second `AbortSignal.timeout`
ceiling. When Strapi was unreachable, the inner Apollo call hung for
_longer_ than 15 seconds — admin's outbound client timed out and
returned `DISPATCH_FAILED { reason: "network_error", retryable:
true }`, and the operator's CLI retried. Each retry kicked off
ANOTHER manager request that ALSO hung waiting on Apollo. Manager's
in-memory idempotency map dedupes only once the lookup completes, so
the retry-storm produced multiple concurrent dispatches for the same
asset.

The naked symptom: `502 cms_unreachable` with empty body, OR worse —
the status was `500` with no body at all because the Apollo error
propagated past the route handler's catch boundary.

## Symptoms

- Admin GraphQL: per-id outcome `DISPATCH_FAILED { reason:
"network_error", retryable: true }` after ~15 seconds, even
  though the operator triggered just once.
- Manager logs: no event line for the request that timed out — Next
  killed the request worker mid-Apollo-call.
- CLI: structured outcome lines arriving in retry bursts.

## What didn't work

- **Raising admin's outbound timeout to 30s or 60s.** Pushes the
  problem out, doesn't fix it. The hung Strapi will eventually 502
  the response, but every request worker is pinned for the full
  budget, exhausting Next's worker pool.
- **Catching all errors in the route handler and returning a
  generic 500.** Hides the upstream classifier signal — admin's
  outbound client can no longer distinguish "manager genuinely
  failed" from "manager's downstream is hung", so it can't decide
  whether to retry.

## Solution

Wrap the downstream call in `Promise.race` against a budgeted timer
that rejects with a **typed error name** the route handler can
classify cleanly:

```ts
const CMS_LOOKUP_TIMEOUT_MS = 10_000

async function lookupVideosByCoreId(coreIds: string[]) {
  const queryPromise = apollo.query({...})
  const result = await Promise.race([
    queryPromise,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(
          Object.assign(
            new Error(`cms lookup timed out after ${CMS_LOOKUP_TIMEOUT_MS}ms`),
            { name: "TimeoutError" },
          ),
        )
      }, CMS_LOOKUP_TIMEOUT_MS)
      // Don't keep the event loop alive on this timer if the query
      // resolves first (Promise.race ignores the loser).
      timer.unref?.()
    }),
  ])
  // ...
}
```

The route handler's existing CMS-error catch then sees a `name ===
"TimeoutError"` shape and returns the typed `502 { reason:
"cms_unreachable" }` envelope without reading the message string.

## Why this works

Two layered budgets cooperate cleanly only when the **inner is
strictly smaller than the outer plus headroom**:

```
  Admin outbound (15s ceiling) ──────────────────────────────→
  Manager route lifecycle:                                    │
    ├── CMS lookup (10s budget) ────────────► fail-fast       │
    ├── Idempotency check (~1ms)                              │
    └── after() schedule + JSON response (~50ms)              │
                                                              ▼
                                                       caller sees
                                                       clean 502 in <11s
```

If the inner budget exceeds (or equals) the outer, the upstream
caller's classifier wins the race — and an upstream "network_error
retryable" classification is wrong: the downstream is just slow, not
unreachable. Worse, the upstream may retry while the inner call
keeps running.

The `timer.unref?.()` is load-bearing: without it, a query that
resolves first leaves the timer holding the event loop alive past
the request's natural lifetime — fine in long-lived processes, bad
in tests and serverless. The `?.` guards against environments where
`unref` doesn't exist on the returned timer type (browser).

The typed `Object.assign(new Error(...), { name: "TimeoutError" })`
shape lets the catch site branch on `error.name === "TimeoutError"`
instead of regex-matching the message — same META rule as the AWS
NoSuchKey classification pattern. Tests must throw the real typed
shape, not a generic Error.

## Prevention

**Rule:** Any server-route function that calls a downstream client
which doesn't honor an explicit per-call timeout MUST wrap with
`Promise.race` + a typed `TimeoutError` rejection, with a budget
**strictly smaller** than the upstream caller's ceiling minus
expected response-shaping time (~10–20%).

**Cross-link to the reverse direction:** `apps/manager/src/lib/admin-embed-trigger.ts`
uses `AbortSignal.timeout(15_000)` for the manager → admin outbound
direction. `fetch()` natively honors AbortSignal so the
`Promise.race` ceremony isn't needed there. Pick the mechanism that
matches the underlying client:

| Client                  | Mechanism                                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `fetch()`               | `AbortSignal.timeout(N)`                                                                                                    |
| Apollo `client.query()` | `Promise.race` against a typed-rejection timer (Apollo doesn't honor `signal` on `query` options uniformly across versions) |
| `pg` / Prisma           | `statement_timeout` at the connection level **plus** application-side `Promise.race` for non-query ops                      |
| `@aws-sdk/client-s3`    | `requestHandler.requestTimeout` config option                                                                               |

**Test discipline:** the typed-error branch needs at least one test
that rejects with `Object.assign(new Error(...), { name:
"TimeoutError" })`. A test that throws `new Error("timeout")`
satisfies the regex backstop while leaving the typed branch
untested — see the META doc on
[mocked shape vs real contract discipline](mocked-shape-vs-real-contract-discipline-20260506.md).

## Worked instance

feat-119 PR2 surfaced this trap during local smoke when Strapi
wasn't running. Admin's outbound returned `502 cms_unreachable`
with empty body (Apollo error propagated past the route handler);
the fix added the `Promise.race` wrapper + the typed `TimeoutError`
class. Test "times out the cms lookup and returns 502
cms_unreachable when Strapi hangs" uses `vi.useFakeTimers()` +
`advanceTimersByTimeAsync(10_500)` to verify the budget fires.

See `apps/manager/src/lib/admin-trigger-route.ts:285-300` and the
test in `apps/manager/src/lib/admin-trigger-route.test.ts`.

## Companion: the space axis

This rule bounds _how long_ an outbound call may take. Its companion bounds
_how many bytes_ its response may buffer: a downstream client that does
`await response.json()` (or `.text()`/`.arrayBuffer()`) buffers the whole body
into the heap before any slicing, so a misbehaving upstream returning a
multi-GB body can OOM a shared process even when the call returns quickly.
Reach for both together on any outbound call in a shared/long-lived runtime —
the time cap (`AbortSignal.timeout` / `Promise.race`) and the size cap
(streamed byte counter + `reader.cancel()`). See
[byte-cap buffered HTTP response reads to guard against OOM](buffered-http-response-byte-cap-oom-guard-20260629.md).
