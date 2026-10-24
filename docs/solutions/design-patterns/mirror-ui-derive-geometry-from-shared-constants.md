---
title: "Mirror UI (skeleton/backdrop) must derive geometry from shared exported constants, not hardcoded copies"
date: 2026-07-08
category: design-patterns
module: apps/tv
problem_type: design_pattern
component: frontend_stimulus
severity: low
applies_when:
  - "Building a loading skeleton, backdrop, or any placeholder meant to visually mirror an already-built real component"
  - "The real component owns layout geometry (gaps, insets, item widths, action heights) as module-level constants"
  - "Any mirrored constant is platform-branched (`IS_ANDROID ? a : b`) so a hardcoded copy silently drifts on one platform"
  - 'A module-load `Dimensions.get("window").width` read can return 0 before layout, collapsing a derived count to 1'
  - "Verification will run on a single platform/simulator, hiding platform-branched divergence"
tags:
  - tv
  - react-native-tvos
  - skeleton
  - placeholder
  - shared-constants
  - platform-branch
  - layout
  - cross-platform-verification
---

# Mirror UI (skeleton/backdrop) must derive geometry from shared exported constants, not hardcoded copies

## Context

The TV app's cold-launch loading skeleton (`apps/tv/src/components/home/HomeSkeleton.tsx`, react-native-tvos on Apple TV + Android TV) exists for one job: fill the screen with placeholder cards that mirror the loaded Home so the loading→content handoff (<1s during cold launch) reads as smooth, not as a reflow.

Its first version hand-copied the geometry that the real sibling components already own:

- `CARD_GAP = scale(28)` — a copy of HomeRail's `ITEM_GAP`
- rail `paddingLeft = scale(80)` — a copy of HomeRail's `RAIL_PADDING_LEFT`
- CTA/chevron `height = scale(62)` — a copy of heroLayout's exported `HERO_ACTION_HEIGHT`
- `CARD_COUNT = Math.ceil(Dimensions.get("window").width / (HOME_CARD_WIDTH + CARD_GAP)) + 1` — a divergent reimplementation of HomeRail's `VISIBLE_COLUMNS`

The defect was found by an xhigh `/code-review`, not by the author's own verification. HomeRail's real gap is **platform-branched**: `const ITEM_GAP = scale(IS_ANDROID ? 48 : 28)`. The skeleton hardcoded `scale(28)` for both platforms. On Android TV the loaded rail spaces cards 48dp while the skeleton spaced them 28dp, so placeholder cards visibly reflow horizontally at the exact moment the skeleton is supposed to smooth over. The author had verified only on the tvOS simulator — where `ITEM_GAP` is also 28 — so single-platform verification never surfaced the Android-only divergence.

Two secondary bugs rode along: the count formula omitted HomeRail's `- RAIL_PADDING_LEFT` inset and added a stray `+1`, so counts drifted; and `Dimensions.get("window").width` read unguarded at module load can be `0` during cold launch, making `Math.ceil(0 / …) + 1 = 1` — collapsing the rail to a single card. Sibling `apps/tv/src/lib/scale.ts` already guards precisely this case with `SCREEN_WIDTH || REFERENCE_WIDTH`.

## Guidance

A mirror/placeholder UI must **derive** its geometry from the same exported constants the real components own — never hand-copy the values. If the real component keeps those constants private, export them; the export is the compile-time link that keeps the two surfaces from drifting.

When a value is **platform-branched** (`IS_ANDROID ? …`), sharing the single constant is a strictly stronger guarantee than testing both platforms: divergence becomes structurally impossible, so no future edit to the branch can silently desync the placeholder. Testing both platforms only catches the divergence you already introduced; sharing the constant prevents the next one too.

Guard any module-load `Dimensions.get()` read with a reference fallback so a `0` width during cold launch can't collapse a computed count.

Before/after — the gap:

```ts
// Before (HomeSkeleton.tsx) — hand-copied, wrong on Android TV
const CARD_GAP = scale(28) // HomeRail is scale(IS_ANDROID ? 48 : 28)

// After — same constant both surfaces read; divergence impossible
import { ITEM_GAP } from "./HomeRail"
// ...card style:
{
  marginRight: ITEM_GAP
}
```

Before/after — the count:

```ts
// Before — omits the inset, adds a stray +1, unguarded 0-width read
const CARD_COUNT =
  Math.ceil(Dimensions.get("window").width / (HOME_CARD_WIDTH + CARD_GAP)) + 1

// After — mirrors HomeRail's VISIBLE_COLUMNS + 1, inset-aware, 0-guarded
import { COLUMN_WIDTH, RAIL_PADDING_LEFT } from "./HomeRail"
import { REFERENCE_WIDTH } from "../../lib/scale"

const SCREEN_WIDTH = Dimensions.get("window").width || REFERENCE_WIDTH
const CARD_COUNT =
  Math.ceil((SCREEN_WIDTH - RAIL_PADDING_LEFT) / COLUMN_WIDTH) + 1
```

