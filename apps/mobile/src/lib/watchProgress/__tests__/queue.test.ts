import {
  WATCH_PROGRESS_QUEUE_MAX_WRITES,
  enqueueProgressWrite,
  parseStoredProgressQueue,
  planQueueFlush,
  serializeProgressQueue,
  type ProgressQueue,
} from "../queue"
import type { ProgressWriteIntent } from "../store"

function write(
  overrides: Partial<ProgressWriteIntent> = {},
): ProgressWriteIntent {
  return {
    videoId: "video-1",
    languageSlug: null,
    positionSeconds: 30,
    durationSeconds: 100,
    recordedAt: "2026-08-04T00:00:00.000Z",
    ...overrides,
  }
}

describe("enqueueProgressWrite", () => {
  it("dedupes same-video writes keeping the newest recording", () => {
    let queue = enqueueProgressWrite(null, "user-1", write())
    queue = enqueueProgressWrite(
      queue,
      "user-1",
      write({ positionSeconds: 55, recordedAt: "2026-08-04T00:00:10.000Z" }),
    )

    expect(queue.writes).toHaveLength(1)
    expect(queue.writes[0]?.positionSeconds).toBe(55)
  })

  it("keeps the stored write when an older recording arrives late", () => {
    let queue = enqueueProgressWrite(
      null,
      "user-1",
      write({ positionSeconds: 55, recordedAt: "2026-08-04T00:00:10.000Z" }),
    )
    queue = enqueueProgressWrite(
      queue,
      "user-1",
      write({ positionSeconds: 10, recordedAt: "2026-08-04T00:00:01.000Z" }),
    )

    expect(queue.writes[0]?.positionSeconds).toBe(55)
  })

  it("binds the queue to the recording account — a different account replaces it", () => {
    let queue = enqueueProgressWrite(null, "user-1", write())
    queue = enqueueProgressWrite(queue, "user-2", write({ videoId: "video-9" }))

    expect(queue.accountId).toBe("user-2")
    expect(queue.writes.map((entry) => entry.videoId)).toEqual(["video-9"])
  })

  it("keeps slug-keyed offline writes with their recording timestamp intact", () => {
    const queue = enqueueProgressWrite(
      null,
      "user-1",
      write({
        videoId: undefined,
        videoSlug: "birth-of-jesus",
        recordedAt: "2026-08-04T00:02:00.000Z",
      }),
    )
    const roundTripped = parseStoredProgressQueue(serializeProgressQueue(queue))

    expect(roundTripped?.writes[0]?.videoSlug).toBe("birth-of-jesus")
    expect(roundTripped?.writes[0]?.recordedAt).toBe("2026-08-04T00:02:00.000Z")
  })

  it("drops the oldest writes past the per-batch ceiling", () => {
    let queue: ProgressQueue | null = null
    for (let index = 0; index <= WATCH_PROGRESS_QUEUE_MAX_WRITES; index += 1) {
      queue = enqueueProgressWrite(
        queue,
        "user-1",
        write({
          videoId: `video-${index}`,
          recordedAt: `2026-08-04T00:${String(Math.floor(index / 60)).padStart(
            2,
            "0",
          )}:${String(index % 60).padStart(2, "0")}.000Z`,
        }),
      )
    }

    expect(queue?.writes).toHaveLength(WATCH_PROGRESS_QUEUE_MAX_WRITES)
    expect(queue?.writes.some((entry) => entry.videoId === "video-0")).toBe(
      false,
    )
  })
})

describe("planQueueFlush", () => {
  it("flushes when the queue's account is the signed-in account", () => {
    const queue = enqueueProgressWrite(null, "user-1", write())
    const decision = planQueueFlush(queue, "user-1")

    expect(decision).toEqual({ action: "flush", writes: queue.writes })
  })

  it("discards on account mismatch (R7)", () => {
    const queue = enqueueProgressWrite(null, "user-1", write())
    expect(planQueueFlush(queue, "user-2")).toEqual({ action: "discard" })
  })

  it("discards when signed out at flush time (R10)", () => {
    const queue = enqueueProgressWrite(null, "user-1", write())
    expect(planQueueFlush(queue, null)).toEqual({ action: "discard" })
  })

  it("does nothing for an empty or missing queue", () => {
    expect(planQueueFlush(null, "user-1")).toEqual({ action: "none" })
    expect(
      planQueueFlush({ accountId: "user-1", writes: [] }, "user-1"),
    ).toEqual({ action: "none" })
  })
})

describe("queue persistence", () => {
  it("round-trips through serialize/parse", () => {
    const queue = enqueueProgressWrite(null, "user-1", write())
    expect(parseStoredProgressQueue(serializeProgressQueue(queue))).toEqual(
      queue,
    )
  })

  it("degrades corrupt or drifted blobs to null", () => {
    expect(parseStoredProgressQueue("{oops")).toBeNull()
    expect(parseStoredProgressQueue(null)).toBeNull()
    expect(
      parseStoredProgressQueue(
        JSON.stringify({ version: 99, accountId: "user-1", writes: [] }),
      ),
    ).toBeNull()
    expect(
      parseStoredProgressQueue(
        JSON.stringify({
          version: 1,
          accountId: "user-1",
          writes: [{ nonsense: true }],
        }),
      ),
    ).toBeNull()
  })
})
