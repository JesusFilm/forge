import { Buffer } from "node:buffer"
import { type PrismaClient } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ConsumerLifecycleUnavailableError } from "./consumer-lifecycle.service"
import {
  ConcurrentModificationError,
  ForbiddenError,
  LimitExceededError,
  NotFoundError,
  ServiceUnavailableError,
} from "./errors"
import {
  UserPlaylistCapability,
  type UserPlaylistCapabilityMaterial,
} from "./user-playlist-capability"
import { UserPlaylistService } from "./user-playlist.service"

const OWNER = { ownerSubject: "consumer-1", canShare: true }
const createInput = {
  title: "My playlist",
  description: "A description",
  locale: "en",
  countryCode: "CA",
  blocks: [
    {
      t: "mediaCollection" as const,
      title: "Watch",
      items: [{ videoId: "video-1" }, { videoId: "video-2" }],
    },
  ],
  acceptance: {
    termsVersion: "terms-v1",
    privacyVersion: "privacy-v1",
    communityGuidelinesVersion: "community-v1",
  },
}
const snapshotInput = {
  title: createInput.title,
  description: createInput.description,
  locale: createInput.locale,
  countryCode: createInput.countryCode,
  blocks: createInput.blocks,
}
const updateInput = {
  ...snapshotInput,
  id: "playlist-1",
  expectedVersion: 1,
}

function capabilityRing() {
  let invocation = 0
  return new UserPlaylistCapability({
    lookupKeys: [{ id: "lookup-v1", key: Buffer.alloc(32, 1), active: true }],
    encryptionKeys: [
      { id: "encryption-v1", key: Buffer.alloc(32, 2), active: true },
    ],
    randomBytes: (size) => Buffer.alloc(size, ++invocation),
  })
}

function row(
  overrides: Record<string, unknown> = {},
  material?: UserPlaylistCapabilityMaterial,
) {
  return {
    id: "playlist-1",
    ownerSubject: "consumer-1",
    title: "My playlist",
    description: "A description",
    contentLocale: "en",
    contextCountry: "CA",
    blocks: { schemaVersion: 1, blocks: createInput.blocks },
    version: 1,
    shareState: "SHARED",
    moderationState: "ACTIVE",
    capabilityTokenVersion: 1,
    capabilityDigest: material?.digest ?? Buffer.alloc(32),
    capabilityDigestKeyId: material?.digestKeyId ?? "lookup-v1",
    capabilityCiphertext: material?.ciphertext ?? Buffer.from("ciphertext"),
    capabilityEncryptionKeyId: material?.encryptionKeyId ?? "encryption-v1",
    capabilityNonce: material?.nonce ?? Buffer.alloc(12),
    capabilityAuthTag: material?.authTag ?? Buffer.alloc(16),
    ...overrides,
  }
}

