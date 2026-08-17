/**
 * Behavioral suite for useCastPlayback (deferred from U3 to U4): connect
 * timeout, slug-change and unmount end triggers, devicesAvailable, and the
 * remotePlayerState the U4 playback target derives isPlaying from.
 *
 * Rendered under <StrictMode> (element wrap doubles the effect cycle — the
 * repo's remount-safety discipline for hook-lifetime refs).
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
// datadog.ts touches the native Datadog SDK at import time under jest.
jest.mock("../../lib/datadog", () => ({
  capErrorMessage: (message: string) => message,
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
// Mounting the hook constructs a NativeEventEmitter via the SessionManager
// subscription; the mock captures the adapter's callbacks instead.
jest.mock("react-native-google-cast", () => ({
  CastState: {
    NO_DEVICES_AVAILABLE: "noDevicesAvailable",
    NOT_CONNECTED: "notConnected",
    CONNECTING: "connecting",
    CONNECTED: "connected",
  },
  MediaStreamType: { BUFFERED: "buffered" },
  useCastState: () => mockCastState,
  useCastSession: () => mockCastSession,
  useMediaStatus: () => mockMediaStatus,
  useStreamPosition: () => mockStreamPosition,
  CastContext: {
    getSessionManager: () => ({
      onSessionStarting: (cb: () => void) => {
        mockSessionCallbacks.starting = cb
        return { remove: () => {} }
      },
      onSessionStarted: (cb: () => void) => {
        mockSessionCallbacks.started = cb
        return { remove: () => {} }
      },
      onSessionStartFailed: (cb: (s: unknown, e: string) => void) => {
        mockSessionCallbacks.startFailed = cb
        return { remove: () => {} }
      },
      onSessionEnded: (cb: (s: unknown, e?: string) => void) => {
        mockSessionCallbacks.ended = cb
        return { remove: () => {} }
      },
      endCurrentSession: mockEndCurrentSession,
    }),
    showCastDialog: jest.fn(),
  },
}))

import { StrictMode, act, type ReactElement } from "react"

import { useCastPlayback, type CastPlayback } from "../useCastPlayback"
import { CAST_CONNECT_TIMEOUT_MS } from "../../lib/cast/castSessionReducer"
import { toMediaLoadRequest } from "../../lib/cast/castAdapter"
import type { CastMedia } from "../../lib/cast/castMediaResolver"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

const { datadogLog: mockDatadogLog } = jest.requireMock(
  "../../lib/datadog",
) as {
  datadogLog: { info: jest.Mock; warn: jest.Mock; error: jest.Mock }
}

type MockMediaStatus = {
  playerState?: string | null
  idleReason?: string | null
  mediaInfo?: { streamDuration?: number | null }
} | null

type MockClient = {
  loadMedia: jest.Mock
  play: jest.Mock
  pause: jest.Mock
  seek: jest.Mock
}

function makeClient(): MockClient {
  return {
    loadMedia: jest.fn(() => Promise.resolve()),
    play: jest.fn(() => Promise.resolve()),
    pause: jest.fn(() => Promise.resolve()),
    seek: jest.fn(() => Promise.resolve()),
  }
}

const MEDIA: CastMedia = {
  contentUrl: "https://stream.mux.com/abc.m3u8",
  contentType: "application/x-mpegURL",
  title: "JESUS",
  posterUrl: null,
  startPositionSeconds: 30,
}

let mockCastState: string | null = null
let mockCastSession: {
  getCastDevice: () => Promise<unknown>
  client?: MockClient
} | null = null
let mockMediaStatus: MockMediaStatus = null
let mockStreamPosition: number | null = null
const mockEndCurrentSession = jest.fn(() => Promise.resolve())
const mockSessionCallbacks: {
  starting?: () => void
  started?: () => void
  startFailed?: (s: unknown, e: string) => void
  ended?: (s: unknown, e?: string) => void
} = {}

let latest: CastPlayback

function Harness({ slug }: { slug: string | null }) {
  latest = useCastPlayback({ videoSlug: slug })
  return null
}

type UpdatableRenderer = TestInstance & { update(element: ReactElement): void }

async function render(slug: string | null): Promise<UpdatableRenderer> {
  let renderer!: UpdatableRenderer
  await act(async () => {
    renderer = TestRenderer.create(
      <StrictMode>
        <Harness slug={slug} />
      </StrictMode>,
    ) as UpdatableRenderer
  })
  return renderer
}

async function update(renderer: UpdatableRenderer, slug: string | null) {
  await act(async () => {
    renderer.update(
      <StrictMode>
        <Harness slug={slug} />
      </StrictMode>,
    )
  })
}

/** Drives the session to Connecting via the adapter's captured callback. */
async function startConnecting() {
  await act(async () => {
    mockSessionCallbacks.starting?.()
  })
}

