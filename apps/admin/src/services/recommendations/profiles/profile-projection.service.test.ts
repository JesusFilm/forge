import { describe, expect, it, vi } from "vitest"
import {
  createRecommendationProfileProjectionService,
  loadDatabaseProfileProjectionEvidence,
  publishDatabaseProfileProjection,
} from "./profile-projection.service"

const NOW = new Date("2026-08-26T02:00:00.000Z")

describe("recommendation profile projection service", () => {
  it("derives no-consent viewers from session selections only", async () => {
    const publish = vi.fn().mockResolvedValue({
      status: "published",
      generationId: "session-generation-1",
      generation: 1,
      replay: false,
    })
    const service = createRecommendationProfileProjectionService({
      loadEvidence: vi.fn().mockResolvedValue({
        durable: [],
        session: [
          {
            sourceId: "selection-1",
            sourceType: "selection",
            targetMediaId: "video-session",
            weight: 1,
            occurredAt: NOW,
            sourceExpiresAt: new Date("2026-09-20T00:00:00.000Z"),
            eligibilityPolicyVersion: null,
            outcomeClassifierVersion: null,
          },
        ],
        explicitPreferences: [],
        negativeEvidence: [],
      }),
      loadEmbeddings: vi
        .fn()
        .mockResolvedValue(new Map([["video-session", [0, 1]]])),
      publish,
    })

    await service.project({
      sessionDigest: "a".repeat(64),
      profileId: null,
      privacyGeneration: null,
      now: NOW,
    })

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "session",
        profileId: null,
        privacyGeneration: null,
        projection: expect.objectContaining({
          durableInterests: [],
          sessionIntent: expect.objectContaining({
            medoidMediaId: "video-session",
          }),
        }),
      }),
    )
  })

  it("requires the active privacy generation before publishing durable qualified influence", async () => {
    const publish = vi.fn().mockResolvedValue({
      status: "published",
      generationId: "durable-generation-1",
      generation: 4,
      replay: false,
    })
    const service = createRecommendationProfileProjectionService({
      loadEvidence: vi.fn().mockResolvedValue({
        durable: [
          {
            sourceId: "outcome-qualified",
            sourceType: "outcome",
            targetMediaId: "video-durable",
            weight: 0.8,
            occurredAt: NOW,
            sourceExpiresAt: new Date("2026-09-20T00:00:00.000Z"),
            eligibilityPolicyVersion: "recommendation-integrity-v1",
            outcomeClassifierVersion: "active-watch-proxy-v1",
          },
        ],
        session: [],
        explicitPreferences: [],
        negativeEvidence: [],
      }),
      loadEmbeddings: vi
        .fn()
        .mockResolvedValue(new Map([["video-durable", [1, 0]]])),
      publish,
    })

    await service.project({
      sessionDigest: "a".repeat(64),
      profileId: "profile-1",
      privacyGeneration: 7,
      now: NOW,
    })

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "durable",
        profileId: "profile-1",
        privacyGeneration: 7,
        projection: expect.objectContaining({
          durableInterests: [expect.anything()],
        }),
      }),
    )
  })

  it("revalidates rebuilt durable evidence against source initiation, rollback fences, current eligibility, expiry, and supersession", async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    await loadDatabaseProfileProjectionEvidence(
      { $queryRaw: queryRaw } as never,
      {
        sessionDigest: "a".repeat(64),
        profileId: "profile-1",
        privacyGeneration: 2,
        now: NOW,
      },
    )

    const queries = queryRaw.mock.calls.map(([query]) =>
      query.strings.join(" "),
    )
    const sql = queries.join("\n")
    expect(queries[0]).toContain(
      "JOIN recommendation_profile_session_link link",
    )
    expect(queries[0]).toContain("link.session_digest")
    expect(queries[0]).toContain("selection.occurred_at >= GREATEST(")
    expect(queries[0]).toContain("profile.created_at, link.linked_at")
    expect(sql).toContain("outcome.qualified_view = true")
    expect(sql).not.toContain("outcome.learning_eligible = true")
    expect(sql).not.toContain("outcome.created_at >= profile.created_at")
    expect(sql).toContain("request.created_at >= profile.created_at")
    expect(sql).toContain("link.session_digest")
    expect(sql).toContain("GREATEST(")
    expect(sql).toContain("profile.created_at, link.linked_at")
    expect(sql).toContain(
      "selection.occurred_at >= GREATEST(profile.created_at, link.linked_at)",
    )
    expect(sql).toContain(
      "COALESCE(episode.claimed_at, episode.created_at) >= GREATEST(profile.created_at, link.linked_at)",
    )
    expect(sql).toContain("outcome.expires_at >")
    expect(sql).toContain("decision.expires_at >")
    expect(sql).toContain("contribution.source_outcome_id")
    expect(sql).toContain("decision.is_current = true")
    expect(sql).toContain("decision.policy_version =")
    expect(sql).toContain("decision.state = 'eligible'")
    expect(sql).toContain("'profile' = ANY(decision.eligible_scopes)")
    expect(sql).toContain("superseding.supersedes_id = outcome.id")
    expect(sql).toContain("recommendation_promotion_slate_fence fence")
    expect(sql).toContain("fence.request_id = outcome.request_id")
    expect(sql).toContain("LEAST(")
    expect(sql).toContain("selection.occurred_at")
    expect(queries[0]).not.toMatch(/qualified_outcome|durable/i)
  })

  it("publishes all projection contributions with one set-based insert", async () => {
    const executeRaw = vi.fn().mockResolvedValue(1)
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ generation: 1 }])
    const transaction = vi.fn(async (work) =>
      work({ $executeRaw: executeRaw, $queryRaw: queryRaw }),
    )
    const sourceExpiresAt = new Date("2026-09-01T00:00:00.000Z")

    await publishDatabaseProfileProjection(
      { $transaction: transaction } as never,
      {
        scope: "session",
        sessionDigest: "a".repeat(64),
        profileId: null,
        privacyGeneration: null,
        now: NOW,
        inputDigest: "b".repeat(64),
        projection: {
          durableInterests: [],
          sessionIntent: null,
          explicitPreferences: [],
          negativeEvidence: [],
          contributionCount: 3,
          cohortQuality: 0.5,
        },
        durableEvidence: [],
        sessionEvidence: ["one", "two", "three"].map((sourceId) => ({
          sourceId,
          sourceType: "selection" as const,
          targetMediaId: `video-${sourceId}`,
          weight: 1,
          occurredAt: NOW,
          sourceExpiresAt,
          eligibilityPolicyVersion: null,
          outcomeClassifierVersion: null,
        })),
      },
    )

    const contributionInserts = executeRaw.mock.calls.filter(([query]) =>
      query.strings
        .join(" ")
        .includes("INSERT INTO recommendation_profile_projection_contribution"),
    )
    expect(contributionInserts).toHaveLength(1)
    expect(
      contributionInserts[0]![0].strings.join(" ").match(/\),\s*\(/g),
    ).toHaveLength(2)
  })

  it("retries a serializable publication conflict before failing the profile run", async () => {
    const executeRaw = vi.fn().mockResolvedValue(1)
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ generation: 1 }])
    const conflict = Object.assign(new Error("serialization conflict"), {
      code: "P2034",
    })
    const transaction = vi
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockImplementationOnce(async (work) =>
        work({ $executeRaw: executeRaw, $queryRaw: queryRaw }),
      )

    await expect(
      publishDatabaseProfileProjection({ $transaction: transaction } as never, {
        scope: "session",
        sessionDigest: "a".repeat(64),
        profileId: null,
        privacyGeneration: null,
        now: NOW,
        inputDigest: "b".repeat(64),
        projection: {
          durableInterests: [],
          sessionIntent: null,
          explicitPreferences: [],
          negativeEvidence: [],
          contributionCount: 0,
          cohortQuality: 0,
        },
        durableEvidence: [],
        sessionEvidence: [],
      }),
    ).resolves.toMatchObject({ status: "published", generation: 1 })
    expect(transaction).toHaveBeenCalledTimes(2)
  })

  it("does not let a stale empty build replace a newer interest projection", async () => {
    const executeRaw = vi.fn().mockResolvedValue(1)
    const newerWatermark = new Date("2026-08-26T01:59:30.000Z")
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "interest-generation",
          generation: 8,
          inputWatermark: newerWatermark,
          contributionCount: 1,
        },
      ])
    const transaction = vi.fn(async (work) =>
      work({ $executeRaw: executeRaw, $queryRaw: queryRaw }),
    )

    await expect(
      publishDatabaseProfileProjection({ $transaction: transaction } as never, {
        scope: "session",
        sessionDigest: "a".repeat(64),
        profileId: null,
        privacyGeneration: null,
        now: NOW,
        inputDigest: "stale-empty-input",
        projection: {
          durableInterests: [],
          sessionIntent: null,
          explicitPreferences: [],
          negativeEvidence: [],
          contributionCount: 0,
          cohortQuality: 0,
        },
        durableEvidence: [],
        sessionEvidence: [],
      }),
    ).resolves.toEqual({
      status: "published",
      generationId: "interest-generation",
      generation: 8,
      replay: true,
    })
    expect(executeRaw).toHaveBeenCalledOnce()
  })

  it("keeps source expiry in the deterministic rebuild input", async () => {
    const publish = vi.fn().mockResolvedValue({
      status: "published",
      generationId: "durable-generation-2",
      generation: 2,
      replay: false,
    })
    const sourceExpiresAt = new Date("2026-09-01T00:00:00.000Z")
    const service = createRecommendationProfileProjectionService({
      loadEvidence: vi.fn().mockResolvedValue({
        durable: [
          {
            sourceId: "outcome-still-current",
            sourceType: "outcome",
            targetMediaId: "video-durable",
            weight: 0.75,
            occurredAt: NOW,
            sourceExpiresAt,
            eligibilityPolicyVersion: "recommendation-integrity-v1",
            outcomeClassifierVersion: "active-watch-proxy-v1",
          },
        ],
        session: [],
        explicitPreferences: [],
        negativeEvidence: [],
      }),
      loadEmbeddings: vi
        .fn()
        .mockResolvedValue(new Map([["video-durable", [1, 0]]])),
      publish,
    })

    await service.project({
      sessionDigest: "a".repeat(64),
      profileId: "profile-1",
      privacyGeneration: 2,
      now: NOW,
    })

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        durableEvidence: [expect.objectContaining({ sourceExpiresAt })],
      }),
    )
  })
})
