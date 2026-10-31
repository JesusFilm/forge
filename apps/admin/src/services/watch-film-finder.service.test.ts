import type { Prisma } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"

import {
  WATCH_FILM_FINDER_CARD_LIMIT,
  WATCH_FILM_FINDER_DURATION_MAX_SECONDS,
  WATCH_FILM_FINDER_LANE_IDS,
  WATCH_FILM_FINDER_LANES,
  WATCH_FILM_FINDER_MAX_LANES,
  WatchFilmFinderInputError,
  WatchFilmFinderService,
  type WatchFilmFinderInput,
} from "./watch-film-finder.service"

const ENGLISH = { id: "lang-en", slug: "english", bcp47: "en" }

function row(index: number) {
  return {
    laneId: "conversation",
    videoId: `video-${index}`,
    slug: `film-${index}`,
    title: `Film ${index}`,
    durationSeconds: 300,
    imageUrl: null,
    muxPlaybackId: null,
    videoDubId: `dub-${index}`,
  }
}

function createService({
  language = ENGLISH as typeof ENGLISH | null,
  rows = [] as ReturnType<typeof row>[],
} = {}) {
  const findFirst = vi.fn().mockResolvedValue(language)
  const queryRaw = vi.fn().mockResolvedValue(rows)
  const service = new WatchFilmFinderService({
    language: { findFirst },
    $queryRaw: queryRaw,
  } as never)
  return { service, findFirst, queryRaw }
}

function validInput(
  overrides: Partial<WatchFilmFinderInput> = {},
): WatchFilmFinderInput {
  return {
    laneIds: ["conversation"],
    languageSlug: "english",
    ...overrides,
  }
}

describe("watch film finder allowlist", () => {
  it("maps the eight prototype collection slugs to unique semantic lane ids", () => {
    expect(
      WATCH_FILM_FINDER_LANES.map((lane) => lane.collectionSlug),
    ).toStrictEqual([
      "conversation-starters",
      "7-days-with-jesus-walk-with-jesus",
      "storyclubs",
      "do-you-ever-wonder",
      "walking-with-jesus-africa",
      "rivka",
      "file-zero",
      "retelling-the-good-story",
    ])
    expect(new Set(WATCH_FILM_FINDER_LANE_IDS).size).toBe(8)
    expect(WATCH_FILM_FINDER_MAX_LANES).toBe(8)
  })
})

describe("WatchFilmFinderService input rejection", () => {
  const rejected: Array<[string, unknown]> = [
    ["an unknown lane", validInput({ laneIds: ["not-a-lane" as never] })],
    ["no lanes", validInput({ laneIds: [] })],
    [
      "more than eight lanes",
      validInput({
        laneIds: [...WATCH_FILM_FINDER_LANE_IDS, "conversation"],
      }),
    ],
    ["a non-public language slug", validInput({ languageSlug: "English_1" })],
    ["an empty language slug", validInput({ languageSlug: "" })],
    ["an unknown duration bucket", validInput({ duration: "LONG" as never })],
    ["a page size above the cap", validInput({ first: 25 })],
    ["a zero page size", validInput({ first: 0 })],
    ["a fractional page size", validInput({ first: 1.5 })],
    ["a malformed cursor", validInput({ after: "not-a-cursor" })],
    ["a cursor beyond the candidate window", validInput({ after: "v1:99999" })],
  ]

  it.each(rejected)(
    "rejects %s before reading the catalog",
    async (_name, input) => {
      const { service, findFirst, queryRaw } = createService()

      await expect(
        service.find(input as WatchFilmFinderInput),
      ).rejects.toBeInstanceOf(WatchFilmFinderInputError)
      expect(findFirst).not.toHaveBeenCalled()
      expect(queryRaw).not.toHaveBeenCalled()
    },
  )
})