/** Receiver confirms media: Connecting -> Active. */
async function confirmMedia(renderer: UpdatableRenderer, slug: string | null) {
  mockMediaStatus = {
    playerState: "playing",
    mediaInfo: { streamDuration: 120 },
  }
  await update(renderer, slug)
}

/** Receiver reaches the end of media: Active -> Finished. */
async function finishMedia(renderer: UpdatableRenderer, slug: string | null) {
  mockMediaStatus = { playerState: "idle", idleReason: "finished" }
  await update(renderer, slug)
}

beforeEach(() => {
  mockCastState = null
  mockCastSession = null
  mockMediaStatus = null
  mockStreamPosition = null
  mockEndCurrentSession.mockClear()
  mockEndCurrentSession.mockImplementation(() => Promise.resolve())
  mockDatadogLog.info.mockClear()
  mockDatadogLog.warn.mockClear()
  delete mockSessionCallbacks.starting
  delete mockSessionCallbacks.started
  delete mockSessionCallbacks.startFailed
  delete mockSessionCallbacks.ended
})

afterEach(() => {
  jest.useRealTimers()
})

describe("devicesAvailable (R2)", () => {
  it("is false with no cast state and with no devices", async () => {
    const renderer = await render("jesus")
    expect(latest.devicesAvailable).toBe(false)
    mockCastState = "noDevicesAvailable"
    await update(renderer, "jesus")
    expect(latest.devicesAvailable).toBe(false)
    await act(async () => renderer.unmount())
  })

  it("is true whenever the SDK reports a reachable receiver", async () => {
    mockCastState = "notConnected"
    const renderer = await render("jesus")
    expect(latest.devicesAvailable).toBe(true)
    mockCastState = "connected"
    await update(renderer, "jesus")
    expect(latest.devicesAvailable).toBe(true)
    await act(async () => renderer.unmount())
  })
})

describe("connect timeout (R13 unconditional release)", () => {
  it("fails a hanging connect after the budget", async () => {
    jest.useFakeTimers()
    const renderer = await render("jesus")
    await startConnecting()
    expect(latest.state.phase).toBe("connecting")
    await act(async () => {
      jest.advanceTimersByTime(CAST_CONNECT_TIMEOUT_MS)
    })
    expect(latest.state).toMatchObject({
      phase: "failed",
      reason: "connect_timeout",
    })
    await act(async () => renderer.unmount())
  })

  it("does not time out once the receiver confirmed media", async () => {
    jest.useFakeTimers()
    const renderer = await render("jesus")
    await startConnecting()
    await confirmMedia(renderer, "jesus")
    expect(latest.state.phase).toBe("active")
    await act(async () => {
      jest.advanceTimersByTime(CAST_CONNECT_TIMEOUT_MS)
    })
    expect(latest.state.phase).toBe("active")
    await act(async () => renderer.unmount())
  })
})

describe("remotePlayerState (U4 target input)", () => {
  it("exposes the receiver's raw player state", async () => {
    const renderer = await render("jesus")
    await startConnecting()
    await confirmMedia(renderer, "jesus")
    expect(latest.remotePlayerState).toBe("playing")
    mockMediaStatus = { playerState: "paused" }
    await update(renderer, "jesus")
    expect(latest.remotePlayerState).toBe("paused")
    await act(async () => renderer.unmount())
  })

  it("is null with no remote media", async () => {
    const renderer = await render("jesus")
    expect(latest.remotePlayerState).toBeNull()
    await act(async () => renderer.unmount())
  })
})

