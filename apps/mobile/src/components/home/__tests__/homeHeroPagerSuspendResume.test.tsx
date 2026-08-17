/**
 * Scroll suspend/resume contract for the hero pager (the two 2026-08 hero
 * regressions surfaced by the expo-video 57 upgrade):
 *
 * 1. Resuming from a scroll suspension must NOT re-issue `replaceAsync` for a
 *    source that is already loaded. On expo-video 57 a replace reloads the
 *    item at zero, so the redundant re-issue reset the playhead every time
 *    the user scrolled back to the top.
 * 2. A suspension that lands while a swap is in flight must not start
 *    playback when that swap settles. The settle callback used to consult a
 *    snapshot of `suspended` captured at issue time, so the hero kept playing
 *    behind the feed after the user scrolled down.
 *
 * The fake player models the expo-video 57 contract the fixes depend on:
 * `replaceAsync` resolves with the playhead at zero.
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

// Visual leaves only — none participate in the suspend/resume contract.
jest.mock("expo-image", () => ({ Image: () => null }))
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }))
jest.mock("../../ui/PlatformBlur", () => ({ PlatformBlur: () => null }))
jest.mock("../HomePagerDots", () => ({ HomePagerDots: () => null }))
jest.mock("../../../lib/datadog", () => ({
  datadogLog: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

type FakeListener = (payload?: unknown) => void

type FakePlayer = {
  muted: boolean
  loop: boolean
  playing: boolean
  currentTime: number
  play: jest.Mock
  pause: jest.Mock
  replay: jest.Mock
  replaceAsync: jest.Mock
  addListener: (name: string, fn: FakeListener) => { remove: () => void }
}

type ExpoVideoMock = {
  VideoView: () => null
  useVideoPlayer: (
    source: unknown,
    setup?: (player: FakePlayer) => void,
  ) => FakePlayer
  __player: FakePlayer
  /** Settles the oldest in-flight replaceAsync with the playhead at zero. */
  __settleReplace: () => void
  __reset: () => void
}

jest.mock("expo-video", () => {
  const listeners = new Map<string, Set<FakeListener>>()
  const pendingReplaces: Array<() => void> = []
  const emit = (name: string, payload?: unknown) => {
    for (const fn of listeners.get(name) ?? []) fn(payload)
  }
  const player: FakePlayer = {
    muted: false,
    loop: true,
    playing: false,
    currentTime: 0,
    play: jest.fn(() => {
      player.playing = true
      emit("playingChange", { isPlaying: true })
    }),
    pause: jest.fn(() => {
      player.playing = false
      emit("playingChange", { isPlaying: false })
    }),
    replay: jest.fn(() => {
      player.currentTime = 0
      player.playing = true
    }),
    replaceAsync: jest.fn(
      () =>
        new Promise<void>((resolve) => {
          pendingReplaces.push(() => {
            // expo-video 57: the incoming item loads at zero.
            player.currentTime = 0
            resolve()
          })
        }),
    ),
    addListener: (name: string, fn: FakeListener) => {
      let set = listeners.get(name)
      if (set == null) {
        set = new Set()
        listeners.set(name, set)
      }
      set.add(fn)
      return { remove: () => set.delete(fn) }
    },
  }
  const mock: ExpoVideoMock = {
    VideoView: () => null,
    useVideoPlayer: (_source, setup) => {
      setup?.(player)
      return player
    },
    __player: player,
    __settleReplace: () => {
      const settle = pendingReplaces.shift()
      if (settle == null) throw new Error("no in-flight replaceAsync to settle")
      settle()
    },
    __reset: () => {
      listeners.clear()
      pendingReplaces.length = 0
      player.playing = false
      player.currentTime = 0
    },
  }
  return mock
})

// Live event subscription so PLAY_STARTED reaches the reducer like on-device.
jest.mock("expo", () => ({
  useEvent: (
    player: {
      addListener: (n: string, f: FakeListener) => { remove: () => void }
    },
    event: string,
    initial: unknown,
  ) => {
    const r = require as unknown as NodeRequireLike
    const react = r("react") as {
      useState: <T>(v: T) => [T, (v: T) => void]
      useEffect: (fn: () => () => void, deps: unknown[]) => void
    }
    const [value, setValue] = react.useState(initial)
    react.useEffect(() => {
      const sub = player.addListener(event, (payload) => setValue(payload))
      return () => sub.remove()
    }, [player, event])
    return value
  },
}))

