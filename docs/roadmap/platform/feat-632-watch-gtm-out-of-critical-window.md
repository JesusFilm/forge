---
id: "feat-632"
title: "Move the Google tag out of the Watch critical window"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "analytics"
  - "performance"
---

## Problem

Linear FGE-217 (W-026, from the 2026-09-13 `/watch` listing audit). The Watch
head carries
`<link rel="preload" href="https://www.googletagmanager.com/gtag/js?id=…" as="script">`
at default priority, so the Google tag is fetched inside the LCP window. It is
also the largest third-party main-thread consumer: 16 ms unthrottled, 73 ms at
4x CPU, plus a forced reflow (`gtag/js:879`).

The preload comes from Next itself. In `next/dist/client/script.js`
(next 16.3.8) an App Router `<Script src strategy="afterInteractive">` calls
`ReactDOM.preload(src, { as: "script" })`. `lazyOnload` makes no preload call
and loads the script after `window` `load` plus `requestIdleCallback`.

## Entry Points — Read These First

1. `apps/web/src/components/GoogleAnalytics.tsx` — `GoogleAnalyticsScripts`:
   the external tag `<Script src>` and the inline `google-analytics-init`
   bootstrap.
2. `apps/web/src/components/__tests__/GoogleAnalytics.test.tsx` — strategy
   and bootstrap assertions.
3. `docs/operations/watch-ga4-measurement.md` § 1 — the documented loading
   baseline.
4. `docs/analytics-and-recommendation-policy.md` — GA page views, navigation
   and interaction events must stay configured.

## Grep These

- `strategy="afterInteractive"` / `strategy="lazyOnload"` in `apps/web/src`
- `googletagmanager.com/gtag/js`
- `typeof window.gtag` (readiness checks that depend on the bootstrap stub)

## What To Build

- External tag: `strategy="lazyOnload"`. No head preload, loads after `load`.
- Bootstrap: stays `strategy="afterInteractive"`. It is inline (no network
  request) and defines `window.gtag` as a `dataLayer` push. Every readiness
  check (`GoogleAnalyticsPageViews`, `reportGoogleAnalyticsEventWhenReady`,
  `GoogleAnalyticsRouteChanges`) keys on `typeof window.gtag === "function"`,
  so they see the stub early and their calls queue in `dataLayer`. The tag
  replays the queue when it arrives. Moving the bootstrap to `lazyOnload` too
  would push readiness past the 10 s page-view retry budget on slow loads and
  drop page views, so it must not move.

- v1 only: the bootstrap `config` and the route-change `config` pass
  `page_location: window.location.href` and `page_title: document.title`.
  gtag.js reads location and title when it PROCESSES a queued command, not
  when it was pushed. Verified by hand 2026-10-08 (Chrome 154, live gtag.js,
  `/g/collect` bodies): with a bare `config` queued on `/a/`, a
  `pushState` to `/b/`, then a late tag load, the landing `page_view` and an
  event fired on `/a/` were both sent with `dl=/b/`. With the values captured
  at call time they were sent with the landing URL, and the route-change view
  with the new one. These are the values gtag.js read when it loaded early, so
  v1 reporting is unchanged. v2 is left alone: its page views pin their own
  fields, and pinning its bootstrap would freeze later events to the landing
  URL because v2 has no route-change `config`.

## Constraints

- Do not change event names, params, page-view ownership, the v2 flag, or the
  measurement ID.
- Do not drop the bootstrap's early position.
- No new env vars, no consent prerequisite (policy).

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/__tests__/GoogleAnalytics.test.tsx`
  — strategy pins plus a test that runs the bootstrap with no tag present and
  proves `config` and an event queue in `dataLayer`.
- `pnpm --filter @forge/web typecheck`, `lint`, and Prettier on changed files.
- `next build` + `next start` with a synthetic measurement ID: the served HTML
  has no `rel="preload"` for `googletagmanager.com`, and the tag request starts
  after the `load` event.

## Accepted trade-off

- A visitor who leaves before `load` + idle now sends nothing: their queued
  `dataLayer` calls never reach GA. Before, the tag could arrive and send
  first.
- GA4 engagement time starts when gtag.js runs, so the time before `load` +
  idle is no longer counted. Expect a small dip in average engagement time and
  in the engaged-session (10 s) rate after deploy. That is measurement, not a
  reader regression.

This is the cost of taking the tag out of the critical window.
