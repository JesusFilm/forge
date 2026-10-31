---
id: "feat-757"
title: "Restore the HTTP 404 status on Watch not-found responses"
owner: "unassigned"
priority: "P2"
status: "not-started"
start_date: "2026-10-20"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "seo"
---

## Problem

On 2026-10-20, production answered `GET /watch/no-such-page-r01.html` with
HTTP 200, `cache-control: private, no-cache, no-store`, the "This scene isn't
here" body and `<meta name="robots" content="noindex">`. feat-250 required the
custom page to keep the final HTTP 404 status. A 200 with `noindex` keeps the
page out of search results but is a soft 404: crawlers, uptime checks and
analytics cannot tell a missing page from a real one, and RUM counts it as a
successful view. A local `next start` of the same commit also returns 200 for
unknown paths, so the cause is in the app, not Cloudflare. Found in the
2026-10-20 website audit round 01
(`docs/reports/2026-10-20-watch-website-audit-round-01.md`).

## Entry Points — Read These First

1. `apps/web/src/proxy.ts` — `buildNotFound` rewrites misses to the internal
   `/{locale}/{htmlLang}/404` sentinel; `rewriteToInternal` decides the status.
2. `apps/web/src/app/[locale]/[htmlLang]/404/page.tsx` and `layout.tsx` — the
   sentinel route that should call `notFound()`.
3. `docs/roadmap/platform/feat-250-watch-custom-not-found-page.md` — the
   original contract and its verification steps.

## Grep These

- `buildNotFound`, `WATCH_UNAVAILABLE_SENTINEL_PATH`
- `notFound()` under `apps/web/src/app/[locale]/[htmlLang]/404`
- `WATCH_ORDINARY_NOT_FOUND_INTERNAL_PATHS`

## What To Build

- Find where the status became 200 (sentinel prerendered as a static 200
  page, rewrite status, or a regression since feat-250) with a failing test
  first.
- Restore `404` for ordinary misses and the unavailable-language sentinel,
  keeping the custom body, `noindex`, the chrome-language `<html lang>` and
  valid routes unchanged.

## Constraints

- Do not make valid Watch routes dynamic or change their caching.
- Do not change URL normalization, redirects or language admission.

## Verification

- `curl -s -o /dev/null -w '%{http_code}' <origin>/watch/no-such-page.html`
  returns `404` under `next start` and, after deploy, in production.
- A valid film, series, inventory and language-home URL still return 200.
