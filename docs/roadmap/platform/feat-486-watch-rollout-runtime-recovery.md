---
id: "feat-486"
title: "Investigate Watch runtime regression before restoring homepage recommendations"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-09-11"
duration: 3
depends_on: []
blocks:
  - "feat-488"
tags:
  - "web"
  - "recommendations"
  - "infrastructure"
---

## Problem

The disabled-feature Web deployment from #2249 coincided with sustained Redis
admission failures, image connection timeouts and increased event-loop delay.
The Web-only rollback in #2250 reduced errors substantially without restoring the
pre-release baseline in its first fifteen minutes. Existing playback and seeded
recommendations pass fresh browser checks. The cause of the runtime regression
remains unproven, so restoring the homepage feature would repeat an unvalidated
deployment. Broader evidence-transport reliability remains owned by `feat-464`.

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
4. Restore the Web implementation through a focused PR only after the runtime
   explanation and validation support it. Preserve the canonical block name,
   profile-first fill rules, default-off rollout and new Admin API compatibility.

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
