import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"
import {
  findMissingLanguageIds,
  createAutomation,
  listAutomations,
} from "@/features/agents/automation-store"
import {
  computeNextRunAt,
  formatScheduleSummary,
} from "@/features/agents/schedule-summary"
import { validateAutomationDraft } from "@/features/agents/automation-contract"

export async function GET(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  try {
    const automations = await listAutomations()
    return NextResponse.json({ automations })
  } catch (error) {
    console.error("[api/automations] Failed to list automations:", error)
    return NextResponse.json(
      { error: "Failed to list automations" },
      { status: 502 },
    )
  }
}

export async function POST(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const contentType = request.headers.get("content-type") ?? ""
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ error: "JSON body required" }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const initialValidation = validateAutomationDraft(body)
  if (!initialValidation.success) {
    return NextResponse.json(
      { error: "Validation failed", details: initialValidation.errors },
      { status: 400 },
    )
  }

  const missingLanguageIds = await findMissingLanguageIds(
    initialValidation.data.targetLanguageIds,
  )
  const validation = validateAutomationDraft(
    initialValidation.data,
    initialValidation.data.targetLanguageIds.filter(
      (languageId) => !missingLanguageIds.includes(languageId),
    ),
  )
  if (!validation.success) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 400 },
    )
  }

  try {
    const nextRunAt = computeNextRunAt(validation.data.schedule).toISOString()
    const automation = await createAutomation({
      ...validation.data,
      status: "active",
      timezone: validation.data.schedule.timezone,
      scheduleSummary: formatScheduleSummary(validation.data.schedule),
      nextRunAt,
    })

    return NextResponse.json({ automation }, { status: 201 })
  } catch (error) {
    console.error("[api/automations] Failed to create automation:", error)
    return NextResponse.json(
      { error: "Failed to create automation" },
      { status: 502 },
    )
  }
}
