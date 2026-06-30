import {
  MATCH_JOB_CLEANER_INTERVAL_MS,
  MATCH_JOB_CLEANER_PAGE_SIZE,
  type MatchJobCleanerSummary,
  type MatchJobService,
} from "./services/match-job.service.js"

type Timer = ReturnType<typeof setTimeout>

export type MatchJobCleaner = {
  stop(): void
}

export type StartMatchJobCleanerOptions = {
  intervalMs?: number
  pageSize?: number
  logger?: Pick<Console, "error" | "log">
}

export function startMatchJobCleaner(
  service: MatchJobService,
  {
    intervalMs = MATCH_JOB_CLEANER_INTERVAL_MS,
    pageSize = MATCH_JOB_CLEANER_PAGE_SIZE,
    logger = console,
  }: StartMatchJobCleanerOptions = {},
): MatchJobCleaner {
  let stopped = false
  let timer: Timer | undefined
  let consecutiveFailureTicks = 0

  function schedule(delayMs: number): void {
    timer = setTimeout(() => {
      void tick()
    }, delayMs)
  }

  async function tick(): Promise<void> {
    if (stopped) return

    try {
      const summary = await service.cleanExpiredQueuedJobs({ pageSize })
      logSummary(summary)

      if (summary.uploadCleanupFailed > 0) {
        consecutiveFailureTicks += 1
        logger.error(
          `[yt-video-mapper-cleaner] event=upload_cleanup_failed failed=${summary.uploadCleanupFailed} remainingExpiredUploads=${summary.remainingExpiredUploads}`,
        )
      } else {
        consecutiveFailureTicks = 0
      }
    } catch (error) {
      consecutiveFailureTicks += 1
      logger.error(
        `[yt-video-mapper-cleaner] event=cleaner_error error=${JSON.stringify(error instanceof Error ? error.message : String(error))}`,
      )
    }

    if (consecutiveFailureTicks >= 3) {
      logger.error(
        `[yt-video-mapper-cleaner] event=repeated_cleanup_failures consecutiveFailureTicks=${consecutiveFailureTicks}`,
      )
    }

    if (!stopped) schedule(intervalMs)
  }

  function logSummary(summary: MatchJobCleanerSummary): void {
    if (summary.skippedDueToLock) {
      logger.log("[yt-video-mapper-cleaner] event=cleaner_skipped reason=lease")
      return
    }

    logger.log(
      `[yt-video-mapper-cleaner] event=cleaner_tick expiredJobs=${summary.expiredJobs} uploadCleanupSucceeded=${summary.uploadCleanupSucceeded} uploadCleanupFailed=${summary.uploadCleanupFailed} expiredUploadRetries=${summary.expiredUploadRetries} remainingExpiredUploads=${summary.remainingExpiredUploads}`,
    )
  }

  logger.log(
    `[yt-video-mapper-cleaner] event=cleaner_started intervalMs=${intervalMs}`,
  )
  schedule(0)

  return {
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      logger.log("[yt-video-mapper-cleaner] event=cleaner_stopped")
    },
  }
}
