import { randomUUID } from "node:crypto"
import {
  Prisma,
  type PrismaClient,
  type RecommendationCowatchRefreshGrant,
  type RecommendationCowatchRefreshAttempt,
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
import {
  digestValue,
  OWNER_APPROVED_COWATCH_MMR_MANIFEST,
  OWNER_APPROVED_COWATCH_MMR_MANIFEST_ID,
  recommendationManifestDigest,
} from "../promotion/manifest"
import {
  prepareOwnerReleaseBinding,
  readActiveOwnerRelease,
} from "../promotion/owner-authority"
import {
  assertPointerAndOverlap,
  commitPreparedOwnerRelease,
} from "../promotion/owner-operator"
import {
  assertCowatchPublicationCapacity,
  COWATCH_PUBLICATION_LOCK_ID,
  preflightCowatchShadowGeneration,
  publishCowatchShadowGeneration,
} from "./projection.service"
import {
  CowatchRefreshBudgetSchema,
  COWATCH_REFRESH_GRANT_MS,
  COWATCH_REFRESH_INTERVAL_MS,
  COWATCH_REFRESH_LEASE_MS,
  COWATCH_REFRESH_POLICY_VERSION,
  cowatchRefreshSourceWindow,
  type CowatchRefreshBudget,
} from "./refresh-policy"
import { COWATCH_SOURCE_WINDOW_VERSION } from "./source-window"

const POINTER_ID = "recommendation-promotion-pointer"
const REFRESH_LOCK_ID = 573_000_001
const configurationDigest = () =>
  digestValue(OWNER_APPROVED_COWATCH_MMR_MANIFEST.configuration)
type Authorization = { actor: Principal; authenticatedAt: Date | null }
type Attempt = RecommendationCowatchRefreshAttempt
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
    input: Authorization & {
      operationId: string
      expectedPointerGeneration: number
      budget: CowatchRefreshBudget
    },
  ) {
    const now = this.now()
    assertOperator(input.actor)
    const age = input.authenticatedAt
      ? now.getTime() - input.authenticatedAt.getTime()
      : Infinity
    if (age < -60_000 || age > 900_000)
      throw new RecommendationInputError(
        "Refresh authorization requires recent authentication",
      )
    if (
      !z.string().uuid().safeParse(input.operationId).success ||
      !Number.isInteger(input.expectedPointerGeneration) ||
      input.expectedPointerGeneration < 1
    )
      throw new RecommendationInputError("Invalid refresh operation")
    const parsed = CowatchRefreshBudgetSchema.safeParse(input.budget)
    if (!parsed.success)
      throw new RecommendationInputError("Invalid refresh capacity budget")
    const budget = parsed.data
    // Two publications/day for the complete 29-day graph lifetime, with room
    // for the initial authority. These are ceilings, never anticipated purge.
    if (
      budget.maxRetainedGenerations < 60 ||
      budget.maxRetainedGraphBytes < budget.publicationReserveBytes * 60
    )
      throw new RecommendationInputError(
        "Refresh budget does not cover retained overlap",
      )
    await this.deps.prisma.$transaction(
      async (tx) => {
        await lockRefresh(tx)
        const replay = await tx.recommendationCowatchRefreshGrant.findUnique({
          where: { id: input.operationId },
        })
        if (replay) {
          if (
            replay.approvedById !== input.actor.id ||
            replay.anchorPointerGeneration !==
              input.expectedPointerGeneration ||
            digestValue(replay.budget) !== digestValue(budget)
          )
            throw new RecommendationConflictError(
              "Refresh operation already binds another authorization",
            )
          return
        }
        // Serialize capacity with every graph publisher; no grant enables a write
        // merely because a previous observation was under its ceiling.
        const [lock] = await tx.$queryRaw<
          Array<{ locked: boolean }>
        >`SELECT pg_try_advisory_xact_lock(${COWATCH_PUBLICATION_LOCK_ID}::bigint) AS locked`
        if (!lock?.locked)
          throw new RecommendationConflictError("refresh_publication_busy")
        await assertCowatchPublicationCapacity(tx, budget)
        const selected = await tx.recommendationPromotionPointer.findUnique({
          where: { id: POINTER_ID },
          include: { activeOwnerRelease: true },
        })
        if (!selected?.activeOwnerRelease)
          throw new RecommendationConflictError(
            "Refresh requires a current active owner release",
          )
        await tx.$queryRaw`SELECT id FROM recommendation_cowatch_generation WHERE id = ${selected.activeOwnerRelease.graphGenerationId}::char(64) FOR SHARE NOWAIT`
        await tx.$queryRaw`SELECT id FROM recommendation_owner_release WHERE id = ${selected.activeOwnerRelease.id}::uuid FOR SHARE NOWAIT`
        await tx.$queryRaw`SELECT id FROM recommendation_promotion_pointer WHERE id = ${POINTER_ID} FOR SHARE NOWAIT`
        const authority = await readActiveOwnerRelease(tx, now)
        if (
          !authority ||
          authority.pointerGeneration !== input.expectedPointerGeneration
        )
          throw new RecommendationConflictError(
            "Refresh requires a current active owner release",
          )
        await tx.recommendationCowatchRefreshGrant.updateMany({
          where: { revokedAt: null },
          data: {
            revokedAt: now,
            revocationReason: "superseded_authorization",
          },
        })
        const pending = await tx.recommendationCowatchRefreshAttempt.findFirst({
          where: { status: "running" },
        })
        if (pending) {
          const committed = await tx.recommendationOwnerRelease.findUnique({
            where: { id: pending.id },
          })
          await tx.recommendationCowatchRefreshAttempt.update({
            where: { id: pending.id },
            data: committed
              ? {
                  status: "succeeded",
                  completedAt: now,
                  pointerGeneration: committed.pointerGeneration,
                }
              : {
                  status: "refused",
                  reason: "superseded_authorization",
                  completedAt: now,
                },
          })
        }
        await tx.recommendationCowatchRefreshGrant.create({
          data: {
            id: input.operationId,
            anchorReleaseId: authority.releaseId,
            anchorPointerGeneration: authority.pointerGeneration,
            influenceFloorGeneration:
              authority.binding.ownerInfluenceFloorGeneration,
            manifestDigest: authority.manifestDigest,
            configurationDigest: configurationDigest(),
            policyVersion: COWATCH_REFRESH_POLICY_VERSION,
            budget,
            approvedById: input.actor.id!,
            approvedAt: now,
            validUntil: new Date(now.getTime() + COWATCH_REFRESH_GRANT_MS),
          },
        })
      },
      { timeout: 10_000 },
    )
    return this.inspect({ operationId: input.operationId })
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
    const claimed = await this.claim()
    if (!claimed) return { status: "idle" }
    const { grant, attempt } = claimed
    let publicationStarted = false
    try {
      // Resolve a committed activation before publication or another operation.
      const committed =
        await this.deps.prisma.recommendationOwnerRelease.findUnique({
          where: { id: attempt.id },
        })
      if (committed) {
        await this.finish(
          attempt,
          "succeeded",
          null,
          committed.pointerGeneration,
        )
        this.invalidateCaches()
        return { status: "succeeded", operationId: attempt.id }
      }
      const budget = CowatchRefreshBudgetSchema.parse(grant.budget)
      const sourceWindow = {
        version: COWATCH_SOURCE_WINDOW_VERSION,
        windowStart: attempt.windowStart,
        windowEnd: attempt.windowEnd,
        evaluationAsOf: attempt.evaluationAsOf,
      }
      let generation = attempt.expectedGraphGenerationId
      if (!generation) {
        const preflight = await (
          this.deps.preflight ?? preflightCowatchShadowGeneration
        )(this.deps.prisma, this.now(), sourceWindow)
        if (preflight.status !== "ready" || !preflight.generation)
          throw new RecommendationConflictError(`refresh_${preflight.status}`)
        generation = preflight.generation
        await this.recordProgress(attempt, {
          expectedGraphGenerationId: generation,
        })
      }
      await this.assertCurrent(grant, attempt)
      publicationStarted = true
      const publication = await (
        this.deps.publish ?? publishCowatchShadowGeneration
      )(
        this.deps.prisma,
        this.now(),
        sourceWindow,
        {
          version: "cowatch-publication-admission-v1",
          expectedGeneration: generation,
          sourceWindow: {
            version: sourceWindow.version,
            windowStart: sourceWindow.windowStart.toISOString(),
            windowEnd: sourceWindow.windowEnd.toISOString(),
            evaluationAsOf: sourceWindow.evaluationAsOf.toISOString(),
          },
          limits: budget.publicationLimits,
        },
        budget,
        async (tx) => {
          await lockRefresh(tx)
          await assertAttemptCurrent(tx, attempt)
          await tx.$queryRaw`SELECT id FROM recommendation_cowatch_refresh_grant WHERE id = ${grant.id}::uuid FOR SHARE NOWAIT`
          await tx.$queryRaw`SELECT id FROM recommendation_promotion_pointer WHERE id = ${POINTER_ID} FOR SHARE NOWAIT`
          await assertGrantCurrent(
            tx,
            grant,
            attempt.expectedPointerGeneration,
            this.now(),
          )
        },
      )
      if (
        !publication.publishedAt ||
        !["published", "unchanged"].includes(publication.status)
      )
        throw new RecommendationConflictError(publication.decisionReason)
      await this.recordProgress(attempt, {
        publishedAt: publication.publishedAt,
      })
      const release = await this.deps.prisma.$transaction(
        async (tx) => {
          await lockRefresh(tx)
          const [lock] = await tx.$queryRaw<
            Array<{ acquired: boolean }>
          >`SELECT pg_try_advisory_xact_lock(hashtextextended('recommendation-owner-release-activation', 0)) AS acquired`
          if (!lock?.acquired)
            throw new RecommendationConflictError("refresh_activation_busy")
          const existing = await tx.recommendationOwnerRelease.findUnique({
            where: { id: attempt.id },
          })
          if (existing) return existing
          await assertAttemptCurrent(tx, attempt)
          await assertGrantCurrent(
            tx,
            grant,
            attempt.expectedPointerGeneration,
            this.now(),
          )
          const prepared = await prepareOwnerReleaseBinding(
            tx,
            { graphGenerationId: generation! },
            this.now(),
          )
          if (
            prepared.manifestDigest !== grant.manifestDigest ||
            prepared.binding.ownerInfluenceFloorGeneration !==
              grant.influenceFloorGeneration
          )
            throw new RecommendationConflictError(
              "refresh_configuration_changed",
            )
          const now = this.now()
          const pointer = await assertPointerAndOverlap(
            tx,
            attempt.expectedPointerGeneration,
            now,
            prepared.validUntil,
          )
          return commitPreparedOwnerRelease(tx, {
            operationId: attempt.id,
            expectedPointerGeneration: attempt.expectedPointerGeneration,
            approvedById: grant.approvedById,
            approvedAt: now,
            prepared,
            pointer,
            now,
            refreshGrantId: grant.id,
          })
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 1_000,
          timeout: 30_000,
        },
      )
      await this.finish(attempt, "succeeded", null, release.pointerGeneration)
      this.invalidateCaches()
      return { status: "succeeded", operationId: attempt.id }
    } catch (cause) {
      // A rejected COMMIT acknowledgement is not a rollback. Preserve operation
      // identity until a subsequent read proves the committed state.
      const committed = await this.deps.prisma.recommendationOwnerRelease
        .findUnique({ where: { id: attempt.id } })
        .catch(() => undefined)
      if (committed) {
        await this.finish(
          attempt,
          "succeeded",
          null,
          committed.pointerGeneration,
        )
        this.invalidateCaches()
        return { status: "succeeded", operationId: attempt.id }
      }
      if (
        committed === null &&
        !publicationStarted &&
        !(cause instanceof RecommendationConflictError)
      ) {
        await this.finish(attempt, "refused", "refresh_preflight_unavailable")
        return {
          status: "refused",
          reasonCode: "refresh_preflight_unavailable",
          operationId: attempt.id,
        }
      }
      if (
        committed === undefined ||
        !(cause instanceof RecommendationConflictError) ||
        [
          "refresh_busy",
          "refresh_activation_busy",
          "refresh_attempt_superseded",
        ].includes(cause.message) ||
        cause.message.includes("publication is already running")
      )
        return { status: "acknowledgement_unknown", operationId: attempt.id }
      const reason = /^[a-z_]{1,64}$/.test(cause.message)
        ? cause.message
        : "refresh_qualification_refused"
      await this.finish(attempt, "refused", reason)
      return { status: "refused", reasonCode: reason, operationId: attempt.id }
    }
  }

  private async claim() {
    const now = this.now()
    return this.deps.prisma.$transaction(
      async (tx) => {
        await lockRefresh(tx)
        const running = await tx.recommendationCowatchRefreshAttempt.findFirst({
          where: { status: "running" },
          include: { grant: true },
        })
        if (running) {
          if (running.leaseUntil > now) return null
          // Complete acknowledgement recovery even after a stop; never reactivate.
          const committed = await tx.recommendationOwnerRelease.findUnique({
            where: { id: running.id },
          })
          if (committed) {
            const attempt = await tx.recommendationCowatchRefreshAttempt.update(
              {
                where: { id: running.id },
                data: {
                  status: "succeeded",
                  completedAt: now,
                  pointerGeneration: committed.pointerGeneration,
                },
              },
            )
            return { grant: running.grant, attempt }
          }
          const valid = await grantCurrent(
            tx,
            running.grant,
            running.expectedPointerGeneration,
            now,
          )
          if (!valid) {
            await tx.recommendationCowatchRefreshAttempt.update({
              where: { id: running.id },
              data: {
                status: "refused",
                completedAt: now,
                reason: "refresh_authority_fenced",
              },
            })
            await revokeGrant(
              tx,
              running.grant.id,
              now,
              "refresh_authority_fenced",
            )
            return null
          }
          // Recover publication even if its post-commit attempt update was lost.
          if (running.expectedGraphGenerationId && !running.publishedAt) {
            const graph = await tx.recommendationCowatchGeneration.findUnique({
              where: { id: running.expectedGraphGenerationId },
              select: { publishedAt: true },
            })
            if (graph)
              await tx.recommendationCowatchRefreshAttempt.update({
                where: { id: running.id },
                data: { publishedAt: graph.publishedAt },
              })
          }
          const attempt = await tx.recommendationCowatchRefreshAttempt.update({
            where: { id: running.id },
            data: {
              leaseUntil: new Date(now.getTime() + COWATCH_REFRESH_LEASE_MS),
            },
          })
          return { grant: running.grant, attempt }
        }
        const grant = await tx.recommendationCowatchRefreshGrant.findFirst({
          where: { revokedAt: null },
          orderBy: { approvedAt: "desc" },
        })
        if (!grant) return null
        const success = await tx.recommendationCowatchRefreshAttempt.findFirst({
          where: { grantId: grant.id, status: "succeeded" },
          orderBy: { startedAt: "desc" },
        })
        const expected =
          success?.pointerGeneration ?? grant.anchorPointerGeneration
        if (!(await grantCurrent(tx, grant, expected, now))) {
          await revokeGrant(tx, grant.id, now, "refresh_authority_fenced")
          return null
        }
        const next = await nextAttemptTime(tx, grant)
        if (next > now) return null
        const active = await readActiveOwnerRelease(tx, now)
        if (
          active &&
          active.validUntil.getTime() >
            now.getTime() + COWATCH_REFRESH_INTERVAL_MS
        )
          return null
        const scope = cowatchRefreshSourceWindow(now)
        const attempt = await tx.recommendationCowatchRefreshAttempt.create({
          data: {
            id: randomUUID(),
            grantId: grant.id,
            expectedPointerGeneration: expected,
            windowStart: scope.windowStart,
            windowEnd: scope.windowEnd,
            evaluationAsOf: scope.evaluationAsOf,
            startedAt: now,
            leaseUntil: new Date(now.getTime() + COWATCH_REFRESH_LEASE_MS),
            status: "running",
          },
        })
        return { grant, attempt }
      },
      { timeout: 10_000 },
    )
  }

  private assertCurrent(grant: Grant, attempt: Attempt) {
    return this.deps.prisma.$transaction((tx) =>
      assertGrantCurrent(
        tx,
        grant,
        attempt.expectedPointerGeneration,
        this.now(),
      ),
    )
  }

  private async finish(
    attempt: Attempt,
    status: "succeeded" | "refused",
    reason: string | null,
    pointerGeneration?: number,
  ) {
    await this.deps.prisma.recommendationCowatchRefreshAttempt.updateMany({
      where: {
        id: attempt.id,
        status: "running",
        leaseUntil: attempt.leaseUntil,
      },
      data: {
        status,
        reason,
        completedAt: this.now(),
        ...(pointerGeneration ? { pointerGeneration } : {}),
      },
    })
  }

  private async recordProgress(
    attempt: Attempt,
    data: { expectedGraphGenerationId?: string; publishedAt?: Date },
  ) {
    const updated =
      await this.deps.prisma.recommendationCowatchRefreshAttempt.updateMany({
        where: {
          id: attempt.id,
          status: "running",
          leaseUntil: attempt.leaseUntil,
        },
        data,
      })
    if (updated.count !== 1)
      throw new RecommendationConflictError("refresh_attempt_superseded")
  }
}

