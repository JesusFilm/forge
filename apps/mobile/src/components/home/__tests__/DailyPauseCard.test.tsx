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
jest.mock("../../../lib/pauseCurtain", () => ({
  requestPause: () => mockRequestPause(),
}))

import AsyncStorage from "@react-native-async-storage/async-storage"
import * as Font from "expo-font"
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
import { pauseColors } from "../../../lib/dailyPause/theme"
import { DailyPauseCard } from "../DailyPauseCard"

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

async function render(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<DailyPauseCard />)
  })
  return renderer
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
  jest.useRealTimers()
})

describe("DailyPauseCard", () => {
  it("is full width, 16:9 at the default text size, and free to grow", async () => {
    at(5, 9)
    const renderer = await render()
    const style = card(renderer).props.style as (state: {
      pressed: boolean
    }) => ViewStyle
    const flat = StyleSheet.flatten(style({ pressed: false }))
    expect(flat.width).toBe("100%")
    expect(flat.minHeight).toBeCloseTo(
      (Dimensions.get("window").width * 9) / 16,
    )
    // A fixed ratio would clip the question at a large text size.
    expect(flat.aspectRatio).toBeUndefined()
    expect(flat.height).toBeUndefined()
    expect(flat.backgroundColor).toBe(pauseColors.background)
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
          <DailyPauseCard />
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

  it("shows no text until the Pass 2 fonts finish their load", async () => {
    at(5, 9)
    let finishLoad!: () => void
    mockLoadAsync.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishLoad = resolve
      }),
    )
    const renderer = await render()
    expect(hasText(renderer, "DAILY BIBLE PAUSE")).toBe(false)
    expect(hasText(renderer, PHARISEE)).toBe(false)
    await act(async () => finishLoad())
    expect(hasText(renderer, "DAILY BIBLE PAUSE")).toBe(true)
    expect(hasText(renderer, PHARISEE)).toBe(true)
    await unmount(renderer)
  })
})
