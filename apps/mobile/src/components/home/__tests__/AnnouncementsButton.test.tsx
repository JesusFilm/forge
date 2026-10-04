import { act } from "react"
import { StyleSheet, Text, type ViewStyle } from "react-native"
import { GlassView } from "expo-glass-effect"

import {
  TestRenderer,
  hasText,
  press,
  pressableByLabel,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { ACCENT } from "../../../lib/color"
import { AnnouncementsButton } from "../AnnouncementsButton"

// The factory owns its state so a case can flip the Liquid Glass branch.
jest.mock("expo-glass-effect", () => {
  const state = { liquid: true, api: true }
  return {
    GlassView: () => null,
    isLiquidGlassAvailable: () => state.liquid,
    isGlassEffectAPIAvailable: () => state.api,
    __state: state,
  }
})
const mockGlass = (
  jest.requireMock("expo-glass-effect") as unknown as {
    __state: { liquid: boolean; api: boolean }
  }
).__state
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 59, right: 0, bottom: 34, left: 0 }),
}))
const mockRequestPause = jest.fn()
jest.mock("../../../lib/pauseCurtain", () => ({
  requestPause: () => mockRequestPause(),
}))

const TITLE = "Your daily devotional video is ready to watch."

// Read state is module-wide and keyed by day, so each case uses its own day.
let day = 1
beforeEach(() => {
  jest.useFakeTimers({ now: new Date(2026, 10, day, 9, 0) })
  day += 1
})

afterEach(() => {
  mockGlass.liquid = true
  mockGlass.api = true
  mockRequestPause.mockClear()
  jest.useRealTimers()
})

async function render(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <AnnouncementsButton glassStyle={{ width: 40, height: 40 }} />,
    )
  })
  return renderer
}

function flat(node: RenderedNode): ViewStyle {
  return StyleSheet.flatten(node.props.style as ViewStyle) ?? {}
}

function hostCount(
  renderer: TestInstance,
  match: (node: RenderedNode) => boolean,
): number {
  return renderer.root.findAll(
    (node) => typeof node.type === "string" && match(node),
  ).length
}

const bellLabel = (renderer: TestInstance) =>
  renderer.root.findAll(
    (node) =>
      typeof node.props.onPress === "function" &&
      String(node.props.accessibilityLabel).startsWith("Announcements"),
  )[0]!.props.accessibilityLabel

const badges = (renderer: TestInstance) =>
  hostCount(
    renderer,
    (node) =>
      flat(node).backgroundColor === ACCENT &&
      flat(node).position === "absolute",
  )

/** A Text node's whole string, even when JSX split it into several children. */
const shows = (renderer: TestInstance, text: string) =>
  renderer.root.findAll((node) => {
    if (node.type !== Text) return false
    const children = ([] as unknown[]).concat(node.props.children)
    return (
      children.every((c) => typeof c === "string") && children.join("") === text
    )
  }).length > 0

const listOpen = (renderer: TestInstance) =>
  renderer.root.findAll(
    (node) => node.type === Text && node.props.children === "Announcements",
  ).length > 0

/** The bell's HOST view: the one Pressability gives its responder props. */
function bellHost(renderer: TestInstance): RenderedNode {
  return renderer.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      String(node.props.accessibilityLabel).startsWith("Announcements") &&
      typeof node.props.onResponderGrant === "function",
  )[0]!
}

function responderEvent() {
  return {
    nativeEvent: {
      locationX: 10,
      locationY: 10,
      pageX: 360,
      pageY: 80,
      timestamp: Date.now(),
      touches: [],
      changedTouches: [],
    },
    currentTarget: { measure: () => {} },
    persist: () => {},
  }
}

type ResponderHandler = (event: ReturnType<typeof responderEvent>) => void

const shrunk = (renderer: TestInstance) =>
  hostCount(renderer, (node) =>
    Boolean(
      (flat(node).transform as Array<{ scale?: number }> | undefined)?.some(
        (step) => step.scale === 0.94,
      ),
    ),
  )

