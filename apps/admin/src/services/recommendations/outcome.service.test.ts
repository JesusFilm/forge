import { describe, expect, it, vi } from "vitest"
import { RecommendationOutcomeService } from "./outcome.service"

const expiresAt = new Date("2026-09-17T03:00:00.000Z")
const now = new Date("2026-08-19T09:00:00.000Z")

function fact(
  sequence: number,
  kind: string,
  payload: Record<string, unknown>,
) {
  return {
    id: `fact-${sequence}`,
    eventId: `event-${sequence}`,
    sequence,
    kind,
    payload,
    payloadDigest: String(sequence).padStart(64, "0"),
    occurredAt: new Date(`2026-08-19T03:00:0${sequence}.000Z`),
    late: false,
  }
}

function episode(facts: ReturnType<typeof fact>[]) {
  return {
    id: "episode-1",
    requestId: "request-1",
    itemId: "item-1",
    generation: 2,
    state: "CLAIMED",
    activeUntil: new Date("2026-08-19T07:00:00.000Z"),
    hardUntil: new Date("2026-08-19T09:00:00.000Z"),
    expiresAt,
    request: { id: "request-1", generation: 2, expiresAt },
    facts,
  }
}

function harness(input: {
  facts: ReturnType<typeof fact>[]
  latest?: Record<string, unknown> | null
  exact?: Record<string, unknown> | null
  current?: ReturnType<typeof episode> | null
}) {
  const current =
    input.current === undefined ? episode(input.facts) : input.current
  const created: Array<Record<string, unknown>> = []
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    recommendationPlaybackEpisode: {
      findUnique: vi.fn(async () => current),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    recommendationOutcomeRevision: {
      findUnique: vi.fn(async () => input.exact ?? null),
      findFirst: vi.fn(async () => input.latest ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data)
        return data
      }),
    },
  }
  const prisma = {
    $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
      work(tx),
    ),
  }
  const service = new RecommendationOutcomeService({
    prisma: prisma as never,
    now: () => now,
    newId: () => "outcome-2",
  })
  return { service, prisma, tx, created }
}

