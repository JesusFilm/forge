/**
 * R23's open report, wired for the tap path: it starts the request and returns
 * at once, so no report can delay a navigation the viewer asked for.
 *
 * KTD7: a rate limit is DEFERRED, never retried. So is every other failure —
 * nothing is remembered, because a second report of the same open would answer
 * DUPLICATE anyway and the campaign's open count is already one.
 */

import { datadogLog } from "../datadog"
import { reportPushOpen } from "./openReportClient"
import { readPushViewerHandle } from "./viewerHandle"

/**
 * The typed failure's own fields, read by SHAPE rather than through
 * `instanceof`. The class identity is one more thing that can be absent here,
 * and `instanceof undefined` throws — inside the catch of a fire-and-forget
 * call, which is an unhandled rejection in a runtime with no global handler.
 */
function failureFields(error: unknown): {
  code: string
  pushCode: string | null
} {
  const shape = (error ?? {}) as { code?: unknown; pushCode?: unknown }
  return {
    code: typeof shape.code === "string" ? shape.code : "UNKNOWN",
    pushCode: typeof shape.pushCode === "string" ? shape.pushCode : null,
  }
}

async function report(nonce: string): Promise<void> {
  try {
    const viewer = await readPushViewerHandle()
    const outcome = await reportPushOpen({ nonce, viewer })
    // The nonce never reaches a log: it identifies one delivery to one phone.
    // Named `telemetry`-family sink with an inline literal, so the repo-wide
    // reserved-attribute sweep can see it.
    datadogLog.info("push.open_report", {
      outcome,
      has_viewer: viewer != null,
    })
  } catch (error) {
    const failure = failureFields(error)
    // The error's own message never goes in: it can echo the nonce or the
    // handle. Only admin's codes do.
    datadogLog.info("push.open_report_failed", {
      code: failure.code,
      push_code: failure.pushCode,
      deferred: true,
    })
  }
}

/**
 * Start one report and return immediately. It never throws into the caller and
 * never rejects, so the tap handler can call it before it navigates. The catch
 * here is structural: an unhandled rejection is fatal in this runtime, so the
 * belt stays even though `report` already swallows everything.
 */
export function reportPushOpenInBackground(nonce: string): void {
  void report(nonce).catch(() => undefined)
}
