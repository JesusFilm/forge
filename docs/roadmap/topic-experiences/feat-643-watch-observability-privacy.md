---
id: "feat-643"
title: "Restore Watch measurement with privacy-safe RUM"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 1
depends_on:
  - "feat-444"
blocks: []
tags:
  - "web"
  - "watch"
  - "analytics"
  - "privacy"
---

## Problem

Linear FGE-236: Watch RUM sends account email/name, replay captures visible
content, route query values can contain private tokens, and same-origin Watch
API calls do not receive trace propagation. Rail outcomes also lack bounded
analytics events, while personalized responses need explicit private cache
policy.

## Entry Points — Read These First

1. `apps/web/src/components/DatadogRum.tsx` — RUM identity, privacy, and tracing.
2. `apps/web/src/components/recommendations/WatchExposureBoundary.tsx` — rail eligibility and selection.
3. `apps/web/src/app/api/watch-progress/route.ts` — authenticated watch history.
4. `apps/web/src/lib/recommendation-route-response.ts` — private recommendation responses.

## Grep These

- `identifyDatadogRumUser`
- `defaultPrivacyLevel`
- `allowedTracingUrls`
- `WatchExposureBoundary`
- `RECOMMENDATION_PRIVATE_HEADERS`
- `watch-progress`

## What To Build

- Send only opaque user IDs to Datadog; mask replay text; strip query and
  fragment components from view, referrer, resource, and error-resource URLs.
- Keep Session Replay sampling disabled because the installed SDK serializes
  `window.location.href` into replay metadata outside `beforeSend`; re-enable it
  only after that metadata can be redacted safely.
- Add trace propagation only for same-origin `${WATCH_BASE_PATH}/api/` requests.
- Emit rail impression and click RUM actions using finite surface, block,
  presentation, visibility, and position buckets; never send content IDs, hrefs,
  titles, or CMS placements. Project `rail_impression` and `rail_item_clicked`
  through the typed GA contract with the same finite dimensions.
- Apply `private, no-store` and `Vary: Cookie` to watch-progress and recommendation
  responses, including errors.

## Constraints

- Preserve both configured GA and Datadog integrations; consent is not required.
- Do not enable the GA4 v2 production flag or access the live property.
- Production flag enablement and the runbook smoke assertion remain an operator
  follow-up; do not claim production measurement is live from this PR.
- Do not emit PII, raw query strings, content identifiers, titles, or URLs.
- Keep tracing scoped to the canonical Watch API path.

## Verification

- `pnpm exec vitest run src/components/__tests__/DatadogRum.test.tsx src/components/recommendations/WatchExposureBoundary.test.tsx` from `apps/web`.
- Add route tests proving `Cache-Control` and `Vary` on success and error paths.
- Run web typecheck and focused lint/format checks.
