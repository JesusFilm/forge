import { randomUUID } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import { ConsumerLifecycleUnavailableError } from "./consumer-lifecycle.service"
import {
  ConcurrentModificationError,
  ForbiddenError,
  InvalidInputError,
  LimitExceededError,
  NotFoundError,
  ServiceConfigurationError,
  ServiceUnavailableError,
} from "./errors"
import {
  UserPlaylistCapability,
  type UserPlaylistCapabilityMaterial,
} from "./user-playlist-capability"
import {
  CreateUserPlaylistInputSchema,
  USER_PLAYLIST_LIMITS,
  UpdateUserPlaylistInputSchema,
  UserPlaylistIdOperationSchema,
  UserPlaylistSnapshotSchema,
  VersionedUserPlaylistIdOperationSchema,
  mediaIdsFromSnapshot,
  type CreateUserPlaylistInput,
  type UpdateUserPlaylistInput,
  type UserPlaylistSnapshot,
} from "./user-playlist.schemas"

export type VerifiedViewerCountryContext = {
  integrityVerified: true
  countryCode: string | null
}

export interface UserPlaylistMediaEligibility {
  eligibleVideoIds(input: {
    videoIds: readonly string[]
    viewerCountry: VerifiedViewerCountryContext | null
  }): Promise<ReadonlySet<string>>
}

export interface UserPlaylistLifecycleAuthorizer {
  assertActive(ownerSubject: string): Promise<void>
}

export type UserPlaylistOwnerContext = {
  ownerSubject: string
  canShare?: boolean
  viewerCountry?: VerifiedViewerCountryContext | null
}

type ServiceDependencies = {
  mediaEligibility: UserPlaylistMediaEligibility
  lifecycle: UserPlaylistLifecycleAuthorizer
  capability?: UserPlaylistCapability
  policyVersions?: {
    terms: string
    privacy: string
    communityGuidelines: string
  }
  publicReadsEnabled?: () => boolean
}

export type OwnerUserPlaylist = {
  id: string
  title: string
  description: string
  locale: string
  countryCode: string | null
  version: number
  shared: boolean
  blocks: UserPlaylistSnapshot["blocks"]
  unavailableVideoIds: string[]
}

export type OwnerUserPlaylistSummary = Omit<
  OwnerUserPlaylist,
  "blocks" | "unavailableVideoIds"
>

export type PublicUserPlaylist = {
  title: string
  description: string
  locale: string
  countryCode: string | null
  blocks: UserPlaylistSnapshot["blocks"]
}

/** Internal resolver metadata; only `playlist` is GraphQL-visible. */
export type PublicUserPlaylistAccess = {
  playlist: PublicUserPlaylist
  playlistId: string
  capabilityDigest: Uint8Array
}

type PlaylistReadRow = {
  id: string
  title: string
  description: string
  contentLocale: string
  contextCountry: string | null
  version: number
  shareState: "SHARED" | "UNSHARED"
  blocks: unknown
}

type CapabilityRow = PlaylistReadRow & {
  ownerSubject: string
  moderationState: "ACTIVE" | "BLOCKED"
  capabilityTokenVersion: number
  capabilityDigest: Uint8Array | null
  capabilityDigestKeyId: string | null
  capabilityCiphertext: Uint8Array | null
  capabilityEncryptionKeyId: string | null
  capabilityNonce: Uint8Array | null
  capabilityAuthTag: Uint8Array | null
}

const MAX_SERIALIZABLE_ATTEMPTS = 3

function isP2034(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2034"
  )
}

function materialData(material: UserPlaylistCapabilityMaterial) {
  return {
    capabilityDigest: Buffer.from(material.digest),
    capabilityDigestKeyId: material.digestKeyId,
    capabilityCiphertext: Buffer.from(material.ciphertext),
    capabilityEncryptionKeyId: material.encryptionKeyId,
    capabilityNonce: Buffer.from(material.nonce),
    capabilityAuthTag: Buffer.from(material.authTag),
  }
}

