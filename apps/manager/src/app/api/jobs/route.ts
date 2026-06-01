import { NextResponse } from "next/server"
import { z } from "zod"
import { authenticateRequest } from "@/lib/auth"
import { getCmsGateway } from "@/cms/gateway"
import { buildInitialTranscriptionRoutingReport } from "@/lib/transcription-routing-report"
import { resolveEnrichmentEngine } from "@/lib/enrichment-engine"
import {
  countJobs,
  createJob,
  listJobSummaries,
  listJobs,
  updateJob,
} from "@/lib/state"
import { createMuxAsset } from "@/services/mux"
import { isAudioCleanupConfigured } from "@/services/audioCleanup"
import { launchVideoEnrichment } from "@/workflows/launchVideoEnrichment"

const createJobSchema = z.object({
  inputUrl: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://"), "Only HTTPS URLs are allowed"),
  language: z.string().max(10).optional(),
  translateTo: z.array(z.string().max(10)).max(10).optional(),
})

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  view: z.enum(["full", "summary", "count"]).default("summary"),
})

export async function GET(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const url = new URL(request.url)
  const query = listQuerySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
    view: url.searchParams.get("view") ?? undefined,
  })

  if (!query.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: query.error.flatten() },
      { status: 400 },
    )
  }

  const { limit, offset, view } = query.data
  try {
    if (view === "count") {
      const total = await countJobs()
      return NextResponse.json({ total })
    }

    const [jobs, total] = await Promise.all([
      view === "full"
        ? listJobs({ limit, offset })
        : listJobSummaries({ limit, offset }),
      countJobs(),
    ])

    return NextResponse.json({ jobs, total })
  } catch (error) {
    console.warn("Failed to list Manager jobs:", error)
    return NextResponse.json({ error: "Failed to load jobs" }, { status: 502 })
  }
}

export async function POST(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = createJobSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const body = parsed.data

  if (getCmsGateway().mode === "mock") {
    const languages = body.translateTo ?? []
    const mockIdSuffix = Date.now().toString(36)
    const job = await createJob(
      `mock-upload-${mockIdSuffix}-asset`,
      `mock-upload-${mockIdSuffix}-playback`,
      languages,
      {
        initialArtifacts: {
          transcriptionRouting: {
            kind: "metadata",
            data: buildInitialTranscriptionRoutingReport({
              sourceInputUrl: body.inputUrl,
            }) as unknown as Record<string, unknown>,
          },
        },
      },
    )

    return NextResponse.json(
      {
        job,
        jobId: job.id,
        note: "Created in mock mode without Mux ingestion or workflow dispatch.",
      },
      { status: 201 },
    )
  }

  // Create Mux asset
  let muxAsset: Awaited<ReturnType<typeof createMuxAsset>>
  try {
    muxAsset = await createMuxAsset({
      inputUrl: body.inputUrl,
      generateSubtitles: true,
      subtitleLanguageCode: body.language ?? "auto",
    })
  } catch (error: unknown) {
    console.error("Failed to create Mux asset:", error)
    return NextResponse.json(
      { error: "Failed to ingest video. Please try again later." },
      { status: 502 },
    )
  }

  // Create local job record
  const languages = body.translateTo ?? []
  const engine = await resolveEnrichmentEngine({
    key: muxAsset.assetId,
    custom: { route: "api.jobs" },
  })
  const job = await createJob(
    muxAsset.assetId,
    muxAsset.playbackId,
    languages,
    {
      engine,
      initialArtifacts: {
        transcriptionRouting: {
          kind: "metadata",
          data: buildInitialTranscriptionRoutingReport({
            sourceInputUrl: body.inputUrl,
          }) as unknown as Record<string, unknown>,
        },
      },
    },
  )

  try {
    await launchVideoEnrichment({
      jobId: job.id,
      assetId: job.muxAssetId,
      muxAssetId: muxAsset.assetId,
      playbackId: muxAsset.playbackId,
      language: body.language,
      translateTo: body.translateTo,
      runAudioCleanup: isAudioCleanupConfigured(),
      initialArtifacts: job.artifacts,
      requestedTranscriptionProvider: "automatic",
    })
  } catch (error: unknown) {
    console.error(`Enrichment failed for job ${job.id}:`, error)
    await updateJob(job.id, { status: "failed" }).catch(console.error)

    return NextResponse.json(
      {
        error: "Failed to launch enrichment workflow.",
        details: error instanceof Error ? error.message : undefined,
        code: "workflow_launch_failed",
      },
      { status: 502 },
    )
  }

  return NextResponse.json({ job, jobId: job.id }, { status: 201 })
}
