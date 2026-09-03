import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { RecommendationEpisodeService } from "./episode.service"
import { recommendationEvidenceDigest } from "./evidence.service"
import { RecommendationBindingError } from "./errors"

const caller = {
  id: null,
  role: "CONSUMER_BEARER" as const,
  fleet: false,
  rateLimitBucketKey: "test-web-consumer-key",
}

describe("RecommendationEpisodeService", () => {
  it.each(["direct", "search", "share", "acquisition", "editorial"] as const)(
    "issues a one-use source-neutral %s playback context without recommendation lineage",
    async (discoverySource) => {
      const created: Array<Record<string, unknown>> = []
      const service = new RecommendationEpisodeService({
        prisma: {
          recommendationPlaybackEpisode: {
            create: vi.fn(
              async ({ data }: { data: Record<string, unknown> }) => {
                created.push(data)
                return data
              },
            ),
          },
        } as never,
        tokenService: {
          activeKid: "active-kid",
          verifyDeliveryCapability: vi.fn(),
          signEpisodeCapability: vi.fn(),
        },
        now: () => new Date("2026-04-20T03:00:00.000Z"),
        newId: () => "context-episode-1",
        newClaimNonce: () => "source-neutral-claim-nonce",
      })

      await expect(
        service.issueContext({
          caller,
          sessionDigest: "a".repeat(64),
          mediaId: "target-video",
          discoverySource,
          provenance: { campaign: "bounded-campaign" },
        }),
      ).resolves.toEqual({
        claimNonce: "source-neutral-claim-nonce",
        contextVersion: "playback-context-v1",
      })
      expect(created[0]).toMatchObject({
        id: "context-episode-1",
        requestId: null,
        itemId: null,
        selectionId: null,
        contextVersion: "playback-context-v1",
        discoverySource,
        provenance: { campaign: "bounded-campaign" },
        sessionDigest: "a".repeat(64),
        mediaId: "target-video",
        state: "PENDING",
        finalizationDueAt: null,
        claimNonceDigest: createHash("sha256")
          .update("source-neutral-claim-nonce")
          .digest("hex"),
      })
      expect(JSON.stringify(created[0])).not.toContain(
        "source-neutral-claim-nonce",
      )
    },
  )

  it("rejects fabricated recommendation attribution for a standalone context", async () => {
    const service = new RecommendationEpisodeService({
      prisma: {
        recommendationPlaybackEpisode: { create: vi.fn() },
      } as never,
      tokenService: {
        activeKid: "active-kid",
        verifyDeliveryCapability: vi.fn(),
        signEpisodeCapability: vi.fn(),
      },
    })

    await expect(
      service.issueContext({
        caller,
        sessionDigest: "a".repeat(64),
        mediaId: "target-video",
        discoverySource: "recommendation" as never,
      }),
    ).rejects.toThrow()
  })

  it("claims a standalone playback context without consulting profile or assignment state", async () => {
    const claimedAt = new Date("2026-04-20T03:00:00.000Z")
    const context = {
      id: "episode-direct",
      requestId: null,
      itemId: null,
      selectionId: null,
      state: "PENDING",
      generation: 1,
      sessionDigest: "a".repeat(64),
      mediaId: "target-video",
      claimNonceDigest: createHash("sha256")
        .update("source-neutral-claim-nonce")
        .digest("hex"),
      handoffExpiresAt: new Date("2026-04-20T03:10:00.000Z"),
      claimedAt: null,
      capabilityJti: null,
      signingKid: null,
      activeUntil: new Date("2026-04-20T07:00:00.000Z"),
      hardUntil: new Date("2026-04-20T09:00:00.000Z"),
      expiresAt: new Date("2026-05-19T03:00:00.000Z"),
    }
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const service = new RecommendationEpisodeService({
      prisma: {
        recommendationSelection: { findUnique: vi.fn(async () => null) },
        recommendationPlaybackEpisode: {
          findUnique: vi.fn(async () => context),
        },
        $transaction: vi.fn(
          async (work: (tx: Record<string, unknown>) => unknown) =>
            work({
              recommendationPlaybackEpisode: { updateMany },
            }),
        ),
      } as never,
      tokenService: {
        activeKid: "active-kid",
        verifyDeliveryCapability: vi.fn(),
        signEpisodeCapability: vi.fn(async () => "episode-token"),
      },
      now: () => claimedAt,
      newId: () => "episode-jti",
      dispatchFinalization: vi.fn(async () => undefined),
    })

    await expect(
      service.claim({
        caller,
        sessionDigest: "a".repeat(64),
        claimNonce: "source-neutral-claim-nonce",
        mediaId: "target-video",
      }),
    ).resolves.toMatchObject({
      episodeId: "episode-direct",
      capability: "episode-token",
    })
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "episode-direct",
        state: "PENDING",
        generation: 1,
        claimedAt: null,
        handoffExpiresAt: { gt: claimedAt },
      },
      data: expect.objectContaining({
        state: "CLAIMED",
        capabilityJti: "episode-jti",
        claimedAt,
      }),
    })
  })

  it("rejects selection after its personalized assignment is fenced", async () => {
    const item = {
      id: "item-1",
      requestId: "request-1",
      targetMediaId: "target-video",
      canonicalHref: "/watch/target.html",
      capabilityJti: "delivery-jti",
      request: {
        state: "ISSUED",
        manifestId: "semantic-profile-hybrid-v1",
        sessionDigest: "a".repeat(64),
        expiresAt: new Date("2026-09-17T03:00:00.000Z"),
        experimentAssignment: {
          profileId: "profile-1",
          privacyGeneration: 4,
          state: "FENCED",
          expiresAt: new Date("2026-09-01T00:00:00.000Z"),
          profile: {
            state: "TOMBSTONED",
            tokenDigest: null,
            privacyGeneration: 4,
            expiresAt: new Date("2027-02-21T00:00:00.000Z"),
          },
        },
      },
    }
    const verifyDeliveryCapability = vi.fn()
    const service = new RecommendationEpisodeService({
      prisma: {
        recommendationServedItem: { findUnique: vi.fn(async () => item) },
      } as never,
      tokenService: {
        activeKid: "active-kid",
        verifyDeliveryCapability,
        signEpisodeCapability: vi.fn(),
      },
      now: () => new Date("2026-04-20T03:00:00.000Z"),
    })

    await expect(
      service.select({
        caller,
        contractVersion: "recommendation-evidence-v1",
        capability: "delivery-token",
        requestId: "request-1",
        itemId: "item-1",
        sessionDigest: "a".repeat(64),
        eventId: "selection-1",
        occurredAt: "2026-04-20T03:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(RecommendationBindingError)
    expect(verifyDeliveryCapability).not.toHaveBeenCalled()
  })

  it("atomically creates selection plus pending episode with a fresh claim nonce", async () => {
    let created: Record<string, unknown> | undefined
    const item = {
      id: "item-1",
      requestId: "request-1",
      targetMediaId: "target-video",
      canonicalHref: "/watch/target.html/en.html",
      capabilityJti: "delivery-jti",
      expiresAt: new Date("2026-09-17T03:00:00.000Z"),
      request: {
        id: "request-1",
        state: "ISSUED",
        manifestId: "semantic-transcript-pgvector-v1",
        sessionDigest: "a".repeat(64),
        expiresAt: new Date("2026-09-17T03:00:00.000Z"),
        experimentAssignment: {
          id: "assignment-1",
          experimentId: "profile-pilot-1",
          profileId: "profile-1",
          privacyGeneration: 4,
          arm: "CHALLENGER",
          assignmentProbability: 0.25,
          configurationDigest: "c".repeat(64),
          state: "ACTIVE",
          expiresAt: new Date("2026-09-01T00:00:00.000Z"),
          profile: {
            state: "ACTIVE",
            tokenDigest: "d".repeat(64),
            privacyGeneration: 4,
            expiresAt: new Date("2027-02-21T00:00:00.000Z"),
          },
          experiment: {
            experimentVersion: "profile-pilot-v1",
            generation: 3,
            controlManifestId: "semantic-transcript-pgvector-v1",
            challengerManifestId: "multi-interest-profile-pilot-v1",
          },
        },
      },
    }
    const tx = {
      $executeRaw: vi.fn(async () => 1),
      $queryRaw: vi.fn(async () => [{ id: "current" }]),
      recommendationSelection: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created = data
          return { ...data, episode: { id: "episode-1" } }
        }),
      },
      recommendationEvidenceAudit: { create: vi.fn(async () => ({})) },
    }
    const prisma = {
      recommendationServedItem: { findUnique: vi.fn(async () => item) },
      recommendationProfileSessionLink: {
        findFirst: vi.fn(async () => ({
          profileId: "profile-1",
          privacyGeneration: 4,
          profile: { privacyGeneration: 4 },
        })),
      },
      recommendationEvidenceAudit: { create: vi.fn(async () => ({})) },
      $queryRaw: vi.fn(async () => [{ attempts: 1 }]),
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    }
    const dispatchProfileFeedback = vi.fn(async () => undefined)
    const verifyDeliveryCapability = vi.fn(async () => ({
      iat: 1_776_653_000,
      exp: 1_776_654_600,
    }))
    const service = new RecommendationEpisodeService({
      prisma: prisma as never,
      tokenService: {
        activeKid: "active-kid",
        verifyDeliveryCapability,
        signEpisodeCapability: vi.fn(async () => "episode-token"),
      },
      now: () => new Date("2026-04-20T03:00:00.000Z"),
      newId: (() => {
        let id = 0
        return () => `id-${++id}`
      })(),
      newClaimNonce: () => "fresh-claim-nonce",
      dispatchFinalization: vi.fn(async () => {
        throw new Error("workflow unavailable")
      }),
      dispatchProfileFeedback,
    })

    const result = await service.select({
      caller,
      contractVersion: "recommendation-evidence-v1",
      capability: "delivery-token",
      requestId: "request-1",
      itemId: "item-1",
      sessionDigest: "a".repeat(64),
      eventId: "selection-1",
      occurredAt: "2026-04-20T02:59:00.000Z",
      tabDigest: "b".repeat(64),
    })

    expect(result).toEqual({
      status: "accepted",
      claimNonce: "fresh-claim-nonce",
      canonicalHref: "/watch/target.html/en.html",
      targetMediaId: "target-video",
    })
    expect(created).toMatchObject({
      claimNonceDigest: createHash("sha256")
        .update("fresh-claim-nonce")
        .digest("hex"),
      episode: {
        create: {
          state: "PENDING",
          mediaId: "target-video",
          finalizationDueAt: new Date("2026-04-20T07:00:00.000Z"),
        },
      },
    })
    expect(JSON.stringify(created)).not.toContain("fresh-claim-nonce")
    expect(tx.$executeRaw).toHaveBeenCalledOnce()
    expect(tx.$executeRaw).toHaveBeenCalledBefore(
      tx.recommendationSelection.findUnique,
    )
    expect(verifyDeliveryCapability).toHaveBeenCalledWith(
      "delivery-token",
      expect.objectContaining({
        assignmentId: "assignment-1",
        experimentId: "profile-pilot-1",
        experimentVersion: "profile-pilot-v1",
        experimentGeneration: 3,
        experimentArm: "challenger",
        effectiveManifestId: "multi-interest-profile-pilot-v1",
        assignmentProbability: 0.25,
        assignmentConfigurationDigest: "c".repeat(64),
      }),
    )
    expect(dispatchProfileFeedback).toHaveBeenCalledWith({
      sessionDigest: "a".repeat(64),
      profileId: "profile-1",
      privacyGeneration: 4,
      evidenceWatermark: new Date("2026-04-20T03:00:00.000Z"),
    })
  })

  it("refreshes the directly linked profile after a selection without an experiment assignment", async () => {
    const item = {
      id: "item-direct",
      requestId: "request-direct",
      targetMediaId: "target-video",
      canonicalHref: "/watch/target.html/en.html",
      capabilityJti: "delivery-jti-direct",
      request: {
        id: "request-direct",
        state: "ISSUED",
        manifestId: "semantic-transcript-pgvector-v1",
        sessionDigest: "a".repeat(64),
        expiresAt: new Date("2026-09-17T03:00:00.000Z"),
        experimentAssignment: null,
      },
    }
    const tx = {
      $executeRaw: vi.fn(async () => 1),
      $queryRaw: vi.fn(async () => [{ id: "current" }]),
      recommendationSelection: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => ({ episode: { id: "episode-direct" } })),
      },
      recommendationEvidenceAudit: { create: vi.fn(async () => ({})) },
    }
    const prisma = {
      recommendationServedItem: { findUnique: vi.fn(async () => item) },
      recommendationProfileSessionLink: {
        findFirst: vi.fn(async () => ({
          profileId: "profile-direct",
          privacyGeneration: 7,
          profile: { privacyGeneration: 7 },
        })),
      },
      recommendationEvidenceAudit: { create: vi.fn(async () => ({})) },
      $queryRaw: vi.fn(async () => [{ attempts: 1 }]),
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    }
    const dispatchProfileFeedback = vi.fn(async () => undefined)
    const service = new RecommendationEpisodeService({
      prisma: prisma as never,
      tokenService: {
        activeKid: "active-kid",
        verifyDeliveryCapability: vi.fn(async () => ({
          iat: 1_776_653_000,
          exp: 1_776_654_600,
        })),
        signEpisodeCapability: vi.fn(async () => "episode-token"),
      },
      now: () => new Date("2026-04-20T03:00:00.000Z"),
      newId: (() => {
        let id = 0
        return () => `direct-id-${++id}`
      })(),
      newClaimNonce: () => "direct-fresh-claim-nonce",
      dispatchProfileFeedback,
    })

    await expect(
      service.select({
        caller,
        contractVersion: "recommendation-evidence-v1",
        capability: "delivery-token",
        requestId: "request-direct",
        itemId: "item-direct",
        sessionDigest: "a".repeat(64),
        eventId: "selection-direct",
        occurredAt: "2026-04-20T02:59:00.000Z",
      }),
    ).resolves.toMatchObject({ status: "accepted" })

    expect(dispatchProfileFeedback).toHaveBeenCalledWith({
      sessionDigest: "a".repeat(64),
      profileId: "profile-direct",
      privacyGeneration: 7,
      evidenceWatermark: new Date("2026-04-20T03:00:00.000Z"),
    })
  })

  it("commits a matching claim even when its replacement wake dispatch is lost", async () => {
    const now = new Date("2026-04-20T03:00:00.000Z")
    const selection = {
      id: "selection-1",
      claimedAt: null,
      handoffExpiresAt: new Date("2026-04-20T03:10:00.000Z"),
      claimNonceDigest: createHash("sha256")
        .update("claim-once-1234567890")
        .digest("hex"),
      request: {
        id: "request-1",
        sessionDigest: "a".repeat(64),
        expiresAt: new Date("2026-09-17T03:00:00.000Z"),
      },
      item: { id: "item-1", targetMediaId: "target-video" },
      episode: { id: "episode-1", state: "PENDING", generation: 1 },
    }
    const tx = {
      recommendationSelection: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      recommendationPlaybackEpisode: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    }
    const prisma = {
      recommendationSelection: { findUnique: vi.fn(async () => selection) },
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    }
    const signEpisodeCapability = vi.fn(async () => "episode-token")
    const dispatchFinalization = vi.fn(async () => {
      throw new Error("workflow unavailable")
    })
    const service = new RecommendationEpisodeService({
      prisma: prisma as never,
      tokenService: {
        activeKid: "active-kid",
        verifyDeliveryCapability: vi.fn(),
        signEpisodeCapability,
      },
      now: () => now,
      newId: () => "episode-jti",
      dispatchFinalization,
    })

    await expect(
      service.claim({
        caller,
        sessionDigest: "a".repeat(64),
        claimNonce: "claim-once-1234567890",
        mediaId: "target-video",
      }),
    ).resolves.toMatchObject({
      episodeId: "episode-1",
      capability: "episode-token",
    })
    expect(signEpisodeCapability).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaId: "target-video",
        jti: "episode-jti",
        generation: 1,
      }),
      {
        issuedAt: now,
        signingKid: "active-kid",
      },
    )
    expect(dispatchFinalization).toHaveBeenCalledWith({
      episodeId: "episode-1",
      generation: 1,
      reason: "episode-opened",
      notBefore: new Date("2026-04-20T07:00:00.000Z"),
    })
    expect(tx.recommendationPlaybackEpisode.updateMany).toHaveBeenCalledWith({
      where: {
        id: "episode-1",
        state: "PENDING",
        generation: 1,
      },
      data: expect.objectContaining({
        activeUntil: new Date("2026-04-20T07:00:00.000Z"),
        finalizationDueAt: new Date("2026-04-20T07:00:00.000Z"),
      }),
    })
  })

  it("replays a committed same-binding claim after its first response is lost", async () => {
    const claimedAt = new Date("2026-04-20T03:00:00.000Z")
    const activeUntil = new Date("2026-04-20T07:00:00.000Z")
    const hardUntil = new Date("2026-04-20T09:00:00.000Z")
    const selection = {
      id: "selection-1",
      claimedAt,
      // The one-use handoff may have expired after the claim committed. Its
      // stored episode horizons, not a fresh handoff window, govern replay.
      handoffExpiresAt: new Date("2026-04-20T03:10:00.000Z"),
      request: {
        id: "request-1",
        sessionDigest: "a".repeat(64),
        expiresAt: new Date("2026-09-17T03:00:00.000Z"),
      },
      item: { id: "item-1", targetMediaId: "target-video" },
      episode: {
        id: "episode-1",
        state: "CLAIMED",
        generation: 1,
        capabilityJti: "committed-episode-jti",
        signingKid: "previous-kid",
        claimedAt,
        activeUntil,
        hardUntil,
      },
    }
    const transaction = vi.fn()
    const signEpisodeCapability = vi.fn(async () => "replayed-episode-token")
    const service = new RecommendationEpisodeService({
      prisma: {
        recommendationSelection: { findUnique: vi.fn(async () => selection) },
        $transaction: transaction,
      } as never,
      tokenService: {
        activeKid: "new-active-kid",
        verifyDeliveryCapability: vi.fn(),
        signEpisodeCapability,
      },
      now: () => new Date("2026-04-20T03:30:00.000Z"),
      newId: () => {
        throw new Error("replay must retain the committed JTI")
      },
    })

    await expect(
      service.claim({
        caller,
        sessionDigest: "a".repeat(64),
        claimNonce: "claim-once-1234567890",
        mediaId: "target-video",
      }),
    ).resolves.toEqual({
      episodeId: "episode-1",
      capability: "replayed-episode-token",
      activeUntil: activeUntil.toISOString(),
      hardUntil: hardUntil.toISOString(),
    })
    expect(signEpisodeCapability).toHaveBeenCalledWith(
      {
        jti: "committed-episode-jti",
        episodeId: "episode-1",
        requestId: "request-1",
        itemId: "item-1",
        sessionDigest: "a".repeat(64),
        mediaId: "target-video",
        generation: 1,
      },
      { issuedAt: claimedAt, signingKid: "previous-kid" },
    )
    expect(transaction).not.toHaveBeenCalled()
  })

  it("audits a selection replay and quarantines a conflicting replay", async () => {
    const selectionInput = {
      caller,
      contractVersion: "recommendation-evidence-v1",
      capability: "delivery-token",
      requestId: "request-1",
      itemId: "item-1",
      sessionDigest: "a".repeat(64),
      eventId: "selection-1",
      occurredAt: "2026-04-20T03:00:00.000Z",
      tabDigest: "b".repeat(64),
    }
    const item = {
      id: "item-1",
      requestId: "request-1",
      targetMediaId: "target-video",
      canonicalHref: "/watch/target.html",
      capabilityJti: "delivery-jti",
      request: {
        state: "ISSUED",
        manifestId: "semantic-transcript-pgvector-v1",
        sessionDigest: selectionInput.sessionDigest,
        expiresAt: new Date("2026-09-17T03:00:00.000Z"),
      },
    }
    const acceptedDigest = recommendationEvidenceDigest({
      eventId: selectionInput.eventId,
      kind: "selection",
      occurredAt: selectionInput.occurredAt,
      tabDigest: selectionInput.tabDigest,
    })
    let existingDigest = acceptedDigest
    const tx = {
      $executeRaw: vi.fn(async () => 1),
      $queryRaw: vi.fn(async () => [{ attempts: 1 }]),
      recommendationSelection: {
        findUnique: vi.fn(async () => ({ payloadDigest: existingDigest })),
      },
      recommendationEvidenceAudit: { create: vi.fn(async () => ({})) },
    }
    const prisma = {
      recommendationServedItem: { findUnique: vi.fn(async () => item) },
      recommendationEvidenceAudit: { create: vi.fn(async () => ({})) },
      $queryRaw: vi.fn(async () => [{ attempts: 1 }]),
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
        work(tx),
      ),
    }
    const service = new RecommendationEpisodeService({
      prisma: prisma as never,
      tokenService: {
        activeKid: "active-kid",
        verifyDeliveryCapability: vi.fn(async () => ({
          iat: 1_776_654_000,
          exp: 1_776_654_600,
        })),
        signEpisodeCapability: vi.fn(),
      },
      now: () => new Date("2026-04-20T03:00:00.000Z"),
    })

    await expect(service.select(selectionInput)).resolves.toMatchObject({
      status: "replay",
    })
    expect(tx.$executeRaw).toHaveBeenCalledOnce()
    expect(tx.$executeRaw).toHaveBeenCalledBefore(
      tx.recommendationSelection.findUnique,
    )
    expect(tx.recommendationEvidenceAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "REPLAY",
        reasonCode: "selection_replay",
      }),
    })

    existingDigest = "f".repeat(64)
    await expect(service.select(selectionInput)).resolves.toMatchObject({
      status: "conflict",
    })
    expect(tx.$queryRaw.mock.calls[0]).toHaveLength(8)
  })

  it("uses typed failures for invalid selection and handoff input", async () => {
    const service = new RecommendationEpisodeService({
      prisma: {} as never,
      tokenService: {
        activeKid: "active-kid",
        verifyDeliveryCapability: vi.fn(),
        signEpisodeCapability: vi.fn(),
      },
    })

    await expect(
      service.select({
        caller,
        contractVersion: "wrong-contract",
        capability: "delivery-token",
        requestId: "request-1",
        itemId: "item-1",
        sessionDigest: "a".repeat(64),
        eventId: "selection-1",
        occurredAt: "2026-04-20T03:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" })
    await expect(
      service.claim({
        caller,
        sessionDigest: "invalid",
        claimNonce: "short",
        mediaId: "target-video",
      }),
    ).rejects.toMatchObject({ code: "invalid_binding" })
  })
})
