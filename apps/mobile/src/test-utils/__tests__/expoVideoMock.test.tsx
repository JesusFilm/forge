// No `jest.mock("react", …)` preamble on purpose: this suite is also the proof
// for the doc-comment correction in rnTestRenderer.ts — the global
// moduleNameMapper pins are enough for a render suite since SDK 57.
import { createElement } from "react"
import { act } from "react"

import { TestRenderer, type TestInstance } from "../rnTestRenderer"
import {
  createdFakePlayers,
  expoVideoModuleMock,
  lastFakePlayer,
  makeFakePlayer,
  resetExpoVideoMock,
} from "../expoVideoMock"

// The properties the adapter, the chrome and the caption overlay actually read.
// A missing one surfaces as an undefined-property crash deep inside a render,
// so pin the shape here where the failure names the property.
const REQUIRED_PROPERTIES = [
  "muted",
  "loop",
  "playing",
  "currentTime",
  "duration",
  "status",
  "subtitleTrack",
  "play",
  "pause",
  "replace",
  "replaceAsync",
  "addListener",
] as const

describe("makeFakePlayer", () => {
  it("satisfies every property the adapter reads", () => {
    const player = makeFakePlayer()
    for (const property of REQUIRED_PROPERTIES) {
      expect(player).toHaveProperty(property)
      expect(player[property]).toBeDefined()
    }
  })

  it("delivers a native event to live listeners and stops after remove()", () => {
    const player = makeFakePlayer()
    const onEnd = jest.fn()
    const subscription = player.addListener("playToEnd", onEnd)

    player.emit("playToEnd")
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(player.listenerCount("playToEnd")).toBe(1)

    subscription.remove()
    player.emit("playToEnd")
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(player.listenerCount("playToEnd")).toBe(0)
  })

  it("carries the event payload the adapter destructures", () => {
    const player = makeFakePlayer()
    const onStatus = jest.fn()
    player.addListener("statusChange", onStatus)

    player.emit("statusChange", { status: "error", error: { message: "boom" } })

    expect(onStatus).toHaveBeenCalledWith({
      status: "error",
      error: { message: "boom" },
    })
  })

  it("does not skip a listener that removes itself mid-emit", () => {
    const player = makeFakePlayer()
    const second = jest.fn()
    const subscriptions: { remove: () => void }[] = []
    const first = jest.fn(() => subscriptions[0].remove())
    subscriptions.push(player.addListener("playToEnd", first))
    player.addListener("playToEnd", second)

    player.emit("playToEnd")

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it("takes overrides so a suite can start from a playing player", () => {
    expect(makeFakePlayer({ playing: true, duration: 120 })).toMatchObject({
      playing: true,
      duration: 120,
    })
  })
})

describe("expoVideoModuleMock", () => {
  beforeEach(() => {
    resetExpoVideoMock()
  })

  it("runs the creation setup callback against the new player", async () => {
    const videoModule = expoVideoModuleMock()
    const Host = () => {
      videoModule.useVideoPlayer("https://example.test/a.m3u8", (player) => {
        player.muted = true
      })
      return null
    }

    await act(async () => {
      TestRenderer.create(createElement(Host))
    })

    expect(lastFakePlayer().muted).toBe(true)
    expect(createdFakePlayers()).toHaveLength(1)
  })

  it("returns one stable player across re-renders of the same source", async () => {
    const videoModule = expoVideoModuleMock()
    const seen: unknown[] = []
    const Host = ({ source }: { source: string }) => {
      seen.push(videoModule.useVideoPlayer(source))
      return null
    }

    let renderer!: TestInstance
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(Host, { source: "https://example.test/a.m3u8" }),
      )
    })
    await act(async () => {
      renderer.update(
        createElement(Host, { source: "https://example.test/a.m3u8" }),
      )
    })

    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe(seen[1])
    // The churn this guards: a fresh player per render would re-run every
    // `[player]` effect in the adapter on every render.
    expect(createdFakePlayers()).toHaveLength(1)
  })

  it("mounts a countable host element per VideoView", async () => {
    const videoModule = expoVideoModuleMock()
    let renderer!: TestInstance
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(videoModule.VideoView, { nativeControls: false }),
      )
    })

    const surfaces = renderer.root.findAll(
      (node) => node.props.testID === "expo-video-view",
    )
    expect(surfaces).toHaveLength(1)
    expect(surfaces[0].props.nativeControls).toBe(false)
  })

  it("exposes createVideoPlayer and picture-in-picture support", () => {
    const videoModule = expoVideoModuleMock()

    const player = videoModule.createVideoPlayer("https://example.test/a.m3u8")

    expect(createdFakePlayers()).toEqual([player])
    expect(videoModule.isPictureInPictureSupported()).toBe(true)
  })
})
