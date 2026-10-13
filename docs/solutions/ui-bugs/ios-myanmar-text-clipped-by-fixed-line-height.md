---
title: "iOS cuts the tops off Myanmar text under a fixed React Native line height"
date: "2026-10-09"
category: "ui-bugs"
module: "apps/mobile"
problem_type: "ui_bug"
component: "frontend_stimulus"
symptoms:
  - "On a Burmese (my-MM) iPhone, the Bible quote card's reference and translation name lose the tops of their letters, and the digits in the reference are cut too"
  - "The card's Burmese 'Read full passage' link and the promo button text clip the same way"
  - "The card's verse, at a taller line height, renders whole"
  - "Khmer UI rows at the same typography tokens render whole"
root_cause: "wrong_api"
resolution_type: "code_fix"
severity: "medium"
framework_version: "expo 57.0.27 / react-native 0.86.3 / iOS 26 simulator"
retire_when: "react-native computes the iOS baseline offset from the font that draws the glyphs, or Myanmar renders whole under a fixed lineHeight; check RCTApplyBaselineOffsetForRange in RCTAttributedTextUtils.mm after a react-native upgrade, then repeat the Burmese simulator check"
related_components:
  - "apps/mobile/src/lib/bibleCardFit.ts"
  - "apps/mobile/src/components/sections/BibleQuotesCarouselRenderer.tsx"
  - "apps/mobile/src/hooks/useTypography.ts"
tags:
  - "ios"
  - "i18n"
  - "myanmar"
  - "line-height"
  - "fallback-font"
  - "text-clipping"
  - "typography"
  - "react-native"
---

# iOS cuts the tops off Myanmar text under a fixed React Native line height

## Problem

On a Burmese iPhone, iOS cut the tops off Myanmar letters in every quote-card row that had a fixed `lineHeight`. The reader saw half-letters in the reference, the translation name, the "Read full passage" link, and the promo button.

## Symptoms

- The reference row showed the lower part of `ကမ္ဘာဦးကျမ်း 1:26-27`. The Latin digits were cut too, because the whole line sat too high in its frame.
- The translation name, the link, and the promo button clipped the same way.
- The verse on the same card rendered whole.
- On a Khmer phone, the link and the section heading rendered whole at the same tokens.

Seen on the iPhone 17 Pro Max simulator on 2026-10-09 (feat-667 device check).

## What Didn't Work

- **Comparing token values.** `useTypography` lists bodySmall as 14/20 (1.43 em), and `verseTypography` gives the verse 20/28 (1.4 em) at the base width, so the two looked equal, and the clip of one but not the other looked unexplained. That sent the investigation into React Native's source. The tokens are not the rendered values: `computeTypographyScale` subtracts `LINE_HEIGHT_REDUCTION` (2) from every line height (`apps/mobile/src/hooks/useTypography.ts:51`). On the 440 pt simulator, the typography factor caps at 1.15, so the clipped rows rendered at 16/21 (1.31 em) and 14/16 (1.14 em), and the verse rendered at 22/31 (1.41 em). Compute the rendered line height before you reason about a clip.
- **One test for three rows.** The first renderer test put a Myanmar reference, name, and link on one card and checked that the verse lost a line. When any one row's fit input was removed, the test still passed, because the other two rows still cost the verse a line. The code review of PR #2679 found this, and a per-row test fixed it.
- **A list of every tall script.** The first plan was a list that also had Khmer, Thai, Tibetan, and the Indic scripts. The metric table below and the simulator showed that only Myanmar needed the change, so the rule names Myanmar only.

An explicit, taller `lineHeight` was considered and not tried. React Native adds a baseline offset that grows with the line height (see "Why This Works"), so a taller fixed line also lifts the glyphs. The no-`lineHeight` variant was tried first and worked.

## Solution

A Myanmar row drops its fixed `lineHeight`, so the font sets the line. The card's layout arithmetic budgets 2.2 em for that row, because the card is a fixed square with bottom-aligned text and must know the row height before it draws.

`apps/mobile/src/lib/bibleCardFit.ts:63-90` (the `RowToken` and `CardRow` types and the docblock omitted):

```ts
const TALL_SCRIPT = /[\u1000-\u109f\ua9e0-\ua9ff\uaa60-\uaa7f]/
export const TALL_SCRIPT_LINE_HEIGHT_RATIO = 2.2

export function cardRow(
  token: RowToken,
  text: string | null | undefined,
): CardRow {
  if (text == null || !TALL_SCRIPT.test(text)) {
    return { style: token, lineHeight: token.lineHeight }
  }
  return {
    style: { fontSize: token.fontSize },
    lineHeight: token.fontSize * TALL_SCRIPT_LINE_HEIGHT_RATIO,
  }
}
```

