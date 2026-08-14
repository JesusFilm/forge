/**
 * The host's PRODUCTION defaults.
 *
 * `PlaybackHost.test.tsx` injects all four dependencies, and its mock of the
 * singleton module THROWS — so the parameter defaults that `app/_layout.tsx`
 * actually runs are executed by no test there. Deleting one, or pointing it at
 * a fresh instance instead of the app-wide one, left the whole suite green.
 * This file renders `<PlaybackHost />` with no props at all.
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
// The host's router read is a lazy `require`, so mocking the module is what
// lets the fourth default run. Subscribable like the real hook: a navigation
// must re-render the leaf, which the memo shields from other store writes.
jest.mock("expo-router", () => {
  const { useSyncExternalStore } = require("react") as typeof import("react")
  let segments: readonly string[] = ["(tabs)", "index"]
  const listeners = new Set<() => void>()
  return {
    useSegments: () =>
      useSyncExternalStore(
        (listener: () => void) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        () => segments,
      ),
    __setSegments: (next: readonly string[]) => {
      segments = next
      for (const listener of [...listeners]) listener()
    },
  }
})
// The REAL factories behind the real getter names: whatever the host's defaults
// resolve to is the instance this test drives.
jest.mock("../../../lib/miniPlayer", () => {
  const { createMiniPlayerStore } =
    require("../../../lib/miniPlayer/store") as typeof import("../../../lib/miniPlayer/store")
  const { createSheetCounter } =
    require("../../../lib/miniPlayer/suppression") as typeof import("../../../lib/miniPlayer/suppression")
  const { createSessionEndRegistry } =
    require("../../../lib/miniPlayer/endRegistry") as typeof import("../../../lib/miniPlayer/endRegistry")
  const registry = createSessionEndRegistry()
  const store = createMiniPlayerStore({
    getSubjectId: () => "account-1",
    subscribeToSubject: () => () => {},
    onEnd: (_session, reason) => registry.end(reason),
  })
  const sheets = createSheetCounter()
  return {
    getMiniPlayerStore: () => store,
    getMiniPlayerSheets: () => sheets,
    registerSessionEnd: registry.register,
  }
})
jest.mock("../../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  reportDatadogAction: jest.fn(),
  reportDatadogError: jest.fn(),
}))
jest.mock("../../../lib/watchProgress/store", () => ({
  applyLocalProgress: jest.fn(),
  bufferProgressIntent: jest.fn(),
}))
jest.mock("../../../lib/watchProgress/signInPrompt", () => ({
  noteSignedOutPlaybackStop: jest.fn(),
}))
jest.mock("../../../lib/watchProgress/syncClient", () => ({
  getProgressSync: () => ({ drainIntents: jest.fn() }),
  getSignedInAccountId: () => "account-1",
}))
jest.mock("../../../lib/watchProgress/recorder", () => ({
  createProgressRecorder: jest.fn(() => ({
    flush: jest.fn(),
    onTick: jest.fn(),
  })),
}))
jest.mock("../../../lib/videoQoe", () => ({
  createVideoQoeSession: jest.fn(() => ({
    onFirstPlaying: jest.fn(() => null),
    onRebuffer: jest.fn(),
    onError: jest.fn(),
    onTimeUpdate: jest.fn(),
    finalize: jest.fn(() => null),
  })),
  shouldCountRebuffer: jest.fn(() => false),
}))

import { act } from "react"

import { MINI_PLAYER_WINDOW_SLOT, PlaybackHost } from "../PlaybackHost"
import { resetPictureInPictureLatch } from "../../../lib/miniPlayer/pipLatch"
import { createProgressRecorder } from "../../../lib/watchProgress/recorder"
import { createVideoQoeSession } from "../../../lib/videoQoe"
import {
  createdFakePlayers,
  resetExpoVideoMock,
} from "../../../test-utils/expoVideoMock"
import {
  TestRenderer,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const EPISODE_ONE = "https://stream.test/one.m3u8"

const singletons = jest.requireMock(
  "../../../lib/miniPlayer",
) as typeof import("../../../lib/miniPlayer")
const router = jest.requireMock("expo-router") as {
  __setSegments: (next: readonly string[]) => void
}

const createRecorderMock = createProgressRecorder as unknown as jest.Mock
const createQoeMock = createVideoQoeSession as unknown as jest.Mock

type RecorderSpy = { flush: jest.Mock }
type QoeSpy = { finalize: jest.Mock }

function flushTriggers(): unknown[] {
  return createRecorderMock.mock.results
    .flatMap((result) => (result.value as RecorderSpy)?.flush.mock.calls ?? [])
    .map((call) => call[0])
}

function qoeSessions(): QoeSpy[] {
  return createQoeMock.mock.results.map((result) => result.value as QoeSpy)
}

let live: TestInstance[] = []

/** No props: every dependency comes from the host's own defaults. */
async function mountBare() {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<PlaybackHost />)
  })
  live.push(renderer)
  return renderer
}

async function startSession() {
  await act(async () => {
    singletons
      .getMiniPlayerStore()
      .start({ videoId: "video-1", streamingUrl: EPISODE_ONE })
  })
}

function hasWindowSlot(renderer: TestInstance): boolean {
  return (
    renderer.root.findAll(
      (node) => node.props.testID === MINI_PLAYER_WINDOW_SLOT,
    ).length > 0
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  resetExpoVideoMock()
  resetPictureInPictureLatch()
  router.__setSegments(["(tabs)", "index"])
  live = []
})

afterEach(async () => {
  // The singletons outlive every render here, so a leftover session or a
  // stranded sheet count would leak into the next test.
  await act(async () => {
    singletons.getMiniPlayerStore().end("dismissed")
    singletons.getMiniPlayerSheets().reset()
  })
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
})

describe("PlaybackHost production defaults", () => {
  it("plays what the app-wide store publishes", async () => {
    // The `store = getMiniPlayerStore()` default. Without it the root-mounted
    // host watches an instance nothing else writes to, and no session ever
    // reaches a player.
    await mountBare()
    expect(createdFakePlayers()).toHaveLength(0)

    await startSession()

    expect(createdFakePlayers()).toHaveLength(1)
  })

  it("reads the route through expo-router", async () => {
    // The `useRouteSegments` default. A host that read no route at all would
    // resolve one presentation everywhere.
    const renderer = await mountBare()
    await startSession()
    expect(hasWindowSlot(renderer)).toBe(true)

    await act(async () => {
      router.__setSegments(["watch", "[slug]"])
    })

    expect(hasWindowSlot(renderer)).toBe(false)
  })

  it("hides behind the app-wide sheet counter", async () => {
    // The `sheets = getMiniPlayerSheets()` default. A private counter would
    // read zero while the sheet the app opened is on screen.
    const renderer = await mountBare()
    await startSession()

    await act(async () => {
      singletons.getMiniPlayerSheets().openSheet()
    })

    expect(hasWindowSlot(renderer)).toBe(false)
  })

  it("routes an app-wide session end to the live player", async () => {
    // The `registerEnd = registerSessionEnd` default. Without it a dismiss
    // never reaches the player, so React teardown files the session as an
    // abandonment and the bookmark is whatever the last poll sampled.
    await mountBare()
    await startSession()

    await act(async () => {
      singletons.getMiniPlayerStore().end("dismissed")
    })

    expect(flushTriggers()).toEqual(["dismiss"])
    expect(qoeSessions()[0].finalize).toHaveBeenCalledWith("dismissed")
  })
})
