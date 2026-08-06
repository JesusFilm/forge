import type { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { env } from "@/config/env"
import { prisma } from "@/db/client"
import { SearchWatchabilityService } from "./search-watchability"
import {
  buildAvailabilityDocuments,
  buildCatalogDocuments,
} from "./typesense-watch-search-indexer"

const RUN_REAL_DB_TEST = env.WATCH_SEARCH_DB_TEST === "1"

class RollbackFixture extends Error {}

describe.skipIf(!RUN_REAL_DB_TEST)(
  "Watch subtitle/audio selection against real PostgreSQL",
  () => {
    beforeAll(async () => prisma.$connect())
    afterAll(async () => prisma.$disconnect())

    it("keeps DEFAULT and MODERN on the same eligible edition and owner", async () => {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const rollback = new RollbackFixture()

      try {
        await prisma.$transaction(
          async (tx) => {
            const targetLanguage = await tx.language.create({
              data: {
                coreId: `db-test-target-${suffix}`,
                slug: `db-test-target-${suffix}`,
                bcp47: "ru",
                name: { en: "DB Test Target" },
              },
            })
            const primaryLanguage = await tx.language.create({
              data: {
                coreId: `db-test-primary-${suffix}`,
                slug: `db-test-primary-${suffix}`,
                bcp47: "en",
                name: { en: "DB Test Primary" },
              },
            })
            const otherLanguage = await tx.language.create({
              data: {
                coreId: `db-test-other-${suffix}`,
                slug: `db-test-other-${suffix}`,
                bcp47: "ar",
                name: { en: "DB Test Other" },
              },
            })
            const [editionOther, editionPrimary, editionSrtOnly] =
              await Promise.all([
                tx.videoEdition.create({
                  data: {
                    coreId: `db-test-edition-other-${suffix}`,
                    name: "DB test other",
                  },
                }),
                tx.videoEdition.create({
                  data: {
                    coreId: `db-test-edition-primary-${suffix}`,
                    name: "DB test primary",
                  },
                }),
                tx.videoEdition.create({
                  data: {
                    coreId: `db-test-edition-srt-only-${suffix}`,
                    name: "DB test SRT only",
                  },
                }),
              ])
            const video = await tx.video.create({
              data: {
                coreId: `db-test-video-${suffix}`,
                slug: `db-test-video-${suffix}`,
                primaryLanguageId: primaryLanguage.id,
              },
            })
            const sibling = await tx.video.create({
              data: {
                coreId: `db-test-sibling-${suffix}`,
                slug: `db-test-sibling-${suffix}`,
              },
            })
            await tx.videoLocale.create({
              data: {
                videoId: video.id,
                languageId: primaryLanguage.id,
                languageSlug: primaryLanguage.slug,
                locale: "en",
                title: "DB test video",
                status: "PUBLISHED",
              },
            })

            const [muxOther, muxPrimary, muxSrtOnly] = await Promise.all([
              tx.muxVideo.create({
                data: {
                  coreId: `db-test-mux-other-${suffix}`,
                  playbackId: `db-test-playback-other-${suffix}`,
                },
              }),
              tx.muxVideo.create({
                data: {
                  coreId: `db-test-mux-primary-${suffix}`,
                  playbackId: `db-test-playback-primary-${suffix}`,
                },
              }),
              tx.muxVideo.create({
                data: {
                  coreId: `db-test-mux-srt-only-${suffix}`,
                  playbackId: `db-test-playback-srt-only-${suffix}`,
                },
              }),
            ])
            const [dubOther, dubPrimary] = await Promise.all([
              tx.videoDub.create({
                data: {
                  coreId: `db-test-dub-other-${suffix}`,
                  videoId: video.id,
                  videoEditionId: editionOther.id,
                  languageId: otherLanguage.id,
                  muxVideoId: muxOther.id,
                  duration: 9_000,
                  hls: "https://example.test/other.m3u8",
                  published: true,
                },
              }),
              tx.videoDub.create({
                data: {
                  coreId: `db-test-dub-primary-${suffix}`,
                  videoId: video.id,
                  videoEditionId: editionPrimary.id,
                  languageId: primaryLanguage.id,
                  muxVideoId: muxPrimary.id,
                  duration: 100,
                  hls: "https://example.test/primary.m3u8",
                  published: true,
                },
              }),
              tx.videoDub.create({
                data: {
                  coreId: `db-test-dub-srt-only-${suffix}`,
                  videoId: video.id,
                  videoEditionId: editionSrtOnly.id,
                  languageId: primaryLanguage.id,
                  muxVideoId: muxSrtOnly.id,
                  duration: 10_000,
                  hls: "https://example.test/srt-only.m3u8",
                  published: true,
                },
              }),
            ])
            const currentSubtitle = await tx.videoSubtitle.create({
              data: {
                coreId: `db-test-subtitle-current-${suffix}`,
                videoId: video.id,
                videoEditionId: editionPrimary.id,
                languageId: targetLanguage.id,
                vttSrc: "https://example.test/current.vtt",
              },
            })
            await Promise.all([
              tx.videoSubtitle.create({
                data: {
                  coreId: `db-test-subtitle-other-${suffix}`,
                  videoEditionId: editionOther.id,
                  languageId: targetLanguage.id,
                  vttSrc: "https://example.test/other.vtt",
                },
              }),
              tx.videoSubtitle.create({
                data: {
                  coreId: `db-test-subtitle-sibling-${suffix}`,
                  videoId: sibling.id,
                  videoEditionId: editionPrimary.id,
                  languageId: targetLanguage.id,
                  vttSrc: "https://example.test/sibling.vtt",
                },
              }),
              tx.videoSubtitle.create({
                data: {
                  coreId: `db-test-subtitle-srt-only-${suffix}`,
                  videoEditionId: editionSrtOnly.id,
                  languageId: targetLanguage.id,
                  srtSrc: "https://example.test/srt-only.srt",
                },
              }),
            ])

            const db = tx as unknown as PrismaClient
            const selected = (
              await new SearchWatchabilityService(db).hydrate({
                candidates: [{ videoId: video.id }],
                targetLanguageSlug: targetLanguage.slug!,
                includeOtherLanguageFallback: false,
              })
            ).get(video.id)
            expect(selected).toMatchObject({
              kind: "target_subtitle",
              videoDubId: dubPrimary.id,
              videoSubtitleId: currentSubtitle.id,
              hrefLanguageSlug: primaryLanguage.slug,
            })

            const catalog = await buildCatalogDocuments(db)
            const availability = buildAvailabilityDocuments(
              catalog.filter((document) => document.id === video.id),
            )
            expect(
              availability.find(
                (document) =>
                  document.videoId === video.id &&
                  document.videoEditionId === editionPrimary.id &&
                  document.languageId === targetLanguage.id,
              ),
            ).toMatchObject({
              subtitles: true,
              actionVideoDubId: dubPrimary.id,
              hrefLanguageSlug: primaryLanguage.slug,
            })
            expect(availability).not.toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  videoEditionId: editionSrtOnly.id,
                  languageId: targetLanguage.id,
                }),
              ]),
            )
            expect(dubOther.id).not.toBe(dubPrimary.id)

            throw rollback
          },
          { timeout: 30_000 },
        )
      } catch (error) {
        if (error !== rollback) throw error
      }
    }, 35_000)
  },
)
