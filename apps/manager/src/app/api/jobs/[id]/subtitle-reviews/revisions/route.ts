import { z } from "zod"
import { saveSubtitleReviewRevision } from "@/services/subtitleReview"
import {
  corsHeaders,
  failureResponse,
  noStoreJson,
  preflightResponse,
  readBearerToken,
  requireEditorCorsHeaders,
} from "../response"

const requestBodySchema = z.object({
  baseArtifactFingerprint: z.string().min(1).optional(),
  clientSaveId: z.string().min(1),
  vtt: z.string().min(1),
})

export function OPTIONS(request: Request) {
  return preflightResponse(request)
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const corsError = requireEditorCorsHeaders(request)
  if (corsError) return corsError

  const headers = corsHeaders(request)
  const editToken = readBearerToken(request)
  if (!editToken) {
    return noStoreJson(
      { error: "Edit token required" },
      { status: 401, headers },
    )
  }

  const parsedBody = requestBodySchema.safeParse(
    await request.json().catch(() => null),
  )
  if (!parsedBody.success) {
    return noStoreJson(
      { error: "Invalid revision request" },
      { status: 400, headers },
    )
  }

  const { id } = await params
  const result = await saveSubtitleReviewRevision({
    jobId: id,
    editToken,
    baseArtifactFingerprint: parsedBody.data.baseArtifactFingerprint,
    clientSaveId: parsedBody.data.clientSaveId,
    vtt: parsedBody.data.vtt,
  })

  if (!result.ok) {
    return failureResponse(result.reason, {
      latestArtifactKey: result.latestArtifactKey,
      cors: headers,
    })
  }

  return noStoreJson(
    {
      status: result.status,
      artifactKey: result.artifactKey,
      reviewedArtifactKey: result.reviewedArtifactKey,
      revision: result.revision,
      jobId: result.jobId,
      contentFingerprint: result.contentFingerprint,
      baseArtifactFingerprint: result.baseArtifactFingerprint,
      savedAt: result.savedAt,
    },
    { status: result.status === "saved" ? 201 : 200, headers },
  )
}
