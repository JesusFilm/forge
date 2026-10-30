// Real-PostgreSQL contract for the Watch film finder (feat-728).
//
//   WATCH_FILM_FINDER_DB_TEST=1 DATABASE_URL=<disposable admin db> \
//     pnpm --filter @forge/admin exec vitest run \
//     src/services/watch-film-finder.service.db.test.ts
//
// Every case runs inside one transaction that is always rolled back. The
// allowlisted collection slugs are fixed in code, so the suite creates them and
// therefore refuses to run against a database that already has any of them.
// Mocked suites prove branch shape; this one proves the SQL's visibility,
// ordering, audio and paging behavior.

import { randomUUID } from "node:crypto"
import type { Prisma } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

// Pothos loads GraphQL through Node. Share that instance so the schema built
// for the resolver case belongs to the same realm as `execute`.
vi.mock("graphql", async () => {
  const { createRequire } = await import("node:module")
  return createRequire(import.meta.url)("graphql") as typeof import("graphql")
})

// This suite proves the released contract; the release gate's off branch is
// pinned by the resolver unit suite.
vi.mock("@/lib/feature-flags", () => ({
  isWatchAudienceEnabled: async () => true,
}))

import { execute, parse } from "graphql"

import { prisma } from "@/db/client"
import { builder } from "@/graphql/builder"
import "@/graphql/types/watch-film-finder"
import {
  WATCH_FILM_FINDER_LANES,
  WatchFilmFinderService,
  type WatchFilmFinderDuration,
  type WatchFilmFinderLaneId,
} from "./watch-film-finder.service"

const RUN_REAL_DB_TEST = process.env.WATCH_FILM_FINDER_DB_TEST?.trim() === "1"

class RollbackFixture extends Error {}

type Tx = Prisma.TransactionClient

async function inRollback(run: (fixture: Fixture) => Promise<void>) {
  try {
    await prisma.$transaction(
      async (tx) => {
        await run(await createFixture(tx))
        throw new RollbackFixture()
      },
      { timeout: 120_000, maxWait: 10_000 },
    )
  } catch (error) {
    if (!(error instanceof RollbackFixture)) throw error
  }
}

type VideoOptions = {
  slug?: string
  label?: "COLLECTION" | "SERIES" | "FEATURE_FILM" | "SHORT_FILM" | null
  restricted?: boolean
  noIndex?: boolean
  deleted?: boolean
  localeStatus?: "PUBLISHED" | "DRAFT" | null
  title?: string
}

type DubOptions = {
  duration?: number | null
  published?: boolean
  hls?: string
  deleted?: boolean
  language?: "target" | "other"
  playbackId?: string
  editionDeleted?: boolean
}

