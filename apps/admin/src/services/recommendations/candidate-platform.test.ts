import { describe, expect, it } from "vitest"
import type { SemanticCandidatePoolItem } from "./candidate"
import {
  CANDIDATE_PLATFORM_STAGES,
  runCandidatePlatform,
  runSemanticCandidatePlatform,
} from "./orchestration"
import { adaptSemanticCandidates } from "./candidate"
import { preparedCandidatesFromPlatform } from "./delivery-candidate-mapping"

const context = {
  surface: "watch-below-player-v1" as const,
  purpose: "watch" as const,
  locale: "en",
  audioLanguageSlug: "english",
}

function candidate(
  overrides: Partial<SemanticCandidatePoolItem> = {},
): SemanticCandidatePoolItem {
  return {
    videoId: "video-a",
    videoSlug: "video-a",
    videoTitle: "Video A",
    videoCoreId: "core-a",
    embeddingText: "[1,0,0]",
    imageUrl: "https://images.example/video-a.jpg",
    sceneIndex: 0,
    description: "A relevant scene",
    startSeconds: 0,
    endSeconds: 30,
    similarity: 0.9,
    themes: [],
    demographics: [],
    spiritualContext: [],
    playbackId: "playback-a",
    locale: "en",
    audioLanguageSlug: "english",
    watchPlayable: true,
    localePublished: true,
    ...overrides,
  }
}

