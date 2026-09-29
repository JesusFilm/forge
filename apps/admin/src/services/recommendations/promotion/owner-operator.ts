import { randomUUID } from "node:crypto"
import {
  Prisma,
  type PrismaClient,
  type RecommendationOwnerRelease,
} from "@prisma/client"
import { z } from "zod"
import { hasPermission } from "@/auth/permissions"
import type { Principal } from "@/auth/principal"
import { ForbiddenError } from "@/services/errors"
import {
  RecommendationConflictError,
  RecommendationInputError,
} from "../errors"
import { OWNER_APPROVED_COWATCH_MMR_MANIFEST_ID } from "./manifest"
import {
  prepareOwnerReleaseBinding,
  readActiveOwnerRelease,
} from "./owner-authority"
import { promotionEventData } from "./workflow"

const POINTER_ID = "recommendation-promotion-pointer"
const RECENT_AUTH_MS = 15 * 60 * 1_000
const REVIEWED_INPUT = z.object({
  operationId: z.string().uuid(),
  expectedPointerGeneration: z.number().int().positive(),
  graphGenerationId: z.string().regex(/^[a-f0-9]{64}$/),
})

export type OwnerReleaseOperatorInput = {
  actor: Principal
  authenticatedAt: Date | null
  operationId: string
  expectedPointerGeneration: number
  graphGenerationId: string
}

export class RecommendationOwnerReleaseOperator {
  constructor(
    private readonly deps: {
      prisma: PrismaClient
      now?: () => Date
      invalidateCaches?: () => void
    },
  ) {}

  async prepare(input: OwnerReleaseOperatorInput) {
    const startedAt = Date.now()
    const now = this.authorize(input)
    const operationNow = () =>
      new Date(now.getTime() + Math.max(0, Date.now() - startedAt))
    validateInput(input)
    return this.deps.prisma.$transaction(
      async (tx) => {
        const existing = await tx.recommendationOwnerRelease.findUnique({
          where: { id: input.operationId },
        })
        if (existing) {
          assertReplay(existing, input)
          return this.receipt(tx, existing, operationNow())
        }
        const prepared = await prepareOwnerReleaseBinding(
          tx,
          { graphGenerationId: input.graphGenerationId },
          now,
        )
        const pointer = await assertPointerAndOverlap(
          tx,
          input.expectedPointerGeneration,
          now,
          prepared.validUntil,
        )
        return {
          status: "prepared" as const,
          operationId: input.operationId,
          expectedPointerGeneration: pointer.generation,
          ...prepared,
        }
      },
      { maxWait: 1_000, timeout: 30_000 },
    )
  }

  async activate(input: OwnerReleaseOperatorInput & { bindingDigest: string }) {
    const startedAt = Date.now()
    const now = this.authorize(input)
    const operationNow = () =>
      new Date(now.getTime() + Math.max(0, Date.now() - startedAt))
    validateInput(input)
    if (!/^[a-f0-9]{64}$/.test(input.bindingDigest))
      throw new RecommendationInputError("Invalid owner release binding")
    const result = await this.deps.prisma.$transaction(
      async (tx) => {
        // Serializes direct activations, including competing UUIDs, without holding
        // a second connection or crossing an external dispatch boundary.
        const locks = await tx.$queryRaw<
          Array<{ acquired: boolean }>
        >`SELECT pg_try_advisory_xact_lock(hashtextextended('recommendation-owner-release-activation', 0)) AS acquired`
        if (!locks[0]?.acquired)
          throw new RecommendationConflictError(
            "Another owner activation is in progress",
          )
        const existing = await tx.recommendationOwnerRelease.findUnique({
          where: { id: input.operationId },
        })
        if (existing) {
          assertReplay(existing, input)
          return this.receipt(tx, existing, operationNow())
        }
        const prepared = await prepareOwnerReleaseBinding(
          tx,
          { graphGenerationId: input.graphGenerationId },
          now,
        )
        if (prepared.bindingDigest !== input.bindingDigest)
          throw new RecommendationConflictError(
            "The reviewed graph or configuration changed",
          )
        const pointer = await assertPointerAndOverlap(
          tx,
          input.expectedPointerGeneration,
          now,
          prepared.validUntil,
        )
        const generation = pointer.generation + 1
        const approvedAt = operationNow()
        const release = await tx.recommendationOwnerRelease.create({
          data: {
            id: input.operationId,
            pointerGeneration: generation,
            ...prepared,
            approvedById: input.actor.id!,
            approvedAt,
            // Minimized activation metadata follows the existing promotion audit lifetime.
            expiresAt: new Date(
              Math.max(
                prepared.rawPopulationExpiresAt.getTime(),
                approvedAt.getTime() + 2_555 * 86_400_000,
              ),
            ),
          },
        })
        const updated = await tx.recommendationPromotionPointer.updateMany({
          where: {
            id: POINTER_ID,
            generation: input.expectedPointerGeneration,
            killSwitchEnabled: false,
          },
          data: {
            activeManifestId: release.manifestId,
            activeOwnerReleaseId: release.id,
            activeApprovalId: null,
            stage: "OWNER_APPROVED",
            generation,
            exposureCeilingBps: 10_000,
            reasonCode: "owner_approved_direct_release",
          },
        })
        if (updated.count !== 1)
          throw new RecommendationConflictError("Promotion page is stale")
        await tx.recommendationPromotionEvent.create({
          data: promotionEventData({
            id: randomUUID(),
            dedupeKey: `owner-release:${release.id}`,
            eventType: "ACTIVATION_EFFECTIVE",
            fromManifestId: pointer.activeManifestId,
            toManifestId: release.manifestId,
            fromStage: pointer.stage,
            toStage: "OWNER_APPROVED",
            pointerGeneration: generation,
            exposureCeilingBps: 10_000,
            actorClass: "admin",
            actorId: input.actor.id,
            reasonCode: "owner_approved_without_trial",
            inputDigest: release.bindingDigest,
            details: {
              ownerReleaseId: release.id,
              graphGenerationId: release.graphGenerationId,
              validUntil: release.validUntil.toISOString(),
              usefulness: "unmeasured",
              refresh: "manual",
            },
            now,
          }),
        })
        return this.receipt(tx, release, operationNow())
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 1_000,
        timeout: 30_000,
      },
    )
    this.deps.invalidateCaches?.()
    return result
  }