describe("AnnouncementsButton", () => {
  it("marks a new announcement with a red dot", async () => {
    const renderer = await render()
    expect(bellLabel(renderer)).toBe("Announcements, 1 new")
    expect(badges(renderer)).toBe(1)
    expect(listOpen(renderer)).toBe(false)
    await unmount(renderer)
  })

  it("opens the list of announcements under the bell", async () => {
    const renderer = await render()
    await press(pressableByLabel(renderer, "Announcements, 1 new"))
    expect(listOpen(renderer)).toBe(true)
    expect(hasText(renderer, TITLE)).toBe(true)
    expect(shows(renderer, "Daily devotional · Today")).toBe(true)
    await unmount(renderer)
  })

  it("clears the dot, closes the list, and sends one curtain request on a row tap", async () => {
    const renderer = await render()
    await press(pressableByLabel(renderer, "Announcements, 1 new"))
    await press(
      pressableByLabel(renderer, `${TITLE} Daily devotional, Today, new`),
    )
    expect(mockRequestPause).toHaveBeenCalledTimes(1)
    expect(listOpen(renderer)).toBe(false)
    expect(bellLabel(renderer)).toBe("Announcements")
    expect(badges(renderer)).toBe(0)
    await unmount(renderer)
  })

  it("brings the next day's devotional at midnight while the app stays open", async () => {
    jest.setSystemTime(new Date(2026, 11, 20, 23, 59))
    const renderer = await render()
    await press(pressableByLabel(renderer, "Announcements, 1 new"))
    await press(
      pressableByLabel(renderer, `${TITLE} Daily devotional, Today, new`),
    )
    expect(bellLabel(renderer)).toBe("Announcements")
    await act(async () => {
      jest.advanceTimersByTime(2 * 60 * 1000)
    })
    expect(bellLabel(renderer)).toBe("Announcements, 1 new")
    expect(badges(renderer)).toBe(1)
    await press(pressableByLabel(renderer, "Announcements, 1 new"))
    expect(shows(renderer, "Daily devotional · Today")).toBe(true)
    await press(
      pressableByLabel(renderer, `${TITLE} Daily devotional, Today, new`),
    )
    expect(mockRequestPause).toHaveBeenCalledTimes(2)
    expect(bellLabel(renderer)).toBe("Announcements")
    await unmount(renderer)
  })

  it("closes on a tap outside the list and changes nothing else", async () => {
    const renderer = await render()
    await press(pressableByLabel(renderer, "Announcements, 1 new"))
    await press(pressableByLabel(renderer, "Close announcements"))
    expect(listOpen(renderer)).toBe(false)
    expect(mockRequestPause).not.toHaveBeenCalled()
    expect(bellLabel(renderer)).toBe("Announcements, 1 new")
    await unmount(renderer)
  })

  it("lets Liquid Glass answer the touch, with no shrink of its own", async () => {
    const renderer = await render()
    const glass = renderer.root.findAll((node) => node.type === GlassView)
    expect(glass).toHaveLength(1)
    expect(glass[0]!.props.isInteractive).toBe(true)
    await act(async () => {
      ;(bellHost(renderer).props.onResponderGrant as ResponderHandler)(
        responderEvent(),
      )
    })
    expect(shrunk(renderer)).toBe(0)
    await unmount(renderer)
  })

  it("shrinks while pressed where Liquid Glass is missing", async () => {
    mockGlass.liquid = false
    const renderer = await render()
    const glass = renderer.root.findAll((node) => node.type === GlassView)
    expect(glass[0]!.props.isInteractive).toBe(false)
    expect(shrunk(renderer)).toBe(0)
    const host = bellHost(renderer)
    await act(async () => {
      ;(host.props.onResponderGrant as ResponderHandler)(responderEvent())
    })
    expect(shrunk(renderer)).toBe(1)
    await act(async () => {
      ;(host.props.onResponderRelease as ResponderHandler)(responderEvent())
    })
    // Pressability holds the pressed state for its 130 ms minimum press.
    await act(async () => {
      jest.advanceTimersByTime(200)
    })
    expect(shrunk(renderer)).toBe(0)
    await unmount(renderer)
  })
})
