---
title: Recover homepage recommendations from transient runtime failures
type: fix
status: in-progress
roadmap: feat-496
---

# Scope

Reduce the failed Recommended for You experience without changing the six-card,
profile-first, exact-language, viewing-history or capability contracts.

## Evidence

- Primary-host trace `6aa7e29d00000000233fb80ca02319c2` on 14 September at
  12:03 UTC: Web aborts Admin at 1.9 seconds. Admin begins the resolver roughly
  16 seconds after Web begins, then spends 3.8 seconds starting a transaction.
  Admin event-loop delay peaks at 7–8 seconds; other Watch operations also stall.
- Fresh primary-host trace `6aa864740000000045590e6d28d5f147` at 21:17 UTC:
  Web admission fails before Admin. Redis TIME's 250 ms timer fires after 590 ms;
  Web event-loop delay reaches 572 ms in that minute. This is not a pool-coverage
  failure. CPU/memory limits are not exhausted, and observed GC pauses alone do
  not explain those stalls. The specific source of shared runtime stalls remains
  under investigation; do not attribute it to Redis transport alone.
- Browser delivery has one 2.2-second budget, including an immediate retry, while
  Web allows up to 500 ms admission plus 1.9 seconds upstream. HTTP-200 transient
  delivery failures are terminal except for cooldown/in-flight. A slow initial
  request therefore has no useful recovery window.
- Source-free issuance uses nested per-item creates; cleanup also awaits release
  outside the service deadline. Reproduce and bound these avoidable costs.

## Changes and validation

1. Add a delivery-specific browser recovery boundary with aligned per-attempt
   budgets, a small fixed attempt cap and cooldown-aware backoff. Retry transport
   failures and explicit transient reasons; do not retry invalid input, denied
   authority, disabled serving or insufficient catalog coverage.
2. Retain lazy loading and stable cards. Keep the existing skeleton during
   recovery; omit the optional block after terminal failure instead of presenting
   a page-level error. Keep failures observable. Never reuse capabilities across
   contexts or bypass eligibility to fill a row.
3. Preserve transaction atomicity, bound retrieval/issuance waits and cleanup, and
   record sanitized failure stage/timing. No schema changes or deadline inflation
   on Admin, Redis or the upstream Web request.
4. Reproduce timeout/recovery, retry exhaustion, abort/context changes and database
   write failures in focused regression tests. Verify database issuance behavior,
   browser recovery, normal playback and page-loading behavior.
5. Review the diff, pass scoped CI checks, merge through PR/main, then compare
   production request outcomes and complete a browser journey. Keep feat-496 open
   if the broader runtime stall source is unresolved.

## Frontend plan

Keep Watch's existing dark block, typography and six-card layout. The state flow
is lazy placeholder, bounded recovery, then six stable cards or no optional row.
Use the existing loading treatment; add no decorative motion or polling.

## Updated findings and rollout scope

- The owner requested LaunchDarkly targeting while keeping the row removed from
  general release. Add `forge.watch.homepageRecommendations`, default/fallback
  false, using verified local Watch account identity for targeting. Both the
  no-store availability route and Web delivery route enforce it; native Admin
  consumers are unaffected. Production Web currently lacks an LD server SDK key.
- Read-only catalog inspection found the English homepage was republished at
  12:28 UTC without the authored recommendation block. Preserve that publication
  until the owner restores the block for targeted testing.
- A real PostgreSQL comparison proves the previous nested `create` already uses
  one insert for six items (81 ms fixture delivery in both forms). Keep that
  implementation; it is not an established bottleneck. Real database coverage
  verifies request/item/audit atomicity with the new deadline boundary.

## Validation evidence

- Full Admin and Web unit suites passed (6,529 and 4,174 tests respectively),
  followed by focused checks for the final failure-space reservation, stale
  language response, deadline and default-off flag cases. Real PostgreSQL tests
  pass for six-item atomic issuance and complete rollback on audit failure; the
  existing curation suite keeps them in database CI.
- Web production build, standalone Web/Admin typechecks and scoped ESLint pass.
  Sequential review covers correctness, reliability, security, API compatibility,
  frontend races, performance and repository conventions. No remaining code
  findings; runtime investigation and release configuration stay explicit.
- Browser recovery scenarios pass for normal serving, a 2,400 ms HTTP failure,
  an HTTP-200 delivery timeout, three exhausted attempts and flag-off. Recovered
  cards remain stable; no scenario reports a JavaScript page error. Flag-off
  produces zero delivery requests.
- Visible failure-space preservation reduces measured exhausted-case CLS from
  0.193 to 0.033. Warm recovery samples have CLS 0.036, TTFB 26 ms and LCP
  400–1,940 ms; flag-off has CLS 0.028, TTFB 29 ms and LCP 1,552 ms. This is
  local regression evidence, not production latency forecasting. Cold first
  navigation is slower (TTFB 3,257 ms, CLS 0.112); do not compare it with a warm
  baseline. Loaded JavaScript changed by 264 bytes for the reservation fix.
- Local production-build journey at 14 September 21:52–21:53 UTC passes six
  distinct cards, stable browsing, acknowledged selection, 36 seconds of actual
  playback, successful evidence/feedback and fresh six-card homepage return.
- Local artifacts are retained under
  `/home/nisal/.cache/forge-recommendation-reliability/`, including
  `browser-recovery.json`, `recovered-row.png` and `journey-desktop.json`.

## Release outcome

Merged and deployed in #2295. Subsequent production browser checks confirm the
availability response is disabled and private, direct anonymous source-free
POST returns the expected HTTP 403, and normal Watch playback remains healthy.
The authored English block remains removed per owner instruction. Follow-on
runtime fixes and final observation are recorded in
`docs/operations/watch-runtime-recovery-2026-09-15.md`.

Targeted Web launch still requires an LD server key, remote flag configuration
and authored block. That launch configuration belongs to feat-488; it is not
substituted with blanket enablement or claimed as verified by disabled traffic.