describe("WatchFilmFinderService.find", () => {
  it("returns a valid empty page without a catalog query for an unknown language", async () => {
    const { service, queryRaw } = createService({ language: null })

    await expect(
      service.find(validInput({ languageSlug: "no-such-language" })),
    ).resolves.toStrictEqual({ cards: [], hasNextPage: false, endCursor: null })
    expect(queryRaw).not.toHaveBeenCalled()
  })

  it("issues exactly one catalog query and maps rows to cards", async () => {
    const { service, queryRaw } = createService({ rows: [row(1), row(2)] })

    const page = await service.find(
      validInput({ laneIds: ["conversation", "kids"] }),
    )

    expect(queryRaw).toHaveBeenCalledTimes(1)
    expect(page).toStrictEqual({
      cards: [row(1), row(2)],
      hasNextPage: false,
      endCursor: null,
    })
  })

  it("fetches one row past the page to detect a next page, and returns a cursor for it", async () => {
    const rows = Array.from({ length: 4 }, (_, index) => row(index))
    const { service, queryRaw } = createService({ rows })

    const page = await service.find(validInput({ first: 3 }))

    expect(page.cards.map((card) => card.videoId)).toStrictEqual([
      "video-0",
      "video-1",
      "video-2",
    ])
    expect(page.hasNextPage).toBe(true)
    expect(page.endCursor).toBe("v1:3")
    const sql = queryRaw.mock.calls[0]![0] as Prisma.Sql
    // LIMIT first+1, OFFSET 0 are the last two bound values.
    expect(sql.values.slice(-2)).toStrictEqual([4, 0])
  })

  it("resumes at the cursor offset and caps the default page at the card limit", async () => {
    const { service, queryRaw } = createService()

    await service.find(validInput({ after: "v1:24" }))

    const sql = queryRaw.mock.calls[0]![0] as Prisma.Sql
    expect(WATCH_FILM_FINDER_CARD_LIMIT).toBe(24)
    expect(sql.values.slice(-2)).toStrictEqual([25, 24])
  })

  it("dedupes repeated lane ids and keeps the requested lane order", async () => {
    const { service, queryRaw } = createService()

    await service.find(
      validInput({ laneIds: ["kids", "conversation", "kids"] }),
    )

    const sql = queryRaw.mock.calls[0]![0] as Prisma.Sql
    const bound = sql.values.filter((value) => typeof value === "string")
    expect(bound).toEqual(
      expect.arrayContaining(["kids", "storyclubs", "conversation"]),
    )
    expect(bound.filter((value) => value === "kids")).toHaveLength(1)
    expect(bound.indexOf("storyclubs")).toBeLessThan(
      bound.indexOf("conversation-starters"),
    )
  })

  it("binds the duration cap only for a bounded bucket", async () => {
    const unbounded = createService()
    await unbounded.service.find(validInput())
    const bounded = createService()
    await bounded.service.find(validInput({ duration: "SHORT" }))

    const unboundedValues = (unbounded.queryRaw.mock.calls[0]![0] as Prisma.Sql)
      .values
    const boundedValues = (bounded.queryRaw.mock.calls[0]![0] as Prisma.Sql)
      .values
    expect(unboundedValues).not.toContain(
      WATCH_FILM_FINDER_DURATION_MAX_SECONDS.SHORT,
    )
    expect(boundedValues).toContain(
      WATCH_FILM_FINDER_DURATION_MAX_SECONDS.SHORT,
    )
  })

  it("keeps the catalog SQL on the shared Watch visibility gate and exact audio only", async () => {
    const { service, queryRaw } = createService()

    await service.find(validInput({ duration: "MEDIUM" }))

    const text = (queryRaw.mock.calls[0]![0] as Prisma.Sql).sql
    // Shape pins; the DB suite is the behavioral enforcement point.
    expect(text).toContain("restrict_view_platforms")
    expect(text).toContain("descendant_video.no_index = FALSE")
    expect(text).toContain("dub.published = TRUE")
    expect(text).toContain("dub_language.slug =")
    expect(text).not.toContain("video_subtitle")
  })
})