The fix (commit `90849cff`, branch `fix/tv-home-skeleton-fullscreen`, PR #1482) promoted `ITEM_GAP` / `COLUMN_WIDTH` / `RAIL_PADDING_LEFT` in `HomeRail.tsx` and `REFERENCE_WIDTH` in `scale.ts` from `const` to `export const`, then had the skeleton import them plus `HERO_ACTION_HEIGHT` from `heroLayout`. The tvOS render was unchanged (every tvOS-resolved value stayed identical — the card count stays 6), and it landed green: tvOS 1080p sim, `tsc`, eslint, jest 563/563, and CI.

Note the existing precedent: `apps/tv/src/components/home/heroLayout.ts` already extracts shared hero geometry (`HERO_REGION_HEIGHT`, `HERO_PADDING_*`, `HERO_ACTION_HEIGHT`). Rail geometry had not been similarly extracted, which is exactly why the skeleton hand-copied it. When you find yourself copying a sibling's constant, that's the signal to export it instead.

## Why This Matters

Hand-copied geometry has no compile-time link back to its source, so it silently drifts the moment either side changes. The drift is worst on platform-branched values: the copy captures whichever branch the author happened to look at, and the other platform is wrong from day one with nothing to flag it. Single-platform simulator verification then hands out false confidence — the tvOS sim looked perfect precisely because tvOS was the branch that matched.

And the failure lands where it hurts most. A loading skeleton's entire job is a seamless handoff to real content; a reflow at that instant isn't a cosmetic nit, it's the placeholder betraying the one thing it exists to do, on the platform nobody tested.

## When to Apply

- Any `apps/tv` or `apps/mobile` skeleton, placeholder, backdrop, or shimmer meant to mirror real content — derive its geometry from the real component's exported constants, don't hand-copy.
- Any React Native value that is `IS_ANDROID ? …` (or otherwise platform-branched): share the single constant rather than copying one branch and trusting a single-platform test.
- Any module-scope `Dimensions.get()` read: guard with a reference fallback (`… || REFERENCE_WIDTH`) so a `0` during cold launch can't collapse a computed layout.

## Examples

The gap — hardcoded value diverged from a platform-branched source:

```ts
// HomeRail.tsx (source of truth)
export const ITEM_GAP = scale(IS_ANDROID ? 48 : 28)

// HomeSkeleton.tsx — before: wrong 28dp on Android TV
const CARD_GAP = scale(28)
// after: reads the same branch the rail does
import { ITEM_GAP } from "./HomeRail"
{
  marginRight: ITEM_GAP
}
```

The count — inset-aware and 0-guarded, mirroring `VISIBLE_COLUMNS + 1`:

```ts
import { COLUMN_WIDTH, RAIL_PADDING_LEFT } from "./HomeRail"
import { REFERENCE_WIDTH } from "../../lib/scale"

// || REFERENCE_WIDTH: window width can be 0 at cold-launch module load
const SCREEN_WIDTH = Dimensions.get("window").width || REFERENCE_WIDTH
const CARD_COUNT =
  Math.ceil((SCREEN_WIDTH - RAIL_PADDING_LEFT) / COLUMN_WIDTH) + 1
```

## Related

- [`conventions/grep-inline-tier-copies-before-bumping-shared-layout-tokens-2026-05-05.md`](../conventions/grep-inline-tier-copies-before-bumping-shared-layout-tokens-2026-05-05.md) — closest sibling, same failure class (a consumer inline-copies a shared layout constant and drifts from source). That doc is the apps/web Tailwind-token instance and prescribes grep-before-bump detection; this one is the apps/tv native-RN instance and prescribes export+import elimination (make divergence unrepresentable). The platform-branched value is an amplifier the web case lacks.
- [`ui-bugs/android-tv-density-scaling-and-native-view-clipping-20260416.md`](../ui-bugs/android-tv-density-scaling-and-native-view-clipping-20260416.md) — platform-divergence sibling: `scale()` values tuned on Apple TV render wrong on Android TV's ~half-size logical canvas. Strongest reminder that Android TV must be a separate verification target.
- [`developer-experience/verifying-mobile-expo-worktree-changes-in-simulator-20260608.md`](../developer-experience/verifying-mobile-expo-worktree-changes-in-simulator-20260608.md) — verification-gap sibling: the canonical "verify apps/tv/mobile in the simulator" doc treats the sim as one target and doesn't warn that Apple-TV-only verification misses Android-TV divergence from `IS_ANDROID`-branched values. This learning is exactly that miss.
- [`design-patterns/tv-rail-overhang-pad-bounce-focus-20260616.md`](./tv-rail-overhang-pad-bounce-focus-20260616.md) — same-file neighbor: operates on `HomeRail.tsx`, whose `ITEM_GAP` / `COLUMN_WIDTH` / `RAIL_PADDING_LEFT` are now exported and load-bearing for the skeleton too.
- [`ui-bugs/rn-flex-wrap-grid-column-collapse-20260616.md`](../ui-bugs/rn-flex-wrap-grid-column-collapse-20260616.md) — symptom sibling: the same single-column-collapse class as the unguarded zero-width `CARD_COUNT` path.
