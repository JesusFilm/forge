import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  WHATS_NEW_VOTE_BUDGET,
  WhatsNewFeatureVoteBudgetError,
  WhatsNewFeatureVoteService,
  WhatsNewFeatureVoteValidationError,
} from "./whats-new-feature-votes.service"

type Row = {
  id: string
  ballotId: string
  placementId: string
  featureId: string
  stickerId: string
  retractedAt: Date | null
}

/**
 * An in-memory stand-in for the one table this service owns, including the
 * unique index — the index is load-bearing for idempotence, so a double is
 * only useful if it enforces it.
 */
function buildPrisma(seed: Row[] = []) {
  const rows: Row[] = [...seed]
  let next = seed.length + 1
  return {
    rows,
    whatsNewFeatureVote: {
      findUnique: vi.fn(async ({ where }: never) => {
        const key = (where as { ballotId_placementId: Row })
          .ballotId_placementId
        return (
          rows.find(
            (row) =>
              row.ballotId === key.ballotId &&
              row.placementId === key.placementId,
          ) ?? null
        )
      }),
      create: vi.fn(async ({ data }: { data: Omit<Row, "id"> }) => {
        const clash = rows.find(
          (row) =>
            row.ballotId === data.ballotId &&
            row.placementId === data.placementId,
        )
        if (clash) throw Object.assign(new Error("unique"), { code: "P2002" })
        const row: Row = { id: `vote-${next++}`, ...data, retractedAt: null }
        rows.push(row)
        return row
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string }
          data: Partial<Row>
        }) => {
          const row = rows.find((candidate) => candidate.id === where.id)
          if (!row) throw new Error("missing row")
          Object.assign(row, data)
          return row
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Partial<Row>
          data: Partial<Row>
        }) => {
          const matched = rows.filter(
            (row) =>
              (where.ballotId == null || row.ballotId === where.ballotId) &&
              (where.placementId == null ||
                row.placementId === where.placementId) &&
              (where.retractedAt !== null || row.retractedAt === null),
          )
          for (const row of matched) Object.assign(row, data)
          return { count: matched.length }
        },
      ),
      count: vi.fn(
        async ({ where }: { where: Partial<Row> }) =>
          rows.filter(
            (row) =>
              row.ballotId === where.ballotId &&
              (where.retractedAt !== null || row.retractedAt === null),
          ).length,
      ),
      groupBy: vi.fn(async () => {
        const totals = new Map<string, number>()
        for (const row of rows) {
          if (row.retractedAt != null) continue
          totals.set(row.featureId, (totals.get(row.featureId) ?? 0) + 1)
        }
        return [...totals].map(([featureId, count]) => ({
          featureId,
          _count: { _all: count },
        }))
      }),
    },
  }
}

const vote = (index: number) => ({
  ballotId: "ballot_abcdefgh",
  placementId: `placement_0000000${index}`,
  featureId: "shareable-search",
  stickerId: "love" as const,
})

