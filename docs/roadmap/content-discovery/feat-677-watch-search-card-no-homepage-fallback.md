---
id: "feat-677"
title: "Watch search cards never fall back to the Watch homepage"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-09"
duration: 2
depends_on: []
blocks: []
tags:
  - "web"
  - "search"
---

## Problem

Linear FGE-2. Search cards whose targets cannot be represented by the client
route parser silently returned the homepage. A browser-origin anonymous Admin
query confirmed `tümlükden-nura` and `çoğu-çay-mostly-tea` have valid English
`TARGET_AUDIO` actions: these are canonical Unicode slugs, not unpublished
records. Main's ASCII parser rejects them. Missing subtitle/requested-language
intent has the same homepage fallback; malformed explicit result languages
silently default to English instead.

This ticket is the narrow guard only: `defaultHrefBuilder` must never emit the
homepage. Unicode slug acceptance is separate work (PR #2662, feat-650) and must
not be duplicated here.

## Entry Points — Read These First

1. `apps/web/src/components/search/VideoCard.tsx` — `defaultHrefBuilder` and the
   disabled-card branch of `VideoCard`.
2. `apps/web/src/components/search/VideoCard.test.tsx` — `defaultHrefBuilder`
   and `VideoCard with no valid destination` suites.
3. `apps/web/src/lib/routes.ts` — `tryAsContentSlug`, `tryAsLocaleSlug`,
   `watchVideoPath`, `watchUnavailableLanguagePath`.

## Grep These

- `defaultHrefBuilder`
- `search-card-disabled`
- `hrefBuilder` in `apps/web/src/components/search/`

## What To Build

- `defaultHrefBuilder(result, requestedLanguageSlug): Route | null` returns
  `null` for: invalid slug; malformed explicit `languageSlug`; `target_subtitle`
  missing or malformed either language; `unavailable` with no valid requested
  language. An absent `languageSlug` still defaults to English; an unavailable
  result with a valid requested language still routes to the recovery path.
- `VideoCard` renders a `null` href as a non-link `div` with
  `aria-disabled="true"`: no hover, play icon, preview, or progress bar. It shows
  the existing generic `LanguagePickerModal.notAvailable` badge with no language
  name (no new catalog keys). Titles and count pills stay, so result counts and
  empty-result semantics are unchanged.
- Custom `hrefBuilder` callers keep working; a builder may now also return `null`.

## Constraints

- Do not change `routes.ts` slug patterns (Unicode support is PR #2662).
- Do not filter results out of `SearchResults` or `SearchOverlay`; counts stay.
- The disabled card's badge must stay generic: never show a language name.

## Verification

- `node node_modules/vitest/vitest.mjs run src/components/search/VideoCard.test.tsx`
  from `apps/web` on Node 24.
- Production check after deploy: `Tümlükden Nura` and `Cogu Cay (Mostly Tea)`
  cards no longer link to `/watch`. The canonical source records remain valid.
- Unicode regression fixtures permit a canonical content route or an inert
  result, never a homepage fallback. PR #2662 provides Unicode route acceptance;
  this guard does not claim to repair playback or complete all FGE-2 acceptance.
