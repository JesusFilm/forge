import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import { reconstructShadowHistory } from "./history"
import { getRecommendationRecentContext } from "../recent-context.service"

vi.mock("../delivery-runtime", () => ({
  runRecommendationRetrievalQuery: (
    _db: unknown,
    _deadline: number,
    read: (db: unknown) => unknown,
  ) => read(_db),
}))
vi.mock("../recent-context.service", () => ({
  getRecommendationRecentContext: vi.fn(),
}))

const db = {} as PrismaClient
const request = {
  sessionDigest: "a".repeat(64),
  createdAt: new Date("2026-09-15T12:00:00Z"),
  expiresAt: new Date("2026-10-14T12:00:00Z"),
}

describe("shadow historical context", () => {
  it("reconstructs only the original session before the request, not evaluation time", async () => {
    const videos = [
      {
        targetMediaId: "recent-video",
        reasonCodes: ["recent_playback_start" as const],
      },
    ]
    vi.mocked(getRecommendationRecentContext).mockResolvedValueOnce({ videos })
    expect(
      await reconstructShadowHistory(
        db,
        request,
        new Date("2026-09-16T12:00:00Z"),
      ),
    ).toEqual({
      status: "request_window_reconstruction",
      recentVideos: videos,
    })
    expect(getRecommendationRecentContext).toHaveBeenLastCalledWith(db, {
      sessionDigest: request.sessionDigest,
      profileTokenDigest: null,
      allowDurableProfileLinks: false,
      now: new Date("2026-09-15T11:59:59.999Z"),
    })
  })

  it("reports missing retention and query failures without interpreting them as no repetition", async () => {
    expect(
      await reconstructShadowHistory(
        db,
        request,
        new Date("2026-10-07T12:00:00Z"),
      ),
    ).toMatchObject({ status: "retention_incomplete" })
    vi.mocked(getRecommendationRecentContext).mockRejectedValueOnce(
      new Error("deadline"),
    )
    expect(
      await reconstructShadowHistory(
        db,
        request,
        new Date("2026-09-16T12:00:00Z"),
      ),
    ).toEqual({ status: "unavailable", recentVideos: [] })
  })
})
