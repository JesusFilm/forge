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

const sharedDecisionSchema = z
  .object({
    version: z.number().int().positive(),
    payloadDigest: z.string().min(1).max(256),
    overlapAcknowledged: z.boolean().default(false),
  })
  .strict()

const rejectSchema = sharedDecisionSchema.extend({
  reason: z.string().trim().min(3).max(2_000),
})

export async function handleSeoProposalDecision(
  request: Request,
  id: string,
  action: "approve" | "reject",
) {
  const guard = await guardSeoInteractiveMutation(request)
  if (guard instanceof NextResponse) return guard

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

  const parsed = (
    action === "approve" ? sharedDecisionSchema : rejectSchema
  ).safeParse(body)
  if (!parsed.success) {
    return seoMutationResponse(
      guard.actor,
      {
        error: "Validation failed",
        code: "validation_failed",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    )
  }

  try {
    const client = await createSeoAdminClient()
    const proposal = await client.getSeoProposal(id)
    if (!proposal) {
      return seoMutationResponse(
        guard.actor,
        { error: "Proposal not found", code: "not_found" },
        { status: 404 },
      )
    }

    // Sign the exact immutable version the operator saw. Admin independently
    // re-resolves the target/version and returns STALE rather than allowing
    // Manager to silently advance approval to a newer proposal.
    const assertion = await createSeoApprovalAssertion({
      actorId: guard.actor.approvedByUserId,
      action,
      proposalId: id,
      version: parsed.data.version,
      payloadDigest: parsed.data.payloadDigest,
    })
    const input = {
      proposalId: id,
      version: parsed.data.version,
      payloadDigest: parsed.data.payloadDigest,
      assertion,
      overlapAcknowledged: parsed.data.overlapAcknowledged,
    }
    const result =
      action === "approve"
        ? await client.approveSeoProposal(input)
        : await client.rejectSeoProposal({
            ...input,
            reason: (parsed.data as z.infer<typeof rejectSchema>).reason,
          })

    return seoMutationResponse(guard.actor, { result })
  } catch (error) {
    const configurationError =
      error instanceof SeoAdminConfigurationError ||
      error instanceof SeoApprovalAssertionConfigurationError
    return seoMutationResponse(
      guard.actor,
      {
        error: configurationError
          ? error.message
          : "Admin did not complete the SEO decision.",
        code: configurationError ? "config_missing" : "admin_unavailable",
        retryable: !configurationError,
      },
      { status: configurationError ? 503 : 502 },
    )
  }
}
