import { randomUUID } from "node:crypto"
import {
  Prisma,
  RecommendationPromotionEventType,
  RecommendationPromotionRunAction,
  RecommendationPromotionRunState,
  RecommendationPromotionStage,
  type PrismaClient,
} from "@prisma/client"
import { hasPermission } from "@/auth/permissions"
import type { Principal } from "@/auth/principal"
import { ForbiddenError } from "@/services/errors"
import { invalidateRecommendationCandidatePools } from "../delivery.service"
import { HYBRID_CANDIDATE_GENERATOR_SET_VERSION } from "../candidate"
import {
  RecommendationConflictError,
  RecommendationInputError,
  RecommendationInternalStateError,
} from "../errors"
import {
  digestValue,
  HYBRID_PERSONALIZED_MANIFEST_ID,
  isExactHybridPersonalizedManifest,
  isEquivalentSemanticChallenger,
  recommendationManifestDigest,
  type PromotionManifest,
} from "./manifest"
import {
  assertPromotionTransition,
  type PromotionAction,
  type PromotionStage,
} from "./policy"
import {
  applyPromotionRollbackPolicy,
  fencePromotionRun,
  openInitialHybridPersonalizedExperiment,
  promotionEventData,
  supersedeBoundedExperiment,
} from "./workflow"

const DAY_MS = 86_400_000
const APPROVAL_RETENTION_DAYS = 2_555
const RUN_RETENTION_DAYS = 365
const PROMOTION_POINTER_ID = "recommendation-promotion-pointer"

type Dependencies = Readonly<{
  prisma: PrismaClient
  now?: () => Date
  newId?: () => string
  invalidateCaches?: () => void
  injectFailure?: (point: "before_pointer" | "after_pointer") => void
}>

export type CreatePromotionRunInput = Readonly<{
  actor: Principal
  action: PromotionAction
  expectedPointerGeneration: number
  targetManifestId: string
  approvalId?: string | null
  evaluationId?: string | null
  exposureCeilingBps: number
  recentAuthentication: boolean
}>

type ExecutionResult =
  | Readonly<{
      status: "activated" | "permanent" | "rolled_back"
      generation: number
    }>
  | Readonly<{
      status: "fenced"
      reason: "run_missing" | "claim_lost" | "pointer_changed"
    }>

export class RecommendationPromotionService {
  constructor(private readonly deps: Dependencies) {}

