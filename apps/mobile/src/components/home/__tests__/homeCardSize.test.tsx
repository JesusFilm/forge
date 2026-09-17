/**
 * Home's portrait cards are 15pt wider than their screen ratio gives, and keep
 * their 3:4 shape, so a longer title fits in two lines. Landscape is unchanged.
 */
jest.mock("expo-image", () => ({ __esModule: true, Image: () => null }))
jest.mock("expo-linear-gradient", () => ({
  __esModule: true,
  LinearGradient: () => null,
}))
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock("../../watch/WatchProgressBar", () => ({
  WatchProgressBar: () => null,
  progressAccessibilityText: () => null,
}))
jest.mock("../../../hooks/useWatchProgressEntry", () => ({
  useWatchProgressEntry: () => null,
}))
jest.mock("../../../hooks/useHeroStream", () => ({
  prefetchHeroStream: jest.fn(),
}))
jest.mock("../../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { act } from "react"
import { Dimensions } from "react-native"

import type { WatchHomeCard } from "../../../lib/watchHome/model"
import {
  TestRenderer,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { HomeCard, homeCardWidth } from "../HomeCard"

describe("homeCardWidth", () => {
  it.each([
    // [screen width, portrait, landscape]
    [440, 178, 264],
    [375, 154, 225],
  ])(
    "on a %ipt screen: portrait %i, landscape %i",
    (screen, portrait, land) => {
      expect(homeCardWidth("portrait", screen)).toBe(portrait)
      expect(homeCardWidth("landscape", screen)).toBe(land)
    },
  )
})

describe("HomeCard portrait size", () => {
  it("renders at the wider width and keeps the 3:4 shape", () => {
    const card = {
      id: "c1",
      videoId: "v1",
      slug: "lumo-mark",
      title: "LUMO - Mark 1:1-45",
      imageUrl: null,
      metaLabel: null,
    } as unknown as WatchHomeCard
    let renderer!: TestInstance
    act(() => {
      renderer = TestRenderer.create(
        <HomeCard card={card} variant="portrait" />,
      )
    })

    const [pressable] = renderer.root.findAll(
      (node) => typeof node.props.style === "function",
    )
    const style = Object.assign(
      {},
      ...(pressable.props.style as (s: { pressed: boolean }) => unknown[])({
        pressed: false,
      }).filter(Boolean),
    ) as { width: number; aspectRatio: number }
    const screen = Dimensions.get("window").width

    expect(style.width).toBe(Math.round(screen * 0.37) + 15)
    expect(style.aspectRatio).toBe(3 / 4)
  })
})
