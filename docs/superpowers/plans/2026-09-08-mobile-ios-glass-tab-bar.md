# iOS Floating Liquid-Glass Tab Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On iOS, turn the bottom tab bar into a floating frosted capsule that content scrolls behind. On Android, change nothing.

**Architecture:** `tabBarStyle` carries the pill geometry and `tabBarBackground` carries the frosted material — both are options on the existing navigator, so no custom tab bar component is written. One new module, `src/lib/tabBar.ts`, owns every number, and the navigator, the Library screen, the mini player and six scroll surfaces all read it from there. The material is `GlassView` on iOS 26, `PlatformBlur` below it, and `null` on Android.

**Tech Stack:** React Native 0.86, Expo SDK 57, expo-router 57 (vendored bottom-tabs fork), `expo-glass-effect` 57, `expo-blur` 57, `react-native-safe-area-context` 5.7, jest + jest-expo, react-test-renderer.

**Spec:** `docs/superpowers/specs/2026-09-08-mobile-ios-glass-tab-bar-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Android must be byte-identical to today.** The bar keeps `backgroundColor: "#1c1917"`, stays in the flow, gets no radius, gets no material, gets no clearance, and keeps `tabBarHideOnKeyboard` unset. An Android screenshot after the change must match one taken before it.
- **No new dependencies and no native code.** `expo-glass-effect` and `expo-blur` are already installed. The change must stay deliverable over the air, so do not touch `app.json`, `eas.json`, `plugins/` or `package.json` dependencies.
- **`@react-navigation/bottom-tabs` does not resolve from `apps/mobile`.** `require.resolve` returns `MODULE_NOT_FOUND`. The app runs the fork vendored by expo-router. If you ever need `useBottomTabBarHeight`, import it from `expo-router/js-tabs`. Importing from `@react-navigation/bottom-tabs` passes `tsc` and then fails when Metro builds the bundle.
- **Never set `isInteractive` on a `GlassView`.** Inside a pressable it flashes white on remount. See `docs/solutions/best-practices/expo-glass-effect-interactive-flash-2026-04-08.md`.
- **Always set `colorScheme="dark"` on a `GlassView`.** `app.json` sets `userInterfaceStyle: "automatic"` while every React Native surface in this app is hard-coded dark.
- **Inline comments are capped at 3 lines per block.** Lead with the reason, not a restatement of the code. Prefer no comment.
- **Conventional commits** (`feat:`, `fix:`, `chore:`, `docs:`). **Never** pass `--no-verify`.
- Run tests from `apps/mobile` with `pnpm test`. Run `pnpm typecheck` and `pnpm lint` before each commit.

### Pill geometry — the numbers, in one place

```
TAB_BAR_PILL_HEIGHT      56
TAB_BAR_PILL_LIFT        12    measured from the safe area, NEVER the screen edge
TAB_BAR_PILL_SIDE_MARGIN 16
TAB_BAR_PILL_RADIUS      28    = height / 2
TAB_BAR_CLEARANCE_GAP    12    breathing room between the last row and the pill
TAB_BAR_OCCUPIED_HEIGHT  68    iOS = height + lift; android stays 56
```

## Decisions

### D1 — The label-contrast floor is set by measurement, not chosen up front

A frosted pill puts the tab labels over whatever the page is showing. The repo's
standing position is that blur carries no contrast:
`src/lib/bibleCardTreatment.ts:8-20` records `FROSTED_TINT` as "the FLOOR, not a
preference … Blur cannot help — it removes DETAIL, not luminance."

Measured contrast of the two label colours against the ground behind them:

| Ground behind the pill         | Active `#CB333B` | Idle `#a8a29e` |
| ------------------------------ | ---------------- | -------------- |
| App ground `#1c1917` (today)   | **3.39:1**       | 6.93:1         |
| White video frame, no tint     | 5.15:1           | **2.52:1**     |
| White frame, black tint α 0.30 | **2.46:1**       | **1.20:1**     |
| White frame, black tint α 0.45 | **1.53:1**       | **1.33:1**     |
| White frame, black tint α 0.55 | **1.09:1**       | **1.88:1**     |
| White frame, black tint α 0.70 | **1.64:1**       | **3.35:1**     |
| White frame, black tint α 0.78 | **2.28:1**       | 4.65:1         |

Two non-obvious results follow, and both must survive into the implementation:

1. **A mid-range tint is the worst possible choice.** α 0.45 lands the ground at
   mid-grey, where _both_ labels sit near 1.3:1. A floor must go dark enough to
   pass (α ≥ 0.78 for the idle label) or not be applied at all. Reaching for
   "about half" makes the page less readable than no tint.
2. **No tint floor can rescue the active label.** `#CB333B` has a middling
   luminance, so it fails against dark and light grounds alike. At α 0.78 it
   reads 2.28:1, which is _worse_ than the 3.39:1 it has today. Only changing the
   colour fixes it, and that is D2.

**The decision:** do not ship a guessed tint. Task 7 measures the real ground
behind the pill on Home, then applies this rule:

- Idle labels measure ≥ 4.5:1 → ship no tint. The glass stays clean.
- Idle labels measure < 4.5:1 → add a black tint and re-measure. **See the
  addendum below: the α 0.78 figure was wrong for a tint on the material.**
- The `GlassView` path is measured **separately**. iOS 26's material adapts its
  own contrast, so it may already pass where the blur fallback does not. Do not
  assume the two paths need the same treatment.

### D1 addendum — corrected by measurement, 2026-09-08

**The α ≥ 0.78 figure does not apply to a tint placed on the material.** The
table it came from composites black over a _white_ backdrop with no material in
between, which is why the middle of that range reads worst. A tint set on the
`GlassView` or the `PlatformBlur` lands on ground the material has _already_
darkened, and from a dark starting point the idle contrast rises
**monotonically** with alpha. There is no bad middle to avoid.

Measured on the iPhone 17 Pro Max simulator, Home feed, bright backdrop
(luminance 0.804), sampling the capsule interior beside the labels:

| Tint                 | Worst ground  | Idle `#a8a29e`            |
| -------------------- | ------------- | ------------------------- |
| none                 | rgb(86,74,77) | **3.35:1** — fails        |
| α 0.20               | rgb(69,59,62) | 4.27:1 — fails            |
| α 0.26               | —             | 4.50:1 — computed minimum |
| **α 0.30 (shipped)** | rgb(60,52,54) | **4.79:1** — passes       |

A controlled A/B at one scroll position moved the ground from rgb(60,43,42) to
rgb(23,23,19), and the contrast from 5.30:1 to 7.13:1. Every tinted position
measured passes, the worst being 5.08:1.

`TAB_BAR_MATERIAL_TINT` in `src/lib/tabBar.ts` holds the value; the glass test
pins it.

**Residual:** the single brightest frame was measured _untinted_ at 3.35:1, and
its tinted result is a computation (4.79:1) rather than a re-measurement — the
feed could not be scrolled back to that exact position. Every other position was
measured on both sides.

### D2 — The active tint fails AA today; fixing it is deliberately out of scope

`tabBarActiveTintColor` is `#CB333B` on `#1c1917` at 10pt: **3.39:1**, against a
WCAG AA requirement of 4.5:1 for text that size. This is true on `main` today and
is not caused by this change.

It is not fixed here because `tabBarActiveTintColor` is shared with Android, and
this change is bound by "Android must be byte-identical to today". Raising it
would need either a platform fork of the brand colour, which is worse, or a
product decision to change the brand red app-wide.

