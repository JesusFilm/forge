import { NextResponse } from "next/server"
import { z } from "zod"
import { authenticateServiceBearerRequest } from "@/lib/auth"
import { enqueueAutomationRun } from "@/features/agents/automation-runner"
import {
  automationScheduleSchema,
  type EnrichmentAutomation,
} from "@/features/agents/automation-contract"

const automationPayloadSchema = z.object({
  documentId: z.string().min(1),
  name: z.string().min(1),
  runMode: z.enum(["live", "dry_run"]).default("live"),
  template: z.enum([
    "source_subtitles_missing",
    "target_subtitles_missing",
    "metadata_missing",
    "transcript_embeddings_missing",
  ]),
  status: z.enum(["active", "paused"]),
  schedule: automationScheduleSchema,
  scheduleSummary: z.string().nullable().optional(),
  timezone: z.string().optional(),
  nextRunAt: z.string().nullable().optional(),
  lastRunAt: z.string().nullable().optional(),
  lastRunStatus: z
    .enum(["success", "partial", "failed", "no_op"])
    .nullable()
    .optional(),
  refreshMode: z.enum(["missing_only", "refresh_ai_generated"]),
  targetLanguageIds: z
    .array(z.string().trim().min(1))
    .max(20)
    .default([])
    .transform((languageIds) => Array.from(new Set(languageIds))),
  maxVideosPerRun: z.number().int().min(1).max(100),
})

const enqueueSchema = z
  .object({
    automation: automationPayloadSchema,
  })
  .strict()

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authError = authenticateServiceBearerRequest(request)
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

  const parsed = enqueueSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  if (
    parsed.data.automation.template === "target_subtitles_missing" &&
    parsed.data.automation.targetLanguageIds.length !== 1
  ) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: ["Choose one target language for subtitle automations."],
      },
      { status: 400 },
    )
  }

  const { id } = await context.params
  const runMode = parsed.data.automation.runMode
  const automation: EnrichmentAutomation = {
    ...parsed.data.automation,
    runMode,
    timezone:
      parsed.data.automation.timezone ??
      parsed.data.automation.schedule.timezone,
    runs: [],
  }

  const result = await enqueueAutomationRun({
    runDocumentId: id,
    runMode,
    automation,
  })

  return NextResponse.json(result)
}
