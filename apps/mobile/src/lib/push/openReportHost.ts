/**
 * R23's open report, wired for the tap path: it starts the request and returns
 * at once, so no report can delay a navigation the viewer asked for.
 *
 * KTD7: a rate limit is DEFERRED, never retried. So is every other failure —
 * nothing is remembered, because a second report of the same open would answer
 * DUPLICATE anyway and the campaign's open count is already one. The one
 * exception is a viewer handle Admin refuses: that refusal records no open, so
 * the handle is re-checked and the open is reported once more without it.
 */

import { datadogLog } from "../datadog"
import { PUSH_VIEWER_HANDLE_REJECTED_CODE } from "./constants"
import { reportPushOpen } from "./openReportClient"
import { readPushViewerHandle, recheckPushViewerHandle } from "./viewerHandle"
import { readPushFailure } from "./failure"

/** Reports the open, and once more without the handle if Admin refuses it.
 *  The open still binds to its delivery's registration without one (KTD14). */
async function reportWithHandle(nonce: string) {
  const viewer = await readPushViewerHandle()
  try {
    return { outcome: await reportPushOpen({ nonce, viewer }), viewer }
  } catch (error) {
    if (
      viewer == null ||
      readPushFailure(error).pushCode !== PUSH_VIEWER_HANDLE_REJECTED_CODE
    ) {
      throw error
    }
    await recheckPushViewerHandle(viewer.viewerToken)
    return {
      outcome: await reportPushOpen({ nonce, viewer: null }),
      viewer: null,
    }
  }
}

async function report(nonce: string): Promise<void> {
  try {
    const { outcome, viewer } = await reportWithHandle(nonce)
    // The nonce never reaches a log: it identifies one delivery to one phone.
    // Named `telemetry`-family sink with an inline literal, so the repo-wide
    // reserved-attribute sweep can see it.
    datadogLog.info("push.open_report", {
      outcome,
      has_viewer: viewer != null,
    })
  } catch (error) {
    const failure = readPushFailure(error)
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
