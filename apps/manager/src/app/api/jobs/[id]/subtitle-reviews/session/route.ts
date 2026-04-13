import { z } from "zod"
import { authenticateManagerOverrideRequest } from "@/lib/auth"
import { createSubtitleReviewSession } from "@/services/subtitleReview"
import {
  noStoreJson,
  requireSubtitleReviewConfigurationResponse,
} from "../response"

const requestBodySchema = z.object({
  artifactKey: z.string().min(1).startsWith("subtitles-"),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await authenticateManagerOverrideRequest(request)
  if (actor instanceof Response) {
    return actor
  }

  const configError = requireSubtitleReviewConfigurationResponse()
  if (configError) {
    return configError
  }

  const parsedBody = requestBodySchema.safeParse(
    await request.json().catch(() => null),
  )
  if (!parsedBody.success) {
    return noStoreJson(
      { error: "Invalid subtitle review request" },
      { status: 400 },
    )
  }

  const { id } = await params

  try {
    const session = await createSubtitleReviewSession({
      jobId: id,
      sourceArtifactKey: parsedBody.data.artifactKey,
      actorId: actor.approvedByUserId,
    })

    return noStoreJson({
      editorUrl: session.editorUrl,
      sourceArtifactKey: session.sourceArtifactKey,
      targetLanguage: session.targetLanguage,
      baseArtifactKey: session.baseArtifactKey,
      expiresAt: session.expiresAt,
    })
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message : "persist_failed"
    const status =
      reason === "job_not_found" || reason === "artifact_not_found"
        ? 404
        : reason === "invalid_artifact"
          ? 400
          : 500

    return noStoreJson({ error: reason }, { status })
  }
}
