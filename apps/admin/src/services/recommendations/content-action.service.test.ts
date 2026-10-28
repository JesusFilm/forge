import { describe, expect, it, vi } from "vitest"
const history = vi.hoisted(() => ({ dispatch: vi.fn() }))
vi.mock("./event-history/runtime", () => ({
  dispatchPreparedRecommendationEventsAfterCommit: history.dispatch,
}))
import { RecommendationContentActionService } from "./content-action.service"
import { createRecommendationEventDispatcher } from "./event-history/dispatch"
import { RecommendationClickHouseError } from "./event-history/clickhouse"

const webCaller = {
  id: null,
  role: "CONSUMER_BEARER" as const,
  fleet: false,
  rateLimitBucketKey: "test-web-consumer-key",
}

const systemCaller = { id: null, role: "SYSTEM" as const }
const now = new Date("2026-08-25T12:30:00.000Z")

function harness({
  matchedEpisode = false,
  onCommit,
}: { matchedEpisode?: boolean; onCommit?: () => void } = {}) {
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
    $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => {
      const result = await work(tx)
      onCommit?.()
      return result
    }),
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
  it("exports a committed action once, after commit, without private destination or session data", async () => {
    history.dispatch.mockClear()
    const { service } = harness({
      onCommit: () => {
        committed = true
      },
    })
    let committed = false
    history.dispatch.mockImplementationOnce((_family, prepare) => {
      expect(committed).toBe(true)
      return prepare()
    })
    await service.record(directShare)
    expect(history.dispatch).toHaveBeenCalledTimes(1)
    expect(history.dispatch.mock.calls[0]?.[0]).toBe("content-action")
    const events = history.dispatch.mock.calls[0]?.[1]()
    expect(events[0]).toMatchObject({
      family: "content-action",
      logicalId: "action-1",
      revision: 1,
    })
    expect(JSON.stringify(events)).not.toMatch(
      /session|browser|destinationArtifact/i,
    )
    expect(committed).toBe(true)
    await service.record(directShare)
    expect(history.dispatch).toHaveBeenCalledTimes(1)
  })

  it("does not export a rolled-back action", async () => {
    history.dispatch.mockClear()
    const { service, prisma } = harness()
    prisma.$transaction.mockRejectedValueOnce(new Error("rollback"))
    await expect(service.record(directShare)).rejects.toThrow("rollback")
    expect(history.dispatch).not.toHaveBeenCalled()
  })

  it("returns the committed action before a failed history insert settles and never retries", async () => {
    history.dispatch.mockClear()
    let fail!: (error: Error) => void
    const insert = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject
        }),
    )
    const dispatcher = createRecommendationEventDispatcher({
      client: { insert },
      now: () => now.getTime(),
    })
    history.dispatch.mockImplementationOnce((_family, prepare) =>
      dispatcher.dispatch(prepare()),
    )
    const { service } = harness()
    await expect(service.record(directShare)).resolves.toMatchObject({
      status: "accepted",
    })
    expect(insert).toHaveBeenCalledTimes(1)
    expect(dispatcher.snapshot().inFlightEvents).toBe(1)
    fail(new RecommendationClickHouseError("transport"))
    await dispatcher.drain()
    expect(dispatcher.snapshot().failedEvents.transport).toBe(1)
    expect(insert).toHaveBeenCalledTimes(1)
  })
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
    history.dispatch.mockClear()
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
    const exported = history.dispatch.mock.calls[0]?.[1]()[0]
    expect(exported.payload.destinationAuditId).toBe("destination-audit-1")
    expect(JSON.stringify(exported)).not.toContain("course-1")
  })
})
