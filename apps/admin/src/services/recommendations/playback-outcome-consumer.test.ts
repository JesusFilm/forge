import { describe, expect, it, vi } from "vitest"
import { readPlaybackOutcomeEnvelope } from "./playback-outcome-consumer"

describe("playback outcome consumer boundary", () => {
  it("returns the complete versioned source-neutral envelope", async () => {
    const createdAt = new Date("2026-08-19T03:01:00.000Z")
    const findUnique = vi.fn(async () => ({
      id: "outcome-1",
      episodeId: "episode-1",
      classifierVersion: "active-watch-proxy-v1",
      revision: 2,
      factWatermark: 6,
      inputDigest: "f".repeat(64),
      qualifiedView: true,
      activePlaybackMilliseconds: 35_000,
      durationSeconds: 120,
      durationCohort: "medium",
      activeCoverage: "complete",
      createdAt,
      episode: {
        discoverySource: "search",
        provenance: { handoff: "search_result" },
        mediaId: "media-1",
        sessionDigest: "a".repeat(64),
      },
    }))

    await expect(
      readPlaybackOutcomeEnvelope("outcome-1", {
        recommendationOutcomeRevision: { findUnique },
      } as never),
    ).resolves.toEqual({
      contractVersion: "playback-outcome-v1",
      outcomeId: "outcome-1",
      episodeId: "episode-1",
      revision: 2,
      factWatermark: 6,
      inputDigest: "f".repeat(64),
      discoverySource: "search",
      provenance: { handoff: "search_result" },
      mediaId: "media-1",
      sessionDigest: "a".repeat(64),
      qualifiedView: true,
      activePlaybackMilliseconds: 35_000,
      durationSeconds: 120,
      durationCohort: "medium",
      activeCoverage: "complete",
      createdAt,
    })
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "outcome-1" },
      include: { episode: true },
    })
  })

  it("does not expose legacy or incomplete outcomes through the active boundary", async () => {
    const prisma = {
      recommendationOutcomeRevision: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            classifierVersion: "legacy-position-v0",
            activePlaybackMilliseconds: null,
          })
          .mockResolvedValueOnce({
            classifierVersion: "active-watch-proxy-v1",
            activePlaybackMilliseconds: null,
          }),
      },
    }

    await expect(
      readPlaybackOutcomeEnvelope("legacy", prisma as never),
    ).resolves.toBeNull()
    await expect(
      readPlaybackOutcomeEnvelope("incomplete", prisma as never),
    ).resolves.toBeNull()
  })
})
