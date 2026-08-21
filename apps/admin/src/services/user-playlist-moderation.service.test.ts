import { describe, expect, it, vi } from "vitest"
import { UserPlaylistReportDetailCipher } from "./user-playlist-report-crypto"
import { UserPlaylistModerationService } from "./user-playlist-moderation.service"

const now = new Date("2026-08-21T12:00:00.000Z")

function setup() {
  const detailCipher = new UserPlaylistReportDetailCipher({
    keys: [{ id: "detail-v1", key: Buffer.alloc(32, 5), active: true }],
    randomBytes: (size) => Buffer.alloc(size, 4),
  })
  const userPlaylist = {
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    findUnique: vi.fn().mockResolvedValue({ moderationState: "ACTIVE" }),
  }
  const userPlaylistModerationAudit = {
    create: vi
      .fn()
      .mockImplementation(({ data }) => ({ id: "audit-1", ...data })),
  }
  const userPlaylistReport = { findMany: vi.fn().mockResolvedValue([]) }
  const tx = { userPlaylist, userPlaylistModerationAudit }
  const prisma = {
    userPlaylistReport,
    $transaction: vi.fn((callback) => callback(tx)),
  }
  const authorizer = {
    assertModerator: vi
      .fn()
      .mockResolvedValue({ actorSubject: "moderator-subject" }),
  }
  const service = new UserPlaylistModerationService(prisma as never, {
    authorizer,
    detailCipher,
    now: () => now,
  })
  return {
    service,
    detailCipher,
    userPlaylist,
    userPlaylistModerationAudit,
    userPlaylistReport,
  }
}

describe("UserPlaylistModerationService", () => {
  it("blocks independently of share and owner lifecycle and records a reasoned actor audit", async () => {
    const fixture = setup()

    const result = await fixture.service.block(
      { playlistId: "playlist-1", reasonCode: "SPAM" },
      "credential",
    )

    expect(result).toEqual({
      playlistId: "playlist-1",
      moderationState: "BLOCKED",
      changed: true,
      auditedAt: now,
    })
    expect(fixture.userPlaylist.updateMany).toHaveBeenCalledWith({
      where: { id: "playlist-1", moderationState: "ACTIVE" },
      data: { moderationState: "BLOCKED" },
    })
    expect(fixture.userPlaylistModerationAudit.create).toHaveBeenCalledWith({
      data: {
        playlistId: "playlist-1",
        actorSubject: "moderator-subject",
        action: "BLOCK",
        reasonCode: "SPAM",
        createdAt: now,
      },
    })
  })

  it("restores only the independent moderation axis with an audited reason", async () => {
    const fixture = setup()

    const result = await fixture.service.restore(
      { playlistId: "playlist-1", reasonCode: "REVIEW_CLEARED" },
      "credential",
    )

    expect(result.moderationState).toBe("ACTIVE")
    expect(fixture.userPlaylist.updateMany).toHaveBeenCalledWith({
      where: { id: "playlist-1", moderationState: "BLOCKED" },
      data: { moderationState: "ACTIVE" },
    })
    expect(fixture.userPlaylistModerationAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "RESTORE",
        reasonCode: "REVIEW_CLEARED",
      }),
    })
  })

  it("returns inert moderator-only detail without reporter, owner, token, or digest fields", async () => {
    const fixture = setup()
    const encrypted = fixture.detailCipher.encrypt(
      "<img src=x onerror=alert(1)>",
      {
        reportId: "report-1",
        playlistId: "playlist-1",
        category: "OTHER_SAFETY",
      },
    )
    fixture.userPlaylistReport.findMany.mockResolvedValueOnce([
      {
        id: "report-1",
        playlistId: "playlist-1",
        category: "OTHER_SAFETY",
        detailCiphertext: encrypted.ciphertext,
        detailKeyId: encrypted.keyId,
        detailNonce: encrypted.nonce,
        detailAuthTag: encrypted.authTag,
        detailDeleteAfter: new Date(now.getTime() + 1_000),
        detailDeletedAt: null,
        createdAt: now,
      },
    ])

    const queue = await fixture.service.listReports({ first: 20 }, "credential")

    expect(queue.items[0]).toEqual({
      reportId: "report-1",
      playlistId: "playlist-1",
      category: "OTHER_SAFETY",
      detailPlainText: "<img src=x onerror=alert(1)>",
      detailStatus: "AVAILABLE",
      createdAt: now,
    })
    expect(queue.items[0]).not.toHaveProperty("reporterIpDigest")
    expect(queue.items[0]).not.toHaveProperty("ownerSubject")
    expect(queue.items[0]).not.toHaveProperty("reportIntentDigest")
    expect(queue.items[0]).not.toHaveProperty("capability")
  })
})
