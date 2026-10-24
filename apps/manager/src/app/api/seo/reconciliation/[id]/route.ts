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

const reconciliationSchema = z
  .object({
    action: z.enum(["BIND_EXISTING", "MARK_FAILED"]),
    remoteId: z.string().min(1).max(200).optional(),
    remoteUrl: z.string().url().max(2_048).optional(),
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
  const parsed = reconciliationSchema.safeParse(body)
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
    const reconciliation = workspace.ticketReconciliations.find(
      (candidate) => candidate.outboxId === id,
    )
    if (!reconciliation) {
      return seoMutationResponse(
        guard.actor,
        { error: "Reconciliation item not found", code: "not_found" },
        { status: 404 },
      )
    }

    let remoteId: string | undefined
    let remoteUrl: string | undefined
    if (parsed.data.action === "BIND_EXISTING") {
      const candidate = reconciliation.candidateTickets.find(
        (ticket) =>
          ticket.remoteId === parsed.data.remoteId &&
          ticket.remoteUrl === parsed.data.remoteUrl &&
          (!ticket.payloadDigest ||
            ticket.payloadDigest === reconciliation.payloadDigest),
      )
      if (!candidate) {
        return seoMutationResponse(
          guard.actor,
          {
            error: "The selected ticket is not an exact verified candidate",
            code: "candidate_mismatch",
          },
          { status: 409 },
        )
      }
      remoteId = candidate.remoteId
      remoteUrl = candidate.remoteUrl
    }

    const proposal = await client.getSeoProposal(reconciliation.proposalId)
    if (!proposal || proposal.version !== reconciliation.proposalVersion) {
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
      action: "reconcile_ticket",
      proposalId: proposal.id,
      version: proposal.version,
      payloadDigest: proposal.payloadDigest,
    })
    const updated = await client.reconcileSeoTicket({
      outboxId: id,
      action: parsed.data.action,
      remoteId,
      remoteUrl,
      assertion,
    })
    return seoMutationResponse(guard.actor, { reconciliation: updated })
  } catch (error) {
    const configurationError =
      error instanceof SeoAdminConfigurationError ||
      error instanceof SeoApprovalAssertionConfigurationError
    return seoMutationResponse(
      guard.actor,
      {
        error: configurationError
          ? error.message
          : "Admin did not complete ticket reconciliation.",
        code: configurationError ? "config_missing" : "admin_unavailable",
        retryable: !configurationError,
      },
      { status: configurationError ? 503 : 502 },
    )
  }
}
