---
id: "feat-315"
title: "Watch language-less Video defaults to English"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-24"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "routing"
  - "seo"
---

## Problem

Durable inbound links still point to language-less Watch Video URLs such as
`/watch/jesus.html`. Forge historically treated a bare Video slug as English,
but the current route-manifest gate sends that URL to the shared 404 even
though `/watch/jesus.html/english.html` is a valid canonical route.

## Entry Points — Read These First

1. `docs/plans/2026-07-24-004-fix-watch-language-less-english-default-plan.md` -
   implementation plan and compatibility history.
2. `apps/web/src/proxy.ts` - public Watch canonicalization, manifest admission,
   internal rewrites, and fixed 404 routing.
3. `apps/web/src/proxy.test.ts` - proxy request/response contract coverage.
4. `apps/web/src/lib/watch-route-manifest.ts` - exact content/audio and
   one-segment collection admission.
5. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` - public shape
   dispatch and English Video rendering.

## Grep These

- `classifyManifestAdmission`
- `isWatchRouteAdmittedByManifest`
- `kind: "one-segment"`
- `publicWatchAudioLanguageSlugForLocale`
- `renderVideo`

## What To Build

1. Preserve admitted one-segment collection and language-home behavior.
2. When a safe one-segment slug is not an admitted collection, evaluate its
   English standalone Video route against the same manifest.
3. Admit that request only when the English Video/language route exists, then
   internally rewrite it through the existing two-segment English route while
   leaving `/{slug}.html` visible.
4. Keep query parameters on the unchanged public URL.
5. Keep the fixed 404 for unknown slugs, Videos without an admitted English
   Dub, and manifest-unavailable non-collection routes.

## Constraints

- Do not redirect the language-less URL to `/english.html`.
- Do not redirect one-segment collections or public language homes.
- Do not infer a target from `Accept-Language`, cookies, or message locale.
- Do not fetch the route manifest more than once per request.
- Do not weaken manifest admission for random safe-looking slugs.

## Verification

- `pnpm --filter @forge/web exec vitest run src/proxy.test.ts`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Direct HTTP proof covers the `200`, absence of `Location`, default-English
  internal rewrite, collection rewrite, and fixed 404 fallback.
- Browser smoke renders the English Video while the visible language-less URL
  and query string remain unchanged.