describe("semantic candidate platform", () => {
  it("keeps one canonical Video with both semantic and profile contributors", () => {
    const semantic = adaptSemanticCandidates([candidate()], context)
      .nominations[0]!
    const profile = {
      ...semantic,
      nominationKey: "profile:1:video-a",
      source: {
        generator: "multi-interest-profile",
        generatorVersion: "multi-interest-profile-candidate-v1",
        rank: 1,
        score: 0.85,
        evidence: { interestOrdinal: 0 },
        rejectionReason: null,
      },
    }

    const result = runCandidatePlatform({
      context,
      limit: 6,
      nominations: [semantic, profile],
      generatorVersion: "semantic-profile-hybrid-generators-v1",
    })

    expect(result.composed).toHaveLength(1)
    expect(
      result.composed[0]?.sources.map((source) => source.generator),
    ).toEqual(["semantic", "multi-interest-profile"])
    expect(
      result.evidence.find((entry) => entry.stage === "deduplicated")
        ?.sourceEvidence,
    ).toHaveLength(2)
  })

  it("traverses every stage and preserves every source contribution when canonical videos deduplicate", () => {
    const result = runSemanticCandidatePlatform({
      context,
      limit: 6,
      candidates: [
        candidate(),
        candidate({
          videoId: "video-a-square",
          videoSlug: "video-a-square",
          videoTitle: "Video A (square)",
          videoCoreId: "core-a-square",
          similarity: 0.8,
          sceneIndex: 1,
          playbackId: "playback-a-square",
        }),
      ],
    })

    expect(result.stageOrder).toEqual(CANDIDATE_PLATFORM_STAGES)
    expect(result.composed).toHaveLength(1)
    expect(result.composed[0]?.sources).toHaveLength(2)
    expect(
      result.evidence.filter((entry) => entry.stage === "nominated"),
    ).toHaveLength(2)
    expect(
      result.evidence.find((entry) => entry.stage === "deduplicated")
        ?.sourceEvidence,
    ).toHaveLength(2)
    expect(
      result.evidence.find((entry) => entry.stage === "deduplicated")
        ?.reasonCodes,
    ).toContain("canonical_core_prefix")
    expect(result.parity.candidateEligibility).toBe("passed")
    expect(result.parity.ranker).toBe("passed")
  })

  it("hands off one aligned identity when a later cross-ID canonical duplicate is eligible", () => {
    const ineligibleSemantic = adaptSemanticCandidates(
      [candidate({ imageUrl: null })],
      context,
    ).nominations[0]!
    const eligibleProfile = {
      ...ineligibleSemantic,
      nominationKey: "profile:2:video-a-localized",
      targetMediaId: "video-a-localized",
      canonicalIdentity: {
        ...ineligibleSemantic.canonicalIdentity,
        videoId: "video-a-localized",
        videoCoreId: "core-a-localized",
        videoTitle: "Video A localized",
      },
      presentation: {
        ...ineligibleSemantic.presentation,
        videoSlug: "video-a-localized",
        videoTitle: "Video A localized",
        imageUrl: "https://images.example/video-a-localized.jpg",
        playbackId: "playback-a-localized",
      },
      source: {
        generator: "multi-interest-profile",
        generatorVersion: "multi-interest-profile-candidate-v1",
        rank: 2,
        score: 0.85,
        evidence: { interestOrdinal: 0 },
        rejectionReason: null,
      },
    }

    const result = runCandidatePlatform({
      context,
      limit: 6,
      nominations: [ineligibleSemantic, eligibleProfile],
      generatorVersion: "semantic-profile-hybrid-generators-v1",
    })

    expect(result.composed).toHaveLength(1)
    expect(result.composed[0]).toMatchObject({
      candidateKey: "video-a-localized",
      targetMediaId: "video-a-localized",
      canonicalIdentity: { videoId: "video-a-localized" },
      selectedNomination: {
        nominationKey: "profile:2:video-a-localized",
        targetMediaId: "video-a-localized",
      },
      presentation: {
        videoSlug: "video-a-localized",
        playbackId: "playback-a-localized",
      },
      sources: [
        { generator: "semantic" },
        { generator: "multi-interest-profile" },
      ],
    })
    expect(preparedCandidatesFromPlatform(result)[0]?.candidate).toMatchObject({
      videoId: "video-a-localized",
      videoSlug: "video-a-localized",
      playbackId: "playback-a-localized",
    })
  })

  it("rejects locale, playback, watch restriction, and generator failures with explicit reasons", () => {
    const result = runSemanticCandidatePlatform({
      context,
      limit: 6,
      candidates: [
        candidate({ videoId: "wrong-locale", locale: "es" }),
        candidate({ videoId: "missing-playback", playbackId: "" }),
        candidate({ videoId: "watch-restricted", watchPlayable: false }),
        candidate({ videoId: "missing-image", imageUrl: null }),
        candidate({
          videoId: "source-rejected",
          sourceRejectionReason: "semantic_source_unavailable",
        }),
      ],
    })

    expect(result.composed).toEqual([])
    const reasons = result.evidence
      .filter((entry) => entry.stage === "rejected")
      .flatMap((entry) => entry.reasonCodes)
    expect(reasons).toEqual(
      expect.arrayContaining([
        "locale_unavailable",
        "playback_unavailable",
        "watch_restricted",
        "image_unavailable",
        "semantic_source_unavailable",
      ]),
    )
  })

  it("rejects an unsupported purpose before semantic nomination", () => {
    const result = runSemanticCandidatePlatform({
      context: { ...context, purpose: "course_build" },
      limit: 6,
      candidates: [candidate()],
    })

    expect(result.composed).toEqual([])
    expect(result.evidence).toContainEqual(
      expect.objectContaining({
        stage: "rejected",
        reasonCodes: ["unsupported_purpose"],
      }),
    )
  })

  it("normalizes semantic magnitude, retains RRF, and resolves score ties deterministically", () => {
    const result = runSemanticCandidatePlatform({
      context,
      limit: 6,
      candidates: [
        candidate({
          videoId: "video-b",
          videoSlug: "video-b",
          videoCoreId: "core-b",
          videoTitle: "Video B",
          embeddingText: "[0,1,0]",
          playbackId: "playback-b",
          similarity: 0.75,
        }),
        candidate({ similarity: 0.75 }),
        candidate({
          videoId: "video-c",
          videoSlug: "video-c",
          videoCoreId: "core-c",
          videoTitle: "Video C",
          embeddingText: "[0,0,1]",
          playbackId: "playback-c",
          similarity: 0.25,
        }),
      ],
    })

    expect(result.ordered.map((entry) => entry.targetMediaId)).toEqual([
      "video-a",
      "video-b",
      "video-c",
    ])
    expect(
      result.ordered.map((entry) => entry.normalizedSemanticScore),
    ).toEqual([1, 1, 0])
    expect(result.ordered[0]?.rrfBenchmark).toBeCloseTo(1 / 62)
    expect(result.versions.ranker).toBe("semantic-deterministic-ranker-v1")
    expect(
      result.evidence.find((entry) => entry.stage === "scored"),
    ).toMatchObject({
      deterministicScore: 1,
      normalizedScore: 1,
    })
  })

  it("ranks hybrid candidates from source-relative ranks without combining raw similarities", () => {
    const [semanticRankOne, semanticRankTwo] = adaptSemanticCandidates(
      [
        candidate({
          videoId: "video-b",
          videoSlug: "video-b",
          videoTitle: "Video B",
          videoCoreId: "core-b",
          embeddingText: "[0,0,1]",
          playbackId: "playback-b",
          similarity: 0.01,
        }),
        candidate({
          videoId: "video-a",
          videoSlug: "video-a",
          videoTitle: "Video A",
          videoCoreId: "core-z",
          embeddingText: "[0,1,0]",
          playbackId: "playback-z",
          similarity: 0.99,
        }),
      ],
      context,
    ).nominations
    const dualNomination = {
      ...semanticRankTwo!,
      nominationKey: "profile:1:video-a",
      source: {
        generator: "multi-interest-profile",
        generatorVersion: "multi-interest-profile-candidate-v1",
        rank: 5,
        score: -0.75,
        evidence: { interestOrdinal: 0 },
        rejectionReason: null,
      },
    }
    const lowerRankedSemantic = {
      ...semanticRankTwo!,
      source: { ...semanticRankTwo!.source, rank: 5 },
    }

    const result = runCandidatePlatform({
      context,
      limit: 6,
      nominations: [semanticRankOne!, lowerRankedSemantic, dualNomination],
      generatorVersion: "semantic-profile-hybrid-generators-v1",
    })

    expect(result.versions.ranker).toBe("source-rank-hybrid-ranker-v1")
    expect(result.ordered.map((entry) => entry.targetMediaId)).toEqual([
      "video-b",
      "video-a",
    ])
    expect(result.ordered[0]?.deterministicScore).toBeCloseTo(1 / 1.05)
    expect(result.ordered[1]?.deterministicScore).toBeCloseTo(61 / 65)
    expect(
      result.ordered.every((candidate) => candidate.deterministicScore <= 1),
    ).toBe(true)
  })

  it("breaks equal hybrid source-rank scores by canonical video ID and scene index", () => {
    const nominations = adaptSemanticCandidates(
      [
        candidate({
          videoId: "video-b",
          videoSlug: "video-b",
          videoTitle: "Video B",
          videoCoreId: "different-core-b",
          embeddingText: "[0,1]",
          playbackId: "playback-b",
          sceneIndex: 4,
        }),
        candidate({
          videoId: "video-a",
          videoSlug: "video-a",
          videoTitle: "Video A",
          videoCoreId: "different-core-a",
          playbackId: "playback-a-2",
          sceneIndex: 2,
        }),
      ],
      context,
    ).nominations.map((nomination) => ({
      ...nomination,
      source: { ...nomination.source, rank: 1 },
    }))

    const result = runCandidatePlatform({
      context,
      limit: 6,
      nominations,
      generatorVersion: "semantic-profile-hybrid-generators-v1",
    })

    expect(result.ordered.map((entry) => entry.targetMediaId)).toEqual([
      "video-a",
      "video-b",
    ])
  })

  it("composes only a bounded playable localized video slate", () => {
    const result = runSemanticCandidatePlatform({
      context,
      limit: 2,
      candidates: [
        candidate(),
        candidate({
          videoId: "video-b",
          videoSlug: "video-b",
          videoCoreId: "core-b",
          videoTitle: "Video B",
          embeddingText: "[0,1,0]",
          playbackId: "playback-b",
          similarity: 0.8,
        }),
        candidate({
          videoId: "video-c",
          videoSlug: "video-c",
          videoCoreId: "core-c",
          videoTitle: "Video C",
          embeddingText: "[0,0,1]",
          playbackId: "playback-c",
          similarity: 0.7,
        }),
      ],
    })

    expect(result.composed).toHaveLength(2)
    expect(
      new Set(result.composed.map((item) => item.targetMediaId)).size,
    ).toBe(2)
    expect(
      result.composed.every(
        (item) =>
          item.presentation.locale === "en" &&
          item.presentation.audioLanguageSlug === "english" &&
          Boolean(item.presentation.playbackId) &&
          Boolean(item.presentation.imageUrl?.trim()),
      ),
    ).toBe(true)
  })

  it("suppresses the current and recent videos and deterministically refills six positions", () => {
    const candidates = Array.from({ length: 9 }, (_, index) =>
      candidate({
        videoId: `video-${index + 1}`,
        videoSlug: `video-${index + 1}`,
        videoCoreId: `core-${index + 1}`,
        videoTitle: `Video ${index + 1}`,
        embeddingText: null,
        playbackId: `playback-${index + 1}`,
        similarity: 0.99 - index * 0.01,
      }),
    )

    const result = runCandidatePlatform({
      context,
      limit: 6,
      nominations: adaptSemanticCandidates(candidates, context).nominations,
      generatorVersion: "semantic-profile-hybrid-generators-v1",
      composition: {
        currentVideoId: "video-1",
        recentVideos: [
          {
            targetMediaId: "video-2",
            reasonCodes: ["recent_playback_start"],
          },
          {
            targetMediaId: "video-3",
            reasonCodes: ["recent_selection", "repeatedly_served"],
          },
        ],
      },
    })

    expect(result.composed.map((item) => item.targetMediaId)).toEqual([
      "video-4",
      "video-5",
      "video-6",
      "video-7",
      "video-8",
      "video-9",
    ])
    expect(
      result.evidence
        .filter((entry) => entry.stage === "rejected")
        .map((entry) => ({
          targetMediaId: entry.targetMediaId,
          reasonCodes: entry.reasonCodes,
        })),
    ).toEqual(
      expect.arrayContaining([
        {
          targetMediaId: "video-1",
          reasonCodes: ["current_video"],
        },
        {
          targetMediaId: "video-2",
          reasonCodes: ["recent_playback_start"],
        },
        {
          targetMediaId: "video-3",
          reasonCodes: ["recent_selection", "repeatedly_served"],
        },
      ]),
    )
    expect(
      result.evidence
        .filter((entry) => entry.stage === "composed")
        .every((entry) =>
          entry.reasonCodes.includes("refill_after_suppression"),
        ),
    ).toBe(true)
  })

  it("uses recent repeats only as the deterministic final reserve for exact-six", () => {
    const candidates = Array.from({ length: 7 }, (_, index) =>
      candidate({
        videoId: `video-${index + 1}`,
        videoSlug: `video-${index + 1}`,
        videoCoreId: `core-${index + 1}`,
        videoTitle: `Video ${index + 1}`,
        embeddingText: null,
        playbackId: `playback-${index + 1}`,
        similarity: 0.99 - index * 0.01,
      }),
    )

    const result = runCandidatePlatform({
      context,
      limit: 6,
      nominations: adaptSemanticCandidates(candidates, context).nominations,
      generatorVersion: "semantic-profile-hybrid-generators-v1",
      composition: {
        currentVideoId: "video-1",
        recentVideos: candidates.slice(1, 7).map((item) => ({
          targetMediaId: item.videoId,
          reasonCodes: ["repeatedly_served"],
        })),
      },
    })

    expect(result.composed.map((item) => item.targetMediaId)).toEqual([
      "video-2",
      "video-3",
      "video-4",
      "video-5",
      "video-6",
      "video-7",
    ])
    expect(
      result.evidence
        .filter((entry) => entry.stage === "composed")
        .every((entry) =>
          entry.reasonCodes.includes("refill_after_suppression"),
        ),
    ).toBe(true)
    expect(
      result.composed.some((item) => item.targetMediaId === "video-1"),
    ).toBe(false)
  })

  it("bounds source-owned presentation strings before they reach the response", () => {
    const result = runSemanticCandidatePlatform({
      context,
      limit: 1,
      candidates: [
        candidate({
          description: "d".repeat(10_000),
          themes: ["t".repeat(1_000)],
        }),
      ],
    })

    expect(result.composed[0]?.presentation.description).toHaveLength(1_000)
    expect(result.composed[0]?.presentation.themes[0]).toHaveLength(64)
  })
})
