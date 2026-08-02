---
id: "feat-326"
title: "Translate the watch hero accolade badge"
owner: "vlad"
priority: "P2"
status: "not-started"
start_date: "2026-08-03"
duration: 2
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "i18n"
---

## Problem

The JESUS watch hero now carries a Guinness World Records accolade badge, but
its two message paths ship as English source copy in all 224 non-English
catalogs. They are registered in `pendingTranslationPaths`, so the parity and
provenance gates pass and the provenance digests correctly exclude them — the
catalogs do not claim these strings as translated. Until they are translated,
a Hindi or Arabic viewer of the most-translated film in the world reads its
accolade in English.

`HeroPlayer.mostTranslatedFilmSource` ("Guinness World Records") is a brand
name and belongs in `intentionallyLocaleNeutral`, not in the translated set.
That move changes `sourceDigest`, so it has to happen in the same pass that
refreshes provenance.

## Entry Points — Read These First

1. `apps/web/scripts/ui-translation-policy.json` — the two pending paths, plus
   the `intentionallyLocaleNeutral` list the brand path moves into.
2. `apps/web/messages/en.json` — source copy under the `HeroPlayer` namespace.
3. `apps/web/scripts/translate-ui-catalogs.mjs` — the OpenAI contextual
   translation pipeline; needs `OPENAI_API_KEY`.
4. `docs/i18n/watch-ui-provisional-catalogs.json` — per-locale `sourceDigest`
   and `catalogDigest` provenance that both changes invalidate.
5. `apps/web/src/lib/__tests__/watch-ui-provisional-catalogs.test.ts` — the
   digest invariants; note that both digests filter `pendingTranslationPaths`
   but not `intentionallyLocaleNeutral`.
6. `docs/roadmap/topic-experiences/feat-266-watch-collection-download-localization.md`
   — the same pass done once already, for the collection-download namespace.

## Grep These

- `mostTranslatedFilm` — the two message paths across catalogs and policy.
- `pendingTranslationPaths` — parity gate, digest test, translator script.
- `intentionallyLocaleNeutral` — the brand-name exemption list.
- `HERO_ACCOLADE_TAG_CLASS` — the badge's width budget in
  `apps/web/src/components/watch/HeroPlayer.tsx`.

## What To Build

1. Contextually translate `HeroPlayer.mostTranslatedFilm` into every
   machine-translated catalog. Reuse each catalog's established Watch terms
   for "film" and "world" rather than translating the phrase cold.
2. Move `HeroPlayer.mostTranslatedFilmSource` from `pendingTranslationPaths`
   to `intentionallyLocaleNeutral` and keep "Guinness World Records" verbatim
   in every catalog — it is the record holder's brand, not prose.
3. Remove `HeroPlayer.mostTranslatedFilm` from `pendingTranslationPaths`.
4. Refresh every locale's `sourceDigest` and `catalogDigest` in
   `docs/i18n/watch-ui-provisional-catalogs.json`. Both changes above move the
   digests: the translated path re-enters the hashed set, and the neutral list
   is itself part of the hashed policy.
5. Keep `crk` and `mey-Latn` byte-identical to `en.json` — the provisional
   test compares whole files, not key sets.
6. Check the longest translations against the badge's width budget. The pill
   sits in the hero left rail and already runs to roughly 370 px at 390 px
   viewport width in English; German and Tamil will be longer.

## Constraints

- Do not claim English fallback copy as translated — that is exactly what
  `pendingTranslationPaths` exists to prevent.
- Do not translate the Guinness brand name.
- Do not change `humanReviewedLocales`; `en` and `ru` stay human-owned.
- Do not shorten the English source to make translations fit. If the pill
  overflows, change the badge layout in `HeroPlayer.tsx`, not the claim.

## Verification

- `pnpm --filter @forge/web test -- messages-parity.test.ts watch-ui-provisional-catalogs.test.ts`
- `pnpm --filter @forge/web check:provisional-ui-catalogs`
- `pnpm --filter @forge/web lint`
- `pnpm --filter @forge/web typecheck`
- Browser-smoke `/watch/jesus.html/{language}.html` in one long-word locale
  (German) and one RTL locale (Arabic); confirm the badge stays inside the
  hero left rail at 390 px width.
