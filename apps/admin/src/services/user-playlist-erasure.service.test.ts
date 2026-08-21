import { Buffer } from "node:buffer"
import type { PrismaClient } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  UserPlaylistErasureConflictError,
  UserPlaylistErasureService,
} from "./user-playlist-erasure.service"

describe("UserPlaylistErasureService", () => {
  const receipt = { findUnique: vi.fn(), create: vi.fn() }
  const lifecycle = { findUnique: vi.fn(), deleteMany: vi.fn() }
  const playlist = { updateMany: vi.fn(), deleteMany: vi.fn() }
  const reports = { deleteMany: vi.fn() }
  const quota = { deleteMany: vi.fn() }
  const audit = { updateMany: vi.fn() }
  const lockLifecycle = vi.fn()
  const tx = {
    userPlaylistErasureReceipt: receipt,
    consumerLifecycleProjection: lifecycle,
    userPlaylist: playlist,
    userPlaylistReport: reports,
    userPlaylistOwnerQuota: quota,
    userPlaylistAudit: audit,
    $queryRaw: lockLifecycle,
  }
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
  } as unknown as PrismaClient
  const authorizer = { assertErasureAuthorized: vi.fn() }
  const service = new UserPlaylistErasureService(prisma, {
    subjectDigestKey: Buffer.alloc(32, 7),
    authorizer,
  })
  const input = {
    ownerSubject: "consumer-1",
    lifecycleVersion: 9n,
    idempotencyKey: "erase-2026-08-21-0001",
  }

  beforeEach(() => {
    vi.clearAllMocks()
    receipt.findUnique.mockResolvedValue(null)
    lockLifecycle.mockResolvedValue([{ matches: true }])
    lifecycle.deleteMany.mockResolvedValue({ count: 1 })
    playlist.deleteMany.mockResolvedValue({ count: 2 })
    receipt.create.mockImplementation(async ({ data }) => ({
      ...data,
      createdAt: new Date("2026-08-21T12:00:00.000Z"),
    }))
  })

  it("requires separate erasure authorization and atomically removes raw owner material", async () => {
    const result = await service.erase(input, "erasure-credential")

    expect(authorizer.assertErasureAuthorized).toHaveBeenCalledWith(
      "erasure-credential",
    )
    expect(lockLifecycle).toHaveBeenCalledTimes(1)
    expect(lockLifecycle.mock.invocationCallOrder[0]).toBeLessThan(
      playlist.updateMany.mock.invocationCallOrder[0]!,
    )
    expect(playlist.updateMany).toHaveBeenCalledWith({
      where: { ownerSubject: input.ownerSubject },
      data: expect.objectContaining({
        shareState: "UNSHARED",
        capabilityDigest: null,
        capabilityCiphertext: null,
      }),
    })
    expect(reports.deleteMany).toHaveBeenCalledWith({
      where: { playlist: { ownerSubject: input.ownerSubject } },
    })
    expect(audit.updateMany).toHaveBeenCalledWith({
      where: { ownerSubject: input.ownerSubject },
      data: {
        ownerSubject: null,
        ownerSubjectDigest: expect.any(Uint8Array),
      },
    })
    expect(playlist.deleteMany).toHaveBeenCalledWith({
      where: { ownerSubject: input.ownerSubject },
    })
    expect(quota.deleteMany).toHaveBeenCalledWith({
      where: { ownerSubject: input.ownerSubject },
    })
    expect(lifecycle.deleteMany).toHaveBeenCalledWith({
      where: {
        ownerSubject: input.ownerSubject,
        state: "DELETING",
        version: input.lifecycleVersion,
      },
    })
    expect(result).toMatchObject({
      idempotencyKey: input.idempotencyKey,
      lifecycleVersion: input.lifecycleVersion,
      erasedCount: 2,
    })
  })

  it("returns the same receipt on an identical replay", async () => {
    const digest = service.subjectDigest(input.ownerSubject)
    receipt.findUnique.mockResolvedValue({
      id: "receipt-1",
      idempotencyKey: input.idempotencyKey,
      ownerSubjectDigest: digest,
      lifecycleVersion: input.lifecycleVersion,
      erasedCount: 2,
      createdAt: new Date("2026-08-21T12:00:00.000Z"),
    })

    await expect(service.erase(input, "credential")).resolves.toMatchObject({
      receiptId: "receipt-1",
      erasedCount: 2,
    })
    expect(lockLifecycle).not.toHaveBeenCalled()
    expect(playlist.deleteMany).not.toHaveBeenCalled()
  })

  it("rejects an idempotency-key replay for a different subject or version", async () => {
    receipt.findUnique.mockResolvedValue({
      id: "receipt-1",
      idempotencyKey: input.idempotencyKey,
      ownerSubjectDigest: service.subjectDigest("someone-else"),
      lifecycleVersion: input.lifecycleVersion,
      erasedCount: 2,
      createdAt: new Date(),
    })
    await expect(service.erase(input, "credential")).rejects.toBeInstanceOf(
      UserPlaylistErasureConflictError,
    )
  })

  it("requires the matching projected DELETING version", async () => {
    lockLifecycle.mockResolvedValue([{ matches: false }])
    await expect(service.erase(input, "credential")).rejects.toBeInstanceOf(
      UserPlaylistErasureConflictError,
    )
    expect(playlist.updateMany).not.toHaveBeenCalled()
  })
})
