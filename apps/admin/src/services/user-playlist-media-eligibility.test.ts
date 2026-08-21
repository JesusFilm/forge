import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import { PrismaUserPlaylistMediaEligibility } from "./user-playlist-media-eligibility"

describe("PrismaUserPlaylistMediaEligibility", () => {
  it("attests only global Watch visibility/playability and does not invent territory rules", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "video-1" }])
    const service = new PrismaUserPlaylistMediaEligibility({
      video: { findMany },
    } as unknown as PrismaClient)

    await expect(
      service.eligibleVideoIds({
        videoIds: ["video-1", "video-2"],
        viewerCountry: { integrityVerified: true, countryCode: "CA" },
      }),
    ).resolves.toEqual(new Set(["video-1"]))
    expect(findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: { in: ["video-1", "video-2"] },
        deletedAt: null,
        noIndex: false,
        NOT: { restrictViewPlatforms: { has: "watch" } },
        locales: { some: { status: "PUBLISHED", deletedAt: null } },
        dubs: expect.objectContaining({ some: expect.any(Object) }),
      }),
      select: { id: true },
    })
    const serialized = JSON.stringify(findMany.mock.calls[0]?.[0])
    expect(serialized).not.toContain("CA")
    expect(serialized).not.toContain("country")
  })
})
