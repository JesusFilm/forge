import { createHmac, timingSafeEqual } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/
const SUBJECT_PATTERN = /^[^\s]{1,255}$/

export interface UserPlaylistErasureAuthorizer<Credential = unknown> {
  assertErasureAuthorized(credential: Credential): Promise<void> | void
}

export class UserPlaylistErasureConflictError extends Error {
  constructor(
    message = "User Playlist erasure request conflicts with durable state",
  ) {
    super(message)
    this.name = "UserPlaylistErasureConflictError"
  }
}

export class UserPlaylistErasureConfigurationError extends Error {
  constructor(message = "User Playlist erasure is not configured") {
    super(message)
    this.name = "UserPlaylistErasureConfigurationError"
  }
}

export type UserPlaylistErasureReceipt = {
  receiptId: string
  idempotencyKey: string
  lifecycleVersion: bigint
  erasedCount: number
  createdAt: Date
}

type ErasureInput = {
  ownerSubject: string
  lifecycleVersion: bigint
  idempotencyKey: string
}

export class UserPlaylistErasureService<Credential = unknown> {
  private readonly digestKey: Uint8Array

  constructor(
    private readonly prisma: PrismaClient,
    private readonly dependencies: {
      subjectDigestKey: Uint8Array
      authorizer: UserPlaylistErasureAuthorizer<Credential>
    },
  ) {
    if (dependencies.subjectDigestKey.byteLength < 32) {
      throw new UserPlaylistErasureConfigurationError(
        "Erasure subject digest key must be at least 32 bytes",
      )
    }
    this.digestKey = dependencies.subjectDigestKey
  }

  subjectDigest(ownerSubject: string): Uint8Array {
    return createHmac("sha256", this.digestKey)
      .update(ownerSubject, "utf8")
      .digest()
  }

  private validate(input: ErasureInput): void {
    if (
      !SUBJECT_PATTERN.test(input.ownerSubject) ||
      !IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey) ||
      input.lifecycleVersion < 0n
    ) {
      throw new UserPlaylistErasureConflictError("Invalid erasure request")
    }
  }

  private receiptView(row: {
    id: string
    idempotencyKey: string
    lifecycleVersion: bigint
    erasedCount: number
    createdAt: Date
  }): UserPlaylistErasureReceipt {
    return {
      receiptId: row.id,
      idempotencyKey: row.idempotencyKey,
      lifecycleVersion: row.lifecycleVersion,
      erasedCount: row.erasedCount,
      createdAt: row.createdAt,
    }
  }

  async erase(
    input: ErasureInput,
    credential: Credential,
  ): Promise<UserPlaylistErasureReceipt> {
    await this.dependencies.authorizer.assertErasureAuthorized(credential)
    this.validate(input)
    const ownerSubjectDigest = Uint8Array.from(
      this.subjectDigest(input.ownerSubject),
    )

    return this.prisma.$transaction(async (tx) => {
      const replay = await tx.userPlaylistErasureReceipt.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      })
      if (replay) {
        const stored = Buffer.from(replay.ownerSubjectDigest)
        const requested = Buffer.from(ownerSubjectDigest)
        if (
          stored.byteLength !== requested.byteLength ||
          !timingSafeEqual(stored, requested) ||
          replay.lifecycleVersion !== input.lifecycleVersion
        ) {
          throw new UserPlaylistErasureConflictError()
        }
        return this.receiptView(replay)
      }

      const [lifecycle] = await tx.$queryRaw<Array<{ matches: boolean }>>(
        Prisma.sql`
          SELECT (
            "state" = 'deleting'
            AND "version" = ${input.lifecycleVersion}
          ) AS "matches"
          FROM "consumer_lifecycle_projection"
          WHERE "owner_subject" = ${input.ownerSubject}
          FOR UPDATE
        `,
      )
      if (lifecycle?.matches !== true) {
        throw new UserPlaylistErasureConflictError(
          "Erasure requires the matching DELETING lifecycle version",
        )
      }

      await tx.userPlaylist.updateMany({
        where: { ownerSubject: input.ownerSubject },
        data: {
          shareState: "UNSHARED",
          capabilityDigest: null,
          capabilityDigestKeyId: null,
          capabilityCiphertext: null,
          capabilityEncryptionKeyId: null,
          capabilityNonce: null,
          capabilityAuthTag: null,
        },
      })
      await tx.userPlaylistReport.deleteMany({
        where: { playlist: { ownerSubject: input.ownerSubject } },
      })
      await tx.userPlaylistAudit.updateMany({
        where: { ownerSubject: input.ownerSubject },
        data: {
          ownerSubject: null,
          ownerSubjectDigest,
        },
      })
      const erased = await tx.userPlaylist.deleteMany({
        where: { ownerSubject: input.ownerSubject },
      })
      await tx.userPlaylistOwnerQuota.deleteMany({
        where: { ownerSubject: input.ownerSubject },
      })
      const removedLifecycle = await tx.consumerLifecycleProjection.deleteMany({
        where: {
          ownerSubject: input.ownerSubject,
          state: "DELETING",
          version: input.lifecycleVersion,
        },
      })
      if (removedLifecycle.count !== 1) {
        throw new UserPlaylistErasureConflictError()
      }
      const created = await tx.userPlaylistErasureReceipt.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          ownerSubjectDigest,
          lifecycleVersion: input.lifecycleVersion,
          erasedCount: erased.count,
        },
      })
      return this.receiptView(created)
    })
  }
}
