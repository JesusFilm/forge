---
id: "feat-630"
title: "Render the Watch native ordinary not-found page"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-08"
completed_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "routing"
  - "accessibility"
---

## Problem

The ordinary Watch 404 rewrite returns Next's bare global error shell instead
of the Watch recovery page. Keep the real HTTP 404 and noindex response while
rendering the localized title, heading, and recovery links.

## What To Build

- Make the `/404` sentinel reliably enter a Watch-owned not-found boundary.
- Preserve proxy rewrite targets, rewrite admission, status, noindex, and
  chrome-language document semantics.
- Add a route-level regression test for the ordinary sentinel and verify the
  unavailable-language sentinel remains specialized.

## Entry Points

- `apps/web/src/app/[locale]/[htmlLang]/404/page.tsx`
- `apps/web/src/app/[locale]/[htmlLang]/404/layout.tsx`
- `apps/web/src/app/[locale]/[htmlLang]/not-found.tsx`
- `apps/web/src/app/[locale]/[htmlLang]/unavailable/404/page.tsx`
- `apps/web/src/components/WatchNotFound.tsx`

## Constraints

- Do not change the proxy rewrite target or admitted internal rewrite paths.
- Keep an HTTP 404, `noindex`, and chrome-language document semantics.
- Keep the unavailable-language not-found page specialized.

## Verification

- Focused sentinel and routing tests.
- Web typecheck, lint, formatting, and diff checks.
- Preview response remains status 404, contains a title, `watch-not-found-heading`,
  and recovery links, and retains `noindex`.

## Completion Evidence

- Added a local `/404` not-found boundary under the Watch chrome layout and
  made the sentinel dynamic with an explicit route locale.
- Moved localized title and `noindex` metadata to the route layout so it
  survives the sentinel's `notFound()` throw.
- Built and started the production Web app with worktree-only environment
  values. Both an ordinary unknown slug and an unavailable-language slug
  returned HTTP 404 with a localized title and `noindex`; browser DOM confirmed
  the Watch heading and two recovery links render.
- Ten focused not-found and unavailable-language tests passed. Web typecheck,
  lint, production build, scoped Prettier, and `git diff --check` passed.
