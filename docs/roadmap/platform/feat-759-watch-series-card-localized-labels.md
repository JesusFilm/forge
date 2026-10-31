---
id: "feat-759"
title: "Show Watch series episode card labels in the page's language"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-10-20"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "i18n"
---

## Problem

On 2026-10-20, the Spanish series page
`https://www.jesusfilm.org/watch/lumo-the-gospel-of-john.html/spanish-latin-american.html`
showed Spanish chrome ("SERIE · 22 EPISODIOS", "Descargar colección") around
English card labels ("EPISODE 1" … "EPISODE 22"). Nested containers showed
"SERIES" or "COLLECTION", and their folder icon carried an English
`aria-label` ("Open series"). `SeriesEpisodeCard` hardcoded these strings,
while every other Watch card reads `VideoLabels` from the page's UI catalog.
Found in the 2026-10-20 website audit round 02 (persona journeys): a believer
or partner who shares a series in their own language sees mixed-language
navigation.

## Entry Points — Read These First

1. `apps/web/src/components/watch/SeriesEpisodeCard.tsx` — eyebrow label,
   thumbnail `alt` fallback and container icon.
2. `apps/web/src/components/watch/SiblingCarousel.tsx` — the existing
   "translated label + number" join (`railLabel` + position).
3. `apps/web/src/i18n/client-messages.ts` — `VideoLabels` is in
   `GLOBAL_CLIENT_MESSAGE_NAMESPACES`, so the client already has it.

## Grep These

- `` `Episode ${`` under `apps/web/src`
- `"Collection" : "Series"`
- `useTranslations("VideoLabels")`

## What To Build

- Read `VideoLabels.episode`, `.series` and `.collection` in
  `SeriesEpisodeCard`; render `"{episode} {n}"` for chapters.
- Use the same label for the thumbnail `alt` fallback.
- Mark the container icon decorative; the eyebrow already names the
  container kind in the page's language.
- Pin Spanish output in `SeriesEpisodeCard.test.tsx`.

## Constraints

- No new message keys: a new key needs all catalogs, and the existing
  `VideoLabels` strings are already translated.
- Do not change card routing, runtime pills, or the authored titles (titles
  come from Admin data).
- Word order stays "label number", like the sibling carousel. A language that
  needs another order needs a new ICU key across all catalogs; that is a
  separate change.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/watch/__tests__/SeriesEpisodeCard.test.tsx`
  (the Spanish, icon and alt cases fail against the old component).
- Matched `next build` before and after: the client chunk that holds the card
  grows by 11 bytes raw (2 bytes gzip), total client JS by 11 bytes, same
  chunk layout. No new effect, request or message namespace.
- After deploy: the Spanish URL above shows "EPISODIO 1".
