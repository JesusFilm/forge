import { z } from "zod"
import { hasPermission } from "@/auth/permissions"
import { resolveAdminSessionFromRequest } from "@/auth/session"
import { prisma } from "@/db/client"
import { ForbiddenError } from "@/services/errors"
import {
  RecommendationConflictError,
  RecommendationInputError,
} from "@/services/recommendations/errors"
import { dispatchRecommendationPromotion } from "@/services/recommendations/promotion/job"
import { createRecommendationPromotionService } from "@/services/recommendations/promotion/service"

const RECENT_AUTH_MS = 15 * 60 * 1_000
const CSRF_HEADER_VALUE = "recommendation-promotion-v1"

const ApprovalInput = z
  .object({
    action: z.literal("approve_bounded"),
    manifestId: z.string().min(1).max(191),
    maxExposureBps: z.number().int().min(1).max(9_999),
  })
  .strict()

const TransitionInput = z
  .object({
    action: z.enum([
      "activate_bounded",
      "confirm_permanent",
      "manual_rollback",
    ]),
    expectedPointerGeneration: z.number().int().positive(),
    targetManifestId: z.string().min(1).max(191),
    approvalId: z.string().min(1).max(191).nullable().optional(),
    evaluationId: z.string().min(1).max(191).nullable().optional(),
    exposureCeilingBps: z.number().int().min(0).max(10_000),
  })
  .strict()

const KillSwitchInput = z
  .object({
    action: z.literal("set_kill_switch"),
    expectedPointerGeneration: z.number().int().positive(),
    enabled: z.boolean(),
    reason: z.string().trim().min(1).max(64),
  })
  .strict()

const MutationInput = z.union([ApprovalInput, TransitionInput, KillSwitchInput])

export async function POST(request: Request): Promise<Response> {
  if (!hasSameOriginCsrfProof(request)) return error(403, "csrf_failed")
  const session = await resolveAdminSessionFromRequest(request)
  if (!session) return error(401, "authentication_required")
  if (!hasPermission(session.principal, "operate:recommendation-experiments")) {
    return error(403, "permission_denied")
  }
  let input: z.infer<typeof MutationInput>
  try {
    input = MutationInput.parse(await request.json())
  } catch {
    return error(400, "invalid_input")
  }
  const recentAuthentication = isRecentlyAuthenticated(session.authenticatedAt)
  if (input.action === "confirm_permanent" && !recentAuthentication) {
    return error(401, "recent_authentication_required")
  }

  try {
    if (input.action === "approve_bounded") {
      const approval = await createRecommendationPromotionService(
        prisma,
      ).approveBoundedStage({
        actor: session.principal,
        manifestId: input.manifestId,
        maxExposureBps: input.maxExposureBps,
      })
      return Response.json(
        { ok: true, approvalId: approval.id },
        { status: 201 },
      )
    }
    if (input.action === "set_kill_switch") {
      const killSwitch = await createRecommendationPromotionService(
        prisma,
      ).setKillSwitch({
        actor: session.principal,
        expectedPointerGeneration: input.expectedPointerGeneration,
        enabled: input.enabled,
        reason: input.reason,
      })
      return Response.json({ ok: true, killSwitch }, { status: 202 })
    }
    const dispatch = await dispatchRecommendationPromotion({
      actor: session.principal,
      action: input.action,
      expectedPointerGeneration: input.expectedPointerGeneration,
      targetManifestId: input.targetManifestId,
      approvalId: input.approvalId ?? null,
      evaluationId: input.evaluationId ?? null,
      exposureCeilingBps: input.exposureCeilingBps,
      recentAuthentication,
    })
    return Response.json({ ok: true, dispatch }, { status: 202 })
  } catch (cause) {
    if (cause instanceof ForbiddenError) return error(403, "permission_denied")
    if (cause instanceof RecommendationConflictError) {
      return error(409, "stale_page")
    }
    if (cause instanceof RecommendationInputError) {
      return error(400, "transition_rejected")
    }
    return error(500, "mutation_failed")
  }
}

function hasSameOriginCsrfProof(request: Request) {
  const origin = request.headers.get("origin")
  return (
    origin === new URL(request.url).origin &&
    request.headers.get("x-forge-csrf") === CSRF_HEADER_VALUE &&
    request.headers.get("content-type")?.split(";", 1)[0] === "application/json"
  )
}

function isRecentlyAuthenticated(authenticatedAt: Date | null) {
  if (!authenticatedAt) return false
  const age = Date.now() - authenticatedAt.getTime()
  return age >= -60_000 && age <= RECENT_AUTH_MS
}

function error(status: number, code: string) {
  return Response.json({ ok: false, error: code }, { status })
}
