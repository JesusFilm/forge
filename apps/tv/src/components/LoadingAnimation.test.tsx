import * as React from "react"
import { Animated, AppState } from "react-native"
import { useReduceMotion } from "../hooks/useReduceMotion"
import { LogoAnimation } from "./LogoAnimation"
import { LoadingAnimation } from "./LoadingAnimation"
import { LOGO_ANIMATIONS } from "../lib/logoAnimations"

jest.mock("./LogoAnimation", () => ({
  LogoAnimation: jest.fn(() => null),
}))

jest.mock("../hooks/useReduceMotion", () => ({
  useReduceMotion: jest.fn(() => false),
}))

jest.mock("react", () => ({
  ...jest.requireActual("react"),
  useEffect: jest.fn(),
  useRef: jest.fn(),
  useState: jest.fn(),
}))

afterEach(() => {
  jest.restoreAllMocks()
  jest.mocked(useReduceMotion).mockReturnValue(false)
})

test.each(LOGO_ANIMATIONS)("mounts only motion effect $id", ({ id }) => {
  const element = LoadingAnimation({ id, active: false, size: 480 })
  expect(element.type).toBe(LogoAnimation)
  expect(element.props).toEqual({ id, active: false, size: 480 })
  expect(element.props.children).toBeUndefined()
})

test("dots replaces the motion effect rather than mounting alongside it", () => {
  const element = LoadingAnimation({ id: "dots", active: false, size: 480 })
  expect(element.type).not.toBe(LogoAnimation)
  expect(element.props).toEqual({ active: false, size: 480 })
  expect(element.props.children).toBeUndefined()
})

function mountDots(active = true, foreground = true) {
  const effects: React.EffectCallback[] = []
  const phase = new Animated.Value(0)
  const remove = jest.fn()
  const animation = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() }
  jest.mocked(React.useRef).mockReturnValue({ current: phase })
  jest.mocked(React.useState).mockReturnValue([foreground, jest.fn()])
  jest.mocked(React.useEffect).mockImplementation((effect) => {
    effects.push(effect)
  })
  jest.spyOn(AppState, "addEventListener").mockReturnValue({ remove })
  jest.spyOn(Animated, "loop").mockReturnValue(animation)
  const resetPhase = jest.spyOn(phase, "setValue")
  const element = LoadingAnimation({ id: "dots", active })
  const render = element.type as (props: {
    active: boolean
    size: number
  }) => React.ReactElement
  render(element.props)
  const cleanups = effects.map((effect) => effect())
  return {
    animation,
    resetPhase,
    remove,
    unmount: () =>
      cleanups.forEach((cleanup) => {
        if (typeof cleanup === "function") cleanup()
      }),
  }
}

test("dots start one loop and stop/reset it and unsubscribe when removed", () => {
  const { animation, resetPhase, remove, unmount } = mountDots()
  expect(Animated.loop).toHaveBeenCalledTimes(1)
  expect(animation.start).toHaveBeenCalledTimes(1)
  unmount()
  expect(animation.stop).toHaveBeenCalledTimes(1)
  expect(resetPhase).toHaveBeenCalledWith(0)
  expect(remove).toHaveBeenCalledTimes(1)
})

test.each([
  { name: "inactive preview", active: false, foreground: true, reduce: false },
  { name: "background", active: true, foreground: false, reduce: false },
  { name: "reduced motion", active: true, foreground: true, reduce: true },
])("dots do not animate in $name", ({ active, foreground, reduce }) => {
  jest.mocked(useReduceMotion).mockReturnValue(reduce)
  const { animation, unmount, remove } = mountDots(active, foreground)
  expect(Animated.loop).not.toHaveBeenCalled()
  expect(animation.start).not.toHaveBeenCalled()
  unmount()
  expect(remove).toHaveBeenCalledTimes(1)
})
