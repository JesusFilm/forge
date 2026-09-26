// The tablet layout switch (feat-553 KD9), read from the window's SHORTEST
// side. The element renders under StrictMode, so the window subscription
// must survive the double mount.
import { StrictMode, act } from "react"
import { Dimensions } from "react-native"

import {
  TestRenderer,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"
import {
  TABLET_SHORTEST_SIDE,
  isTabletLayout,
  useIsTabletLayout,
} from "../useIsTabletLayout"

const original = Dimensions.get("window")

function setWindow(width: number, height: number) {
  const window = { width, height, scale: 3, fontScale: 1 }
  act(() => {
    Dimensions.set({ window, screen: window })
  })
}

afterEach(() => {
  act(() => {
    Dimensions.set({ window: original, screen: original })
  })
})

const seen: boolean[] = []

function Probe() {
  seen.push(useIsTabletLayout())
  return null
}

function render(): TestInstance {
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(
      <StrictMode>
        <Probe />
      </StrictMode>,
    )
  })
  return renderer
}

function latest(): boolean | undefined {
  return seen[seen.length - 1]
}

beforeEach(() => {
  seen.length = 0
})

describe("isTabletLayout", () => {
  it("reads the shortest side against the breakpoint", () => {
    expect(TABLET_SHORTEST_SIDE).toBe(600)
    // iPhone 17 Pro Max, both ways up.
    expect(isTabletLayout(440, 956)).toBe(false)
    expect(isTabletLayout(956, 440)).toBe(false)
    // iPad mini (744 x 1133), both ways up.
    expect(isTabletLayout(744, 1133)).toBe(true)
    expect(isTabletLayout(1133, 744)).toBe(true)
    expect(isTabletLayout(600, 900)).toBe(true)
    expect(isTabletLayout(599, 900)).toBe(false)
  })
})

describe("useIsTabletLayout", () => {
  it("switches when the window width crosses the breakpoint", () => {
    setWindow(440, 956)
    const renderer = render()
    expect(latest()).toBe(false)

    // iPad Split View widens the reader's window past the breakpoint.
    setWindow(744, 1133)
    expect(latest()).toBe(true)

    // Split View narrows it back under the breakpoint.
    setWindow(320, 1133)
    expect(latest()).toBe(false)

    act(() => renderer.unmount())
  })

  it("keeps a phone a phone when it turns to landscape", () => {
    setWindow(440, 956)
    const renderer = render()
    setWindow(956, 440)
    expect(latest()).toBe(false)
    act(() => renderer.unmount())
  })
})
