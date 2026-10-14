/* eslint-disable @typescript-eslint/no-require-imports */

// The shape of the real ES module: the day record loads its `default` export.
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
}))
jest.mock("expo-font", () => ({
  loadAsync: jest.fn(() => Promise.resolve()),
  isLoaded: jest.fn(() => false),
}))
const mockRequestPause = jest.fn()
let mockPausePhase = "idle"
jest.mock("../../../lib/pauseCurtain", () => ({
  requestPause: () => mockRequestPause(),
  usePausePhase: () => mockPausePhase,
}))

import AsyncStorage from "@react-native-async-storage/async-storage"
import * as Font from "expo-font"
import { Image } from "expo-image"
import { act } from "react"
import {
  Dimensions,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from "react-native"

import {
  TestRenderer,
  hasText,
  press,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { useAnnouncements } from "../../../lib/announcements"
import {
  getPauseProgressStore,
  resetPauseProgressStoreForTests,
} from "../../../lib/dailyPause/progress"
import { DEVOTIONALS } from "../../../lib/dailyPause/devotionals"
import { pauseColors } from "../../../lib/dailyPause/theme"
import { CARD_BORDER_RADIUS } from "../../../styles/shared"
import { DailyPauseCard, dailyPauseCardWidth } from "../DailyPauseCard"
import { PauseLightLeaks } from "../PauseLightLeaks"
import { DailyBiblePauseLogo } from "../../DailyBiblePauseLogo"

const mockLoadAsync = Font.loadAsync as jest.Mock

// 2026-10-05 is a Monday, and the day clock gives it the Pharisee devotional.
const MONDAY = "2026-10-05"
const PHARISEE = "How are we commanded to pray?"
const LAMP =
  "Where is one place this week you can let someone see what Christ has done in you?"
const DONE = "You paused today · Watch again"
const BEGIN = "Begin today's pause"

function at(day: number, hour: number, minute = 0) {
  jest.useFakeTimers({ now: new Date(2026, 9, day, hour, minute) })
}

/** R7: the run marks the day done when it reaches Share. */
async function finish(dayKey: string) {
  await act(async () => {
    getPauseProgressStore().markDone(dayKey)
  })
}

async function render(focused = false): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<DailyPauseCard focused={focused} />)
  })
  return renderer
}

function backgroundSource(renderer: TestInstance): unknown {
  const images = renderer.root.findAll((node) => node.type === Image)
  expect(images).toHaveLength(1)
  return images[0]!.props.source
}

function leaksEnabled(renderer: TestInstance): boolean {
  const leaks = renderer.root.findAll((node) => node.type === PauseLightLeaks)
  expect(leaks).toHaveLength(1)
  return leaks[0]!.props.enabled as boolean
}

function card(renderer: TestInstance): RenderedNode {
  const matches = renderer.root.findAll(
    (node) =>
      node.props.accessibilityRole === "button" &&
      typeof node.props.onPress === "function",
  )
  expect(matches.length).toBeGreaterThan(0)
  return matches[0]!
}

function textNode(renderer: TestInstance, text: string): RenderedNode {
  const matches = renderer.root.findAll(
    (node) => node.type === Text && node.props.children === text,
  )
  expect(matches).toHaveLength(1)
  return matches[0]!
}

function isInside(node: RenderedNode, ancestor: RenderedNode): boolean {
  for (let at = node.parent; at != null; at = at.parent) {
    if (at === ancestor) return true
  }
  return false
}

function textStyle(node: RenderedNode): TextStyle {
  return StyleSheet.flatten(node.props.style as TextStyle)
}

beforeEach(async () => {
  // A relaunch with empty storage: each case starts with no day record.
  resetPauseProgressStoreForTests()
  await AsyncStorage.clear()
})

afterEach(() => {
  mockRequestPause.mockClear()
  mockPausePhase = "idle"
  jest.useRealTimers()
})

function cardStyle(renderer: TestInstance): ViewStyle {
  const style = card(renderer).props.style as (state: {
    pressed: boolean
  }) => ViewStyle
  return StyleSheet.flatten(style({ pressed: false }))
}

const DEFAULT_WINDOW = Dimensions.get("window")
const DEFAULT_SCREEN = Dimensions.get("screen")

function setWindowWidth(width: number) {
  act(() => {
    Dimensions.set({
      window: { ...DEFAULT_WINDOW, width },
      screen: DEFAULT_SCREEN,
    })
  })
}

