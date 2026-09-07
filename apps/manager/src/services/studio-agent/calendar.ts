import { z } from "zod"
import {
  calendarNativeInputSchema,
  calendarPlanResultSchema,
} from "@forge/studio-contracts/calendar"
import {
  type StudioCaller,
  StudioBoundaryError,
  readStudioBytes,
} from "@forge/studio-server"
import { studioServiceCall, studioServiceRequest } from "./transport"
const worker: StudioCaller = {
  sub: "studio-calendar-worker",
  authority: "delegated",
  clientId: "studio-calendar",
  scopes: ["studio:calendar:plan", "studio:calendar:finish"],
}
/** Only the server reads an admitted canonical run; models cannot complete slots. */
export async function executeCalendarPlan(runId: string, signal: AbortSignal) {
  const claimed = await studioServiceCall("calendar-admin", worker, {
    action: "claim",
    runId,
  })
  if (claimed === null) return { runId, status: "ALREADY_DISPATCHED" }
  const input = calendarNativeInputSchema.parse(claimed)
  try {
    const frozen = z.object({ admission: z.string() }).parse(
      await studioServiceCall("calendar", worker, {
        action: "freeze",
        ...input,
      }),
    )
    const response = await studioServiceRequest(
      "calendar",
      worker,
      { action: "run", ...input, ...frozen },
      signal,
    )
    const result = calendarPlanResultSchema.parse(
      z
        .object({ result: z.unknown() })
        .parse(JSON.parse(await readStudioBytes(response, 131072))).result,
    )
    return await studioServiceCall("calendar-admin", worker, {
      action: "finish",
      runId,
      result,
    })
  } catch (error) {
    await studioServiceCall("calendar-admin", worker, {
      action: "fail",
      runId,
      reason:
        error instanceof StudioBoundaryError && error.status === 503
          ? "UNAVAILABLE"
          : "INTERRUPTED",
    }).catch(() => {})
    throw error
  }
}
