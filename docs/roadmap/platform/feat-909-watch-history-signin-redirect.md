---
id: "feat-909"
title: "Send signed-out Watch History visitors to sign-in, not the 404 page"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-20"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "auth"
---

## October 29 current-main update

Renumbered from feat-756 because main assigned that ID to anonymous Watch
exposure retention. Preserve that separate ticket unchanged. The redirect
repair still uses a base-relative login destination and a full public returnTo
path, with no rendering or client initialization changes.

## Problem

On 2026-10-20, a signed-out visitor opening `https://www.jesusfilm.org/watch/history`
was sent to `/watch/watch/api/auth/login?returnTo=%2Fwatch%2Fhistory` and saw
the "This scene isn't here" not-found page instead of sign-in. The page
called `redirect(watchPath("/api/auth/login") + …)`; Next's `redirect()`
already prepends the `/watch` basePath, so the base path appeared twice.
Found in the 2026-10-20 website audit round 01
(`docs/reports/2026-10-20-watch-website-audit-round-01.md`).

## Entry Points — Read These First

1. `apps/web/src/app/[locale]/[htmlLang]/history/page.tsx` — the signed-out
   redirect.
2. `apps/web/src/app/api/auth/login/route.ts` — reads `returnTo` as a full
   public path through `toAbsoluteWatchURL`.
3. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` — sibling
   `redirect()` calls that already pass base-relative paths.

## Grep These

- `redirect(` under `apps/web/src/app` combined with `watchPath(`
- `api/auth/login`

## What To Build

- Pass the base-relative `/api/auth/login?returnTo=…` to `redirect()`; keep
  `returnTo` as the full public `/watch/history` path.
- Pin the exact redirect target in `history/page.test.tsx`.

## Constraints

- Do not change the login route, OAuth configuration or session handling.
- Localized history routes (`/{lang}.html/history`) still return to the
  English `/watch/history`; changing that is a separate decision.

## Verification

- `pnpm --filter @forge/web exec vitest run 'src/app/[locale]/[htmlLang]/history'`
  (the new case fails with the old line restored).
- `next build` + `next start`: signed-out `/watch/history` targets
  `/watch/api/auth/login?returnTo=%2Fwatch%2Fhistory`, which answers 307 to
  the configured authorize URL.
