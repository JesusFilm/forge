import { verifySubtitleReviewToken } from "@/lib/subtitle-review-session"
import { z } from "zod"
import { saveSubtitleReviewRevision } from "@/services/subtitleReview"
import {
  corsHeaders,
  failureResponse,
  noStoreJson,
  readReviewJson,
  preflightResponse,
  readBearerToken,
  requireEditorCorsHeaders,
} from "../response"

const requestBodySchema = z.object({
  baseArtifactFingerprint: z.string().min(1).max(128).optional(),
  clientSaveId: z.string().min(1).max(128),
  vtt: z
    .string()
    .min(1)
    .max(512 * 1024),
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

  const { id } = await params
  const token = await verifySubtitleReviewToken(editToken)
  if (!token || token.jobId !== id)
    return failureResponse("invalid_token", { cors: headers })

  const parsedBody = requestBodySchema.safeParse(
    await readReviewJson(request, 3200000),
  )
  if (!parsedBody.success) {
    return noStoreJson(
      { error: "Invalid revision request" },
      { status: 400, headers },
    )
  }

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
