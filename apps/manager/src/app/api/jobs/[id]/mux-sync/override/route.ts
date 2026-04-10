import { NextResponse } from "next/server"
import { z } from "zod"
import { authenticateRequest } from "@/lib/auth"
import {
  canRetryMuxSyncOverride,
  isStaleOverridePending,
} from "@/lib/mux-sync-override"
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
  const now = Date.now()

  if (!previousReport || !existingComparison) {
    return NextResponse.json(
      { error: "Subtitle track is not overrideable" },
      { status: 409 },
    )
  }

  if (
    existingComparison.status === "override_pending" &&
    !isStaleOverridePending(existingComparison, now)
  ) {
    return NextResponse.json(
      { error: "Subtitle override is already in progress" },
      { status: 409 },
    )
  }

  if (!canRetryMuxSyncOverride(existingComparison, now)) {
    return NextResponse.json(
      { error: "Subtitle track is not overrideable" },
      { status: 409 },
    )
  }

  const currentReport = previousReport
  let persistedArtifacts = job.artifacts
  let workingReport = currentReport
  let workingComparison = existingComparison

  try {
    const pendingReport = buildOverrideComparisonReport(
      workingReport,
      workingComparison,
      {
        status: "override_pending",
        explanation:
          existingComparison.status === "override_pending"
            ? `Resuming interrupted override for ${parsedBody.data.targetLanguage} subtitles. Waiting for Mux confirmation.`
            : `Override requested for ${parsedBody.data.targetLanguage} subtitles. Waiting for Mux confirmation.`,
        canOverride: false,
      },
    )
    const pendingJob = await updateJob(job.id, {
      artifacts: setMuxSyncReport(persistedArtifacts, pendingReport),
    })

    if (!pendingJob) {
      return NextResponse.json(
        { error: "Failed to persist subtitle override request" },
        { status: 500 },
      )
    }
    persistedArtifacts = pendingJob.artifacts
    workingReport = pendingReport
    workingComparison =
      pendingReport.comparisons.find(
        (comparison) =>
          comparison.artifactKey === parsedBody.data.artifactKey &&
          comparison.targetLanguage === parsedBody.data.targetLanguage,
      ) ?? workingComparison

    const nextReport = await applySubtitleOverride({
      jobId: job.id,
      assetId: job.muxAssetId,
      muxAssetId: job.muxAssetId,
      artifactKey: parsedBody.data.artifactKey,
      targetLanguage: parsedBody.data.targetLanguage,
      previousReport: pendingReport,
    })

    const updatedJob = await updateJob(job.id, {
      artifacts: setMuxSyncReport(persistedArtifacts, nextReport),
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
        artifacts: setMuxSyncReport(persistedArtifacts, reconciliationReport),
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
      workingReport,
      workingComparison,
      {
        status: "failed",
        explanation: `Subtitle override failed: ${errorMessage}`,
        canOverride: true,
      },
    )
    const failedJob = await updateJob(job.id, {
      artifacts: setMuxSyncReport(persistedArtifacts, failedReport),
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
