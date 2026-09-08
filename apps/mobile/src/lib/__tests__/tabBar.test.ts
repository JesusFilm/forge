/**
 * The pill's numbers live in one module so the navigator, the Library screen,
 * the mini player and six scroll surfaces cannot disagree about them.
 */
import { Platform } from "react-native"

import {
  TAB_BAR_CLEARANCE_GAP,
  TAB_ROUTE_NAMES,
  tabIndexForSegments,
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

  it("parks on the first tab for anything unrecognised", () => {
    expect(tabIndexForSegments([])).toBe(0)
    expect(tabIndexForSegments(["something-else"])).toBe(0)
  })

  it("covers every declared tab", () => {
    TAB_ROUTE_NAMES.forEach((name, i) => {
      expect(tabIndexForSegments(["(tabs)", name])).toBe(i)
    })
  })
})
