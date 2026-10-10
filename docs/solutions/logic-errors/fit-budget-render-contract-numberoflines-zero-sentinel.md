---
title: "A layout budget and its renderer are one contract, and numberOfLines={0} means no limit"
date: "2026-08-28"
category: "logic-errors"
module: "apps/mobile"
problem_type: "logic_error"
component: "frontend_stimulus"
symptoms:
  - "A long reference wraps past its one-line budget, the bottom-aligned stack overflows the fixed square, and the clip removes the reference from the top"
  - "The fix for that introduced a worse defect: the fit's drop-the-region outcome verseLines = 0 reached numberOfLines, which React Native reads as no limit"
  - "The state that exists to prevent overflow became the state that caused it — the full unclamped verse rendered and the reference was clipped away"
  - "A green test suite missed both, because every test rendered at the harness default size and the drop branch only fires at small widths or large text sizes"
root_cause: "wrong_api"
resolution_type: "code_fix"
severity: "high"
framework_version: "react-native 0.86.3"
related_components:
  - "apps/mobile/src/lib/bibleCardFit.ts"
  - "apps/mobile/src/components/sections/BibleQuotesCarouselRenderer.tsx"
tags:
  - "react-native"
  - "numberoflines"
  - "text-clipping"
  - "layout-budget"
  - "sentinel-collision"
  - "accessibility-text-size"
  - "mobile"
---

# A layout budget and its renderer are one contract, and numberOfLines={0} means no limit

## Problem

A pure function decides how many lines each region of a fixed-square card may
use. A renderer draws those regions. The two form a contract. The contract
broke twice in the same module, in opposite directions, and the second break
was worse than the defect it replaced.

## Symptoms

The card is a fixed square. Its content is bottom-aligned inside
`overflow: "hidden"`, so an overflow clips the TOP of the stack. The top region
is the reference, which is the one region the drop order exists to protect.

**Failure 1 — the reference disappeared.** The fit reserved one line for the
reference and one for the translation. The renderer set no `numberOfLines` on
either. A long reference such as `1 Thessalonians 4:13-5:11` wrapped to a
second line, the stack grew past the square, and the clip removed the
reference.

**Failure 2 — introduced by the fix for failure 1.** The fit's "drop this
region" outcome is `verseLines = 0`. The renderer passed that value straight
into `numberOfLines={regions.verseLines}`. React Native reads
`numberOfLines={0}` as UNSET, which means no limit. The full unclamped verse
rendered, and the reference was clipped away.

Failure 2 was reachable from iOS Accessibility ExtraLarge upward on every
current iPhone width. It was not reachable on the Pixel 9a, whose font scale
caps at 2.0.

## What Didn't Work

**A green test suite.** Every test passed through both failures. The suite
rendered at the harness default window size. The drop branch fires only at
small widths or large text sizes, so no test could enter it.

**A default-size render.** The same limit applied to manual checks and to
screenshots. A card at the default text size never reaches the branch.

**An Android-only device pass.** The Pixel 9a caps its font scale at 2.0, below
the threshold. An Android screenshot pass could not show failure 2 at all.

**Author review.** The author found neither failure. An independent audit found
failure 2 by re-deriving the fit arithmetic at real device geometry.

**A post-layout measure.** The module rejects this by design. A measured round
trip lands after paint, and produces the content shift that the reserved height
exists to prevent.

## Solution

Opened in PR #2071, which is unmerged as of this writing.

**1. The render gate consumes the sentinel. It never forwards it.**

Before:

```tsx
{showVerse && (
  <Text numberOfLines={hasPassage ? regions.verseLines : undefined}>
```

After:

```tsx
{showVerse && (!hasPassage || regions.verseLines > 0) && (
  <Text numberOfLines={hasPassage ? regions.verseLines : undefined}>
```

**2. Every budgeted region has a matching clamp.** The reference clamps to
`REFERENCE_MAX_LINES`, the translation to `TRANSLATION_MAX_LINES`, and the
copyright to `COPYRIGHT_MAX_LINES` — the same constants the fit reserves height
for.

**3. The fit module exports every value it reserves height for.** The
StyleSheet imports the margins and the card padding. The verse font size and
line height come from one function, `verseTypography`. The fit budgets the
verse by the `lineHeight` that function returns, and the renderer spreads the
whole returned object into the verse style. One call supplies both halves, so
two files can no longer hold different numbers for one decision.