function materialFromRow(row: CapabilityRow): UserPlaylistCapabilityMaterial {
  if (
    !row.capabilityDigest ||
    !row.capabilityDigestKeyId ||
    !row.capabilityCiphertext ||
    !row.capabilityEncryptionKeyId ||
    !row.capabilityNonce ||
    !row.capabilityAuthTag
  ) {
    throw new NotFoundError("User playlist capability")
  }
  return {
    digest: row.capabilityDigest,
    digestKeyId: row.capabilityDigestKeyId,
    ciphertext: row.capabilityCiphertext,
    encryptionKeyId: row.capabilityEncryptionKeyId,
    nonce: row.capabilityNonce,
    authTag: row.capabilityAuthTag,
  }
}

function publicBlocks(
  snapshot: UserPlaylistSnapshot,
  eligible: ReadonlySet<string>,
): UserPlaylistSnapshot["blocks"] {
  return snapshot.blocks.map((block) =>
    "items" in block
      ? {
          ...block,
          items: block.items.filter((item) => eligible.has(item.videoId)),
        }
      : block,
  )
}

export class UserPlaylistService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly dependencies: ServiceDependencies,
  ) {}

  private capability(): UserPlaylistCapability {
    if (!this.dependencies.capability) {
      throw new ServiceConfigurationError(
        "User Playlist capability keys are not configured",
      )
    }
    return this.dependencies.capability
  }

  private assertShareAuthority(context: UserPlaylistOwnerContext): void {
    if (context.canShare !== true) throw new ForbiddenError()
  }

  private async eligibleVideoIds(
    snapshot: UserPlaylistSnapshot,
    viewerCountry: VerifiedViewerCountryContext | null,
  ): Promise<ReadonlySet<string>> {
    try {
      return await this.dependencies.mediaEligibility.eligibleVideoIds({
        videoIds: mediaIdsFromSnapshot(snapshot),
        viewerCountry,
      })
    } catch {
      throw new ServiceUnavailableError(
        "Media eligibility is temporarily unavailable",
      )
    }
  }

  private async assertMediaEligibleForWrite(
    snapshot: UserPlaylistSnapshot,
    viewerCountry: VerifiedViewerCountryContext | null,
  ): Promise<void> {
    const ids = mediaIdsFromSnapshot(snapshot)
    const eligible = await this.eligibleVideoIds(snapshot, viewerCountry)
    if (ids.some((id) => !eligible.has(id))) {
      throw new InvalidInputError("Playlist contains unavailable media")
    }
  }

  private async ownerView(
    row: PlaylistReadRow,
    viewerCountry: VerifiedViewerCountryContext | null,
  ): Promise<OwnerUserPlaylist> {
    const snapshot = UserPlaylistSnapshotSchema.parse(row.blocks)
    const eligible = await this.eligibleVideoIds(snapshot, viewerCountry)
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      locale: row.contentLocale,
      countryCode: row.contextCountry,
      version: row.version,
      shared: row.shareState === "SHARED",
      blocks: snapshot.blocks,
      unavailableVideoIds: mediaIdsFromSnapshot(snapshot).filter(
        (id) => !eligible.has(id),
      ),
    }
  }

  private async findOwned(
    id: string,
    ownerSubject: string,
  ): Promise<CapabilityRow> {
    const row = (await this.prisma.userPlaylist.findFirst({
      where: { id, ownerSubject },
    })) as CapabilityRow | null
    if (!row) throw new NotFoundError("User playlist", id)
    return row
  }

  private assertExpectedVersion(row: CapabilityRow, expectedVersion: number) {
    if (row.version !== expectedVersion) {
      throw new ConcurrentModificationError("User playlist", row.id)
    }
  }

  async list(
    context: UserPlaylistOwnerContext,
  ): Promise<OwnerUserPlaylistSummary[]> {
    await this.dependencies.lifecycle.assertActive(context.ownerSubject)
    const rows = await this.prisma.userPlaylist.findMany({
      where: { ownerSubject: context.ownerSubject },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        title: true,
        description: true,
        contentLocale: true,
        contextCountry: true,
        version: true,
        shareState: true,
      },
    })
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      locale: row.contentLocale,
      countryCode: row.contextCountry,
      version: row.version,
      shared: row.shareState === "SHARED",
    }))
  }

  async create(
    input: CreateUserPlaylistInput,
    context: UserPlaylistOwnerContext,
  ): Promise<OwnerUserPlaylist> {
    this.assertShareAuthority(context)
    await this.dependencies.lifecycle.assertActive(context.ownerSubject)
    const parsed = CreateUserPlaylistInputSchema.parse(input)
    const current = this.dependencies.policyVersions
    if (!current) {
      throw new ServiceConfigurationError(
        "User Playlist policy versions are not configured",
      )
    }
    if (
      parsed.acceptance.termsVersion !== current.terms ||
      parsed.acceptance.privacyVersion !== current.privacy ||
      parsed.acceptance.communityGuidelinesVersion !==
        current.communityGuidelines
    ) {
      throw new InvalidInputError("Current policy acceptance is required")
    }
    await this.assertMediaEligibleForWrite(
      parsed.snapshot,
      context.viewerCountry ?? null,
    )

    const id = randomUUID()
    const createdCapability = this.capability().create(id, 1)
    let lastError: unknown
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        await this.prisma.$transaction(
          async (tx) => {
            await tx.userPlaylistOwnerQuota.upsert({
              where: { ownerSubject: context.ownerSubject },
              create: { ownerSubject: context.ownerSubject, playlistCount: 0 },
              update: {},
            })
            const admitted = await tx.userPlaylistOwnerQuota.updateMany({
              where: {
                ownerSubject: context.ownerSubject,
                playlistCount: { lt: USER_PLAYLIST_LIMITS.playlistsPerOwner },
              },
              data: { playlistCount: { increment: 1 } },
            })
            if (admitted.count !== 1) {
              throw new LimitExceededError(
                `An account may own at most ${USER_PLAYLIST_LIMITS.playlistsPerOwner} playlists`,
              )
            }
            await tx.userPlaylist.create({
              data: {
                id,
                ownerSubject: context.ownerSubject,
                title: parsed.title,
                description: parsed.description,
                contentLocale: parsed.locale,
                contextCountry: parsed.countryCode,
                blocks: parsed.snapshot as Prisma.InputJsonValue,
                version: 1,
                shareState: "SHARED",
                moderationState: "ACTIVE",
                capabilityTokenVersion: 1,
                ...materialData(createdCapability.material),
                acceptedTermsVersion: parsed.acceptance.termsVersion,
                acceptedPrivacyVersion: parsed.acceptance.privacyVersion,
                acceptedCommunityGuidelinesVersion:
                  parsed.acceptance.communityGuidelinesVersion,
              },
            })
            await tx.userPlaylistAudit.create({
              data: {
                playlistId: id,
                ownerSubject: context.ownerSubject,
                event: "created",
                version: 1,
              },
            })
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        )
        return {
          id,
          title: parsed.title,
          description: parsed.description,
          locale: parsed.locale,
          countryCode: parsed.countryCode,
          version: 1,
          shared: true,
          blocks: parsed.snapshot.blocks,
          unavailableVideoIds: [],
        }
      } catch (error) {
        lastError = error
        if (!isP2034(error) || attempt === MAX_SERIALIZABLE_ATTEMPTS)
          throw error
      }
    }
    throw lastError
  }

  async update(
    input: UpdateUserPlaylistInput,
    context: UserPlaylistOwnerContext,
  ): Promise<OwnerUserPlaylist> {
    await this.dependencies.lifecycle.assertActive(context.ownerSubject)
    const parsed = UpdateUserPlaylistInputSchema.parse(input)
    const before = await this.findOwned(parsed.id, context.ownerSubject)
    this.assertExpectedVersion(before, parsed.expectedVersion)
    await this.assertMediaEligibleForWrite(
      parsed.snapshot,
      context.viewerCountry ?? null,
    )

    const nextVersion = before.version + 1
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.userPlaylist.updateMany({
        where: {
          id: parsed.id,
          ownerSubject: context.ownerSubject,
          version: parsed.expectedVersion,
        },
        data: {
          title: parsed.title,
          description: parsed.description,
          contentLocale: parsed.locale,
          contextCountry: parsed.countryCode,
          blocks: parsed.snapshot as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      })
      if (updated.count !== 1) {
        throw new ConcurrentModificationError("User playlist", parsed.id)
      }
      await tx.userPlaylistAudit.create({
        data: {
          playlistId: parsed.id,
          ownerSubject: context.ownerSubject,
          event: "updated",
          version: nextVersion,
        },
      })
    })
    return {
      id: parsed.id,
      title: parsed.title,
      description: parsed.description,
      locale: parsed.locale,
      countryCode: parsed.countryCode,
      version: nextVersion,
      shared: before.shareState === "SHARED",
      blocks: parsed.snapshot.blocks,
      unavailableVideoIds: [],
    }
  }

  async delete(
    input: { id: string; expectedVersion: number },
    context: UserPlaylistOwnerContext,
  ): Promise<{ deleted: true }> {
    await this.dependencies.lifecycle.assertActive(context.ownerSubject)
    const parsed = VersionedUserPlaylistIdOperationSchema.parse(input)
    const before = await this.findOwned(parsed.id, context.ownerSubject)
    this.assertExpectedVersion(before, parsed.expectedVersion)

    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.userPlaylist.deleteMany({
        where: {
          id: parsed.id,
          ownerSubject: context.ownerSubject,
          version: parsed.expectedVersion,
        },
      })
      if (deleted.count !== 1) {
        throw new ConcurrentModificationError("User playlist", parsed.id)
      }
      await tx.userPlaylistOwnerQuota.updateMany({
        where: {
          ownerSubject: context.ownerSubject,
          playlistCount: { gt: 0 },
        },
        data: { playlistCount: { decrement: 1 } },
      })
      await tx.userPlaylistAudit.create({
        data: {
          playlistId: null,
          ownerSubject: context.ownerSubject,
          event: "deleted",
          version: before.version + 1,
        },
      })
    })
    return { deleted: true }
  }

  async unshare(
    input: { id: string; expectedVersion: number },
    context: UserPlaylistOwnerContext,
  ): Promise<OwnerUserPlaylist> {
    this.assertShareAuthority(context)
    await this.dependencies.lifecycle.assertActive(context.ownerSubject)
    const parsed = VersionedUserPlaylistIdOperationSchema.parse(input)
    const before = await this.findOwned(parsed.id, context.ownerSubject)
    this.assertExpectedVersion(before, parsed.expectedVersion)
    if (before.shareState !== "SHARED") {
      throw new InvalidInputError("Playlist sharing is already disabled")
    }
    const view = await this.ownerView(before, context.viewerCountry ?? null)
    const nextVersion = before.version + 1
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.userPlaylist.updateMany({
        where: {
          id: parsed.id,
          ownerSubject: context.ownerSubject,
          version: parsed.expectedVersion,
          shareState: "SHARED",
        },
        data: {
          shareState: "UNSHARED",
          capabilityDigest: null,
          capabilityDigestKeyId: null,
          capabilityCiphertext: null,
          capabilityEncryptionKeyId: null,
          capabilityNonce: null,
          capabilityAuthTag: null,
          version: { increment: 1 },
        },
      })
      if (updated.count !== 1) {
        throw new ConcurrentModificationError("User playlist", parsed.id)
      }
      await tx.userPlaylistAudit.create({
        data: {
          playlistId: parsed.id,
          ownerSubject: context.ownerSubject,
          event: "unshared",
          version: nextVersion,
        },
      })
    })
    return { ...view, version: nextVersion, shared: false }
  }

  private async replaceCapability(
    operation: "rotated" | "reshared",
    input: { id: string; expectedVersion: number },
    context: UserPlaylistOwnerContext,
  ): Promise<OwnerUserPlaylist> {
    this.assertShareAuthority(context)
    await this.dependencies.lifecycle.assertActive(context.ownerSubject)
    const parsed = VersionedUserPlaylistIdOperationSchema.parse(input)
    const before = await this.findOwned(parsed.id, context.ownerSubject)
    this.assertExpectedVersion(before, parsed.expectedVersion)
    const requiredState = operation === "rotated" ? "SHARED" : "UNSHARED"
    if (before.shareState !== requiredState) {
      throw new InvalidInputError(
        operation === "rotated"
          ? "Playlist sharing is disabled"
          : "Playlist sharing is already enabled",
      )
    }
    const view = await this.ownerView(before, context.viewerCountry ?? null)

    const tokenVersion = before.capabilityTokenVersion + 1
    const createdCapability = this.capability().create(parsed.id, tokenVersion)
    const nextVersion = before.version + 1
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.userPlaylist.updateMany({
        where: {
          id: parsed.id,
          ownerSubject: context.ownerSubject,
          version: parsed.expectedVersion,
          shareState: requiredState,
          capabilityTokenVersion: before.capabilityTokenVersion,
        },
        data: {
          shareState: "SHARED",
          capabilityTokenVersion: tokenVersion,
          ...materialData(createdCapability.material),
          version: { increment: 1 },
        },
      })
      if (updated.count !== 1) {
        throw new ConcurrentModificationError("User playlist", parsed.id)
      }
      await tx.userPlaylistAudit.create({
        data: {
          playlistId: parsed.id,
          ownerSubject: context.ownerSubject,
          event: operation,
          version: nextVersion,
        },
      })
    })
    return { ...view, version: nextVersion, shared: true }
  }

  async rotate(
    input: { id: string; expectedVersion: number },
    context: UserPlaylistOwnerContext,
  ): Promise<OwnerUserPlaylist> {
    return this.replaceCapability("rotated", input, context)
  }

  async reshare(
    input: { id: string; expectedVersion: number },
    context: UserPlaylistOwnerContext,
  ): Promise<OwnerUserPlaylist> {
    return this.replaceCapability("reshared", input, context)
  }

  async reveal(
    input: { id: string },
    context: UserPlaylistOwnerContext,
  ): Promise<string> {
    this.assertShareAuthority(context)
    await this.dependencies.lifecycle.assertActive(context.ownerSubject)
    const parsed = UserPlaylistIdOperationSchema.parse(input)
    const row = await this.findOwned(parsed.id, context.ownerSubject)
    if (row.shareState !== "SHARED") {
      throw new NotFoundError("User playlist capability")
    }
    return this.capability().reveal(
      row.id,
      row.capabilityTokenVersion,
      materialFromRow(row),
    )
  }

  async read(
    input: { id: string },
    context: UserPlaylistOwnerContext,
  ): Promise<OwnerUserPlaylist> {
    await this.dependencies.lifecycle.assertActive(context.ownerSubject)
    const row = (await this.prisma.userPlaylist.findFirst({
      where: { id: input.id, ownerSubject: context.ownerSubject },
      select: {
        id: true,
        title: true,
        description: true,
        contentLocale: true,
        contextCountry: true,
        version: true,
        shareState: true,
        blocks: true,
      },
    })) as PlaylistReadRow | null
    if (!row) throw new NotFoundError("User playlist", input.id)

    return this.ownerView(row, context.viewerCountry ?? null)
  }

  async resolvePublicAccess(input: {
    token: string
    viewerCountry?: VerifiedViewerCountryContext | null
  }): Promise<PublicUserPlaylistAccess | null> {
    if (this.dependencies.publicReadsEnabled?.() !== true) return null
    const lookupDigests = this.capability().lookupDigests(input.token)
    if (lookupDigests.length === 0) return null

    const row = (await this.prisma.userPlaylist.findFirst({
      where: {
        shareState: "SHARED",
        moderationState: "ACTIVE",
        OR: lookupDigests.map((entry) => ({
          capabilityDigestKeyId: entry.keyId,
          capabilityDigest: Uint8Array.from(entry.digest),
        })),
      },
    })) as CapabilityRow | null
    if (!row) return null

    try {
      await this.dependencies.lifecycle.assertActive(row.ownerSubject)
    } catch (error) {
      if (error instanceof ConsumerLifecycleUnavailableError) return null
      throw error
    }
    const parsed = UserPlaylistSnapshotSchema.safeParse(row.blocks)
    if (!parsed.success) return null
    const eligible = await this.eligibleVideoIds(
      parsed.data,
      input.viewerCountry ?? null,
    )
    if (!row.capabilityDigest) return null
    return {
      playlistId: row.id,
      capabilityDigest: Uint8Array.from(row.capabilityDigest),
      playlist: {
        title: row.title,
        description: row.description,
        locale: row.contentLocale,
        countryCode: row.contextCountry,
        blocks: publicBlocks(parsed.data, eligible),
      },
    }
  }

  async resolvePublic(input: {
    token: string
    viewerCountry?: VerifiedViewerCountryContext | null
  }): Promise<PublicUserPlaylist | null> {
    return (await this.resolvePublicAccess(input))?.playlist ?? null
  }
}
