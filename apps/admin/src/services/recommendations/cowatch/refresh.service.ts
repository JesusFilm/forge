import { refuseBehavioralRecommendations } from "../behavioral-retirement"

import {
  Prisma,
  type PrismaClient,
  type RecommendationCowatchRefreshGrant,
} from "@prisma/client"
import { z } from "zod"
import { hasPermission } from "@/auth/permissions"
import type { Principal } from "@/auth/principal"
import { ForbiddenError } from "@/services/errors"
import { invalidateRecommendationCandidatePools } from "../delivery.service"
import {
  RecommendationConflictError,
  RecommendationInputError,
} from "../errors"

import { readActiveOwnerRelease } from "../promotion/owner-authority"

import {
  preflightCowatchShadowGeneration,
  publishCowatchShadowGeneration,
} from "./projection.service"
import {
  CowatchRefreshBudgetSchema,
  COWATCH_REFRESH_INTERVAL_MS,
  type CowatchRefreshBudget,
} from "./refresh-policy"

const POINTER_ID = "recommendation-promotion-pointer"
const REFRESH_LOCK_ID = 573_000_001

type Authorization = { actor: Principal; authenticatedAt: Date | null }
type Grant = RecommendationCowatchRefreshGrant

export type CowatchRefreshInspection = {
  status: string
  grant: {
    id: string
    expiresAt: Date
    revokedAt: Date | null
    reasonCode: string | null
    budget: CowatchRefreshBudget
  } | null
  latestAttempt: {
    id: string
    status: string
    reasonCode: string | null
    startedAt: Date
  } | null
  lastSuccess: {
    id: string
    completedAt: Date | null
    releaseId: string
  } | null
  currentRelease: {
    id: string
    graphGenerationId: string
    validUntil: Date
    revokedAt: Date | null
  } | null
  nextAttemptAt: Date | null
}

/** The worker acts only through a persisted, exact, recent-auth owner delegation. */
export class RecommendationCowatchRefreshService {
  constructor(
    private readonly deps: {
      prisma: PrismaClient
      now?: () => Date
      invalidateCaches?: () => void
      preflight?: typeof preflightCowatchShadowGeneration
      publish?: typeof publishCowatchShadowGeneration
    },
  ) {}

  private now() {
    return this.deps.now?.() ?? new Date()
  }

  private invalidateCaches() {
    ;(this.deps.invalidateCaches ?? invalidateRecommendationCandidatePools)()
  }

  async authorize(
    _input: Authorization & {
      operationId: string
      expectedPointerGeneration: number
      budget: CowatchRefreshBudget
    },
  ): Promise<CowatchRefreshInspection> {
    refuseBehavioralRecommendations()
  }

  async disable(input: { actor: Principal; grantId: string }) {
    assertOperator(input.actor)
    if (!z.string().uuid().safeParse(input.grantId).success)
      throw new RecommendationInputError("Invalid refresh grant")
    await this.deps.prisma.$transaction(async (tx) => {
      await lockRefresh(tx)
      await tx.recommendationCowatchRefreshGrant.updateMany({
        where: { id: input.grantId, revokedAt: null },
        data: { revokedAt: this.now(), revocationReason: "operator_stopped" },
      })
    })
    return this.inspect({ operationId: input.grantId })
  }

