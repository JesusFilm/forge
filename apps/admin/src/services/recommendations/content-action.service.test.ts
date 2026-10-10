import { describe, expect, it, vi } from "vitest"
import { RecommendationContentActionService } from "./content-action.service"

const webCaller = {
  id: null,
  role: "CONSUMER_BEARER" as const,
  fleet: false,
  rateLimitBucketKey: "test-web-consumer-key",
}

const systemCaller = { id: null, role: "SYSTEM" as const }
const now = new Date("2026-08-25T12:30:00.000Z")

function harness({ matchedEpisode = false } = {}) {
  const rows = new Map<string, Record<string, unknown>>()
  const episode = {
    id: "episode-1",
    requestId: "request-1",
    itemId: "item-1",
    mediaId: "media-1",
    sessionDigest: "a".repeat(64),
    capabilityJti: "episode-jti-1",
    generation: 1,
    activeUntil: new Date("2026-08-25T12:00:00.000Z"),
    hardUntil: new Date("2026-08-25T14:00:00.000Z"),
    createdAt: new Date("2026-08-25T10:00:00.000Z"),
    request: {
      expiresAt: new Date("2026-09-23T10:00:00.000Z"),
      generation: 1,
    },
    item: { candidateGenerator: "semantic" },
  }
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    recommendationContentAction: {
      findUnique: vi.fn(
        async ({ where }: { where: { sessionDigest_eventId: object } }) =>
          rows.get(JSON.stringify(where.sessionDigest_eventId)) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: "action-1",
          replayCount: 0,
          conflictCount: 0,
          ...data,
        }
        rows.set(
          JSON.stringify({
            sessionDigest: data.sessionDigest,
            eventId: data.eventId,
          }),
          row,
        )
        return row
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string }
          data: Record<string, { increment: number }>
        }) => {
          const row = [...rows.values()].find((entry) => entry.id === where.id)!
          for (const [key, value] of Object.entries(data)) {
            row[key] = Number(row[key] ?? 0) + value.increment
          }
          return row
        },
      ),
    },
  }
  const prisma = {
    recommendationPlaybackEpisode: {
      findFirst: vi.fn(async () => (matchedEpisode ? episode : null)),
    },
    recommendationContentAction: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
      work(tx),
    ),
  }
  const service = new RecommendationContentActionService({
    prisma: prisma as never,
    now: () => now,
    newId: () => "action-1",
    newAuditId: () => "destination-audit-1",
  })
  return {
    service,
    prisma,
    tx,
    episode,
  }
}

const directShare = {
  caller: webCaller,
  contractVersion: "recommendation-content-action-v1",
  sessionDigest: "a".repeat(64),
  eventId: "share-1",
  occurredAt: "2026-08-25T12:29:00.000Z",
  mediaId: "media-1",
  actionClass: "human_action" as const,
  actionKind: "share" as const,
  actorClass: "human_anonymous" as const,
  purpose: "watch" as const,
  actionDetail: "link_copy",
  destination: null,
}

describe("RecommendationContentActionService", () => {
  it("records direct actions as unmatched and never fabricates recommendation attribution", async () => {
    const { service, tx, prisma } = harness()

    await expect(service.record(directShare)).resolves.toMatchObject({
      actionId: "action-1",
      eventId: "share-1",
      status: "accepted",
      matched: false,
      late: false,
    })
    expect(prisma.recommendationPlaybackEpisode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sessionDigest: "a".repeat(64),
          mediaId: "media-1",
        }),
      }),
    )
    expect(tx.recommendationContentAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestId: null,
        itemId: null,
        episodeId: null,
        candidateGenerator: null,
        learningEligible: false,
      }),
    })
  })

  it("derives request, item, episode, and lateness from the latest bounded matching episode", async () => {
    const { service, tx } = harness({ matchedEpisode: true })

    await expect(service.record(directShare)).resolves.toMatchObject({
      matched: true,
      late: true,
    })
    expect(tx.recommendationContentAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestId: "request-1",
        itemId: "item-1",
        episodeId: "episode-1",
        candidateGenerator: "semantic",
        late: true,
      }),
    })
  })

  it("suppresses identical duplicates and preserves the first fact on conflict", async () => {
    const { service, tx } = harness()

    await expect(service.record(directShare)).resolves.toMatchObject({
      status: "accepted",
    })
    await expect(service.record(directShare)).resolves.toMatchObject({
      status: "replay",
    })
    await expect(
      service.record({ ...directShare, actionDetail: "x_intent" }),
    ).resolves.toMatchObject({ status: "conflict" })
    expect(tx.recommendationContentAction.create).toHaveBeenCalledTimes(1)
    expect(tx.recommendationContentAction.update).toHaveBeenCalledWith({
      where: { id: "action-1" },
      data: { replayCount: { increment: 1 } },
    })
    expect(tx.recommendationContentAction.update).toHaveBeenCalledWith({
      where: { id: "action-1" },
      data: { conflictCount: { increment: 1 } },
    })
  })

  it("keeps machine disposition and reported value out of the human action class", async () => {
    const { service } = harness()

    await expect(
      service.record({
        ...directShare,
        caller: systemCaller,
        actorClass: "machine",
        actionClass: "machine_disposition",
        actionKind: "machine_disposition",
      }),
    ).resolves.toMatchObject({ status: "accepted", matched: false })
    for (const actorClass of ["internal", "test"] as const) {
      await expect(
        service.record({
          ...directShare,
          caller: systemCaller,
          eventId: `${actorClass}-disposition-1`,
          actorClass,
          actionClass: "machine_disposition",
          actionKind: "machine_disposition",
        }),
      ).resolves.toMatchObject({ status: "accepted", matched: false })
    }
    await expect(
      service.record({
        ...directShare,
        actorClass: "machine",
        actionClass: "machine_disposition",
        actionKind: "machine_disposition",
      }),
    ).rejects.toMatchObject({ code: "authentication_required" })
    await expect(
      service.record({
        ...directShare,
        actionKind: "reported_value",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" })
  })

  it("clears a deleted destination reference while retaining its opaque audit id", async () => {
    const { service, prisma } = harness()

    await service.record({
      ...directShare,
      eventId: "course-add-1",
      actionKind: "course_add",
      destination: { artifactType: "course", artifactId: "course-1" },
    })
    expect(
      await service.eraseDestination({
        artifactType: "course",
        artifactId: "course-1",
      }),
    ).toBe(1)
    expect(prisma.recommendationContentAction.updateMany).toHaveBeenCalledWith({
      where: {
        destinationArtifactType: "course",
        destinationArtifactId: "course-1",
      },
      data: {
        destinationArtifactType: null,
        destinationArtifactId: null,
        destinationDeletedAt: now,
      },
    })
  })
})
