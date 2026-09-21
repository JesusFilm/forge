---
title: "Give homepage recommendation retries independent recovery budgets"
date: "2026-09-15"
category: "ui-bugs"
module: "apps/web Watch homepage recommendations"
problem_type: "ui_bug"
component: "frontend_stimulus"
severity: "high"
symptoms:
  - "Recommended for You shows a terminal page error after one slow request."
  - "An HTTP-200 delivery_timeout response never recovers without a reload."
root_cause: "async_timing"
resolution_type: "code_fix"
tags:
  - "recommendations"
  - "retry"
  - "deadlines"
  - "launchdarkly"
  - "layout-shift"
---

# Homepage recommendation recovery budgets

## Problem and cause

`recommendationJsonWithRetry` bounds the entire retry loop. Passing 2,200 ms and
two attempts does not give each request 2,200 ms. Web admission allows up to
500 ms before a 1,900 ms Admin transport budget; a slow failure therefore
consumed the browser's complete recovery allowance. The component also treated
HTTP-200 `delivery_timeout`, `admission_unavailable` and `service_unavailable`
envelopes as terminal.

Production traces confirmed both late Admin work and a Web admission timer firing
after an event-loop stall. Those infrastructure failures are distinct from the
reproduced client recovery defect. Their exact shared-runtime cause remains in
`docs/roadmap/platform/feat-496-watch-rollout-runtime-recovery.md`.

## Solution

The homepage component owns at most three attempts, each calling the existing
JSON helper with `attempts: 1` and 3,000 ms. A 5,000 ms pause respects admission
cooldown. Retry only transport failures and the explicit transient reason set.
Invalid payloads, denied authority and insufficient coverage remain terminal.
Cancel both fetch and pending retry on unmount or profile/language changes.

Keep the skeleton stable while recovering. After exhaustion, omit the optional
row and report a sanitized RUM outcome. If its space is currently visible,
preserve its measured height until it leaves the viewport: immediately removing
it caused a measurable layout jump in browser validation. Do not retain cards,
capabilities or placeholders across viewer-context changes.

Admin uses `withinDeadline` around serving-state/history, issuance and lease
release, retaining the existing 1,500 ms service budget and PostgreSQL transaction
timeouts. Promise deadlines bound waiting; they cannot interrupt a blocked Node
event loop or retroactively cancel a committed transaction. Structured stage
logs help identify residual failures without exposing viewer tokens.

The default-off flag `forge.watch.homepageRecommendations` is evaluated with a
verified local Watch auth cookie through a private, no-store availability route.
Web delivery independently enforces the same flag before admission. Keep that
decision outside cached homepage rendering. Admin API consumers remain separate.

## Disproved hypothesis

Replacing six nested Prisma item creates with `createMany` did not reduce SQL:
the real PostgreSQL adapter already emits one item insert. Preserve the simpler
original write. Database tests verify six items plus audit commit atomically,
and audit failure rolls back the whole issuance.

## Prevention and verification

- Test a full 2,400 ms upstream failure followed by recovery, not only instant
  rejected promises. Exercise both HTTP errors and HTTP-200 unavailable reasons.
- Test exhaustion, definitive rejection, unmount and stale language responses.
- Verify visible space does not collapse on failure; measure CLS in a browser.
- Exercise signed-in targeting, missing LD configuration, private responses and
  direct unflagged POST rejection. Never simulate account targeting with a
  production-wide true fallback.
- Run `curated-pools.service.db.test.ts` with the migrated local/CI PostgreSQL
  fixture and `RECOMMENDATION_DB_TEST=1`. CI includes this test explicitly.
- A hidden row proves rollout containment, not backend recovery. Monitor actual
  delivery outcomes when targeted traffic is enabled.

## Related learnings

- [Runtime flags outside static Watch caching](../integration-issues/watch-runtime-feature-flag-static-route-cache.md)
- [Recovering from overlapping recommendation admission](watch-recommendation-consent-refresh-in-flight-admission-race.md)