type HeroStreamMock = {
  useHeroStream: (slug: string | null) => {
    streamUrl: string | null
    resolving: boolean
    failed: boolean
  }
  prefetchHeroStream: jest.Mock
  /** Test-controlled resolution table, keyed by slug. */
  __streams: Record<string, string>
}

jest.mock("../../../hooks/useHeroStream", () => {
  const streams: Record<string, string> = {}
  const mock: HeroStreamMock = {
    __streams: streams,
    prefetchHeroStream: jest.fn(),
    useHeroStream: (slug: string | null) => {
      const r = require as unknown as NodeRequireLike
      const react = r("react") as {
        useState: (v: number) => [number, (fn: (n: number) => number) => void]
        useEffect: (fn: () => void, deps: unknown[]) => void
      }
      // The real hook resolves through an effect, one render after the slug
      // lands; the forced re-render models that lag for the pager's guard.
      const [, force] = react.useState(0)
      react.useEffect(() => {
        force((n) => n + 1)
      }, [slug])
      if (slug == null)
        return { streamUrl: null, resolving: false, failed: false }
      const url = streams[slug]
      // Fresh object per render, mirroring the real hook's state identity.
      return url != null
        ? { streamUrl: url, resolving: false, failed: false }
        : { streamUrl: null, resolving: true, failed: false }
    },
  }
  return mock
})

import { act, type ReactElement } from "react"

import { HomeHeroPager } from "../HomeHeroPager"
import type { WatchHomeVideoSlide } from "../../../lib/watchHome/carouselSequence"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

// The suite's first render pays the full HomeHeroPager+FlatList transform
// cost; on a cold CI runner that exceeds jest's 5s default.
jest.setTimeout(20_000)

const expoVideo = jest.requireMock("expo-video") as ExpoVideoMock
const heroStream = jest.requireMock(
  "../../../hooks/useHeroStream",
) as HeroStreamMock

const URL_A = "https://stream.test/a.m3u8"
const URL_B = "https://stream.test/b.m3u8"

function videoSlide(id: string, slug: string): WatchHomeVideoSlide {
  return {
    kind: "video",
    id,
    title: `Title ${id}`,
    description: null,
    label: "featureFilm",
    slug,
    parentSlug: null,
    posterUrl: null,
    thumbnailUrl: null,
    imageAlt: `Alt ${id}`,
    playbackId: null,
    durationSeconds: 120,
  }
}

const SLIDES: readonly WatchHomeVideoSlide[] = [
  videoSlide("v1", "first-film"),
  videoSlide("v2", "second-film"),
]

type UpdatableInstance = TestInstance & { update(element: ReactElement): void }

function element(paused: boolean): ReactElement {
  return (
    <HomeHeroPager slides={SLIDES} heroHeight={480} paused={paused} muted />
  )
}

/** Renders un-suspended and settles the first swap into steady playback. */
async function renderPlaying(): Promise<UpdatableInstance> {
  let renderer!: UpdatableInstance
  await act(async () => {
    renderer = TestRenderer.create(element(false)) as UpdatableInstance
  })
  expect(expoVideo.__player.replaceAsync).toHaveBeenCalledTimes(1)
  await act(async () => {
    expoVideo.__settleReplace()
  })
  expect(expoVideo.__player.playing).toBe(true)
  return renderer
}

beforeEach(() => {
  jest.clearAllMocks()
  expoVideo.__reset()
  for (const key of Object.keys(heroStream.__streams)) {
    delete heroStream.__streams[key]
  }
  heroStream.__streams["first-film"] = URL_A
})

