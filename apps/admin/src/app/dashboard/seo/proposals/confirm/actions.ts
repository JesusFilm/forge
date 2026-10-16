"use server"

/**
 * feat-712 — the Admin-origin half of a Watch "Apply/Decline" opportunity.
 *
 * Watch never writes. It links here; this action re-checks the Admin session
 * and the live database role, takes the actor only from that session, and
 * hands the bound proposal id/version/digest/action to the shared decision
 * core. Its audit nonce, key, and expiry are minted server-side; immutable
 * proposal-version uniqueness and the Serializable transaction prevent a
 * second decision.
 * Form fields named actorId, nonce, or expiresAt are never read.
 */
import { redirect } from "next/navigation"
import { Prisma } from "@prisma/client"
import { requireLiveAdminSession } from "@/auth/live-admin-session"
import { SeoAssertionReplayError } from "@/auth/seo-assertion-ledger"
import { prisma } from "@/db/client"
import { ForbiddenError } from "@/services/errors"
import {
  ADMIN_SEO_DECLINE_REASON_MIN_LENGTH,
  SeoExperimentService,
  SeoLedgerConflictError,
} from "@/services/seo-experiment.service"
import {
  CONFIRM_PATH,
  confirmationHref,
  parseConfirmationIdentity,
  type ConfirmationResult,
} from "./confirmation-params"

function errorResult(error: unknown): ConfirmationResult | "DENIED" {
  if (error instanceof ForbiddenError) return "DENIED"
  if (error instanceof SeoAssertionReplayError) return "REPLAY"
  if (error instanceof SeoLedgerConflictError) {
    if (error.code === "assertion_mismatch") return "MISMATCH"
    if (error.code === "reason_required") return "REASON_REQUIRED"
    return "INVALID"
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  ) {
    return "RETRY"
  }
  console.error(
    `[seo-admin-decision] event=failed error_class=${
      error instanceof Error ? error.name : "unknown"
    }`,
  )
  return "ERROR"
}

export async function confirmSeoProposalDecision(
  formData: FormData,
): Promise<void> {
  const { actorId } = await requireLiveAdminSession()

  const identity = parseConfirmationIdentity({
    proposalId: formData.get("proposalId"),
    version: formData.get("version"),
    payloadDigest: formData.get("payloadDigest"),
    decision: formData.get("decision"),
  })
  if (!identity) redirect(`${CONFIRM_PATH}?result=INVALID`)

  const rawReason = formData.get("reason")
  const reason = typeof rawReason === "string" ? rawReason.trim() : ""
  if (
    identity.decision === "decline" &&
    reason.length < ADMIN_SEO_DECLINE_REASON_MIN_LENGTH
  ) {
    redirect(confirmationHref(identity, "REASON_REQUIRED"))
  }

  let result: ConfirmationResult | "DENIED"
  try {
    const record = await new SeoExperimentService(prisma).decideProposalAsAdmin(
      {
        actorId,
        proposalId: identity.proposalId,
        version: identity.version,
        payloadDigest: identity.payloadDigest,
        expectedAction: identity.decision === "apply" ? "approve" : "reject",
        overlapAcknowledged:
          identity.decision === "apply" &&
          formData.get("overlapAcknowledged") === "yes",
        reason: identity.decision === "decline" ? reason.slice(0, 2_000) : null,
      },
    )
    result = record.status
  } catch (error) {
    result = errorResult(error)
  }

  if (result === "DENIED") redirect("/dashboard")
  redirect(confirmationHref(identity, result))
}
