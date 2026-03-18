import { after } from "next/server"
import { NextResponse } from "next/server"
import { z } from "zod"
import { authenticateRequest } from "@/lib/auth"
import { createJob, listJobs, updateJob } from "@/lib/state"
import { createMuxAsset } from "@/services/mux"
import { runVideoEnrichment } from "@/workflows/videoEnrichment"

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
})

export async function GET(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const url = new URL(request.url)
  const query = listQuerySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
  })

  if (!query.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: query.error.flatten() },
      { status: 400 },
    )
  }

  const allJobs = await listJobs()
  const { limit, offset } = query.data
  const jobs = allJobs.slice(offset, offset + limit)

  return NextResponse.json({ jobs, total: allJobs.length })
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

  // Create Mux asset
  let muxAsset: Awaited<ReturnType<typeof createMuxAsset>>
  try {
    muxAsset = await createMuxAsset({
      inputUrl: body.inputUrl,
      generateSubtitles: true,
    })
  } catch (error: unknown) {
    console.error("Failed to create Mux asset:", error)
    return NextResponse.json(
      { error: "Failed to ingest video. Please try again later." },
      { status: 502 },
    )
  }

  // Create local job record
  const job = await createJob(muxAsset.assetId, muxAsset.playbackId)

  // Run enrichment after the response is sent.
  // after() tells the runtime to keep the function alive for background work.
  after(async () => {
    try {
      await runVideoEnrichment({
        jobId: job.id,
        assetId: job.assetId,
        muxAssetId: muxAsset.assetId,
        language: body.language,
        translateTo: body.translateTo,
      })
    } catch (error: unknown) {
      console.error(`Enrichment failed for job ${job.id}:`, error)
      await updateJob(job.id, {
        status: "failed",
        error: "Enrichment pipeline failed. Check server logs for details.",
      }).catch(console.error)
    }
  })

  return NextResponse.json({ job }, { status: 201 })
}
