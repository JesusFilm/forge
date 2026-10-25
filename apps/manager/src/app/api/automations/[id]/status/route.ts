import { NextResponse } from "next/server"
import { z } from "zod"
import { authenticateRequest } from "@/lib/auth"
import {
  listAutomations,
  updateAutomationStatus,
} from "@/features/agents/automation-store"
import { computeNextRunAt } from "@/features/agents/schedule-summary"

const statusSchema = z.object({
  status: z.enum(["active", "paused"]),
})

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = statusSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { id } = await context.params

  try {
    let nextRunAt: string | null = null
    if (parsed.data.status === "active") {
      const automation = (await listAutomations()).find(
        (candidate) => candidate.documentId === id,
      )
      if (!automation) {
        return NextResponse.json(
          { error: "Automation not found" },
          { status: 404 },
        )
      }
      nextRunAt = computeNextRunAt(automation.schedule).toISOString()
    }

    const automation = await updateAutomationStatus(id, {
      status: parsed.data.status,
      nextRunAt,
    })
    return NextResponse.json({ automation })
  } catch (error) {
    console.error(
      "[api/automations/status] Failed to update automation:",
      error,
    )
    return NextResponse.json(
      { error: "Failed to update automation" },
      { status: 502 },
    )
  }
}
