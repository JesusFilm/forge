import { NextResponse } from "next/server"
import { z } from "zod"
import { authenticateRequest } from "@/lib/auth"
import { getMuxSyncReport, setMuxSyncReport } from "@/lib/mux-sync-report"
import { getJob, updateJob } from "@/lib/state"
import { applySubtitleOverride } from "@/services/mux-sync"
import type { MuxSyncComparison, MuxSyncReport } from "@/types/job"

const requestBodySchema = z.object({
  artifactKey: z.string().min(1).startsWith("subtitles-"),
  targetLanguage: z.string().min(1),
})

function sortComparisons(
  left: MuxSyncComparison,
  right: MuxSyncComparison,
): number {
  if (left.targetLanguage === right.targetLanguage) {
    return left.artifactKey.localeCompare(right.artifactKey)
  }

  return left.targetLanguage.localeCompare(right.targetLanguage)
}

function buildOverrideComparisonReport(
  report: MuxSyncReport,
  comparison: MuxSyncComparison,
  input: {
    status: MuxSyncComparison["status"]
    explanation: string
    canOverride: boolean
  },
): MuxSyncReport {
  const updatedAt = new Date().toISOString()
  const nextComparison: MuxSyncComparison = {
    ...comparison,
    status: input.status,
    explanation: input.explanation,
    canOverride: input.canOverride,
    updatedAt,
  }

  return {
    comparisons: [
      ...report.comparisons.filter(
        (candidate) =>
          !(
            candidate.artifactKey === comparison.artifactKey &&
            candidate.targetLanguage === comparison.targetLanguage
          ),
      ),
      nextComparison,
    ].sort(sortComparisons),
    overrideHistory: report.overrideHistory ?? [],
    updatedAt,
  }
}

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

  if (
    !previousReport ||
    !existingComparison ||
    existingComparison.canOverride !== true
  ) {
    return NextResponse.json(
      { error: "Subtitle track is not overrideable" },
      { status: 409 },
    )
  }

  const currentReport = previousReport

  try {
    const pendingReport = buildOverrideComparisonReport(
      currentReport,
      existingComparison,
      {
        status: "override_pending",
        explanation: `Override requested for ${parsedBody.data.targetLanguage} subtitles. Waiting for Mux confirmation.`,
        canOverride: false,
      },
    )
    const pendingJob = await updateJob(job.id, {
      artifacts: setMuxSyncReport(job.artifacts, pendingReport),
    })

    if (!pendingJob) {
      return NextResponse.json(
        { error: "Failed to persist subtitle override request" },
        { status: 500 },
      )
    }

    const nextReport = await applySubtitleOverride({
      jobId: job.id,
      assetId: job.muxAssetId,
      muxAssetId: job.muxAssetId,
      artifactKey: parsedBody.data.artifactKey,
      targetLanguage: parsedBody.data.targetLanguage,
      previousReport: pendingReport,
    })

    const updatedJob = await updateJob(job.id, {
      artifacts: setMuxSyncReport(pendingJob.artifacts, nextReport),
    })

    if (!updatedJob) {
      const updatedComparison =
        nextReport.comparisons.find(
          (comparison) =>
            comparison.artifactKey === parsedBody.data.artifactKey &&
            comparison.targetLanguage === parsedBody.data.targetLanguage,
        ) ?? existingComparison
      const reconciliationReport = buildOverrideComparisonReport(
        nextReport,
        updatedComparison,
        {
          status: "reconciliation_required",
          explanation:
            "Mux subtitles were replaced, but the job report could not be finalized. Re-run the override or reconcile this job manually.",
          canOverride: true,
        },
      )
      const reconciliationJob = await updateJob(job.id, {
        artifacts: setMuxSyncReport(pendingJob.artifacts, reconciliationReport),
      })

      return NextResponse.json(
        {
          error:
            "Subtitle override applied on Mux, but the job report needs reconciliation",
          job: reconciliationJob ?? pendingJob,
          report: reconciliationJob ? reconciliationReport : pendingReport,
          reconciliationRequired: true,
        },
        { status: 500 },
      )
    }

    return NextResponse.json({
      job: updatedJob,
      report: nextReport,
    })
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Failed to override subtitle track"
    const failedReport = buildOverrideComparisonReport(
      currentReport,
      existingComparison,
      {
        status: "failed",
        explanation: `Subtitle override failed: ${errorMessage}`,
        canOverride: true,
      },
    )
    const failedJob = await updateJob(job.id, {
      artifacts: setMuxSyncReport(job.artifacts, failedReport),
    })

    return NextResponse.json(
      {
        error: errorMessage,
        job: failedJob ?? undefined,
        report: failedJob ? failedReport : undefined,
      },
      { status: 500 },
    )
  }
}
