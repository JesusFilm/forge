import { _resetStorageForTests, getStorage } from "../safeStorage"
import {
  MAX_QUEUED_EVENTS,
  MEANINGFUL_PROGRESS,
  MEANINGFUL_SECONDS,
  QUEUE_STORAGE_KEY,
  VIEWER_ID_STORAGE_KEY,
  appendCapped,
  buildQueuedWatchEvent,
  evaluateMeaningfulPlayback,
  flushWatchEventQueue,
  generateViewerId,
  getViewerId,
  initialMeaningfulState,
  parseQueue,
  queueMeaningfulWatchEvent,
  readWatchEventQueue,
  type QueuedWatchEvent,
} from "./watchEvents"

// getStorage() warns once per reset when AsyncStorage isn't linked (always,
// under jest). Silence it so the reset-per-test doesn't drown the run.
beforeAll(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {})
})

beforeEach(() => {
  _resetStorageForTests()
})

const IDENTITY = { videoId: "video-1", videoDubId: "dub-1" }
const SNAPSHOT = { positionSeconds: 45, durationSeconds: 300 }

function makeEvent(
  overrides: Partial<QueuedWatchEvent> = {},
): QueuedWatchEvent {
  return {
    videoId: "video-1",
    videoDubId: "dub-1",
    positionSeconds: 45,
    durationSeconds: 300,
    progress: 0.15,
    requestSessionId: "viewer-1",
    queuedAt: "2026-08-04T00:00:00.000Z",
    ...overrides,
  }
}

describe("evaluateMeaningfulPlayback", () => {
  it("does not record below both thresholds", () => {
    const { state, record } = evaluateMeaningfulPlayback(
      initialMeaningfulState,
      MEANINGFUL_SECONDS - 1,
      3600,
    )
    expect(record).toBe(false)
    expect(state.recorded).toBe(false)
  })

  it("records once when the seconds threshold crosses", () => {
    const first = evaluateMeaningfulPlayback(
      initialMeaningfulState,
      MEANINGFUL_SECONDS,
      3600,
    )
    expect(first.record).toBe(true)

    const second = evaluateMeaningfulPlayback(first.state, 600, 3600)
    expect(second.record).toBe(false)
  })

  it("records via the progress threshold on short videos", () => {
    // 10s video: 25% = 2.5s, well under the 30s time threshold.
    const { record } = evaluateMeaningfulPlayback(
      initialMeaningfulState,
      10 * MEANINGFUL_PROGRESS,
      10,
    )
    expect(record).toBe(true)
  })

  it("ignores the progress threshold when duration is unknown or zero", () => {
    expect(
      evaluateMeaningfulPlayback(initialMeaningfulState, 29, null).record,
    ).toBe(false)
    expect(
      evaluateMeaningfulPlayback(initialMeaningfulState, 29, 0).record,
    ).toBe(false)
  })
})

describe("buildQueuedWatchEvent", () => {
  it("computes progress from position and duration", () => {
    const event = buildQueuedWatchEvent(IDENTITY, SNAPSHOT, "viewer-1", "t0")
    expect(event.progress).toBeCloseTo(45 / 300)
    expect(event.videoId).toBe("video-1")
    expect(event.videoDubId).toBe("dub-1")
    expect(event.requestSessionId).toBe("viewer-1")
    expect(event.queuedAt).toBe("t0")
  })

  it("nulls duration-derived fields for zero/invalid durations", () => {
    const event = buildQueuedWatchEvent(
      IDENTITY,
      { positionSeconds: 45, durationSeconds: 0 },
      "viewer-1",
      "t0",
    )
    expect(event.durationSeconds).toBeNull()
    expect(event.progress).toBeNull()
    expect(event.positionSeconds).toBe(45)
  })
})

