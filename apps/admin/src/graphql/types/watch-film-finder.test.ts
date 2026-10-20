// Isolated-schema tests for `watchFilmFinder`. The type is not part of the
// central schema in this unit, so a schema is built from the shared builder
// with only this file registered. Auth posture is covered by
// `public-resolvers.regression.test.ts` once the type is imported by
// `schema.ts`; the catalog SQL lives in the service's own suites.

import { execute, parse, printSchema } from "graphql"
import { beforeEach, describe, expect, it, vi } from "vitest"

// Pothos loads GraphQL through Node. Share that instance instead of Vitest's
// transformed ESM one, whose schema classes belong to another realm.
vi.mock("graphql", async () => {
  const { createRequire } = await import("node:module")
  return createRequire(import.meta.url)("graphql") as typeof import("graphql")
})

const findMock = vi.fn()
const constructed = vi.fn()
vi.mock("@/services/watch-film-finder.service", async () => {
  const actual = await vi.importActual<
    typeof import("@/services/watch-film-finder.service")
  >("@/services/watch-film-finder.service")
  return {
    ...actual,
    WatchFilmFinderService: vi.fn((prisma: unknown) => {
      constructed(prisma)
      return { find: findMock }
    }),
  }
})

vi.mock("@/db/client", () => ({ prisma: {} }))

import { builder } from "@/graphql/builder"
import "@/graphql/types/watch-film-finder"
import {
  WATCH_FILM_FINDER_LANE_IDS,
  WATCH_FILM_FINDER_LANES,
  WatchFilmFinderInputError,
} from "@/services/watch-film-finder.service"
import { WATCH_FILM_FINDER_LANE_ENUM_VALUES } from "@/graphql/types/watch-film-finder"

// The shared builder always declares a Mutation root, and GraphQL rejects an
// empty one; this placeholder only exists so the isolated schema is valid.
builder.mutationField("isolatedSchemaPlaceholder", (t) =>
  t.boolean({ resolve: () => true }),
)

const schema = builder.toSchema()
const sdl = printSchema(schema)

const QUERY = /* GraphQL */ `
  query Finder($input: WatchFilmFinderInput!) {
    watchFilmFinder(input: $input) {
      hasNextPage
      endCursor
      cards {
        laneId
        videoId
        slug
        title
        durationSeconds
        imageUrl
        muxPlaybackId
        videoDubId
      }
    }
  }
`

const ctx = { prisma: { marker: "request-prisma" } }

function run(input: Record<string, unknown>) {
  return execute({
    schema,
    document: parse(QUERY),
    variableValues: { input },
    contextValue: ctx,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  findMock.mockResolvedValue({ cards: [], hasNextPage: false, endCursor: null })
})

describe("watchFilmFinder schema contract", () => {
  it("exposes exactly the service's lane ids as enum values", () => {
    expect(
      Object.values(WATCH_FILM_FINDER_LANE_ENUM_VALUES)
        .map((entry) => entry.value)
        .sort(),
    ).toStrictEqual([...WATCH_FILM_FINDER_LANE_IDS].sort())
  })

  it("never leaks the allowlisted collection slugs into the schema", () => {
    for (const lane of WATCH_FILM_FINDER_LANES) {
      expect(sdl).not.toContain(lane.collectionSlug)
    }
  })

  it("takes one required input and returns a non-null page", () => {
    expect(sdl).toContain(
      "watchFilmFinder(input: WatchFilmFinderInput!): WatchFilmFinderPage!",
    )
    expect(sdl).toMatch(
      /input WatchFilmFinderInput \{[^}]*laneIds: \[WatchFilmFinderLane!\]!/,
    )
  })
})

describe("watchFilmFinder resolver", () => {
  it("rejects an unknown lane in GraphQL validation, before any service call", async () => {
    const result = await run({
      laneIds: ["NOT_A_LANE"],
      languageSlug: "english",
    })

    expect(result.errors?.[0]?.message).toMatch(/NOT_A_LANE/)
    expect(constructed).not.toHaveBeenCalled()
    expect(findMock).not.toHaveBeenCalled()
  })

  it("passes enum lanes as service lane ids on the request's prisma client and maps cards", async () => {
    findMock.mockResolvedValueOnce({
      cards: [
        {
          laneId: "seven-days",
          videoId: "video-1",
          slug: "film-1",
          title: "Film 1",
          durationSeconds: 212,
          imageUrl: "https://img.test/1.jpg",
          muxPlaybackId: null,
          videoDubId: "dub-1",
        },
      ],
      hasNextPage: true,
      endCursor: "v1:1",
    })

    const result = await run({
      laneIds: ["SEVEN_DAYS", "KIDS"],
      languageSlug: "english",
      duration: "SHORT",
      first: 1,
    })

    expect(constructed).toHaveBeenCalledWith(ctx.prisma)
    expect(findMock).toHaveBeenCalledWith({
      laneIds: ["seven-days", "kids"],
      languageSlug: "english",
      duration: "SHORT",
      first: 1,
    })
    expect(result.errors).toBeUndefined()
    expect(result.data).toEqual({
      watchFilmFinder: {
        hasNextPage: true,
        endCursor: "v1:1",
        cards: [
          {
            laneId: "SEVEN_DAYS",
            videoId: "video-1",
            slug: "film-1",
            title: "Film 1",
            durationSeconds: 212,
            imageUrl: "https://img.test/1.jpg",
            muxPlaybackId: null,
            videoDubId: "dub-1",
          },
        ],
      },
    })
  })

  it("surfaces a service input rejection as BAD_USER_INPUT", async () => {
    findMock.mockRejectedValueOnce(
      new WatchFilmFinderInputError("invalid_cursor", "Invalid cursor"),
    )

    const result = await run({
      laneIds: ["KIDS"],
      languageSlug: "english",
      after: "garbage",
    })

    expect(result.errors?.[0]?.extensions).toMatchObject({
      code: "BAD_USER_INPUT",
      filmFinderCode: "invalid_cursor",
    })
  })

  it("lets unexpected service failures propagate unclassified", async () => {
    findMock.mockRejectedValueOnce(new Error("db down"))

    const result = await run({ laneIds: ["KIDS"], languageSlug: "english" })

    expect(result.errors?.[0]?.message).toBe("db down")
    expect(result.errors?.[0]?.extensions?.code).toBeUndefined()
  })
})
