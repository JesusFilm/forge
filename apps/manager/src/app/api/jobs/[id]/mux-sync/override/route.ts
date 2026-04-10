import { NextResponse } from "next/server"
import { z } from "zod"
import { authenticateRequest } from "@/lib/auth"
import { getMuxSyncReport, setMuxSyncReport } from "@/lib/mux-sync-report"
import { getJob, updateJob } from "@/lib/state"
import { applySubtitleOverride } from "@/services/mux-sync"

const requestBodySchema = z.object({
  artifactKey: z.string().min(1).startsWith("subtitles-"),
  targetLanguage: z.string().min(1),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const { id } = await params
  const job = await getJob(id)

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 })
  }

  const parsedBody = requestBodySchema.safeParse(await request.json())
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Invalid override request" },
      { status: 400 },
    )
  }

  const previousReport = getMuxSyncReport(job.artifacts)
  const existingComparison = previousReport?.comparisons.find(
    (comparison) =>
      comparison.artifactKey === parsedBody.data.artifactKey &&
      comparison.targetLanguage === parsedBody.data.targetLanguage,
  )

  if (!existingComparison || existingComparison.canOverride !== true) {
    return NextResponse.json(
      { error: "Subtitle track is not overrideable" },
      { status: 409 },
    )
  }

  try {
    const nextReport = await applySubtitleOverride({
      jobId: job.id,
      assetId: job.muxAssetId,
      muxAssetId: job.muxAssetId,
      artifactKey: parsedBody.data.artifactKey,
      targetLanguage: parsedBody.data.targetLanguage,
      previousReport,
    })

    const updatedJob = await updateJob(job.id, {
      artifacts: setMuxSyncReport(job.artifacts, nextReport),
    })

    if (!updatedJob) {
      return NextResponse.json(
        { error: "Failed to persist subtitle override" },
        { status: 500 },
      )
    }

    return NextResponse.json({
      job: updatedJob,
      report: nextReport,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to override subtitle track",
      },
      { status: 500 },
    )
  }
}