describe("appendCapped", () => {
  it("keeps the newest events at the cap", () => {
    let queue: QueuedWatchEvent[] = []
    for (let i = 0; i < MAX_QUEUED_EVENTS + 3; i++) {
      queue = appendCapped(queue, makeEvent({ queuedAt: `t${i}` }))
    }
    expect(queue).toHaveLength(MAX_QUEUED_EVENTS)
    expect(queue[0]!.queuedAt).toBe("t3")
    expect(queue[queue.length - 1]!.queuedAt).toBe(`t${MAX_QUEUED_EVENTS + 2}`)
  })
})

describe("parseQueue", () => {
  it("returns [] for null, malformed JSON, and non-arrays", () => {
    expect(parseQueue(null)).toEqual([])
    expect(parseQueue("{not json")).toEqual([])
    expect(parseQueue('{"a":1}')).toEqual([])
  })

  it("filters entries missing required fields", () => {
    const raw = JSON.stringify([
      makeEvent(),
      { videoId: 42 },
      "junk",
      null,
      makeEvent({ queuedAt: "t9" }),
    ])
    const parsed = parseQueue(raw)
    expect(parsed).toHaveLength(2)
    expect(parsed[1]!.queuedAt).toBe("t9")
  })
})

describe("generateViewerId", () => {
  it("produces a UUID-v4-shaped id", () => {
    expect(generateViewerId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})

describe("getViewerId", () => {
  it("mints once and persists", async () => {
    const first = await getViewerId()
    const second = await getViewerId()
    expect(second).toBe(first)
    expect(await getStorage().getItem(VIEWER_ID_STORAGE_KEY)).toBe(first)
  })
})

describe("queueMeaningfulWatchEvent", () => {
  it("appends an event with the persistent viewer id", async () => {
    await queueMeaningfulWatchEvent(IDENTITY, SNAPSHOT)
    const queue = await readWatchEventQueue()
    expect(queue).toHaveLength(1)
    expect(queue[0]!.videoId).toBe("video-1")
    expect(queue[0]!.requestSessionId).toBe(await getViewerId())
    expect(queue[0]!.progress).toBeCloseTo(45 / 300)
  })

  it("enforces the queue cap across writes", async () => {
    for (let i = 0; i < MAX_QUEUED_EVENTS + 2; i++) {
      await queueMeaningfulWatchEvent(
        { videoId: `video-${i}`, videoDubId: null },
        SNAPSHOT,
      )
    }
    const queue = await readWatchEventQueue()
    expect(queue).toHaveLength(MAX_QUEUED_EVENTS)
    expect(queue[0]!.videoId).toBe("video-2")
  })
})

describe("flushWatchEventQueue", () => {
  it("no-ops on an empty queue", async () => {
    const submit = jest.fn()
    expect(await flushWatchEventQueue(submit)).toEqual({
      submitted: 0,
      retained: 0,
    })
    expect(submit).not.toHaveBeenCalled()
  })

  it("drains submitted events and clears storage", async () => {
    await queueMeaningfulWatchEvent(IDENTITY, SNAPSHOT)
    await queueMeaningfulWatchEvent(IDENTITY, SNAPSHOT)
    const result = await flushWatchEventQueue(async () => true)
    expect(result).toEqual({ submitted: 2, retained: 0 })
    expect(await readWatchEventQueue()).toEqual([])
    expect(await getStorage().getItem(QUEUE_STORAGE_KEY)).toBeNull()
  })

  it("retains events whose submit rejects or declines", async () => {
    await queueMeaningfulWatchEvent(
      { videoId: "ok", videoDubId: null },
      SNAPSHOT,
    )
    await queueMeaningfulWatchEvent(
      { videoId: "declined", videoDubId: null },
      SNAPSHOT,
    )
    await queueMeaningfulWatchEvent(
      { videoId: "throws", videoDubId: null },
      SNAPSHOT,
    )
    const result = await flushWatchEventQueue(async (event) => {
      if (event.videoId === "throws") throw new Error("network")
      return event.videoId === "ok"
    })
    expect(result).toEqual({ submitted: 1, retained: 2 })
    const remaining = await readWatchEventQueue()
    expect(remaining.map((e) => e.videoId)).toEqual(["declined", "throws"])
  })
})
