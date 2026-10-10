import { z } from "zod"
import { isTrustedReturnToOrigin } from "@/auth/origins"
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
import { readRecommendationOperatorBody } from "../operator-body"

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
    operationId: z.string().uuid().optional(),
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

const OwnerPreparationInput = z
  .object({
    action: z.literal("prepare_owner_release"),
    operationId: z.string().uuid(),
    expectedPointerGeneration: z.number().int().positive(),
    graphGenerationId: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
const OwnerActivationInput = OwnerPreparationInput.extend({
  action: z.literal("activate_owner_release"),
  bindingDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
const MutationInput = z.union([
  ApprovalInput,
  TransitionInput,
  KillSwitchInput,
  OwnerPreparationInput,
  OwnerActivationInput,
])

export async function GET(request: Request): Promise<Response> {
  const session = await resolveAdminSessionFromRequest(request)
  if (!session) return error(401, "authentication_required")
  if (!hasPermission(session.principal, "operate:recommendation-experiments"))
    return error(403, "permission_denied")
  const ownerOperationId = new URL(request.url).searchParams.get(
    "ownerOperationId",
  )
  if (ownerOperationId) {
    if (!z.string().uuid().safeParse(ownerOperationId).success)
      return error(400, "invalid_operation")
    try {
      const ownerRelease = await createRecommendationPromotionService(
        prisma,
      ).reconcileOwnerRelease({
        actor: session.principal,
        authenticatedAt: session.authenticatedAt,
        operationId: ownerOperationId,
      })
      return Response.json(
        { ok: true, ownerRelease },
        { headers: { "cache-control": "no-store" } },
      )
    } catch (cause) {
      if (cause instanceof ForbiddenError)
        return error(403, "permission_denied")
      if (cause instanceof RecommendationInputError)
        return error(400, "invalid_operation")
      return error(503, "status_unavailable")
    }
  }
  const operationId = new URL(request.url).searchParams.get("operationId")
  if (operationId && !z.string().uuid().safeParse(operationId).success)
    return error(400, "invalid_operation")
  const [pointer, run] = await Promise.all([
    prisma.recommendationPromotionPointer.findUnique({
      where: { id: "recommendation-promotion-pointer" },
      select: {
        generation: true,
        stage: true,
        killSwitchEnabled: true,
        activeManifestId: true,
      },
    }),
    operationId
      ? prisma.recommendationPromotionRun.findUnique({
          where: { id: operationId },
          select: {
            id: true,
            state: true,
            workflowRunId: true,
            failureReason: true,
            completedAt: true,
          },
        })
      : null,
  ])
  return Response.json(
    { ok: true, pointer, run },
    { headers: { "cache-control": "no-store" } },
  )
}

export async function POST(request: Request): Promise<Response> {
  if (!hasSameOriginCsrfProof(request)) return error(403, "csrf_failed")
  const session = await resolveAdminSessionFromRequest(request)
  if (!session) return error(401, "authentication_required")
  if (!hasPermission(session.principal, "operate:recommendation-experiments")) {
    return error(403, "permission_denied")
  }
  let input: z.infer<typeof MutationInput>
  const body = await readRecommendationOperatorBody(request)
  if (!body.ok) return error(body.status, body.error)
  try {
    input = MutationInput.parse(body.value)
  } catch {
    return error(400, "invalid_input")
  }
  const recentAuthentication = isRecentlyAuthenticated(session.authenticatedAt)
  const directOwnerAction =
    input.action === "prepare_owner_release" ||
    input.action === "activate_owner_release"
  if (
    directOwnerAction &&
    !hasPermission(session.principal, "approve:recommendation-permanent")
  )
    return error(403, "permission_denied")
  if (
    (input.action === "confirm_permanent" || directOwnerAction) &&
    !recentAuthentication
  ) {
    return error(401, "recent_authentication_required")
  }

  try {
    if (
      input.action === "prepare_owner_release" ||
      input.action === "activate_owner_release"
    ) {
      const service = createRecommendationPromotionService(prisma)
      const common = {
        actor: session.principal,
        authenticatedAt: session.authenticatedAt,
        operationId: input.operationId,
        expectedPointerGeneration: input.expectedPointerGeneration,
        graphGenerationId: input.graphGenerationId,
      }
      const ownerRelease =
        input.action === "prepare_owner_release"
          ? await service.prepareOwnerRelease(common)
          : await service.activateOwnerRelease({
              ...common,
              bindingDigest: input.bindingDigest,
            })
      return Response.json(
        { ok: true, ownerRelease },
        { headers: { "cache-control": "no-store" } },
      )
    }
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
      operationId: input.operationId,
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
    return error(503, "acknowledgement_unknown_reconcile_status")
  }
}

function hasSameOriginCsrfProof(request: Request) {
  const origin = request.headers.get("origin")
  return (
    isTrustedReturnToOrigin(origin) &&
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