Record it in the Task 7 findings and hand it on. A readable sibling on the same
hue is `#e05a61` (4.79:1) if the product owner wants one.

## File Structure

| File                                                             | Responsibility                                                                                                       |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/lib/tabBar.ts` (create)                                     | The only place that spells the pill's numbers. Exports the constants, `useTabBarStyle()` and `useTabBarClearance()`. |
| `src/lib/__tests__/tabBar.test.ts` (create)                      | Proves both platform branches of both hooks.                                                                         |
| `src/components/ui/TabBarBackground.tsx` (create)                | The frosted material. Glass on iOS 26, blur below, `null` on Android.                                                |
| `src/components/ui/__tests__/TabBarBackground.test.tsx` (create) | Proves the three-way branch.                                                                                         |
| `app/(tabs)/_layout.tsx` (modify)                                | Consumes the style and the material. Stops exporting `TAB_BAR_STYLE`.                                                |
| `app/__tests__/tabBarLayout.test.tsx` (create)                   | Pins the iOS/Android fork of the navigator's options.                                                                |
| `app/__tests__/tabBarSingleSource.guard.test.js` (create)        | Fails if `PlaybackHost` or `library.tsx` spells the bar's numbers instead of importing them.                         |
| `app/(tabs)/library.tsx` (modify)                                | Reads the same hook for its selection-mode restore and its scroll clearance.                                         |
| `src/components/watch/PlaybackHost.tsx` (modify)                 | Reserves the shared occupied height instead of a hand-copied `49`.                                                   |
| `src/lib/miniPlayer/__tests__/layout.test.ts` (modify)           | Its `PHONE` fixture reads the shared constant.                                                                       |
| `src/components/home/HomeScreen.tsx` (modify)                    | List-level clearance.                                                                                                |
| `app/(tabs)/watch.tsx` (modify)                                  | List-level clearance.                                                                                                |
| `src/components/search/BrowseTopics.tsx` (modify)                | List-level clearance.                                                                                                |
| `app/(tabs)/profile.tsx` (modify)                                | List-level clearance.                                                                                                |
| `src/components/ui/Snackbar.tsx` (modify)                        | Overlay clearance.                                                                                                   |
| `src/components/library/SelectionActionBar.tsx` (modify)         | Becomes a pill on iOS, unchanged on Android.                                                                         |
| `apps/mobile/CLAUDE.md` (modify)                                 | Documents the fork, the ordering trap, and the height link.                                                          |

---

### Task 1: The shared tab-bar module

Nothing renders differently after this task. It creates the single source of truth that every later task reads, so that no two files can disagree about the pill's size.

**Files:**

- Create: `apps/mobile/src/lib/tabBar.ts`
- Test: `apps/mobile/src/lib/__tests__/tabBar.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `TAB_BAR_PILL_HEIGHT: number` (56)
  - `TAB_BAR_PILL_LIFT: number` (12)
  - `TAB_BAR_PILL_SIDE_MARGIN: number` (16)
  - `TAB_BAR_PILL_RADIUS: number` (28)
  - `TAB_BAR_CLEARANCE_GAP: number` (12)
  - `TAB_BAR_OCCUPIED_HEIGHT: number` — module-scope `Platform.select`
  - `TAB_BAR_FLAT_STYLE: ViewStyle` — today's Android style
  - `useTabBarStyle(): ViewStyle`
  - `useTabBarClearance(): number`

**Why the two hooks branch at call time, not at module scope.** `Platform.select` at module scope resolves once, at import. A test that redefines `Platform.OS` afterwards can never reach the other branch. Both hooks therefore read `Platform.OS` inside the function body, so both branches are reachable from a test. `TAB_BAR_OCCUPIED_HEIGHT` stays a module constant because `PlaybackHost` already builds its config that way — that limitation is pre-existing and is called out in Task 4.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/lib/__tests__/tabBar.test.ts` (`.ts`, not `.tsx` — there is no JSX here, and neither hook touches React internals once `useSafeAreaInsets` is mocked, so both are callable straight from a test body):

```ts
/**
 * The pill's numbers live in one module so the navigator, the Library screen,
 * the mini player and six scroll surfaces cannot disagree about them.
 */
import { Platform } from "react-native"

import {
  TAB_BAR_CLEARANCE_GAP,
  TAB_BAR_FLAT_STYLE,
  TAB_BAR_PILL_HEIGHT,
  TAB_BAR_PILL_LIFT,
  TAB_BAR_PILL_RADIUS,
  TAB_BAR_PILL_SIDE_MARGIN,
  useTabBarClearance,
  useTabBarStyle,
} from "../tabBar"

// The `mock` prefix is required: babel-plugin-jest-hoist lifts jest.mock above
// this declaration and rejects any other out-of-scope name in the factory.
const mockInsets = { top: 59, right: 0, bottom: 34, left: 0 }
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mockInsets,
}))

// Platform.OS is a configurable getter, so a data-property override works; the
// saved descriptor restores the real getter after each test.
const platformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, "OS")!
function setPlatform(os: "ios" | "android") {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true })
}
afterEach(() => {
  Object.defineProperty(Platform, "OS", platformOsDescriptor)
  mockInsets.left = 0
  mockInsets.right = 0
})

describe("pill constants", () => {
  it("makes a true capsule — the radius is half the height", () => {
    expect(TAB_BAR_PILL_RADIUS).toBe(TAB_BAR_PILL_HEIGHT / 2)
  })
})

describe("useTabBarStyle on iOS", () => {
  it("lifts the pill from the SAFE AREA, not the screen edge", () => {
    setPlatform("ios")
    // The mini player reserves height + lift as one constant. Measured from the
    // screen edge that number would differ on every device.
    expect(useTabBarStyle().marginBottom).toBe(
      mockInsets.bottom + TAB_BAR_PILL_LIFT,
    )
  })

  it("drops the opaque fill, or the glass renders behind a solid block", () => {
    setPlatform("ios")
    expect(useTabBarStyle().backgroundColor).toBeUndefined()
  })

  it("zeroes paddingBottom, which the bar otherwise puts INSIDE the height", () => {
    setPlatform("ios")
    expect(useTabBarStyle().paddingBottom).toBe(0)
  })

  it("floats absolutely so content passes behind it", () => {
    setPlatform("ios")
    const style = useTabBarStyle()
    expect(style.position).toBe("absolute")
    expect(style.height).toBe(TAB_BAR_PILL_HEIGHT)
    expect(style.borderRadius).toBe(TAB_BAR_PILL_RADIUS)
    expect(style.overflow).toBe("hidden")
    expect(style.borderTopWidth).toBe(0)
  })

  it("clears a landscape notch on top of the side margin", () => {
    setPlatform("ios")
    mockInsets.left = 44
    expect(useTabBarStyle().marginHorizontal).toBe(
      TAB_BAR_PILL_SIDE_MARGIN + 44,
    )
  })
})

describe("useTabBarStyle on Android", () => {
  it("returns today's flat style, untouched", () => {
    setPlatform("android")
    expect(useTabBarStyle()).toEqual(TAB_BAR_FLAT_STYLE)
    expect(TAB_BAR_FLAT_STYLE).toEqual({
      backgroundColor: "#1c1917",
      borderTopColor: "transparent",
    })
  })

  it("never floats, so nothing downstream needs to compensate", () => {
    setPlatform("android")
    const style = useTabBarStyle()
    expect(style.position).toBeUndefined()
    expect(style.borderRadius).toBeUndefined()
  })
})

