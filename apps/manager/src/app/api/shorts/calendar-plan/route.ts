import { z } from "zod"
import { NextResponse } from "next/server"
import { studioIdSchema } from "@forge/studio-contracts"
import { studioInstructionCommandSchema } from "@forge/studio-contracts/agent"
import { authenticateStudioRequest } from "@/lib/studio-request"
import { createStudioInteractiveClient } from "@/backend/studio-interactive"
import { executeCalendarPlan } from "@/services/studio-agent/calendar"
import { studioServiceCall } from "@/services/studio-agent/transport"
import { readStudioBytes, StudioBoundaryError } from "@forge/studio-server"
const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("plan"),
      calendarId: studioIdSchema,
      idempotencyKey: studioIdSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("instructions"),
      command: studioInstructionCommandSchema,
    })
    .strict(),
])
export async function POST(request: Request) {
  const actor = await authenticateStudioRequest(request)
  if (actor instanceof NextResponse) return actor
  try {
    const input = schema.parse(
      JSON.parse(await readStudioBytes(request, 32768)),
    )
    if (input.action === "instructions")
      return Response.json({
        result: await studioServiceCall(
          "calendar",
          {
            sub: actor.approvedByUserId,
            authority: "interactive",
            clientId: "shorts-manager",
            scopes: ["shorts:instructions:read"],
          },
          input,
        ),
      })
    const run = z.object({ id: studioIdSchema }).parse(
      await createStudioInteractiveClient(actor)("calendar-plan-admit", {
        calendarId: input.calendarId,
        idempotencyKey: input.idempotencyKey,
      }),
    )
    return Response.json({
      result: await executeCalendarPlan(run.id, request.signal),
    })
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof StudioBoundaryError
            ? error.message
            : "Calendar planning failed; existing work is preserved",
      },
      { status: error instanceof StudioBoundaryError ? error.status : 400 },
    )
  }
}
