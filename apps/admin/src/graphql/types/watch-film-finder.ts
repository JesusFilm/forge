// watchFilmFinder — PUBLIC, bounded "find my film" projection for Watch
// (feat-728). Contract: <=8 allowlisted lanes in, <=24 cards out per page,
// exact playable audio in the requested language, one card per Video.
// The collection slugs behind each lane id never cross the wire.

import { GraphQLError } from "graphql"

import { builder } from "@/graphql/builder"
import {
  WATCH_FILM_FINDER_CARD_LIMIT,
  WatchFilmFinderInputError,
  WatchFilmFinderService,
  type WatchFilmFinderCard,
  type WatchFilmFinderDuration,
  type WatchFilmFinderLaneId,
  type WatchFilmFinderPage,
} from "@/services/watch-film-finder.service"

/**
 * @classification public-shape
 *
 * Plain objectRefs over a service-mediated projection of Video (abac-gated).
 * The service owns the gate: published, non-deleted, non-restricted
 * intermediates and leaves, and a playable Dub in the requested language.
 * `classification.test.ts` only inspects `prismaObject` + `t.relation`, so
 * these refs are invisible to it by construction.
 */

export const WATCH_FILM_FINDER_LANE_ENUM_VALUES = {
  CONVERSATION: { value: "conversation" },
  SEVEN_DAYS: { value: "seven-days" },
  KIDS: { value: "kids" },
  QUESTIONS: { value: "questions" },
  GETTING_STARTED: { value: "getting-started" },
  WOMEN: { value: "women" },
  ANIMATED: { value: "animated" },
  CULTURE: { value: "culture" },
} as const satisfies Record<string, { value: WatchFilmFinderLaneId }>

const WatchFilmFinderLaneEnum = builder.enumType("WatchFilmFinderLane", {
  description:
    "Allowlisted Watch film-finder lanes. Each maps to one fixed collection inside Admin.",
  values: WATCH_FILM_FINDER_LANE_ENUM_VALUES,
})

const WatchFilmFinderDurationEnum = builder.enumType(
  "WatchFilmFinderDuration",
  {
    description:
      "Runtime cap for the requested audio Dub. SHORT is up to 6 minutes, MEDIUM up to 25 minutes, ANY applies no cap.",
    values: {
      SHORT: { value: "SHORT" },
      MEDIUM: { value: "MEDIUM" },
      ANY: { value: "ANY" },
    } as const satisfies Record<
      WatchFilmFinderDuration,
      { value: WatchFilmFinderDuration }
    >,
  },
)

const WatchFilmFinderInputRef = builder.inputType("WatchFilmFinderInput", {
  fields: (t) => ({
    laneIds: t.field({
      type: [WatchFilmFinderLaneEnum],
      required: true,
      description:
        "1 to 8 lanes; duplicates collapse, requested order is kept.",
    }),
    languageSlug: t.string({
      required: true,
      description:
        "Public Watch language slug. Only Videos with playable audio in exactly this language are returned.",
    }),
    duration: t.field({ type: WatchFilmFinderDurationEnum, required: false }),
    first: t.int({
      required: false,
      description: `Page size, 1 to ${WATCH_FILM_FINDER_CARD_LIMIT}. Defaults to ${WATCH_FILM_FINDER_CARD_LIMIT}.`,
    }),
    after: t.string({
      required: false,
      description: "Opaque cursor from a previous page's endCursor.",
    }),
  }),
})

const WatchFilmFinderCardRef = builder.objectRef<WatchFilmFinderCard>(
  "WatchFilmFinderCard",
)

WatchFilmFinderCardRef.implement({
  description:
    "One film in a finder lane, in the requested audio language. Hrefs are derived by the consumer from slug + the requested language.",
  fields: (t) => ({
    laneId: t.field({
      type: WatchFilmFinderLaneEnum,
      nullable: false,
      resolve: (card) => card.laneId,
    }),
    videoId: t.exposeID("videoId", { nullable: false }),
    slug: t.exposeString("slug", { nullable: false }),
    title: t.exposeString("title", {
      nullable: false,
      description:
        "Localized title: requested language, then English, then any published locale.",
    }),
    durationSeconds: t.exposeInt("durationSeconds", { nullable: true }),
    imageUrl: t.exposeString("imageUrl", { nullable: true }),
    muxPlaybackId: t.exposeString("muxPlaybackId", {
      nullable: true,
      description:
        "Mux playback id of the audio Dub, for a frame thumbnail when imageUrl is null.",
    }),
    videoDubId: t.exposeID("videoDubId", {
      nullable: false,
      description: "The playable Dub in the requested audio language.",
    }),
  }),
})

const WatchFilmFinderPageRef = builder.objectRef<WatchFilmFinderPage>(
  "WatchFilmFinderPage",
)

WatchFilmFinderPageRef.implement({
  fields: (t) => ({
    cards: t.field({
      type: [WatchFilmFinderCardRef],
      nullable: false,
      resolve: (page) => page.cards,
    }),
    hasNextPage: t.exposeBoolean("hasNextPage", { nullable: false }),
    endCursor: t.exposeString("endCursor", { nullable: true }),
  }),
})

builder.queryFields((t) => ({
  watchFilmFinder: t.field({
    type: WatchFilmFinderPageRef,
    nullable: false,
    authScopes: { public: true },
    description:
      "Bounded film finder over a fixed set of Watch collections. Exact playable audio only; empty supply returns an empty page.",
    args: {
      input: t.arg({ type: WatchFilmFinderInputRef, required: true }),
    },
    resolve: async (_root, args, ctx) => {
      try {
        return await new WatchFilmFinderService(ctx.prisma).find(args.input)
      } catch (error) {
        if (error instanceof WatchFilmFinderInputError) {
          throw new GraphQLError(error.message, {
            extensions: {
              code: "BAD_USER_INPUT",
              filmFinderCode: error.code,
            },
          })
        }
        throw error
      }
    },
  }),
}))
