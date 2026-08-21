import { randomUUID } from "node:crypto"

import type {
  ConsumerLifecycleState,
  Prisma,
  PrismaClient,
} from "@/generated/prisma"

const ACTIVE_LEASE_MS = 5 * 60_000
const ACTIVE_RENEWAL_INTERVAL_MS = 2 * 60_000
const AUTHOR_PROVIDERS = new Set(["google", "apple"])
const PLAYLIST_SCOPES = [
  "playlist:read",
  "playlist:write",
  "playlist:share",
] as const

type ConsumerEligibilityOptions = {
  now?: () => Date
}

export type ConsumerEligibilityResult = {
  eligible: boolean
  membershipStatus: "INVITED" | "ACTIVE" | "SUSPENDED" | "DISABLED"
  state: ConsumerLifecycleState
  version: bigint
  eventId?: string
}

export class ConsumerEligibilityService {
  private readonly now: () => Date

  constructor(
    private readonly prisma: PrismaClient,
    options: ConsumerEligibilityOptions = {},
  ) {
    this.now = options.now ?? (() => new Date())
  }

  /**
   * Reconciles from persisted Auth facts only. Callback bodies and requested
   * claims never enter this boundary, and matching email is insufficient
   * without a stored Google/Apple provider-subject binding.
   */
  async reconcile(userId: string): Promise<ConsumerEligibilityResult> {
    const now = this.now()
    return this.prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            actorType: true,
            emailVerified: true,
            membershipStatus: true,
            consumerLifecycleState: true,
            consumerLifecycleVersion: true,
            consumerLifecycleRenewedAt: true,
            accounts: { select: { providerId: true, accountId: true } },
          },
        })
        if (!user) throw new Error("Consumer identity not found.")

        const eligible =
          user.actorType === "HUMAN" &&
          user.emailVerified &&
          user.accounts.some(
            (account) =>
              AUTHOR_PROVIDERS.has(account.providerId) &&
              account.accountId.length > 0,
          )
        if (
          user.consumerLifecycleState === "DELETING" ||
          user.consumerLifecycleState === "DELETED"
        ) {
          // A provider callback can race a deletion retry. Remove the newly
          // created authority again before returning so a re-link never turns
          // a terminal lifecycle into a usable account.
          await this.revokeAllAuthority(
            tx,
            user.id,
            user.consumerLifecycleState,
            now,
          )
          await tx.session.deleteMany({ where: { userId: user.id } })
          return {
            eligible: false,
            membershipStatus: user.membershipStatus,
            state: user.consumerLifecycleState,
            version: user.consumerLifecycleVersion,
          }
        }
        const membershipLifecycleState =
          user.membershipStatus === "SUSPENDED"
            ? "SUSPENDED"
            : user.membershipStatus === "DISABLED"
              ? "DISABLED"
              : null
        if (membershipLifecycleState) {
          // Revoke on every reconciliation, including an identical lifecycle,
          // so a provider callback cannot leave a newly-created session alive.
          await this.revokeAllAuthority(
            tx,
            user.id,
            membershipLifecycleState,
            now,
          )
          await tx.session.deleteMany({ where: { userId: user.id } })
          if (
            user.consumerLifecycleState === membershipLifecycleState &&
            user.consumerLifecycleVersion > 0n
          ) {
            return {
              eligible: false,
              membershipStatus: user.membershipStatus,
              state: user.consumerLifecycleState,
              version: user.consumerLifecycleVersion,
            }
          }
          return this.persistTransition(tx, user, membershipLifecycleState, now)
        }
        if (!eligible) {
          if (
            user.consumerLifecycleState === "ACTIVE" ||
            (user.consumerLifecycleState === "DISABLED" &&
              user.consumerLifecycleVersion === 0n)
          ) {
            if (user.consumerLifecycleState === "ACTIVE") {
              await this.revokePlaylistTokenFamilies(tx, user.id, now)
            }
            return this.persistTransition(tx, user, "DISABLED", now)
          }
          return {
            eligible: false,
            membershipStatus: user.membershipStatus,
            state: user.consumerLifecycleState,
            version: user.consumerLifecycleVersion,
          }
        }

        if (
          user.consumerLifecycleState !== "ACTIVE" &&
          user.consumerLifecycleState !== "DISABLED"
        ) {
          return {
            eligible: false,
            membershipStatus: user.membershipStatus,
            state: user.consumerLifecycleState,
            version: user.consumerLifecycleVersion,
          }
        }

        const leaseStillFresh =
          user.consumerLifecycleState === "ACTIVE" &&
          user.consumerLifecycleRenewedAt !== null &&
          now.getTime() - user.consumerLifecycleRenewedAt.getTime() <
            ACTIVE_RENEWAL_INTERVAL_MS
        if (leaseStillFresh) {
          return {
            eligible: true,
            membershipStatus: user.membershipStatus,
            state: "ACTIVE",
            version: user.consumerLifecycleVersion,
          }
        }

        return this.persistTransition(tx, user, "ACTIVE", now)
      },
      { isolationLevel: "Serializable" },
    )
  }

  async transition(
    userId: string,
    state: Exclude<ConsumerLifecycleState, "ACTIVE">,
  ): Promise<ConsumerEligibilityResult> {
    const now = this.now()
    return this.prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            actorType: true,
            emailVerified: true,
            membershipStatus: true,
            consumerLifecycleState: true,
            consumerLifecycleVersion: true,
            consumerLifecycleRenewedAt: true,
            accounts: { select: { providerId: true, accountId: true } },
          },
        })
        if (!user) throw new Error("Consumer identity not found.")

        await this.revokeAllAuthority(tx, userId, state, now)
        await tx.session.deleteMany({ where: { userId } })

        if (
          user.consumerLifecycleState === state &&
          user.consumerLifecycleVersion > 0n
        ) {
          return {
            eligible: false,
            membershipStatus: user.membershipStatus,
            state,
            version: user.consumerLifecycleVersion,
          }
        }

        return this.persistTransition(tx, user, state, now)
      },
      { isolationLevel: "Serializable" },
    )
  }

  private async persistTransition(
    tx: Prisma.TransactionClient,
    user: {
      id: string
      consumerLifecycleVersion: bigint
      membershipStatus: "INVITED" | "ACTIVE" | "SUSPENDED" | "DISABLED"
    },
    state: ConsumerLifecycleState,
    now: Date,
  ): Promise<ConsumerEligibilityResult> {
    const version = user.consumerLifecycleVersion + 1n
    const activeLeaseExpiresAt =
      state === "ACTIVE" ? new Date(now.getTime() + ACTIVE_LEASE_MS) : null
    const eventId = randomUUID()
    const membershipStatus =
      state === "ACTIVE" && user.membershipStatus === "INVITED"
        ? "ACTIVE"
        : user.membershipStatus

    await tx.user.update({
      where: { id: user.id },
      data: {
        ...(membershipStatus !== user.membershipStatus
          ? { membershipStatus }
          : {}),
        consumerLifecycleState: state,
        consumerLifecycleVersion: { increment: 1 },
        consumerLifecycleRenewedAt: state === "ACTIVE" ? now : null,
      },
    })
    await tx.consumerLifecycleOutbox.create({
      data: {
        id: eventId,
        ownerSubject: user.id,
        state,
        version,
        activeLeaseExpiresAt,
      },
    })

    return {
      eligible: state === "ACTIVE",
      membershipStatus,
      state,
      version,
      eventId,
    }
  }

  private async revokeAllAuthority(
    tx: Prisma.TransactionClient,
    userId: string,
    state: Exclude<ConsumerLifecycleState, "ACTIVE">,
    now: Date,
  ) {
    await tx.oauthAccessToken.deleteMany({ where: { userId } })
    await tx.oauthRefreshToken.updateMany({
      where: { userId, revoked: null },
      data: { revoked: now },
    })
    await tx.oauthConsent.deleteMany({ where: { userId } })
    await tx.deviceCode.deleteMany({ where: { userId } })
    const reason = `consumer_lifecycle_${state}`
    await tx.tokenRecord.updateMany({
      where: { userId, status: "ACTIVE" },
      data: {
        status: "REVOKED",
        revokedAt: now,
        revocationReason: reason,
      },
    })
    await tx.appGrant.updateMany({
      where: {
        userId,
        status: { in: ["PENDING", "APPROVED"] },
      },
      data: {
        status: "REVOKED",
        revokedAt: now,
        reason,
      },
    })
  }

  private async revokePlaylistTokenFamilies(
    tx: Prisma.TransactionClient,
    userId: string,
    now: Date,
  ) {
    const playlistScopes = [...PLAYLIST_SCOPES]
    await tx.oauthAccessToken.deleteMany({
      where: { userId, scopes: { hasSome: playlistScopes } },
    })
    await tx.oauthRefreshToken.updateMany({
      where: {
        userId,
        revoked: null,
        scopes: { hasSome: playlistScopes },
      },
      data: { revoked: now },
    })
  }
}

