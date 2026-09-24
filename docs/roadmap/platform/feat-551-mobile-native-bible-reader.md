---
id: "feat-551"
title: "Mobile native Bible reader, one verse at a time"
owner: "urim"
priority: "P2"
status: "in-progress"
start_date: "2026-09-24"
duration: 14
depends_on: []
blocks: []
tags:
  - "mobile"
  - "i18n"
---

## Problem

"Read full passage" on a Bible quote card opens `bible.com` in an in-app browser sheet. The sheet is slow, it needs internet, and it forgets where the viewer stopped. The app has no way to read beyond the quoted verses.

## Entry Points — Read These First

1. `docs/plans/2026-09-24-1251-feat-mobile-native-bible-reader-plan.md` — the plan. It carries R1-R42, KD1-KD26, KTD1-KTD19, U1-U14, and AE1-AE18, and it is the authority for every decision below.
2. `apps/mobile/src/lib/openPassageSheet.ts` and `apps/mobile/src/components/sections/BibleQuotesCarouselRenderer.tsx` — the current button and the sheet it opens (R1).
3. `GET_VIDEO_BIBLE_PASSAGES` in `apps/mobile/src/lib/queries.ts` and `BibleCitation` in `apps/admin/schema.graphql` — the citation's book, chapter, and verse range for opening the reader at the cited verse.
4. `apps/mobile/src/lib/tabBar.ts` and `apps/mobile/app/(tabs)/` — the tab bar that gets the Bible tab (R2).
5. `apps/mobile/src/lib/miniPlayer/layout.ts` — the mini player corners. Every screen starts the window at the bottom right today (R10).
6. `apps/mobile/src/components/ui/HomeHeader.tsx` and `FloatingBackButton.tsx` — the glass button style (R8).

## Grep These

- `openPassageSheet` — the one caller to replace
- `READ_PASSAGE_LABEL` — the button label
- `TAB_ROUTE_NAMES` — the tab list a guard test pins to the route files
- `DEFAULT_CORNER` — the mini player's start corner
- `BACK_SWIPE_RESPONSE_DISTANCE` — the left-edge back swipe that chapter swipes must not trigger (R6)
- `never from a public Bible mirror` — the `apps/mobile/CLAUDE.md` rule that KD5 narrows to the quote card

## What To Build

- A reader that shows one verse, centered on the screen, with verse swipes up and down and chapter swipes left and right (R7, R12).
- Two ways in that share one reading position: "Read Full Passage" pushes the reader over the video, and a new Bible tab resumes at the last verse (R1-R4).
- Text from the Free Use Bible API at `bible.helloao.org` in the viewer's language, with BSB inside the app and a download button for other translations (R22-R31).
- A pill picker, a verse scrubber, verse sharing, a first-run swipe demo, and a settings sheet with seven settings (R16-R19, R33).

## Constraints

- Change `apps/mobile` only. No change to `apps/admin`, `apps/web`, or `apps/tv`.
- The quote card keeps its admin-resolved text. The "never a public Bible mirror" rule still applies to the card, and its four quality rules apply to the reader (R26).
- Phones hide the up/down buttons unless a screen reader or the setting is on, because `PRODUCT.md` requires a path that needs no gesture (R11).
- The release needs a native build, because the production update channel reaches no installed build today.

## Verification

- `pnpm --filter @forge/mobile test` and `pnpm --filter @forge/mobile typecheck` pass.
- Every requirement is exercised by hand on the iPhone 17 Pro Max simulator, the Pixel 9a emulator, and an iPad simulator, with a screenshot for each screen state.
- Timing runs on the Pixel 9a emulator show a BSB verse within 1 second of the "Read Full Passage" tap, and a chapter not on the device within 2 seconds on Wi-Fi.
- In airplane mode, BSB and a downloaded translation open, and verse and chapter moves work (AE4, AE5).