describe("HomeHeroPager scroll suspend/resume", () => {
  it("suspends playback while the paused prop is set", async () => {
    const renderer = await renderPlaying()
    expoVideo.__player.currentTime = 42.5

    await act(async () => {
      renderer.update(element(true))
    })

    expect(expoVideo.__player.playing).toBe(false)
    await act(async () => {
      renderer.unmount()
    })
  })

  it("resumes from the held playhead without re-issuing the loaded source", async () => {
    const renderer = await renderPlaying()
    expoVideo.__player.currentTime = 42.5

    await act(async () => {
      renderer.update(element(true))
    })
    expect(expoVideo.__player.replaceAsync).toHaveBeenCalledTimes(1)

    await act(async () => {
      renderer.update(element(false))
    })

    // A second replaceAsync here is the reset-to-zero bug: the source is
    // already loaded, so resume must just play from the held position.
    expect(expoVideo.__player.replaceAsync).toHaveBeenCalledTimes(1)
    expect(expoVideo.__player.playing).toBe(true)
    expect(expoVideo.__player.currentTime).toBeCloseTo(42.5)
    await act(async () => {
      renderer.unmount()
    })
  })

  it("still re-issues on resume when a NEW stream resolved during suspension", async () => {
    const renderer = await renderPlaying()

    await act(async () => {
      renderer.update(element(true))
    })
    // The active slide's stream re-resolves to a different URL mid-suspension
    // (dub change, cooldown retry): resume must swap to it (AE6).
    heroStream.__streams["first-film"] = URL_B
    await act(async () => {
      renderer.update(element(true))
    })

    await act(async () => {
      renderer.update(element(false))
    })

    expect(expoVideo.__player.replaceAsync).toHaveBeenCalledTimes(2)
    expect(expoVideo.__player.replaceAsync).toHaveBeenLastCalledWith(URL_B)
    await act(async () => {
      renderer.unmount()
    })
  })

  it("does not start playback when a swap settles under an active suspension", async () => {
    const renderer = await renderPlaying()

    // A legitimate swap goes in flight while running…
    heroStream.__streams["first-film"] = URL_B
    await act(async () => {
      renderer.update(element(false))
    })
    expect(expoVideo.__player.replaceAsync).toHaveBeenCalledTimes(2)

    // …then the user scrolls down before it settles.
    await act(async () => {
      renderer.update(element(true))
    })
    expect(expoVideo.__player.playing).toBe(false)

    await act(async () => {
      expoVideo.__settleReplace()
    })

    // The settle used to consult the suspension snapshot captured at issue
    // time and start playback behind the feed.
    expect(expoVideo.__player.playing).toBe(false)
    await act(async () => {
      renderer.unmount()
    })
  })

  it("plays, not re-issues, a swap that settled under suspension", async () => {
    const renderer = await renderPlaying()

    heroStream.__streams["first-film"] = URL_B
    await act(async () => {
      renderer.update(element(false))
    })
    expect(expoVideo.__player.replaceAsync).toHaveBeenCalledTimes(2)

    // Suspend while the swap is in flight; it settles under the suspension.
    await act(async () => {
      renderer.update(element(true))
    })
    await act(async () => {
      expoVideo.__settleReplace()
    })
    expect(expoVideo.__player.playing).toBe(false)

    await act(async () => {
      renderer.update(element(false))
    })

    // pagerReducer.suspend() latched pendingSwap from the in-flight swap; a
    // resume must not spend it on a re-issue of the already-settled source.
    expect(expoVideo.__player.replaceAsync).toHaveBeenCalledTimes(2)
    expect(expoVideo.__player.playing).toBe(true)
    await act(async () => {
      renderer.unmount()
    })
  })

  it("recovers a never-revealed source on resume without a re-issue", async () => {
    let renderer!: UpdatableInstance
    await act(async () => {
      renderer = TestRenderer.create(element(false)) as UpdatableInstance
    })
    expect(expoVideo.__player.replaceAsync).toHaveBeenCalledTimes(1)

    // Suspend before the FIRST swap ever settles (phase never reached
    // "playing"), then let it settle under the suspension.
    await act(async () => {
      renderer.update(element(true))
    })
    await act(async () => {
      expoVideo.__settleReplace()
    })
    expect(expoVideo.__player.playing).toBe(false)

    await act(async () => {
      renderer.update(element(false))
    })

    expect(expoVideo.__player.replaceAsync).toHaveBeenCalledTimes(1)
    expect(expoVideo.__player.playing).toBe(true)
    await act(async () => {
      renderer.unmount()
    })
  })

  it("does not re-issue when a resume races the in-flight swap", async () => {
    let renderer!: UpdatableInstance
    await act(async () => {
      renderer = TestRenderer.create(element(false)) as UpdatableInstance
    })
    expect(expoVideo.__player.replaceAsync).toHaveBeenCalledTimes(1)

    // Scroll down and straight back up while the swap is still in flight.
    await act(async () => {
      renderer.update(element(true))
    })
    await act(async () => {
      renderer.update(element(false))
    })

    await act(async () => {
      expoVideo.__settleReplace()
    })

    expect(expoVideo.__player.replaceAsync).toHaveBeenCalledTimes(1)
    expect(expoVideo.__player.playing).toBe(true)
    await act(async () => {
      renderer.unmount()
    })
  })
})
