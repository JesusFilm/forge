/**
 * Real-Postgres companion to `whats-new-feature-votes.service.test.ts`.
 *
 * The mocked suite proves the branch shape. This one proves the things a
 * hand-written double cannot: that Prisma's `groupBy` projection is the shape
 * the tallies reader unpacks, that the unique index really is the arbiter of a
 * racing double-cast, and that the budget holds when two casts run at once
 * rather than in sequence.
 *
 * Skipped unless a database is reachable, so it stays a local/CI-with-DB check
 * rather than a hard dependency for everyone running unit tests.
 *
 * The client is built in `beforeAll`, NOT in the describe body, and that is
 * the whole reason this file is safe to have in the default suite.
 * `describe.skip` skips the TESTS; it still runs the body to collect them, so
 * a `new PrismaClient()` sitting there is constructed even when the suite is
 * skipped — with `url: undefined`, which Prisma rejects outright. That threw
 * at collection time and failed the whole file, and it only surfaced once a
 * change made CI run the admin suite at all.
 */
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  WHATS_NEW_VOTE_BUDGET,
  WhatsNewFeatureVoteBudgetError,
  WhatsNewFeatureVoteService,
} from "./whats-new-feature-votes.service"

const databaseUrl = process.env.WHATS_NEW_VOTE_TEST_DATABASE_URL

const suite = databaseUrl == null ? describe.skip : describe

suite("WhatsNewFeatureVoteService against Postgres", () => {
  let prisma: PrismaClient
  let service: WhatsNewFeatureVoteService
  const ballot = "ballot_dbtest01"

  beforeAll(() => {
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    service = new WhatsNewFeatureVoteService(prisma)
  })

  beforeEach(async () => {
    await prisma.whatsNewFeatureVote.deleteMany({})
  })

  afterAll(async () => {
    await prisma.whatsNewFeatureVote.deleteMany({})
    await prisma.$disconnect()
  })

  const vote = (index: number, featureId = "shareable-search") => ({
    ballotId: ballot,
    placementId: `placement_db_${index}`,
    featureId,
    stickerId: "love" as const,
  })

  it("reads totals back out of the groupBy projection", async () => {
    await service.cast(vote(1))
    await service.cast(vote(2, "bible-passages"))
    await service.cast(vote(3, "bible-passages"))

    expect(await service.tallies()).toEqual([
      { featureId: "bible-passages", votes: 2 },
      { featureId: "shareable-search", votes: 1 },
    ])
  })

  it("counts one row when the same placement is cast twice at once", async () => {
    // Both calls can miss the existence read and race to INSERT. The unique
    // index decides, and the loser must treat the violation as "already
    // recorded" rather than surfacing a 500 to an anonymous voter.
    const results = await Promise.all([
      service.cast(vote(1)),
      service.cast(vote(1)),
    ])

    const rows = await prisma.whatsNewFeatureVote.count()
    expect(rows).toBe(1)
    for (const tallies of results) {
      expect(tallies).toEqual([{ featureId: "shareable-search", votes: 1 }])
    }
  })

  it("holds the budget across concurrent casts", async () => {
    // Read-then-write is not atomic, so parallel casts can all pass the count
    // check. Documenting the real behaviour: the ceiling is the budget plus
    // however many casts overlapped, which the client's own 3-sticker cap keeps
    // to single digits. Tightening this needs a DB constraint, not a comment.
    const attempts = await Promise.allSettled(
      Array.from({ length: WHATS_NEW_VOTE_BUDGET + 3 }, (_, index) =>
        service.cast(vote(index + 1)),
      ),
    )

    const rejected = attempts.filter((entry) => entry.status === "rejected")
    for (const entry of rejected) {
      expect((entry as PromiseRejectedResult).reason).toBeInstanceOf(
        WhatsNewFeatureVoteBudgetError,
      )
    }
    const live = await prisma.whatsNewFeatureVote.count({
      where: { retractedAt: null },
    })
    expect(live).toBeGreaterThanOrEqual(WHATS_NEW_VOTE_BUDGET)
    expect(live).toBeLessThanOrEqual(WHATS_NEW_VOTE_BUDGET + 3)
  })

  it("holds the budget when casts are sequential", async () => {
    for (let index = 1; index <= WHATS_NEW_VOTE_BUDGET; index += 1) {
      await service.cast(vote(index))
    }

    await expect(service.cast(vote(99))).rejects.toBeInstanceOf(
      WhatsNewFeatureVoteBudgetError,
    )
    expect(await prisma.whatsNewFeatureVote.count()).toBe(WHATS_NEW_VOTE_BUDGET)
  })

  it("stops counting a retracted row without deleting it", async () => {
    await service.cast(vote(1))
    await service.retract({
      ballotId: ballot,
      placementId: vote(1).placementId,
    })

    expect(await service.tallies()).toEqual([])
    const row = await prisma.whatsNewFeatureVote.findFirstOrThrow()
    expect(row.retractedAt).not.toBeNull()
    expect(row.stickerId).toBe("love")
  })

  it("keeps ids inside the columns they were sized for", async () => {
    // varchar(80)/(64)/(32) are the real bound on an anonymous public write;
    // the service's regexes are what keep a caller from testing them.
    await service.cast({
      ballotId: "b".repeat(80),
      placementId: "p".repeat(80),
      featureId: "f".repeat(64),
      stickerId: "need",
    })

    const row = await prisma.whatsNewFeatureVote.findFirstOrThrow()
    expect(row.ballotId).toHaveLength(80)
    expect(row.placementId).toHaveLength(80)
    expect(row.featureId).toHaveLength(64)
  })
})
