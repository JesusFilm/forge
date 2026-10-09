---
id: "feat-669"
title: "Mobile Myanmar UI text clips under fixed line heights"
owner: "urim"
priority: "P2"
status: "not-started"
start_date: "2026-10-12"
duration: 3
depends_on: []
blocks: []
tags:
  - "mobile"
  - "i18n"
---

## Problem

On an iPhone in Burmese, iOS cuts the tops off Myanmar letters in UI text that has a fixed line height. iOS draws Myanmar in Noto Sans Myanmar. Its ascent and descent come to 2.18 em (CoreText, 2026-10-09). `computeTypographyScale` subtracts `LINE_HEIGHT_REDUCTION` (2) from each token, so at a 375 pt width the rendered lines are 1.17 to 1.29 em: caption 12/14, bodySmall 14/18, titleLarge 22/26.

Seen on the iPhone 17 Pro Max simulator on 2026-10-09, phone language `my-MM`, video `the-beginning`:

- The label above the video title (`VideoMetadata`, caption).
- The Bible quotes heading above the carousel (`bibleQuotesHeading`, titleLarge).

feat-667 fixed the quote card only. `cardRow` in `apps/mobile/src/lib/bibleCardFit.ts` removes the fixed line height of a Myanmar reference, translation name, reader link, or promo button. The card's fit budgets 2.2 em for the reference, name, and link rows. The promo, Experience, and SDUI cards have no fit, so at a large text size a taller Myanmar row can push their text out of the square. In the same check, Khmer (1.99 em) did not clip, and the card's Myanmar verse (20/28 at 375 pt) did not clip. On the Pixel 9a emulator (Android 15), the card's Myanmar rows also rendered whole with that fix. Android UI text outside the card was not checked.

A likely cause, read from the source and not tested: React Native's iOS baseline offset uses the line height of the declared font (the system font), not of the fallback font that draws the letters. See `RCTApplyBaselineOffsetForRange` in `react-native/ReactCommon/react/renderer/textlayoutmanager/platform/ios/react/renderer/textlayoutmanager/RCTAttributedTextUtils.mm`.

## Entry Points — Read These First

1. `apps/mobile/src/lib/bibleCardFit.ts`: `cardRow`, `TALL_SCRIPT`, and `TALL_SCRIPT_LINE_HEIGHT_RATIO`. This is the card-only fix and its measured numbers.
2. `apps/mobile/src/hooks/useTypography.ts`: `BASE_SCALE` and `HEADING_SCALE`. Every fixed line height that the app spreads into a `Text` style comes from here.
3. `apps/mobile/src/components/watch/VideoMetadata.tsx`: the `styles.label` text above the title.
4. `apps/mobile/src/components/sections/BibleQuotesCarouselRenderer.tsx`: the section heading (`accessibilityRole="header"`).
5. `apps/mobile/CLAUDE.md`, section "Bible reader (feat-553)", the feat-667 bullet "A Myanmar row on a card has no fixed line height".

## Grep These

- `typography\.(caption|bodySmall|body|titleSmall|titleLarge|heading|display)` in `apps/mobile/src` and `apps/mobile/app`
- `lineHeight:` in `apps/mobile/src/styles/`
- `cardRow(`

## What To Build

- Move the tall-script test out of `bibleCardFit.ts` into a shared module, for example `apps/mobile/src/i18n/tallScript.ts`. Keep `cardRow` on that module.
- Choose where the rule applies. Option A: when the UI catalog is `my`, UI text drops its fixed line heights. The catalog is known at render, so this is one decision per screen. Option B: a test per text, as `cardRow` does. Admin text (titles, descriptions) needs option B.
- A surface that budgets a line height (the quote card fit, fixed rows) must budget `fontSize × TALL_SCRIPT_LINE_HEIGHT_RATIO` for a Myanmar row.
- Give the promo, Experience, and SDUI quote cards a bound for their Myanmar rows (a fit or a line clamp), so a large text size cannot push the eyebrow out of the square.
- Check the same UI screens on Android. The quote card passed there; the other screens were not checked.

## Constraints

- Do not change the line heights of other scripts. Khmer did not clip on iOS.
- Keep the quote card's verse on its fixed line height unless a device check shows a clip.
- Do not edit `apps/admin`.

## Verification

- Simulator: set the phone language to `my-MM` on an iPhone 17 Pro Max. Open `forgemobile://watch/the-beginning` and the Home, Discover, Bible, and My Watch tabs. Zoom each screenshot on every heading and label; no letter top is cut.
- Android emulator: the same screens.
- `pnpm --filter @forge/mobile test` and `npx tsc --noEmit -p apps/mobile` pass.
