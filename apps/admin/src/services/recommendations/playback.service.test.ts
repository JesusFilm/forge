import { describe, expect, it, vi } from "vitest"
import { RecommendationPlaybackService } from "./playback.service"
import { RecommendationBindingError } from "./errors"

const caller = {
  id: null,
  role: "CONSUMER_BEARER" as const,
  fleet: false,
  rateLimitBucketKey: "test-web-consumer-key",
}

const now = new Date("2026-08-19T03:00:00.000Z")

function episode() {
  return {
    id: "episode-1",
    requestId: "request-1",
    itemId: "item-1",
    mediaId: "media-1",
    sessionDigest: "a".repeat(64),
    state: "CLAIMED",
    capabilityJti: "episode-jti",
    activeUntil: new Date("2026-08-19T07:00:00.000Z"),
    hardUntil: new Date("2026-08-19T09:00:00.000Z"),
    nextFactSequence: 1,
    generation: 3,
    claimedAt: new Date("2026-08-19T03:00:00.000Z"),
    expiresAt: new Date("2026-09-17T03:00:00.000Z"),
    request: {
      id: "request-1",
      generation: 3,
      expiresAt: new Date("2026-09-17T03:00:00.000Z"),
    },
  }
}

function harness(options: { current?: ReturnType<typeof episode> } = {}) {
  const current = options.current ?? episode()
  const facts: Array<Record<string, unknown>> = []
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => []),
    recommendationPlaybackEpisode: {
      findUnique: vi.fn(async () => ({ ...current })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    recommendationPlaybackFact: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: { episodeId_eventId: { eventId: string } }
        }) =>
          facts.find(
            (fact) => fact.eventId === where.episodeId_eventId.eventId,
          ) ?? null,
      ),
      count: vi.fn(async () => facts.length),
      groupBy: vi.fn(async () => []),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        facts.push(data)
        return data
      }),
    },
    recommendationEvidenceAudit: { create: vi.fn(async () => ({})) },
  }
  const prisma = {
    recommendationPlaybackEpisode: {
      findUnique: vi.fn(async () => ({ ...current })),
    },
    recommendationEvidenceAudit: { create: vi.fn(async () => ({})) },
    $queryRaw: vi.fn(
      async (): Promise<Array<{ attempts: number | null }>> => [
        { attempts: 1 },
      ],
    ),
    $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
      work(tx),
    ),
  }
  const verifyEpisodeCapability = vi.fn(async () => ({ late: false }))
  const dispatchFinalization = vi.fn(async () => ({ queued: true }))
  const service = new RecommendationPlaybackService({
    prisma: prisma as never,
    tokenService: { verifyEpisodeCapability },
    dispatchFinalization,
    now: () => now,
    newId: (() => {
      let value = 0
      return () => `fact-${++value}`
    })(),
  })
  return {
    service,
    prisma,
    tx,
    facts,
    verifyEpisodeCapability,
    dispatchFinalization,
  }
}

const baseInput = {
  caller,
  contractVersion: "recommendation-evidence-v1",
  capability: "episode-capability",
  episodeId: "episode-1",
  sessionDigest: "a".repeat(64),
  mediaId: "media-1",
}

