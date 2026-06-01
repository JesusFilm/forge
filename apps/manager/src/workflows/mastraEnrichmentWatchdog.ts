import { failMastraEnrichmentIfNoCallback } from "@/lib/state"

export const MASTRA_FIRST_CALLBACK_WATCHDOG_MS = 60_000

type WatchdogTimer = ReturnType<typeof setTimeout>

type ScheduleWatchdogOptions = {
  delayMs?: number
  setTimeoutFn?: typeof setTimeout
}

function unrefTimer(timer: WatchdogTimer) {
  if (
    typeof timer === "object" &&
    timer !== null &&
    "unref" in timer &&
    typeof timer.unref === "function"
  ) {
    timer.unref()
  }
}

export function scheduleMastraFirstCallbackWatchdog(
  jobId: string,
  runId: string,
  options: ScheduleWatchdogOptions = {},
): WatchdogTimer {
  const delayMs = options.delayMs ?? MASTRA_FIRST_CALLBACK_WATCHDOG_MS
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout

  const timer = setTimeoutFn(() => {
    void failMastraEnrichmentIfNoCallback(jobId, runId).then((result) => {
      if (result.status === "failed") {
        console.warn(
          `[manager-enrichment] event=first_callback_watchdog_failed jobId=${jobId} runId=${runId}`,
        )
      } else if (result.status === "error") {
        console.warn(
          `[manager-enrichment] event=first_callback_watchdog_error jobId=${jobId} runId=${runId} error=${result.error instanceof Error ? result.error.message : "unknown"}`,
        )
      }
    })
  }, delayMs)

  unrefTimer(timer)
  return timer
}
