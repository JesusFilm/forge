/**
 * Cross-layer orientation agreement for the custom fullscreen (watch/series).
 *
 * TWO layers request the fullscreen orientation: the react-native-screens
 * screen option set here, and expo-screen-orientation's lock inside
 * `enterFullscreenLandscape`. They MUST name the SAME single orientation
 * (landscape_right ↔ LANDSCAPE_RIGHT). When they disagree — e.g. a dual
 * "landscape" option against a LANDSCAPE_RIGHT lock — each layer's geometry
 * request falls outside the other's supported mask, iOS rejects the rotation,
 * and fullscreen stays portrait. The expo side is pinned by
 * `src/lib/__tests__/orientation.test.ts`; this suite pins the screen-option
 * side and the enter/exit call pairing.
 *
 * Back-swipe gating: the pop gesture that dismisses the watch/series page
 * belongs to the PARENT stack (the routes are nested), and react-native-screens
 * consults only that stack's own top screen. Every `gestureEnabled` write must
 * therefore land on BOTH the screen and its parent — the parent write is the
 * load-bearing one; a self-only write is inert against the dismissing pop.
 * The gesture is disabled ONLY for fullscreen. The scrubber-vs-pop conflict is
 * settled by geometry instead (the scrubber declines touches starting in the
 * strip the pop owns, src/lib/backSwipe.ts), because a chrome-driven hold also
 * disabled the back-swipe whenever the video was merely paused.
 *
 * apps/mobile's tsconfig maps `react` to its .d.ts and jest-expo mirrors
 * tsconfig paths into jest's moduleNameMapper, so the mocks below re-point
 * `react` at the real package (see apps/mobile/CLAUDE.md "Component render
 * tests").
 */

jest.mock("react", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(path.dirname(r.resolve("react/package.json")))
})
jest.mock("react/jsx-runtime", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(
    path.join(path.dirname(r.resolve("react/package.json")), "jsx-runtime.js"),
  )
})

const mockSetOptions = jest.fn()
const mockParentSetOptions = jest.fn()
let mockFocused = true
const mockFocusListeners: Array<() => void> = []
jest.mock("expo-router", () => ({
  useNavigation: () => ({
    setOptions: mockSetOptions,
    getParent: () => ({ setOptions: mockParentSetOptions }),
    isFocused: () => mockFocused,
    addListener: (_event: string, cb: () => void) => {
      mockFocusListeners.push(cb)
      return () => {
        const i = mockFocusListeners.indexOf(cb)
        if (i >= 0) mockFocusListeners.splice(i, 1)
      }
    },
  }),
}))
jest.mock("../../lib/orientation", () => ({
  enterFullscreenLandscape: jest.fn(async () => {}),
  exitToPortrait: jest.fn(async () => {}),
}))

import { act } from "react"

import { useFullscreenPresentation } from "../useFullscreenPresentation"
import { enterFullscreenLandscape, exitToPortrait } from "../../lib/orientation"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

let api: ReturnType<typeof useFullscreenPresentation> | null = null

function Harness() {
  api = useFullscreenPresentation()
  return null
}

async function renderHarness(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<Harness />)
  })
  return renderer
}

beforeEach(() => {
  jest.clearAllMocks()
  api = null
  mockFocused = true
  mockFocusListeners.length = 0
})

describe("useFullscreenPresentation orientation wiring", () => {
  it("names the SAME single landscape orientation on both layers on enter", async () => {
    const renderer = await renderHarness()

    await act(async () => {
      api?.toggleFullscreen()
    })

    expect(mockSetOptions).toHaveBeenCalledWith({
      orientation: "landscape_right",
    })
    expect(enterFullscreenLandscape).toHaveBeenCalled()
    await act(async () => {
      renderer.unmount()
    })
  })

  it("returns both layers to portrait on exit", async () => {
    const renderer = await renderHarness()

    await act(async () => {
      api?.toggleFullscreen()
    })
    await act(async () => {
      api?.toggleFullscreen()
    })

    expect(mockSetOptions).toHaveBeenCalledWith({ orientation: "portrait" })
    expect(exitToPortrait).toHaveBeenCalled()
    await act(async () => {
      renderer.unmount()
    })
  })
})

describe("useFullscreenPresentation back-swipe gating", () => {
  it("disables the gesture on the screen AND its parent on fullscreen enter", async () => {
    const renderer = await renderHarness()

    await act(async () => {
      api?.toggleFullscreen()
    })

    expect(mockSetOptions).toHaveBeenCalledWith({ gestureEnabled: false })
    // The parent write is the one the dismissing pop actually consults.
    expect(mockParentSetOptions).toHaveBeenCalledWith({ gestureEnabled: false })
    await act(async () => {
      renderer.unmount()
    })
  })

  it("re-enables the gesture on both on fullscreen exit", async () => {
    const renderer = await renderHarness()

    await act(async () => {
      api?.toggleFullscreen()
    })
    jest.clearAllMocks()
    await act(async () => {
      api?.toggleFullscreen()
    })

    expect(mockSetOptions).toHaveBeenCalledWith({ gestureEnabled: true })
    expect(mockParentSetOptions).toHaveBeenCalledWith({ gestureEnabled: true })
    await act(async () => {
      renderer.unmount()
    })
  })

  it("skips writes while unfocused and re-asserts current state on focus", async () => {
    mockFocused = false
    const renderer = await renderHarness()

    await act(async () => {
      api?.toggleFullscreen()
    })
    expect(mockSetOptions).not.toHaveBeenCalledWith(
      expect.objectContaining({ gestureEnabled: expect.anything() }),
    )
    expect(mockParentSetOptions).not.toHaveBeenCalled()

    // Pop-back: the focus event replays the screen's current truth.
    mockFocused = true
    await act(async () => {
      for (const cb of [...mockFocusListeners]) cb()
    })
    expect(mockSetOptions).toHaveBeenCalledWith({ gestureEnabled: false })
    expect(mockParentSetOptions).toHaveBeenCalledWith({ gestureEnabled: false })
    await act(async () => {
      renderer.unmount()
    })
  })

  it("leaves the gesture ENABLED whenever the player is not fullscreen", async () => {
    // Regression guard for the paused-video trap: a chrome-driven hold once
    // disabled the pop for the screen's whole life, because the chrome never
    // auto-hides while paused. Only fullscreen may disable it now.
    const renderer = await renderHarness()

    expect(mockSetOptions).toHaveBeenCalledWith({ gestureEnabled: true })
    expect(mockParentSetOptions).toHaveBeenCalledWith({ gestureEnabled: true })
    expect(mockSetOptions).not.toHaveBeenCalledWith({ gestureEnabled: false })
    // The hook exposes no other way to disable it.
    expect(Object.keys(api ?? {}).sort()).toEqual([
      "isFullscreen",
      "toggleFullscreen",
    ])
    await act(async () => {
      renderer.unmount()
    })
  })
})
