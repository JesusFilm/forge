---
title: "A ref's write timing becomes a contract when a diff adds consumers — pre-flight correlation-id write misattributed failed-search clicks"
date: 2026-08-04
category: logic-errors
module: apps/mobile
problem_type: logic_error
component: frontend_stimulus
symptoms:
  - "RESULT_CLICKED rows in admin's unsampled watch-search event store carried a search_request_id naming a search that returned nothing (no RESULTS_VIEWED row, no completed log row under that id)"
  - "The search that actually produced the clicked results showed impressions with no clicks — CTR silently skewed in both directions"
  - "Reachable in normal usage: a failed search restores the previous results to full opacity and leaves them tappable, so every click between a failure and the next success was misattributed"
root_cause: async_timing
resolution_type: code_fix
severity: medium
related_components:
  - tooling
tags:
  - "react-refs"
  - "correlation-id"
  - "telemetry"
  - "watch-search"
  - "write-timing"
  - "code-review"
---

# A ref's write timing becomes a contract when a diff adds consumers — pre-flight correlation-id write misattributed failed-search clicks

## Problem

`searchRequestIdRef` on mobile's search screen was written twice: once with a
freshly minted id **before** the search request was issued (pre-flight), and
once on success with admin's adopted echo. The pre-flight write was harmless
for years — the only consumer was a log line, and a dangling id in a log is
noise. feat-335 (PR JesusFilm/forge#1823) added consumers whose semantics are
join-integrity: an unsampled first-party `RESULT_CLICKED` event store and a
RUM click action, both keyed off that ref. The moment those consumers landed,
the pre-flight write's _timing_ became a correctness contract nobody had ever
stated — and it was wrong for the failure path.

## Symptoms

- After a failed search, the previous results stay visible and tappable (the
  catch path deliberately restores their opacity). Every click until the next
  successful search was attributed to the FAILED search's id — an id with no
  impressions row and no completed log row.
- Caught pre-merge by the correctness reviewer in the multi-agent review, and
  independently validated with a reader-by-reader analysis of the ref; it
  never shipped.

## Solution

Make the success-path adoption the ref's **sole writer**, so the ref always
names the search whose results are on screen
(`apps/mobile/app/(tabs)/watch.tsx:371-373` for the mint comment,
`:402-403` for the adoption):

```ts
// One correlation id per search (R33/R35). The ref adopts it only on
// success, so clicks always attribute to the search whose results are
// on screen — a failed search leaves the previous id in place.
const searchRequestId = generateSearchRequestId()
// ... request uses the LOCAL id; the failure log uses the LOCAL id ...
const adoptedRequestId = page.requestId ?? searchRequestId
searchRequestIdRef.current = adoptedRequestId // sole writer, success only
```

Deleting the pre-flight write was safe only after enumerating every reader:
the failure-path log already used the local variable, `loadMore` is gated on
a generation ref that advances only on success, impressions run only on
success paths, and no results are on screen before the first success. That
reader enumeration IS the fix's proof — the deletion without it would be a
guess.

The fix has a paired constraint: the click-dedup ledger must NOT be cleared
at the top of `search()` (`apps/mobile/app/(tabs)/watch.tsx:326-328` keeps
only the viewed-map clear). With the ref correctly lagging until success, an
unconditional ledger clear would widen a duplicate-click window from ~150ms
to the whole in-flight search. Two individually-plausible lines — the
pre-flight write and the ledger clear — were only correct or incorrect **as a
pair**.

## Why This Works

The ref's value now has a stated invariant: _it names the search whose
results are on screen_. Under that invariant every consumer is correct by
construction — clicks join the impressions and the completed log row of the
search that actually produced the visible rows, and a failed search (which
produces no new rows) leaves attribution with the results that remain
visible.

## Prevention

When a diff adds a consumer to an existing ref (or any long-lived mutable
slot), audit the ref's **write sites**, not just its read sites: each write's
timing is part of the contract the new consumer inherits. Ask "after every
write, does the value satisfy the invariant my new consumer needs?" — for a
correlation id, that invariant is usually "names the settled state the user
is looking at," which a pre-flight write violates by definition. State the
invariant in a comment at the sole writer so the next consumer inherits it
explicitly.

## Related

- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — sibling review-discipline family from the same PR
- `docs/roadmap/content-discovery/feat-335-mobile-search-observability-parity.md` — the feature this shipped with (PR JesusFilm/forge#1823, open as of 2026-08-04; this doc travels with it)