describe("end triggers (KTD7)", () => {
  it("ends the session when the video identity (decoded slug) changes", async () => {
    const renderer = await render("jesus")
    await startConnecting()
    await confirmMedia(renderer, "jesus")
    mockStreamPosition = 42
    await update(renderer, "jesus")
    await update(renderer, "magdalena")
    expect(mockEndCurrentSession).toHaveBeenCalledWith(true)
    expect(latest.state).toMatchObject({
      phase: "ended",
      trigger: "videoChanged",
      lastPositionSeconds: 42,
    })
    await act(async () => renderer.unmount())
  })

  it("keeps the session across re-renders with the same slug (dub switch)", async () => {
    // KTD7: a dub switch changes the source URL but not the video identity,
    // and the hook never sees URLs at all — only the decoded slug may end it.
    const renderer = await render("jesus")
    await startConnecting()
    await confirmMedia(renderer, "jesus")
    await update(renderer, "jesus")
    await update(renderer, "jesus")
    expect(mockEndCurrentSession).not.toHaveBeenCalled()
    expect(latest.state.phase).toBe("active")
    await act(async () => renderer.unmount())
  })

  it("ends the session on unmount (leaving the player screen)", async () => {
    const renderer = await render("jesus")
    await startConnecting()
    await confirmMedia(renderer, "jesus")
    await act(async () => renderer.unmount())
    expect(mockEndCurrentSession).toHaveBeenCalledWith(true)
  })

  it("ends a FINISHED session when the slug changes (Finished is live)", async () => {
    const renderer = await render("jesus")
    await startConnecting()
    await confirmMedia(renderer, "jesus")
    await finishMedia(renderer, "jesus")
    expect(latest.state.phase).toBe("finished")
    await update(renderer, "magdalena")
    expect(mockEndCurrentSession).toHaveBeenCalledWith(true)
    expect(latest.state).toMatchObject({
      phase: "ended",
      trigger: "videoChanged",
    })
    await act(async () => renderer.unmount())
  })

  it("ends a FINISHED session on unmount", async () => {
    const renderer = await render("jesus")
    await startConnecting()
    await confirmMedia(renderer, "jesus")
    await finishMedia(renderer, "jesus")
    await act(async () => renderer.unmount())
    expect(mockEndCurrentSession).toHaveBeenCalledWith(true)
  })

  it("logs a failed slug-change teardown instead of swallowing it", async () => {
    const renderer = await render("jesus")
    await startConnecting()
    await confirmMedia(renderer, "jesus")
    mockEndCurrentSession.mockImplementationOnce(() =>
      Promise.reject(new Error("end boom")),
    )
    await update(renderer, "magdalena")
    expect(mockDatadogLog.warn).toHaveBeenCalledWith(
      "cast.command_failed",
      expect.objectContaining({
        cast_command: "end_session",
        error_message: expect.stringContaining("end boom"),
      }),
    )
    await act(async () => renderer.unmount())
  })

  it("logs a failed unmount teardown instead of swallowing it", async () => {
    const renderer = await render("jesus")
    await startConnecting()
    await confirmMedia(renderer, "jesus")
    mockEndCurrentSession.mockImplementationOnce(() =>
      Promise.reject(new Error("end boom")),
    )
    await act(async () => renderer.unmount())
    expect(mockDatadogLog.warn).toHaveBeenCalledWith(
      "cast.command_failed",
      expect.objectContaining({
        cast_command: "end_session",
        error_message: expect.stringContaining("end boom"),
      }),
    )
  })

  it("does not end anything on unmount with no session (StrictMode-safe)", async () => {
    const renderer = await render("jesus")
    await act(async () => renderer.unmount())
    expect(mockEndCurrentSession).not.toHaveBeenCalled()
  })
})

describe("imperative glue (load / transport / end / reset)", () => {
  it("load() sends toMediaLoadRequest(media) to the SDK client", async () => {
    const client = makeClient()
    mockCastSession = { getCastDevice: () => Promise.resolve(null), client }
    const renderer = await render("jesus")
    await act(async () => latest.load(MEDIA))
    expect(client.loadMedia).toHaveBeenCalledWith(toMediaLoadRequest(MEDIA))
    await act(async () => renderer.unmount())
  })

  it("a rejected load fails the session as media_error (R13)", async () => {
    const client = makeClient()
    client.loadMedia.mockImplementation(() =>
      Promise.reject(new Error("load boom")),
    )
    mockCastSession = { getCastDevice: () => Promise.resolve(null), client }
    const renderer = await render("jesus")
    expect(latest.state.phase).toBe("connecting")
    await act(async () => latest.load(MEDIA))
    expect(latest.state).toMatchObject({
      phase: "failed",
      reason: "media_error",
    })
    expect(mockDatadogLog.warn).toHaveBeenCalledWith(
      "cast.load_failed",
      expect.objectContaining({
        error_message: expect.stringContaining("load boom"),
      }),
    )
    await act(async () => renderer.unmount())
  })

  it("play/pause/seekTo no-op without a client, call through with one", async () => {
    const renderer = await render("jesus")
    // Null client: nothing to call, nothing thrown.
    await act(async () => {
      latest.play()
      latest.pause()
      latest.seekTo(30)
    })
    const client = makeClient()
    mockCastSession = { getCastDevice: () => Promise.resolve(null), client }
    await update(renderer, "jesus")
    await act(async () => {
      latest.play()
      latest.pause()
      latest.seekTo(30)
    })
    expect(client.play).toHaveBeenCalledTimes(1)
    expect(client.pause).toHaveBeenCalledTimes(1)
    expect(client.seek).toHaveBeenCalledWith({ position: 30 })
    await act(async () => renderer.unmount())
  })

  it("end() dispatches userEnd and stops the SDK session", async () => {
    const renderer = await render("jesus")
    await startConnecting()
    await confirmMedia(renderer, "jesus")
    mockStreamPosition = 55
    await update(renderer, "jesus")
    await act(async () => latest.end())
    expect(latest.state).toMatchObject({
      phase: "ended",
      trigger: "userEnd",
      lastPositionSeconds: 55,
    })
    expect(mockEndCurrentSession).toHaveBeenCalledWith(true)
    await act(async () => renderer.unmount())
  })

  it("reset() returns a terminal state to Idle (U4 epilogue)", async () => {
    const renderer = await render("jesus")
    await startConnecting()
    await confirmMedia(renderer, "jesus")
    await act(async () => latest.end())
    expect(latest.state.phase).toBe("ended")
    await act(async () => latest.reset())
    expect(latest.state.phase).toBe("idle")
    await act(async () => renderer.unmount())
  })
})

