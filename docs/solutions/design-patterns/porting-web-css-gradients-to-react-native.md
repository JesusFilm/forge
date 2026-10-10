---
title: Porting web CSS-gradient placeholders to React Native (expo-linear-gradient)
date: 2026-07-08
category: design-patterns
module: apps/tv + apps/mobile (search cards)
problem_type: design_pattern
component: frontend_stimulus
severity: low
applies_when:
  - "Porting a web CSS gradient / visual placeholder to React Native (Expo)"
  - "A design needs repeating-linear-gradient or radial-gradient, which expo-linear-gradient can't express"
  - "Consuming Tailwind v4 palette values in React Native (colors are oklch())"
  - "Cross-platform visual parity requires the same computed value on web + RN"
related_components:
  - apps/web/src/components/search/VideoCard.tsx
  - apps/tv/src/components/search/ExperienceFallback.tsx
  - apps/mobile/src/components/search/ExperienceFallback.tsx
tags:
  - react-native
  - expo-linear-gradient
  - cross-platform-parity
  - tailwind-oklch
  - gradient
  - search
  - fallback-image
---

# Porting web CSS-gradient placeholders to React Native (expo-linear-gradient)

## Context

`apps/web` renders a custom "fallback image" for Experience search results with no
thumbnail (`apps/web/src/components/search/VideoCard.tsx`): a per-slug diagonal
gradient, a radial white glow, 135° repeating diagonal stripes, and the centered
title. `apps/tv` and `apps/mobile` showed a blank gray box / dim ▶ glyph for the
same results.

Porting the web look to React Native hit three RN-specific walls plus one parity
requirement:

- `expo-linear-gradient` has **no repeating gradient** (web's `repeating-linear-gradient`) and **no radial gradient**.
- Tailwind v4 palette colors are `oklch()` — React Native's color parser can't read them.
- The gradient color must match web **exactly** — the same experience should be the same color on web, TV, and mobile.

Adding `react-native-svg` would cover stripes + radial, but it's a new native
module → a TV `expo prebuild` and an Expo Go risk. We wanted a JS-only change.

## Guidance

1. **Reuse `expo-linear-gradient`; do not add `react-native-svg`.** It is already a
   dependency in both apps. A new native module forces a TV native rebuild and can
   break Expo Go; staying JS-only keeps the change verifiable against an
   already-installed dev client with no prebuild. See
   `docs/solutions/best-practices/react-native-tvos-porting-pitfalls-20260414.md`.

2. **Repeating stripes → hard-stop `LinearGradient` bands.** Since the gradient
   can't repeat, emit `N` fixed bands as one gradient's `colors` + `locations`,
   using duplicate adjacent locations for hard edges. Compute each band's end as
   `(i + 1) * period`, **not** `start + period` — bit-identical to the next band's
   start, so float drift can't make `locations` tick backwards (the native gradient
   requires non-decreasing locations). A unit test on monotonicity + span catches
   the drift.

3. **Radial glow → off-center linear approximation.** There is no radial primitive;
   a `LinearGradient` from an off-center start (`start={{ x: 0.15, y: 0.1 }}`) to a
   zero-alpha stop reads as a soft corner glow.

4. **Tailwind v4 `oklch()` → sRGB hex.** RN can't parse `oklch()`. Pull the exact
   values from `node_modules/.../tailwindcss/theme.css` and convert
   oklch → linear-sRGB → gamma → hex, clamping to sRGB (matching what a browser
   shows on an sRGB display). Bake the resulting hex triples into the RN helper —
   don't ship `oklch()` strings to RN.

5. **Parity via a ported pure function + a locking test.** Port web's exact
   selection function (here a djb2 slug hash → palette index) into a pure per-app
   helper, and add a colocated test pinning specific results to web's values
   (`easter → 1`, `the-hope-of-christmas → 6`). Web/TV/mobile then independently
   compute the same color, and the test fails the moment anyone drifts the hash or
   palette order.

