import { describe, expect, it, vi } from "vitest"
import {
  getRecommendationRecentContext,
  MAX_RECENT_CONTEXT_REQUESTS_PER_SESSION,
} from "./recent-context.service"

describe("recommendation recent context", () => {
  it("returns only bounded recommendation-owned suppression reasons", async () => {
    const queryRaw = vi.fn(async (..._args: unknown[]) => [
      {
        targetMediaId: "watched-video",
        servedCount: 1,
        selected: false,
        playbackStarted: true,
      },
      {
        targetMediaId: "selected-video",
        servedCount: 2,
        selected: true,
        playbackStarted: false,
      },
      {
        targetMediaId: "served-once",
        servedCount: 1,
        selected: false,
        playbackStarted: false,
      },
    ])

    await expect(
      getRecommendationRecentContext({ $queryRaw: queryRaw } as never, {
        sessionDigest: "a".repeat(64),
        profileTokenDigest: null,
        allowDurableProfileLinks: false,
        now: new Date("2026-08-26T12:00:00.000Z"),
      }),
    ).resolves.toEqual({
      videos: [
        {
          targetMediaId: "watched-video",
          reasonCodes: ["recent_playback_start"],
        },
        {
          targetMediaId: "selected-video",
          reasonCodes: ["recent_selection", "repeatedly_served"],
        },
      ],
    })
    expect(queryRaw).toHaveBeenCalledOnce()
    expect(queryRaw.mock.calls[0]).toContain("a".repeat(64))
    expect(queryRaw.mock.calls[0]).toContain(null)
    expect(queryRaw.mock.calls[0]).toContain(false)
    const queryShape = String(queryRaw.mock.calls[0]?.[0])
    expect(queryShape).toMatch(/CROSS JOIN LATERAL/)
    expect(queryShape).toMatch(/link\.linked_at AS authorization_start/)
    expect(queryShape).toMatch(
      /root\.created_at >= session\.authorization_start/,
    )
    expect(queryShape).toMatch(/ORDER BY root\.created_at DESC, root\.id DESC/)
    expect(queryRaw.mock.calls[0]).toContain(
      MAX_RECENT_CONTEXT_REQUESTS_PER_SESSION,
    )
  })
})