describe("RecommendationPlaybackService", () => {
  it("rejects playback after its personalized assignment is fenced", async () => {
    const current = episode()
    Object.assign(current.request, {
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
    })
    const { service, verifyEpisodeCapability } = harness({ current })

    await expect(
      service.record({
        ...baseInput,
        events: [
          {
            eventId: "attempt-fenced",
            kind: "playback_attempt",
            occurredAt: now.toISOString(),
            payload: { initiation: "manual" },
          },
        ],
      }),
    ).rejects.toBeInstanceOf(RecommendationBindingError)
    expect(verifyEpisodeCapability).not.toHaveBeenCalled()
  })

  it("accepts strict ordered facts with server sequences and wakes finalization after terminal commit", async () => {
    const {
      service,
      tx,
      facts,
      prisma,
      verifyEpisodeCapability,
      dispatchFinalization,
    } = harness()
    const events = [
      {
        eventId: "attempt-1",
        kind: "playback_attempt" as const,
        occurredAt: now.toISOString(),
        payload: { initiation: "manual" as const },
      },
      {
        eventId: "start-1",
        kind: "playback_start" as const,
        occurredAt: now.toISOString(),
        payload: { positionSeconds: 0 },
      },
      {
        eventId: "end-1",
        kind: "playback_end" as const,
        occurredAt: now.toISOString(),
        payload: {
          reason: "ended" as const,
          positionSeconds: 35,
          durationSeconds: 120,
          progress: 35 / 120,
          completed: false,
        },
      },
    ]

    await expect(service.record({ ...baseInput, events })).resolves.toEqual([
      { eventId: "attempt-1", status: "accepted", sequence: 1 },
      { eventId: "start-1", status: "accepted", sequence: 2 },
      { eventId: "end-1", status: "accepted", sequence: 3 },
    ])
    expect(facts.map((fact) => fact.sequence)).toEqual([1, 2, 3])
    expect(prisma.$queryRaw).toHaveBeenCalledOnce()
    expect(tx.$executeRaw).toHaveBeenCalledOnce()
    expect(tx.recommendationPlaybackEpisode.updateMany).toHaveBeenCalledWith({
      where: {
        id: "episode-1",
        generation: 3,
        nextFactSequence: 1,
      },
      data: { nextFactSequence: 4, finalizationDueAt: now },
    })
    expect(verifyEpisodeCapability).toHaveBeenCalledWith(
      "episode-capability",
      expect.objectContaining({
        jti: "episode-jti",
        episodeId: "episode-1",
        requestId: "request-1",
        itemId: "item-1",
        sessionDigest: "a".repeat(64),
        mediaId: "media-1",
        generation: 3,
      }),
    )
    expect(dispatchFinalization).toHaveBeenCalledWith({
      episodeId: "episode-1",
      generation: 3,
      reason: "terminal-fact",
      notBefore: now,
    })
  })

  it("retries a serializable conflict without consuming capability budget twice", async () => {
    const { service, prisma } = harness()
    prisma.$transaction.mockRejectedValueOnce(
      Object.assign(new Error("serialization conflict"), { code: "P2034" }),
    )
    const events = [
      {
        eventId: "attempt-retry-1",
        kind: "playback_attempt" as const,
        occurredAt: now.toISOString(),
        payload: { initiation: "manual" as const },
      },
    ]

    await expect(service.record({ ...baseInput, events })).resolves.toEqual([
      { eventId: "attempt-retry-1", status: "accepted", sequence: 1 },
    ])
    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
    expect(prisma.$queryRaw).toHaveBeenCalledOnce()
  })

  it("wakes reconciliation when a later non-terminal fact advances a terminal episode watermark", async () => {
    const { service, tx, dispatchFinalization } = harness()
    tx.recommendationPlaybackFact.groupBy.mockResolvedValueOnce([
      { kind: "playback_end", _count: { _all: 1 } },
    ] as never)
    await expect(
      service.record({
        ...baseInput,
        events: [
          {
            eventId: "progress-1",
            kind: "playback_progress",
            occurredAt: now.toISOString(),
            payload: {
              positionSeconds: 12,
              durationSeconds: 120,
              progress: 0.1,
              wallElapsedMilliseconds: 12_000,
            },
          },
        ],
      }),
    ).resolves.toEqual([
      { eventId: "progress-1", status: "accepted", sequence: 1 },
    ])
    expect(dispatchFinalization).toHaveBeenCalledWith({
      episodeId: "episode-1",
      generation: 3,
      reason: "fact-advanced",
      notBefore: now,
    })
    expect(tx.recommendationPlaybackEpisode.updateMany).toHaveBeenCalledWith({
      where: {
        id: "episode-1",
        generation: 3,
        nextFactSequence: 1,
      },
      data: { nextFactSequence: 2, finalizationDueAt: now },
    })
  })

  it("does not start finalization for an early non-terminal watermark", async () => {
    const { service, tx, dispatchFinalization } = harness()
    await service.record({
      ...baseInput,
      events: [
        {
          eventId: "start-before-terminal",
          kind: "playback_start",
          occurredAt: now.toISOString(),
          payload: { positionSeconds: 0 },
        },
      ],
    })
    expect(dispatchFinalization).not.toHaveBeenCalled()
    expect(tx.recommendationPlaybackEpisode.updateMany).toHaveBeenCalledWith({
      where: {
        id: "episode-1",
        generation: 3,
        nextFactSequence: 1,
      },
      data: { nextFactSequence: 2 },
    })
  })

  it("returns replay/conflict receipts without allocating new sequence numbers", async () => {
    const { service, tx, facts } = harness()
    const event = {
      eventId: "start-1",
      kind: "playback_start" as const,
      occurredAt: now.toISOString(),
      payload: { positionSeconds: 0 },
    }
    const digest = await service.digest(event)
    facts.push({
      episodeId: "episode-1",
      eventId: "start-1",
      payloadDigest: digest,
      sequence: 8,
    })
    tx.recommendationPlaybackFact.findUnique.mockResolvedValueOnce({
      eventId: "start-1",
      payloadDigest: digest,
      sequence: 8,
    })

    await expect(
      service.record({ ...baseInput, events: [event] }),
    ).resolves.toEqual([{ eventId: "start-1", status: "replay", sequence: 8 }])
    expect(tx.recommendationPlaybackEpisode.updateMany).not.toHaveBeenCalled()
    expect(tx.recommendationEvidenceAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "REPLAY",
        reasonCode: "playback_fact_replay",
      }),
    })

    tx.recommendationPlaybackFact.findUnique.mockResolvedValueOnce({
      eventId: "start-1",
      payloadDigest: "f".repeat(64),
      sequence: 8,
    })
    await expect(
      service.record({ ...baseInput, events: [event] }),
    ).resolves.toEqual([
      { eventId: "start-1", status: "conflict", sequence: 8 },
    ])
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2)
    expect(tx.$queryRaw).toHaveBeenCalledOnce()
  })

  it("commits a sanitized rejection audit when per-kind cardinality is exhausted", async () => {
    const { service, prisma, tx } = harness()
    tx.recommendationPlaybackFact.groupBy.mockResolvedValue([
      { kind: "playback_attempt", _count: { _all: 1 } },
    ] as never)
    await expect(
      service.record({
        ...baseInput,
        events: [
          {
            eventId: "attempt-overflow",
            kind: "playback_attempt",
            occurredAt: now.toISOString(),
            payload: { initiation: "automatic" },
          },
        ],
      }),
    ).rejects.toThrow("cardinality exceeded")
    expect(prisma.recommendationEvidenceAudit.create).toHaveBeenCalledWith({
      data: {
        requestId: "request-1",
        kind: "COMMITTED_REJECTION",
        reasonCode: "playback_fact_cardinality_exceeded",
        detail: { episodeId: "episode-1", generation: 3 },
        expiresAt: new Date("2026-09-17T03:00:00.000Z"),
      },
    })
  })

  it("enforces an episode-capability attempt budget before replay processing", async () => {
    const { service, prisma } = harness()
    prisma.$queryRaw.mockResolvedValueOnce([{ attempts: null }])

    await expect(
      service.record({
        ...baseInput,
        events: [
          {
            eventId: "start-over-budget",
            kind: "playback_start",
            occurredAt: now.toISOString(),
            payload: { positionSeconds: 0 },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "invalid_binding" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.recommendationEvidenceAudit.create).not.toHaveBeenCalled()
  })

  it("rejects a non-terminal late fact before writing business state", async () => {
    const current = {
      ...episode(),
      activeUntil: new Date("2026-08-19T02:00:00.000Z"),
      hardUntil: new Date("2026-08-19T04:00:00.000Z"),
    }
    const { service, prisma } = harness({ current })

    await expect(
      service.record({
        ...baseInput,
        events: [
          {
            eventId: "progress-late",
            kind: "playback_progress",
            occurredAt: "2026-08-19T01:59:00.000Z",
            payload: {
              positionSeconds: 10,
              durationSeconds: 100,
              progress: 0.1,
              wallElapsedMilliseconds: 15_000,
            },
          },
        ],
      }),
    ).rejects.toThrow("late terminal")
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("accepts a terminal fact received late when it occurred inside the active horizon", async () => {
    const current = {
      ...episode(),
      activeUntil: new Date("2026-08-19T02:00:00.000Z"),
      hardUntil: new Date("2026-08-19T04:00:00.000Z"),
    }
    const { service, tx } = harness({ current })
    await expect(
      service.record({
        ...baseInput,
        events: [
          {
            eventId: "end-late",
            kind: "playback_end",
            occurredAt: "2026-08-19T01:59:00.000Z",
            payload: {
              reason: "route_exit",
              positionSeconds: 10,
              durationSeconds: 100,
              progress: 0.1,
              completed: false,
            },
          },
        ],
      }),
    ).resolves.toEqual([
      { eventId: "end-late", status: "accepted", sequence: 1 },
    ])
    expect(tx.recommendationEvidenceAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: "LATE" }),
    })
  })
})