describe("useTabBarClearance", () => {
  it("clears the pill, the inset and a breathing gap on iOS", () => {
    setPlatform("ios")
    expect(useTabBarClearance()).toBe(
      mockInsets.bottom +
        TAB_BAR_PILL_HEIGHT +
        TAB_BAR_PILL_LIFT +
        TAB_BAR_CLEARANCE_GAP,
    )
  })

  it("is ZERO on Android, where the bar still displaces content", () => {
    setPlatform("android")
    expect(useTabBarClearance()).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/mobile && pnpm test src/lib/__tests__/tabBar.test.ts
```

Expected: FAIL — `Cannot find module '../tabBar'`.

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/src/lib/tabBar.ts`:

```ts
import { Platform, type ViewStyle } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { BG_COLOR } from "./color"

export const TAB_BAR_PILL_HEIGHT = 56
export const TAB_BAR_PILL_LIFT = 12
export const TAB_BAR_PILL_SIDE_MARGIN = 16
export const TAB_BAR_PILL_RADIUS = TAB_BAR_PILL_HEIGHT / 2
export const TAB_BAR_CLEARANCE_GAP = 12

/**
 * Space the bar occupies ABOVE the safe-area inset. The mini player reserves
 * this. Android keeps its present (already 7pt optimistic) value — correcting
 * it here would move the Android window and read as a regression.
 */
export const TAB_BAR_OCCUPIED_HEIGHT =
  Platform.select({
    ios: TAB_BAR_PILL_HEIGHT + TAB_BAR_PILL_LIFT,
    android: 56,
    default: 49,
  }) ?? 49

/** Android's bar, unchanged. The Library screen restores exactly this. */
export const TAB_BAR_FLAT_STYLE: ViewStyle = {
  backgroundColor: BG_COLOR,
  borderTopColor: "transparent",
}

/**
 * The navigator's `tabBarStyle`. A hook because the pill's lift is measured
 * from the safe area, and it reads `Platform.OS` at call time so a test can
 * reach both branches.
 */
export function useTabBarStyle(): ViewStyle {
  const insets = useSafeAreaInsets()
  if (Platform.OS !== "ios") return TAB_BAR_FLAT_STYLE

  return {
    position: "absolute",
    height: TAB_BAR_PILL_HEIGHT,
    marginBottom: insets.bottom + TAB_BAR_PILL_LIFT,
    marginHorizontal:
      TAB_BAR_PILL_SIDE_MARGIN + Math.max(insets.left, insets.right),
    borderRadius: TAB_BAR_PILL_RADIUS,
    overflow: "hidden",
    // The bar puts `insets.bottom` INSIDE a numeric height, and it draws an
    // unconditional hairline. Both would eat the capsule.
    paddingBottom: 0,
    paddingHorizontal: 0,
    borderTopWidth: 0,
  }
}

/**
 * What a scroll surface must clear. Zero on Android, where the bar still
 * displaces content instead of floating over it.
 */
export function useTabBarClearance(): number {
  const insets = useSafeAreaInsets()
  if (Platform.OS !== "ios") return 0
  return (
    insets.bottom +
    TAB_BAR_PILL_HEIGHT +
    TAB_BAR_PILL_LIFT +
    TAB_BAR_CLEARANCE_GAP
  )
}
```

- [ ] **Step 4: Confirm `BG_COLOR` is exported where the import expects it**

```bash
cd apps/mobile && grep -n "export const BG_COLOR" src/lib/color.ts
```

Expected: one match. If `BG_COLOR` is not exported from `src/lib/color.ts`, inline the literal `"#1c1917"` in `TAB_BAR_FLAT_STYLE` instead and drop the import — the value must stay byte-identical to today's `app/(tabs)/_layout.tsx`.

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd apps/mobile && pnpm test src/lib/__tests__/tabBar.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 6: Typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/lib/tabBar.ts apps/mobile/src/lib/__tests__/tabBar.test.ts
git commit -m "feat(mobile): add the shared tab-bar geometry module"
```

---

### Task 2: The frosted material

**Files:**

- Create: `apps/mobile/src/components/ui/TabBarBackground.tsx`
- Test: `apps/mobile/src/components/ui/__tests__/TabBarBackground.test.tsx`

**Interfaces:**

- Consumes: `TAB_BAR_PILL_RADIUS` from Task 1.
- Produces: `TabBarBackground(): ReactElement | null` — a component taking no props, passed to the navigator as `tabBarBackground={TabBarBackground}`.

**Why two availability guards.** `isLiquidGlassAvailable()` answers "is the app using the Liquid Glass design". `isGlassEffectAPIAvailable()` exists because some iOS 26 beta builds crash without it (expo/expo#40911). Both return `false` off iOS, so the Android branch is safe either way — but the explicit `Platform.OS` check is what makes the intent readable and testable.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/components/ui/__tests__/TabBarBackground.test.tsx`:

```tsx
/**
 * The tab bar's material. Three branches, and no other test in the app can see
 * any of them — every render suite mocks the material away.
 */
import { Platform } from "react-native"

import { TestRenderer } from "../../../test-utils/rnTestRenderer"
import { TabBarBackground } from "../TabBarBackground"

// The `mock` prefix is required: babel-plugin-jest-hoist lifts jest.mock above
// this declaration and rejects any other out-of-scope name in the factory.
const mockGlass = { liquid: true, api: true }
jest.mock("expo-glass-effect", () => ({
  GlassView: () => null,
  isLiquidGlassAvailable: () => mockGlass.liquid,
  isGlassEffectAPIAvailable: () => mockGlass.api,
}))
jest.mock("../PlatformBlur", () => ({
  PlatformBlur: () => null,
}))

const platformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, "OS")!
function setPlatform(os: "ios" | "android") {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true })
}
afterEach(() => {
  Object.defineProperty(Platform, "OS", platformOsDescriptor)
  mockGlass.liquid = true
  mockGlass.api = true
})

function renderMaterial() {
  return TestRenderer.create(<TabBarBackground />)
}

describe("TabBarBackground", () => {
  it("renders NOTHING on Android, so the bar keeps its opaque fill", () => {
    // A non-null element flips the bar's own backgroundColor to transparent.
    // Off iOS GlassView is a bare transparent View, so that would be invisible.
    setPlatform("android")
    expect(renderMaterial().toJSON()).toBeNull()
  })

  it("renders glass when iOS 26 offers it", () => {
    setPlatform("ios")
    const { GlassView } = require("expo-glass-effect")
    const found = renderMaterial().root.findAll((n) => n.type === GlassView)
    expect(found).toHaveLength(1)
    expect(found[0].props.glassEffectStyle).toBe("regular")
    // The app hard-codes dark while app.json says "automatic".
    expect(found[0].props.colorScheme).toBe("dark")
    // Inside a pressable, isInteractive flashes white on remount.
    expect(found[0].props.isInteractive).toBeUndefined()
  })

  it("falls back to blur when the design is unavailable (iOS below 26)", () => {
    setPlatform("ios")
    mockGlass.liquid = false
    const { PlatformBlur } = require("../PlatformBlur")
    expect(
      renderMaterial().root.findAll((n) => n.type === PlatformBlur),
    ).toHaveLength(1)
  })

  it("falls back to blur when the API is missing (iOS 26 betas that crash)", () => {
    setPlatform("ios")
    mockGlass.api = false
    const { PlatformBlur } = require("../PlatformBlur")
    expect(
      renderMaterial().root.findAll((n) => n.type === PlatformBlur),
    ).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/mobile && pnpm test src/components/ui/__tests__/TabBarBackground.test.tsx
```

Expected: FAIL — `Cannot find module '../TabBarBackground'`.

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/src/components/ui/TabBarBackground.tsx`:

```tsx
import { Platform, StyleSheet } from "react-native"
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "expo-glass-effect"

import { TAB_BAR_PILL_RADIUS } from "../../lib/tabBar"
import { PlatformBlur } from "./PlatformBlur"

/**
 * The tab bar's material. Returning null on Android is load-bearing: a non-null
 * element flips the bar's own backgroundColor to transparent, and off iOS
 * GlassView is a bare transparent View, so the bar would vanish.
 */
export function TabBarBackground() {
  if (Platform.OS !== "ios") return null

  // isGlassEffectAPIAvailable guards iOS 26 betas that crash without it.
  if (isLiquidGlassAvailable() && isGlassEffectAPIAvailable()) {
    return (
      <GlassView
        style={styles.material}
        glassEffectStyle="regular"
        colorScheme="dark"
      />
    )
  }

  return <PlatformBlur style={styles.material} intensity={60} tint="dark" />
}

const styles = StyleSheet.create({
  material: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: TAB_BAR_PILL_RADIUS,
  },
})
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/mobile && pnpm test src/components/ui/__tests__/TabBarBackground.test.tsx
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/components/ui/TabBarBackground.tsx apps/mobile/src/components/ui/__tests__/TabBarBackground.test.tsx
git commit -m "feat(mobile): add the tab bar's frosted material"
```

---

### Task 3: Wire the navigator and the Library restore

After this task the pill is visible on iOS. Content still passes behind it with no clearance, so lists look wrong until Task 5 — that is expected.

**Files:**

- Modify: `apps/mobile/app/(tabs)/_layout.tsx`
- Modify: `apps/mobile/app/(tabs)/library.tsx:13`, `:118`, `:128`
- Test: `apps/mobile/app/__tests__/tabBarLayout.test.tsx`

**Interfaces:**

- Consumes: `useTabBarStyle` from Task 1, `TabBarBackground` from Task 2.
- Produces: `app/(tabs)/_layout.tsx` no longer exports `TAB_BAR_STYLE`. Any importer must move to `useTabBarStyle()`.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/app/__tests__/tabBarLayout.test.tsx`:

```tsx
/**
 * Pins the platform fork of the navigator's options. jest-expo defaults to
 * `ios`, so the Android branch must be entered on purpose or it never runs.
 */
import { Platform } from "react-native"

import { TestRenderer } from "../../src/test-utils/rnTestRenderer"

// The `mock` prefix is required: babel-plugin-jest-hoist lifts jest.mock above
// this declaration and rejects any other out-of-scope name in the factory.
const mockScreenOptions: { current: Record<string, unknown> | undefined } = {
  current: undefined,
}
jest.mock("expo-router", () => ({
  Tabs: Object.assign(
    (props: { screenOptions?: Record<string, unknown> }) => {
      mockScreenOptions.current = props.screenOptions
      return null
    },
    { Screen: () => null },
  ),
}))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 59, right: 0, bottom: 34, left: 0 }),
}))
jest.mock("expo-glass-effect", () => ({
  GlassView: () => null,
  isLiquidGlassAvailable: () => true,
  isGlassEffectAPIAvailable: () => true,
}))

const platformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, "OS")!
function setPlatform(os: "ios" | "android") {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true })
}
afterEach(() => {
  Object.defineProperty(Platform, "OS", platformOsDescriptor)
  mockScreenOptions.current = undefined
  jest.resetModules()
})

function renderLayout() {
  // Re-require so the layout re-reads Platform.OS after the override.
  const TabLayout = require("../(tabs)/_layout").default
  TestRenderer.create(<TabLayout />)
  return mockScreenOptions.current!
}

describe("iOS", () => {
  it("drops the opaque fill so the material is visible", () => {
    setPlatform("ios")
    const style = renderLayout().tabBarStyle as Record<string, unknown>
    // tabBarStyle is applied AFTER the bar's own transparent backgroundColor,
    // so a fill here would hide the glass with no warning.
    expect(style.backgroundColor).toBeUndefined()
    expect(style.borderRadius).toBe(28)
    expect(style.position).toBe("absolute")
  })

  it("supplies a material and hides the pill behind the keyboard", () => {
    setPlatform("ios")
    const options = renderLayout()
    expect(options.tabBarBackground).toBeDefined()
    expect(options.tabBarHideOnKeyboard).toBe(true)
  })
})

describe("Android", () => {
  it("keeps today's flat opaque bar", () => {
    setPlatform("android")
    const style = renderLayout().tabBarStyle as Record<string, unknown>
    expect(style).toEqual({
      backgroundColor: "#1c1917",
      borderTopColor: "transparent",
    })
  })

  it("supplies no material, so the bar keeps its own fill", () => {
    setPlatform("android")
    const options = renderLayout()
    const material = options.tabBarBackground as () => unknown
    expect(material()).toBeNull()
  })

  it("leaves tabBarHideOnKeyboard unset, exactly as today", () => {
    setPlatform("android")
    expect(renderLayout().tabBarHideOnKeyboard).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/mobile && pnpm test app/__tests__/tabBarLayout.test.tsx
```

Expected: FAIL — the iOS assertions fail because `tabBarStyle` still carries `backgroundColor`, and `tabBarBackground` is undefined.

- [ ] **Step 3: Rewrite the navigator**

Replace the top of `apps/mobile/app/(tabs)/_layout.tsx` — the imports, the `ACCENT`/`MUTED`/`BG_COLOR` constants, the `TAB_BAR_STYLE` export and the `screenOptions` block — with this. Leave all four `<Tabs.Screen>` blocks exactly as they are.

```tsx
import { Tabs } from "expo-router"
import { Platform } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { TabBarBackground } from "../../src/components/ui/TabBarBackground"
import { useTabBarStyle } from "../../src/lib/tabBar"

const ACCENT = "#CB333B"
const MUTED = "#a8a29e"
const BG_COLOR = "#1c1917"

export default function TabLayout() {
  const tabBarStyle = useTabBarStyle()

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACCENT,
        tabBarInactiveTintColor: MUTED,
        tabBarStyle,
        tabBarBackground: TabBarBackground,
        // A floating pill glued to the keyboard's top edge reads as a bug.
        // Unset on Android, exactly as today.
        tabBarHideOnKeyboard: Platform.OS === "ios" ? true : undefined,
        tabBarLabelStyle: {
          fontSize: Platform.select({ ios: 10, android: 12 }),
          fontFamily: "System",
        },
      }}
    >
```

`BG_COLOR` stays because the Discover screen's `headerStyle` still uses it.

- [ ] **Step 4: Move the Library screen onto the hook**

In `apps/mobile/app/(tabs)/library.tsx`, replace the import on line 13:

```tsx
import { useTabBarStyle } from "../../src/lib/tabBar"
```

Inside `LibraryScreen`, beside the existing `useSafeAreaInsets()` call, add:

```tsx
const tabBarStyle = useTabBarStyle()
```

Then update both `setOptions` effects. The first, at line ~116:

```tsx
// KTD8: the action bar replaces the tab bar during selection; restored
// whenever selection turns off, on blur (switching tabs), and on unmount.
useEffect(() => {
  navigation.setOptions({
    tabBarStyle: selecting ? { display: "none" } : tabBarStyle,
  })
}, [selecting, navigation, tabBarStyle])
```

And the second, at line ~128:

```tsx
useEffect(() => {
  const unsubscribeBlur = navigation.addListener("blur", () => {
    setSelectionState(exitSelection())
  })
  return () => {
    unsubscribeBlur()
    navigation.setOptions({ tabBarStyle })
  }
}, [navigation, tabBarStyle])
```

- [ ] **Step 5: Confirm nothing else imported the deleted constant**

```bash
cd apps/mobile && grep -rn "TAB_BAR_STYLE" app src
```

Expected: **no output**. Any remaining hit must move to `useTabBarStyle()`.

- [ ] **Step 6: Run the new test and the full suite**

```bash
cd apps/mobile && pnpm test app/__tests__/tabBarLayout.test.tsx && pnpm test
```

Expected: the new suite PASSES with 5 tests, and the full suite stays green.

- [ ] **Step 7: Typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add "apps/mobile/app/(tabs)/_layout.tsx" "apps/mobile/app/(tabs)/library.tsx" apps/mobile/app/__tests__/tabBarLayout.test.tsx
git commit -m "feat(mobile): float the iOS tab bar as a frosted pill"
```

---

### Task 4: Move the mini player above the pill

Without this the floating window overlaps the pill by 13pt on a notched iPhone, in the default resting corner.

**Files:**

- Modify: `apps/mobile/src/components/watch/PlaybackHost.tsx:136-144`, `:1246-1248`
- Modify: `apps/mobile/src/lib/miniPlayer/__tests__/layout.test.ts:17-22`
- Test: `apps/mobile/app/__tests__/tabBarSingleSource.guard.test.js`

**Interfaces:**

- Consumes: `TAB_BAR_OCCUPIED_HEIGHT` from Task 1.
- Produces: `PlaybackHost.tsx` keeps exporting `TAB_BAR_CONTENT_HEIGHT`, so `PlaybackHost.test.tsx:165` and `MiniPlayerWindow.test.tsx:148` keep importing it unchanged.

**Why a source guard and not an assertion.** Both suites that assert on `TAB_BAR_CONTENT_HEIGHT` import it, so changing the constant moves both sides of every assertion equally. No behavioural test can notice the number drifting from the bar's real height. A guard on the source shape can.

- [ ] **Step 1: Write the failing guard**

Create `apps/mobile/app/__tests__/tabBarSingleSource.guard.test.js`:

```js
// Plain JS (like the guards beside it): the RN tsconfig has no Node types, and
// this guard needs fs/path to scan source files.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// The bar's height lives in `src/lib/tabBar.ts`. PlaybackHost used to hand-copy
// it, and both suites that assert on it import it — so the constant cancels out
// on both sides and no behavioural test can see it drift.
const ROOT = path.resolve(__dirname, "../..")
const SHARED_MODULE = /lib\/tabBar["']/

const MUST_IMPORT_THE_SHARED_HEIGHT = [
  ["src/components/watch/PlaybackHost.tsx", /TAB_BAR_OCCUPIED_HEIGHT/],
  ["app/(tabs)/library.tsx", /useTabBarStyle/],
  ["app/(tabs)/_layout.tsx", /useTabBarStyle/],
]

function read(relative) {
  const full = path.join(ROOT, relative)
  expect(fs.existsSync(full)).toBe(true)
  return fs.readFileSync(full, "utf8")
}

describe("the tab bar has one source of truth", () => {
  it.each(MUST_IMPORT_THE_SHARED_HEIGHT)(
    "%s imports it rather than spelling it",
    (relative, symbol) => {
      const source = read(relative)
      expect(source).toMatch(SHARED_MODULE)
      expect(source).toMatch(symbol)
    },
  )

  it("PlaybackHost declares no bare tab-bar height of its own", () => {
    const source = read("src/components/watch/PlaybackHost.tsx")
    // The old shape: `TAB_BAR_CONTENT_HEIGHT = Platform.select({ ios: 49, … })`.
    expect(source).not.toMatch(/TAB_BAR_CONTENT_HEIGHT\s*=\s*Platform\.select/)
  })

  it("the guard is falsifiable — it would catch a hand-copied number", () => {
    const decoy =
      "export const TAB_BAR_CONTENT_HEIGHT = Platform.select({\n  ios: 49,\n})"
    expect(decoy).toMatch(/TAB_BAR_CONTENT_HEIGHT\s*=\s*Platform\.select/)
  })
})
```

- [ ] **Step 2: Run the guard to verify it fails**

```bash
cd apps/mobile && pnpm test app/__tests__/tabBarSingleSource.guard.test.js
```

Expected: FAIL — `PlaybackHost.tsx` still declares its own `Platform.select` and does not import `lib/tabBar`.

- [ ] **Step 3: Point PlaybackHost at the shared height**

In `apps/mobile/src/components/watch/PlaybackHost.tsx`, add to the imports:

```tsx
import { TAB_BAR_OCCUPIED_HEIGHT } from "../../lib/tabBar"
```

Replace lines 136-144 (the comment block and the `Platform.select`) with:

```tsx
/** Chrome heights the window may not cover (R7). Both exclude the safe-area
 *  inset, which the corner geometry already subtracts. The bottom reservation
 *  applies on every route so the window keeps one height across pushes. */
export const TAB_BAR_CONTENT_HEIGHT = TAB_BAR_OCCUPIED_HEIGHT
```

- [ ] **Step 4: Correct the stale comment at line ~1246**

The comment claims "The push drops the tab bar before the rect arrives, so the corner frame re-derives lower mid-expand". That has been false since the constant-reservation decision at line 806-809. Replace it with:

```tsx
// The bottom reservation is constant on every route (owner decision
// 2026-08-19), so a push never re-derives the corner frame.
```

- [ ] **Step 5: Point the layout fixture at the shared constant**

In `apps/mobile/src/lib/miniPlayer/__tests__/layout.test.ts`, add to the imports:

```ts
import { TAB_BAR_OCCUPIED_HEIGHT } from "../../tabBar"
```

Replace the `PHONE` fixture at lines 17-22:

```ts
/** An iPhone-shaped screen with a notch, home indicator, and the tab bar.
 *  The chrome height is READ from production — a literal here would drift. */
const PHONE: MiniPlayerLayoutConfig = {
  screen: { width: 390, height: 844 },
  insets: { top: 59, right: 0, bottom: 34, left: 0 },
  chrome: { top: 0, bottom: TAB_BAR_OCCUPIED_HEIGHT },
}
```

- [ ] **Step 6: Add a test that the window clears the pill**

Append to `apps/mobile/src/lib/miniPlayer/__tests__/layout.test.ts`:

```ts
describe("the resting window clears the floating tab bar", () => {
  it("leaves exactly WINDOW_EDGE_MARGIN between the window and the bar", () => {
    const frame = defaultCornerFrame(PHONE)
    const windowBottom = frame.y + frame.height
    const barTop =
      PHONE.screen.height - PHONE.insets.bottom - TAB_BAR_OCCUPIED_HEIGHT
    // 49 -> 68 on iOS. Without the change the window overlapped by 13pt, in
    // the DEFAULT resting corner.
    expect(barTop - windowBottom).toBe(WINDOW_EDGE_MARGIN)
  })
})
```

Add `WINDOW_EDGE_MARGIN` and `defaultCornerFrame` to the existing import block from `"../layout"` if either is missing.

- [ ] **Step 7: Run the affected suites**

```bash
cd apps/mobile && pnpm test app/__tests__/tabBarSingleSource.guard.test.js src/lib/miniPlayer src/components/watch/__tests__/PlaybackHost.test.tsx src/components/watch/__tests__/MiniPlayerWindow.test.tsx
```

Expected: all PASS. If `layout.test.ts`'s snap-threshold assertions (`x 113, y 364`) fail, that is the expected consequence of the taller reservation — recompute them from the fixture rather than restoring the old numbers.

- [ ] **Step 8: Run the full suite, typecheck and lint**

```bash
cd apps/mobile && pnpm test && pnpm typecheck && pnpm lint
```

Expected: all clean.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/src/components/watch/PlaybackHost.tsx apps/mobile/src/lib/miniPlayer/__tests__/layout.test.ts apps/mobile/app/__tests__/tabBarSingleSource.guard.test.js
git commit -m "fix(mobile): rest the mini player above the floating tab bar"
```

---

### Task 5: Clear the pill on six scroll surfaces

**Files:**

- Modify: `apps/mobile/src/components/home/HomeScreen.tsx:384-392`
- Modify: `apps/mobile/app/(tabs)/watch.tsx:838-841` and its `FlatList`
- Modify: `apps/mobile/src/components/search/BrowseTopics.tsx:59-63`
- Modify: `apps/mobile/app/(tabs)/library.tsx:351-356`, `:496-502`
- Modify: `apps/mobile/app/(tabs)/profile.tsx:17`, `:33-35`
- Modify: `apps/mobile/src/components/ui/Snackbar.tsx:81`
- Test: `apps/mobile/app/__tests__/tabBarClearance.guard.test.js`

**Interfaces:**

- Consumes: `useTabBarClearance` from Task 1.
- Produces: nothing new.

**Do not use `sceneStyle`.** It lands on the screen's outer box, which would shrink Home's `absoluteFill` hero layer and leave the glass with nothing to show. **Do not paint Home's padding region** — `HomeScreen.tsx:365-368` forbids an opaque `contentContainerStyle` because that region is deliberately transparent down to the moving hero.

- [ ] **Step 1: Write the failing guard**

Create `apps/mobile/app/__tests__/tabBarClearance.guard.test.js`:

```js
// Plain JS: the RN tsconfig has no Node types and this guard scans sources.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// On iOS the bar floats, so the screen container runs full height and nothing
// compensates. This is an ENUMERATION, not a sweep: a seventh scroll surface
// escapes it silently. Add a row whenever you add one.
const ROOT = path.resolve(__dirname, "../..")
const CLEARANCE = /useTabBarClearance/

const SURFACES = [
  "src/components/home/HomeScreen.tsx",
  "app/(tabs)/watch.tsx",
  "src/components/search/BrowseTopics.tsx",
  "app/(tabs)/library.tsx",
  "app/(tabs)/profile.tsx",
  "src/components/ui/Snackbar.tsx",
]

describe("every scroll surface clears the floating tab bar", () => {
  it.each(SURFACES)("%s reads the shared clearance", (relative) => {
    const full = path.join(ROOT, relative)
    expect(fs.existsSync(full)).toBe(true)
    expect(fs.readFileSync(full, "utf8")).toMatch(CLEARANCE)
  })

  it("names every surface the enumeration is meant to cover", () => {
    // A shrinking list is the failure mode this guard cannot otherwise see.
    expect(SURFACES).toHaveLength(6)
  })
})
```

- [ ] **Step 2: Run the guard to verify it fails**

```bash
cd apps/mobile && pnpm test app/__tests__/tabBarClearance.guard.test.js
```

Expected: FAIL — all six rows fail; no file reads the clearance yet.

- [ ] **Step 3: Clear the Home feed**

In `apps/mobile/src/components/home/HomeScreen.tsx`, import the hook:

```tsx
import { useTabBarClearance } from "../../lib/tabBar"
```

Call it beside the other hooks in the component body:

```tsx
const tabBarClearance = useTabBarClearance()
```

Then change the `contentContainerStyle` memo at lines 384-392:

```tsx
const contentContainerStyle = useMemo(
  () => ({
    // Hero-less degraded render: feed starts below the absolute header
    // instead of leaving a hero-sized hole.
    paddingTop: heroVisible ? heroHeight : insets.top + HEADER_ALLOWANCE,
    paddingBottom: 48 + tabBarClearance,
  }),
  [heroVisible, heroHeight, insets.top, tabBarClearance],
)
```

`HomeMissionSection` is deliberately untouched. Its `paddingBottom: 24` is spacing inside one feed item, and this container already clears the whole feed.

- [ ] **Step 4: Clear the Discover results list**

In `apps/mobile/app/(tabs)/watch.tsx`, import the hook:

```tsx
import { useTabBarClearance } from "../../src/lib/tabBar"
```

Call it in the component body:

```tsx
const tabBarClearance = useTabBarClearance()
```

Change the `FlatList`'s `contentContainerStyle` at line ~720:

```tsx
              contentContainerStyle={[
                styles.listContent,
                { paddingBottom: 32 + tabBarClearance },
              ]}
              scrollIndicatorInsets={{ bottom: tabBarClearance }}
```

This one matters most: the `ListFooterComponent` at lines 722-750 holds the live `Load more` button and the retry block. Behind a transparent pill they render and the bar takes the touch, which reads as a broken button.

- [ ] **Step 5: Clear the Discover browse grid**

In `apps/mobile/src/components/search/BrowseTopics.tsx`, import the hook:

```tsx
import { useTabBarClearance } from "../../lib/tabBar"
```

Call it in the component body beside `useCategoryThumbnails()`:

```tsx
const tabBarClearance = useTabBarClearance()
```

Change the `ScrollView`:

```tsx
      contentContainerStyle={[
        styles.content,
        { paddingBottom: 24 + tabBarClearance },
      ]}
      scrollIndicatorInsets={{ bottom: tabBarClearance }}
```

This is Discover's default view, before anyone types, and it is a second scroller behind an `absoluteFill` layer — easy to miss.

- [ ] **Step 6: Clear the Library list**

In `apps/mobile/app/(tabs)/library.tsx`, extend the Task 3 import:

```tsx
import { useTabBarClearance, useTabBarStyle } from "../../src/lib/tabBar"
```

Call it beside `useTabBarStyle()`:

```tsx
const tabBarClearance = useTabBarClearance()
// On iOS the selection pill occupies the same box as the tab pill, so one
// clearance covers both states. On Android the hidden bar leaves the old gap.
const selectionPad = selecting && Platform.OS === "android" ? 120 : 24
```

Add `Platform` to the existing `react-native` import. Change the `ScrollView` at lines 351-356:

```tsx
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: selectionPad + tabBarClearance },
          ]}
          scrollIndicatorInsets={{ bottom: tabBarClearance }}
          showsVerticalScrollIndicator={false}
        >
```

Delete the now-unused `scrollContentSelecting` entry from the stylesheet at lines 500-502, and delete `paddingBottom: 24` from `scrollContent` at line 498 so it does not fight the inline value. `scrollContent` keeps only `paddingHorizontal: 16`.

- [ ] **Step 7: Clear the Profile list**

Rewrite `apps/mobile/app/(tabs)/profile.tsx`'s component body and stylesheet:

```tsx
export default function ProfileScreen() {
  const insets = useSafeAreaInsets()
  const typography = useTypography()
  const tabBarClearance = useTabBarClearance()

  return (
    <View style={[layout.screenContainer, { paddingTop: insets.top }]}>
      <Text style={[styles.header, typography.heading]}>Profile</Text>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: 24 + tabBarClearance },
        ]}
        scrollIndicatorInsets={{ bottom: tabBarClearance }}
      >
        <AccountSection />
        <ProfileLinksSection />
      </ScrollView>
    </View>
  )
}
```

Add the import `import { useTabBarClearance } from "../../src/lib/tabBar"`.

`scrollContent` holds only `paddingBottom: 24`, so it is now empty. Delete the whole `scrollContent` entry from the stylesheet and drop it from the array, leaving:

```tsx
        contentContainerStyle={{ paddingBottom: 24 + tabBarClearance }}
```

- [ ] **Step 8: Lift the Snackbar**

In `apps/mobile/src/components/ui/Snackbar.tsx`, import the hook:

```tsx
import { useTabBarClearance } from "../../lib/tabBar"
```

Call it beside the existing `useSafeAreaInsets()`:

```tsx
const tabBarClearance = useTabBarClearance()
```

Change line 81:

```tsx
          bottom: insets.bottom + 16 + tabBarClearance,
```

The Snackbar is an absolute overlay, so a sweep of `contentContainerStyle` misses it entirely.

- [ ] **Step 9: Run the guard and the full suite**

```bash
cd apps/mobile && pnpm test app/__tests__/tabBarClearance.guard.test.js && pnpm test
```

Expected: the guard PASSES with 7 tests, and the full suite stays green.

- [ ] **Step 10: Typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

Expected: both clean.

- [ ] **Step 11: Commit**

```bash
git add apps/mobile/src/components/home/HomeScreen.tsx "apps/mobile/app/(tabs)/watch.tsx" apps/mobile/src/components/search/BrowseTopics.tsx "apps/mobile/app/(tabs)/library.tsx" "apps/mobile/app/(tabs)/profile.tsx" apps/mobile/src/components/ui/Snackbar.tsx apps/mobile/app/__tests__/tabBarClearance.guard.test.js
git commit -m "fix(mobile): clear the floating tab bar on every scroll surface"
```

---

### Task 6: Make the Library selection bar a pill

**Files:**

- Modify: `apps/mobile/src/components/library/SelectionActionBar.tsx`
- Test: `apps/mobile/src/components/library/__tests__/SelectionActionBar.test.tsx`

**Interfaces:**

- Consumes: `useTabBarStyle` and the pill constants from Task 1, `TabBarBackground` from Task 2.
- Produces: no signature change — `SelectionActionBarProps` is unchanged.

The bar sits where the tab bar would, in the same box, so it reuses the same geometry. On Android it keeps its present flush, full-width, opaque bar.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/components/library/__tests__/SelectionActionBar.test.tsx`:

```tsx
/**
 * The selection bar replaces the tab bar, so on iOS it must occupy the same box
 * as the pill. On Android it must not change at all.
 */
import { Platform } from "react-native"

import { TestRenderer } from "../../../test-utils/rnTestRenderer"
import {
  TAB_BAR_PILL_HEIGHT,
  TAB_BAR_PILL_LIFT,
  TAB_BAR_PILL_RADIUS,
  TAB_BAR_PILL_SIDE_MARGIN,
} from "../../../lib/tabBar"
import { SelectionActionBar } from "../SelectionActionBar"

jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 59, right: 0, bottom: 34, left: 0 }),
}))
jest.mock("expo-glass-effect", () => ({
  GlassView: () => null,
  isLiquidGlassAvailable: () => true,
  isGlassEffectAPIAvailable: () => true,
}))

const platformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, "OS")!
function setPlatform(os: "ios" | "android") {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true })
}
afterEach(() => {
  Object.defineProperty(Platform, "OS", platformOsDescriptor)
})

function renderBar() {
  const renderer = TestRenderer.create(
    <SelectionActionBar
      count={3}
      combinedBytes={1024}
      hasFailed={false}
      onRetryFailed={() => {}}
      onDeletePress={() => {}}
    />,
  )
  const root = renderer.root.findAll((n) => n.type === "View")[0]
  const style = Array.isArray(root.props.style)
    ? Object.assign({}, ...root.props.style.filter(Boolean))
    : root.props.style
  return style as Record<string, unknown>
}

describe("iOS", () => {
  it("occupies the same box as the tab pill", () => {
    setPlatform("ios")
    const style = renderBar()
    expect(style.height).toBe(TAB_BAR_PILL_HEIGHT)
    expect(style.borderRadius).toBe(TAB_BAR_PILL_RADIUS)
    expect(style.marginBottom).toBe(34 + TAB_BAR_PILL_LIFT)
    expect(style.marginHorizontal).toBe(TAB_BAR_PILL_SIDE_MARGIN)
  })

  it("drops the opaque fill and the hairline the flush bar carried", () => {
    setPlatform("ios")
    const style = renderBar()
    expect(style.backgroundColor).toBeUndefined()
    expect(style.borderTopWidth).toBe(0)
  })
})

