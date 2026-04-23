// POST /api/enrich — Create enrichment jobs for existing CMS videos.
// Accepts selected video core IDs plus requested target language IDs from the
// coverage UI. The route derives the source audio language per video from CMS
// metadata, then normalizes only real language codes into the workflow.

import { NextResponse } from "next/server"
import { z } from "zod"
import { authenticateRequest } from "@/lib/auth"
import {
  createEnrichmentJobs,
  EnrichmentJobCreationError,
  type CreateEnrichmentJobsResult,
} from "@/features/enrichment/create-enrichment-jobs"

const enrichSchema = z.object({
  videoIds: z.array(z.string().min(1)).min(1).max(100),
  targetLanguageIds: z.array(z.string().max(10)).max(10).optional(),
  languages: z.array(z.string().max(10)).max(10).optional(),
})

export async function POST(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = enrichSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  let result: CreateEnrichmentJobsResult
  try {
    result = await createEnrichmentJobs(parsed.data)
  } catch (error) {
    if (error instanceof EnrichmentJobCreationError) {
      return NextResponse.json(error.responseBody, { status: error.status })
    }
    throw error
  }

  return NextResponse.json(result, { status: 201 })
}
