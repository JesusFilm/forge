import { bootstrapSubtitleReviewSession } from "@/services/subtitleReview"
import {
  corsHeaders,
  failureResponse,
  noStoreJson,
  preflightResponse,
  readBearerToken,
  requireEditorCorsHeaders,
} from "../../response"

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
  const result = await bootstrapSubtitleReviewSession({ jobId: id, editToken })

  if (!result.ok) {
    return failureResponse(result.reason, { cors: headers })
  }

  return noStoreJson(
    {
      jobId: result.jobId,
      sourceArtifactKey: result.sourceArtifactKey,
      targetLanguage: result.targetLanguage,
      baseArtifactKey: result.baseArtifactKey,
      baseFingerprint: result.baseFingerprint,
      vtt: result.vtt,
      media: result.media,
      returnUrl: result.returnUrl,
    },
    { headers },
  )
}
