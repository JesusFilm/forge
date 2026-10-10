---
id: "feat-649"
title: "Watch routes for Unicode content slugs"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks:
  - "feat-653"
tags:
  - "platform"
  - "web"
  - "watch-page"
---

## Problem

Playable Core videos can have lowercase Latin slugs with diacritics. The Watch
route manifest preserves those slugs, but Web's route constructors and proxy
allowlist accepted ASCII only. Series cards therefore rendered a non-interactive
fallback for titles such as `tümlükden-nura`, `la-búsqueda-the-search`,
`la-liberté-de-l-interieur-freedom-within`, and `jätku-leiba`.

## Entry Points — Read These First

1. `apps/web/src/components/watch/SeriesEpisodeCard.tsx` — contextual child
   link construction and non-link fallback.
2. `apps/web/src/lib/routes.ts` — branded content slug validation.
3. `apps/web/src/proxy.ts` — public path validation and contextual route
   admission against the Admin route manifest.
4. `apps/web/src/lib/url-shape.ts` — shared safe slug grammar.
5. `packages/watch-url-policy/src/routes.ts` — public route shape classifier.

## What To Build

1. Permit lowercase Latin letters with diacritics in content slug path
   segments, retaining ASCII digits, hyphens, and underscores.
2. Decode UTF-8 path escapes for validation while keeping encoded slash, backslash,
   query, fragment, malformed escape, traversal, and reserved path inputs
   rejected.
3. Preserve the decoded canonical slug through route manifest admission and
   Admin lookup, including Next catch-all route params.
4. Keep URI encoding consistent for internal rewrites and their admission
   re-entry checks.
5. Add component, proxy, and page coverage for the four reported Conversation
   Starters slugs, plus malformed and unsafe path regression coverage.

## Constraints

- Keep public language slug validation ASCII and separately bounded by the
  language corpus.
- Do not transliterate or guess a different video slug; route to the exact
  published Admin slug.
- Keep canonical Watch URL shapes and manifest admission rules unchanged.
- Require the standard uppercase UTF-8 percent-encoding spelling for public
  paths, and reject uppercase/non-Latin content slug characters.
- Do not add contextual episode URLs to the sitemap.

## Verification

- Focused tests for `SeriesEpisodeCard`, `proxy`, `url-shape`, and
  `watch-url-policy` route classification.
- Web typecheck and focused lint/format checks.
- Verify a public `/watch` request with a percent-encoded diacritic passes the
  proxy's manifest admission, resolves the decoded slug in the page, and
  rewrites to the same canonical route.