afterEach(() => {
  act(() => {
    Dimensions.set({ window: DEFAULT_WINDOW, screen: DEFAULT_SCREEN })
  })
})

describe("dailyPauseCardWidth", () => {
  it("fills a phone between the shelf gutters", () => {
    expect(dailyPauseCardWidth(402)).toBe(370)
    expect(dailyPauseCardWidth(440)).toBe(408)
  })

  it("stops at 600 on a tablet", () => {
    expect(dailyPauseCardWidth(744)).toBe(600)
    expect(dailyPauseCardWidth(1032)).toBe(600)
  })
})

describe("DailyPauseCard", () => {
  it("is a rounded carousel-style card, 16:9 at the default text size, and free to grow", async () => {
    at(5, 9)
    setWindowWidth(402)
    const renderer = await render()
    const flat = cardStyle(renderer)
    expect(flat.width).toBe(370)
    expect(flat.minHeight).toBeCloseTo((370 * 9) / 16)
    expect(flat.borderRadius).toBe(CARD_BORDER_RADIUS)
    expect(flat.overflow).toBe("hidden")
    // A fixed ratio would clip the question at a large text size.
    expect(flat.aspectRatio).toBeUndefined()
    expect(flat.height).toBeUndefined()
    expect(flat.backgroundColor).toBe(pauseColors.background)
    await unmount(renderer)
  })

  it("keeps the card at 600 wide on a tablet window", async () => {
    at(5, 9)
    setWindowWidth(1032)
    const renderer = await render()
    const flat = cardStyle(renderer)
    expect(flat.width).toBe(600)
    expect(flat.minHeight).toBeCloseTo((600 * 9) / 16)
    await unmount(renderer)
  })

  it("puts a shelf heading above the card, not inside it", async () => {
    at(5, 9)
    const renderer = await render()
    const heading = textNode(renderer, "Daily Bible Pause")
    expect(heading.props.accessibilityRole).toBe("header")
    expect(textStyle(heading).fontWeight).toBe("700")
    // The question is the positive control: it must be inside the card.
    expect(isInside(textNode(renderer, PHARISEE), card(renderer))).toBe(true)
    expect(isInside(heading, card(renderer))).toBe(false)
    expect(hasText(renderer, "DAILY BIBLE PAUSE")).toBe(false)
    await unmount(renderer)
  })

  // The owner, 2026-10-13: the logo shows on the card before and after the
  // day's pause, fully drawn, inside the card above its text.
  it("shows the fully drawn logo in the card, before and after the day's pause", async () => {
    for (const done of [false, true]) {
      at(5, 9)
      if (done) await finish(MONDAY)
      const renderer = await render()
      const logos = renderer.root.findAll(
        (node) => node.type === DailyBiblePauseLogo,
      )
      expect(logos).toHaveLength(1)
      expect(isInside(logos[0]!, card(renderer))).toBe(true)
      const draw = logos[0]!.props.draw as { __getValue(): number }
      expect(draw.__getValue()).toBe(1)
      // The mark alone, centred across the card (the owner, 2026-10-13).
      expect(logos[0]!.props.title).toBe(false)
      const logoText = renderer.root.findAll(
        (node) =>
          typeof node.props.children === "string" && isInside(node, logos[0]!),
      )
      expect(logoText).toHaveLength(0)
      const area = logos[0]!.parent!
      expect(StyleSheet.flatten(area.props.style as ViewStyle)).toMatchObject({
        alignItems: "center",
        alignSelf: "stretch",
      })
      expect(hasText(renderer, done ? DONE : PHARISEE)).toBe(true)
      await unmount(renderer)
      resetPauseProgressStoreForTests()
      await AsyncStorage.clear()
    }
  })

  // The owner, 2026-10-13: every element in the card sits on its centre line.
  it("centres the question, Begin, and the done line across the card", async () => {
    at(5, 9)
    const today = await render()
    const question = textNode(today, PHARISEE)
    expect(textStyle(question).textAlign).toBe("center")
    const body = question.parent!
    expect(StyleSheet.flatten(body.props.style as ViewStyle).alignItems).toBe(
      "center",
    )
    expect(isInside(textNode(today, BEGIN), body)).toBe(true)
    await unmount(today)

    await finish(MONDAY)
    const done = await render()
    const line = textNode(done, DONE)
    expect(textStyle(line).textAlign).toBe("center")
    expect(
      StyleSheet.flatten(line.parent!.props.style as ViewStyle).alignSelf,
    ).toBe("center")
    await unmount(done)
  })

  it("draws the day's own still behind the question", async () => {
    at(5, 9)
    const monday = await render()
    expect(backgroundSource(monday)).toBe(DEVOTIONALS.pharisee.cardArt)
    await unmount(monday)
    at(6, 9)
    const tuesday = await render()
    expect(backgroundSource(tuesday)).toBe(DEVOTIONALS.lamp.cardArt)
    expect(DEVOTIONALS.lamp.cardArt).not.toBe(DEVOTIONALS.pharisee.cardArt)
    await unmount(tuesday)
  })

  it("lets the light leaks flash only on a focused Home with no curtain", async () => {
    at(5, 9)
    const renderer = await render(true)
    expect(leaksEnabled(renderer)).toBe(true)
    await act(async () => {
      renderer.update(<DailyPauseCard focused={false} />)
    })
    expect(leaksEnabled(renderer)).toBe(false)
    mockPausePhase = "closing"
    await act(async () => {
      renderer.update(<DailyPauseCard focused />)
    })
    expect(leaksEnabled(renderer)).toBe(false)
    await unmount(renderer)
  })

  it("shows the Lamp question on a Tuesday after a done Pharisee Monday (AE3)", async () => {
    at(5, 9)
    await finish(MONDAY)
    at(6, 9)
    const renderer = await render()
    expect(hasText(renderer, LAMP)).toBe(true)
    expect(hasText(renderer, BEGIN)).toBe(true)
    expect(hasText(renderer, DONE)).toBe(false)
    // KTD18: at most 3 lines, and the rest ends in an ellipsis.
    const question = textNode(renderer, LAMP)
    expect(question.props.numberOfLines).toBe(3)
    expect(textStyle(question).fontFamily).toBe("InstrumentSerif-Regular")
    expect(textStyle(question).color).toBe(pauseColors.ink)
    expect(card(renderer).props.accessibilityLabel).toBe(
      `Daily Bible Pause. ${LAMP} ${BEGIN}`,
    )
    await unmount(renderer)
  })

  it("reads 'You paused today · Watch again' on a done day, and a tap opens the curtain", async () => {
    at(5, 9)
    await finish(MONDAY)
    const renderer = await render()
    expect(hasText(renderer, DONE)).toBe(true)
    expect(hasText(renderer, PHARISEE)).toBe(false)
    expect(hasText(renderer, BEGIN)).toBe(false)
    expect(card(renderer).props.accessibilityLabel).toBe(
      "Daily Bible Pause. You paused today. Watch again",
    )
    await press(card(renderer))
    expect(mockRequestPause).toHaveBeenCalledTimes(1)
    await unmount(renderer)
  })

  it("clears the bell's dot and sends one curtain request on a tap", async () => {
    at(5, 9)
    const unread: number[] = []
    function Bell() {
      unread.push(useAnnouncements().unreadCount)
      return null
    }
    let renderer!: TestInstance
    await act(async () => {
      renderer = TestRenderer.create(
        <View>
          <Bell />
          <DailyPauseCard focused={false} />
        </View>,
      )
    })
    expect(hasText(renderer, PHARISEE)).toBe(true)
    expect(unread.at(-1)).toBe(1)
    expect(mockRequestPause).not.toHaveBeenCalled()
    await press(card(renderer))
    expect(unread.at(-1)).toBe(0)
    expect(mockRequestPause).toHaveBeenCalledTimes(1)
    await unmount(renderer)
  })

  it("moves to the next day's question at midnight while the app stays open", async () => {
    at(5, 23, 59)
    await finish(MONDAY)
    const renderer = await render()
    expect(hasText(renderer, DONE)).toBe(true)
    await act(async () => {
      jest.advanceTimersByTime(2 * 60 * 1000)
    })
    expect(hasText(renderer, LAMP)).toBe(true)
    expect(hasText(renderer, DONE)).toBe(false)
    await unmount(renderer)
  })

  it("shows no card text until the Pass 2 fonts finish their load", async () => {
    at(5, 9)
    let finishLoad!: () => void
    mockLoadAsync.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishLoad = resolve
      }),
    )
    const renderer = await render()
    // The heading uses the system font, so it does not wait.
    expect(hasText(renderer, "Daily Bible Pause")).toBe(true)
    expect(hasText(renderer, PHARISEE)).toBe(false)
    await act(async () => finishLoad())
    expect(hasText(renderer, PHARISEE)).toBe(true)
    await unmount(renderer)
  })
})
