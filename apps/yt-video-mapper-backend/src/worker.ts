import { env } from "./config/env.js"
import type { MatchJobService } from "./services/match-job.service.js"

type Timer = ReturnType<typeof setTimeout>

export type MatchJobWorker = {
  stop(): void
}

export type StartMatchJobWorkerOptions = {
  pollIntervalMs?: number
  logger?: Pick<Console, "error" | "log">
}

export function startMatchJobWorker(
  service: MatchJobService,
  {
    pollIntervalMs = env.MATCH_JOB_WORKER_POLL_INTERVAL_MS,
    logger = console,
  }: StartMatchJobWorkerOptions = {},
): MatchJobWorker {
  let stopped = false
  let timer: Timer | undefined

  function schedule(delayMs: number): void {
    timer = setTimeout(() => {
      void tick()
    }, delayMs)
  }

  async function tick(): Promise<void> {
    if (stopped) return
    let delayMs = pollIntervalMs

    try {
      const job = await service.processNextJob()

      if (job) {
        logger.log(
          `[yt-video-mapper-worker] event=match_job_processed jobId=${job.id}`,
        )
        delayMs = 0
      }
    } catch (error) {
      logger.error(
        `[yt-video-mapper-worker] event=worker_error error=${JSON.stringify(error instanceof Error ? error.message : String(error))}`,
      )
    }

    if (!stopped) schedule(delayMs)
  }

  logger.log(
    `[yt-video-mapper-worker] event=worker_started pollIntervalMs=${pollIntervalMs}`,
  )
  schedule(0)

  return {
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      logger.log("[yt-video-mapper-worker] event=worker_stopped")
    },
  }
}