describe("RecommendationOutcomeService", () => {
  it("retries a serializable conflict before publishing", async () => {
    const { service, prisma } = harness({ facts: [] })
    prisma.$transaction.mockRejectedValueOnce(
      Object.assign(new Error("serialization conflict"), { code: "P2034" }),
    )

    await expect(
      service.finalize({ episodeId: "episode-1", generation: 2 }),
    ).resolves.toMatchObject({ status: "published", revision: 1 })
    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
  })

  it("freezes ordered facts and classifies maximum position separately from wall elapsed", async () => {
    const { service, tx, created } = harness({
      facts: [
        fact(3, "playback_seek", { fromSeconds: 5, toSeconds: 35 }),
        fact(1, "playback_progress", {
          positionSeconds: 5,
          durationSeconds: 100,
          progress: 0.05,
          wallElapsedMilliseconds: 300_000,
        }),
      ],
    })

    await expect(
      service.finalize({ episodeId: "episode-1", generation: 2 }),
    ).resolves.toMatchObject({ status: "published", revision: 1 })
    expect(tx.$executeRaw).toHaveBeenCalledOnce()
    expect(created[0]).toMatchObject({
      factWatermark: 3,
      revision: 1,
      supersedesId: null,
      qualifiedView: true,
      viewQualityWeight: null,
      viewQualityWeightReason: "continuous_weight_not_available",
      learningEligible: false,
      generation: 2,
      reasons: expect.arrayContaining([
        "maximum_position_at_least_30_seconds",
        "missing_playback_start",
        "missing_terminal_fact",
        "active_visible_playing_coverage_missing",
      ]),
    })
    expect(JSON.stringify(created[0])).not.toMatch(/attention|satisfaction/i)
  })

  it("publishes the active proxy beside legacy and does not turn a seek into active consumption", async () => {
    const { service, created } = harness({
      facts: [
        fact(1, "playback_start", { positionSeconds: 0 }),
        fact(2, "playback_seek", { fromSeconds: 0, toSeconds: 40 }),
        fact(3, "playback_end", {
          reason: "route_exit",
          positionSeconds: 40,
          durationSeconds: 100,
          progress: 0.4,
          completed: false,
        }),
      ],
    })

    await expect(
      service.finalize({ episodeId: "episode-1", generation: 2 }),
    ).resolves.toMatchObject({ status: "published" })
    expect(created).toHaveLength(2)
    expect(
      created.find(
        (outcome) => outcome.classifierVersion === "legacy-position-v0",
      ),
    ).toMatchObject({ qualifiedView: true })
    expect(
      created.find(
        (outcome) => outcome.classifierVersion === "active-watch-proxy-v1",
      ),
    ).toMatchObject({
      qualifiedView: false,
      viewQualityWeight: 0,
      viewQualityWeightReason: "active_fraction_of_duration",
      activePlaybackMilliseconds: 0,
      durationSeconds: 100,
      durationCohort: "medium",
      activeCoverage: "missing",
      learningEligible: false,
      reasons: expect.arrayContaining([
        "below_active_playback_threshold",
        "active_visible_playing_coverage_missing",
      ]),
    })
  })

  it("unions overlapping active-playing facts before publishing the proxy", async () => {
    const first = {
      ...fact(2, "playback_active_visible_playing", {
        activeMilliseconds: 10_000,
        coverage: "complete",
      }),
      occurredAt: new Date("2026-08-19T03:00:10.000Z"),
    }
    const overlapping = {
      ...fact(3, "playback_active_visible_playing", {
        activeMilliseconds: 10_000,
        coverage: "complete",
      }),
      occurredAt: new Date("2026-08-19T03:00:15.000Z"),
    }
    const terminal = {
      ...fact(4, "playback_end", {
        reason: "route_exit",
        positionSeconds: 15,
        durationSeconds: 100,
        progress: 0.15,
        completed: false,
      }),
      occurredAt: new Date("2026-08-19T03:00:16.000Z"),
    }
    const { service, created } = harness({
      facts: [
        fact(1, "playback_start", { positionSeconds: 0 }),
        first,
        overlapping,
        terminal,
      ],
    })

    await service.finalize({ episodeId: "episode-1", generation: 2 })

    expect(
      created.find(
        (outcome) => outcome.classifierVersion === "active-watch-proxy-v1",
      ),
    ).toMatchObject({
      activePlaybackMilliseconds: 15_000,
      viewQualityWeight: 0.15,
    })
  })

  it("returns the exact frozen input idempotently without a second publication", async () => {
    const existing = {
      id: "outcome-1",
      revision: 1,
      factWatermark: 1,
      inputDigest: "a".repeat(64),
    }
    const { service, tx } = harness({
      facts: [fact(1, "playback_start", { positionSeconds: 0 })],
      exact: existing,
    })
    service.digestFacts = vi.fn(() => existing.inputDigest)

    await expect(
      service.finalize({
        episodeId: "episode-1",
        generation: 2,
        reason: "timeout",
      }),
    ).resolves.toMatchObject({ status: "existing", revision: 1 })
    expect(tx.recommendationOutcomeRevision.create).not.toHaveBeenCalled()
    expect(tx.recommendationPlaybackEpisode.updateMany).toHaveBeenCalledWith({
      where: { id: "episode-1", generation: 2 },
      data: { finalizationDueAt: null },
    })
  })

  it("fences an early fact-advanced wake until a terminal fact arrives", async () => {
    const { service, tx } = harness({
      facts: [fact(1, "playback_start", { positionSeconds: 0 })],
    })
    await expect(
      service.finalize({
        episodeId: "episode-1",
        generation: 2,
        reason: "fact-advanced",
      }),
    ).resolves.toEqual({ status: "fenced", reason: "not_ready" })
    expect(tx.recommendationOutcomeRevision.create).not.toHaveBeenCalled()
    expect(tx.recommendationPlaybackEpisode.updateMany).not.toHaveBeenCalled()
  })

  it("appends one monotonic revision that supersedes the latest lower watermark", async () => {
    const latest = {
      id: "outcome-1",
      revision: 4,
      factWatermark: 2,
      inputDigest: "b".repeat(64),
    }
    const { service, tx, created } = harness({
      facts: [
        fact(1, "playback_start", { positionSeconds: 0 }),
        fact(2, "playback_progress", {
          positionSeconds: 12,
          durationSeconds: 100,
          progress: 0.12,
          wallElapsedMilliseconds: 12_000,
        }),
        {
          ...fact(3, "playback_end", {
            reason: "route_exit",
            positionSeconds: 31,
            durationSeconds: 100,
            progress: 0.31,
            completed: false,
          }),
          late: true,
        },
      ],
      latest,
    })

    await expect(
      service.finalize({ episodeId: "episode-1", generation: 2 }),
    ).resolves.toMatchObject({ status: "published", revision: 5 })
    expect(created[0]).toMatchObject({
      revision: 5,
      supersedesId: "outcome-1",
      factWatermark: 3,
    })
    expect(tx.recommendationPlaybackEpisode.updateMany).toHaveBeenCalledWith({
      where: { id: "episode-1", generation: 2 },
      data: {
        state: "FINALIZED",
        finalizedAt: now,
        finalizationDueAt: null,
      },
    })
  })

  it("fences a stale generation or purged episode without publishing", async () => {
    const stale = episode([])
    stale.generation = 3
    const { service, tx } = harness({ facts: [], current: stale })
    await expect(
      service.finalize({ episodeId: "episode-1", generation: 2 }),
    ).resolves.toEqual({ status: "fenced", reason: "generation_changed" })
    expect(tx.recommendationOutcomeRevision.create).not.toHaveBeenCalled()
  })

  it("fences a stale pre-claim timeout wake after the active horizon extends", async () => {
    const extended = {
      ...episode([]),
      activeUntil: new Date("2026-08-19T10:00:00.000Z"),
      hardUntil: new Date("2026-08-19T12:00:00.000Z"),
    }
    const { service, tx } = harness({ facts: [], current: extended })
    await expect(
      service.finalize({
        episodeId: "episode-1",
        generation: 2,
        reason: "timeout",
      }),
    ).resolves.toEqual({ status: "fenced", reason: "not_ready" })
    expect(tx.recommendationOutcomeRevision.create).not.toHaveBeenCalled()
  })

  it("times out an overdue episode even when it has nonterminal facts", async () => {
    const { service, tx, created } = harness({
      facts: [
        fact(1, "playback_start", { positionSeconds: 0 }),
        fact(2, "playback_progress", {
          positionSeconds: 12,
          durationSeconds: 100,
          progress: 0.12,
        }),
      ],
    })

    await expect(
      service.finalize({
        episodeId: "episode-1",
        generation: 2,
        reason: "timeout",
      }),
    ).resolves.toMatchObject({ status: "published", factWatermark: 2 })
    expect(created[0]).toMatchObject({
      reasons: expect.arrayContaining([
        "missing_terminal_fact",
        "terminal_timeout",
      ]),
    })
    expect(tx.recommendationPlaybackEpisode.updateMany).toHaveBeenCalledWith({
      where: { id: "episode-1", generation: 2 },
      data: {
        state: "TIMED_OUT",
        finalizedAt: now,
        finalizationDueAt: null,
      },
    })
  })
})
