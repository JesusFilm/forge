import { z } from "zod"
// The installed workflow builder discovers app imports, not instrumentation.
// Include this timer in its build graph; importing it does not start a run.
import "@/workflows/studioCalendar"
import { prisma } from "@/db/client"
import { env } from "@/config/env"
import { MANAGER_BACKEND_PRINCIPAL } from "@/auth/principal"
import {
  readStudioBytes,
  verifyStudioRequest,
  StudioBoundaryError,
} from "@forge/studio-server"
import { studioIdSchema } from "@forge/studio-contracts"
import { calendarPlanResultSchema } from "@forge/studio-contracts/calendar"
import { StudioCalendarService } from "@/services/studio-authoring/calendar"
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim"), runId: studioIdSchema }).strict(),
  z
    .object({
      action: z.literal("finish"),
      runId: studioIdSchema,
      result: calendarPlanResultSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("fail"),
      runId: studioIdSchema,
      reason: z.enum(["FAILED", "INTERRUPTED", "UNAVAILABLE"]),
    })
    .strict(),
])
export async function POST(request: Request) {
  try {
    const body = await readStudioBytes(request, 131072)
    const caller = await verifyStudioRequest(
      request.headers.get("x-forge-shorts-service"),
      body,
      "forge-admin:shorts-calendar",
      {
        publicKeys: env.STUDIO_INTERACTIVE_PUBLIC_KEYS ?? "{}",
        environment: env.STUDIO_ENVIRONMENT,
      },
    )
    if (
      caller.authority !== "delegated" ||
      caller.clientId !== "shorts-calendar" ||
      !caller.scopes.includes("shorts:calendar:finish")
    )
      throw new StudioBoundaryError("Trusted calendar worker required")
    const input = schema.parse(JSON.parse(body)),
      service = new StudioCalendarService(prisma)
    const result =
      input.action === "claim"
        ? await service.claimPlanning(MANAGER_BACKEND_PRINCIPAL, input.runId)
        : input.action === "finish"
          ? await service.finishPlanning(
              MANAGER_BACKEND_PRINCIPAL,
              input.runId,
              input.result,
            )
          : await service.failPlanning(MANAGER_BACKEND_PRINCIPAL, {
              runId: input.runId,
              reason: input.reason,
            })
    return Response.json(
      { result },
      { headers: { "cache-control": "no-store" } },
    )
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof StudioBoundaryError
            ? error.message
            : "Calendar worker command rejected",
      },
      { status: error instanceof StudioBoundaryError ? error.status : 400 },
    )
  }
}
