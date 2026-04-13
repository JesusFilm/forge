import { z } from "zod"
import { exchangeSubtitleReviewLaunchCode } from "@/services/subtitleReview"
import {
  corsHeaders,
  failureResponse,
  noStoreJson,
  preflightResponse,
  requireEditorCorsHeaders,
} from "../../response"

const requestBodySchema = z.object({
  launchCode: z.string().min(1),
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
  const parsedBody = requestBodySchema.safeParse(
    await request.json().catch(() => null),
  )
  if (!parsedBody.success) {
    return noStoreJson(
      { error: "Invalid exchange request" },
      { status: 400, headers },
    )
  }

  const { id } = await params
  const result = await exchangeSubtitleReviewLaunchCode({
    jobId: id,
    launchCode: parsedBody.data.launchCode,
  })

  if (!result.ok) {
    return failureResponse(result.reason, { cors: headers })
  }

  return noStoreJson(
    {
      editToken: result.editToken,
      expiresAt: result.expiresAt,
      sourceArtifactKey: result.sourceArtifactKey,
      targetLanguage: result.targetLanguage,
      baseArtifactKey: result.baseArtifactKey,
      baseFingerprint: result.baseFingerprint,
    },
    { headers },
  )
}
