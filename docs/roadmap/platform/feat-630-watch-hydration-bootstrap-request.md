---
id: "feat-630"
title: "Watch: batch post-hydration visitor reads and defer the profile POST"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 2
depends_on: []
blocks: []
tags:
  - "web"
  - "infrastructure"
---

## Problem

Linear FGE-225 (2026-09-13 `/watch` listing audit, finding W-028). Four
uncacheable same-origin requests fired from bare mount effects on every Watch
page load, competing with LCP and hero media:

1. `AccountControl` → `GET /watch/api/auth/session`
2. `BetaTesterModalProvider` → `GET /watch/api/beta-tester-cta`
3. `watch-progress-client` `ensureWatchProgressAuth` → `GET /watch/api/watch-progress`
4. `RecommendationConsentShell` → `POST /watch/api/recommendations/profile`

All four return `cf-cache-status: DYNAMIC`. The first three answer one question
(who is this visitor) and each verified the session separately.

## Entry Points — Read These First

1. `apps/web/src/app/api/bootstrap/route.ts`: the combined
   `watch-bootstrap-v1` read. Verifies the session once, evaluates both flags
   concurrently, and reads progress only for a verified account. The
   bootstrap-only progress read is aborted after 1.5 seconds; account and CTA
   data still return while progress degrades to `null`. Other section failures
   also fail independently. `Cache-Control: private, no-cache, no-store,
must-revalidate`.
2. `apps/web/src/lib/watch-bootstrap-contract.ts`: client-safe types and the
   per-section parser.
3. `apps/web/src/lib/watch-bootstrap-client.ts`: single-flight, once-per-document
   loader. Success is cached for the document; a failure is forgotten so the
   next mount retries.
4. `apps/web/src/lib/account-session-response.ts`: the one account-session body
   builder used by both `/watch/api/auth/session` and the bootstrap.
5. `apps/web/src/components/watch/BetaTesterModalProvider.tsx`:
   `loadGlobalBetaTesterCtaEnabled` — first mount reads the bootstrap; each
   client navigation re-evaluates through `/watch/api/beta-tester-cta` as before.
6. `apps/web/src/lib/idle-task.ts` + `RecommendationConsentShell.tsx`: the
   profile bootstrap waits for `requestIdleCallback` (cap
   `RECOMMENDATION_PROFILE_IDLE_TIMEOUT_MS = 1_500`), or for `load` plus one
   task where `requestIdleCallback` is missing (Safari); unmount cancels it.

## Grep These

- `watch-bootstrap-v1`
- `loadWatchBootstrap`
- `buildAccountSessionBody`
- `scheduleIdleTask`
- `RECOMMENDATION_PROFILE_IDLE_TIMEOUT_MS`

## What To Build

Done in this ticket's change:

```ts
type WatchBootstrapResponse = {
  contractVersion: "watch-bootstrap-v1"
  account: WatchAccountSession | null // null → AccountControl hidden
  betaTesterCta: { enabled: boolean } | null // null → floating CTA off
  watchProgress: WatchBootstrapProgress | null // null → progress stays local
}
```

Kept on purpose:

- `/watch/api/auth/session` (download session check, cached old clients).
- `/watch/api/beta-tester-cta` (per-navigation re-evaluation, old clients).
- `GET /watch/api/watch-progress` (cached old clients during rollout) and its
  `POST`/`DELETE`.

Follow-up once a deploy has aged out old HTML: decide whether the
watch-progress `GET` can be retired.

## Constraints

- No consent prerequisite: the profile POST is deferred, never gated. Follow
  `docs/analytics-and-recommendation-policy.md`.
- Do not move the bootstrap into RSC or a static layout; Watch pages are
  statically cached and this data is per visitor.
- Do not echo the session access token; progress stays account-bound.
- Do not change GA or Datadog wiring. `AccountControl` still identifies or
  clears the Datadog RUM user from the account section.
- Keep the idle cap plus the 3 s profile upstream budget under the 5 s browser
  deadline that playback evidence applies to the profile bootstrap.

## Verification

```bash
pnpm --filter @forge/web exec vitest run \
  src/app/api/bootstrap src/app/api/auth/session \
  src/components/watch/__tests__/watch-hydration-requests.test.tsx \
  src/components/watch/__tests__/AccountControl.test.tsx \
  src/components/watch/BetaTesterModalProvider.test.tsx \
  src/lib/watch-progress-client.test.tsx src/lib/idle-task.test.ts \
  src/components/recommendations/RecommendationCookieBanner.test.tsx
pnpm --filter @forge/web typecheck
pnpm --filter @forge/web lint
```

`watch-hydration-requests.test.tsx` mounts all four consumers together and
asserts the hydration request list is exactly `GET /watch/api/bootstrap`
(previously four requests), with the profile POST only after idle.

Before marking complete: on a deployed or local `next build` + `next start`
page, confirm in the network panel one bootstrap request at hydration, the
profile POST after load, no change in LCP, and that Datadog RUM and GA page
views still arrive.
