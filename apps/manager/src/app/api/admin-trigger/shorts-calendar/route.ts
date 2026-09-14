import { z } from "zod"
import { studioIdSchema } from "@forge/studio-contracts"
import { readStudioBytes, StudioBoundaryError } from "@forge/studio-server"
import { validateAdminTriggerBearer } from "@/lib/admin-trigger-auth"
import { executeCalendarPlan } from "@/services/studio-agent/calendar"
export async function POST(request: Request) {
  const auth = validateAdminTriggerBearer(request)
  if (!auth.ok)
    return Response.json({ error: auth.message }, { status: auth.status })
  try {
    const input = z
      .object({ runId: studioIdSchema })
      .strict()
      .parse(JSON.parse(await readStudioBytes(request, 1024)))
    return Response.json({
      result: await executeCalendarPlan(input.runId, request.signal),
    })
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof StudioBoundaryError
            ? error.message
            : "Calendar run failed",
      },
      { status: error instanceof StudioBoundaryError ? error.status : 400 },
    )
  }
}
