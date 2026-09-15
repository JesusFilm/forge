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

    const [sessionSql, priorDurableSql, currentDurableSql] =
      queryRaw.mock.calls.map(([query]) =>
        query.strings.join(" ").replace(/\s+/g, " "),
      )
    const durableSql = `${priorDurableSql}\n${currentDurableSql}`
    expect(sessionSql).toContain(
      "JOIN recommendation_profile_session_link link",
    )
    expect(sessionSql).toContain("link.session_digest")
    expect(sessionSql).toContain("selection.occurred_at >= GREATEST(")
    expect(sessionSql).toContain("selection.attribution_eligible_at <=")
    expect(sessionSql).toContain("decision.selection_id = selection.id")
    expect(sessionSql).toContain("decision.is_current = true")
    expect(sessionSql).toContain("JOIN recommendation_impression impression")
    expect(sessionSql).toContain("impression.visibility_policy")
    expect(sessionSql).toContain("impression.expires_at >")
    expect(sessionSql).toContain("profile.created_at, link.linked_at")
    expect(durableSql).toContain("outcome.qualified_view = true")
    expect(durableSql).toContain(
      "selection.attribution_eligible_at IS NOT NULL",
    )
    expect(durableSql).not.toContain("outcome.learning_eligible = true")
    expect(durableSql).not.toContain("outcome.created_at >= profile.created_at")
    expect(priorDurableSql).toContain(
      "episode.request_id IS NOT DISTINCT FROM outcome.request_id",
    )
    expect(priorDurableSql).toContain(
      "episode.item_id IS NOT DISTINCT FROM outcome.item_id",
    )
    expect(priorDurableSql).toContain(
      "contribution.target_media_id = episode.media_id",
    )
    expect(currentDurableSql).toContain(
      "JOIN recommendation_playback_episode episode ON episode.session_digest = link.session_digest",
    )
    expect(currentDurableSql).toContain('episode.media_id AS "targetMediaId"')
    expect(currentDurableSql).toContain(
      "LEFT JOIN recommendation_request request",
    )
    expect(currentDurableSql).toContain(
      "LEFT JOIN recommendation_selection selection",
    )
    expect(currentDurableSql).not.toContain(
      "JOIN recommendation_served_item item",
    )
    expect(currentDurableSql).toContain("profile.token_digest IS NOT NULL")
    expect(currentDurableSql).toContain(
      "episode.request_id IS NULL OR ( request.expires_at >",
    )
    expect(currentDurableSql).toContain(
      "episode.selection_id IS NULL OR ( selection.attribution_eligible_at IS NOT NULL",
    )
    expect(currentDurableSql).toContain(
      "COALESCE(episode.claimed_at, episode.created_at) >= GREATEST(profile.created_at, link.linked_at)",
    )
    expect(durableSql).toContain("outcome.expires_at >")
    expect(durableSql).toContain("decision.expires_at >")
    expect(durableSql).toContain("decision.is_current = true")
    expect(durableSql).toContain("decision.policy_version =")
    expect(durableSql).toContain("decision.state = 'eligible'")
    expect(durableSql).toContain("'profile' = ANY(decision.eligible_scopes)")
    expect(durableSql).toContain("superseding.supersedes_id = outcome.id")
    expect(durableSql).toContain("recommendation_promotion_slate_fence fence")
    expect(sessionSql).not.toMatch(/qualified_outcome|durable/i)
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

  it("publishes an empty replacement instead of replaying contaminated interests", async () => {
    const executeRaw = vi.fn().mockResolvedValue(1)
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "interest-generation",
          generation: 8,
          pointerGeneration: 8,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ generation: 9 }])
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
    ).resolves.toMatchObject({
      status: "published",
      generation: 9,
      replay: false,
    })
    expect(executeRaw).toHaveBeenCalledTimes(4)
  })

  it("rejects a repair publisher when the expected pointer moved", async () => {
    const executeRaw = vi.fn().mockResolvedValue(1)
    const queryRaw = vi.fn().mockResolvedValueOnce([
      {
        id: "newer-generation",
        generation: 9,
        pointerGeneration: 9,
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
        expectedPointer: {
          generationId: "expected-generation",
          pointerGeneration: 8,
        },
      }),
    ).rejects.toMatchObject({ code: "profile_projection_pointer_fenced" })
  })

  it("rejects a first publisher when an expected-absent pointer appeared", async () => {
    const executeRaw = vi.fn().mockResolvedValue(1)
    const queryRaw = vi.fn().mockResolvedValueOnce([
      {
        id: "concurrent-generation",
        generation: 1,
        pointerGeneration: 1,
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
        inputDigest: "c".repeat(64),
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
        expectedPointer: { generationId: null, pointerGeneration: 0 },
      }),
    ).rejects.toMatchObject({ code: "profile_projection_pointer_fenced" })
  })

  it("rejects publication when current eligibility changes after projection input loads", async () => {
    const executeRaw = vi.fn().mockResolvedValue(1)
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          sourceId: "selection-new-revision",
          targetMediaId: "video-new",
          weight: 1,
          occurredAt: NOW,
          sourceExpiresAt: new Date("2026-09-01T00:00:00.000Z"),
          eligibilityPolicyVersion: "recommendation-integrity-v1",
          outcomeClassifierVersion: null,
          eligibilityDecisionId: "decision-2",
          eligibilityRevision: 2,
          eligibilityInputDigest: "c".repeat(64),
          eligibilityDecidedAt: NOW,
          evidenceWatermark: NOW,
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
        inputDigest: "b".repeat(64),
        evidenceSnapshotDigest: "d".repeat(64),
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
    ).rejects.toMatchObject({ code: "profile_projection_input_fenced" })
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
