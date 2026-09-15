---
id: "feat-496"
title: "Resolve remaining Watch admission and database transaction timeouts"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-09-11"
duration: 3
depends_on: []
blocks: []
tags:
  - "web"
  - "recommendations"
  - "infrastructure"
---

## Problem

Renumbered from `feat-486`, then `feat-495`, on 14 September 2026 because
independently merged roadmap tickets reused those IDs. This ticket retains ownership of the Watch
runtime investigation. The owner subsequently authorized restoring and activating
`feat-488`; this investigation remains open independently of that launch.

The 14 September activation passed English/Spanish row checks and a complete
selection/playback/feedback/homepage-return journey. A seven-minute window had
5,408 Web requests and zero 5xx, but subsequent language probes again returned
`delivery_timeout`. Trace `6aa7403d00000000262e20db7880e1dd` shows issuance
exceeding its remaining 238 ms transaction budget (298 ms elapsed), after
successful retrieval. Selection deadlines can also expire before browser
acknowledgment. Investigate without speculative timeout increases. A separate
Admin `pg-pool` double-release error at 00:31:26 UTC is an observation, not an
established cause. See
`docs/operations/user-recommendations-activation-2026-09-14.md`.

The disabled-feature Web deployment from #2249 coincided with sustained Redis
admission failures, image connection timeouts and increased event-loop delay.
The Web-only rollback in #2250 reduced errors substantially without restoring the
pre-release baseline in its first fifteen minutes. Existing playback and seeded
recommendations pass fresh browser checks. The full cause of the runtime
regression remains unproven. Broader evidence-transport reliability remains
owned by `feat-464`.

## Entry Points — Read These First

1. `docs/operations/user-recommendations-rollout-2026-09-10.md` — fixed windows,
   deployment identities, recovery scope, remaining failures and trace links.
2. `apps/web/src/lib/recommendation-mutation-admission.ts` — bounded Redis
   connection/TIME/EVAL, shared client retirement and retry backoff.
3. `apps/web/src/lib/recommendation-route-policy.ts` — failure response contracts.
4. `apps/web/src/lib/content.ts` and `packages/admin-graphql/src/fragments/watch-experience.ts`
   — schema compatibility and the shared experience query.
5. `apps/web/src/instrumentation.ts` and `apps/web/next.config.mjs` — production
   instrumentation and image handling; unchanged by the original feature.
6. #2249 and preserved branch `codex/feat-477-user-recommendations` — Web block and
   source-free route implementation available for later restoration.

## Grep These

- `recommendation.admission|admission_unavailable|redisRetryAt|retireDefaultRedis`
- `COMMAND_TIMEOUT_MS|PLAYBACK_CONTEXT_COMMAND_TIMEOUT_MS|observeAdmissionFailure`
- `HomepageRecommendationsBlock|WATCH_FOR_YOU_ENABLED|WatchForYouRecommendations`
- `runtime.node.event_loop.delay|ETIMEDOUT|internalConnectMultiple`

## What To Build

1. Determine whether the event-loop increase follows the Web source changes,
   instrumentation, cold-cache workload or container resources/network. Compare
   the tested revisions under equivalent load; add targeted diagnostics only if
   the available telemetry cannot distinguish these explanations.
2. Verify primary-host request/error populations rather than treating shared
   `env:prod` metric tags as proof of the primary Railway environment. Preserve
   fixed windows and separate recommendation-route rates from all page traffic.
3. Implement a reproduced, bounded fix if a code defect is established. Do not
   attribute the incident to a frontend defect solely because rollback helped.
4. Preserve the restored Web implementation, canonical block name, profile-first
   fill rules, explicit serving kill switches and new Admin API compatibility.

## Constraints

- No direct Railway deployment or speculative deadline increases.
- Do not discard the new Admin schema, migrations or curation work; the old-Web,
  new-Admin control window was healthy relative to the pre-release baseline.
- Keep cold-start coverage and pool activation in `feat-487`/`feat-488`.
- Do not claim recovery from successful page rendering alone or from a reduction
  in aggregate errors that hides recommendation API failures.
- Preserve the original forwarded preview and unrelated worktrees.

## Verification

- A cause supported by a reproduction or discriminating production evidence;
  current observations establish mitigation, not root cause.
- Relevant real-Redis regression tests if admission behavior changes, plus Web
  lint/type checks, a production build and scoped browser/performance checks.
- Normal PR-to-main deployment followed by fixed pre/post request windows with
  ingestion lag, actual playback, profile feedback, seeded recommendation fill,
  and GA/RUM request receipts. Keep primary/secondary environments separate.
- Restore the source-free homepage block only with six-card local validation and
  a healthy production observation; activation still requires the separate
  curation/eligibility requirements in `feat-488`.

