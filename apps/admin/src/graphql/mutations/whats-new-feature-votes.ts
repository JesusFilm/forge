import { builder } from "@/graphql/builder"
import {
  WHATS_NEW_STICKER_IDS,
  WhatsNewFeatureVoteBudgetError,
  WhatsNewFeatureVoteValidationError,
  type WhatsNewFeatureVoteTally,
} from "@/services/whats-new-feature-votes.service"

/**
 * Public sticker voting for /watch/whats-new.
 *
 * `public: true`, like `recordWatchSearchEvent`: the page is anonymous and a
 * login would cost most of the signal. The GraphQL edge rate limiter already
 * buckets anonymous mutations per IP, and the service caps what one ballot can
 * hold — those two together are the abuse story, not the auth scope.
 */

/**
 * An enum, unlike `featureId`. The sticker set is small and stable and is
 * shared with web's `whats-new-content.ts`, so making it an enum means web's
 * typed client stops COMPILING if the two ever disagree — a drift a free-form
 * string would only surface as rows nobody renders. Feature ids stay strings
 * because the card list is authored content: adding a card must not need a
 * schema change and a migration.
 */
const WhatsNewStickerEnum = builder.enumType("WhatsNewSticker", {
  values: Object.fromEntries(
    WHATS_NEW_STICKER_IDS.map((id) => [id, { value: id }]),
  ) as { [K in (typeof WHATS_NEW_STICKER_IDS)[number]]: { value: K } },
})

const WhatsNewFeatureVoteTallyRef = builder
  .objectRef<WhatsNewFeatureVoteTally>("WhatsNewFeatureVoteTally")
  .implement({
    description: "Live sticker count for one /watch/whats-new feature card.",
    fields: (t) => ({
      featureId: t.exposeString("featureId", { nullable: false }),
      votes: t.exposeInt("votes", { nullable: false }),
    }),
  })

/**
 * Why a refusal is DATA and not a thrown error.
 *
 * A reader who has already spent three stickers is a normal outcome, not a
 * fault — and a thrown error reaches this public client as Yoga's masked
 * "Unexpected error.", indistinguishable from a real outage. The caller has to
 * tell those apart: a transport failure must be retried (the sticker is
 * already on the card and the page says the vote was recorded), and a refusal
 * must NOT be, or the queue retries it on every page load forever.
 */
const WhatsNewFeatureVoteRefusalEnum = builder.enumType(
  "WhatsNewFeatureVoteRefusal",
  {
    values: {
      budget_exhausted: { value: "budget_exhausted" },
      invalid_input: { value: "invalid_input" },
    } as const,
  },
)

type VoteResult = {
  accepted: boolean
  refusal: "budget_exhausted" | "invalid_input" | null
  tallies: WhatsNewFeatureVoteTally[]
}

const WhatsNewFeatureVoteResultRef = builder
  .objectRef<VoteResult>("WhatsNewFeatureVoteResult")
  .implement({
    description:
      "Outcome of a vote write. `accepted: false` with a refusal is an expected answer, not an error.",
    fields: (t) => ({
      accepted: t.exposeBoolean("accepted", { nullable: false }),
      refusal: t.field({
        type: WhatsNewFeatureVoteRefusalEnum,
        nullable: true,
        description: "Null when accepted. Never retry a refused write.",
        resolve: (result) => result.refusal,
      }),
      tallies: t.field({
        type: [WhatsNewFeatureVoteTallyRef],
        nullable: false,
        description:
          "Totals after the write — present on refusals too, so a client that guessed optimistically can correct itself.",
        resolve: (result) => result.tallies,
      }),
    }),
  })

/**
 * Map the service's typed refusals onto the envelope. Anything else is a real
 * fault and keeps throwing: masking a genuine outage as a refusal would tell
 * the client to stop retrying a vote that never landed.
 */
async function toResult(
  work: () => Promise<WhatsNewFeatureVoteTally[]>,
  tallies: () => Promise<WhatsNewFeatureVoteTally[]>,
): Promise<VoteResult> {
  try {
    return { accepted: true, refusal: null, tallies: await work() }
  } catch (error) {
    if (error instanceof WhatsNewFeatureVoteBudgetError) {
      return {
        accepted: false,
        refusal: "budget_exhausted",
        tallies: await tallies(),
      }
    }
    if (error instanceof WhatsNewFeatureVoteValidationError) {
      return {
        accepted: false,
        refusal: "invalid_input",
        tallies: await tallies(),
      }
    }
    throw error
  }
}

builder.queryFields((t) => ({
  whatsNewFeatureVoteTallies: t.field({
    type: [WhatsNewFeatureVoteTallyRef],
    nullable: false,
    authScopes: { public: true },
    description:
      "Totals per feature, retracted stickers excluded. Features with no votes are absent rather than zero.",
    resolve: (_root, _args, ctx) => ctx.services.whatsNewFeatureVote.tallies(),
  }),
}))

builder.mutationFields((t) => ({
  castWhatsNewFeatureVote: t.field({
    type: WhatsNewFeatureVoteResultRef,
    nullable: false,
    authScopes: { public: true },
    description:
      "Place one sticker. Idempotent per (ballotId, placementId) so a retried send cannot double-count.",
    args: {
      ballotId: t.arg.string({ required: true }),
      placementId: t.arg.string({ required: true }),
      featureId: t.arg.string({ required: true }),
      sticker: t.arg({ type: WhatsNewStickerEnum, required: true }),
    },
    resolve: (_root, args, ctx) =>
      toResult(
        () =>
          ctx.services.whatsNewFeatureVote.cast({
            ballotId: args.ballotId,
            placementId: args.placementId,
            featureId: args.featureId,
            stickerId: args.sticker,
          }),
        () => ctx.services.whatsNewFeatureVote.tallies(),
      ),
  }),

  retractWhatsNewFeatureVote: t.field({
    type: WhatsNewFeatureVoteResultRef,
    nullable: false,
    authScopes: { public: true },
    description:
      "Peel one sticker off. The row is kept and stops counting; omit placementId to take a whole ballot back.",
    args: {
      ballotId: t.arg.string({ required: true }),
      placementId: t.arg.string({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      toResult(
        () =>
          args.placementId == null
            ? ctx.services.whatsNewFeatureVote.retractBallot(args.ballotId)
            : ctx.services.whatsNewFeatureVote.retract({
                ballotId: args.ballotId,
                placementId: args.placementId,
              }),
        () => ctx.services.whatsNewFeatureVote.tallies(),
      ),
  }),
}))

export { WhatsNewFeatureVoteBudgetError }
