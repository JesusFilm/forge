/**
 * U5 (KTD6/R11/AE2): the screen-side driver that turns cast session state
 * and ~1s receiver position reports into progressFeed calls — raw ticks
 * while active, a load-time tick, terminal flushes, and the foreground
 * reconcile. The recorder's own semantics (sampling, R10) live behind the
 * feed and are tested with it.
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

import { StrictMode, act, type ReactElement } from "react"
import { AppState, type AppStateStatus } from "react-native"

import { useCastProgressRecording } from "../useCastProgressRecording"
import type { ProgressFeed } from "../useManagedVideoPlayer"
import type {
  CastEndTrigger,
  CastFailureReason,
  CastSessionState,
} from "../../lib/cast/castSessionReducer"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../../src/test-utils/rnTestRenderer"

const feed: { onTick: jest.Mock; flush: jest.Mock } = {
  onTick: jest.fn(),
  flush: jest.fn(),
}
const feedRef: { current: ProgressFeed | null } = { current: feed }
let loadStart: number | null = null

const appStateListeners = new Set<(state: AppStateStatus) => void>()
function fireAppState(state: AppStateStatus) {
  for (const listener of [...appStateListeners]) listener(state)
}

const idle: CastSessionState = { phase: "idle" }
const connecting: CastSessionState = { phase: "connecting", deviceName: "TV" }
const active: CastSessionState = { phase: "active", deviceName: "TV" }
const finished: CastSessionState = { phase: "finished", deviceName: "TV" }
const failed = (reason: CastFailureReason): CastSessionState => ({
  phase: "failed",
  reason,
  deviceName: "TV",
})
const ended = (
  trigger: CastEndTrigger,
  lastPositionSeconds: number | null,
): CastSessionState => ({
  phase: "ended",
  trigger,
  deviceName: "TV",
  lastPositionSeconds,
})

type HarnessProps = {
  state: CastSessionState
  position: number | null
  duration: number | null
}

function Harness({ state, position, duration }: HarnessProps) {
  useCastProgressRecording({
    state,
    position,
    duration,
    feedRef,
    getLoadStartPosition: () => loadStart,
  })
  return null
}

type UpdatableRenderer = TestInstance & { update(element: ReactElement): void }

async function render(props: HarnessProps): Promise<UpdatableRenderer> {
  let renderer!: UpdatableRenderer
  await act(async () => {
    renderer = TestRenderer.create(
      <StrictMode>
        <Harness {...props} />
      </StrictMode>,
    ) as UpdatableRenderer
  })
  return renderer
}

async function update(renderer: UpdatableRenderer, props: HarnessProps) {
  await act(async () => {
    renderer.update(
      <StrictMode>
        <Harness {...props} />
      </StrictMode>,
    )
  })
}

async function unmount(renderer: UpdatableRenderer) {
  await act(async () => renderer.unmount())
}

beforeEach(() => {
  loadStart = null
  feedRef.current = feed
  jest.clearAllMocks()
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
})

describe("remote position ticks (R11)", () => {
  it("feeds each remote position report as a raw tick while active", async () => {
    const renderer = await render({
      state: connecting,
      position: null,
      duration: null,
    })
    await update(renderer, { state: active, position: 100, duration: 600 })
    await update(renderer, { state: active, position: 101, duration: 600 })

    expect(feed.onTick).toHaveBeenCalledWith(100, 600)
    expect(feed.onTick).toHaveBeenCalledWith(101, 600)
    expect(feed.flush).not.toHaveBeenCalled()
    await unmount(renderer)
  })

  it("does not tick without a reported duration", async () => {
    const renderer = await render({
      state: connecting,
      position: null,
      duration: null,
    })
    await update(renderer, { state: active, position: 100, duration: null })

    expect(feed.onTick).not.toHaveBeenCalled()
    await unmount(renderer)
  })
})

describe("load-time tick (AE2's guarantee)", () => {
  it("ticks once at the load start position when media loads before any report", async () => {
    loadStart = 250
    const renderer = await render({
      state: connecting,
      position: null,
      duration: null,
    })
    await update(renderer, { state: active, position: null, duration: 3600 })

    expect(feed.onTick).toHaveBeenCalledTimes(1)
    expect(feed.onTick).toHaveBeenCalledWith(250, 3600)
    await unmount(renderer)
  })

  it("skips the load tick until the receiver reports a duration", async () => {
    const renderer = await render({
      state: connecting,
      position: null,
      duration: null,
    })
    await update(renderer, { state: active, position: null, duration: null })
    expect(feed.onTick).not.toHaveBeenCalled()

    // The first full report covers it ~1s later.
    await update(renderer, { state: active, position: 5, duration: 600 })
    expect(feed.onTick).toHaveBeenCalledWith(5, 600)
    await unmount(renderer)
  })
})

describe("terminal flushes (KTD6)", () => {
  async function playedSession(position = 500, duration = 600) {
    const renderer = await render({
      state: connecting,
      position: null,
      duration: null,
    })
    await update(renderer, { state: active, position, duration })
    feed.onTick.mockClear()
    feed.flush.mockClear()
    return renderer
  }

  it("finished forces the end flush at full duration (AE2)", async () => {
    const renderer = await playedSession(500, 600)
    await update(renderer, { state: finished, position: null, duration: null })

    expect(feed.onTick).toHaveBeenCalledWith(600, 600)
    expect(feed.flush).toHaveBeenCalledWith("end")
    await unmount(renderer)
  })

  it("finished with no remote sample still flushes 'end' (recorder decides)", async () => {
    const renderer = await render({
      state: connecting,
      position: null,
      duration: null,
    })
    await update(renderer, { state: active, position: null, duration: null })
    await update(renderer, { state: finished, position: null, duration: null })

    expect(feed.onTick).not.toHaveBeenCalled()
    expect(feed.flush).toHaveBeenCalledWith("end")
    await unmount(renderer)
  })

  it("userEnd disconnect ticks the reducer's last position, then flushes", async () => {
    const renderer = await playedSession(500, 600)
    await update(renderer, {
      state: ended("userEnd", 510),
      position: null,
      duration: null,
    })

    expect(feed.onTick).toHaveBeenCalledWith(510, 600)
    expect(feed.flush).toHaveBeenCalledWith("pause")
    await unmount(renderer)
  })

  it("userEnd with a null reducer position falls back to the last report", async () => {
    const renderer = await playedSession(500, 600)
    await update(renderer, {
      state: ended("userEnd", null),
      position: null,
      duration: null,
    })

    expect(feed.onTick).toHaveBeenCalledWith(500, 600)
    expect(feed.flush).toHaveBeenCalledWith("pause")
    await unmount(renderer)
  })

  it("videoChanged/unmount ends do NOT flush through the feed", async () => {
    // The recorder's own re-key/unmount flush owns those triggers — by then
    // the feed can point at the NEXT video's recorder (KTD7).
    for (const trigger of ["videoChanged", "unmount"] as const) {
      const renderer = await playedSession(500, 600)
      await update(renderer, {
        state: ended(trigger, 510),
        position: null,
        duration: null,
      })

      expect(feed.onTick).not.toHaveBeenCalled()
      expect(feed.flush).not.toHaveBeenCalled()
      await unmount(renderer)
    }
  })

  it("a device drop flushes at the last remote position", async () => {
    const renderer = await playedSession(500, 600)
    await update(renderer, {
      state: failed("device_drop"),
      position: null,
      duration: null,
    })

    expect(feed.onTick).toHaveBeenCalledWith(500, 600)
    expect(feed.flush).toHaveBeenCalledWith("pause")
    await unmount(renderer)
  })

  it("a failed connect with no remote media flushes nothing", async () => {
    const renderer = await render({
      state: connecting,
      position: null,
      duration: null,
    })
    await update(renderer, {
      state: failed("connect_timeout"),
      position: null,
      duration: null,
    })

    expect(feed.onTick).not.toHaveBeenCalled()
    expect(feed.flush).not.toHaveBeenCalled()
    await unmount(renderer)
  })

  it("a new session does not inherit the previous session's sample", async () => {
    const renderer = await playedSession(500, 600)
    await update(renderer, {
      state: ended("userEnd", 510),
      position: null,
      duration: null,
    })
    feed.onTick.mockClear()
    feed.flush.mockClear()

    // Next session: connecting clears the sample, so a drop with no new
    // report has nothing cast-side to save.
    await update(renderer, {
      state: connecting,
      position: null,
      duration: null,
    })
    await update(renderer, { state: active, position: null, duration: null })
    await update(renderer, {
      state: failed("device_drop"),
      position: null,
      duration: null,
    })

    expect(feed.onTick).not.toHaveBeenCalled()
    expect(feed.flush).not.toHaveBeenCalled()
    await unmount(renderer)
  })
})

describe("foreground reconcile (KTD6 limit)", () => {
  it("the first fresh report after foregrounding ticks and flushes", async () => {
    const renderer = await render({
      state: connecting,
      position: null,
      duration: null,
    })
    await update(renderer, { state: active, position: 500, duration: 600 })
    expect(feed.flush).not.toHaveBeenCalled()

    await act(async () => fireAppState("background"))
    await act(async () => fireAppState("active"))
    await update(renderer, { state: active, position: 520, duration: 600 })

    expect(feed.onTick).toHaveBeenCalledWith(520, 600)
    expect(feed.flush).toHaveBeenCalledTimes(1)
    expect(feed.flush).toHaveBeenCalledWith("foreground")

    // One-shot: the next report is a plain tick again.
    await update(renderer, { state: active, position: 521, duration: 600 })
    expect(feed.flush).toHaveBeenCalledTimes(1)
    await unmount(renderer)
  })

  it("no reconcile flush without live remote media", async () => {
    const renderer = await render({
      state: idle,
      position: null,
      duration: null,
    })
    await act(async () => fireAppState("active"))
    await update(renderer, {
      state: connecting,
      position: null,
      duration: null,
    })
    await update(renderer, { state: active, position: 10, duration: 600 })

    expect(feed.flush).not.toHaveBeenCalled()
    await unmount(renderer)
  })
})
