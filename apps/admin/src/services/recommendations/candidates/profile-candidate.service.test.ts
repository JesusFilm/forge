import { describe, expect, it, vi } from "vitest"
import {
  createProfileSourceNominationGenerator,
  MULTI_INTEREST_PROFILE_GENERATOR_VERSION,
} from "./profile-candidate.service"

const PRESENTATION = {
  videoSlug: "candidate-video",
  videoTitle: "Candidate video",
  imageUrl: "https://image.mux.com/playback/thumbnail.jpg",
  sceneIndex: 0,
  description: "Candidate description",
  startSeconds: 0,
  endSeconds: 30,
  themes: ["hope"],
  demographics: [],
  spiritualContext: [],
  playbackId: "playback",
  locale: "en",
  audioLanguageSlug: "english",
  watchPlayable: true,
  localePublished: true,
}

describe("multi-interest profile candidate generator", () => {
  it("nominates per interest through one bounded ANN statement with privacy-safe provenance", async () => {
    const loadProjection = vi.fn().mockResolvedValue({
      id: "projection-generation-1",
      projectionVersion: "multi-interest-profile-projection-v1",
      inputDigest: "a".repeat(64),
      publishedAt: new Date("2026-08-25T09:59:00.000Z"),
      expiresAt: new Date("2099-08-26T09:59:00.000Z"),
      cohortQuality: 0.8,
      interests: [
        { ordinal: 0, kind: "durable", vectorText: "[1,0]" },
        { ordinal: 1, kind: "session", vectorText: "[0,1]" },
      ],
    })
    const queryCandidates = vi.fn().mockResolvedValue([
      {
        interest_ordinal: 0,
        interest_kind: "durable",
        interest_rank: 1,
        source_rank: 1,
        video_id: "candidate-video",
        video_core_id: "candidate-core",
        video_slug: "candidate-video",
        video_title: "Candidate video",
        scene_index: 0,
        description: "Candidate description",
        start_seconds: 0,
        end_seconds: 30,
        duration_seconds: 252,
        themes: ["hope"],
        demographics: [],
        spiritual_context: [],
        playback_id: "playback",
        image_url: null,
        similarity: 0.91,
      },
      {
        interest_ordinal: 1,
        interest_kind: "session",
        interest_rank: 1,
        source_rank: 2,
        video_id: "session-candidate-video",
        video_core_id: "session-candidate-core",
        video_slug: "session-candidate-video",
        video_title: "Session candidate video",
        scene_index: 1,
        description: "Session candidate description",
        start_seconds: 31,
        end_seconds: 60,
        duration_seconds: 180,
        themes: ["faith"],
        demographics: [],
        spiritual_context: [],
        playback_id: "session-playback",
        image_url: null,
        similarity: 0.9,
      },
    ])
    const generator = createProfileSourceNominationGenerator({
      loadProjection,
      queryCandidates,
    })

    const result = await generator({
      surface: "watch-below-player-v1",
      purpose: "watch",
      locale: "en",
      audioLanguageSlug: "english",
      seedMediaId: "seed-video",
      manifestId: "semantic-profile-hybrid-v1",
      contextProjection: {
        ref: "projection-generation-1",
        version: "multi-interest-profile-projection-v1",
        digest: "a".repeat(64),
        privacyGeneration: 3,
      },
      liveItems: [
        {
          targetMediaId: "live-video",
          position: 0,
          presentation: PRESENTATION,
        },
      ],
    })

    expect(queryCandidates).toHaveBeenCalledOnce()
    expect(result.nominations).toHaveLength(2)
    expect(
      result.nominations.map((nomination) => nomination.source.rank),
    ).toEqual([1, 2])
    expect(result.nominations[0]).toMatchObject({
      targetMediaId: "candidate-video",
      presentation: { durationSeconds: 252 },
      source: {
        generator: "multi-interest-profile",
        generatorVersion: MULTI_INTEREST_PROFILE_GENERATOR_VERSION,
        evidence: {
          interestOrdinal: 0,
          interestKind: "durable",
          interestRank: 1,
          projectionVersion: "multi-interest-profile-projection-v1",
          projectionDigest: "aaaaaaaaaaaa",
          manifestId: "semantic-profile-hybrid-v1",
        },
      },
    })
    expect(result.nominations[1]).toMatchObject({
      targetMediaId: "session-candidate-video",
      source: {
        rank: 2,
        evidence: {
          interestOrdinal: 1,
          interestKind: "session",
          interestRank: 1,
        },
      },
    })
    expect(JSON.stringify(result)).not.toMatch(
      /vectorText|privacyGeneration|sessionDigest|profileId|tokenDigest/,
    )
  })

  it.each([
    {
      name: "unavailable",
      projection: null,
      rows: [],
      reason: "profile_projection_unavailable",
      queries: 0,
    },
    {
      name: "expired",
      projection: {
        id: "expired-projection",
        projectionVersion: "multi-interest-profile-projection-v1",
        inputDigest: "b".repeat(64),
        publishedAt: new Date("2026-08-24T00:00:00.000Z"),
        expiresAt: new Date("2026-08-25T00:00:00.000Z"),
        cohortQuality: 0.7,
        interests: [{ ordinal: 0, kind: "durable", vectorText: "[1,0]" }],
      },
      rows: [],
      reason: "profile_projection_unavailable",
      queries: 0,
    },
    {
      name: "sparse",
      projection: {
        id: "sparse-projection",
        projectionVersion: "multi-interest-profile-projection-v1",
        inputDigest: "c".repeat(64),
        publishedAt: new Date("2026-08-25T09:59:00.000Z"),
        expiresAt: new Date("2099-08-26T09:59:00.000Z"),
        cohortQuality: 0.7,
        interests: [{ ordinal: 0, kind: "durable", vectorText: "[1,0]" }],
      },
      rows: [],
      reason: "profile_candidates_sparse",
      queries: 1,
    },
  ])(
    "returns source-local absence without semantic fallback for a $name profile",
    async ({ projection, rows, reason, queries }) => {
      const queryCandidates = vi.fn().mockResolvedValue(rows)
      const generator = createProfileSourceNominationGenerator({
        loadProjection: vi.fn().mockResolvedValue(projection),
        queryCandidates,
      })

      const result = await generator({
        surface: "watch-below-player-v1",
        purpose: "watch",
        locale: "en",
        audioLanguageSlug: "english",
        seedMediaId: "seed-video",
        manifestId: "semantic-profile-hybrid-v1",
        contextProjection: {
          ref: projection?.id ?? null,
          version: "multi-interest-profile-projection-v1",
          digest: projection?.inputDigest ?? null,
          privacyGeneration: null,
        },
        liveItems: [
          {
            targetMediaId: "live-video",
            position: 0,
            presentation: PRESENTATION,
          },
        ],
      })

      expect(queryCandidates).toHaveBeenCalledTimes(queries)
      expect(result).toMatchObject({
        nominations: [],
        projectionCapturedAt: null,
        cohortQuality: null,
        sourceFailureReason: reason,
      })
      expect(JSON.stringify(result)).not.toContain("profile-semantic-fallback")
    },
  )
})
