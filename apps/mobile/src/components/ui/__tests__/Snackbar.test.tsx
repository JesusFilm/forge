/**
 * The toast's bottom offset, across both platforms and both callers.
 *
 * `useTabBarClearance()` already carries `insets.bottom`, so adding the inset
 * beside it double-counts. The first fix for that keyed on `clearsTabBar`
 * alone, which silently moved the ANDROID toast: the clearance is 0 there, so
 * the tab caller fell into the clearance branch and lost the whole inset. Both
 * axes therefore need a case, and the Android pair is the regression guard.
 */
import { act } from "react"
import { Platform } from "react-native"

import {
  TestRenderer,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { TAB_BAR_CLEARANCE_GAP } from "../../../lib/tabBar"
import { Snackbar } from "../Snackbar"

// The `mock` prefix is required: babel-plugin-jest-hoist lifts jest.mock above
// this declaration and rejects any other out-of-scope name in the factory.
const mockInsets = { top: 59, right: 0, bottom: 34, left: 0 }
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mockInsets,
}))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))

const platformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, "OS")!
function setPlatform(os: "ios" | "android") {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true })
}
afterEach(() => {
  Object.defineProperty(Platform, "OS", platformOsDescriptor)
  mockInsets.top = 59
  mockInsets.right = 0
  mockInsets.bottom = 34
  mockInsets.left = 0
})

/** The flattened `bottom` the toast renders with. */
async function bottomOffset(clearsTabBar: boolean): Promise<number> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <Snackbar
        message="Deleted"
        visible
        onDismiss={() => {}}
        clearsTabBar={clearsTabBar}
      />,
    )
  })
  const root = renderer.root.findAll(
    (n) => n.props?.style != null && !n.props.accessibilityRole,
  )[0]
  const flat = ([] as unknown[])
    .concat(root.props.style)
    .filter(Boolean)
    .reduce<Record<string, unknown>>(
      (acc, s) => ({ ...acc, ...(s as Record<string, unknown>) }),
      {},
    )
  renderer.unmount()
  return flat.bottom as number
}

describe("iOS", () => {
  it("uses the clearance alone on a tab route, because it already carries the inset", async () => {
    // Inside a tab, insets.bottom carries the 49pt UIKit bar as well as the
    // 34pt indicator. Adding it beside the clearance would count it twice.
    setPlatform("ios")
    mockInsets.bottom = 83
    expect(await bottomOffset(true)).toBe(83 + TAB_BAR_CLEARANCE_GAP + 16)
  })

  it("does NOT add the inset a second time", async () => {
    // Discriminating: the pre-fix formula. This is the exact regression a
    // careless revert restores, and it is invisible by eye.
    setPlatform("ios")
    mockInsets.bottom = 83
    expect(await bottomOffset(true)).not.toBe(
      83 + 16 + (83 + TAB_BAR_CLEARANCE_GAP),
    )
  })

  it("keeps the plain inset off a tab route, where there is no bar", async () => {
    // The watch and series routes mount this too and must not move.
    setPlatform("ios")
    expect(await bottomOffset(false)).toBe(34 + 16)
  })
})

describe("Android", () => {
  it("keeps the plain inset on a tab route", async () => {
    // The regression guard. The clearance is 0 on Android, so a gate that reads
    // `clearsTabBar` alone sends this caller into the clearance branch and the
    // toast loses the whole inset. It must stay byte-identical to pre-migration.
    setPlatform("android")
    expect(await bottomOffset(true)).toBe(34 + 16)
  })

  it("keeps the plain inset off a tab route", async () => {
    setPlatform("android")
    expect(await bottomOffset(false)).toBe(34 + 16)
  })

  it("never lifts by the clearance, whatever the caller asks for", async () => {
    // Anti-vacuous partner: both Android cases above expect the SAME number, so
    // on their own they would pass even if the branch were unreachable. This
    // pins that the 16pt-only result the broken gate produced cannot occur.
    setPlatform("android")
    expect(await bottomOffset(true)).not.toBe(16)
  })
})