describe("session callbacks (adapter -> reducer)", () => {
  it("a native session start lands in Connecting from Idle", async () => {
    // Native callbacks can outrun `connect`: onSessionStarted alone must
    // enter Connecting. The adapter passes deviceName null (castAdapter.ts).
    const renderer = await render("jesus")
    expect(latest.state.phase).toBe("idle")
    await act(async () => {
      mockSessionCallbacks.started?.()
    })
    expect(latest.state).toEqual({ phase: "connecting", deviceName: null })
    await act(async () => renderer.unmount())
  })

  it("a start failure fails as connect_error with a warn log", async () => {
    const renderer = await render("jesus")
    await startConnecting()
    await act(async () => {
      mockSessionCallbacks.startFailed?.({}, "boom")
    })
    expect(latest.state).toMatchObject({
      phase: "failed",
      reason: "connect_error",
    })
    expect(mockDatadogLog.warn).toHaveBeenCalledWith(
      "cast.session_start_failed",
      expect.objectContaining({ error_message: "boom" }),
    )
    await act(async () => renderer.unmount())
  })

  it("a graceful session end from Active ends as userEnd", async () => {
    const renderer = await render("jesus")
    await startConnecting()
    await confirmMedia(renderer, "jesus")
    mockStreamPosition = 44
    await update(renderer, "jesus")
    await act(async () => {
      mockSessionCallbacks.ended?.({}, undefined)
    })
    expect(latest.state).toMatchObject({
      phase: "ended",
      trigger: "userEnd",
      lastPositionSeconds: 44,
    })
    await act(async () => renderer.unmount())
  })

  it("a session end WITH an error from Active fails as device_drop", async () => {
    const renderer = await render("jesus")
    await startConnecting()
    await confirmMedia(renderer, "jesus")
    await act(async () => {
      mockSessionCallbacks.ended?.({}, "receiver dropped")
    })
    expect(latest.state).toMatchObject({
      phase: "failed",
      reason: "device_drop",
    })
    expect(mockDatadogLog.warn).toHaveBeenCalledWith(
      "cast.session_ended_with_error",
      expect.objectContaining({ error_message: "receiver dropped" }),
    )
    await act(async () => renderer.unmount())
  })

  it("mount into an existing session enters Connecting, then enriches the name", async () => {
    mockCastSession = {
      getCastDevice: () => Promise.resolve({ friendlyName: "Living Room" }),
    }
    const renderer = await render("jesus")
    expect(latest.state).toEqual({
      phase: "connecting",
      deviceName: "Living Room",
    })
    expect(latest.deviceName).toBe("Living Room")
    await act(async () => renderer.unmount())
  })

  it("a device-name resolution landing after unmount does not dispatch", async () => {
    let resolveDevice: (device: unknown) => void = () => {}
    mockCastSession = {
      getCastDevice: () =>
        new Promise((resolve) => {
          resolveDevice = resolve
        }),
    }
    const renderer = await render("jesus")
    expect(latest.state.phase).toBe("connecting")
    await act(async () => renderer.unmount())
    const stateChangeLogs = mockDatadogLog.info.mock.calls.length
    await act(async () => {
      resolveDevice({ friendlyName: "Living Room" })
    })
    // The cancelled guard swallows the late resolution: no throw, and no
    // post-unmount state-change log.
    expect(mockDatadogLog.info.mock.calls.length).toBe(stateChangeLogs)
  })
})
