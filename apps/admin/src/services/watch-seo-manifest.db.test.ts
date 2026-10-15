import { randomUUID } from "node:crypto"
import type { Prisma } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { env } from "@/config/env"
import { prisma } from "@/db/client"
import {
  type WatchSeoManifest,
  WatchSeoManifestService,
} from "./watch-seo-manifest.service"

const RUN_REAL_DB_TEST = env.WATCH_SEARCH_DB_TEST === "1"

class RollbackFixture extends Error {}

type Tx = Prisma.TransactionClient

function videoLanguages(manifest: WatchSeoManifest, contentSlug: string) {
  return (
    manifest.videoRouteGroups
      .find((group) => group.contentSlug === contentSlug)
      ?.alternates.map((alternate) => alternate.languageSlug) ?? []
  )
}

function episodeLanguages(
  manifest: WatchSeoManifest,
  parentSlug: string,
  childSlug: string,
) {
  return (
    manifest.episodeRouteGroups
      .find(
        (group) =>
          group.parentSlug === parentSlug && group.childSlug === childSlug,
      )
      ?.alternates.map((alternate) => alternate.languageSlug) ?? []
  )
}

describe.skipIf(!RUN_REAL_DB_TEST)(
  "Watch SEO manifest against real PostgreSQL",
  () => {
    beforeAll(async () => prisma.$connect())
    afterAll(async () => prisma.$disconnect())

    // Sitemap variants must be URLs the Watch page serves as-is. A feature
    // film with chapters renders as ONE video and plays only its own Dubs, so
    // a language only its chapters carry resyncs the page to another language
    // (N58, pilgrims-progress / spanish-latin-american). Series-shaped
    // parents render as a series page whose language picker IS the children's
    // languages, so they keep inheriting them. Watch-restricted videos 404.
    it("lists only variants the Watch page resolver serves", async () => {
      const rollback = new RollbackFixture()
      const prefix = `seo-manifest-${randomUUID().slice(0, 8)}`
      let manifest: WatchSeoManifest | null = null
      try {
        await prisma.$transaction(
          async (tx) => {
            const english = await tx.language.create({
              data: {
                coreId: `${prefix}-en`,
                slug: `${prefix}-english`,
                bcp47: "en",
              },
            })
            const latam = await tx.language.create({
              data: {
                coreId: `${prefix}-es`,
                slug: `${prefix}-latam`,
                bcp47: "es",
              },
            })
            const fixture = { tx, prefix, english, latam }

            // Feature film: own English Dub plays; its own LatAm Dub has no
            // HLS; its chapter plays LatAm (the production shape of N58).
            const film = await createVideo(fixture, "film", "FEATURE_FILM")
            await createDub(fixture, film.id, english.id)
            await createDub(fixture, film.id, latam.id, { hls: null })
            const chapter = await createVideo(fixture, "chapter", "SEGMENT")
            await createDub(fixture, chapter.id, english.id)
            await createDub(fixture, chapter.id, latam.id)
            await tx.videoRelation.create({
              data: { parentId: film.id, childId: chapter.id },
            })

            // Series: no Dub of its own; its episode plays LatAm.
            const series = await createVideo(fixture, "series", "SERIES")
            const episode = await createVideo(fixture, "episode", "EPISODE")
            await createDub(fixture, episode.id, latam.id)
            await tx.videoRelation.create({
              data: { parentId: series.id, childId: episode.id },
            })
            // A watch-restricted episode must not lend the series a language.
            const hiddenEpisode = await createVideo(
              fixture,
              "hidden-episode",
              "EPISODE",
              { restricted: true },
            )
            await createDub(fixture, hiddenEpisode.id, english.id)
            await tx.videoRelation.create({
              data: { parentId: series.id, childId: hiddenEpisode.id },
            })

            // Watch-restricted standalone video: the page 404s it.
            const restricted = await createVideo(
              fixture,
              "restricted",
              "SHORT_FILM",
              { restricted: true },
            )
            await createDub(fixture, restricted.id, english.id)

            manifest = await new WatchSeoManifestService(tx).generate()
            throw rollback
          },
          { timeout: 30_000 },
        )
      } catch (error) {
        if (error !== rollback) throw error
      }

      expect(manifest).not.toBeNull()
      const result = manifest as unknown as WatchSeoManifest
      const slug = (name: string) => `${prefix}-${name}`

      expect(videoLanguages(result, slug("film"))).toEqual([
        `${prefix}-english`,
      ])
      expect(videoLanguages(result, slug("chapter"))).toEqual([
        `${prefix}-english`,
        `${prefix}-latam`,
      ])
      expect(episodeLanguages(result, slug("film"), slug("chapter"))).toEqual([
        `${prefix}-english`,
        `${prefix}-latam`,
      ])

      expect(videoLanguages(result, slug("series"))).toEqual([
        `${prefix}-latam`,
      ])
      expect(episodeLanguages(result, slug("series"), slug("episode"))).toEqual(
        [`${prefix}-latam`],
      )

      expect(videoLanguages(result, slug("hidden-episode"))).toEqual([])
      expect(
        episodeLanguages(result, slug("series"), slug("hidden-episode")),
      ).toEqual([])
      expect(videoLanguages(result, slug("restricted"))).toEqual([])
    })
  },
)

async function createVideo(
  fixture: {
    tx: Tx
    prefix: string
    english: { id: string; slug: string | null }
  },
  name: string,
  label: "FEATURE_FILM" | "SEGMENT" | "SERIES" | "EPISODE" | "SHORT_FILM",
  options: { restricted?: boolean } = {},
) {
  const { tx, prefix, english } = fixture
  const video = await tx.video.create({
    data: {
      coreId: `${prefix}-${name}`,
      slug: `${prefix}-${name}`,
      label,
      primaryLanguageId: english.id,
      restrictViewPlatforms: options.restricted ? ["watch"] : [],
    },
  })
  await tx.videoLocale.create({
    data: {
      videoId: video.id,
      languageId: english.id,
      languageSlug: english.slug,
      locale: "en",
      title: name,
      status: "PUBLISHED",
    },
  })
  return video
}

async function createDub(
  fixture: { tx: Tx; prefix: string },
  videoId: string,
  languageId: string,
  options: { hls?: string | null } = {},
) {
  await fixture.tx.videoDub.create({
    data: {
      coreId: `${fixture.prefix}-dub-${randomUUID().slice(0, 8)}`,
      videoId,
      languageId,
      published: true,
      hls:
        options.hls === undefined
          ? "https://fixture.test/master.m3u8"
          : options.hls,
    },
  })
}
