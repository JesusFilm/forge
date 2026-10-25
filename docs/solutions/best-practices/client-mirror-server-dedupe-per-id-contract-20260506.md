---
title: Client pre-dedupes mirroring server dedupe to preserve per-id outcome contracts
date: 2026-05-06
category: best-practices
problem_type: best_practice
component: cross-app-http-client
root_cause: unmirrored-dedupe-forces-synthetic-outcomes-on-dropped-ids
resolution_type: code_fix
severity: medium
tags:
  - api-contract
  - dedupe
  - per-id-outcome
related:
  - docs/solutions/best-practices/producer-consumer-report-file-contract-pattern-20260506.md
  - docs/solutions/best-practices/workflow-report-operator-actionable-projection-pattern-20260506.md
  - docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md
---

# Client pre-dedupes mirroring server dedupe to preserve per-id outcome contracts

## Problem

A client sends `items: [{ id, ... }, ...]` to a server endpoint.
The server dedupes by `id` at its boundary (e.g. to avoid double-
charging operators or double-dispatching pipelines). The server
returns one outcome per **deduped** id; the client expected one
outcome per **requested** item. The lengths mismatch, and the
client has to synthesize an outcome for the dropped ids — but with
no signal whether the id was genuinely missing, was deduped, or hit
a server-side bug.

For PR2: admin sent `[{1,a}, {1,a}, {2,b}]` (operator double-listed
asset 1). Manager dedupes at the boundary, returns 2 outcomes (for
ids 1 and 2). Admin's outbound client got 2 results back for 3
requested items. The original "fill missing as NOT_FOUND"
synthesis was misleading — `NOT_FOUND` already means "cms video
not found for coreId", so consumers couldn't tell apart "the id
was sent twice and we collapsed it" from "the id was sent once and
the cms doesn't have it".

## Symptoms

- Admin GraphQL response: `outcomes.length !== request.items.length`
  with a per-id outcome the consumer can't classify.
- Operator dashboards: rows showing `NOT_FOUND` for ids the operator
  knows are in cms (because they came from PR1's report which only
  emits ids that ARE in cms).
- CLI summary: `notFound > 0` triggers exit 1, falsely flagging a
  successful deduped batch as a partial failure.

## What didn't work

- **Server stops deduping.** Now operator double-clicks produce
  two real pipeline runs, two S3 writes, two GraphQL events. The
  dedupe was load-bearing for cost containment.
- **Synthesizing `NOT_FOUND` on the client for missing ids.**
  Conflates two distinct failure modes (genuine cms-miss vs
  client-dedupe-collapse) under one status that consumers gate on.
- **Adding a new `DEDUPED` status.** Surfaces the implementation
  detail (server collapses dupes) into the public contract — and
  the client now has to handle a status it created itself, not one
  the server ever sends.

## Solution

**Mirror the server's dedupe at the client, BEFORE the request.**
Now request and response array lengths match by construction:

```ts
// apps/admin/src/services/manager-trigger.service.ts:219-231
export async function triggerManagerEnrichment(
  items: readonly ManagerEnrichmentTriggerItem[],
  kind: ManagerEnrichmentKind,
): Promise<ManagerEnrichmentDispatchResult[]> {
  // Pre-dedupe by assetId so the admin caller's per-id outcome list
  // length matches what manager will respond with. Manager dedupes
  // the same way at its boundary; without admin doing the same, a
  // duplicate assetId in the input would cause manager's response
  // array to be SHORTER than the request, forcing a synthetic
  // outcome with no clean status to assign. Dedupe at both
  // boundaries keeps the per-id outcome contract honest.
  const seen = new Set<number>()
  const dedupedItems = items.filter((item) => {
    if (seen.has(item.assetId)) return false
    seen.add(item.assetId)
    return true
  })
  // ... rest of function uses dedupedItems exclusively
}
```

Defense-in-depth: keep the missing-id synthesis path but reclassify
it as a **contract drift** signal (server dropped an id we sent),
not as a normal NOT_FOUND:

```ts
const seenInResponse = new Set<number>(mapped.map((r) => r.assetId))
const dropped = dedupedItems.filter((it) => !seenInResponse.has(it.assetId))
const filled = [
  ...mapped,
  ...dropped.map(
    (it): ManagerEnrichmentDispatchResult => ({
      assetId: it.assetId,
      coreId: it.coreId,
      managerJobId: null,
      status: "DISPATCH_FAILED",
      reason: "parse_error",
      retryable: false,
      error:
        "manager response did not include an outcome for this assetId — possible contract drift",
    }),
  ),
]
```

The defensive path now surfaces a real bug if it ever fires (server
returned fewer outcomes than the deduped request) instead of
masking the bug as a normal NOT_FOUND.

## Why this works

The per-id outcome contract is a 1:1 zip between request items and
response outcomes: the consumer iterates outcomes by index OR by id
and assumes each request item produced exactly one outcome. The
server's dedupe is an internal optimization that breaks the zip
unless mirrored.

By moving the dedupe before the wire, the wire shape becomes the
contract again — the client and server both see a deduped item
list, and the response is correctly sized for the request as the
server received it. The client's "what I requested" matches the
server's "what I responded to" exactly.

The defensive missing-id path is no longer load-bearing on the
happy path (it can't fire under normal operation because
client/server dedupe by the same key), so when it DOES fire it's a
genuine contract drift worth alerting on, not a routine
classification ambiguity.

## Prevention

**Rule:** When a client → server pair has the server deduping by a
stable id, the client MUST mirror that dedupe BY THE SAME KEY,
before the request. Document the dedupe key in BOTH halves' code
comments so future maintainers can't accidentally diverge them
(e.g. server starts deduping by `(assetId, kind)` while client
still dedupes by `assetId` alone — the request would be deduped on
the client and re-deduped on the server with different
granularity, silently dropping different items on each call).

**Test discipline:** add a test that sends duplicate ids and
asserts:

1. The HTTP request body length equals the deduped length, not the
   original input length.
2. The response is correctly sized; no synthetic NOT_FOUND for the
   dedupe-collapsed id.
3. A separate test that sends N items and stubs the server to
   return N-1 results — assert this surfaces as `DISPATCH_FAILED
{ reason: parse_error, error: contract drift }`, not NOT_FOUND.

## Worked instance

feat-119 PR2: admin's `triggerManagerEnrichment` mirrors manager's
`AdminTriggerBodySchema.transform` dedupe by `assetId`. Caught in
/ce:review by the api-contract reviewer (conf 0.86) — the original
implementation had the misleading NOT_FOUND fallback. The fix
landed before merge with two new tests:

- "admin pre-dedupes assetIds before the request so manager never
  sees duplicates" — verifies the wire body's length.
- "returns DISPATCH_FAILED parse_error when manager drops an
  outcome we sent (contract drift)" — verifies the defensive
  fallback surfaces the right signal when invoked.

See `apps/admin/src/services/manager-trigger.service.ts:219-231,336-356`
and `apps/manager/src/lib/admin-trigger-route.ts:62-72` (server-side
dedupe).

## Related cases worth checking

- **Bulk REST endpoints** (`POST /things` with `[{ id, ... }]`
  body): dedupe at both halves by the same key.
- **Batch GraphQL operations**: when a mutation accepts a list
  input and dedupes server-side, the client wrapper should pre-
  dedupe.
- **Workflow trigger mutations** that take id lists (sibling to
  PR2's mutation): same rule — feat-119 PR2's siblings
  (`triggerSceneEmbeddingBackfill`, `triggerTranscriptEmbeddingBackfill`)
  take stringList args; verify their callers dedupe before passing.
