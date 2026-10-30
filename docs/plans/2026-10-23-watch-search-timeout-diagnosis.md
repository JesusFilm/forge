---
title: "Diagnose intermittent Watch search timeouts and correct latency accounting"
date: 2026-10-23
status: completed
---

## Scope

Continue feat-678 against current main. The reported public Watch query is
`Bible stories stories`; the original timestamp is uncertain. Production
requests intermittently return HTTP 504. Current Admin deliberately maps
`WatchSearchTimeoutError` to HTTP 504, so a Cloudflare HTML error does not by
itself establish an infrastructure outage.

## Investigation

- Compare bounded sequential public probes with `__typename`, autocomplete,
  and the Typesense early-return path. Keep raw headers and credentials out of
  retained evidence.
- Inspect the shared deadline and candidate profile cache. Profile resolution
  consumes the same 2,300 ms deadline, with a 1,900 ms retrieval cutoff.
- Correlate deadline warning stages and deployment instances. Read-only access
  is now working: two correlated probes confirm serving-profile timeouts, and
  one retained trace identifies the missing-projection compatibility fallback
  exceeding the cutoff with serial database-path waits.

## Confirmed Code Fix

`searchResolvedTypesenseWatchSearch` starts the deadline before resolving the
profile, but returns `latencyMs` measured inside the service after that work.
Correct the bounded proxy's returned duration to include profile resolution
and search execution. Preserve direct/unbounded timing and all deadline,
compatibility, ranking, and failure behavior.

Add a regression at the actual proxy/service boundary for ordinary results and
the early-return result. Show it failing before the fix. Run the service and
deadline suites and scoped formatting/type checks. No GraphQL schema change is
needed.

## Remaining Acceptance

The accounting fix does not repair the underlying intermittent timeout. The
reproduced serving-profile path is attributed, but the projection bootstrap
and database-pressure remedy, other failed stages, representative latency
distribution, and alert delivery remain open under feat-678. No deployment,
production data write, restart, timeout relaxation, or new notification is
part of this investigation.
