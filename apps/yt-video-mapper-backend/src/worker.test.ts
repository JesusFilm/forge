import { afterEach, describe, expect, it, vi } from "vitest"
import type {
  MatchJobRecord,
  MatchJobService,
} from "./services/match-job.service.js"
import { startMatchJobWorker } from "./worker.js"

const job = {
  id: "job-1",
  status: "running",
  resultLimit: 3,
  queuedAt: new Date("2026-06-08T00:00:00.000Z"),
} satisfies MatchJobRecord

describe("startMatchJobWorker", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("processes available jobs immediately and polls after the queue is empty", async () => {
    vi.useFakeTimers()
    const service = new StubMatchJobService([job, null, null])
    const worker = startMatchJobWorker(service.asService(), {
      pollIntervalMs: 50,
      logger: silentLogger(),
    })

    await vi.runOnlyPendingTimersAsync()
    expect(service.calls).toBe(1)

    await vi.runOnlyPendingTimersAsync()
    expect(service.calls).toBe(2)

    await vi.advanceTimersByTimeAsync(49)
    expect(service.calls).toBe(2)

    await vi.advanceTimersByTimeAsync(1)
    expect(service.calls).toBe(3)

    worker.stop()
  })

  it("keeps polling when a drain attempt throws", async () => {
    vi.useFakeTimers()
    const logger = silentLogger()
    const service = new StubMatchJobService([
      new Error("database unavailable"),
      null,
    ])
    const worker = startMatchJobWorker(service.asService(), {
      pollIntervalMs: 25,
      logger,
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(service.calls).toBe(1)
    expect(logger.error).toHaveBeenCalledWith(
      '[yt-video-mapper-worker] event=worker_error error="database unavailable"',
    )

    await vi.advanceTimersByTimeAsync(25)
    expect(service.calls).toBe(2)

    worker.stop()
  })

  it("does not schedule more polling when stopped during a drain attempt", async () => {
    vi.useFakeTimers()
    let resolveJob: (job: MatchJobRecord | null) => void = () => {}
    const service = {
      calls: 0,
      async processNextJob() {
        this.calls += 1
        return new Promise<MatchJobRecord | null>((resolve) => {
          resolveJob = resolve
        })
      },
    }
    const worker = startMatchJobWorker(service as unknown as MatchJobService, {
      pollIntervalMs: 25,
      logger: silentLogger(),
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(service.calls).toBe(1)

    worker.stop()
    resolveJob(null)
    await vi.advanceTimersByTimeAsync(25)

    expect(service.calls).toBe(1)
  })
})

class StubMatchJobService {
  calls = 0

  constructor(
    private readonly outcomes: Array<MatchJobRecord | Error | null>,
  ) {}

  asService(): MatchJobService {
    return this as unknown as MatchJobService
  }

  async processNextJob(): Promise<MatchJobRecord | null> {
    this.calls += 1
    const outcome = this.outcomes.shift() ?? null
    if (outcome instanceof Error) throw outcome
    return outcome
  }
}

function silentLogger() {
  return {
    error: vi.fn(),
    log: vi.fn(),
  }
}