  async reconcile(input: {
    actor: Principal
    authenticatedAt: Date | null
    operationId: string
  }) {
    if (
      !input.actor.id ||
      !hasPermission(input.actor, "operate:recommendation-experiments")
    )
      throw new ForbiddenError("Permission denied")
    const now = this.deps.now?.() ?? new Date()
    if (!z.string().uuid().safeParse(input.operationId).success)
      throw new RecommendationInputError("Invalid operation ID")
    const release =
      await this.deps.prisma.recommendationOwnerRelease.findUnique({
        where: { id: input.operationId },
      })
    if (!release)
      return { status: "not_recorded" as const, operationId: input.operationId }
    return this.receipt(this.deps.prisma, release, now)
  }

  private authorize(input: {
    actor: Principal
    authenticatedAt: Date | null
  }): Date {
    if (
      input.actor.role === "SYSTEM" ||
      input.actor.studioAuthority === "delegated" ||
      !input.actor.id ||
      !hasPermission(input.actor, "operate:recommendation-experiments") ||
      !hasPermission(input.actor, "approve:recommendation-permanent")
    )
      throw new ForbiddenError("Permission denied")
    const now = this.deps.now?.() ?? new Date()
    const age = input.authenticatedAt
      ? now.getTime() - input.authenticatedAt.getTime()
      : Infinity
    if (!Number.isFinite(age) || age < -60_000 || age > RECENT_AUTH_MS)
      throw new RecommendationInputError(
        "Owner activation requires recent authentication",
      )
    return now
  }

  private async receipt(
    tx: Prisma.TransactionClient,
    release: RecommendationOwnerRelease,
    now: Date,
  ) {
    const pointer = await tx.recommendationPromotionPointer.findUnique({
      where: { id: POINTER_ID },
    })
    const revoked =
      release.revokedAt != null ||
      release.pointerGeneration <
        (pointer?.ownerInfluenceFloorGeneration ?? Infinity)
    const authority = await readActiveOwnerRelease(tx, now)
    const status = revoked
      ? "revoked"
      : release.validUntil <= now
        ? "expired"
        : authority?.releaseId === release.id
          ? "active"
          : pointer?.activeOwnerReleaseId === release.id
            ? "unavailable"
            : "superseded"
    return {
      status,
      operationId: release.id,
      expectedPointerGeneration: release.pointerGeneration - 1,
      pointerGeneration: release.pointerGeneration,
      manifestId: release.manifestId,
      graphGenerationId: release.graphGenerationId,
      bindingDigest: release.bindingDigest,
      qualifiedAt: release.qualifiedAt,
      validUntil: release.validUntil,
      dependencyExpiresAt: release.dependencyExpiresAt,
      approvedAt: release.approvedAt,
      revocationReason: release.revocationReason,
      binding: release.binding,
    }
  }
}

function validateInput(input: OwnerReleaseOperatorInput) {
  if (!REVIEWED_INPUT.safeParse(input).success)
    throw new RecommendationInputError("Invalid owner release input")
}

function assertReplay(
  release: RecommendationOwnerRelease,
  input: OwnerReleaseOperatorInput & { bindingDigest?: string },
) {
  if (
    release.pointerGeneration !== input.expectedPointerGeneration + 1 ||
    release.graphGenerationId !== input.graphGenerationId ||
    release.manifestId !== OWNER_APPROVED_COWATCH_MMR_MANIFEST_ID ||
    release.approvedById !== input.actor.id ||
    (input.bindingDigest !== undefined &&
      release.bindingDigest !== input.bindingDigest)
  )
    throw new RecommendationConflictError(
      "Operation ID already binds another owner release",
    )
}

async function assertPointerAndOverlap(
  tx: Prisma.TransactionClient,
  expectedGeneration: number,
  now: Date,
  validUntil: Date,
) {
  const pointer = await tx.recommendationPromotionPointer.findUnique({
    where: { id: POINTER_ID },
  })
  if (!pointer || pointer.generation !== expectedGeneration)
    throw new RecommendationConflictError("Promotion page is stale")
  if (pointer.killSwitchEnabled)
    throw new RecommendationInputError("The promotion kill switch is enabled")
  const overlapping = await tx.recommendationExperiment.findFirst({
    where: {
      surfaceVersion: "watch-below-player-v1",
      state: "ACTIVE",
      expiresAt: { gt: now },
      OR: [
        { startsAt: { lt: validUntil }, endsAt: { gt: now } },
        {
          startsAt: { lt: validUntil },
          endsAt: { gt: new Date(now.getTime() - 30 * 60 * 60 * 1_000) },
          study: { is: { activatedAt: { not: null }, expiresAt: { gt: now } } },
        },
      ],
    },
    select: { id: true },
  })
  if (overlapping)
    throw new RecommendationConflictError(
      "An active experiment overlaps this direct release",
    )
  return pointer
}
