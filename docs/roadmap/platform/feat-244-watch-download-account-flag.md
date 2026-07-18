---
id: "feat-244"
title: "Watch Download Account Gate Feature Flag"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-09"
duration: 2
depends_on:
  - "feat-146"
blocks:
  - "feat-264"
tags:
  - "platform"
  - "accounts"
  - "auth"
  - "web"
  - "download"
  - "launchdarkly"
---

## Problem

PR #1443 introduced account-required Watch downloads, and follow-up work made
that gate unconditional. Watch now needs the previous anonymous download
behavior restored as the default while keeping the current account-required
download flow available behind a LaunchDarkly flag.

## Entry Points - Read These First

1. `apps/web/src/app/api/download/route.ts` - streams same-origin download
   responses and currently requires an authenticated Web session for `GET`.
2. `apps/web/src/components/watch/WatchPageClient.tsx` - checks session state
   before opening the download modal.
3. `apps/web/src/components/watch/DownloadModal.tsx` - renders the current
   account-required state and re-checks session before triggering a download.
4. `apps/web/src/components/watch/download-session-access.ts` - converts the
   session API response into download-access state.
5. `apps/web/src/lib/feature-flags.ts` and
   `packages/feature-flags/src/registry.ts` - define server-side
   LaunchDarkly-backed Watch flags.
6. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` - evaluates
   Watch page flags on the server and passes them to the client boundary.

## Grep These

- `requireDownloadAccount`
- `resolveDownloadSessionAccess`
- `authRequiredLoginUrl`
- `recordWatchEventWithAccessToken`
- `isWatchCtaTextCopyEnabled`
- `forge.watch`

## What To Build

- Add a server-side LaunchDarkly flag for the Watch download account gate with
  a default of `false`.
- Restore anonymous `GET /watch/api/download` as the default path while keeping
  the existing SSRF, redirect, range, filename, opaque target, and streaming
  defenses.
- Keep the current session-checking modal behavior when the new flag evaluates
  `true`.
- Avoid serializing raw upstream media/download URLs to the browser.
- Keep signed-in download event recording best-effort when the gate is enabled
  and an access token is available; do not make anonymous downloads depend on
  event recording.

## Constraints

- Do not remove the Auth routes, session verifier, account control, or watch
  event plumbing that other account features now use.
- Do not reintroduce raw CDN download URLs in client props.
- Do not expose the LaunchDarkly server-side SDK key to client code or
  `NEXT_PUBLIC_*` variables.
- Do not require an account by default in local, preview, or production
  fallback configuration.

## Verification

- Unit tests prove default signed-out `GET /watch/api/download` no longer
  returns `401`.
- Unit tests prove the same route returns `401` when the new flag is enabled
  and the request is signed out.
- Component tests prove the default Watch download button opens the download
  modal without session preflight.
- Component tests prove the flagged Watch path still shows the sign-in
  download state for signed-out users.
- Targeted `@forge/web` tests cover the route, modal, page flag threading, and
  feature flag fallback.
- Browser smoke verifies a Watch page can open the download modal by default
  while signed out and captures visual proof.

## Completion Notes

- Restored anonymous Watch downloads as the default via the default-off
  `forge.watch.downloadAccountGate` flag.
- Kept the account-required flow working in flagged mode through the dynamic
  session check and the authoritative `/watch/api/download` route gate.
- Anonymous attachment downloads now require opaque
  `downloadId`/`variantId`/`videoSlug` identifiers; raw `url` GETs stay limited
  to inline media or authenticated flagged requests.
- Targeted local validation passed for feature flags, session mode, download
  route behavior, Watch client flow, and download modal behavior.
- Signed-out browser smoke passed at
  `http://localhost:3105/watch/jesus.html/english.html`: the page rendered a
  direct same-origin `/watch/api/download?...` Download link with opaque IDs,
  `/watch/api/auth/session?callbackURL=...` returned
  `accountGateEnabled:false` and `authenticated:false`, and `HEAD` on that
  download URL returned `200`. Visual proof:
  `output/playwright/watch-download-anonymous-link-visible.png`.
