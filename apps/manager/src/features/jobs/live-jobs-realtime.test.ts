import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  LiveJobsEventSourceLike,
  LiveJobsRealtimeStreamCallbacks,
  LiveJobsRealtimeStreamConnection,
} from "@/features/jobs/live-jobs-realtime"
import {
  createLiveJobDetailEventSourceOpener,
  createLiveJobDetailRealtimeController,
  createLiveJobsListEventSourceOpener,
  createLiveJobsListRealtimeController,
} from "@/features/jobs/live-jobs-realtime"
import type { JobRecord } from "@/types/job"

type CapturedStream<TSnapshot> = {
  callbacks: LiveJobsRealtimeStreamCallbacks<TSnapshot>
  close: ReturnType<typeof vi.fn>
}

function buildJobRecord(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    muxAssetId: "mux-1",
    muxPlaybackId: "playback-1",
    languages: [],
    options: {},
    status: "pending",
    retries: 0,
    createdAt: "2026-04-22T10:00:00.000Z",
    updatedAt: "2026-04-22T10:00:00.000Z",
    artifacts: {},
    steps: [],
    errors: [],
    ...overrides,
  }
}

function createOpenStreamMock<TSnapshot>() {
  const streams: CapturedStream<TSnapshot>[] = []
  const openStream = vi.fn(
    (
      callbacks: LiveJobsRealtimeStreamCallbacks<TSnapshot>,
    ): LiveJobsRealtimeStreamConnection => {
      const stream: CapturedStream<TSnapshot> = {
        callbacks,
        close: vi.fn(),
      }
      streams.push(stream)

      return {
        close: stream.close,
      }
    },
  )

  return {
    openStream,
    streams,
  }
}

