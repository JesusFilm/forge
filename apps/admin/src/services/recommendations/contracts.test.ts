import { describe, expect, it } from "vitest"
import {
  MAX_DELIVERY_ITEMS,
  MAX_EVIDENCE_EVENTS,
  MAX_EPISODE_FACTS,
  MAX_RECOMMENDATION_CONTRIBUTORS,
  RECOMMENDATION_CONTRACTS,
  RecommendationDeliveryAdditiveMetadataSchema,
  RecommendationEvidenceBatchSchema,
  RecommendationPlaybackEventSchema,
  boundedRecommendationContributors,
  classifyActiveWatchProxy,
  classifyLegacyPosition,
  unionActivePlaybackIntervals,
} from "./contracts"

describe("recommendation contracts", () => {
  it("pins the deliberately small U1 contract versions and bounds", () => {
    expect(RECOMMENDATION_CONTRACTS).toEqual({
      delivery: "semantic-recommendation-v1",
      evidence: "recommendation-evidence-v1",
      surface: "watch-below-player-v1",
      strategy: "semantic-transcript-pgvector-v1",
      outcome: "legacy-position-v0",
      playbackContext: "recommendation-playback-context-v1",
    })
    expect(MAX_DELIVERY_ITEMS).toBe(6)
    expect(MAX_EVIDENCE_EVENTS).toBe(16)
    expect(MAX_EPISODE_FACTS).toBe(128)
    expect(MAX_RECOMMENDATION_CONTRIBUTORS).toBe(16)
  })

  it("keeps legacy semantic delivery parseable while validating additive hybrid metadata", () => {
    expect(
      RecommendationDeliveryAdditiveMetadataSchema.safeParse({
        contractVersion: "semantic-recommendation-v1",
        personalization: { lane: "profile_challenger" },
        items: [],
      }).success,
    ).toBe(true)

    expect(
      RecommendationDeliveryAdditiveMetadataSchema.parse({
        contractVersion: "semantic-recommendation-v1",
        requestedCount: 6,
        composedCount: 4,
        shortfallReason: "eligibility_exhausted",
        personalization: {
          lane: "profile_challenger",
          executionMode: "hybrid_personalized",
        },
        items: [{}, {}, {}, {}],
      }),
    ).toMatchObject({
      requestedCount: 6,
      composedCount: 4,
      shortfallReason: "eligibility_exhausted",
      personalization: {
        lane: "profile_challenger",
        executionMode: "hybrid_personalized",
      },
    })
  })

  it("does not infer hybrid execution from legacy profile-challenger lane evidence", () => {
    const legacy = RecommendationDeliveryAdditiveMetadataSchema.parse({
      contractVersion: "semantic-recommendation-v1",
      personalization: { lane: "profile_challenger" },
      items: [],
    })

    expect(legacy.personalization?.lane).toBe("profile_challenger")
    expect(legacy.personalization?.executionMode).toBeUndefined()
    expect(
      RecommendationDeliveryAdditiveMetadataSchema.safeParse({
        contractVersion: "semantic-recommendation-v1",
        requestedCount: 6,
        composedCount: 0,
        shortfallReason: "insufficient_candidates",
        personalization: {
          lane: "profile_challenger",
          executionMode: "semantic_contextual",
        },
        items: [],
      }).success,
    ).toBe(false)
  })

  it("bounds and deduplicates privacy-safe candidate contributors", () => {
    const contributors = boundedRecommendationContributors(
      Array.from({ length: 24 }, (_, index) => ({
        generator: index === 1 ? "semantic" : `generator-${index}`,
        generatorVersion: index === 1 ? "semantic-v1" : `generator-${index}-v1`,
        rank: index + 1,
      })).concat({
        generator: "semantic",
        generatorVersion: "semantic-v1",
        rank: 1,
      }),
    )

    expect(contributors).toHaveLength(MAX_RECOMMENDATION_CONTRIBUTORS)
    expect(
      contributors.filter(
        (entry) =>
          entry.generator === "semantic" &&
          entry.generatorVersion === "semantic-v1",
      ),
    ).toHaveLength(1)
    expect(contributors[0]).toEqual({
      generator: "generator-0",
      generatorVersion: "generator-0-v1",
      rank: 1,
    })
  })

  it.each([
    ["playback_attempt", { initiation: "manual" }],
    ["playback_start", { positionSeconds: 0 }],
    [
      "playback_progress",
      {
        positionSeconds: 31,
        durationSeconds: 120,
        progress: 31 / 120,
        wallElapsedMilliseconds: 5_000,
      },
    ],
    ["playback_seek", { fromSeconds: 10, toSeconds: 40 }],
    [
      "playback_active_visible_playing",
      { activeMilliseconds: 1_000, coverage: "complete" },
    ],
    [
      "playback_end",
      {
        reason: "ended",
        positionSeconds: 120,
        durationSeconds: 120,
        progress: 1,
        completed: true,
      },
    ],
    ["playback_error", { code: "media_error", positionSeconds: 4 }],
  ])("accepts the strict %s fact contract", (kind, payload) => {
    expect(
      RecommendationPlaybackEventSchema.safeParse({
        eventId: "event-1",
        kind,
        occurredAt: "2026-08-19T00:00:00.000Z",
        payload,
      }).success,
    ).toBe(true)
  })

  it("rejects timeout as a client fact and rejects per-kind payload drift", () => {
    expect(
      RecommendationPlaybackEventSchema.safeParse({
        eventId: "event-1",
        kind: "playback_timeout",
        occurredAt: "2026-08-19T00:00:00.000Z",
        payload: {},
      }).success,
    ).toBe(false)
    expect(
      RecommendationPlaybackEventSchema.safeParse({
        eventId: "event-1",
        kind: "playback_start",
        occurredAt: "2026-08-19T00:00:00.000Z",
        payload: { positionSeconds: 0, clientClaimsAttention: true },
      }).success,
    ).toBe(false)
    expect(
      RecommendationPlaybackEventSchema.safeParse({
        eventId: "event-1",
        kind: "playback_active_visible_playing",
        occurredAt: "2026-08-19T00:00:00.000Z",
        payload: { activeMilliseconds: 60_001, coverage: "complete" },
      }).success,
    ).toBe(false)
  })

  it("rejects evidence batches above the fixed event budget", () => {
    const event = {
      eventId: "event-1",
      kind: "render",
      occurredAt: "2026-08-19T00:00:00.000Z",
      itemId: "item-1",
      payload: {},
    }

    expect(
      RecommendationEvidenceBatchSchema.safeParse({
        contractVersion: "recommendation-evidence-v1",
        events: Array.from({ length: MAX_EVIDENCE_EVENTS }, (_, index) => ({
          ...event,
          eventId: `event-${index}`,
        })),
      }).success,
    ).toBe(true)
    expect(
      RecommendationEvidenceBatchSchema.safeParse({
        contractVersion: "recommendation-evidence-v1",
        events: Array.from({ length: MAX_EVIDENCE_EVENTS + 1 }, (_, index) => ({
          ...event,
          eventId: `event-${index}`,
        })),
      }).success,
    ).toBe(false)
  })

  it("labels the position-only rule as a provisional comparator", () => {
    expect(
      classifyLegacyPosition({
        maxPositionSeconds: 30,
        maxProgress: 0.1,
      }),
    ).toEqual({
      classifierVersion: "legacy-position-v0",
      qualifiedView: true,
      viewQualityWeight: null,
      viewQualityWeightReason: "continuous_weight_not_available",
      reasons: ["maximum_position_at_least_30_seconds"],
      learningEligible: false,
    })
    expect(
      classifyLegacyPosition({
        maxPositionSeconds: 20,
        maxProgress: 0.25,
      }),
    ).toEqual({
      classifierVersion: "legacy-position-v0",
      qualifiedView: true,
      viewQualityWeight: null,
      viewQualityWeightReason: "continuous_weight_not_available",
      reasons: ["maximum_progress_at_least_25_percent"],
      learningEligible: false,
    })
    expect(
      classifyLegacyPosition({
        maxPositionSeconds: 5,
        maxProgress: 0.05,
      }),
    ).toMatchObject({
      qualifiedView: false,
      viewQualityWeight: null,
      viewQualityWeightReason: "continuous_weight_not_available",
      reasons: ["below_legacy_threshold"],
      learningEligible: false,
    })
  })

  it("unions overlapping active-playing intervals without double-counting", () => {
    expect(
      unionActivePlaybackIntervals([
        { startMilliseconds: 0, endMilliseconds: 10_000 },
        { startMilliseconds: 5_000, endMilliseconds: 15_000 },
        { startMilliseconds: 5_000, endMilliseconds: 15_000 },
        { startMilliseconds: 20_000, endMilliseconds: 25_000 },
      ]),
    ).toBe(20_000)
  })

  it("classifies active playback independently from player position", () => {
    expect(
      classifyActiveWatchProxy({
        activeMilliseconds: 0,
        durationSeconds: 120,
        completed: false,
        coverage: "complete",
      }),
    ).toMatchObject({
      classifierVersion: "active-watch-proxy-v1",
      qualifiedView: false,
      viewQualityWeight: 0,
      viewQualityWeightReason: "active_fraction_of_duration",
      learningEligible: false,
      reasons: expect.arrayContaining([
        "below_active_playback_threshold",
        "duration_cohort_medium",
        "terminal_partial",
      ]),
    })
  })

  it("keeps short complete and long partial active playback distinguishable", () => {
    const shortComplete = classifyActiveWatchProxy({
      activeMilliseconds: 20_000,
      durationSeconds: 20,
      completed: true,
      coverage: "complete",
    })
    const longPartial = classifyActiveWatchProxy({
      activeMilliseconds: 30_000,
      durationSeconds: 600,
      completed: false,
      coverage: "complete",
    })

    expect(shortComplete).toMatchObject({
      qualifiedView: true,
      viewQualityWeight: 1,
      reasons: expect.arrayContaining([
        "active_time_at_least_25_percent",
        "duration_cohort_short",
        "terminal_completed",
      ]),
    })
    expect(longPartial).toMatchObject({
      qualifiedView: true,
      viewQualityWeight: 0.05,
      reasons: expect.arrayContaining([
        "active_time_at_least_30_seconds",
        "duration_cohort_long",
        "terminal_partial",
      ]),
    })
  })
})
