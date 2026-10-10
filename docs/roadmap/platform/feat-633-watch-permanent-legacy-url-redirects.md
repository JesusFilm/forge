---
id: "feat-633"
title: "Return 308 for permanent Watch legacy-URL normalizations"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "seo"
---

## Problem

`canonicalizeWatchPath` returns `307` + `cache: "short"` for every legacy-URL
normalization except the trailing-slash strip, and `proxy.ts` ignores the
`cache` intent entirely: every redirect carries `Cache-Control: private,
max-age=0`. Live: `/watch/jesus.HTML` → `307`; `/watch/videos` → `307` →
`/watch/languages`. These moves are permanent, but a 307 tells crawlers to keep
the old URL indexed and not consolidate link equity onto the canonical one.
Linear: FGE-198 (audit W-069).

## Entry Points — Read These First

1. `apps/web/src/lib/url-canonicalize.ts` — the rule chain and the
   status/cache computation at the end of `canonicalizeWatchPath`.
2. `apps/web/src/proxy.ts` — `buildRedirect`, `REDIRECT_CACHE_CONTROL`, and
   the canonicalize branch of `proxy()`.
3. `apps/web/src/lib/url-canonicalize.test.ts` and `apps/web/src/proxy.test.ts`
   — per-rule status/cache expectations.
4. `docs/plans/2026-05-27-002-feat-watch-url-html-shape-i18n-restructure-plan.md`
   — "Cache discipline on 30x responses": the stable-normalization tier is
   `public, max-age=3600, s-maxage=86400`; cookie/user-state redirects stay
   uncacheable.

## Grep These

- `onlyTrailingSlashChanged`
- `cache: "short" | "long"`
- `REDIRECT_CACHE_CONTROL`
- `buildRedirect(`

## What To Build

- Rules 1, 1.5, 2, 3, 4, 4.5 and 6 are permanent: `status: 308`,
  `cache: "long"`.
- Rule 5 (single-segment `/{seg}` → `/{seg}.html/{seg}.html`) stays
  `307` / `short`. Its target is known to 404 for real content slugs; FGE-203
  (W-070) replaces it. Any redirect Rule 5 contributes to is temporary.
- `proxy.ts` maps `cache: "long"` to
  `public, max-age=3600, s-maxage=86400` and `cache: "short"` to the existing
  `private, max-age=0`.

## Constraints

- Only the canonicalize branch changes. Manifest-admission redirects (301 /
  307), the missing-homepage redirect, deprecated `/search` (307) and the
  visible-internal-prefix 308 keep `private, max-age=0`.
- Long-cache output must depend only on the request path: never apply it to a
  redirect that reads cookies, headers or the live route manifest.
- Keep the long tier bounded (one day at the edge) so a mistaken
  normalization drains without a purge.
- Rule 4 is permanent by decision even though it also normalizes junk paths
  (`/en/english` → `/en.html/english.html`, which 404s). The shape move is
  path-only and stable; a junk source and its 404 target both drop from the
  index, and the bounded lifetime limits the cost. `history` joins the
  one-segment exemptions so `/history/` never chains into a cached 404.
- Supersedes the env-flag tier in
  `docs/plans/2026-05-27-002-feat-watch-url-html-shape-i18n-restructure-plan.md`
  (dated note added there).

## Verification

- `pnpm --filter @forge/web exec vitest run src/lib/url-canonicalize.test.ts src/proxy.test.ts`
- `pnpm --filter @forge/web typecheck` and `pnpm --filter @forge/web lint`
- After deploy: `curl -sI https://watch.jesusfilm.org/watch/jesus.HTML` → `308`
  with `cache-control: public, max-age=3600, s-maxage=86400`;
  `curl -sI https://watch.jesusfilm.org/watch/jesus` → still `307` with
  `private, max-age=0`.