function createEventSourceDouble(): LiveJobsEventSourceLike & {
  emit: (type: string, data?: unknown) => void
  close: ReturnType<typeof vi.fn>
} {
  const listeners = new Map<string, Array<(event: { data?: string }) => void>>()
  const close = vi.fn()

  return {
    addEventListener(type, listener) {
      const existing = listeners.get(type) ?? []
      existing.push(listener)
      listeners.set(type, existing)
    },
    close,
    emit(type, data) {
      for (const listener of listeners.get(type) ?? []) {
        listener({
          data:
            data === undefined
              ? undefined
              : typeof data === "string"
                ? data
                : JSON.stringify(data),
        })
      }
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("createLiveJobsListRealtimeController", () => {
  it("replaces stale initial jobs when a stream snapshot arrives", () => {
    const initialJobs = [
      buildJobRecord({
        id: "job-1",
        status: "pending",
        updatedAt: "2026-04-22T10:00:00.000Z",
      }),
    ]
    const streamedJobs = [
      buildJobRecord({
        id: "job-1",
        status: "running",
        updatedAt: "2026-04-22T10:05:00.000Z",
      }),
    ]
    const { openStream, streams } = createOpenStreamMock<JobRecord[]>()
    const poll = vi.fn(async () => streamedJobs)

    const controller = createLiveJobsListRealtimeController({
      initialJobs,
      openStream,
      poll,
    })

    controller.start()
    streams[0]?.callbacks.onOpen()
    streams[0]?.callbacks.onSnapshot(streamedJobs)

    expect(controller.getSnapshot()).toMatchObject({
      state: streamedJobs,
      transportMode: "live",
      lastSyncSource: "stream-snapshot",
      needsResync: false,
    })
  })

  it("updates existing entries and ignores stale upserts", () => {
    const currentJob = buildJobRecord({
      id: "job-1",
      status: "pending",
      updatedAt: "2026-04-22T10:05:00.000Z",
    })
    const newerJob = buildJobRecord({
      id: "job-1",
      status: "running",
      updatedAt: "2026-04-22T10:06:00.000Z",
    })
    const staleJob = buildJobRecord({
      id: "job-1",
      status: "completed",
      updatedAt: "2026-04-22T10:04:00.000Z",
    })
    const { openStream, streams } = createOpenStreamMock<JobRecord[]>()

    const controller = createLiveJobsListRealtimeController({
      initialJobs: [currentJob],
      openStream,
      poll: vi.fn(async () => [newerJob]),
    })

    controller.start()
    streams[0]?.callbacks.onOpen()
    streams[0]?.callbacks.onUpsert(newerJob)

    expect(controller.getSnapshot().state).toEqual([newerJob])

    streams[0]?.callbacks.onUpsert(staleJob)
    expect(controller.getSnapshot().state).toEqual([newerJob])
  })

  it("prepends unknown jobs, trims to the list window, and resyncs immediately", async () => {
    const initialJobs = Array.from({ length: 50 }, (_, index) =>
      buildJobRecord({
        id: `job-${index + 1}`,
        createdAt: `2026-04-22T${String(59 - index).padStart(2, "0")}:00:00.000Z`,
        updatedAt: `2026-04-22T${String(59 - index).padStart(2, "0")}:00:00.000Z`,
      }),
    )
    const pushedJob = buildJobRecord({
      id: "job-51",
      status: "running",
      createdAt: "2026-04-23T10:00:00.000Z",
      updatedAt: "2026-04-23T10:00:00.000Z",
    })
    const reconciledJobs = [pushedJob, ...initialJobs.slice(0, 49)]
    const { openStream, streams } = createOpenStreamMock<JobRecord[]>()
    const poll = vi.fn(async () => reconciledJobs)

    const controller = createLiveJobsListRealtimeController({
      initialJobs,
      openStream,
      poll,
      getPollDelayMs: () => 100,
    })

    controller.start()
    streams[0]?.callbacks.onOpen()
    streams[0]?.callbacks.onUpsert(pushedJob)

    expect(controller.getSnapshot().state).toHaveLength(50)
    expect(controller.getSnapshot().state[0]?.id).toBe("job-51")
    expect(controller.getSnapshot().needsResync).toBe(true)
    expect(poll).not.toHaveBeenCalled()

    await vi.runAllTimersAsync()

    expect(poll).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot()).toMatchObject({
      state: reconciledJobs,
      needsResync: false,
      lastSyncSource: "poll",
    })
  })

  it("switches into degraded polling mode after a stream error", async () => {
    const job = buildJobRecord({
      status: "running",
      updatedAt: "2026-04-22T10:01:00.000Z",
    })
    const { openStream, streams } = createOpenStreamMock<JobRecord[]>()
    const poll = vi.fn(async () => [job])

    const controller = createLiveJobsListRealtimeController({
      initialJobs: [job],
      openStream,
      poll,
      getPollDelayMs: () => 100,
      getReconnectDelayMs: () => 1_000,
    })

    controller.start()
    streams[0]?.callbacks.onOpen()
    streams[0]?.callbacks.onError()

    expect(controller.getSnapshot()).toMatchObject({
      transportMode: "polling",
      isReconnectPending: true,
      lastFailureReason: "stream-error",
      needsResync: true,
    })

    await vi.advanceTimersByTimeAsync(100)

    expect(poll).toHaveBeenCalledTimes(1)
  })

  it("clears degraded mode when the stream reconnects and schedules a reconciliation fetch", async () => {
    const initialJob = buildJobRecord({
      id: "job-1",
      status: "running",
      updatedAt: "2026-04-22T10:00:00.000Z",
    })
    const reconnectedJob = buildJobRecord({
      id: "job-1",
      status: "completed",
      updatedAt: "2026-04-22T10:05:00.000Z",
    })
    const { openStream, streams } = createOpenStreamMock<JobRecord[]>()
    const poll = vi.fn(async () => [reconnectedJob])

    const controller = createLiveJobsListRealtimeController({
      initialJobs: [initialJob],
      openStream,
      poll,
      getPollDelayMs: () => 100,
      getReconnectDelayMs: () => 20,
    })

    controller.start()
    streams[0]?.callbacks.onOpen()
    streams[0]?.callbacks.onError()

    expect(controller.getSnapshot().transportMode).toBe("polling")

    await vi.advanceTimersByTimeAsync(20)

    expect(openStream).toHaveBeenCalledTimes(2)
    streams[1]?.callbacks.onOpen()
    streams[1]?.callbacks.onSnapshot([reconnectedJob])

    expect(controller.getSnapshot()).toMatchObject({
      state: [reconnectedJob],
      transportMode: "live",
      isReconnectPending: false,
      lastFailureReason: null,
      needsResync: true,
      lastSyncSource: "stream-snapshot",
    })

    await vi.runAllTimersAsync()

    expect(controller.getSnapshot()).toMatchObject({
      state: [reconnectedJob],
      transportMode: "live",
      isReconnectPending: false,
      lastFailureReason: null,
      needsResync: false,
      lastSyncSource: "poll",
    })
    expect(poll).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(100)

    expect(poll).toHaveBeenCalledTimes(1)
  })
})

describe("EventSource openers", () => {
  it("parses list snapshot and upsert events", () => {
    const source = createEventSourceDouble()
    const createEventSource = vi.fn(() => source)
    const callbacks: LiveJobsRealtimeStreamCallbacks<JobRecord[]> = {
      onOpen: vi.fn(),
      onSnapshot: vi.fn(),
      onUpsert: vi.fn(),
      onError: vi.fn(),
      onClose: vi.fn(),
    }

    const openStream = createLiveJobsListEventSourceOpener({
      createEventSource,
    })
    const connection = openStream(callbacks)

    source.emit("open")
    source.emit("snapshot", {
      type: "snapshot",
      jobs: [buildJobRecord({ id: "job-1" })],
    })
    source.emit("job-upsert", {
      type: "job-upsert",
      job: buildJobRecord({ id: "job-2" }),
    })

    expect(createEventSource).toHaveBeenCalledWith("/api/jobs/events")
    expect(callbacks.onOpen).toHaveBeenCalledTimes(1)
    expect(callbacks.onSnapshot).toHaveBeenCalledWith([
      expect.objectContaining({ id: "job-1" }),
    ])
    expect(callbacks.onUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "job-2" }),
    )

    connection.close()
    expect(source.close).toHaveBeenCalledTimes(1)
  })

  it("reports stream errors when event payload parsing fails", () => {
    const source = createEventSourceDouble()
    const callbacks: LiveJobsRealtimeStreamCallbacks<JobRecord> = {
      onOpen: vi.fn(),
      onSnapshot: vi.fn(),
      onUpsert: vi.fn(),
      onError: vi.fn(),
      onClose: vi.fn(),
    }

    const openStream = createLiveJobDetailEventSourceOpener({
      jobId: "job with spaces",
      createEventSource: () => source,
    })

    openStream(callbacks)
    source.emit("snapshot", "{not-json")

    expect(callbacks.onError).toHaveBeenCalledTimes(1)
    expect(callbacks.onSnapshot).not.toHaveBeenCalled()
    expect(source.close).toHaveBeenCalledTimes(1)
  })
})

