import { afterEach, describe, expect, it, vi } from "vitest"
import { startMatchJobCleaner } from "./cleaner.js"
import type {
  MatchJobCleanerSummary,
  MatchJobService,
} from "./services/match-job.service.js"
import {
  MATCH_JOB_CLEANER_INTERVAL_MS,
  MATCH_JOB_CLEANER_PAGE_SIZE,
} from "./services/match-job.service.js"

describe("startMatchJobCleaner", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("runs immediately and then waits for the fixed interval", async () => {
    vi.useFakeTimers()
    const service = new StubCleanerService([summary(), summary(), summary()])
    const cleaner = startMatchJobCleaner(service.asService(), {
      intervalMs: 50,
      logger: silentLogger(),
    })

    await vi.runOnlyPendingTimersAsync()
    expect(service.calls).toBe(1)

    await vi.advanceTimersByTimeAsync(49)
    expect(service.calls).toBe(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(service.calls).toBe(2)

    cleaner.stop()
  })

  it("uses the production cleaner interval and page size by default", async () => {
    vi.useFakeTimers()
    const logger = silentLogger()
    const calls: Array<{ pageSize?: number }> = []
    const service = {
      async cleanExpiredQueuedJobs(options: { pageSize?: number }) {
        calls.push(options)
        return summary()
      },
    }
    const cleaner = startMatchJobCleaner(
      service as unknown as MatchJobService,
      { logger },
    )

    await vi.advanceTimersByTimeAsync(0)

    expect(logger.log).toHaveBeenCalledWith(
      `[yt-video-mapper-cleaner] event=cleaner_started intervalMs=${MATCH_JOB_CLEANER_INTERVAL_MS}`,
    )
    expect(calls).toEqual([{ pageSize: MATCH_JOB_CLEANER_PAGE_SIZE }])

    cleaner.stop()
  })

  it("does not overlap ticks while cleanup is still running", async () => {
    vi.useFakeTimers()
    let resolveCleanup: (value: MatchJobCleanerSummary) => void = () => {}
    const service = {
      calls: 0,
      async cleanExpiredQueuedJobs() {
        this.calls += 1
        return new Promise<MatchJobCleanerSummary>((resolve) => {
          resolveCleanup = resolve
        })
      },
    }
    const cleaner = startMatchJobCleaner(
      service as unknown as MatchJobService,
      {
        intervalMs: 25,
        logger: silentLogger(),
      },
    )

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(100)
    expect(service.calls).toBe(1)

    resolveCleanup(summary())
    await vi.advanceTimersByTimeAsync(25)
    expect(service.calls).toBe(2)

    cleaner.stop()
  })

  it("logs a skipped tick when another cleaner owns the lease", async () => {
    vi.useFakeTimers()
    const logger = silentLogger()
    const service = new StubCleanerService([
      summary({ skippedDueToLock: true }),
    ])
    const cleaner = startMatchJobCleaner(service.asService(), {
      intervalMs: 25,
      logger,
    })

    await vi.advanceTimersByTimeAsync(0)

    expect(logger.log).toHaveBeenCalledWith(
      "[yt-video-mapper-cleaner] event=cleaner_skipped reason=lease",
    )

    cleaner.stop()
  })

  it("keeps polling when cleanup throws", async () => {
    vi.useFakeTimers()
    const logger = silentLogger()
    const service = new StubCleanerService([
      new Error("database unavailable"),
      summary(),
    ])
    const cleaner = startMatchJobCleaner(service.asService(), {
      intervalMs: 25,
      logger,
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(service.calls).toBe(1)
    expect(logger.error).toHaveBeenCalledWith(
      '[yt-video-mapper-cleaner] event=cleaner_error error="database unavailable"',
    )

    await vi.advanceTimersByTimeAsync(25)
    expect(service.calls).toBe(2)

    cleaner.stop()
  })

  it("logs stuck uploads and repeated cleanup failures", async () => {
    vi.useFakeTimers()
    const logger = silentLogger()
    const service = new StubCleanerService([
      summary({ uploadCleanupFailed: 2, remainingExpiredUploads: 5 }),
      summary({ uploadCleanupFailed: 1, remainingExpiredUploads: 4 }),
      summary({ uploadCleanupFailed: 1, remainingExpiredUploads: 3 }),
      summary(),
    ])
    const cleaner = startMatchJobCleaner(service.asService(), {
      intervalMs: 25,
      logger,
    })

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(25)
    await vi.advanceTimersByTimeAsync(25)

    expect(logger.error).toHaveBeenCalledWith(
      "[yt-video-mapper-cleaner] event=upload_cleanup_failed failed=2 remainingExpiredUploads=5",
    )
    expect(logger.error).toHaveBeenCalledWith(
      "[yt-video-mapper-cleaner] event=repeated_cleanup_failures consecutiveFailureTicks=3",
    )

    await vi.advanceTimersByTimeAsync(25)
    await vi.advanceTimersByTimeAsync(25)

    expect(logger.error).not.toHaveBeenCalledWith(
      "[yt-video-mapper-cleaner] event=repeated_cleanup_failures consecutiveFailureTicks=4",
    )

    cleaner.stop()
  })

  it("does not schedule more cleanup when stopped during a tick", async () => {
    vi.useFakeTimers()
    let resolveCleanup: (value: MatchJobCleanerSummary) => void = () => {}
    const service = {
      calls: 0,
      async cleanExpiredQueuedJobs() {
        this.calls += 1
        return new Promise<MatchJobCleanerSummary>((resolve) => {
          resolveCleanup = resolve
        })
      },
    }
    const cleaner = startMatchJobCleaner(
      service as unknown as MatchJobService,
      {
        intervalMs: 25,
        logger: silentLogger(),
      },
    )

    await vi.advanceTimersByTimeAsync(0)
    expect(service.calls).toBe(1)

    cleaner.stop()
    resolveCleanup(summary())
    await vi.advanceTimersByTimeAsync(25)

    expect(service.calls).toBe(1)
  })
})

class StubCleanerService {
  calls = 0

  constructor(
    private readonly outcomes: Array<MatchJobCleanerSummary | Error>,
  ) {}

  asService(): MatchJobService {
    return this as unknown as MatchJobService
  }

  async cleanExpiredQueuedJobs(): Promise<MatchJobCleanerSummary> {
    this.calls += 1
    const outcome = this.outcomes.shift() ?? summary()
    if (outcome instanceof Error) throw outcome
    return outcome
  }
}

function summary({
  expiredJobs = 0,
  uploadCleanupSucceeded = 0,
  uploadCleanupFailed = 0,
  expiredUploadRetries = 0,
  remainingExpiredUploads = 0,
  skippedDueToLock = false,
}: Partial<MatchJobCleanerSummary> = {}): MatchJobCleanerSummary {
  return {
    expiredJobs,
    uploadCleanupSucceeded,
    uploadCleanupFailed,
    expiredUploadRetries,
    remainingExpiredUploads,
    skippedDueToLock,
  }
}

function silentLogger() {
  return {
    error: vi.fn(),
    log: vi.fn(),
  }
}
