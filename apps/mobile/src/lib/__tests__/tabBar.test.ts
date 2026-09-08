/**
 * The pill's numbers live in one module so the navigator, the Library screen,
 * the mini player and six scroll surfaces cannot disagree about them.
 */
import { Platform } from "react-native"

import {
  TAB_BAR_CLEARANCE_GAP,
  TAB_BAR_LENS_BORDER,
  TAB_BAR_LENS_FILL,
  TAB_BAR_MATERIAL_TINT,
  TAB_BAR_OCCUPIED_HEIGHT,
  tabBarOccupiedHeightFor,
  TAB_ROUTE_NAMES,
  tabIndexForSegments,
  TAB_BAR_FLAT_STYLE,
  TAB_BAR_PILL_HEIGHT,
  TAB_BAR_PILL_LIFT,
  TAB_BAR_PILL_RADIUS,
  TAB_BAR_PILL_SIDE_MARGIN,
  useTabBarClearance,
  tabBarStyleFor,
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
    expect(tabBarStyleFor(mockInsets).marginBottom).toBe(
      mockInsets.bottom + TAB_BAR_PILL_LIFT,
    )
  })

  it("drops the opaque fill, or the glass renders behind a solid block", () => {
    setPlatform("ios")
    expect(tabBarStyleFor(mockInsets).backgroundColor).toBeUndefined()
  })

  it("zeroes paddingBottom, which the bar otherwise puts INSIDE the height", () => {
    setPlatform("ios")
    expect(tabBarStyleFor(mockInsets).paddingBottom).toBe(0)
  })

  it("floats absolutely so content passes behind it", () => {
    setPlatform("ios")
    const style = tabBarStyleFor(mockInsets)
    expect(style.position).toBe("absolute")
    expect(style.height).toBe(TAB_BAR_PILL_HEIGHT)
    expect(style.borderRadius).toBe(TAB_BAR_PILL_RADIUS)
    expect(style.overflow).toBe("hidden")
    expect(style.borderTopWidth).toBe(0)
  })

  it("clears a landscape notch on top of the side margin", () => {
    setPlatform("ios")
    mockInsets.left = 44
    expect(tabBarStyleFor(mockInsets).marginHorizontal).toBe(
      TAB_BAR_PILL_SIDE_MARGIN + 44,
    )
  })
})

