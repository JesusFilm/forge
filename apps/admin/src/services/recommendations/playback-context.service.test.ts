import { describe, expect, it, vi } from "vitest"
import { RecommendationPlaybackContextService } from "./playback-context.service"
import { RecommendationCapabilityUnavailableError } from "./errors"

const caller = {
  id: null,
  role: "CONSUMER_BEARER" as const,
  fleet: false,
  rateLimitBucketKey: "test-web-consumer-key",
}
const now = new Date("2026-09-02T03:00:00.000Z")

function harness({ enabled = true } = {}) {
  let created: Record<string, unknown> | undefined
  const tx = {
    recommendationPlaybackEvidenceControl: {
      findUnique: vi.fn(async () => ({ enabled, version: 4 })),
    },
    recommendationPlaybackContext: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created = data
        return data
      }),
    },
    recommendationEvidenceAudit: { create: vi.fn(async () => ({})) },
  }
  const prisma = {
    recommendationPlaybackEvidenceControl: {
      findUnique: vi.fn(async () => ({ enabled, version: 4 })),
    },
    recommendationPlaybackContext: { findUnique: vi.fn(async () => null) },
    $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
      work(tx),
    ),
  }
  const ids = ["context-1", "episode-1", "capability-jti"]
  const signEpisodeCapability = vi.fn(
    async (_binding: unknown, _options?: unknown) => "private-capability",
  )
  const claimRecommendation = vi.fn(async () => ({
    contextId: "recommendation-context",
    episodeId: "recommendation-episode",
    capability: "recommendation-capability",
    activeUntil: "2026-09-02T07:00:00.000Z",
    hardUntil: "2026-09-02T09:00:00.000Z",
  }))
  const service = new RecommendationPlaybackContextService({
    prisma: prisma as never,
    tokenService: {
      activeKid: "active-kid",
      signEpisodeCapability,
    },
    claimRecommendation,
    now: () => now,
    newId: () => ids.shift()!,
  })
  return {
    service,
    prisma,
    tx,
    getCreated: () => created,
    signEpisodeCapability,
    claimRecommendation,
  }
}

describe("RecommendationPlaybackContextService", () => {
  it("fails closed to telemetry while the dedicated evidence control is off", async () => {
    const { service, signEpisodeCapability } = harness({ enabled: false })
    await expect(
      service.open({
        caller,
        contractVersion: "recommendation-playback-context-v1",
        sessionDigest: "a".repeat(64),
        mediaId: "media-1",
        idempotencyKey: "player-instance-1234567890",
        source: "direct",
      }),
    ).rejects.toBeInstanceOf(RecommendationCapabilityUnavailableError)
    expect(signEpisodeCapability).not.toHaveBeenCalled()
  })

  it("opens a direct claimed episode without recommendation attribution", async () => {
    const { service, getCreated, signEpisodeCapability, tx } = harness()
    await expect(
      service.open({
        caller,
        contractVersion: "recommendation-playback-context-v1",
        sessionDigest: "a".repeat(64),
        mediaId: "media-direct",
        idempotencyKey: "player-instance-1234567890",
        source: "direct",
      }),
    ).resolves.toEqual({
      contextId: "context-1",
      episodeId: "episode-1",
      capability: "private-capability",
      activeUntil: "2026-09-02T07:00:00.000Z",
      hardUntil: "2026-09-02T09:00:00.000Z",
      source: "direct",
    })
    expect(getCreated()).toMatchObject({
      id: "context-1",
      source: "DIRECT",
      episode: {
        create: expect.objectContaining({
          id: "episode-1",
          state: "CLAIMED",
        }),
      },
    })
    expect(getCreated()).not.toHaveProperty("requestId")
    expect(getCreated()).not.toHaveProperty("itemId")
    expect(getCreated()).not.toHaveProperty("selectionId")
    expect(signEpisodeCapability).toHaveBeenCalledWith(
      expect.objectContaining({
        contextId: "context-1",
      }),
      expect.objectContaining({ signingKid: "active-kid" }),
    )
    expect(signEpisodeCapability.mock.calls[0]?.[0]).not.toHaveProperty(
      "requestId",
    )
    expect(signEpisodeCapability.mock.calls[0]?.[0]).not.toHaveProperty(
      "itemId",
    )
    expect(tx.recommendationEvidenceAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contextId: "context-1",
        reasonCode: "playback_context_opened",
        detail: { source: "direct", provenanceAuthoritative: false },
      }),
    })
  })

  it("replays an active context without issuing another episode", async () => {
    const { service, prisma, tx, signEpisodeCapability } = harness()
    prisma.recommendationPlaybackContext.findUnique.mockResolvedValue({
      id: "existing-context",
      source: "DIRECT",
      sourceRefDigest: null,
      sessionDigest: "a".repeat(64),
      mediaId: "media-direct",
      generation: 1,
      episode: {
        id: "existing-episode",
        state: "CLAIMED",
        capabilityJti: "existing-jti",
        signingKid: "active-kid",
        claimedAt: now,
        activeUntil: new Date("2026-09-02T07:00:00.000Z"),
        hardUntil: new Date("2026-09-02T09:00:00.000Z"),
      },
    } as never)

    await expect(
      service.open({
        caller,
        contractVersion: "recommendation-playback-context-v1",
        sessionDigest: "a".repeat(64),
        mediaId: "media-direct",
        idempotencyKey: "player-instance-1234567890",
        source: "direct",
      }),
    ).resolves.toMatchObject({
      contextId: "existing-context",
      episodeId: "existing-episode",
      capability: "private-capability",
      source: "direct",
    })
    expect(tx.recommendationPlaybackContext.create).not.toHaveBeenCalled()
    expect(signEpisodeCapability).toHaveBeenCalledOnce()
  })

  it("consumes recommendation provenance through the one-use claim service", async () => {
    const { service, claimRecommendation } = harness()
    await expect(
      service.open({
        caller,
        contractVersion: "recommendation-playback-context-v1",
        sessionDigest: "a".repeat(64),
        mediaId: "media-1",
        idempotencyKey: "player-instance-1234567890",
        source: "recommendation",
        claimNonce: "claim-nonce-1234567890",
      }),
    ).resolves.toMatchObject({
      contextId: "recommendation-context",
      source: "recommendation",
    })
    expect(claimRecommendation).toHaveBeenCalledWith(
      expect.objectContaining({
        claimNonce: "claim-nonce-1234567890",
        mediaId: "media-1",
        playbackEvidenceControlVersion: 4,
      }),
    )
  })
})
