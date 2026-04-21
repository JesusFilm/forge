import { NextResponse } from "next/server"
import { authenticateManagerOverrideRequest } from "@/lib/auth"
import {
  buildEmbeddingSyncArtifact,
  getEmbeddingSyncReport,
} from "@/lib/embedding-sync-report"
import { getJob, mergeJobArtifacts } from "@/lib/state"
import { CmsHttpError } from "@/services/cmsClient"
import { syncEmbeddingArtifact } from "@/services/embeddingSync"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await authenticateManagerOverrideRequest(request)
  if (authResult instanceof Response) {
    return authResult
  }

  const { id } = await params
  const job = await getJob(id)
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 })
  }

  const requestBody = (await request.json().catch(() => null)) as {
    expectedGeneratedContentFingerprint?: string
    expectedExistingContentFingerprint?: string
  } | null

  const currentReport = getEmbeddingSyncReport(job.artifacts)
  if (
    !currentReport ||
    currentReport.status !== "skipped_existing" ||
    !currentReport.videoDocumentId ||
    !currentReport.generated.contentFingerprint ||
    !currentReport.cms?.contentFingerprint
  ) {
    return NextResponse.json(
      { error: "Embedding override is not available for this job" },
      { status: 400 },
    )
  }

  if (
    !requestBody?.expectedGeneratedContentFingerprint ||
    !requestBody.expectedExistingContentFingerprint
  ) {
    return NextResponse.json(
      {
        error:
          "expectedGeneratedContentFingerprint and expectedExistingContentFingerprint are required",
      },
      { status: 400 },
    )
  }

  if (
    requestBody.expectedGeneratedContentFingerprint !==
      currentReport.generated.contentFingerprint ||
    requestBody.expectedExistingContentFingerprint !==
      currentReport.cms.contentFingerprint
  ) {
    return NextResponse.json(
      {
        error: "stale_compare",
        job,
        report: currentReport,
      },
      { status: 409 },
    )
  }

  const approvedAt = new Date().toISOString()

  try {
    const report = await syncEmbeddingArtifact({
      assetId: job.muxAssetId,
      videoDocumentId: currentReport.videoDocumentId,
      mode: "override",
      expectedGeneratedContentFingerprint:
        requestBody.expectedGeneratedContentFingerprint,
      expectedExistingContentFingerprint:
        requestBody.expectedExistingContentFingerprint,
      approvedByUserId: authResult.approvedByUserId,
      approvedAt,
    })

    const updatedJob = await mergeJobArtifacts(
      job.id,
      buildEmbeddingSyncArtifact(report),
    )

    if (!updatedJob) {
      return NextResponse.json(
        { error: "Failed to persist refreshed job state" },
        { status: 500 },
      )
    }

    if (report.status !== "override_applied") {
      return NextResponse.json(
        {
          error: report.reason ?? "Failed to override embeddings",
          job: updatedJob,
          report,
        },
        { status: 500 },
      )
    }

    return NextResponse.json({ job: updatedJob, report })
  } catch (error) {
    if (error instanceof CmsHttpError && error.status === 409) {
      const refreshedReport = await syncEmbeddingArtifact({
        assetId: job.muxAssetId,
        videoDocumentId: currentReport.videoDocumentId,
        mode: "inspect",
      })

      const updatedJob = await mergeJobArtifacts(
        job.id,
        buildEmbeddingSyncArtifact(refreshedReport),
      )

      if (!updatedJob) {
        return NextResponse.json(
          { error: "Failed to persist refreshed compare state" },
          { status: 500 },
        )
      }

      return NextResponse.json(
        {
          error: "stale_compare",
          job: updatedJob,
          report: refreshedReport,
        },
        { status: 409 },
      )
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to override embeddings",
      },
      { status: 500 },
    )
  }
}
