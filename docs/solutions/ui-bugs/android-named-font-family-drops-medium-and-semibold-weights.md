---
title: 'Android drew every fontWeight 500 and 600 as Regular because the styles named the family "System"'
date: 2026-10-20
category: ui-bugs
module: apps/mobile
problem_type: ui_bug
component: frontend_stimulus
severity: medium
framework_version: "react-native 0.86.3 (New Architecture, expo 57)"
symptoms:
  - "On Android, titles at fontWeight 600 and labels at 500 had the stroke width of Roboto Regular, while the same text was semibold or medium on iOS"
  - "Only text at 700 and above looked heavier on Android; 500 and 600 looked the same as 400"
  - 'The app set fontFamily "System" on 229 styles in 84 files, so the defect was on almost every screen'
root_cause: wrong_api
resolution_type: code_fix
related_components:
  - apps/mobile/src/styles/__tests__/noSystemFontFamily.guard.test.js
  - apps/mobile/src/lib/bible/theme/typography.ts
  - apps/mobile/src/styles/shared.ts
tags:
  - android
  - react-native
  - typography
  - font-weight
  - font-family
  - roboto
  - guard-test
---

# Android drew every fontWeight 500 and 600 as Regular because the styles named the family "System"

## Problem

`apps/mobile` set `fontFamily: "System"` on its text styles, as its own convention said. On Android, React Native draws any named family in Regular or Bold only. So every text at weight 500 or 600 drew Regular on Android, while iOS drew the medium and semibold weights the design asks for.

## Symptoms

- On the Pixel emulator, the Downloads screen showed the problem clearly. The stroke widths (measured from screenshots, as a share of the text height) were:
  - `"The Beginning"` (600): about 0.106
  - `"Jesus Feeds 5,000"` (600): about 0.085
  - `"370 MB · Downloaded"` (500): about 0.088
  - `"Downloads"` (700): about 0.143
  - Roboto Regular is about 0.09.
- Only text at 700 and above looked heavier than body text on Android.
- The same screens on iOS drew 500 and 600 correctly, so a review on an iPhone never showed it.

## What Didn't Work

- **Keeping `"System"` for iOS.** The convention assumed iOS needs the name to get San Francisco. It does not. In Fabric, `"System"` fails the family lookup and falls back to the same call that an unset family makes (`RCTFontWithFontProperties` in `ReactCommon/.../ios/.../RCTFontUtils.mm`: the default-family branch (line 350, call at 353) and the failback (call at 367) both use `RCTDefaultFontWithFontProperties`). The iOS Downloads screenshot was byte-identical before and after the removal.
- **A guard that matches only the literal style.** A first guard used the regex `/fontFamily:\s*["']System["']/`. The code review found that `readingFontFamily` (the Bible reader's family picker) still returned the string `"System"` for its sans face. A function return is not a style literal, so the guard could not see it, and the reader's Sans label stayed Regular at weight 500.
- **A plain text search for `"System"`.** It also matches comments that name the family, and a comment is not a defect. The final guard uses the TypeScript parser and checks only string values.
- **Shell sweeps on macOS.** A zsh `for f in $FILES` loop does not split a list of names on newlines. `grep -Z` on macOS means "decompress", not "print a null after each name", so `xargs -0` got one huge name. A short Python script that walks `apps/mobile/app/` and `apps/mobile/src/` did the removal. Then `prettier --write` on a folder rewrote `apps/mobile/src/lib/bible/data/sources.lock.json` into 48,000 lines. The root `.prettierignore` excludes that file, and it had to be restored.

## Solution

All in `apps/mobile`, on branch `fix/mobile-player-cover-and-android-weights` (no PR was open and none of it was on `main` as of 2026-10-20):

1. **Remove every `fontFamily: "System"` line** (229 lines in 84 files). Two styles held nothing else; remove them and their uses.
2. **Name no family for the system face anywhere.** `readingFontFamily` now returns `undefined` for the sans face (`apps/mobile/src/lib/bible/theme/typography.ts`), and the callers' types widen to `string | undefined`.
3. **Guard it** with `apps/mobile/src/styles/__tests__/noSystemFontFamily.guard.test.js`. The guard parses every `.ts` and `.tsx` file under `apps/mobile/app/` and `apps/mobile/src/` (outside `__tests__` folders), and fails on any string value `"System"`. A positive control proves that it finds the double-quoted, single-quoted, two-line, returned and template forms, and that it ignores a comment.

Before and after, on one style:

```ts
// Before: Android draws this Regular.
title: { fontFamily: "System", fontSize: 18, fontWeight: "600" },
// After: iOS draws SF Pro Semibold, Android draws Roboto at weight 600.
title: { fontSize: 18, fontWeight: "600" },
```

One side effect is intended. Android's JS bottom tab labels (iOS uses the native tab bar) had `fontFamily: "System"` in `tabBarLabelStyle`. Without it, React Navigation's theme font applies, which on Android is `sans-serif-medium`. That matches the weight 500 the theme gives iOS.

## Why This Works

React Native's Android text path chooses the typeface in `ReactTypefaceUtils.applyStyles` (`ReactAndroid/.../views/text/ReactTypefaceUtils.kt:107-110`):

```kotlin
return if (fontFamilyName == null) {
  typefaceStyle.apply(typeface ?: Typeface.DEFAULT)
} else {
  ReactFontManager.getInstance().getTypeface(fontFamilyName, typefaceStyle, assetManager)
}
```

- **No family:** `TypefaceStyle.apply` calls `Typeface.create(typeface, weight, italic)` on API 28 and later (`ReactAndroid/.../common/assets/ReactFontManager.kt:146-150`). The numeric weight survives.
- **A named family that is not a registered custom font:** `getTypeface` uses `typefaceStyle.nearestStyle` (`ReactFontManager.kt:72`). That property maps any weight under `BOLD` (700) to `NORMAL` (or `ITALIC`), and 700 and above to `BOLD` (or `BOLD_ITALIC`) (`:138-144`, `:154`). `"System"` is not a real font, so after an asset lookup for `fonts/System*` finds nothing, the name falls through to `Typeface.create("System", style)` (`:187`). Android then gives the default family at Regular or Bold.
- **A registered custom font** is the exception: its typeface goes through `typefaceStyle.apply` (`ReactFontManager.kt:65-68`), so its weights survive.

The fix removes the name, so Android takes the first branch. iOS resolves an unset family to the system font, as before.

## Prevention

- **Leave `fontFamily` unset for the platform font.** Name a family only for a real custom font. If that font needs several weights on Android, register it as a custom font with those weights, or name the exact weight's own file.
- **The guard keeps `apps/mobile` clean.** `apps/mobile/CLAUDE.md` (Conventions) states the rule and names the guard.
- **Check weights on Android, not only on iOS.** iOS hides this defect. A quick check is to compare a 600 title with 400 body text on an Android screenshot. If they have the same stroke width, a named family is the likely cause.
- **`apps/tv` still has the defect.** As of 2026-10-20 it has 132 `fontFamily: "System"` styles and 50 uses of weight 500 or 600, and `apps/tv/CLAUDE.md` still says to use `fontFamily: 'System'`. Android TV draws those weights Regular. The same removal and guard apply there.

## Related Issues

- `docs/solutions/developer-experience/mobile-dev-build-verification-false-signals.md`: another case where a named family resolves differently on iOS and Android (the splash font).
- `docs/solutions/mobile/responsive-typography-hook.md`: a typography migration must keep each style's `fontWeight`.
- `apps/mobile/CLAUDE.md`, Conventions: the standing rule.
