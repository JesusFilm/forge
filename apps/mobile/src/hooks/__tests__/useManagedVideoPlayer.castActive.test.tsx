/**
 * KTD4: the `castActive` option suppresses the adapter's AppState play/pause
 * pair and the stall watchdog while a cast session runs — the background
 * progress flush stays on. The option is ref-mirrored: the AppState listener
 * registers once per player, so a plain option would be a stale closure.
 *
 * Rendered under <StrictMode> per the repo's remount-safety discipline.
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
jest.mock("expo", () => ({
  useEvent: () => ({ isPlaying: mockIsPlaying }),
}))
jest.mock("expo-video", () => ({
  useVideoPlayer: (_source: unknown, setup?: (player: unknown) => void) => {
    setup?.(mockPlayer)
    return mockPlayer
  },
}))
jest.mock("../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
jest.mock("../../lib/watchProgress/recorder", () => ({
  createProgressRecorder: () => mockRecorder,
}))
jest.mock("../../lib/watchProgress/store", () => ({
  applyLocalProgress: jest.fn(),
  bufferProgressIntent: jest.fn(),
}))
jest.mock("../../lib/watchProgress/signInPrompt", () => ({
  noteSignedOutPlaybackStop: jest.fn(),
}))
jest.mock("../../lib/watchProgress/syncClient", () => ({
  getProgressSync: () => ({ drainIntents: jest.fn() }),
  getSignedInAccountId: () => null,
}))
jest.mock("../../lib/videoQoe", () => ({
  createVideoQoeSession: () => ({
    finalize: () => null,
    onFirstPlaying: jest.fn(),
    onTimeUpdate: jest.fn(),
    onError: jest.fn(),
    onRebuffer: jest.fn(),
  }),
  shouldCountRebuffer: () => false,
}))

import { StrictMode, act, type ReactElement } from "react"
import { AppState, type AppStateStatus } from "react-native"

import { useManagedVideoPlayer } from "../useManagedVideoPlayer"
import { datadogLog } from "../../lib/datadog"
import { getMiniPlayerStore } from "../../lib/miniPlayer/store"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../../src/test-utils/rnTestRenderer"

let mockIsPlaying = false
const mockRecorder = { flush: jest.fn(), onTick: jest.fn() }
const mockPlayer = {
  playing: false,
  muted: false,
  loop: false,
  currentTime: 7,
  duration: 120,
  status: "readyToPlay",
  play: jest.fn(),
  pause: jest.fn(),
  replace: jest.fn(),
  replaceAsync: jest.fn(() => Promise.resolve()),
  addListener: jest.fn(() => ({ remove: () => {} })),
}

// Registry honoring remove(), so StrictMode's cleaned-up first subscription
// cannot double-fire into the assertions.
const appStateListeners = new Set<(state: AppStateStatus) => void>()

function fireAppState(state: AppStateStatus) {
  for (const listener of [...appStateListeners]) listener(state)
}

function Harness({
  castActive,
  armsPip = false,
}: {
  castActive: boolean
  armsPip?: boolean
}) {
  useManagedVideoPlayer("https://stream.mux.com/abc123.m3u8", undefined, {
    progress: { videoId: "v1", languageSlug: "en" },
    castActive,
    // Off by default: only the root host arms the OS window, and every other
    // case here is about the AppState pair.
    armsPictureInPicture: armsPip,
  })
  return null
}

type UpdatableRenderer = TestInstance & { update(element: ReactElement): void }

async function render(
  castActive: boolean,
  armsPip = false,
): Promise<UpdatableRenderer> {
  let renderer!: UpdatableRenderer
  await act(async () => {
    renderer = TestRenderer.create(
      <StrictMode>
        <Harness castActive={castActive} armsPip={armsPip} />
      </StrictMode>,
    ) as UpdatableRenderer
  })
  // StrictMode's mount cycle pauses/flushes once; the assertions below are
  // about AppState behavior only.
  mockPlayer.play.mockClear()
  mockPlayer.pause.mockClear()
  mockRecorder.flush.mockClear()
  return renderer
}

async function update(
  renderer: UpdatableRenderer,
  castActive: boolean,
  armsPip = false,
) {
  await act(async () => {
    renderer.update(
      <StrictMode>
        <Harness castActive={castActive} armsPip={armsPip} />
      </StrictMode>,
    )
  })
  mockPlayer.play.mockClear()
  mockPlayer.pause.mockClear()
  mockRecorder.flush.mockClear()
}

beforeEach(() => {
  mockIsPlaying = false
  mockPlayer.currentTime = 7
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((_type, listener) => {
      appStateListeners.add(listener)
      return {
        remove: () => appStateListeners.delete(listener),
      } as never
    })
})

afterEach(() => {
  appStateListeners.clear()
  jest.restoreAllMocks()
  jest.useRealTimers()
})

describe("castActive AppState suppression (KTD4/R12)", () => {
  it("suppresses the pause/resume pair; the background flush stays on", async () => {
    mockIsPlaying = true
    const renderer = await render(true)
    await act(async () => fireAppState("background"))
    expect(mockRecorder.flush).toHaveBeenCalledWith("background")
    expect(mockPlayer.pause).not.toHaveBeenCalled()
    await act(async () => fireAppState("active"))
    expect(mockPlayer.play).not.toHaveBeenCalled()
    await act(async () => renderer.unmount())
  })

  it("keeps the pair without a session (control)", async () => {
    mockIsPlaying = true
    const renderer = await render(false)
    await act(async () => fireAppState("background"))
    expect(mockPlayer.pause).toHaveBeenCalled()
    expect(mockRecorder.flush).toHaveBeenCalledWith("background")
    await act(async () => fireAppState("active"))
    expect(mockPlayer.play).toHaveBeenCalled()
    await act(async () => renderer.unmount())
  })

  it("reads the LIVE option through the ref, not the mount-time closure", async () => {
    // The load-bearing race: cast starts (option flips true) after the
    // listener registered; a stale closure would still pause and resume.
    mockIsPlaying = true
    const renderer = await render(false)
    await update(renderer, true)
    await act(async () => fireAppState("background"))
    expect(mockPlayer.pause).not.toHaveBeenCalled()
    await act(async () => fireAppState("active"))
    expect(mockPlayer.play).not.toHaveBeenCalled()
    await act(async () => renderer.unmount())
  })

  it("does not resume locally when the session ends while backgrounded", async () => {
    // wasPlaying must not be captured during a session; flipping castActive
    // off before foregrounding must still not start local audio.
    mockIsPlaying = true
    const renderer = await render(true)
    await act(async () => fireAppState("background"))
    await update(renderer, false)
    await act(async () => fireAppState("active"))
    expect(mockPlayer.play).not.toHaveBeenCalled()
    await act(async () => renderer.unmount())
  })
})

describe("castActive stall-watchdog suppression (KTD4)", () => {
  it("emits no playhead_stall while a session holds the player frozen", async () => {
    jest.useFakeTimers()
    mockIsPlaying = true
    const renderer = await render(true)
    await act(async () => {
      jest.advanceTimersByTime(6000)
    })
    expect(datadogLog.warn).not.toHaveBeenCalledWith(
      "video.playhead_stall",
      expect.anything(),
    )
    await act(async () => renderer.unmount())
  })

  it("still emits playhead_stall without a session (control)", async () => {
    jest.useFakeTimers()
    mockIsPlaying = true
    const renderer = await render(false)
    await act(async () => {
      jest.advanceTimersByTime(6000)
    })
    expect(datadogLog.warn).toHaveBeenCalledWith(
      "video.playhead_stall",
      expect.anything(),
    )
    await act(async () => renderer.unmount())
  })
})

describe("castActive picture-in-picture veto (KTD4)", () => {
  afterEach(() => {
    // Module singleton: a latch left set leaks into every later suite.
    getMiniPlayerStore().setPipHold(false)
  })

  // The session owns transport, so the OS window opening must not start audio
  // on this device as well.
  //
  // ORDER IS THE WHOLE TEST. An ordinary cast departure clears the was-playing
  // snapshot, so the `!wasPlayingRef` guard would stop the play by itself and
  // the veto would be untestable — green whether or not it exists. Only a
  // session that connects AFTER the app has already left leaves that snapshot
  // set under a live session, which is the one state the veto alone answers.
  it("does not start local audio when the window opens after a session began", async () => {
    mockIsPlaying = true
    const renderer = await render(false, true)

    // Playing, no session: the ordinary background records was-playing.
    await act(async () => {
      fireAppState("background")
    })

    // The session connects while the app is away.
    await update(renderer, true, true)

    // Now the window takes over.
    await act(async () => {
      getMiniPlayerStore().setPipHold(true)
    })

    expect(mockPlayer.play).not.toHaveBeenCalled()
    await act(async () => renderer.unmount())
  })
})