async function assertAttemptCurrent(
  tx: Prisma.TransactionClient,
  attempt: Attempt,
) {
  const current = await tx.recommendationCowatchRefreshAttempt.findUnique({
    where: { id: attempt.id },
  })
  if (
    !current ||
    current.status !== "running" ||
    current.leaseUntil.getTime() !== attempt.leaseUntil.getTime()
  )
    throw new RecommendationConflictError("refresh_attempt_superseded")
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

async function grantCurrent(
  tx: Prisma.TransactionClient,
  grant: Grant,
  expectedPointerGeneration: number,
  now: Date,
) {
  const [current, pointer, manifest] = await Promise.all([
    tx.recommendationCowatchRefreshGrant.findUnique({
      where: { id: grant.id },
    }),
    tx.recommendationPromotionPointer.findUnique({ where: { id: POINTER_ID } }),
    tx.recommendationStrategyManifest.findUnique({
      where: { id: OWNER_APPROVED_COWATCH_MMR_MANIFEST_ID },
    }),
  ])
  return Boolean(
    current &&
    !current.revokedAt &&
    current.validUntil > now &&
    current.policyVersion === COWATCH_REFRESH_POLICY_VERSION &&
    current.configurationDigest === configurationDigest() &&
    manifest &&
    recommendationManifestDigest(manifest) === current.manifestDigest &&
    pointer &&
    pointer.stage === "OWNER_APPROVED" &&
    !pointer.killSwitchEnabled &&
    pointer.generation === expectedPointerGeneration &&
    pointer.ownerInfluenceFloorGeneration === grant.influenceFloorGeneration &&
    pointer.activeManifestId === OWNER_APPROVED_COWATCH_MMR_MANIFEST_ID,
  )
}

async function assertGrantCurrent(
  tx: Prisma.TransactionClient,
  grant: Grant,
  expectedPointerGeneration: number,
  now: Date,
) {
  if (!(await grantCurrent(tx, grant, expectedPointerGeneration, now)))
    throw new RecommendationConflictError("refresh_authority_fenced")
}

async function revokeGrant(
  tx: Prisma.TransactionClient,
  id: string,
  now: Date,
  reason: string,
) {
  await tx.recommendationCowatchRefreshGrant.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: now, revocationReason: reason },
  })
}