  async approveBoundedStage(input: {
    actor: Principal
    manifestId: string
    maxExposureBps: number
  }) {
    requirePermission(input.actor, "operate:recommendation-experiments")
    if (!input.actor.id) throw new ForbiddenError("Permission denied")
    if (
      !Number.isInteger(input.maxExposureBps) ||
      input.maxExposureBps < 1 ||
      input.maxExposureBps >= 10_000
    ) {
      throw new RecommendationInputError(
        "A bounded exposure ceiling must be between 1 and 9999 basis points",
      )
    }
    const now = this.now()
    const manifest =
      await this.deps.prisma.recommendationStrategyManifest.findUnique({
        where: { id: input.manifestId },
      })
    const personalizedShadowWhere = manifest
      ? exactPersonalizedShadowAuthorizationWhere(manifest, now)
      : null
    const personalizedShadowDecision = personalizedShadowWhere
      ? await this.deps.prisma.recommendationShadowDecision.findFirst({
          where: personalizedShadowWhere,
          select: { id: true },
        })
      : null
    if (
      !manifest ||
      (!isEquivalentSemanticChallenger(manifest) &&
        (!isExactHybridPersonalizedManifest(manifest) ||
          !personalizedShadowDecision))
    ) {
      throw new RecommendationInputError(
        "Only an exact governed challenger with its required evidence may be approved in this stage",
      )
    }
    const manifestDigest = recommendationManifestDigest(manifest)
    const id = this.newId()
    return this.deps.prisma.$transaction(async (tx) => {
      const exactApproval = {
        manifestId: manifest.id,
        manifestDigest,
        maxExposureBps: input.maxExposureBps,
      }
      const created = await tx.recommendationPromotionApproval.createMany({
        data: {
          id,
          ...exactApproval,
          approvedById: input.actor.id!,
          expiresAt: new Date(now.getTime() + APPROVAL_RETENTION_DAYS * DAY_MS),
        },
        skipDuplicates: true,
      })
      const approval = await tx.recommendationPromotionApproval.findUnique({
        where: {
          manifestId_manifestDigest_maxExposureBps: exactApproval,
        },
      })
      if (!approval) {
        throw new RecommendationConflictError(
          "Promotion approval could not be reconciled",
        )
      }
      if (created.count === 0) return approval
      const pointer = await tx.recommendationPromotionPointer.findUnique({
        where: { id: PROMOTION_POINTER_ID },
      })
      if (!pointer)
        throw new RecommendationConflictError(
          "Promotion pointer is unavailable",
        )
      await tx.recommendationPromotionEvent.create({
        data: promotionEventData({
          id: this.newId(),
          dedupeKey: `approval:${approval.id}`,
          eventType: RecommendationPromotionEventType.APPROVAL_RECORDED,
          approvalId: approval.id,
          fromManifestId: pointer.activeManifestId,
          toManifestId: manifest.id,
          fromStage: pointer.stage,
          toStage: pointer.stage,
          pointerGeneration: pointer.generation,
          exposureCeilingBps: input.maxExposureBps,
          actorClass: "admin",
          actorId: input.actor.id,
          reasonCode: "bounded_manifest_preapproved",
          inputDigest: manifestDigest,
          details: {
            approvalPolicyVersion: approval.approvalPolicyVersion,
            manifestDigest,
            maxExposureBps: input.maxExposureBps,
          },
          now,
        }),
      })
      return approval
    })
  }

  async createRun(input: CreatePromotionRunInput) {
    authorizeRunRequest(input)
    const now = this.now()
    const [pointer, approval, evaluation] = await Promise.all([
      this.deps.prisma.recommendationPromotionPointer.findUnique({
        where: { id: PROMOTION_POINTER_ID },
      }),
      input.approvalId
        ? this.deps.prisma.recommendationPromotionApproval.findUnique({
            where: { id: input.approvalId },
            include: { manifest: true },
          })
        : null,
      input.evaluationId
        ? this.deps.prisma.recommendationExperimentEvaluation.findUnique({
            where: { id: input.evaluationId },
            include: { experiment: true },
          })
        : null,
    ])
    if (!pointer || pointer.generation !== input.expectedPointerGeneration) {
      throw new RecommendationConflictError("Promotion page is stale")
    }
    const initialShadowWhere = approval
      ? exactPersonalizedShadowAuthorizationWhere(approval.manifest, now)
      : null
    const initialShadowAuthorization =
      !isRollback(input.action) &&
      input.action === "activate_bounded" &&
      pointer.stage === RecommendationPromotionStage.CONTROL &&
      pointer.exposureCeilingBps === 0 &&
      approval != null &&
      initialShadowWhere != null &&
      evaluation == null
        ? await this.deps.prisma.recommendationShadowDecision.findFirst({
            where: initialShadowWhere,
            select: { id: true },
          })
        : null
    if (!isRollback(input.action)) {
      if (!approval || (!evaluation && !initialShadowAuthorization)) {
        throw new RecommendationInputError(
          "Activation requires exact approval and either initial shadow authority or a governed live evaluation",
        )
      }
      assertRunEvidence({
        input,
        pointer,
        approval,
        evaluation,
        initialShadowAuthorization: initialShadowAuthorization != null,
        now,
      })
    }
    const runId = this.newId()
    return this.deps.prisma.$transaction(async (tx) => {
      const run = await tx.recommendationPromotionRun.create({
        data: {
          id: runId,
          action: databaseAction(input.action),
          expectedPointerGeneration: input.expectedPointerGeneration,
          targetManifestId: input.targetManifestId,
          approvalId: input.approvalId ?? null,
          evaluationId: input.evaluationId ?? null,
          exposureCeilingBps: input.exposureCeilingBps,
          requestedActorClass:
            input.actor.role === "SYSTEM" ? "workflow" : "admin",
          requestedActorId: input.actor.id,
          recentAuthenticationVerified: input.recentAuthentication,
          expiresAt: new Date(now.getTime() + RUN_RETENTION_DAYS * DAY_MS),
        },
      })
      if (isRollback(input.action)) {
        await tx.recommendationPromotionEvent.create({
          data: promotionEventData({
            id: this.newId(),
            dedupeKey: `rollback-request:${run.id}`,
            eventType: RecommendationPromotionEventType.ROLLBACK_REQUESTED,
            runId: run.id,
            approvalId: input.approvalId ?? null,
            evaluationId: input.evaluationId ?? null,
            fromManifestId: pointer.activeManifestId,
            toManifestId: pointer.lastKnownGoodManifestId,
            fromStage: pointer.stage,
            toStage: RecommendationPromotionStage.CONTROL,
            pointerGeneration: pointer.generation,
            exposureCeilingBps: 0,
            actorClass: input.actor.role === "SYSTEM" ? "workflow" : "admin",
            actorId: input.actor.id,
            reasonCode:
              input.action === "automatic_rollback"
                ? "guardrail_failed"
                : "manual_rollback_requested",
            inputDigest: digestValue({
              runId: run.id,
              evaluationId: input.evaluationId ?? null,
              pointerGeneration: pointer.generation,
            }),
            details: { requestedAction: input.action },
            now,
          }),
        })
      }
      return run
    })
  }

