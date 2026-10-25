---
id: "feat-321"
title: "Add language-less English contextual Watch routes"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-27"
duration: 1
depends_on:
  - "feat-318"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "routing"
  - "seo"
---

## Problem

English standalone Watch links now omit the language slug, but contextual
episode links still require explicit English. A valid parent-child route such
as
`/watch/lumo-the-gospel-of-john.html/lumo-john-1-1-34.html`
therefore returns 404 even though its explicit-English contextual equivalent
renders successfully.

## Entry Points — Read These First

1. `docs/plans/2026-07-27-001-fix-watch-language-less-contextual-english-plan.md`
   - reviewed implementation and validation plan.
2. `apps/web/src/lib/routes.ts`
   - typed public and explicit Watch route builders and parser.
3. `apps/web/src/proxy.ts`
   - public-route classification, manifest admission, and internal rewrites.
4. `apps/web/src/lib/watch-route-manifest.ts`
   - parent-child and per-episode audio-language admission.
5. `apps/web/src/lib/watch-url-probe.ts`
   - production-to-preview public URL regression matrix.

## Grep These

- `watchEpisodePath`
- `parseWatchPath`
- `classifyRewrite`
- `classifyManifestAdmission`
- `audioLanguageIndexesByEpisode`
- `WATCH_DIRECT_PATH_CONTRACTS`

## What To Build

1. Emit and directly serve
   `/watch/{parent}.html/{episode}.html` for eligible English contextual
   episodes without changing the visible URL or query.
2. Preserve explicit-English contextual URLs as direct compatibility routes.
3. Preserve explicit Romanian, Spanish, Russian, and all other non-English
   contextual URLs.
4. Keep public-language and legacy-language-alias precedence for ambiguous
   second segments.
5. Require exact manifest proof of the parent-child-English relationship, then
   preserve the two-segment internal route shape while dispatching to the
   existing contextual renderer.
6. Keep contextual canonical, Open Graph, JSON-LD, and Share identity on the
   language-less standalone child.

## Constraints

- Do not redirect an admitted short English contextual route.
- Do not widen arbitrary static-route or ISR admission during a manifest
  outage.
- Do not change Admin GraphQL or route-manifest payload contracts.
- Do not publish contextual URLs in sitemap output.
- Preserve existing invalid-context standalone fallback and fixed-404 behavior.

## Verification

- Focused route-builder, canonicalizer, proxy, manifest, page-routing, client
  navigation, share, structured-data, sitemap, and probe tests.
- Complete Web test, typecheck, lint, and production build.
- Browser smoke covering an English homepage thumbnail, contextual playback,
  language switching, Share, and console/network health.
- Production-to-preview URL matrix covering English shorthand and compatibility,
  Romanian, Spanish, Russian, language collisions, invalid pairs, unknown/no-
  English children, queries, and passthrough routes.
- Pull request checks green and mergeable; do not merge in this work item.

## Completion Evidence

- Added language-aware contextual route generation and parsing with collision
  safeguards for public language slugs and legacy language aliases.
- Added exact parent-child-English manifest admission and fail-closed handling
  for the new shorthand while preserving explicit-language compatibility and
  invalid-context fallback behavior.
- Preserved the short internal route shape after browser testing exposed that
  expanding it to the explicit-English shape caused a hydration mismatch.
- Passed the 134-URL production-to-preview matrix with 130 exact matches, 4
  intentional accepted differences, 0 soft regressions, 0 hard regressions,
  and 0 errors. The gate also proved exactly one absolute canonical with
  matching Open Graph/JSON-LD identity and the same primary VideoObject across
  short English, explicit-English compatibility, legacy-alias, Romanian,
  Russian, and Spanish contextual/standalone pairs.
- Kept homepage and search thumbnails on standalone discovery URLs while
  reserving contextual links for collection-internal navigation.
- Passed focused and complete Web tests, typecheck, lint, production build, and
  real-browser English/Romanian contextual route verification. A complete
  31,334-URL sitemap audit kept contextual routes out of `<loc>` and hreflang
  output, and server probes retained English, Romanian, Russian, and Spanish
  language-specific identity behavior.