async function createFixture(tx: Tx) {
  const prefix = `ff-${randomUUID()}`
  const allowlisted = WATCH_FILM_FINDER_LANES.map((lane) => lane.collectionSlug)
  const existing = await tx.video.count({
    where: { slug: { in: [...allowlisted] } },
  })
  if (existing > 0) {
    throw new Error(
      "Refusing to run: an allowlisted film-finder collection already exists in this database",
    )
  }

  const target = await tx.language.create({
    data: {
      coreId: `${prefix}-target`,
      slug: `${prefix}-target`,
      bcp47: `${prefix}-t`,
    },
  })
  const other = await tx.language.create({
    data: {
      coreId: `${prefix}-other`,
      slug: `${prefix}-other`,
      bcp47: `${prefix}-o`,
    },
  })
  let counter = 0

  async function video(options: VideoOptions = {}) {
    const n = counter++
    const created = await tx.video.create({
      data: {
        coreId: `${prefix}-v${n}`,
        slug: options.slug ?? `${prefix}-v${n}`,
        label: options.label === undefined ? "SHORT_FILM" : options.label,
        restrictViewPlatforms: options.restricted ? ["watch"] : [],
        noIndex: options.noIndex ?? false,
        deletedAt: options.deleted ? new Date() : null,
      },
    })
    if (options.localeStatus !== null) {
      await tx.videoLocale.create({
        data: {
          videoId: created.id,
          locale: target.bcp47,
          languageSlug: target.slug,
          title: options.title ?? `Title ${n}`,
          status: options.localeStatus ?? "PUBLISHED",
        },
      })
    }
    return created
  }

  async function dub(videoId: string, options: DubOptions = {}) {
    const n = counter++
    const mux = options.playbackId
      ? await tx.muxVideo.create({ data: { playbackId: options.playbackId } })
      : null
    const edition = await tx.videoEdition.create({
      data: {
        coreId: `${prefix}-e${n}`,
        name: "fixture",
        deletedAt: options.editionDeleted ? new Date() : null,
      },
    })
    return tx.videoDub.create({
      data: {
        coreId: `${prefix}-d${n}`,
        videoId,
        languageId: (options.language === "other" ? other : target).id,
        duration: options.duration === undefined ? 300 : options.duration,
        published: options.published ?? true,
        hls: options.hls ?? "https://fixture.test/master.m3u8",
        deletedAt: options.deleted ? new Date() : null,
        muxVideoId: mux?.id ?? null,
        videoEditionId: edition.id,
      },
    })
  }

  /** A leaf with one playable target-language Dub. */
  async function playableLeaf(options: VideoOptions & DubOptions = {}) {
    const leaf = await video(options)
    const playable = await dub(leaf.id, options)
    return { leaf, dub: playable }
  }

  let relationClock = Date.parse("2026-01-01T00:00:00Z")
  async function relate(parentId: string, childId: string, order?: number) {
    return tx.videoRelation.create({
      data: {
        parentId,
        childId,
        order: order ?? null,
        // Explicit and strictly increasing: rows in one transaction share
        // now(), which would otherwise make the created_at tie-break untestable.
        createdAt: new Date((relationClock += 1000)),
      },
    })
  }

  function lane(laneId: WatchFilmFinderLaneId, options: VideoOptions = {}) {
    const slug = WATCH_FILM_FINDER_LANES.find(
      (candidate) => candidate.id === laneId,
    )!.collectionSlug
    return video({ label: "COLLECTION", ...options, slug })
  }

  /** Many playable leaves under one parent, in bulk. Returns ids in order. */
  async function bulkLeaves(
    parentId: string,
    count: number,
    skipAudioAt: readonly number[] = [],
  ) {
    const n = counter++
    const ids = Array.from({ length: count }, (_, i) => `${prefix}-b${n}-${i}`)
    await tx.video.createMany({
      data: ids.map((id) => ({
        id,
        coreId: id,
        slug: id,
        label: "SHORT_FILM" as const,
        restrictViewPlatforms: [],
      })),
    })
    await tx.videoLocale.createMany({
      data: ids.map((id, i) => ({
        videoId: id,
        locale: target.bcp47,
        languageSlug: target.slug,
        title: `Bulk ${i}`,
        status: "PUBLISHED" as const,
      })),
    })
    await tx.videoDub.createMany({
      data: ids.flatMap((id, i) =>
        skipAudioAt.includes(i)
          ? []
          : [
              {
                coreId: `${id}-dub`,
                videoId: id,
                languageId: target.id,
                duration: 300,
                published: true,
                hls: "https://fixture.test/master.m3u8",
              },
            ],
      ),
    })
    await tx.videoRelation.createMany({
      data: ids.map((id, i) => ({
        parentId,
        childId: id,
        order: i + 1,
        createdAt: new Date((relationClock += 1000)),
      })),
    })
    return ids
  }

  function find(
    laneIds: WatchFilmFinderLaneId[],
    extra: {
      duration?: WatchFilmFinderDuration
      first?: number
      after?: string | null
    } = {},
  ) {
    return new WatchFilmFinderService(tx).find({
      laneIds,
      languageSlug: target.slug!,
      ...extra,
    })
  }

  return {
    tx,
    prefix,
    target,
    other,
    video,
    dub,
    playableLeaf,
    relate,
    lane,
    bulkLeaves,
    find,
  }
}

type Fixture = Awaited<ReturnType<typeof createFixture>>

const titles = (page: { cards: Array<{ title: string }> }) =>
  page.cards.map((card) => card.title)

