/**
 * Home's hero yields the DECODER to the mini player (U8, R9/R10).
 *
 * The distinction this suite exists for: `paused` suspends the pager's reducer
 * but leaves its `videoReady` latch set, so the hero's video view stays
 * mounted and keeps its surface. A paused player is still a decoder. Every
 * assertion below is therefore a MOUNT count, never a call to `pause`.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("expo-video", () =>
  require("../../../test-utils/expoVideoMock").expoVideoModuleMock(),
)
jest.mock("expo", () => {
  const actual = jest.requireActual("expo")
  const { useEffect, useState } = require("react")
  return {
    ...actual,
    useEvent: (
      player: {
        addListener: (
          n: string,
          cb: (p: unknown) => void,
        ) => { remove: () => void }
      },
      name: string,
      initial: unknown,
    ) => {
      const [value, setValue] = useState(initial)
      useEffect(() => {
        const sub = player.addListener(name, (payload: unknown) => {
          setValue(payload)
        })
        return () => sub.remove()
      }, [player, name])
      return value
    },
  }
})
jest.mock("expo-image", () => {
  const { View } = require("react-native")
  return { Image: View }
})
jest.mock("expo-linear-gradient", () => {
  const { View } = require("react-native")
  return { LinearGradient: View }
})
jest.mock("expo-blur", () => {
  const { View } = require("react-native")
  return { BlurView: View }
})
jest.mock("../../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  reportDatadogAction: jest.fn(),
  reportDatadogError: jest.fn(),
}))
// The stream resolver reaches Apollo. What it returns is not what this suite
// is about; that a stream EXISTS is, because a slide with none never reveals.
jest.mock("../../../hooks/useHeroStream", () => ({
  useHeroStream: () => ({
    streamUrl: "https://stream.test/hero.m3u8",
    resolving: false,
    failed: false,
  }),
  prefetchHeroStream: jest.fn(),
}))

import { act } from "react"

import { HomeHeroPager } from "../HomeHeroPager"
import { heroPausedFor } from "../../../lib/watchHome/heroPlayback"
import type { WatchHomeSlide } from "../../../lib/watchHome/carouselSequence"
import {
  lastFakePlayer,
  resetExpoVideoMock,
} from "../../../test-utils/expoVideoMock"
import {
  TestRenderer,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const SLIDE: WatchHomeSlide = {
  kind: "video",
  id: "slide-1",
  title: "Birth of Jesus",
  description: null,
  label: "SHORT FILM",
  slug: "birth-of-jesus",
  parentSlug: null,
  posterUrl: "https://images.test/poster.jpg",
  thumbnailUrl: null,
  imageAlt: "Birth of Jesus",
  playbackId: "abc123",
  durationSeconds: 120,
}

let live: TestInstance[] = []

function videoSurfaces(renderer: TestInstance) {
  return renderer.root.findAll(
    (node) => node.props.testID === "expo-video-view",
  )
}

async function mount(props: { videoSuppressed?: boolean; paused?: boolean }) {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <HomeHeroPager slides={[SLIDE]} heroHeight={600} {...props} />,
    )
  })
  live.push(renderer)
  return renderer
}

async function update(
  renderer: TestInstance,
  props: { videoSuppressed?: boolean; paused?: boolean },
) {
  await act(async () => {
    renderer.update(
      <HomeHeroPager slides={[SLIDE]} heroHeight={600} {...props} />,
    )
  })
}

/** Drive the hero to the state where it reveals its video over the poster. */
async function reveal() {
  const player = lastFakePlayer()
  player.playing = true
  await act(async () => {
    player.emit("playingChange", { isPlaying: true })
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  resetExpoVideoMock()
  live = []
})

afterEach(async () => {
  for (const renderer of live) {
    await act(async () => {
      try {
        renderer.unmount()
      } catch {
        // Already unmounted by the test itself.
      }
    })
  }
  live = []
  jest.useRealTimers()
})

describe("Home's paused predicate", () => {
  it("is true for each reason on its own", () => {
    expect(
      heroPausedFor({
        scrolledAway: true,
        focused: true,
        miniPlayerActive: false,
      }),
    ).toBe(true)
    expect(
      heroPausedFor({
        scrolledAway: false,
        focused: false,
        miniPlayerActive: false,
      }),
    ).toBe(true)
    expect(
      heroPausedFor({
        scrolledAway: false,
        focused: true,
        miniPlayerActive: true,
      }),
    ).toBe(true)
  })

  it("is true for every combination of them", () => {
    for (const scrolledAway of [true, false]) {
      for (const focused of [true, false]) {
        expect(
          heroPausedFor({ scrolledAway, focused, miniPlayerActive: true }),
        ).toBe(true)
      }
    }
    expect(
      heroPausedFor({
        scrolledAway: true,
        focused: false,
        miniPlayerActive: true,
      }),
    ).toBe(true)
  })

  it("is false only when the hero is focused, at the top, and unopposed", () => {
    expect(
      heroPausedFor({
        scrolledAway: false,
        focused: true,
        miniPlayerActive: false,
      }),
    ).toBe(false)
  })

  it("keeps the hero paused when focus returns while the window is live", () => {
    // The pop that creates the window fires Home's focus listener in the same
    // commit, so resume must be gated on window-absent as well as focus.
    expect(
      heroPausedFor({
        scrolledAway: false,
        focused: true,
        miniPlayerActive: true,
      }),
    ).toBe(true)
  })
})

describe("Home's hero video surface", () => {
  it("mounts a video view once the hero reveals", async () => {
    // The positive control. Without it every count below could be zero for a
    // reason that has nothing to do with suppression.
    const renderer = await mount({})
    await reveal()

    expect(videoSurfaces(renderer)).toHaveLength(1)
  })

  it("stays mounted while merely paused", async () => {
    // Documents WHY the mount gate is a separate prop: suspension does not
    // clear the videoReady latch, so pausing alone leaves the decoder held.
    const renderer = await mount({})
    await reveal()

    await update(renderer, { paused: true })

    expect(videoSurfaces(renderer)).toHaveLength(1)
  })

  it("is UNMOUNTED, not merely paused, while the window is active", async () => {
    const renderer = await mount({})
    await reveal()

    await update(renderer, { paused: true, videoSuppressed: true })

    expect(videoSurfaces(renderer)).toHaveLength(0)
  })

  it("stays on its poster when Home is left and re-entered", async () => {
    // The blur/focus round trip a viewer makes while the window floats.
    const renderer = await mount({})
    await reveal()
    await update(renderer, { paused: true, videoSuppressed: true })

    await update(renderer, { paused: false, videoSuppressed: true })

    expect(videoSurfaces(renderer)).toHaveLength(0)
  })

  it("comes back when the window goes", async () => {
    // One path for dismissal and one for playback ending while floating: both
    // clear the session, and the hero must not stay frozen for either.
    const renderer = await mount({})
    await reveal()
    await update(renderer, { paused: true, videoSuppressed: true })

    await update(renderer, { paused: false, videoSuppressed: false })

    expect(videoSurfaces(renderer)).toHaveLength(1)
  })
})