**4. Tests reach the cramped end.** A helper overrides
`Dimensions.get("window")`, which is what `useWindowDimensions` reads. Two
cases use it to enter the drop branch. Four more assert that the rendered font
size, line height, margins, and padding equal what the fit reserved, one of
them through the same helper at three widths. The drop-branch pair was
falsified by hand: removing the gate turns both red.

Verified on an iPhone 17 Pro Max simulator and a Pixel 9a emulator.

## Why This Works

The cause is a value-space collision. The module chose `0` as its own sentinel
for "drop this region". The framework gives `0` a different meaning on the same
prop, and the two meanings are exact opposites. The domain meaning is "show
nothing". The framework meaning is "show everything".

React Native states both halves in its own source, under
`node_modules/.pnpm/react-native@0.86.3*/node_modules/react-native/`:

```kotlin
// ReactAndroid/src/main/java/com/facebook/react/views/text/TextAttributeProps.kt:141
this.numberOfLines = if (numberOfLines == 0) ReactConstants.UNSET else numberOfLines
```

`ReactConstants.UNSET` is `-1` (`ReactConstants.kt:20`). The iOS counterpart is
in the same dependency, at
`node_modules/.pnpm/react-native@0.86.3*/node_modules/react-native/ReactCommon/react/renderer/attributedstring/ParagraphAttributes.h:34`,
which documents the field as `Zero value represents "no limit".` Both paths sit
inside the installed dependency, not in this repository, so a repo-relative
search will not find them.

The fix removes the collision instead of translating it. The sentinel stays on
the domain side of the seam. A branch consumes it, and only a real count
reaches the prop.

The shape is wider than this one prop. A domain sentinel that shares a value
space with a framework value is a defect whenever the two give that value
different meanings. The common collisions are `0`, `-1`, `null`, and the empty
string. `0` often means "unset" or "unlimited". `-1` often means "not found".
One layer reads `null` or `""` as "absent" while another reads it as a value.

## Prevention

- **Read the framework's meaning for `0`, `-1`, and `null` before you use one as
  your own sentinel.** Read the source, not your memory of it. Two lines of
  Kotlin and one comment in a C++ header settled this case.
- **Keep a sentinel on its own side of a seam.** Consume it in a branch, and
  pass only real values to the framework prop.
- **A budget and its clamp are one decision, so write them together.** Every
  region the fit reserves lines for needs a matching `numberOfLines`. A
  budgeted region with no clamp can wrap past its budget.
- **Export layout constants from the module that reasons about them.** The
  consumer imports them. Duplicated literals let the two halves drift with no
  test able to see it.
- **Test the cramped end.** Override `Dimensions.get("window")` and assert at
  small widths and large font scales. A render at the default size never
  reaches a size-dependent branch, so the whole drop order stays untested while
  the suite stays green.
- **Pick a device that can reach the branch.** Reachability is a platform fact.
  iOS accessibility text sizes go far past the Android font-scale cap of 2.0.
  Choose the platform whose limits admit the failure, or the pass proves
  nothing.

## Related Issues

- `docs/solutions/mobile/video-detail-audit-ui-polish-fixes.md` — an earlier
  audit of this same component. Its prevention item 9 says to avoid
  `numberOfLines` and prefer `overflow: "hidden"`. That rule is superseded for
  this card: unconstrained `overflow: "hidden"` is what clipped the reference,
  and the fix is a budget-driven `numberOfLines` on every region.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`
  — the repo's meta-doc on a green suite that proves branch shape and not the
  production contract. This is another instance.
- `docs/solutions/design-patterns/mirror-ui-derive-geometry-from-shared-constants.md`
  — same prevention idiom: a consumer derives geometry from exported constants
  instead of holding its own copy.
- `docs/solutions/best-practices/rn-animated-react18-cleanup-review-false-positives-20260615.md`
  — a sibling case of a React Native primitive that behaves against intuition.
- `apps/tv/src/components/sections/BibleQuotesCarouselRenderer.tsx` holds an
  independent copy of this card. It has no fit function and hardcodes its line
  counts, so it does not carry this defect. It also does not inherit the fix.