6. **Per-app duplication is deliberate.** The helper is byte-identical across
   `apps/tv` and `apps/mobile`, matching the repo's per-app-copy convention
   (normalizers, `searchDisplay`, etc. are already duplicated). Each copy ships its
   own parity test so drift is bounded. This is the opposite call from
   `docs/solutions/design-patterns/mirror-ui-derive-geometry-from-shared-constants.md`
   (which prefers shared constants) — justified here because there is no shared RN
   UI package and the palette is a stable ported constant, not evolving geometry.

7. **Typing.** `expo-linear-gradient` types `colors` / `locations` as
   `readonly [T, T, ...T[]]` tuples. A dynamically-built stripe array is a plain
   `T[]`, so it needs one `as unknown as` cast (length ≥ 2 is guaranteed by
   construction — document that in a comment).

## Why This Matters

RN's gradient primitive is strictly weaker than CSS. A naive port either drops the
texture silently or reaches for `react-native-svg` and pays a native-rebuild tax on
TV. The `oklch()` trap is subtle — the palette "works" in a browser and silently
no-ops (or throws) in RN. The parity test converts an otherwise-invisible
cross-platform contract into a failing unit test. And the `(i + 1) * period`
locations fix was a real bug the monotonicity test caught **before** it shipped
(the naive `start + period` differed from the next band's start by 1 ULP).

## When to Apply

- Porting a web CSS gradient / visual placeholder to React Native (Expo).
- A design needs `repeating-linear-gradient` or `radial-gradient` that
  `expo-linear-gradient` can't express.
- Consuming Tailwind v4 palette values in React Native.
- A computed visual value (color, layout) must be identical on web and RN.

## Examples

**oklch → sRGB hex (run once, bake the output into the helper):**

```js
function oklchToHex(L, C, H) {
  L = L / 100
  const hr = (H * Math.PI) / 180
  const a = C * Math.cos(hr),
    b = C * Math.sin(hr)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const enc = (c) => {
    c = Math.max(0, Math.min(1, c))
    c = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0")
  }
  return (
    "#" +
    enc(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) +
    enc(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) +
    enc(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  )
}
```

**Hard-stop stripe bands (the load-bearing `(i + 1) * period`):**

```ts
const STRIPE_ON = "rgba(255,255,255,0.05)"
const STRIPE_OFF = "rgba(255,255,255,0)" // NOT "transparent" — see dark-banding doc

export function buildStripeGradient(count = 14) {
  const colors: string[] = [],
    locations: number[] = []
  const period = 1 / count,
    duty = 14 / 32
  for (let i = 0; i < count; i++) {
    const start = i * period
    const mid = start + period * duty
    const end = (i + 1) * period // bit-identical to next start → never decreasing
    colors.push(STRIPE_ON, STRIPE_ON, STRIPE_OFF, STRIPE_OFF)
    locations.push(start, mid, mid, end)
  }
  return { colors, locations }
}
```

**Parity test (locks the port to web):**

```ts
it.each([
  ["easter", 1],
  ["the-hope-of-christmas", 6],
  ["jesus", 7],
])("maps %p to palette index %i (matches web)", (slug, index) =>
  expect(experienceGradientForSlug(slug)).toBe(EXPERIENCE_GRADIENTS[index]),
)
```

**Before → after:** Experience search cards rendered a blank gray box (TV) / dim ▶
glyph (mobile); now they render the striped gradient + centered title, colors
matching web (Easter is orange on all three platforms). Verified in the tvOS and
iOS simulators.

## Related

- `docs/solutions/integration-issues/semantic-search-video-card-display-metadata-hydration.md` — same `VideoCard.tsx`; the dark-placeholder state this gradient replaces.
- `docs/solutions/best-practices/react-native-tvos-porting-pitfalls-20260414.md` — justifies "no react-native-svg / no new native dep" on TV.
- `docs/solutions/mobile/linear-gradient-dark-banding-transparent-keyword.md` — sibling `expo-linear-gradient` correctness gotcha (use `rgba(...,0)`, never `"transparent"`).
- `docs/solutions/mobile/expo-image-blurradius-cross-platform-calibration.md` — thumbnail+gradient parity across mobile/TV via per-platform value calibration.
- `docs/solutions/design-patterns/mirror-ui-derive-geometry-from-shared-constants.md` — contrast: shared constants vs per-app copy for placeholder UI.
- PR: https://github.com/JesusFilm/forge/pull/1489
