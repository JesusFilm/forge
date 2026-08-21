import type { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { env } from "@/config/env"
import { prisma } from "@/db/client"
import { SearchWatchabilityService } from "./search-watchability"
import { VideoService } from "./video.service"
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

    it("counts only subtitle inventory cards with playable audio on the subtitle edition", async () => {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const prefix = `db-test-inventory-${suffix}`

      try {
        const fixture = await prisma.$transaction(async (tx) => {
          const [
            targetLanguage,
            primaryLanguage,
            fallbackLanguage,
            invalidLanguage,
          ] = await Promise.all([
            tx.language.create({
              data: {
                coreId: `${prefix}-target-language`,
                slug: `${prefix}-target`,
                bcp47: "zxx-x-inventory-target",
                name: { en: "DB Test Inventory Target" },
              },
            }),
            tx.language.create({
              data: {
                coreId: `${prefix}-primary-language`,
                slug: `${prefix}-primary`,
                bcp47: "zxx-x-inventory-primary",
                name: { en: "DB Test Inventory Primary" },
              },
            }),
            tx.language.create({
              data: {
                coreId: `${prefix}-fallback-language`,
                slug: `${prefix}-fallback`,
                bcp47: "zxx-x-inventory-fallback",
                name: { en: "DB Test Inventory Fallback" },
              },
            }),
            tx.language.create({
              data: {
                coreId: `${prefix}-invalid-language`,
                slug: `${prefix}-Invalid!`,
                bcp47: "zxx-x-inventory-invalid",
                name: { en: "DB Test Inventory Invalid" },
              },
            }),
          ])

          const [subtitleEdition, wrongEdition, srtEdition, orphanEdition] =
            await Promise.all([
              tx.videoEdition.create({
                data: {
                  coreId: `${prefix}-subtitle-edition`,
                  name: "DB test subtitle edition",
                },
              }),
              tx.videoEdition.create({
                data: {
                  coreId: `${prefix}-wrong-edition`,
                  name: "DB test wrong edition",
                },
              }),
              tx.videoEdition.create({
                data: {
                  coreId: `${prefix}-srt-edition`,
                  name: "DB test SRT edition",
                },
              }),
              tx.videoEdition.create({
                data: {
                  coreId: `${prefix}-orphan-edition`,
                  name: "DB test orphan subtitle edition",
                },
              }),
            ])

          const createPublishedVideo = async (name: string) => {
            const video = await tx.video.create({
              data: {
                coreId: `${prefix}-${name}`,
                slug: `${prefix}-${name}`,
                primaryLanguageId: primaryLanguage.id,
              },
            })
            await tx.videoLocale.create({
              data: {
                videoId: video.id,
                languageId: primaryLanguage.id,
                languageSlug: primaryLanguage.slug,
                locale: primaryLanguage.bcp47,
                title: `DB test ${name}`,
                status: "PUBLISHED",
              },
            })
            return video
          }

          const [
            watchableVideo,
            directSiblingVideo,
            srtOnlyVideo,
            noEditionAudioVideo,
          ] = await Promise.all([
            createPublishedVideo("watchable-video"),
            createPublishedVideo("direct-sibling-video"),
            createPublishedVideo("srt-only-video"),
            createPublishedVideo("no-edition-audio-video"),
          ])

          await Promise.all([
            tx.videoDub.create({
              data: {
                coreId: `${prefix}-watchable-fallback-dub`,
                videoId: watchableVideo.id,
                videoEditionId: subtitleEdition.id,
                languageId: fallbackLanguage.id,
                duration: 100,
                hls: "https://example.test/watchable-fallback.m3u8",
                published: true,
              },
            }),
            tx.videoDub.create({
              data: {
                coreId: `${prefix}-watchable-wrong-dub`,
                videoId: watchableVideo.id,
                videoEditionId: wrongEdition.id,
                languageId: primaryLanguage.id,
                duration: 10_000,
                hls: "https://example.test/watchable-wrong.m3u8",
                published: true,
              },
            }),
            tx.videoDub.create({
              data: {
                coreId: `${prefix}-watchable-primary-dub`,
                videoId: watchableVideo.id,
                videoEditionId: subtitleEdition.id,
                languageId: primaryLanguage.id,
                duration: 10,
                hls: "https://example.test/watchable-primary.m3u8",
                published: true,
              },
            }),
            tx.videoDub.create({
              data: {
                coreId: `${prefix}-watchable-invalid-language-dub`,
                videoId: watchableVideo.id,
                videoEditionId: subtitleEdition.id,
                languageId: invalidLanguage.id,
                duration: 10_000,
                hls: "https://example.test/watchable-invalid-language.m3u8",
                published: true,
              },
            }),
            tx.videoDub.create({
              data: {
                coreId: `${prefix}-direct-sibling-fallback-dub`,
                videoId: directSiblingVideo.id,
                videoEditionId: subtitleEdition.id,
                languageId: fallbackLanguage.id,
                duration: 100,
                hls: "https://example.test/direct-sibling-fallback.m3u8",
                published: true,
              },
            }),
            tx.videoDub.create({
              data: {
                coreId: `${prefix}-srt-only-dub`,
                videoId: srtOnlyVideo.id,
                videoEditionId: srtEdition.id,
                languageId: fallbackLanguage.id,
                duration: 100,
                hls: "https://example.test/srt-only.m3u8",
                published: true,
              },
            }),
            tx.videoDub.create({
              data: {
                coreId: `${prefix}-no-edition-audio-wrong-dub`,
                videoId: noEditionAudioVideo.id,
                videoEditionId: wrongEdition.id,
                languageId: primaryLanguage.id,
                duration: 10_000,
                hls: "https://example.test/no-edition-audio-wrong.m3u8",
                published: true,
              },
            }),
          ])

          await Promise.all([
            tx.videoSubtitle.create({
              data: {
                coreId: `${prefix}-watchable-subtitle`,
                videoId: watchableVideo.id,
                videoEditionId: subtitleEdition.id,
                languageId: targetLanguage.id,
                vttSrc: "https://example.test/watchable.vtt",
              },
            }),
            tx.videoSubtitle.create({
              data: {
                coreId: `${prefix}-srt-only-subtitle`,
                videoId: srtOnlyVideo.id,
                videoEditionId: srtEdition.id,
                languageId: targetLanguage.id,
                srtSrc: "https://example.test/srt-only.srt",
              },
            }),
            tx.videoSubtitle.create({
              data: {
                coreId: `${prefix}-no-edition-audio-subtitle`,
                videoId: noEditionAudioVideo.id,
                videoEditionId: orphanEdition.id,
                languageId: targetLanguage.id,
                vttSrc: "https://example.test/no-edition-audio.vtt",
              },
            }),
            tx.videoSubtitle.create({
              data: {
                coreId: `${prefix}-whitespace-vtt-subtitle`,
                videoId: directSiblingVideo.id,
                videoEditionId: subtitleEdition.id,
                languageId: targetLanguage.id,
                vttSrc: "   ",
              },
            }),
          ])

          return {
            targetLanguageSlug: targetLanguage.slug!,
            primaryLanguageSlug: primaryLanguage.slug!,
            watchableVideoId: watchableVideo.id,
            directSiblingVideoId: directSiblingVideo.id,
          }
        })

        const inventory = await new VideoService(
          prisma,
        ).getWatchLanguageInventory({
          languageSlug: fixture.targetLanguageSlug,
          limit: 25,
        })

        expect(inventory.counts.subtitleOnlyVideos).toBe(1)
        expect(inventory.subtitleOnlyVideos).toHaveLength(1)
        expect(inventory.subtitleOnlyVideos[0]).toMatchObject({
          id: fixture.watchableVideoId,
          availability: "SUBTITLE_ONLY",
          watchLanguageSlug: fixture.primaryLanguageSlug,
          durationSeconds: 10,
        })
        expect(inventory.subtitleOnlyVideos.map(({ id }) => id)).not.toContain(
          fixture.directSiblingVideoId,
        )
      } finally {
        await prisma.videoSubtitle.deleteMany({
          where: { coreId: { startsWith: prefix } },
        })
        await prisma.video.deleteMany({
          where: { coreId: { startsWith: prefix } },
        })
        await prisma.videoEdition.deleteMany({
          where: { coreId: { startsWith: prefix } },
        })
        await prisma.language.deleteMany({
          where: { coreId: { startsWith: prefix } },
        })
      }
    }, 35_000)
  },
)
