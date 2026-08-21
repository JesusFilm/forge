import { Prisma } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import { UserPlaylistReportIntent } from "./user-playlist-report-intent"
import {
  UserPlaylistReportDetailCipher,
  UserPlaylistReporterIpDigester,
} from "./user-playlist-report-crypto"
import { UserPlaylistReportService } from "./user-playlist-report.service"

const now = new Date("2026-08-21T12:00:00.000Z")
const capabilityDigest = Buffer.alloc(32, 3)

function dependencies() {
  const intent = new UserPlaylistReportIntent({
    keys: [{ id: "intent-v1", key: Buffer.alloc(32, 7), active: true }],
    randomBytes: (size) => Buffer.alloc(size, 9),
  })
  const detailCipher = new UserPlaylistReportDetailCipher({
    keys: [{ id: "detail-v1", key: Buffer.alloc(32, 5), active: true }],
    randomBytes: (size) => Buffer.alloc(size, 4),
  })
  const ipDigester = new UserPlaylistReporterIpDigester({
    keys: [{ id: "ip-v1", key: Buffer.alloc(32, 6), active: true }],
  })
  const limiter = { consume: vi.fn().mockResolvedValue(true) }
  const lifecycle = { assertActive: vi.fn().mockResolvedValue(undefined) }
  return { intent, detailCipher, ipDigester, limiter, lifecycle }
}

function prisma() {
  const userPlaylist = {
    findFirst: vi.fn().mockResolvedValue({
      id: "playlist-1",
      ownerSubject: "consumer-1",
      capabilityDigest,
    }),
  }
  const userPlaylistReport = {
    create: vi.fn().mockImplementation(({ data }) => ({ ...data })),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  }
  const tx = { userPlaylistReport }
  return {
    client: {
      userPlaylist,
      userPlaylistReport,
      $transaction: vi.fn((value) =>
        Array.isArray(value) ? Promise.all(value) : value(tx),
      ),
    },
    userPlaylist,
    userPlaylistReport,
  }
}

function submissionToken(intent: UserPlaylistReportIntent): string {
  return intent.mint({ playlistId: "playlist-1", capabilityDigest, now })
}

describe("UserPlaylistReportService", () => {
  it("consumes an opaque intent and stores only bounded encrypted report material", async () => {
    const db = prisma()
    const deps = dependencies()
    const service = new UserPlaylistReportService(db.client as never, {
      ...deps,
      now: () => now,
      id: () => "report-1",
    })

    const result = await service.submit(
      {
        reportIntent: submissionToken(deps.intent),
        category: "MISLEADING_OR_SPAM",
        detail: "<script>alert('x')</script>",
      },
      { integrityVerified: true, normalizedIp: "203.0.113.8" },
    )

    expect(result).toEqual({ status: "RECEIVED" })
    expect(deps.limiter.consume).toHaveBeenCalledWith(
      expect.objectContaining({
        playlistId: "playlist-1",
        globalKey: "user-playlist-report",
        coarseIpBucket: false,
      }),
    )
    const create = db.userPlaylistReport.create.mock.calls[0]?.[0]
    expect(create.data).toMatchObject({
      id: "report-1",
      playlistId: "playlist-1",
      category: "MISLEADING_OR_SPAM",
      reporterIpDigestKeyId: "ip-v1",
    })
    expect(create.data).not.toHaveProperty("reportIntent")
    expect(create.data).not.toHaveProperty("capabilityDigest")
    expect(
      Buffer.from(create.data.detailCiphertext).toString("utf8"),
    ).not.toContain("<script>")
  })

  it("returns one external outcome for forged, expired, duplicate, and throttled intents", async () => {
    const cases = ["forged", "expired", "duplicate", "throttled"] as const

    for (const scenario of cases) {
      const db = prisma()
      const deps = dependencies()
      if (scenario === "duplicate") {
        db.userPlaylistReport.create.mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError("duplicate", {
            code: "P2002",
            clientVersion: "test",
          }),
        )
      }
      if (scenario === "throttled") {
        deps.limiter.consume.mockResolvedValueOnce(false)
      }
      const service = new UserPlaylistReportService(db.client as never, {
        ...deps,
        now: () =>
          scenario === "expired"
            ? new Date(now.getTime() + 10 * 60 * 1000)
            : now,
      })
      const valid = submissionToken(deps.intent)
      const reportIntent = scenario === "forged" ? `${valid}x` : valid

      await expect(
        service.submit(
          { reportIntent, category: "OTHER_SAFETY" },
          { integrityVerified: true, normalizedIp: "203.0.113.8" },
        ),
      ).resolves.toEqual({ status: "RECEIVED" })
    }
  })

  it("fails closed to a coarse bucket when trusted IP evidence is unavailable", async () => {
    const db = prisma()
    const deps = dependencies()
    const service = new UserPlaylistReportService(db.client as never, {
      ...deps,
      now: () => now,
    })

    await service.submit(
      {
        reportIntent: submissionToken(deps.intent),
        category: "PRIVACY_OR_PERSONAL_DATA",
      },
      null,
    )

    expect(deps.limiter.consume).toHaveBeenCalledWith(
      expect.objectContaining({
        ipDigest: null,
        coarseIpBucket: true,
      }),
    )
  })

  it("records explicit deletion timestamps when sensitive material expires", async () => {
    const db = prisma()
    const deps = dependencies()
    const service = new UserPlaylistReportService(db.client as never, {
      ...deps,
      now: () => now,
    })

    await service.purgeExpiredSensitiveMaterial()

    expect(db.userPlaylistReport.updateMany).toHaveBeenCalledTimes(2)
    expect(db.userPlaylistReport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ detailDeletedAt: now }),
      }),
    )
    expect(db.userPlaylistReport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reporterDigestDeletedAt: now }),
      }),
    )
  })
})