describe("Android", () => {
  it("keeps the flush, full-width, opaque bar", () => {
    setPlatform("android")
    const style = renderBar()
    expect(style.backgroundColor).toBe("rgba(12, 12, 13, 0.94)")
    expect(style.left).toBe(0)
    expect(style.right).toBe(0)
    expect(style.bottom).toBe(0)
    expect(style.borderRadius).toBeUndefined()
    expect(style.paddingBottom).toBe(34 + 14)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/mobile && pnpm test src/components/library/__tests__/SelectionActionBar.test.tsx
```

Expected: FAIL — the iOS assertions fail; the bar is flush on both platforms.

- [ ] **Step 3: Fork the bar by platform**

In `apps/mobile/src/components/library/SelectionActionBar.tsx`, add these imports:

```tsx
import { Platform } from "react-native"

import { TabBarBackground } from "../ui/TabBarBackground"
import {
  TAB_BAR_PILL_HEIGHT,
  TAB_BAR_PILL_LIFT,
  TAB_BAR_PILL_RADIUS,
  TAB_BAR_PILL_SIDE_MARGIN,
} from "../../lib/tabBar"
```

Replace the outer `<View>` and its style with:

```tsx
  const isPill = Platform.OS === "ios"
  const pillStyle = {
    height: TAB_BAR_PILL_HEIGHT,
    marginBottom: insets.bottom + TAB_BAR_PILL_LIFT,
    marginHorizontal:
      TAB_BAR_PILL_SIDE_MARGIN + Math.max(insets.left, insets.right),
    borderRadius: TAB_BAR_PILL_RADIUS,
    overflow: "hidden" as const,
    paddingTop: 0,
    paddingBottom: 0,
    backgroundColor: undefined,
    borderTopWidth: 0,
  }

  return (
    <View
      style={[styles.bar, isPill ? pillStyle : { paddingBottom: insets.bottom + 14 }]}
    >
      {isPill && <TabBarBackground />}
```

Keep both `Pressable` blocks exactly as they are, and keep the closing `</View>`.

A 48pt button does not fit inside a 56pt capsule that also carries padding, so the pill needs a shorter one. Leave `button` at `height: 48` in the stylesheet and add a second entry beside it:

```tsx
  pillButton: {
    height: 40,
    borderRadius: 20,
  },
```

Then add that override to the style array of **both** `Pressable` blocks — the retry one and the delete one — immediately after `styles.button`:

```tsx
          styles.button,
          isPill && styles.pillButton,
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/mobile && pnpm test src/components/library/__tests__/SelectionActionBar.test.tsx
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Run the full suite, typecheck and lint**

```bash
cd apps/mobile && pnpm test && pnpm typecheck && pnpm lint
```

Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/components/library/SelectionActionBar.tsx apps/mobile/src/components/library/__tests__/SelectionActionBar.test.tsx
git commit -m "feat(mobile): match the Library selection bar to the tab pill"
```

---

### Task 7: Verify on simulators, then document

**No test in this plan can see the pill.** Every render suite mocks `GlassView` and `PlatformBlur` to `() => null`. The tests guard structure. This task decides whether the feature actually works.

**Files:**

- Modify: `apps/mobile/CLAUDE.md`

- [ ] **Step 1: Seed the worktree's env and start its own Metro**

```bash
cd apps/mobile && bash scripts/setup-sim-env.sh mobile
( nohup npx expo start --port 8090 --clear > /tmp/metro-tabbar.log 2>&1 & )
```

Run this worktree's Metro, never the main checkout's. A backgrounded task gets reaped; the detached `nohup` form survives.

- [ ] **Step 2: Verify on iOS 26 — the glass path**

Boot an iOS 26 simulator, open the app, and screenshot each of the four tabs.

Confirm: the pill floats clear of the home indicator; the material is frosted, not flat; content is visible through it while scrolling.

Home matters most — it is the only tab whose backdrop is moving video.

**Measure the label contrast; do not judge it by eye.** Screenshot Home with the hero on a bright frame, then sample the pixels behind the labels:

```bash
xcrun simctl io booted screenshot /tmp/home.png
ffmpeg -y -i /tmp/home.png -pix_fmt rgb24 -f rawvideo /tmp/home.rgb
# read the bytes under the pill, then compute the ratio against #a8a29e
```

Apply the **D1** rule to what you measure:

- Idle labels ≥ 4.5:1 → ship no tint. The glass stays clean.
- Idle labels < 4.5:1 → set `tintColor="rgba(0,0,0,0.78)"` on the `PlatformBlur` path only, then re-measure. **Never an intermediate alpha** — α 0.45 measures 1.33:1, which is worse than no tint at all.
- Measure the `GlassView` path separately. iOS 26's material adapts its own contrast and may already pass where the fallback does not.

Record the measured numbers in the commit message. Also record the **D2** finding — the active `#CB333B` label is 3.39:1 today and no tint can fix it — and hand it on rather than fixing it here.

- [ ] **Step 3: Verify on iOS 18 — the blur fallback**

Boot an iOS 18 simulator and repeat. The pill must sit in the same place, at the same size, with a dark frosted material.

- [ ] **Step 4: Verify on Android — the no-change path**

Take a screenshot of each tab on an Android emulator, then check out `main` into a second checkout and take the same four shots. They must match.

```bash
adb exec-out screencap -p > /tmp/after.png
```

- [ ] **Step 5: Walk the clearance list**

On iOS, scroll each of these to the end and confirm the last row clears the pill:

1. Home feed
2. Discover results — and **press `Load more`**
3. Discover browse grid (the default view, before typing)
4. Library downloads
5. Profile links
6. Trigger a Library delete and confirm the Snackbar sits above the pill

- [ ] **Step 6: Walk the interaction list**

1. Enter Library selection mode, then leave it. The pill must return, dark, with its shape.
2. Focus Discover's search field. The pill must hide behind the keyboard.
3. Open a video, minimise it, and confirm the mini player rests above the pill in the bottom-right corner with an even gap.

- [ ] **Step 7: Document the mechanism in `apps/mobile/CLAUDE.md`**

Add this section after "Android system navigation bar":

```markdown
## Tab bar — a floating pill on iOS, a flush bar on Android

`src/lib/tabBar.ts` owns every number. The navigator, the Library screen, the
mini player and six scroll surfaces all read it from there, so no two files can
disagree about the bar's size.

- **`tabBarStyle` is applied AFTER the bar's own `backgroundColor`**
  (`BottomTabBar.js:220` sets it, `:258` appends your style). So an opaque fill
  in `tabBarStyle` hides the glass, silently. iOS must set no `backgroundColor`;
  Android must keep `#1c1917`.
- **`tabBarBackground` must return `null` on Android.** A non-null element flips
  the bar's fill to transparent, and off iOS `GlassView` is a bare transparent
  `View` — so an unguarded glass pill is an invisible bar.
- **The pill's lift is measured from the safe area, never from the screen
  edge.** `getTabBarHeight` returns a numeric `height` verbatim and never adds
  the inset, so a screen-edge margin would make the mini player's reservation
  differ on every device.
- **`paddingBottom: 0` is required.** The bar puts `insets.bottom` INSIDE a
  numeric height, so the home indicator would otherwise eat the pill's content.
- **`@react-navigation/bottom-tabs` does not resolve from this app.** It runs
  expo-router's vendored fork. Import `useBottomTabBarHeight` from
  `expo-router/js-tabs`; the obvious import passes `tsc` and fails in Metro.
- **No test can see this work.** Every render suite mocks `GlassView` and
  `PlatformBlur` to `() => null`. `tabBarClearance.guard.test.js` is an
  ENUMERATION of six surfaces, not a sweep — a seventh scroller escapes it
  silently. Add a row whenever you add one.
- **A fade is not available.** `GlassView` renders nothing inside a layer whose
  opacity an ancestor animates, so hide-on-scroll would force `PlatformBlur` on
  every iOS version and change the look on both platforms.
```

- [ ] **Step 8: Format the markdown**

```bash
cd /Users/urimchae/Documents/GitHub/forge && npx prettier --write apps/mobile/CLAUDE.md && npx prettier --write apps/mobile/CLAUDE.md && npx prettier --check apps/mobile/CLAUDE.md
```

Run `--write` twice, then `--check`. CI's `format` job runs `prettier --check .` over every tracked file, and a docs-only failure fails `ci-gate`.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/CLAUDE.md
git commit -m "docs(mobile): record how the floating tab bar works"
```

---

## Known limits of this plan

State these when handing the work on; do not let them read as oversights.

1. **`TAB_BAR_OCCUPIED_HEIGHT` resolves its `Platform.select` at module scope.** A test that redefines `Platform.OS` after import can never exercise the Android value. Do not write a test that appears to. This matches how `PlaybackHost` already builds its config, so it is not a new limitation.
2. **`tabBarClearance.guard.test.js` is an enumeration.** A seventh scroll surface escapes it silently. This is the same gap that let two SDUI routes ship without `surfaceType` for four months.
3. **Scroll indicators.** `scrollIndicatorInsets` is set on the four scrollers that accept it. Home's list is a `FlashList`; if it does not accept the prop, its indicator will run under the pill. That is cosmetic, and it is the only known one.
4. **Nothing here proves the glass renders.** Only Task 7 does, and only on a simulator.
