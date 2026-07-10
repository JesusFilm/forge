import { start } from "workflow/api"
import { runShortsPrepare, runShortsRender } from "@/workflows/shortsStudio"

export type LaunchShortsKind = "prepare" | "render"

export type LaunchShortsOptions = {
  /** Prepare only: re-run the worker even when clip + captions artifacts
   * exist (discards caption edits via the draft provenance reset). */
  force?: boolean
}

// Mirrors launchSmartCrop's start() usage: routes call this after createJob
// (prepare) or after the lifecycle-contract phase gate (render relaunch on
// the same JobRecord).
export async function launchShorts(
  kind: LaunchShortsKind,
  jobId: string,
  opts: LaunchShortsOptions = {},
) {
  if (kind === "render") {
    return start(runShortsRender, [{ jobId }])
  }

  return start(runShortsPrepare, [
    { jobId, ...(opts.force !== undefined ? { force: opts.force } : {}) },
  ])
}
