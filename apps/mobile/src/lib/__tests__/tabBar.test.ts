/**
 * The bar's numbers live in one module so the navigator, the Library screen,
 * the mini player and six scroll surfaces cannot disagree about them.
 */
import { Platform } from "react-native"

import {
  TAB_BAR_CLEARANCE_GAP,
  TAB_BAR_HEIGHT_IOS,
  TAB_BAR_MATERIAL_TINT,
  TAB_BAR_OCCUPIED_HEIGHT,
  tabBarOccupiedHeightFor,
  TAB_BAR_FLAT_STYLE,
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

describe("useTabBarStyle", () => {
  it("gives Android its flat bar", () => {
    setPlatform("android")
    expect(useTabBarStyle()).toEqual(TAB_BAR_FLAT_STYLE)
  })

  it("gives iOS the same object — the UIKit bar takes no style", () => {
    // iOS is shadowed by `_layout.ios.tsx`, whose NativeTabs navigator has no
    // `tabBarStyle`. The export survives only because `library.tsx` writes it
    // back through `setOptions` on Android.
    setPlatform("ios")
    expect(useTabBarStyle()).toEqual(TAB_BAR_FLAT_STYLE)
  })
})

describe("useTabBarClearance", () => {
  it("adds ONLY the gap on iOS — the native bar is already in the inset", () => {
    // Measured on iPhone 17 Pro Max (iOS 26.5) and iPhone 16 Pro (iOS 18.6):
    // a tab screen reports insets.bottom 83 = 34pt home indicator + 49pt bar.
    // Adding TAB_BAR_HEIGHT_IOS here again would double-count it.
    setPlatform("ios")
    mockInsets.bottom = 83
    expect(useTabBarClearance()).toBe(83 + TAB_BAR_CLEARANCE_GAP)
    mockInsets.bottom = 34
  })

  it("does NOT add the bar height a second time", () => {
    // Falsification: the pre-feat-498 formula. Kept as a discriminating
    // assertion — it is the exact regression a careless revert reintroduces.
    setPlatform("ios")
    mockInsets.bottom = 83
    expect(useTabBarClearance()).not.toBe(
      83 + TAB_BAR_HEIGHT_IOS + TAB_BAR_CLEARANCE_GAP,
    )
    mockInsets.bottom = 34
  })

  it("is zero on Android, where the bar displaces content", () => {
    setPlatform("android")
    expect(useTabBarClearance()).toBe(0)
  })
})

describe("TAB_BAR_OCCUPIED_HEIGHT", () => {
  it("is the UIKit bar's own height, not a hand-copied number", () => {
    // Every consumer rebuilds its expectation from this same import, so
    // nothing else in the repo would notice the computation drifting.
    expect(TAB_BAR_OCCUPIED_HEIGHT).toBe(TAB_BAR_HEIGHT_IOS)
    expect(TAB_BAR_OCCUPIED_HEIGHT).toBe(49)
  })

  it("keeps each platform on its own value", () => {
    // The constant resolves Platform once at import, so a test can never see
    // the other branch through it -- exercise the function it is built from.
    expect(tabBarOccupiedHeightFor("ios")).toBe(TAB_BAR_HEIGHT_IOS)
    expect(tabBarOccupiedHeightFor("android")).toBe(56)
    expect(tabBarOccupiedHeightFor("web")).toBe(49)
  })

  it("no longer reserves the retired pill's 68pt box", () => {
    // Discriminating: 56 + 12 was the floating pill. A revert to it leaves a
    // 19pt gap between the mini player and the real bar.
    expect(tabBarOccupiedHeightFor("ios")).not.toBe(68)
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
})