  async inspect(
    input: { operationId?: string } = {},
  ): Promise<CowatchRefreshInspection> {
    if (
      input.operationId &&
      !z.string().uuid().safeParse(input.operationId).success
    )
      throw new RecommendationInputError("Invalid refresh operation")
    const db = this.deps.prisma,
      now = this.now()
    const grant = input.operationId
      ? await db.recommendationCowatchRefreshGrant.findUnique({
          where: { id: input.operationId },
        })
      : ((await db.recommendationCowatchRefreshGrant.findFirst({
          where: { revokedAt: null },
        })) ??
        (await db.recommendationCowatchRefreshGrant.findFirst({
          orderBy: [
            { approvedAt: "desc" },
            { anchorPointerGeneration: "desc" },
          ],
        })))
    const pointer = await db.recommendationPromotionPointer.findUnique({
      where: { id: POINTER_ID },
      include: { activeOwnerRelease: true },
    })
    const latestAttempt = grant
      ? await db.recommendationCowatchRefreshAttempt.findFirst({
          where: { grantId: grant.id },
          orderBy: { startedAt: "desc" },
        })
      : null
    const lastSuccess = grant
      ? await db.recommendationCowatchRefreshAttempt.findFirst({
          where: { grantId: grant.id, status: "succeeded" },
          orderBy: { startedAt: "desc" },
        })
      : null
    const release = pointer?.activeOwnerRelease
    const nextAttemptAt = grant ? await nextAttemptTime(db, grant) : null
    const expected =
      latestAttempt?.status === "running" && release?.id === latestAttempt.id
        ? release.pointerGeneration
        : (lastSuccess?.pointerGeneration ?? grant?.anchorPointerGeneration)
    const fenced =
      grant &&
      (!pointer ||
        pointer.generation !== expected ||
        pointer.killSwitchEnabled ||
        pointer.stage !== "OWNER_APPROVED" ||
        pointer.ownerInfluenceFloorGeneration !==
          grant.influenceFloorGeneration)
    const authority = await readActiveOwnerRelease(db, now)
    const status = !grant
      ? "not_authorized"
      : grant.revokedAt || fenced
        ? "stopped"
        : grant.validUntil <= now
          ? "expired"
          : latestAttempt?.status === "running"
            ? "refreshing"
            : authority
              ? "ready"
              : nextAttemptAt && nextAttemptAt > now
                ? "fallback_throttled"
                : "fallback_refresh_due"
    return {
      status,
      grant: grant
        ? {
            id: grant.id,
            expiresAt: grant.validUntil,
            revokedAt: grant.revokedAt,
            reasonCode: grant.revocationReason,
            budget: CowatchRefreshBudgetSchema.parse(grant.budget),
          }
        : null,
      latestAttempt: latestAttempt
        ? {
            id: latestAttempt.id,
            status: latestAttempt.status,
            reasonCode: latestAttempt.reason,
            startedAt: latestAttempt.startedAt,
          }
        : null,
      lastSuccess: lastSuccess
        ? {
            id: lastSuccess.id,
            completedAt: lastSuccess.completedAt,
            releaseId: lastSuccess.id,
          }
        : null,
      currentRelease: release
        ? {
            id: release.id,
            graphGenerationId: release.graphGenerationId,
            validUntil: release.validUntil,
            revokedAt: release.revokedAt,
          }
        : null,
      nextAttemptAt,
    }
  }

  /** At most one bounded operation; a lease loss retries the original UUID/scope. */
  async run(): Promise<{
    status: string
    reasonCode?: string
    operationId?: string
  }> {
    return {
      status: "retired",
      reasonCode: "behavioral_recommendations_retired",
    }
  }
}

function assertOperator(actor: Principal) {
  if (
    !actor.id ||
    actor.role === "SYSTEM" ||
    actor.studioAuthority === "delegated" ||
    !hasPermission(actor, "operate:recommendation-experiments") ||
    !hasPermission(actor, "approve:recommendation-permanent")
  )
    throw new ForbiddenError("Permission denied")
}

async function lockRefresh(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`
  const [lock] = await tx.$queryRaw<
    Array<{ locked: boolean }>
  >`SELECT pg_try_advisory_xact_lock(${REFRESH_LOCK_ID}) AS locked`
  if (!lock?.locked) throw new RecommendationConflictError("refresh_busy")
}

async function nextAttemptTime(tx: Prisma.TransactionClient, grant: Grant) {
  const [attempt, graph] = await Promise.all([
    tx.recommendationCowatchRefreshAttempt.findFirst({
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    }),
    tx.recommendationCowatchGeneration.findFirst({
      orderBy: { publishedAt: "desc" },
      select: { publishedAt: true },
    }),
  ])
  return new Date(
    Math.max(
      grant.approvedAt.getTime(),
      (attempt?.startedAt.getTime() ?? 0) + COWATCH_REFRESH_INTERVAL_MS,
      (graph?.publishedAt.getTime() ?? 0) + COWATCH_REFRESH_INTERVAL_MS,
    ),
  )
}
