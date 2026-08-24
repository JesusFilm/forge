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

Pull request: [JesusFilm/forge#2003](https://github.com/JesusFilm/forge/pull/2003)

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

1. Start with the user's job: social posting, sending to people, offline use, or website/production reuse.
2. Tailor the next step to the chosen destination. Facebook receives a Watch-page link; YouTube and Instagram do not receive embed code; website embed appears only in the website path.
3. Explain that Share Link and the Facebook action post a link to the current Watch page rather than uploading the film.
4. Explain that Embed Code is iframe HTML for websites that accept custom HTML and cannot be pasted into an ordinary social-media post.
5. Distinguish download and public screening from native social upload or republication and from reusing clips in another production without inventing new legal policy.
6. Route permission questions to the approved existing licensing channel and keep policy-bearing copy sourced from approved public or support guidance.
7. Record bounded, non-personal intent and licensing analytics.
8. Preserve existing share, embed, download, canonical URL, lazy-loading, SSR, and hydration behavior.

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

- Rebuilt Share around the user's job: social posting, sending to people, offline use, or website/production reuse. Each result now exposes only the relevant link, embed, download, guidance, or licensing action without changing the existing Facebook, X, copy-link, iframe, or download outputs.
- Added distinct paths for download/public screening, native social upload/republication, and clip reuse. Published guidance routes to the existing FAQ; permission requests route to the approved licensing intake form without an outcome promise.
- Added bounded, non-personal Google Analytics events and made a throwing analytics sink non-blocking.
- Kept video guidance behind the existing lazy boundary and moved the Series Share modal behind the same intent-mounted dynamic boundary.
- Added 43 new `ShareModal` paths to every shipped catalog as explicit pending English fallback. Translation credentials were unavailable, so no translated or human-reviewed status was claimed. Reusing settled labels and locale-neutral platform names kept the complete current-locale namespace increase to 1,011 gzip bytes against the immutable base, within the 1 KiB transfer gate.
- Final focused validation passed 58/58 Share, Watch, Series, and analytics tests. Message parity passed 458/458 and client/provisional catalog checks passed 10/10. Full web typecheck, scoped lint, production build, provisional-catalog validation, Prettier, and diff checks passed.
- The final production build keeps all Share-containing chunks out of the six-file root main manifest, so the redesign adds no initial Share request. The three context-specific lazy chunks remain between 6.4 KiB and 12.8 KiB gzip; the largest is 3.5 KiB above the immutable-base Share chunk and remains within the 10 KiB transfer gate.
- Integrated Chromium QA traversed and captured all ten states at 1668 by 943 desktop and 390 by 844 mobile. The flow has no page or modal horizontal overflow, forward navigation focuses the result heading, Back focuses the chooser heading, and the shared close control remains inside the dialog tree without `aria-hidden`. Browser logs contained only the driver extension's own frame warning and the temporary QA poster's development-only LCP hint; no app exception or hydration error occurred. Firefox/WebKit remain an explicit skip because the approved local harness exposed only integrated Chromium.
- Final screenshot evidence is stored under `/tmp/fge64-share-flow-final`, including `desktop-all-steps.png`, `mobile-all-steps.png`, and `comparison-reference-desktop.png`.
- Compounding found the staged-loading, Share ownership, and provisional-catalog patterns already documented; no duplicate solution document was created.