## Current investigation

- A regression test reproduces cross-request cancellation: a 250 ms admission
  timeout destroys the shared Redis socket while a concurrent playback admission
  still has its 500 ms budget. Drain active admissions before closing the retired
  socket, retaining existing deadlines, fail-closed behavior and retry backoff.
- Current primary-host traces also show Admin accepting playback after Web's
  3-second timeout. A simultaneous homepage request has hundreds of per-video
  preferred-dub lookups. The bounded loader reduces actual homepage SQL from
  1,337 to 40; four concurrent requests reduce peak connection queueing from
  1,003 to 19 on the same local pool. PostgreSQL selection tests and exact
  multilingual GraphQL parity pass, alongside the full Admin suite and build.
  This reproduces avoidable contention, not the complete historical incident.
- Redis cancellation fix #2276 and Admin batching #2278 are merged and deployed.
  Web restoration #2279 and serving defaults #2280/#2281 are also deployed.
  Continue investigating residual runtime failures using fixed windows.
- Fixed-window evidence and remaining deployment checks:
  `docs/operations/watch-runtime-diagnosis-2026-09-14.md`.
- The 15 September recovery pass reproduces a browser budget mismatch and
  terminal handling of transient HTTP-200 delivery failures. The Web row now
  permits three 3-second attempts separated by the 5-second admission cooldown;
  Admin retrieval/issuance/release waits stay inside their existing deadline.
  Stage diagnostics distinguish state/history/retrieval/issuance failures.
- `forge.watch.homepageRecommendations` gates both Web availability and delivery,
  default off, using verified Watch account subject/email. Keep the English
  homepage's authored block removed per owner instruction. Production needs an
  LD server SDK key before account targeting can take effect. Do not enable a
  blanket production fallback to simulate targeting.
- Late Admin work and Web event-loop stalls remain confirmed observations, with
  the underlying shared-runtime source unresolved. Keep this ticket open. See
  `docs/plans/2026-09-15-fix-homepage-recommendation-recovery.md` for trace IDs and
  the bounded recovery scope.
- The next pass reproduces shared Web starvation under cached catalog traffic.
  The English inventory response is 9.5 MB; Next's synchronous ETag hash is the
  dominant CPU hotspot. Disabling generated page ETags (retaining ISR and
  Cache-Control) changes a matched local probe from 3/17 profile HTTP 503s to
  0/20, and maximum event-loop delay from 481 ms to 155 ms. See
  `docs/solutions/performance-issues/watch-etag-hashing-starves-recommendation-admission-20260915.md`
  and `apps/web/scripts/probe-recommendation-runtime.mjs`. Production verification
  remains required; keep the authored homepage block removed.
- Production after #2297 isolated an early Redis-clock expiry: the profile
  request failed in 184 ms inside its 250 ms budget. Refresh once only after
  Lua explicitly confirms no mutation, sharing the original monotonic deadline.
  Red/green real-Redis proof includes single increment and no late retry writes.
  See `docs/solutions/performance-issues/redis-clock-sample-can-expire-admission-early-20260915.md`.
  Genuine later event-loop timeouts remain under investigation; keep open.
- The Web ETag fix is merged in #2297. A separate primary-host trace reveals
  legacy contextual recovery running 34 serial SQL queries past Web's 6.5-second
  deadline. The exact combined query retains every seed and candidate rule;
  local Augustine service parity improves 32,129 ms / 37 statements to 933 ms /
  three statements with an identical six-item response. The isolated Postgres
  regressions pass. See
  `docs/solutions/performance-issues/contextual-recommendations-repeat-catalog-work-20260915.md`.
  Production deployment and verification remain pending.
- #2298 contextual recovery is deployed: five production probes return six
  distinct candidates, including JESUS in English/Spanish/French, in 666–2,591
  ms. Startup source-free probes still isolate curated metadata/issuance delays.
  A single metadata snapshot reduces native cold retrieval from eight SQL
  statements to five, preserving full English/French/Hindi output and live
  eligibility. See
  `docs/solutions/performance-issues/curated-fallback-serial-metadata-reads-exhaust-budget-20260915.md`.
  #2299 Redis clock refresh is merged; continue through deployment monitoring.
- The Redis clock fix still left a reproduced callback-starvation failure:
  healthy Redis TIME fails when page processing blocks the same Node loop for 350 ms.
  The isolated admission worker succeeds with the main loop blocked for 650 ms while
  preserving atomic limits and late-write prevention. Two cache-codec experiments
  were rejected for residual stalls or page-loading regressions. Worker build,
  lifecycle, performance and deployment validation remain in progress in
  `docs/plans/2026-09-15-fix-admission-event-loop-isolation.md`.
