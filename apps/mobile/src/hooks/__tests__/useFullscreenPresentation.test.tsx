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
jest.mock("expo-router", () => ({
  useNavigation: () => ({ setOptions: mockSetOptions }),
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
})

describe("useFullscreenPresentation orientation wiring", () => {
  it("names the SAME single landscape orientation on both layers on enter", async () => {
    const renderer = await renderHarness()

    await act(async () => {
      api?.toggleFullscreen()
    })

    expect(mockSetOptions).toHaveBeenLastCalledWith({
      gestureEnabled: false,
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

    expect(mockSetOptions).toHaveBeenLastCalledWith({
      gestureEnabled: true,
      orientation: "portrait",
    })
    expect(exitToPortrait).toHaveBeenCalled()
    await act(async () => {
      renderer.unmount()
    })
  })
})
