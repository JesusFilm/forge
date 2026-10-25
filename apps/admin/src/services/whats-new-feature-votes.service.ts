import type { PrismaClient } from "@prisma/client"

/**
 * Sticker votes from the public /watch/whats-new page.
 *
 * Written by anonymous browsers through a `public: true` mutation, so every
 * value here is untrusted input and the budget is the only thing standing
 * between one visitor and an unbounded number of rows. `ballotId` identifies
 * a BALLOT (a random id the browser keeps in localStorage), never a person —
 * see the model comment in schema.prisma for why that trade is accepted.
 */

export type CastWhatsNewFeatureVoteInput = {
  ballotId: string
  placementId: string
  featureId: string
  stickerId: WhatsNewStickerId
}

export type RetractWhatsNewFeatureVoteInput = {
  ballotId: string
  placementId: string
}

export type WhatsNewFeatureVoteTally = {
  featureId: string
  votes: number
}

/**
 * The sticker set is small, stable, and shared with web's
 * whats-new-content.ts, so it is a GraphQL enum: web's typed client stops
 * compiling if the two ever disagree. Feature ids are NOT an enum — the card
 * list is authored content and adding one must not need a migration.
 */
export const WHATS_NEW_STICKER_IDS = ["love", "yes", "need"] as const
export type WhatsNewStickerId = (typeof WHATS_NEW_STICKER_IDS)[number]

/**
 * How many live stickers one ballot may hold. Mirrors `WHATS_NEW_VOTES.budget`
 * in web's content file — the client shows three, and this is what makes three
 * true for a caller that skips the client entirely.
 */
export const WHATS_NEW_VOTE_BUDGET = 3

/** Bounded so an id cannot blow up the varchar or the index cardinality. */
const BALLOT_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/
const PLACEMENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/
const FEATURE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

export class WhatsNewFeatureVoteValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WhatsNewFeatureVoteValidationError"
  }
}

export class WhatsNewFeatureVoteBudgetError extends Error {
  constructor() {
    super(`A ballot may hold at most ${WHATS_NEW_VOTE_BUDGET} stickers`)
    this.name = "WhatsNewFeatureVoteBudgetError"
  }
}

function requireMatch(value: unknown, pattern: RegExp, field: string): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new WhatsNewFeatureVoteValidationError(`Invalid ${field}`)
  }
  return value
}

function requireStickerId(value: unknown): WhatsNewStickerId {
  if (
    typeof value !== "string" ||
    !(WHATS_NEW_STICKER_IDS as readonly string[]).includes(value)
  ) {
    throw new WhatsNewFeatureVoteValidationError("Invalid stickerId")
  }
  return value as WhatsNewStickerId
}

export class WhatsNewFeatureVoteService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Record one placement. Idempotent per `(ballotId, placementId)`: a retried
   * send — a dropped response, a queued offline flush — returns the tallies
   * without adding a second vote, which is what keeps the count honest for a
   * client that cannot tell "never arrived" from "arrived, reply lost".
   */
  async cast(
    input: CastWhatsNewFeatureVoteInput,
  ): Promise<WhatsNewFeatureVoteTally[]> {
    const ballotId = requireMatch(input.ballotId, BALLOT_ID_PATTERN, "ballotId")
    const placementId = requireMatch(
      input.placementId,
      PLACEMENT_ID_PATTERN,
      "placementId",
    )
    const featureId = requireMatch(
      input.featureId,
      FEATURE_ID_PATTERN,
      "featureId",
    )
    const stickerId = requireStickerId(input.stickerId)

    const existing = await this.prisma.whatsNewFeatureVote.findUnique({
      where: { ballotId_placementId: { ballotId, placementId } },
    })
    if (existing) {
      // A resend of a placement the ballot has already spent. Un-retract it if
      // the reader peeled and re-placed the same slot; otherwise leave it be.
      if (existing.retractedAt != null) {
        await this.assertBudget(ballotId)
        await this.prisma.whatsNewFeatureVote.update({
          where: { id: existing.id },
          data: { retractedAt: null, featureId, stickerId },
        })
      }
      return this.tallies()
    }

    await this.assertBudget(ballotId)
    try {
      await this.prisma.whatsNewFeatureVote.create({
        data: { ballotId, placementId, featureId, stickerId },
      })
    } catch (error) {
      // Two sends of the same placement racing each other: the unique index
      // is the arbiter, and losing it means the vote is already recorded.
      if (!isUniqueViolation(error)) throw error
    }
    return this.tallies()
  }

  /** Peeling a sticker off stops it counting; the row stays as signal. */
  async retract(
    input: RetractWhatsNewFeatureVoteInput,
  ): Promise<WhatsNewFeatureVoteTally[]> {
    const ballotId = requireMatch(input.ballotId, BALLOT_ID_PATTERN, "ballotId")
    const placementId = requireMatch(
      input.placementId,
      PLACEMENT_ID_PATTERN,
      "placementId",
    )

    await this.prisma.whatsNewFeatureVote.updateMany({
      where: { ballotId, placementId, retractedAt: null },
      data: { retractedAt: new Date() },
    })
    return this.tallies()
  }

  /** Everything a ballot holds, for "take my stickers back". */
  async retractBallot(ballotId: string): Promise<WhatsNewFeatureVoteTally[]> {
    const safeBallotId = requireMatch(ballotId, BALLOT_ID_PATTERN, "ballotId")
    await this.prisma.whatsNewFeatureVote.updateMany({
      where: { ballotId: safeBallotId, retractedAt: null },
      data: { retractedAt: new Date() },
    })
    return this.tallies()
  }

  /**
   * Live totals per feature. Retracted rows are excluded here rather than
   * deleted upstream, so the read is the ONLY place that decides what counts.
   */
  async tallies(): Promise<WhatsNewFeatureVoteTally[]> {
    const grouped = await this.prisma.whatsNewFeatureVote.groupBy({
      by: ["featureId"],
      where: { retractedAt: null },
      _count: { _all: true },
    })
    return grouped
      .map((row) => ({ featureId: row.featureId, votes: row._count._all }))
      .sort((left, right) => left.featureId.localeCompare(right.featureId))
  }

  /**
   * Read-then-write, deliberately. Concurrent casts on ONE ballot can each
   * pass this check, so the true ceiling is the budget plus however many
   * requests overlapped — measured at 3..6 for six parallel casts. That is
   * acceptable because the ballot id is self-issued anyway: anyone willing to
   * race requests can simply mint another ballot, so the real bound on abuse
   * is Admin's per-IP mutation rate limit, not this counter. Tightening it
   * would need a DB-level constraint, not a transaction.
   */
  private async assertBudget(ballotId: string): Promise<void> {
    const live = await this.prisma.whatsNewFeatureVote.count({
      where: { ballotId, retractedAt: null },
    })
    if (live >= WHATS_NEW_VOTE_BUDGET) {
      throw new WhatsNewFeatureVoteBudgetError()
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  )
}
