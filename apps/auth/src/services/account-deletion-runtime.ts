import {
  getAdminUserPlaylistDeletionConfig,
  getAdminWatchProgressErasureConfig,
  getAppleNativeClientConfig,
} from "@/config/env"
import { prisma } from "@/db/client"
import { ConsumerEligibilityService } from "./consumer-eligibility.service"
import type {
  AccountDeletionDeps,
  AccountDeletionRetryStore,
} from "./account-deletion.service"

/** Production dependency composition shared by the request hook and retry job. */
export function createAccountDeletionDeps(): AccountDeletionDeps {
  const consumerEligibility = new ConsumerEligibilityService(prisma)
  return {
    beginDeleting: async (userId) => {
      const transition = await consumerEligibility.transition(
        userId,
        "DELETING",
      )
      const event = await prisma.consumerLifecycleOutbox.findUnique({
        where: {
          ownerSubject_version: {
            ownerSubject: userId,
            version: transition.version,
          },
        },
        select: {
          id: true,
          ownerSubject: true,
          state: true,
          version: true,
          activeLeaseExpiresAt: true,
          status: true,
        },
      })
      if (!event || event.state !== "DELETING") {
        throw new Error("Durable DELETING lifecycle event not found.")
      }
      return event
    },
    markLifecycleDelivered: async (eventId) => {
      await prisma.consumerLifecycleOutbox.updateMany({
        where: { id: eventId, status: { not: "DELIVERED" } },
        data: {
          status: "DELIVERED",
          deliveredAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
        },
      })
    },
    findAppleAccount: (userId) =>
      prisma.account.findFirst({
        where: { userId, providerId: "apple" },
        select: { refreshToken: true },
      }),
    getAppleConfig: getAppleNativeClientConfig,
    getAdminWatchErasureConfig: getAdminWatchProgressErasureConfig,
    getUserPlaylistDeletionConfig: getAdminUserPlaylistDeletionConfig,
  }
}

export function createAccountDeletionRetryStore(): AccountDeletionRetryStore {
  return {
    listDeleting: (limit) =>
      prisma.user
        .findMany({
          where: { consumerLifecycleState: "DELETING" },
          select: { id: true, consumerLifecycleVersion: true },
          orderBy: { updatedAt: "asc" },
          take: limit,
        })
        .then((users) =>
          users.map((user) => ({
            id: user.id,
            version: user.consumerLifecycleVersion,
          })),
        ),
    finalizeDeleting: async ({ id, version }) => {
      const deleted = await prisma.user.deleteMany({
        where: {
          id,
          consumerLifecycleState: "DELETING",
          consumerLifecycleVersion: version,
        },
      })
      if (deleted.count === 1) return

      const concurrent = await prisma.user.findUnique({
        where: { id },
        select: {
          consumerLifecycleState: true,
          consumerLifecycleVersion: true,
        },
      })
      if (concurrent) {
        throw new Error("Account deletion finalization lost its lifecycle CAS.")
      }
    },
  }
}
