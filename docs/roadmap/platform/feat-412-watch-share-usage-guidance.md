---
id: "feat-412"
title: "Watch share and reuse guidance"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-08-21"
duration: 2
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "share"
  - "accessibility"
  - "analytics"
---

## Problem

Watch users can mistake Facebook Share and iframe Embed Code for ways to upload a full film directly to a social platform. The current modal exposes working share and embed controls without explaining that Facebook receives a Watch-page link, iframe code is for HTML-capable websites, and native republication or clip reuse is a separate permission question.

Customer evidence, including the reported Tagalog _Pilgrim's Progress_ Facebook-sharing confusion, is tracked in [Linear FGE-64](https://linear.app/jesus-film-project/issue/FGE-64/watchux-clarify-film-reuse-permissions-and-route-licensing-requests).

Implementation plan: [`docs/plans/2026-08-21-2229-feat-watch-share-usage-guidance-plan.md`](../../plans/2026-08-21-2229-feat-watch-share-usage-guidance-plan.md)

Follow-up discovery: [Linear FGE-93](https://linear.app/jesus-film-project/issue/FGE-93/watchdiscovery-validate-reuse-guidance-comprehension-and-non-share) owns comprehension validation, support-deflection measurement, and non-Share discoverability.

Review residuals remain out of this scope and are durable in [FGE-94](https://linear.app/jesus-film-project/issue/FGE-94/recover-series-share-after-chunk-failure) and [FGE-95](https://linear.app/jesus-film-project/issue/FGE-95/cover-video-embed-only-share-guidance).

## Entry Points - Read These First

1. `apps/web/src/components/watch/ShareModal.tsx` - existing lazy Share Link, social intent, and Embed Code UI.
2. `apps/web/src/components/watch/__tests__/ShareModal.test.tsx` - share, embed, keyboard-tab, clipboard, and modal coverage.
3. `apps/web/messages/en.json` - source copy for the Watch share namespace.
4. `apps/web/src/components/GoogleAnalytics.tsx` - shared best-effort Google Analytics reporting.
5. `apps/web/src/lib/watch-interaction-loader.ts` - staged modal loading contract.
6. `docs/solutions/conventions/frontend-change-page-load-performance-verification.md` - required performance evidence for frontend changes.

## Grep These

- `ShareModal`
- `buildFbShareUrl`
- `buildEmbedSnippet`
- `reportGoogleAnalyticsEvent`
- `WATCH_CONTENT_CLIENT_MESSAGE_NAMESPACES`
- `ShareModal — Facebook + X share intents`

## What To Build

1. Explain that Share Link and the Facebook action post a link to the current Watch page rather than uploading the film.
2. Explain that Embed Code is iframe HTML for websites that accept custom HTML and cannot be pasted into an ordinary social-media post.
3. Distinguish download and public screening from native social upload or republication and from reusing clips in another production without inventing new legal policy.
4. Route permission questions to the approved existing licensing channel and keep policy-bearing copy sourced from approved public or support guidance.
5. Record non-personal guidance-view and licensing-escalation analytics.
6. Preserve existing share, embed, download, canonical URL, lazy-loading, SSR, and hydration behavior.

## Constraints

- Do not turn Share or Embed into a native social upload flow.
- Do not claim a new permission, restriction, or legal interpretation.
- Do not include message content, names, email addresses, user identifiers, or media titles in analytics.
- Keep the Share modal page-owned and lazy-loaded.
- Keep new client messages available to every Watch locale without claiming unreviewed policy translations are approved.
- Do not deploy directly to production.

## Verification

- Add focused Share modal tests for link/embed explanations, permission routing, analytics payloads, keyboard semantics, and unavailable embed state.
- Run Watch message-parity and client-namespace tests.
- Run `@forge/web` typecheck, lint, and the focused unit suite.
- Browser-smoke desktop and mobile Watch routes in current Chromium, plus cross-browser automation where available.
- Verify SSR HTML, hydration without warnings, unchanged lazy Share chunk loading, and page-loading performance against the branch base.

## Resolution

- Added explicit link-post and website-iframe explanations without changing the existing Facebook, X, copy-link, or embed outputs.
- Added distinct video-use rows for download/public screening, native social upload/republication, and clip reuse. Published guidance routes to the existing FAQ; permission requests route to the approved licensing intake form without an outcome promise.
- Added bounded, non-personal Google Analytics events and made a throwing analytics sink non-blocking.
- Kept video guidance behind the existing lazy boundary and moved the Series Share modal behind the same intent-mounted dynamic boundary.
- Added the 10 new `ShareModal` paths to every shipped catalog as explicit pending English fallback. Translation credentials were unavailable, so no translated or human-reviewed status was claimed.
- Focused validation passed 557/557 tests before simplification and 57/57 after simplification. Full web typecheck, lint, production build, provisional-catalog validation, Prettier, and diff checks passed.
- Immutable base/branch production builds kept initial script count at 32 and reduced aggregate initial JavaScript by 7,862 raw bytes / 3,188 gzip bytes. The Share-containing initial resource left both video and Series routes. Tagalog video HTML grew 690 raw / 294 gzip bytes; Series HTML grew 690 raw / 234 gzip bytes. The lazy Share client chunk grew 3,846 raw / 676 gzip bytes, within the plan gates.
- Local production-read browser inspection passed the Tagalog video, English Series, and Arabic RTL routes with correct headings, no raw translation keys, no horizontal overflow, and no app-attributable console errors. The approved integrated driver could not dispatch clicks, screenshots, or viewport overrides, and the approved fallback was not installed, so first-intent request/latency/CLS, screenshot, mobile/zoom, and cross-engine checks were recorded as skipped rather than claimed.
- Compounding found the staged-loading, Share ownership, and provisional-catalog patterns already documented; no duplicate solution document was created.