describe("WhatsNewFeatureVoteService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("records a placement and returns the live totals", async () => {
    const prisma = buildPrisma()
    const service = new WhatsNewFeatureVoteService(prisma as never)

    const tallies = await service.cast(vote(1))

    expect(tallies).toEqual([{ featureId: "shareable-search", votes: 1 }])
    expect(prisma.rows).toHaveLength(1)
  })

  it("counts a resent placement once", async () => {
    // The client cannot tell "never arrived" from "arrived, reply lost", so it
    // resends. Without the placement id being the identity, every dropped
    // response would inflate the tally.
    const prisma = buildPrisma()
    const service = new WhatsNewFeatureVoteService(prisma as never)

    await service.cast(vote(1))
    const tallies = await service.cast(vote(1))

    expect(tallies).toEqual([{ featureId: "shareable-search", votes: 1 }])
    expect(prisma.rows).toHaveLength(1)
  })

  it("counts once when two sends of a placement race", async () => {
    // Both sends miss the read, both try to create, and the unique index
    // decides. Losing that race means the vote is already recorded.
    const prisma = buildPrisma()
    const service = new WhatsNewFeatureVoteService(prisma as never)
    prisma.whatsNewFeatureVote.findUnique.mockResolvedValue(null as never)

    const [first, second] = await Promise.all([
      service.cast(vote(1)),
      service.cast(vote(1)),
    ])

    expect(prisma.rows).toHaveLength(1)
    expect(first).toEqual([{ featureId: "shareable-search", votes: 1 }])
    expect(second).toEqual([{ featureId: "shareable-search", votes: 1 }])
  })

  it("refuses a ballot's stickers past the budget", async () => {
    // The ONLY bound between one visitor and unbounded rows. The client shows
    // three; this is what makes three true for a caller that skips the client.
    const prisma = buildPrisma()
    const service = new WhatsNewFeatureVoteService(prisma as never)

    for (let index = 1; index <= WHATS_NEW_VOTE_BUDGET; index += 1) {
      await service.cast(vote(index))
    }

    await expect(service.cast(vote(9))).rejects.toBeInstanceOf(
      WhatsNewFeatureVoteBudgetError,
    )
    expect(prisma.rows).toHaveLength(WHATS_NEW_VOTE_BUDGET)
  })

  it("frees the budget again when a sticker is peeled off", async () => {
    const prisma = buildPrisma()
    const service = new WhatsNewFeatureVoteService(prisma as never)
    for (let index = 1; index <= WHATS_NEW_VOTE_BUDGET; index += 1) {
      await service.cast(vote(index))
    }

    const afterRetract = await service.retract({
      ballotId: vote(1).ballotId,
      placementId: vote(1).placementId,
    })

    expect(afterRetract).toEqual([
      { featureId: "shareable-search", votes: WHATS_NEW_VOTE_BUDGET - 1 },
    ])
    await expect(service.cast(vote(9))).resolves.toEqual([
      { featureId: "shareable-search", votes: WHATS_NEW_VOTE_BUDGET },
    ])
  })

  it("keeps a retracted row instead of deleting it", async () => {
    // "Placed then took it back" is signal. The read is the only thing that
    // decides what counts, so retraction must not lose the row.
    const prisma = buildPrisma()
    const service = new WhatsNewFeatureVoteService(prisma as never)
    await service.cast(vote(1))

    await service.retract({
      ballotId: vote(1).ballotId,
      placementId: vote(1).placementId,
    })

    expect(prisma.rows).toHaveLength(1)
    expect(prisma.rows[0].retractedAt).toBeInstanceOf(Date)
    expect(await service.tallies()).toEqual([])
  })

  it("re-places a peeled slot without minting a second vote", async () => {
    const prisma = buildPrisma()
    const service = new WhatsNewFeatureVoteService(prisma as never)
    await service.cast(vote(1))
    await service.retract({
      ballotId: vote(1).ballotId,
      placementId: vote(1).placementId,
    })

    const tallies = await service.cast({
      ...vote(1),
      featureId: "dedicated-language",
    })

    expect(prisma.rows).toHaveLength(1)
    expect(tallies).toEqual([{ featureId: "dedicated-language", votes: 1 }])
  })

  it("takes a whole ballot back at once", async () => {
    const prisma = buildPrisma()
    const service = new WhatsNewFeatureVoteService(prisma as never)
    await service.cast(vote(1))
    await service.cast({ ...vote(2), featureId: "bible-passages" })

    expect(await service.retractBallot(vote(1).ballotId)).toEqual([])
    expect(prisma.rows.every((row) => row.retractedAt != null)).toBe(true)
  })

  it("leaves other ballots alone when one is taken back", async () => {
    // Anti-vacuous companion: a `retractBallot` that ignored its argument
    // would satisfy the test above by wiping the whole table.
    const prisma = buildPrisma()
    const service = new WhatsNewFeatureVoteService(prisma as never)
    await service.cast(vote(1))
    await service.cast({
      ...vote(1),
      ballotId: "ballot_zyxwvuts",
      featureId: "bible-passages",
    })

    const tallies = await service.retractBallot(vote(1).ballotId)

    expect(tallies).toEqual([{ featureId: "bible-passages", votes: 1 }])
  })

  it("rejects ids and sticker kinds it does not recognise", async () => {
    const prisma = buildPrisma()
    const service = new WhatsNewFeatureVoteService(prisma as never)

    const rejected = [
      { ...vote(1), ballotId: "short" },
      { ...vote(1), ballotId: "ballot with spaces!!" },
      { ...vote(1), placementId: "no" },
      { ...vote(1), featureId: "Shareable Search" },
      { ...vote(1), featureId: "a".repeat(65) },
      { ...vote(1), stickerId: "shrug" as never },
    ]
    for (const input of rejected) {
      await expect(
        service.cast(input),
        JSON.stringify(input),
      ).rejects.toBeInstanceOf(WhatsNewFeatureVoteValidationError)
    }
    expect(prisma.rows).toHaveLength(0)
  })

  it("sorts tallies by feature so the payload is stable", async () => {
    const prisma = buildPrisma()
    const service = new WhatsNewFeatureVoteService(prisma as never)
    await service.cast({ ...vote(1), featureId: "video-verses" })
    await service.cast({ ...vote(2), featureId: "bible-passages" })

    expect((await service.tallies()).map((row) => row.featureId)).toEqual([
      "bible-passages",
      "video-verses",
    ])
  })
})
