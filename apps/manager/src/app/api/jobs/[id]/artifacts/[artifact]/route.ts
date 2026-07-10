import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"
import {
  getJobArtifactStorageAssetId,
  resolveJobArtifactDescriptor,
} from "@/lib/job-artifacts"
import { hasValidMuxArtifactAccessSignature } from "@/lib/mux-artifact-access"
import { getJob } from "@/lib/state"
import { readArtifact } from "@/services/storage"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; artifact: string }> },
) {
  const { id, artifact } = await params
  const logicalKey = decodeURIComponent(artifact)
  const url = new URL(request.url)
  const hasMuxSignature = hasValidMuxArtifactAccessSignature({
    jobId: id,
    artifactKey: logicalKey,
    expiresAt: url.searchParams.get("muxExpiresAt"),
    signature: url.searchParams.get("muxSignature"),
  })

  if (!hasMuxSignature) {
    const authError = await authenticateRequest(request)
    if (authError) return authError
  }

  const job = await getJob(id)

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 })
  }

  const entry = job.artifacts[logicalKey]
  if (!entry || entry.kind !== "downloadable") {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 })
  }

  const descriptor = resolveJobArtifactDescriptor(logicalKey)
  if (!descriptor) {
    return NextResponse.json(
      { error: "Artifact is not downloadable" },
      { status: 404 },
    )
  }

  // Smart-crop jobs store artifacts under options.smartCrop.assetId, which may
  // differ from the job's muxAssetId. Enrichment jobs keep muxAssetId.
  const body = await readArtifact(
    getJobArtifactStorageAssetId(job),
    descriptor.artifactType,
    descriptor.ext,
  )

  return new NextResponse(
    new Blob([body as Uint8Array<ArrayBuffer>], {
      type: descriptor.contentType,
    }),
    {
      headers: {
        "Content-Type": descriptor.contentType,
        "Content-Disposition": `inline; filename="${logicalKey}.${descriptor.ext}"`,
        "Cache-Control": hasMuxSignature
          ? "private, max-age=60"
          : "private, no-store",
      },
    },
  )
}