/**
 * Scheduler-facing bootstrap/renewal seam. Run at least every two minutes so
 * ACTIVE projections receive their next five-minute lease independently of
 * browser sessions or playlist-owner traffic.
 */
export class ConsumerLifecycleReconciliationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly eligibility: ConsumerEligibilityService,
  ) {}

  async reconcileBatch(input: { cursor?: string; limit?: number }) {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500)
    const users = await this.prisma.user.findMany({
      where: { actorType: "HUMAN" },
      select: {
        id: true,
        membershipStatus: true,
        consumerLifecycleState: true,
        consumerLifecycleVersion: true,
      },
      orderBy: { id: "asc" },
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      take: limit + 1,
    })
    const page = users.slice(0, limit)
    for (const user of page) {
      if (user.membershipStatus === "SUSPENDED") {
        if (
          user.consumerLifecycleState !== "SUSPENDED" ||
          user.consumerLifecycleVersion === 0n
        ) {
          await this.eligibility.transition(user.id, "SUSPENDED")
        }
        continue
      }
      if (user.membershipStatus === "DISABLED") {
        if (
          user.consumerLifecycleState !== "DISABLED" ||
          user.consumerLifecycleVersion === 0n
        ) {
          await this.eligibility.transition(user.id, "DISABLED")
        }
        continue
      }
      await this.eligibility.reconcile(user.id)
    }

    return {
      processed: page.length,
      nextCursor: users.length > limit ? (page.at(-1)?.id ?? null) : null,
    }
  }
}
