---
id: "feat-667"
title: "Mobile Bible quote cards in the reader's translation"
owner: "urim"
priority: "P1"
status: "in-progress"
start_date: "2026-10-09"
duration: 3
depends_on: []
blocks: []
tags:
  - "mobile"
  - "i18n"
---

## Problem

A viewer whose phone is set to Korean opens a video and sees its Bible quote card in English (BSB), while the rest of the screen is in Korean. The card asks admin for a passage in the screen's language. Admin maps only about 25 languages to YouVersion versions, and it answers every other language with its English version (3034). Since the UI translation run (feat-604), the card's verse is often the only English text on the screen.

The app already has a Bible in the viewer's language: the Bible reader (feat-553) picks a translation for each viewer from its catalog. A tap on "Read full passage" opens that translation, so the card and the reader showed the same verse in two languages.

The source of this ticket is `docs/plans/2026-10-08-1419-feat-mobile-bible-quotes-reader-translation-plan.md`. It defines the R, AE, and KTD numbers below.

## Entry Points — Read These First

1. `docs/plans/2026-10-08-1419-feat-mobile-bible-quotes-reader-translation-plan.md`: the Product Contract (R1 to R14, AE1 to AE11) and the Planning Contract (KTD1 to KTD13).
2. `apps/mobile/src/lib/bible/quotes/cardQuote.ts`: the card quote module. It finds each card's translation with the reader's rules and reads the cited verses (KTD1, KTD2, KTD6).
3. `apps/mobile/src/hooks/useBibleVerses.ts`: `runReaderCards` and the run effect. They choose each card's source, keep one budget, settle once, and resolve again on a return (KTD4, KTD5, KTD11).
4. `apps/mobile/src/components/sections/BibleQuotesCarouselRenderer.tsx`: the language marks of a local card (KTD7).
5. `apps/mobile/src/lib/bible/repository/resolveChapter.ts` (`readOnDevice`, the `quote` read tag) and `apps/mobile/src/lib/bible/position/persistedRecordStore.ts` (`RecordReadOutcome`): the reader seams that the card uses (U1).
6. `apps/mobile/CLAUDE.md`, section "Bible reader (feat-553)", bullet "A quote card can show the reader's translation (feat-667)".

## Grep These

- `resolveCardQuotes`, `cardQuoteKey`, `CardQuoteResult`
- `runReaderCards`, `ReaderTranslationInputs`, `readerPickKey`
- `verseDirection`, `verseLang`
- `readOnDevice`, `reader_fetch_source`, `RecordReadOutcome`
- `bible_quotes.reader_translation`
- `catalogLanguageTag`

## What To Build

Built in this ticket's PR (U1 to U5 of the plan):

- U1: a device-only chapter read, a `quote` tag on a card's fetch-failure report, and a hydrate outcome on the record stores.
- U2: the card quote module. It returns `pending`, `admin`, `local`, `fallback`, or `network` for each citation, keyed on the citation's content.
- U3: the renderer marks. The verse, the reference, and the name take the catalog's direction; the credit stays English and left to right; the reference upper-cases in the verse's locale.
- U4: the hook and the route. The route passes `audioLanguageIso3`, its readiness, and `useIsFocused()` into `useBibleVerses`.
- U5: `CONCEPTS.md`, `apps/mobile/CLAUDE.md`, and this ticket.

Remaining before `status: "complete"`:

- The device check in the plan's Verification Contract, on the iOS simulator. The phone languages are Korean (AE1, AE11), Russian (AE10), Persian (`pes_pbs`, right to left), Burmese (`mya_jvb`, a tall script), and Hausa (AE8). One more run is offline, with the Korean Bible downloaded (AE6).
- The page-load check: time to first frame and time to the cards' settle, `main` against the branch, for an English viewer and a Korean viewer.

## Constraints

- Change only `apps/mobile`, `CONCEPTS.md`, and this ticket. Never change `apps/admin`, `apps/web`, `apps/tv`, `packages/*`, or `GET_VIDEO_BIBLE_PASSAGES`.
- Add no native module, no `package.json` script, and no `app.json` change: each one moves the fingerprint runtime version. The change ships by over-the-air update.
- Keep admin's passage for every language that admin serves, and for an English reader translation (R2).
- Do not add a translation parameter to the reader route. The card and the reader agree because both call `resolveShownTranslation` with the same inputs (KTD12).
- Do not read card chapters through a second repository. The shared repository keeps one flight per chapter and fills the reader's cache (KTD10).

## Verification

```bash
cd apps/mobile
npx jest --no-watchman src/lib/bible src/hooks/__tests__/useBibleVerses.test.tsx src/components/sections/__tests__/BibleQuotesCarouselRenderer.test.tsx app/watch
pnpm --filter @forge/mobile test
pnpm --filter @forge/mobile typecheck
pnpm --filter @forge/mobile lint
npx prettier --check ../../CONCEPTS.md CLAUDE.md ../../docs/roadmap/platform/feat-667-mobile-bible-quotes-reader-translation.md
```

On the simulator, with the phone language set to Korean, open a video that cites John 3:16. The card shows "요한복음 3:16", the Korean verse, "한국어 성경", and "public domain". "Read full passage" opens the reader at John 3:16 in 한국어 성경.
