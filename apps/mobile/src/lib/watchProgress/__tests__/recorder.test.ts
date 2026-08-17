import { createProgressRecorder, type RecorderDeps } from "../recorder"
import {
  bufferProgressIntent,
  peekProgressIntents,
  resetToSignedOut,
  applyLocalProgress,
  hydrateProgress,
  getProgressEntry,
  drainProgressIntents,
} from "../store"
import { createProgressSync } from "../sync"

const START = Date.parse("2026-08-04T00:00:00.000Z")

function buildDeps(overrides: Partial<RecorderDeps> = {}) {
  const buffered: unknown[] = []
  const drains: Array<{ forced: boolean }> = []
  const deps: RecorderDeps = {
    getAccountId: () => "user-1",
    bufferIntent: (intent) => buffered.push(intent),
    requestDrain: (options) => drains.push(options),
    applyLocal: () => {},
    now: () => START,
    ...overrides,
  }
  return { deps, buffered, drains }
}

describe("createProgressRecorder", () => {
  it("samples the 1s tick stream at 2s granularity", () => {
    let time = START
    const { deps, buffered } = buildDeps({ now: () => time })
    const recorder = createProgressRecorder(
      { videoId: "video-1", languageSlug: "english" },
      deps,
    )

    for (let second = 0; second < 10; second += 1) {
      time = START + second * 1_000
      recorder.onTick(second, 100)
    }

    // 10 seconds of 1s ticks → 5 two-second samples.
    expect(buffered).toHaveLength(5)
  })

  it("signed-out ticks produce zero intents (R10)", () => {
    const { deps, buffered, drains } = buildDeps({
      getAccountId: () => null,
    })
    const recorder = createProgressRecorder({ videoId: "video-1" }, deps)

    recorder.onTick(10, 100)
    recorder.flush("pause")

    expect(buffered).toEqual([])
    // The drain request itself is harmless but must carry no intents; the
    // recorder still emits it only for real samples — none here.
    expect(drains.filter((d) => !d.forced)).toEqual([])
  })

  it("a tick with no identity is a structural no-op (hero surfaces)", () => {
    const { deps, buffered, drains } = buildDeps()
    const recorder = createProgressRecorder(null, deps)

    recorder.onTick(10, 100)
    recorder.flush("unmount")

    expect(buffered).toEqual([])
    expect(drains).toEqual([])
  })

  it("pause/background/unmount/foreground force an immediate drain with the latest position", () => {
    for (const trigger of [
      "pause",
      "background",
      "unmount",
      "foreground",
    ] as const) {
      const { deps, buffered, drains } = buildDeps()
      const recorder = createProgressRecorder({ videoId: "video-1" }, deps)

      recorder.onTick(41, 100)
      recorder.flush(trigger)

      expect(drains.at(-1)).toEqual({ forced: true })
      expect(
        (buffered.at(-1) as { positionSeconds: number }).positionSeconds,
      ).toBe(41)
    }
  })

  it("flush writes nothing until at least one tick has landed (U5 pin)", () => {
    // The cast feed relies on this: a forced flush that beats the first
    // position report must not fabricate a write.
    const { deps, buffered, drains } = buildDeps()
    const recorder = createProgressRecorder({ videoId: "video-1" }, deps)

    recorder.flush("pause")
    recorder.flush("end")

    expect(buffered).toEqual([])
    expect(drains).toEqual([])
  })

  it("a signed-out foreground reconcile never arms the sign-in prompt", () => {
    // U5: the cast foreground reconcile is a forced write, not a playback
    // stop — R17's prompt moment is a stop.
    const onSignedOutStop = jest.fn()
    const { deps } = buildDeps({
      getAccountId: () => null,
      onSignedOutStop,
    })
    const recorder = createProgressRecorder({ videoId: "video-1" }, deps)

    recorder.onTick(60, 100)
    recorder.flush("foreground")
    expect(onSignedOutStop).not.toHaveBeenCalled()

    // Control: a real stop still arms it.
    recorder.flush("pause")
    expect(onSignedOutStop).toHaveBeenCalledWith(60)
  })

  it("playback end records the completed range", () => {
    const { deps, buffered } = buildDeps()
    const recorder = createProgressRecorder({ videoId: "video-1" }, deps)

    recorder.onTick(97, 100)
    recorder.flush("end")

    expect(buffered.at(-1)).toMatchObject({
      positionSeconds: 100,
      durationSeconds: 100,
    })
  })

  it("a slug-only identity records a slug-keyed intent with its timestamp", () => {
    // Downloaded playback has no admin video id on device (KTD8), so the
    // slug is the key admin resolves server-side. It takes the same path as
    // every other write; the queue is now reached only on send failure.
    const { deps, buffered } = buildDeps()
    const recorder = createProgressRecorder(
      { videoSlug: "birth-of-jesus" },
      deps,
    )

    recorder.onTick(30, 100)

    expect(buffered).toEqual([
      expect.objectContaining({
        videoSlug: "birth-of-jesus",
        videoId: undefined,
        positionSeconds: 30,
        recordedAt: new Date(START).toISOString(),
      }),
    ])
  })

  it("echoes id-keyed samples into the local store for instant bars", () => {
    const applyLocal = jest.fn()
    const { deps } = buildDeps({ applyLocal })
    const recorder = createProgressRecorder(
      { videoId: "video-1", languageSlug: "english" },
      deps,
    )

    recorder.onTick(95, 100)

    expect(applyLocal).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        videoId: "video-1",
        positionSeconds: 95,
        completed: true,
      }),
    )
  })
})

describe("recorder + store + sync integration (the rate-limit property)", () => {
  beforeEach(() => {
    resetToSignedOut()
  })

  it("two minutes of playback produces at most four sends, not sixty", async () => {
    let time = START
    const sendUpserts = jest.fn(async () => ({ acceptedCount: 1 }))
    const sync = createProgressSync({
      getAccountId: () => "user-1",
      fetchEntries: async () => [],
      sendUpserts,
      storage: {
        getItem: async () => null,
        setItem: async () => {},
        removeItem: async () => {},
      },
      now: () => time,
    })
    hydrateProgress({ accountId: "user-1", entries: [] })
    const pendingDrains: Array<Promise<void>> = []
    const recorder = createProgressRecorder(
      { videoId: "video-1" },
      {
        getAccountId: () => "user-1",
        bufferIntent: bufferProgressIntent,
        requestDrain: (options) => {
          pendingDrains.push(sync.drainIntents(options))
        },
        applyLocal: applyLocalProgress,
        now: () => time,
      },
    )

    for (let second = 0; second < 120; second += 1) {
      time = START + second * 1_000
      recorder.onTick(second, 600)
      // Let each drain settle in order, as the runtime would.

      await Promise.all(pendingDrains.splice(0))
    }

    expect(sendUpserts).toHaveBeenCalledTimes(4)
    // Each send carries the single deduped newest intent for the video.
    for (const call of sendUpserts.mock.calls as unknown as Array<
      [Array<{ videoId: string }>]
    >) {
      expect(call[0]).toHaveLength(1)
    }
    expect(getProgressEntry("video-1")).toBeDefined()
    expect(peekProgressIntents().length).toBeLessThanOrEqual(1)
    drainProgressIntents()
  })
})
