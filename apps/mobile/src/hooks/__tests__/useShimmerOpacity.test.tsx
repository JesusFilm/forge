/**
 * The stop-and-rest path of the skeleton pulse. With the native driver, a
 * stopped loop reports its stop-time position back to JS AFTER the call that
 * stopped it, so a reset issued at once is overwritten and the still skeleton
 * keeps that brightness (measured 2026-09-24 on the iPhone 17 Pro simulator:
 * (39,35,34) and (39,36,34) against the (33,29,28) rest). Jest has no native
 * driver, so these
 * tests hold `stopAnimation`'s report back to stand in for the native reply.
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

import { act, createElement } from "react"
import { Animated } from "react-native"

import { useShimmerOpacity } from "../useShimmerOpacity"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

function Probe({ active }: { active: boolean }) {
  useShimmerOpacity(active)
  return null
}

const mounted: TestInstance[] = []

function renderProbe(active: boolean) {
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(createElement(Probe, { active }) as never)
  })
  mounted.push(renderer)
  return (next: boolean) =>
    act(() => {
      renderer.update(createElement(Probe, { active: next }) as never)
    })
}

let loopStart: jest.Mock
let heldReports: ((value: number) => void)[]
let resets: jest.SpyInstance

beforeEach(() => {
  loopStart = jest.fn()
  jest.spyOn(Animated, "loop").mockImplementation(
    () =>
      ({
        start: loopStart,
        stop: jest.fn(),
        reset: jest.fn(),
      }) as Animated.CompositeAnimation,
  )
  heldReports = []
  jest
    .spyOn(Animated.Value.prototype, "stopAnimation")
    .mockImplementation((callback) => {
      if (callback) heldReports.push(callback)
    })
  resets = jest.spyOn(Animated.Value.prototype, "setValue")
})

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach((renderer) => renderer.unmount())
  })
  jest.restoreAllMocks()
})

describe("useShimmerOpacity", () => {
  it("rests at dim only after the native side reports the stop", () => {
    const update = renderProbe(true)
    update(false)

    // An immediate reset is the one the late native report overwrites.
    expect(resets).not.toHaveBeenCalled()
    expect(heldReports).toHaveLength(1)

    act(() => heldReports[0]!(0.57))
    expect(resets).toHaveBeenCalledWith(0)
  })

  it("drops a late reset when the pulse has already restarted", () => {
    const update = renderProbe(true)
    update(false)
    update(true)
    expect(loopStart).toHaveBeenCalledTimes(2)

    // Resetting now would stop the loop that just started again.
    act(() => heldReports[0]!(0.57))
    expect(resets).not.toHaveBeenCalled()
  })

  it("never starts the loop while inactive", () => {
    renderProbe(false)
    expect(loopStart).not.toHaveBeenCalled()
  })
})