The renderer takes the style and the budget from the same `cardRow` result, so the two cannot drift (`apps/mobile/src/components/sections/BibleQuotesCarouselRenderer.tsx:302-304` passes `referenceLineHeight`, `translationLineHeight`, and `linkLineHeight` into the fit input). The verse keeps its fixed line height, because it did not clip.

## Why This Works

With a `lineHeight`, React Native's iOS text layer sets the paragraph's minimum and maximum line height to that value (`RCTAttributedTextUtils.mm:229-233` in react-native 0.86.3). iOS draws Myanmar with a fallback font, not the declared system font. On the Mac, CoreText reports that font as Noto Sans Myanmar, with an ascent of 1.32 em and a descent of 0.86 em: 2.18 em in all. A fixed line of 1.14 to 1.31 em cannot hold that, and the letters' tops end up above the text frame. That step is the likely mechanism, read from the source; the simulator showed the result, not the internal step.

The baseline offset is a second, smaller factor. When the fixed line is at least the declared font's line height, React Native also lifts the glyphs by half the difference (`RCTApplyBaselineOffsetForRange`, lines 300-339). That applies to the 16/21 rows. It does not apply to the 14/16 name row: the function returns early when the fixed line is shorter than the declared font's line (lines 333-335). The name row clipped all the same, so the short fixed line, not the offset, is the main cause.

With no `lineHeight`, the paragraph has no maximum line height, so `RCTApplyBaselineOffsetForRange` returns before it adds an offset (`maximumLineHeight == 0`, lines 315-318). The line then takes the fonts' own ascent and descent, which hold the letters. The simulator check confirmed that every row showed in full.

Fallback-font line heights from CoreText on macOS (2026-10-09, `CTFontCreateForString` over the system UI font, 14 pt):

| Script                                                  | Fallback font     | Ascent + descent |
| ------------------------------------------------------- | ----------------- | ---------------- |
| Myanmar                                                 | Noto Sans Myanmar | 2.18 em          |
| Khmer                                                   | Khmer Sangam MN   | 1.99 em          |
| Tibetan                                                 | Kokonor           | 1.67 em          |
| Devanagari, Bengali, Tamil, Telugu, Malayalam, Gujarati | SF Indic faces    | 1.53 em          |
| Sinhala                                                 | Sinhala Sangam MN | 1.47 em          |
| Thai                                                    | Thonburi UI       | 1.38 em          |
| Latin                                                   | SF                | 1.18 em          |

The total alone does not predict a clip: Khmer, at 1.99 em, rendered whole under the same 1.31 em line. Myanmar's descent (0.86 em) is the largest, which leaves the least room above the baseline. Check each new script on a device rather than from this table.

## Prevention

- In a fixed-height layout that can show Myanmar, do not set `lineHeight` on a Myanmar row. Budget `fontSize × 2.2` for it, and take the style and the budget from one function.
- Keep the ratio at or above the measured 2.18 em. `bibleCardFit.test.ts` pins it with a literal: "budgets at least the Noto Sans Myanmar line".
- Test each row on its own. `BibleQuotesCarouselRenderer.test.tsx` has one case per row ("budgets a Myanmar reference by itself", "budgets a Myanmar translation name by itself", and "budgets a Burmese reader link by itself"), each at a size where that row alone costs the verse a line. Removing any one fit input made exactly one case fail (falsified by hand on 2026-10-09).
- Check a new script on the simulator before you add it to `TALL_SCRIPT`, and zoom the screenshot on the tops of the letters.
- On the Pixel 9a emulator (Android 15, 2026-10-09), the same card rendered every Myanmar row whole under the 2.2 em budget, and the verse got 3 lines. Android's own Myanmar font metrics were not measured, so check the card again after an Android or font change.
- App-wide Myanmar text (the watch-page label, the carousel heading) still clips; feat-669 tracks it.

## Related Issues

- PR #2679 carries the fix (open, unmerged as of this writing).
- `docs/roadmap/platform/feat-669-mobile-myanmar-ui-text-clipping.md`: the same clip in Myanmar UI text outside the card.
- `docs/roadmap/platform/feat-667-mobile-bible-quotes-reader-translation.md`: the feature whose device check found this.
- `docs/solutions/logic-errors/fit-budget-render-contract-numberoflines-zero-sentinel.md`: the card's rule that the fit budget and the renderer are one contract.
- `docs/solutions/mobile/responsive-typography-hook.md`: the typography tokens and their fixed line heights.
- `docs/solutions/mobile/typography-token-scope-shared-vs-purpose-specific.md`: why a per-row opt-out is safer than a change to a shared token.