describe.skipIf(!RUN_REAL_DB_TEST)(
  "Watch film finder against real PostgreSQL",
  () => {
    beforeAll(async () => prisma.$connect())
    afterAll(async () => prisma.$disconnect())

    it("keeps canonical relation order and current localized fields after a catalog change", async () => {
      await inRollback(async (f) => {
        const root = await f.lane("conversation")
        const a = await f.playableLeaf({ title: "A", duration: 200 })
        const b = await f.playableLeaf({
          title: "B",
          duration: 300,
          playbackId: "playback-b",
        })
        const c = await f.playableLeaf({ title: "C" })
        const d = await f.playableLeaf({ title: "D" })
        const relationA = await f.relate(root.id, a.leaf.id, 2)
        await f.relate(root.id, b.leaf.id, 1)
        await f.relate(root.id, c.leaf.id) // null order, earlier created_at
        await f.relate(root.id, d.leaf.id) // null order, later created_at

        // A later, other-language title must not beat the requested language.
        await f.tx.videoLocale.create({
          data: {
            videoId: b.leaf.id,
            locale: f.other.bcp47,
            languageSlug: f.other.slug,
            title: "B in the other language",
            status: "PUBLISHED",
          },
        })
        await f.tx.videoImage.create({
          data: {
            videoId: b.leaf.id,
            url: "https://img.test/b-url.jpg",
            mobileCinematicHigh: "https://img.test/b-high.jpg",
          },
        })

        const before = await f.find(["conversation"])
        expect(titles(before)).toStrictEqual(["B", "A", "C", "D"])
        expect(before.cards[0]).toMatchObject({
          laneId: "conversation",
          videoId: b.leaf.id,
          slug: b.leaf.slug,
          videoDubId: b.dub.id,
          durationSeconds: 300,
          imageUrl: "https://img.test/b-high.jpg",
          muxPlaybackId: "playback-b",
        })
        expect(before.cards[1]).toMatchObject({
          imageUrl: null,
          muxPlaybackId: null,
        })

        // Catalog change: reorder, retitle. No cached projection may lag.
        await f.tx.videoRelation.update({
          where: { id: relationA.id },
          data: { order: 0 },
        })
        await f.tx.videoLocale.updateMany({
          where: { videoId: b.leaf.id, languageSlug: f.target.slug },
          data: { title: "B renamed" },
        })
        const after = await f.find(["conversation"])
        expect(titles(after)).toStrictEqual(["A", "B renamed", "C", "D"])
      })
    })

    it("keeps hidden, deleted, unpublished and restricted intermediate and leaf nodes out", async () => {
      await inRollback(async (f) => {
        const root = await f.lane("kids")
        const okSeries = await f.video({ label: "SERIES" })
        await f.relate(root.id, okSeries.id, 1)

        const ok = await f.playableLeaf({ title: "Visible leaf" })
        await f.relate(okSeries.id, ok.leaf.id, 1)
        const hiddenLeaves = [
          await f.playableLeaf({ restricted: true }),
          await f.playableLeaf({ deleted: true }),
          await f.playableLeaf({ noIndex: true }),
          await f.playableLeaf({ localeStatus: "DRAFT" }),
          await f.playableLeaf({ localeStatus: null }),
        ]
        let order = 2
        for (const hidden of hiddenLeaves) {
          await f.relate(okSeries.id, hidden.leaf.id, order++)
        }

        // A visible leaf behind a hidden intermediate must not be reachable.
        const hiddenIntermediates = [
          await f.video({ label: "SERIES", restricted: true }),
          await f.video({ label: "SERIES", deleted: true }),
          await f.video({ label: "SERIES", noIndex: true }),
          await f.video({ label: "SERIES", localeStatus: "DRAFT" }),
        ]
        for (const intermediate of hiddenIntermediates) {
          const behind = await f.playableLeaf({ title: "Behind hidden series" })
          await f.relate(root.id, intermediate.id, order++)
          await f.relate(intermediate.id, behind.leaf.id, 1)
        }

        // Traversal is two hops deep: a leaf under a nested series is out.
        const nested = await f.video({ label: "SERIES" })
        const tooDeep = await f.playableLeaf({ title: "Too deep" })
        await f.relate(okSeries.id, nested.id, order++)
        await f.relate(nested.id, tooDeep.leaf.id, 1)

        expect(titles(await f.find(["kids"]))).toStrictEqual(["Visible leaf"])
      })
    })

    it("gives no cards from a hidden or missing collection and returns valid empty data", async () => {
      await inRollback(async (f) => {
        const hiddenRoots = [
          await f.lane("women", { restricted: true }),
          await f.lane("animated", { deleted: true }),
          await f.lane("culture", { noIndex: true }),
          await f.lane("questions", { localeStatus: "DRAFT" }),
        ]
        for (const root of hiddenRoots) {
          const child = await f.playableLeaf()
          await f.relate(root.id, child.leaf.id, 1)
        }
        // `seven-days` and `getting-started` have no collection row at all.

        await expect(
          f.find([
            "women",
            "animated",
            "culture",
            "questions",
            "seven-days",
            "getting-started",
          ]),
        ).resolves.toStrictEqual({
          cards: [],
          hasNextPage: false,
          endCursor: null,
        })
      })
    })

    it("requires exact playable audio and honors the duration bucket", async () => {
      await inRollback(async (f) => {
        const root = await f.lane("questions")
        const add = (leaf: { id: string }, order: number) =>
          f.relate(root.id, leaf.id, order)

        const playable = [
          { title: "exact", duration: 200 },
          { title: "mid", duration: 800 },
          { title: "long", duration: 2000 },
          { title: "unknown", duration: null },
        ]
        for (const [index, options] of playable.entries()) {
          await add((await f.playableLeaf(options)).leaf, index + 1)
        }

        // Never a card: wrong audio language, subtitles only, or an unplayable Dub.
        const otherAudio = await f.video({ title: "other-audio" })
        await f.dub(otherAudio.id, { language: "other" })
        await add(otherAudio, 5)

        const subtitleOnly = await f.video({ title: "subtitle-only" })
        const fallbackDub = await f.dub(subtitleOnly.id, { language: "other" })
        await f.tx.videoSubtitle.create({
          data: {
            videoId: subtitleOnly.id,
            videoEditionId: fallbackDub.videoEditionId!,
            languageId: f.target.id,
            vttSrc: "https://fixture.test/subtitles.vtt",
          },
        })
        await add(subtitleOnly, 6)

        const unplayable: Array<[string, DubOptions]> = [
          ["unpublished", { published: false }],
          ["blank-hls", { hls: "  " }],
          ["deleted-dub", { deleted: true }],
          ["deleted-edition", { editionDeleted: true }],
        ]
        let order = 7
        for (const [name, options] of unplayable) {
          const leaf = await f.video({ title: name })
          await f.dub(leaf.id, options)
          await add(leaf, order++)
        }

        expect(titles(await f.find(["questions"]))).toStrictEqual([
          "exact",
          "mid",
          "long",
          "unknown",
        ])
        expect(
          titles(await f.find(["questions"], { duration: "SHORT" })),
        ).toStrictEqual(["exact"])
        expect(
          titles(await f.find(["questions"], { duration: "MEDIUM" })),
        ).toStrictEqual(["exact", "mid"])
      })
    })

    it("judges the Dub the watch route would play, not a shorter sibling", async () => {
      await inRollback(async (f) => {
        const root = await f.lane("conversation")
        const leaf = await f.video({ title: "two cuts" })
        await f.dub(leaf.id, { duration: 100 })
        const long = await f.dub(leaf.id, { duration: 900 })
        await f.relate(root.id, leaf.id, 1)

        const any = await f.find(["conversation"])
        expect(any.cards).toMatchObject([
          { videoDubId: long.id, durationSeconds: 900 },
        ])
        expect(
          (await f.find(["conversation"], { duration: "SHORT" })).cards,
        ).toStrictEqual([])
      })
    })

    it("returns one card per Video across duplicate membership and lanes", async () => {
      await inRollback(async (f) => {
        const culture = await f.lane("culture")
        const kids = await f.lane("kids")
        const series = await f.video({ label: "SERIES" })
        const shared = await f.playableLeaf({ title: "shared" })
        const other = await f.playableLeaf({ title: "other" })

        // Diamond inside one lane: direct child and via an intermediate series.
        await f.relate(culture.id, shared.leaf.id, 1)
        await f.relate(culture.id, series.id, 2)
        await f.relate(series.id, shared.leaf.id, 1)
        await f.relate(series.id, other.leaf.id, 2)
        // The same Video also sits in a second lane.
        await f.relate(kids.id, shared.leaf.id, 1)

        const cultureFirst = await f.find(["culture", "kids"])
        expect(titles(cultureFirst)).toStrictEqual(["shared", "other"])
        expect(cultureFirst.cards.map((card) => card.laneId)).toStrictEqual([
          "culture",
          "culture",
        ])

        const kidsFirst = await f.find(["kids", "culture"])
        expect(titles(kidsFirst)).toStrictEqual(["shared", "other"])
        expect(kidsFirst.cards.map((card) => card.laneId)).toStrictEqual([
          "kids",
          "culture",
        ])
      })
    })

    it("pages through one stable sequence without skipping or repeating cards", async () => {
      await inRollback(async (f) => {
        const root = await f.lane("animated")
        const ids = await f.bulkLeaves(root.id, 30)

        const first = await f.find(["animated"])
        expect(first.cards).toHaveLength(24)
        expect(first.hasNextPage).toBe(true)
        expect(first.endCursor).toBe("v1:24")
        const second = await f.find(["animated"], { after: first.endCursor })
        expect(second.cards).toHaveLength(6)
        expect(second.hasNextPage).toBe(false)
        expect(second.endCursor).toBeNull()
        expect(
          [...first.cards, ...second.cards].map((card) => card.videoId),
        ).toStrictEqual(ids)

        const walked: string[] = []
        let after: string | null = null
        for (let guard = 0; guard < 10; guard++) {
          const page: Awaited<ReturnType<Fixture["find"]>> = await f.find(
            ["animated"],
            { first: 7, after },
          )
          walked.push(...page.cards.map((card) => card.videoId))
          after = page.endCursor
          if (!page.hasNextPage) break
        }
        expect(walked).toStrictEqual(ids)
      })
    })

    it("scans a bounded candidate window per lane, counting leaves before audio eligibility", async () => {
      await inRollback(async (f) => {
        const root = await f.lane("seven-days")
        // 70 visible leaves; #2 has no audio. The window is the first 64
        // distinct visible leaves, so 63 cards come back and #65+ never do.
        const ids = await f.bulkLeaves(root.id, 70, [2])

        const walked: string[] = []
        let after: string | null = null
        for (let guard = 0; guard < 10; guard++) {
          const page: Awaited<ReturnType<Fixture["find"]>> = await f.find(
            ["seven-days"],
            { after },
          )
          walked.push(...page.cards.map((card) => card.videoId))
          after = page.endCursor
          if (!page.hasNextPage) break
        }
        expect(walked).toStrictEqual(ids.slice(0, 64).filter((_, i) => i !== 2))
      })
    })

    it("reaches the same visibility path through the resolver in one statement, however many Dubs exist", async () => {
      builder.mutationField("isolatedSchemaPlaceholder", (t) =>
        t.boolean({ resolve: () => true }),
      )
      const schema = builder.toSchema()

      await inRollback(async (f) => {
        const root = await f.lane("conversation")
        const crowded = await f.playableLeaf({ title: "crowded" })
        const hidden = await f.playableLeaf({
          title: "hidden",
          restricted: true,
        })
        await f.relate(root.id, crowded.leaf.id, 1)
        await f.relate(root.id, hidden.leaf.id, 2)

        // 150 Dubs in other languages must not be projected or fetched.
        const languageIds = Array.from(
          { length: 150 },
          (_, i) => `${f.prefix}-lang-${i}`,
        )
        await f.tx.language.createMany({
          data: languageIds.map((id) => ({
            id,
            coreId: id,
            slug: id,
            bcp47: id,
          })),
        })
        await f.tx.videoDub.createMany({
          data: languageIds.map((id) => ({
            coreId: `${id}-dub`,
            videoId: crowded.leaf.id,
            languageId: id,
            duration: 300,
            published: true,
            hls: "https://fixture.test/master.m3u8",
          })),
        })

        const queryRaw = vi.fn((...args: unknown[]) =>
          Reflect.apply(f.tx.$queryRaw, f.tx, args),
        )
        const result = await execute({
          schema,
          document: parse(/* GraphQL */ `
            query ($input: WatchFilmFinderInput!) {
              watchFilmFinder(input: $input) {
                hasNextPage
                cards {
                  title
                  videoDubId
                  durationSeconds
                }
              }
            }
          `),
          variableValues: {
            input: { laneIds: ["CONVERSATION"], languageSlug: f.target.slug },
          },
          contextValue: {
            prisma: { language: f.tx.language, $queryRaw: queryRaw },
          },
        })

        expect(result.errors).toBeUndefined()
        expect(result.data).toEqual({
          watchFilmFinder: {
            hasNextPage: false,
            cards: [
              {
                title: "crowded",
                videoDubId: crowded.dub.id,
                durationSeconds: 300,
              },
            ],
          },
        })
        expect(queryRaw).toHaveBeenCalledTimes(1)
      })
    })
  },
)