describe("UserPlaylistService", () => {
  const userPlaylist = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  }
  const userPlaylistOwnerQuota = {
    upsert: vi.fn(),
    updateMany: vi.fn(),
  }
  const userPlaylistAudit = { create: vi.fn() }
  const tx = { userPlaylist, userPlaylistOwnerQuota, userPlaylistAudit }
  const transaction = vi.fn(
    async (run: (client: typeof tx) => unknown, _options?: unknown) => run(tx),
  )
  const lifecycle = { assertActive: vi.fn() }
  const mediaEligibility = { eligibleVideoIds: vi.fn() }
  let capabilities: UserPlaylistCapability
  let service: UserPlaylistService

  beforeEach(() => {
    vi.clearAllMocks()
    capabilities = capabilityRing()
    transaction.mockImplementation(
      async (run: (client: typeof tx) => unknown, _options?: unknown) =>
        run(tx),
    )
    lifecycle.assertActive.mockResolvedValue(undefined)
    mediaEligibility.eligibleVideoIds.mockResolvedValue(
      new Set(["video-1", "video-2"]),
    )
    userPlaylistOwnerQuota.updateMany.mockResolvedValue({ count: 1 })
    userPlaylist.updateMany.mockResolvedValue({ count: 1 })
    userPlaylist.deleteMany.mockResolvedValue({ count: 1 })
    service = new UserPlaylistService(
      { ...tx, $transaction: transaction } as unknown as PrismaClient,
      {
        mediaEligibility,
        lifecycle,
        capability: capabilities,
        policyVersions: {
          terms: "terms-v1",
          privacy: "privacy-v1",
          communityGuidelines: "community-v1",
        },
        publicReadsEnabled: () => true,
      },
    )
  })

  it("uses an id + owner subject predicate and masks foreign rows as not found", async () => {
    userPlaylist.findFirst.mockResolvedValue(null)

    await expect(
      service.read({ id: "playlist-1" }, { ownerSubject: "consumer-2" }),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(userPlaylist.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "playlist-1", ownerSubject: "consumer-2" },
      }),
    )
  })

  it.each([
    [
      "update",
      () =>
        service.update(updateInput, { ...OWNER, ownerSubject: "consumer-2" }),
    ],
    [
      "delete",
      () =>
        service.delete(
          { id: "playlist-1", expectedVersion: 1 },
          { ...OWNER, ownerSubject: "consumer-2" },
        ),
    ],
    [
      "unshare",
      () =>
        service.unshare(
          { id: "playlist-1", expectedVersion: 1 },
          { ...OWNER, ownerSubject: "consumer-2" },
        ),
    ],
    [
      "reshare",
      () =>
        service.reshare(
          { id: "playlist-1", expectedVersion: 1 },
          { ...OWNER, ownerSubject: "consumer-2" },
        ),
    ],
    [
      "rotate",
      () =>
        service.rotate(
          { id: "playlist-1", expectedVersion: 1 },
          { ...OWNER, ownerSubject: "consumer-2" },
        ),
    ],
    [
      "reveal",
      () =>
        service.reveal(
          { id: "playlist-1" },
          { ...OWNER, ownerSubject: "consumer-2" },
        ),
    ],
  ])(
    "masks a foreign %s as not found using the owner predicate",
    async (_name, operation) => {
      userPlaylist.findFirst.mockResolvedValue(null)
      await expect(operation()).rejects.toBeInstanceOf(NotFoundError)
      expect(userPlaylist.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "playlist-1", ownerSubject: "consumer-2" },
        }),
      )
    },
  )

  it("preserves owner references and reports unavailable media", async () => {
    userPlaylist.findFirst.mockResolvedValue(row())
    mediaEligibility.eligibleVideoIds.mockResolvedValue(new Set(["video-1"]))

    const result = await service.read({ id: "playlist-1" }, OWNER)
    expect(result.blocks[0]).toMatchObject({
      items: [{ videoId: "video-1" }, { videoId: "video-2" }],
    })
    expect(result.unavailableVideoIds).toEqual(["video-2"])
  })

  it("never returns capability material from owner list and separately authorizes reveal", async () => {
    userPlaylist.findMany.mockResolvedValue([
      {
        id: "playlist-1",
        title: "My playlist",
        description: "A description",
        contentLocale: "en",
        contextCountry: null,
        version: 1,
        shareState: "SHARED",
        capabilityCiphertext: Buffer.from("must-not-leak"),
      },
    ])
    const listed = await service.list(OWNER)
    expect(listed[0]).not.toHaveProperty("capabilityCiphertext")
    expect(userPlaylist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerSubject: OWNER.ownerSubject },
        select: expect.not.objectContaining({ capabilityCiphertext: true }),
      }),
    )

    await expect(
      service.reveal(
        { id: "playlist-1" },
        { ownerSubject: OWNER.ownerSubject },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("admits the exact quota under Serializable isolation and retries P2034", async () => {
    transaction
      .mockRejectedValueOnce({ code: "P2034" })
      .mockImplementationOnce(
        async (run: (client: typeof tx) => unknown, _options?: unknown) =>
          run(tx),
      )

    const created = await service.create(createInput, OWNER)

    expect(created.capability).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(transaction).toHaveBeenCalledTimes(2)
    expect(transaction.mock.calls[1]?.[1]).toEqual({
      isolationLevel: "Serializable",
    })
    expect(userPlaylistOwnerQuota.updateMany).toHaveBeenCalledWith({
      where: {
        ownerSubject: OWNER.ownerSubject,
        playlistCount: { lt: 20 },
      },
      data: { playlistCount: { increment: 1 } },
    })
    expect(userPlaylist.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerSubject: OWNER.ownerSubject,
          shareState: "SHARED",
          capabilityDigest: expect.any(Uint8Array),
          capabilityCiphertext: expect.any(Uint8Array),
        }),
      }),
    )
    expect(userPlaylist.create.mock.calls[0]?.[0].data).not.toHaveProperty(
      "capability",
    )
    expect(userPlaylistAudit.create).toHaveBeenCalledWith({
      data: {
        playlistId: created.playlist.id,
        ownerSubject: OWNER.ownerSubject,
        event: "created",
        version: 1,
      },
    })
  })

  it("rejects the 21st playlist atomically", async () => {
    userPlaylistOwnerQuota.updateMany.mockResolvedValue({ count: 0 })

    await expect(service.create(createInput, OWNER)).rejects.toBeInstanceOf(
      LimitExceededError,
    )
    expect(userPlaylist.create).not.toHaveBeenCalled()
  })

  it("rejects a stale update before media validation and preserves the snapshot", async () => {
    userPlaylist.findFirst.mockResolvedValue(row({ version: 2 }))

    await expect(service.update(updateInput, OWNER)).rejects.toBeInstanceOf(
      ConcurrentModificationError,
    )
    expect(mediaEligibility.eligibleVideoIds).not.toHaveBeenCalled()
    expect(userPlaylist.updateMany).not.toHaveBeenCalled()
  })

  it("admits only one of two saves using the same expected version", async () => {
    userPlaylist.findFirst.mockResolvedValue(row())
    userPlaylist.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })

    await expect(service.update(updateInput, OWNER)).resolves.toMatchObject({
      version: 2,
    })
    await expect(service.update(updateInput, OWNER)).rejects.toBeInstanceOf(
      ConcurrentModificationError,
    )
    expect(userPlaylist.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          id: "playlist-1",
          ownerSubject: OWNER.ownerSubject,
          version: 1,
        },
      }),
    )
  })

  it("maps write eligibility dependency failure to retryable unavailable without a version write", async () => {
    userPlaylist.findFirst.mockResolvedValue(row())
    mediaEligibility.eligibleVideoIds.mockRejectedValue(new Error("timeout"))

    await expect(service.update(updateInput, OWNER)).rejects.toMatchObject({
      name: ServiceUnavailableError.name,
      retryable: true,
    })
    expect(userPlaylist.updateMany).not.toHaveBeenCalled()
  })

  it("rotates atomically, recovers the new token, and makes the old digest invalid", async () => {
    const oldCapability = capabilities.create("playlist-1", 1)
    const before = row({}, oldCapability.material)
    userPlaylist.findFirst.mockResolvedValueOnce(before)

    const rotated = await service.rotate(
      { id: "playlist-1", expectedVersion: 1 },
      OWNER,
    )
    expect(rotated.capability).not.toBe(oldCapability.token)
    const update = userPlaylist.updateMany.mock.calls[0]?.[0]
    expect(update.where).toEqual({
      id: "playlist-1",
      ownerSubject: OWNER.ownerSubject,
      version: 1,
      shareState: "SHARED",
      capabilityTokenVersion: 1,
    })
    expect(update.data.capabilityTokenVersion).toBe(2)

    const after = row(
      { version: 2, capabilityTokenVersion: 2 },
      {
        digest: update.data.capabilityDigest,
        digestKeyId: update.data.capabilityDigestKeyId,
        ciphertext: update.data.capabilityCiphertext,
        encryptionKeyId: update.data.capabilityEncryptionKeyId,
        nonce: update.data.capabilityNonce,
        authTag: update.data.capabilityAuthTag,
      },
    )
    const newDigest = Buffer.from(update.data.capabilityDigest)
    userPlaylist.findFirst.mockImplementation(
      async ({ where }: { where: Record<string, unknown> }) => {
        if ("id" in where) return after
        const alternatives = where.OR as Array<{ capabilityDigest: Uint8Array }>
        return alternatives.some((entry) =>
          Buffer.from(entry.capabilityDigest).equals(newDigest),
        )
          ? after
          : null
      },
    )

    await expect(
      service.resolvePublic({ token: oldCapability.token }),
    ).resolves.toBeNull()
    await expect(
      service.resolvePublic({ token: rotated.capability }),
    ).resolves.toMatchObject({ title: "My playlist" })
    await expect(service.reveal({ id: "playlist-1" }, OWNER)).resolves.toBe(
      rotated.capability,
    )
  })

  it("re-share creates fresh material and never revives the disabled token", async () => {
    const disabled = capabilities.create("playlist-1", 1)
    userPlaylist.findFirst.mockResolvedValue(
      row({
        shareState: "UNSHARED",
        capabilityDigest: null,
        capabilityDigestKeyId: null,
        capabilityCiphertext: null,
        capabilityEncryptionKeyId: null,
        capabilityNonce: null,
        capabilityAuthTag: null,
      }),
    )

    const reshared = await service.reshare(
      { id: "playlist-1", expectedVersion: 1 },
      OWNER,
    )
    expect(reshared.capability).not.toBe(disabled.token)
    expect(userPlaylist.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "playlist-1",
          ownerSubject: OWNER.ownerSubject,
          shareState: "UNSHARED",
        }),
        data: expect.objectContaining({
          shareState: "SHARED",
          capabilityTokenVersion: 2,
        }),
      }),
    )
  })

  it("applies share/moderation/lifecycle axes and omits ineligible ids from public output", async () => {
    const created = capabilities.create("playlist-1", 1)
    userPlaylist.findFirst.mockResolvedValue(row({}, created.material))
    mediaEligibility.eligibleVideoIds.mockResolvedValue(new Set(["video-1"]))

    const result = await service.resolvePublic({ token: created.token })
    expect(userPlaylist.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          shareState: "SHARED",
          moderationState: "ACTIVE",
        }),
      }),
    )
    expect(result?.blocks[0]).toMatchObject({ items: [{ videoId: "video-1" }] })
    expect(result).not.toHaveProperty("id")
    expect(result).not.toHaveProperty("ownerSubject")

    lifecycle.assertActive.mockRejectedValueOnce(
      new ConsumerLifecycleUnavailableError(),
    )
    await expect(
      service.resolvePublic({ token: created.token }),
    ).resolves.toBeNull()
  })

  it("fails the public kill switch before capability lookup", async () => {
    const disabled = new UserPlaylistService(
      { ...tx, $transaction: transaction } as unknown as PrismaClient,
      {
        mediaEligibility,
        lifecycle,
        capability: capabilities,
        publicReadsEnabled: () => false,
      },
    )
    await expect(
      disabled.resolvePublic({ token: "a".repeat(43) }),
    ).resolves.toBeNull()
    expect(userPlaylist.findFirst).not.toHaveBeenCalled()
  })

  it("keeps public dependency failure distinct from capability not-found", async () => {
    const created = capabilities.create("playlist-1", 1)
    userPlaylist.findFirst.mockResolvedValue(row({}, created.material))
    mediaEligibility.eligibleVideoIds.mockRejectedValue(new Error("timeout"))

    await expect(
      service.resolvePublic({ token: created.token }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError)
  })
})