describe("createLiveJobDetailRealtimeController", () => {
  it("replaces stale initial detail state when a stream snapshot arrives", () => {
    const initialJob = buildJobRecord({
      id: "job-1",
      status: "pending",
      updatedAt: "2026-04-22T10:00:00.000Z",
    })
    const streamedJob = buildJobRecord({
      id: "job-1",
      status: "running",
      updatedAt: "2026-04-22T10:05:00.000Z",
    })
    const { openStream, streams } = createOpenStreamMock<JobRecord>()
    const poll = vi.fn(async () => streamedJob)

    const controller = createLiveJobDetailRealtimeController({
      initialJob,
      openStream,
      poll,
    })

    controller.start()
    streams[0]?.callbacks.onOpen()
    streams[0]?.callbacks.onSnapshot(streamedJob)

    expect(controller.getSnapshot()).toMatchObject({
      state: streamedJob,
      transportMode: "live",
      lastSyncSource: "stream-snapshot",
    })
  })

  it("preserves terminal-job polling throttling while allowing degraded-mode resume", async () => {
    const terminalJob = buildJobRecord({
      id: "job-1",
      status: "completed",
      updatedAt: "2026-04-22T10:10:00.000Z",
    })
    const runningJob = buildJobRecord({
      id: "job-1",
      status: "running",
      updatedAt: "2026-04-22T10:11:00.000Z",
    })
    const completedAgainJob = buildJobRecord({
      id: "job-1",
      status: "completed",
      updatedAt: "2026-04-22T10:12:00.000Z",
    })
    const { openStream, streams } = createOpenStreamMock<JobRecord>()
    const poll = vi.fn(async () => runningJob)

    const controller = createLiveJobDetailRealtimeController({
      initialJob: terminalJob,
      openStream,
      poll,
      getPollDelayMs: () => 100,
      getReconnectDelayMs: () => 1_000,
    })

    controller.start()
    streams[0]?.callbacks.onOpen()
    streams[0]?.callbacks.onError()

    expect(controller.getSnapshot()).toMatchObject({
      transportMode: "polling",
      isPollingPaused: true,
      isReconnectPending: true,
    })

    await vi.advanceTimersByTimeAsync(100)
    expect(poll).not.toHaveBeenCalled()

    controller.replaceState(runningJob)
    expect(controller.getSnapshot()).toMatchObject({
      transportMode: "polling",
      isPollingPaused: false,
      lastSyncSource: "external",
    })

    await vi.advanceTimersByTimeAsync(100)
    expect(poll).toHaveBeenCalledTimes(1)

    controller.replaceState(completedAgainJob)
    expect(controller.getSnapshot()).toMatchObject({
      transportMode: "polling",
      isPollingPaused: true,
    })

    await vi.advanceTimersByTimeAsync(100)
    expect(poll).toHaveBeenCalledTimes(1)
  })
})