  async claimRun(input: {
    runId: string
    expectedGeneration: number
    claimId?: string
  }) {
    const claimId = input.claimId ?? randomUUID()
    const now = this.now()
    const claimed =
      await this.deps.prisma.recommendationPromotionRun.updateMany({
        where: {
          id: input.runId,
          generation: input.expectedGeneration,
          state: RecommendationPromotionRunState.PENDING,
        },
        data: {
          state: RecommendationPromotionRunState.CLAIMED,
          claimId,
          claimedAt: now,
          heartbeatAt: now,
        },
      })
    return claimed.count === 1
      ? ({ status: "claimed", claimId } as const)
      : ({ status: "fenced" } as const)
  }

  async executeClaimedRun(input: {
    runId: string
    expectedGeneration: number
    claimId: string
  }): Promise<ExecutionResult> {
    const now = this.now()
    const result = await this.deps.prisma.$transaction(
      async (tx) => {
        const run = await tx.recommendationPromotionRun.findUnique({
          where: { id: input.runId },
          include: {
            approval: { include: { manifest: true } },
            evaluation: { include: { experiment: true } },
          },
        })
        if (!run) return { status: "fenced", reason: "run_missing" } as const
        if (
          run.state !== RecommendationPromotionRunState.CLAIMED ||
          run.generation !== input.expectedGeneration ||
          run.claimId !== input.claimId
        ) {
          return { status: "fenced", reason: "claim_lost" } as const
        }
        const pointer = await tx.recommendationPromotionPointer.findUnique({
          where: { id: PROMOTION_POINTER_ID },
        })
        if (!pointer || pointer.generation !== run.expectedPointerGeneration) {
          await fencePromotionRun(tx, run.id, input, now, "pointer_changed")
          return { status: "fenced", reason: "pointer_changed" } as const
        }

        const action = policyAction(run.action)
        const rollback = isRollback(action)
        const initialShadowWhere = run.approval
          ? exactPersonalizedShadowAuthorizationWhere(
              run.approval.manifest,
              now,
            )
          : null
        const initialShadowAuthorization =
          !rollback &&
          action === "activate_bounded" &&
          pointer.stage === RecommendationPromotionStage.CONTROL &&
          pointer.exposureCeilingBps === 0 &&
          run.approval != null &&
          initialShadowWhere != null &&
          run.evaluation == null
            ? await tx.recommendationShadowDecision.findFirst({
                where: initialShadowWhere,
                select: { id: true },
              })
            : null
        const transition = assertPromotionTransition({
          action,
          currentStage: policyStage(pointer.stage),
          actorClass:
            run.requestedActorClass === "admin" ? "admin" : "workflow",
          recentAuthentication: run.recentAuthenticationVerified,
          approvalMatches: rollback
            ? true
            : Boolean(
                run.approval &&
                isAuthorizedPromotionManifest(run.approval.manifest) &&
                run.approval.manifestId === run.targetManifestId &&
                run.approval.manifestDigest ===
                  recommendationManifestDigest(run.approval.manifest) &&
                run.approval.expiresAt > now &&
                (pointer.stage !== RecommendationPromotionStage.BOUNDED ||
                  pointer.activeManifestId === run.targetManifestId) &&
                (run.evaluation
                  ? run.approval.manifestId ===
                    run.evaluation.experiment.challengerManifestId
                  : initialShadowAuthorization != null),
              ),
          evaluationState: rollback
            ? "fail"
            : policyEvaluationState(run.evaluation?.state),
          guardrailsPassed: rollback
            ? false
            : guardrailsPassed(run.evaluation?.guardrails),
          initialShadowAuthorization: initialShadowAuthorization != null,
          targetAvailable: rollback
            ? true
            : Boolean(run.approval?.manifest.enabled),
          exposureCeilingBps: run.exposureCeilingBps,
          currentExposureCeilingBps: pointer.exposureCeilingBps,
          approvedCeilingBps: run.approval?.maxExposureBps ?? 0,
          killSwitchEnabled: pointer.killSwitchEnabled,
        })
        const nextGeneration = pointer.generation + 1
        const nextManifestId = rollback
          ? pointer.lastKnownGoodManifestId
          : run.targetManifestId
        this.deps.injectFailure?.("before_pointer")
        const updated = await tx.recommendationPromotionPointer.updateMany({
          where: { id: pointer.id, generation: pointer.generation },
          data: {
            activeManifestId: nextManifestId,
            activeApprovalId: rollback ? null : run.approvalId,
            stage: databaseStage(transition.nextStage),
            exposureCeilingBps: transition.nextExposureCeilingBps,
            generation: nextGeneration,
            reasonCode: rollback
              ? "last_known_good_restored"
              : action === "confirm_permanent"
                ? "permanent_default_confirmed"
                : "bounded_stage_active",
          },
        })
        if (updated.count !== 1) {
          await fencePromotionRun(tx, run.id, input, now, "pointer_changed")
          return { status: "fenced", reason: "pointer_changed" } as const
        }
        this.deps.injectFailure?.("after_pointer")

        const initialHybridExperiment =
          initialShadowAuthorization && run.approval
            ? await openInitialHybridPersonalizedExperiment(tx, {
                runId: run.id,
                surfaceVersion: run.approval.manifest.surfaceVersion,
                controlManifestId: pointer.lastKnownGoodManifestId,
                challengerManifestId: nextManifestId,
                challengerProbability:
                  transition.nextExposureCeilingBps / 10_000,
                approvalId: run.approval.id,
                shadowDecisionId: initialShadowAuthorization.id,
                now,
              })
            : null

        const rollbackCounts = rollback
          ? await applyPromotionRollbackPolicy(tx, {
              runId: run.id,
              experimentId: run.evaluation?.experiment.id ?? null,
              experimentGeneration:
                run.evaluation?.experiment.generation ?? null,
              activeManifestId: pointer.activeManifestId,
              pointerGeneration: nextGeneration,
              now,
            })
          : null
        const permanentCounts =
          action === "confirm_permanent" && run.evaluation
            ? await supersedeBoundedExperiment(tx, {
                currentRunId: run.id,
                experimentId: run.evaluation.experiment.id,
                experimentGeneration: run.evaluation.experiment.generation,
                pointerGeneration: nextGeneration,
                now,
              })
            : null
        const eventType = rollback
          ? RecommendationPromotionEventType.ROLLBACK_COMPLETED
          : action === "confirm_permanent"
            ? RecommendationPromotionEventType.PERMANENT_CONFIRMED
            : RecommendationPromotionEventType.ACTIVATION_EFFECTIVE
        await tx.recommendationPromotionEvent.create({
          data: promotionEventData({
            id: this.newId(),
            dedupeKey: `${eventType.toLowerCase()}:${run.id}`,
            eventType,
            runId: run.id,
            approvalId: run.approvalId,
            evaluationId: run.evaluationId,
            fromManifestId: pointer.activeManifestId,
            toManifestId: nextManifestId,
            fromStage: pointer.stage,
            toStage: databaseStage(transition.nextStage),
            pointerGeneration: nextGeneration,
            exposureCeilingBps: transition.nextExposureCeilingBps,
            actorClass: run.requestedActorClass,
            actorId: run.requestedActorId,
            reasonCode: rollback
              ? "last_known_good_restored"
              : action === "confirm_permanent"
                ? "human_permanent_confirmation"
                : initialShadowAuthorization
                  ? "bounded_hybrid_shadow_authorized"
                  : "bounded_evaluation_passed",
            inputDigest: digestValue({
              runId: run.id,
              approvalDigest: run.approval?.manifestDigest ?? null,
              evaluationDigest: run.evaluation?.inputDigest ?? null,
              pointerGeneration: pointer.generation,
            }),
            details: rollbackCounts ?? {
              approvedCeilingBps: run.approval?.maxExposureBps,
              evaluationState: run.evaluation?.state,
              guardrailsPassed: guardrailsPassed(run.evaluation?.guardrails),
              initialHybridExperiment,
              permanentFence: permanentCounts,
            },
            now,
          }),
        })
        const completed = await tx.recommendationPromotionRun.updateMany({
          where: {
            id: run.id,
            generation: input.expectedGeneration,
            claimId: input.claimId,
            state: RecommendationPromotionRunState.CLAIMED,
          },
          data: {
            state: RecommendationPromotionRunState.COMPLETED,
            completedAt: now,
          },
        })
        if (completed.count !== 1) {
          throw new RecommendationInternalStateError("promotion_claim_lost")
        }
        return {
          status: rollback
            ? ("rolled_back" as const)
            : action === "confirm_permanent"
              ? ("permanent" as const)
              : ("activated" as const),
          generation: nextGeneration,
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    if (result.status !== "fenced") {
      ;(this.deps.invalidateCaches ?? invalidateRecommendationCandidatePools)()
    }
    return result
  }

  async setKillSwitch(input: {
    actor: Principal
    expectedPointerGeneration: number
    enabled: boolean
    reason: string
  }) {
    requirePermission(input.actor, "rollback:recommendations")
    if (!input.actor.id) throw new ForbiddenError("Permission denied")
    const reason = input.reason.trim().slice(0, 64)
    if (!reason)
      throw new RecommendationInputError("A kill-switch reason is required")
    const now = this.now()
    const result = await this.deps.prisma.$transaction(
      async (tx) => {
        const pointer = await tx.recommendationPromotionPointer.findUnique({
          where: { id: PROMOTION_POINTER_ID },
        })
        if (
          !pointer ||
          pointer.generation !== input.expectedPointerGeneration
        ) {
          throw new RecommendationConflictError("Promotion page is stale")
        }
        if (pointer.killSwitchEnabled === input.enabled) {
          return {
            enabled: input.enabled,
            generation: pointer.generation,
            changed: false,
          } as const
        }
        const nextGeneration = pointer.generation + 1
        const updated = await tx.recommendationPromotionPointer.updateMany({
          where: { id: pointer.id, generation: pointer.generation },
          data: {
            killSwitchEnabled: input.enabled,
            generation: nextGeneration,
            reasonCode: input.enabled ? reason : "kill_switch_cleared",
          },
        })
        if (updated.count !== 1) {
          throw new RecommendationConflictError("Promotion page is stale")
        }

        let influenceFence: Awaited<
          ReturnType<typeof applyPromotionRollbackPolicy>
        > | null = null
        if (input.enabled) {
          const experiment = await tx.recommendationExperiment.findFirst({
            where: {
              challengerManifestId: pointer.activeManifestId,
              state: "ACTIVE",
            },
            select: { id: true, generation: true },
          })
          influenceFence = await applyPromotionRollbackPolicy(tx, {
            runId: `kill-switch:${nextGeneration}`,
            experimentId: experiment?.id ?? null,
            experimentGeneration: experiment?.generation ?? null,
            activeManifestId: pointer.activeManifestId,
            pointerGeneration: nextGeneration,
            now,
          })
        }
        await tx.recommendationPromotionEvent.create({
          data: promotionEventData({
            id: this.newId(),
            dedupeKey: `kill-switch:${input.enabled ? "enabled" : "cleared"}:${nextGeneration}`,
            eventType: input.enabled
              ? RecommendationPromotionEventType.KILL_SWITCH_ENABLED
              : RecommendationPromotionEventType.KILL_SWITCH_CLEARED,
            fromManifestId: pointer.activeManifestId,
            toManifestId: pointer.activeManifestId,
            fromStage: pointer.stage,
            toStage: pointer.stage,
            pointerGeneration: nextGeneration,
            exposureCeilingBps: pointer.exposureCeilingBps,
            actorClass: "admin",
            actorId: input.actor.id,
            reasonCode: reason,
            inputDigest: digestValue({
              enabled: input.enabled,
              expectedPointerGeneration: input.expectedPointerGeneration,
              reason,
            }),
            details: influenceFence ?? { resumedExistingStage: true },
            now,
          }),
        })
        return {
          enabled: input.enabled,
          generation: nextGeneration,
          changed: true,
        } as const
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    if (result.changed) {
      ;(this.deps.invalidateCaches ?? invalidateRecommendationCandidatePools)()
    }
    return result
  }

  async failClaimedRun(input: {
    runId: string
    expectedGeneration: number
    claimId: string
    reason: string
  }) {
    const now = this.now()
    return this.deps.prisma.$transaction(async (tx) => {
      const failed = await tx.recommendationPromotionRun.updateMany({
        where: {
          id: input.runId,
          generation: input.expectedGeneration,
          claimId: input.claimId,
          state: RecommendationPromotionRunState.CLAIMED,
        },
        data: {
          state: RecommendationPromotionRunState.FAILED,
          failureReason: input.reason.slice(0, 64),
          completedAt: now,
        },
      })
      if (failed.count !== 1) return false
      const pointer = await tx.recommendationPromotionPointer.findUnique({
        where: { id: PROMOTION_POINTER_ID },
      })
      if (pointer) {
        await tx.recommendationPromotionEvent.create({
          data: promotionEventData({
            id: this.newId(),
            dedupeKey: `transition-failed:${input.runId}`,
            eventType: RecommendationPromotionEventType.TRANSITION_FAILED,
            runId: input.runId,
            fromManifestId: pointer.activeManifestId,
            toManifestId: pointer.activeManifestId,
            fromStage: pointer.stage,
            toStage: pointer.stage,
            pointerGeneration: pointer.generation,
            exposureCeilingBps: pointer.exposureCeilingBps,
            actorClass: "workflow",
            actorId: null,
            reasonCode: input.reason.slice(0, 64),
            inputDigest: digestValue({
              runId: input.runId,
              reason: input.reason,
            }),
            details: {},
            now,
          }),
        })
      }
      return true
    })
  }

  private now() {
    return this.deps.now?.() ?? new Date()
  }

  private newId() {
    return this.deps.newId?.() ?? randomUUID()
  }
}

export function createRecommendationPromotionService(prisma: PrismaClient) {
  return new RecommendationPromotionService({ prisma })
}

export async function recordFirstEligiblePromotionExposure(
  tx: Prisma.TransactionClient,
  input: {
    effectiveManifestId: string
    requestId: string
    itemId: string
    occurredAt: Date
    receivedAt: Date
  },
) {
  const pointer = await tx.recommendationPromotionPointer.findUnique({
    where: { id: PROMOTION_POINTER_ID },
  })
  if (
    !pointer ||
    pointer.killSwitchEnabled ||
    pointer.stage === RecommendationPromotionStage.CONTROL ||
    pointer.activeManifestId !== input.effectiveManifestId
  ) {
    return false
  }
  const created = await tx.recommendationPromotionEvent.createMany({
    data: [
      promotionEventData({
        id: randomUUID(),
        dedupeKey: `first-exposure:${pointer.generation}`,
        eventType: RecommendationPromotionEventType.FIRST_ELIGIBLE_EXPOSURE,
        fromManifestId: pointer.lastKnownGoodManifestId,
        toManifestId: pointer.activeManifestId,
        fromStage: RecommendationPromotionStage.CONTROL,
        toStage: pointer.stage,
        pointerGeneration: pointer.generation,
        exposureCeilingBps: pointer.exposureCeilingBps,
        actorClass: "workflow",
        actorId: null,
        reasonCode: "first_eligible_exposure",
        inputDigest: digestValue({
          requestId: input.requestId,
          itemId: input.itemId,
          occurredAt: input.occurredAt,
        }),
        details: { receivedAt: input.receivedAt.toISOString() },
        now: input.receivedAt,
      }),
    ],
    skipDuplicates: true,
  })
  return created.count === 1
}

export { recommendationManifestDigest } from "./manifest"

function authorizeRunRequest(input: CreatePromotionRunInput) {
  if (input.action === "confirm_permanent") {
    if (input.actor.role === "SYSTEM") {
      throw new ForbiddenError(
        "Workflow principals cannot approve a permanent default",
      )
    }
    requirePermission(input.actor, "approve:recommendation-permanent")
    if (!input.recentAuthentication) {
      throw new RecommendationInputError(
        "Permanent default requires recent authentication",
      )
    }
    return
  }
  if (isRollback(input.action)) {
    if (
      input.actor.role !== "SYSTEM" &&
      !hasPermission(input.actor, "rollback:recommendations")
    ) {
      throw new ForbiddenError("Permission denied")
    }
    return
  }
  if (
    input.actor.role !== "SYSTEM" &&
    !hasPermission(input.actor, "operate:recommendation-experiments")
  ) {
    throw new ForbiddenError("Permission denied")
  }
}

function requirePermission(
  actor: Principal,
  permission:
    | "operate:recommendation-experiments"
    | "rollback:recommendations"
    | "approve:recommendation-permanent",
) {
  if (!hasPermission(actor, permission)) {
    throw new ForbiddenError("Permission denied")
  }
}

function assertRunEvidence(input: {
  input: CreatePromotionRunInput
  pointer: {
    stage: RecommendationPromotionStage
    killSwitchEnabled: boolean
    activeManifestId: string
    exposureCeilingBps: number
  }
  approval: {
    manifestId: string
    manifestDigest: string
    maxExposureBps: number
    expiresAt: Date
    manifest: Parameters<typeof recommendationManifestDigest>[0]
  }
  evaluation: {
    state: unknown
    guardrails: unknown
    experiment: { challengerManifestId: string }
  } | null
  initialShadowAuthorization: boolean
  now: Date
}) {
  const { approval, evaluation } = input
  assertPromotionTransition({
    action: input.input.action,
    currentStage: policyStage(input.pointer.stage),
    actorClass: input.input.actor.role === "SYSTEM" ? "workflow" : "admin",
    recentAuthentication: input.input.recentAuthentication,
    approvalMatches:
      isAuthorizedPromotionManifest(approval.manifest) &&
      approval.manifestId === input.input.targetManifestId &&
      (evaluation
        ? approval.manifestId === evaluation.experiment.challengerManifestId
        : input.initialShadowAuthorization) &&
      approval.manifestDigest ===
        recommendationManifestDigest(approval.manifest) &&
      approval.expiresAt > input.now &&
      (input.pointer.stage !== RecommendationPromotionStage.BOUNDED ||
        input.pointer.activeManifestId === input.input.targetManifestId),
    evaluationState: policyEvaluationState(evaluation?.state),
    guardrailsPassed: guardrailsPassed(evaluation?.guardrails),
    initialShadowAuthorization: input.initialShadowAuthorization,
    targetAvailable: approval.manifest.enabled,
    exposureCeilingBps: input.input.exposureCeilingBps,
    currentExposureCeilingBps: input.pointer.exposureCeilingBps,
    approvedCeilingBps: approval.maxExposureBps,
    killSwitchEnabled: input.pointer.killSwitchEnabled,
  })
}

function isAuthorizedPromotionManifest(manifest: PromotionManifest): boolean {
  return (
    isEquivalentSemanticChallenger(manifest) ||
    isExactHybridPersonalizedManifest(manifest)
  )
}

function exactPersonalizedShadowAuthorizationWhere(
  manifest: PromotionManifest,
  now: Date,
) {
  if (!isExactHybridPersonalizedManifest(manifest)) return null
  return {
    decision: "PROMOTE_TO_EXPERIMENT" as const,
    expiresAt: { gt: now },
    evaluation: {
      manifestId: HYBRID_PERSONALIZED_MANIFEST_ID,
      generatorVersion: HYBRID_CANDIDATE_GENERATOR_SET_VERSION,
    },
  }
}

function guardrailsPassed(value: unknown): boolean {
  return isRecord(value) && value.passed === true
}

function databaseAction(
  action: PromotionAction,
): RecommendationPromotionRunAction {
  return {
    activate_bounded: RecommendationPromotionRunAction.ACTIVATE_BOUNDED,
    confirm_permanent: RecommendationPromotionRunAction.CONFIRM_PERMANENT,
    automatic_rollback: RecommendationPromotionRunAction.AUTOMATIC_ROLLBACK,
    manual_rollback: RecommendationPromotionRunAction.MANUAL_ROLLBACK,
  }[action]
}

function policyAction(
  action: RecommendationPromotionRunAction,
): PromotionAction {
  switch (action) {
    case RecommendationPromotionRunAction.ACTIVATE_BOUNDED:
      return "activate_bounded"
    case RecommendationPromotionRunAction.CONFIRM_PERMANENT:
      return "confirm_permanent"
    case RecommendationPromotionRunAction.AUTOMATIC_ROLLBACK:
      return "automatic_rollback"
    case RecommendationPromotionRunAction.MANUAL_ROLLBACK:
      return "manual_rollback"
  }
}

function databaseStage(stage: PromotionStage): RecommendationPromotionStage {
  return {
    control: RecommendationPromotionStage.CONTROL,
    bounded: RecommendationPromotionStage.BOUNDED,
    permanent: RecommendationPromotionStage.PERMANENT,
  }[stage]
}

function policyStage(stage: RecommendationPromotionStage): PromotionStage {
  switch (stage) {
    case RecommendationPromotionStage.CONTROL:
      return "control"
    case RecommendationPromotionStage.BOUNDED:
      return "bounded"
    case RecommendationPromotionStage.PERMANENT:
      return "permanent"
  }
}

function policyEvaluationState(value: unknown) {
  return value === "PASS"
    ? ("pass" as const)
    : value === "FAIL"
      ? ("fail" as const)
      : value === "DATA_UNHEALTHY"
        ? ("data_unhealthy" as const)
        : ("inconclusive" as const)
}

function isRollback(action: PromotionAction) {
  return action === "automatic_rollback" || action === "manual_rollback"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value)
}
