import { act } from "react"
import { StyleSheet, View, type ViewStyle } from "react-native"

import {
  TestRenderer,
  hasText,
  press,
  pressableByLabel,
  unmount,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { useAnnouncements } from "../../../lib/announcements"
import { DailyPauseCard } from "../DailyPauseCard"

jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
const mockRequestPause = jest.fn()
jest.mock("../../../lib/pauseCurtain", () => ({
  requestPause: () => mockRequestPause(),
}))

const LABEL = "Begin today's Daily Bible Pause"

async function render(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<DailyPauseCard />)
  })
  return renderer
}

afterEach(() => mockRequestPause.mockClear())

describe("DailyPauseCard", () => {
  it("is a full-width 16:9 card", async () => {
    const renderer = await render()
    const card = pressableByLabel(renderer, LABEL)
    const style = card.props.style as (state: { pressed: boolean }) => ViewStyle
    const flat = StyleSheet.flatten(style({ pressed: false }))
    expect(flat.width).toBe("100%")
    expect(flat.aspectRatio).toBeCloseTo(16 / 9)
    await unmount(renderer)
  })

  it("invites the viewer to begin today's pause", async () => {
    const renderer = await render()
    expect(hasText(renderer, "DAILY BIBLE PAUSE")).toBe(true)
    expect(hasText(renderer, "Begin today's pause")).toBe(true)
    await unmount(renderer)
  })

  it("opens the cinematic curtain on a tap", async () => {
    const renderer = await render()
    expect(mockRequestPause).not.toHaveBeenCalled()
    await press(pressableByLabel(renderer, LABEL))
    expect(mockRequestPause).toHaveBeenCalledTimes(1)
    await unmount(renderer)
  })

  it("clears the bell's red dot for today's devotional", async () => {
    jest.useFakeTimers({ now: new Date(2026, 11, 1, 9, 0) })
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
    expect(unread.at(-1)).toBe(1)
    await press(pressableByLabel(renderer, LABEL))
    expect(unread.at(-1)).toBe(0)
    await unmount(renderer)
    jest.useRealTimers()
  })
})
