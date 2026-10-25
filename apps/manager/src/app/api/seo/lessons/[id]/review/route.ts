import { NextResponse } from "next/server"
import { z } from "zod"
import {
  createSeoAdminClient,
  SeoAdminConfigurationError,
} from "@/features/seo/seo-admin-client"
import {
  createSeoApprovalAssertion,
  SeoApprovalAssertionConfigurationError,
} from "@/lib/seo-approval-assertion"
import {
  guardSeoInteractiveMutation,
  seoMutationResponse,
} from "@/lib/seo-route-guard"

const reviewSchema = z
  .object({
    status: z.enum(["ACTIVE", "SUPERSEDED", "RETIRED"]),
  })
  .strict()

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await guardSeoInteractiveMutation(request)
  if (guard instanceof NextResponse) return guard
  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return seoMutationResponse(
      guard.actor,
      { error: "Invalid JSON body", code: "invalid_json" },
      { status: 400 },
    )
  }
  const parsed = reviewSchema.safeParse(body)
  if (!parsed.success) {
    return seoMutationResponse(
      guard.actor,
      { error: "Validation failed", code: "validation_failed" },
      { status: 400 },
    )
  }

  try {
    const client = await createSeoAdminClient()
    const workspace = await client.getSeoWorkspace(50)
    const lesson = workspace.lessons.find((candidate) => candidate.id === id)
    if (!lesson) {
      return seoMutationResponse(
        guard.actor,
        { error: "Lesson not found", code: "not_found" },
        { status: 404 },
      )
    }
    const proposal = await client.getSeoProposal(lesson.proposalId)
    if (!proposal || proposal.version !== lesson.proposalVersion) {
      return seoMutationResponse(
        guard.actor,
        {
          error: "Source proposal version is unavailable",
          code: "source_unavailable",
        },
        { status: 409 },
      )
    }
    const assertion = await createSeoApprovalAssertion({
      actorId: guard.actor.approvedByUserId,
      action: "review_lesson",
      proposalId: proposal.id,
      version: proposal.version,
      payloadDigest: proposal.payloadDigest,
    })
    const updatedLesson = await client.reviewSeoLesson({
      lessonId: id,
      status: parsed.data.status,
      assertion,
    })
    return seoMutationResponse(guard.actor, { lesson: updatedLesson })
  } catch (error) {
    const configurationError =
      error instanceof SeoAdminConfigurationError ||
      error instanceof SeoApprovalAssertionConfigurationError
    return seoMutationResponse(
      guard.actor,
      {
        error: configurationError
          ? error.message
          : "Admin did not complete the learning review.",
        code: configurationError ? "config_missing" : "admin_unavailable",
        retryable: !configurationError,
      },
      { status: configurationError ? 503 : 502 },
    )
  }
}