describe("useTabBarStyle on Android", () => {
  it("returns today's flat style, untouched", () => {
    setPlatform("android")
    expect(tabBarStyleFor(mockInsets)).toEqual(TAB_BAR_FLAT_STYLE)
    expect(TAB_BAR_FLAT_STYLE).toEqual({
      backgroundColor: "#1c1917",
      borderTopColor: "transparent",
    })
  })

  it("never floats, so nothing downstream needs to compensate", () => {
    setPlatform("android")
    const style = tabBarStyleFor(mockInsets)
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

describe("tabIndexForSegments", () => {
  it("puts the lens on each tab's own segment", () => {
    expect(tabIndexForSegments(["(tabs)", "watch"])).toBe(1)
    expect(tabIndexForSegments(["(tabs)", "library"])).toBe(2)
    expect(tabIndexForSegments(["(tabs)", "profile"])).toBe(3)
  })

  it("reads the group segment alone as the index route", () => {
    // app/(tabs)/index.tsx is "/", so expo-router emits only the group.
    expect(tabIndexForSegments(["(tabs)"])).toBe(0)
  })

  it("scans from the RIGHT, so a nested segment does not win", () => {
    // "index" is a tab name; a left-to-right scan would return it here.
    expect(tabIndexForSegments(["(tabs)", "index", "profile"])).toBe(3)
  })

  it("reports null off the tab group, so the lens holds its cell", () => {
    // app/watch/[slug].tsx is a SIBLING of (tabs) on the root stack and emits
    // the bare segment "watch" -- the Discover tab's own name. Scanning the
    // whole array slid the lens to Discover on every video open.
    expect(tabIndexForSegments(["watch", "[slug]"])).toBeNull()
    expect(tabIndexForSegments(["watch", "language"])).toBeNull()
    expect(tabIndexForSegments(["series", "[slug]"])).toBeNull()
    expect(tabIndexForSegments([])).toBeNull()
    expect(tabIndexForSegments(["something-else"])).toBeNull()
  })

  it("still resolves a tab name that appears INSIDE the group", () => {
    expect(tabIndexForSegments(["(tabs)", "watch"])).toBe(1)
  })

  it("covers every declared tab", () => {
    TAB_ROUTE_NAMES.forEach((name, i) => {
      expect(tabIndexForSegments(["(tabs)", name])).toBe(i)
    })
  })
})

describe("TAB_BAR_OCCUPIED_HEIGHT", () => {
  it("is the pill's own height plus its lift, not a hand-copied number", () => {
    // Every consumer rebuilds its expectation from this same import, so
    // nothing else in the repo would notice the computation drifting.
    expect(TAB_BAR_OCCUPIED_HEIGHT).toBe(
      TAB_BAR_PILL_HEIGHT + TAB_BAR_PILL_LIFT,
    )
    expect(TAB_BAR_OCCUPIED_HEIGHT).toBe(68)
  })

  it("keeps each platform on its own value", () => {
    // The constant resolves Platform once at import, so a test can never see
    // the other branch through it -- exercise the function it is built from.
    expect(tabBarOccupiedHeightFor("ios")).toBe(
      TAB_BAR_PILL_HEIGHT + TAB_BAR_PILL_LIFT,
    )
    expect(tabBarOccupiedHeightFor("android")).toBe(56)
    expect(tabBarOccupiedHeightFor("web")).toBe(49)
  })
})

describe("label contrast floors", () => {
  /** WCAG 2.x relative luminance. */
  function luminance([r, g, b]: number[]): number {
    const lin = (c: number) => {
      const v = c / 255
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  }
  function ratio(a: number[], b: number[]): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }
  function over(fg: number[], alpha: number, bg: number[]): number[] {
    return fg.map((c, i) => Math.round(alpha * c + (1 - alpha) * bg[i]))
  }
  /** The whole colour, not just the alpha: compositing a hard-coded black
   *  would score a WHITE tint 4.79:1 while it actually measures 1.52:1. */
  function parseRgba(rgba: string): { rgb: number[]; alpha: number } {
    const m = rgba.match(
      /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/,
    )
    if (!m) throw new Error(`not an rgba() value: ${rgba}`)
    return {
      rgb: [Number(m[1]), Number(m[2]), Number(m[3])],
      alpha: Number(m[4]),
    }
  }

  /** #a8a29e -- tabBarInactiveTintColor. */
  const IDLE_LABEL = [168, 162, 158]
  /** Worst ground measured through the glass over a bright Home feed,
   *  iPhone 17 Pro Max simulator, 2026-09-08. Untinted it reads 3.35:1. */
  const WORST_MEASURED_GROUND = [86, 74, 77]

  it("computes the untinted case as the failure the tint exists to fix", () => {
    expect(ratio(IDLE_LABEL, WORST_MEASURED_GROUND)).toBeLessThan(4.5)
  })

  it("would reject a tint of the wrong COLOUR, not just the wrong alpha", () => {
    // A white tint at the shipped alpha lightens the ground instead of
    // darkening it. Reading only the alpha scored this as passing.
    const white = parseRgba("rgba(255, 255, 255, 0.3)")
    const ground = over(white.rgb, white.alpha, WORST_MEASURED_GROUND)
    expect(ratio(IDLE_LABEL, ground)).toBeLessThan(4.5)
  })

  it("clears AA for the idle label once TAB_BAR_MATERIAL_TINT is applied", () => {
    // Lowering the shipped alpha fails this. The prose beside the constant
    // claimed 4.79:1 but nothing computed it.
    const tint = parseRgba(TAB_BAR_MATERIAL_TINT)
    const ground = over(tint.rgb, tint.alpha, WORST_MEASURED_GROUND)
    expect(ratio(IDLE_LABEL, ground)).toBeGreaterThanOrEqual(4.5)
  })

  it("keeps the lens rim-weighted so it cannot darken the active label", () => {
    // The fill is what costs the active label contrast; the rim is free.
    expect(parseRgba(TAB_BAR_LENS_FILL).alpha).toBeLessThanOrEqual(0.06)
    expect(parseRgba(TAB_BAR_LENS_BORDER).alpha).toBeGreaterThan(
      parseRgba(TAB_BAR_LENS_FILL).alpha,
    )
  })
})
