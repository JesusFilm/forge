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
import { containerWatchability } from "./typesense-watch-search.service"

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

    // The container tier's SQL cannot import playableDubWhere() /
    // notRestrictedFromWatchWhere(), so these cases are the enforcement point
    // for the parity KTD5 claims. Each one isolates a single condition: a
    // mocked Prisma double implements the recursive join by construction and
    // can prove none of them.
    describe("container tier", () => {
      type ContainerFixture = {
        containerSlug?: string
        containerLabel?: "COLLECTION" | "SERIES" | "FEATURE_FILM"
        containerPublished?: boolean
        containerNoIndex?: boolean
        containerRestrictedFromWatch?: boolean
        containerOwnDub?: boolean
        depth?: 1 | 2 | 3
        childPublished?: boolean
        childDeleted?: boolean
        childRestrictedFromWatch?: boolean
        intermediateRestrictedFromWatch?: boolean
        dubPublished?: boolean
        dubHls?: string | null
        dubLanguage?: "target" | "fallback"
        cycle?: boolean
        selfLoop?: boolean
        dubLanguagePublicSlug?: boolean
      }

      type ContainerResolution = {
        kind?: string
        languageSlug?: string | null
      }

      /**
       * Resolve one fixture through BOTH serving paths and assert they agree
       * before returning. Every case below therefore carries a parity
       * assertion for free -- a gate implemented in only one of the two
       * loaders turns its own case red rather than passing silently.
       */
      async function resolveContainer(
        fixture: ContainerFixture,
      ): Promise<ContainerResolution & { indexed: ContainerResolution }> {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const rollback = new RollbackFixture()
        let resolved: ContainerResolution = {}
        let indexedResolved: ContainerResolution = {}

        const {
          containerSlug = `db-container-${suffix}`,
          containerLabel = "COLLECTION",
          containerPublished = true,
          containerNoIndex = false,
          containerRestrictedFromWatch = false,
          containerOwnDub = false,
          depth = 1,
          childPublished = true,
          childDeleted = false,
          childRestrictedFromWatch = false,
          intermediateRestrictedFromWatch = false,
          dubPublished = true,
          dubHls = "https://example.test/child.m3u8",
          dubLanguage = "target",
          cycle = false,
          selfLoop = false,
          dubLanguagePublicSlug = true,
        } = fixture

        try {
          await prisma.$transaction(
            async (tx) => {
              const targetLanguage = await tx.language.create({
                data: {
                  coreId: `db-c-target-${suffix}`,
                  // An internal-style language slug has no public Watch route,
                  // so a container must not be admitted in that language.
                  slug: dubLanguagePublicSlug
                    ? `db-c-target-${suffix}`
                    : `DB_C_Target_${suffix}`,
                  bcp47: "ru",
                  name: { en: "Container Target" },
                },
              })
              const fallbackLanguage = await tx.language.create({
                data: {
                  coreId: `db-c-fallback-${suffix}`,
                  slug: `db-c-fallback-${suffix}`,
                  bcp47: "en",
                  name: { en: "Container Fallback" },
                },
              })
              await tx.$executeRaw`
                INSERT INTO language_fallback (id, source_language_id, fallback_language_id, priority)
                VALUES (${`db-c-lf-${suffix}`}, ${targetLanguage.id}, ${fallbackLanguage.id}, 1)
              `
              const edition = await tx.videoEdition.create({
                data: {
                  coreId: `db-c-edition-${suffix}`,
                  name: "Container edition",
                },
              })

              const container = await tx.video.create({
                data: {
                  coreId: `db-c-video-${suffix}`,
                  slug: containerSlug,
                  label: containerLabel,
                  noIndex: containerNoIndex,
                  restrictViewPlatforms: containerRestrictedFromWatch
                    ? ["watch"]
                    : [],
                },
              })
              if (containerPublished) {
                await tx.videoLocale.create({
                  data: {
                    videoId: container.id,
                    languageId: targetLanguage.id,
                    languageSlug: targetLanguage.slug,
                    locale: "ru",
                    title: "Container",
                    status: "PUBLISHED",
                  },
                })
              }

              // Build the descendant chain: container -> ... -> leaf.
              let parentId = container.id
              const intermediateCount = depth - 1
              for (let level = 0; level < intermediateCount; level++) {
                const middle = await tx.video.create({
                  data: {
                    coreId: `db-c-mid-${level}-${suffix}`,
                    slug: `db-c-mid-${level}-${suffix}`,
                    label: "SERIES",
                    restrictViewPlatforms: intermediateRestrictedFromWatch
                      ? ["watch"]
                      : [],
                  },
                })
                await tx.videoLocale.create({
                  data: {
                    videoId: middle.id,
                    languageId: targetLanguage.id,
                    languageSlug: targetLanguage.slug,
                    locale: "ru",
                    title: `Middle ${level}`,
                    status: "PUBLISHED",
                  },
                })
                await tx.videoRelation.create({
                  data: { parentId, childId: middle.id },
                })
                parentId = middle.id
              }

              const leaf = await tx.video.create({
                data: {
                  coreId: `db-c-leaf-${suffix}`,
                  slug: `db-c-leaf-${suffix}`,
                  label: "EPISODE",
                  deletedAt: childDeleted ? new Date() : null,
                  restrictViewPlatforms: childRestrictedFromWatch
                    ? ["watch"]
                    : [],
                },
              })
              if (childPublished) {
                await tx.videoLocale.create({
                  data: {
                    videoId: leaf.id,
                    languageId: targetLanguage.id,
                    languageSlug: targetLanguage.slug,
                    locale: "ru",
                    title: "Leaf",
                    status: "PUBLISHED",
                  },
                })
              } else {
                await tx.videoLocale.create({
                  data: {
                    videoId: leaf.id,
                    languageId: targetLanguage.id,
                    languageSlug: targetLanguage.slug,
                    locale: "ru",
                    title: "Leaf",
                    status: "DRAFT",
                  },
                })
              }
              await tx.videoRelation.create({
                data: { parentId, childId: leaf.id },
              })
              if (cycle) {
                await tx.videoRelation.create({
                  data: { parentId: leaf.id, childId: container.id },
                })
              }
              if (selfLoop) {
                await tx.videoRelation.create({
                  data: { parentId: container.id, childId: container.id },
                })
              }

              const mux = await tx.muxVideo.create({
                data: {
                  coreId: `db-c-mux-${suffix}`,
                  playbackId: `db-c-playback-${suffix}`,
                },
              })
              await tx.videoDub.create({
                data: {
                  coreId: `db-c-dub-${suffix}`,
                  videoId: leaf.id,
                  videoEditionId: edition.id,
                  languageId:
                    dubLanguage === "target"
                      ? targetLanguage.id
                      : fallbackLanguage.id,
                  muxVideoId: mux.id,
                  duration: 120,
                  hls: dubHls,
                  published: dubPublished,
                },
              })
              if (containerOwnDub) {
                const ownMux = await tx.muxVideo.create({
                  data: {
                    coreId: `db-c-own-mux-${suffix}`,
                    playbackId: `db-c-own-playback-${suffix}`,
                  },
                })
                await tx.videoDub.create({
                  data: {
                    coreId: `db-c-own-dub-${suffix}`,
                    videoId: container.id,
                    videoEditionId: edition.id,
                    languageId: targetLanguage.id,
                    muxVideoId: ownMux.id,
                    duration: 600,
                    hls: "https://example.test/container.m3u8",
                    published: true,
                  },
                })
              }

              const db = tx as unknown as PrismaClient
              const watchability = (
                await new SearchWatchabilityService(db).hydrate({
                  candidates: [{ videoId: container.id }],
                  targetLanguageSlug: targetLanguage.slug!,
                })
              ).get(container.id)
              resolved = {
                kind: watchability?.kind,
                languageSlug: watchability?.languageSlug,
              }

              // Resolve the SAME fixture through the Typesense index-time
              // projection and its real query-time selector. This is the
              // enforcement point for the mirrored container tier: the
              // indexer's own mocked suite cannot discriminate the label gate
              // at all, because Prisma emits `COLLECTION` / `SERIES` while the
              // SQL compares the stored `collection` / `series` @map values.
              const catalog = await buildCatalogDocuments(db)
              const containerDocument = catalog.find(
                (document) => document.id === container.id,
              )
              const indexed = containerWatchability(
                containerDocument?.containerLanguagesJson,
                {
                  slug: targetLanguage.slug!,
                  fallbackLanguageSlugs: [fallbackLanguage.slug!],
                },
              )
              indexedResolved = {
                kind: indexed?.kind ?? "unavailable",
                languageSlug: indexed?.languageSlug ?? null,
              }

              // Keep the expected language slugs addressable by the caller.
              const nameLanguage = (slug: string | null | undefined) =>
                slug === targetLanguage.slug
                  ? "target"
                  : slug === fallbackLanguage.slug
                    ? "fallback"
                    : slug
              resolved.languageSlug = nameLanguage(resolved.languageSlug)
              indexedResolved.languageSlug = nameLanguage(
                indexedResolved.languageSlug,
              )

              throw rollback
            },
            { timeout: 30_000 },
          )
        } catch (error) {
          if (error !== rollback) throw error
        }

        // Parity is asserted on the CONTAINER TIER only. The PostgreSQL
        // result is a full cascade, so when a container carries its own
        // playable Dub it legitimately resolves to a self-scoped kind that the
        // index-time projection -- which computes the container tier alone --
        // knows nothing about. The Typesense side enforces that same
        // precedence by running its container branch last in each resolver,
        // which the service suite covers.
        //
        // For every other fixture the two must agree exactly. Comparing
        // `unavailable` as a kind means a container the index-time root gate
        // wrongly ADMITS fails here too, not only one it wrongly rejects.
        const selfScoped =
          resolved.kind === "target_audio" ||
          resolved.kind === "target_subtitle" ||
          resolved.kind === "related_language"
        if (!selfScoped) {
          expect({
            kind: indexedResolved.kind,
            languageSlug: indexedResolved.languageSlug ?? null,
          }).toEqual({
            kind: resolved.kind,
            languageSlug: resolved.languageSlug ?? null,
          })
        }

        return { ...resolved, indexed: indexedResolved }
      }

      it("resolves a container from a playable target-language child", async () => {
        expect(await resolveContainer({ depth: 1 })).toMatchObject({
          kind: "container",
          languageSlug: "target",
        })
      }, 35_000)

      it("resolves a container whose playability sits on a grandchild", async () => {
        expect(await resolveContainer({ depth: 2 })).toMatchObject({
          kind: "container",
          languageSlug: "target",
        })
      }, 35_000)

      it("leaves a container unavailable when playability is three levels down", async () => {
        expect(await resolveContainer({ depth: 3 })).toMatchObject({
          kind: "unavailable",
        })
      }, 35_000)

      it("terminates on a cyclic video_relation instead of hanging", async () => {
        expect(await resolveContainer({ depth: 1, cycle: true })).toMatchObject(
          {
            kind: "container",
          },
        )
      }, 35_000)

      // No analogue in the per-request tier: that one only runs over ids no
      // self-scoped tier resolved, so a container carrying its own Dub never
      // reaches it. The index-time loader has no such gate, so without an
      // explicit self-exclusion a `video_relation` self-loop would let a
      // container admit itself from its own Dub and render as browse-only.
      it("does not admit a self-looped container from its own Dub", async () => {
        const resolution = await resolveContainer({
          selfLoop: true,
          containerOwnDub: true,
          childPublished: false,
        })
        expect(resolution.indexed).toMatchObject({ kind: "unavailable" })
      }, 35_000)

      // The index-time projection is the ONLY place the public-language-slug
      // pattern is enforced for containers: query time reads the stored slug
      // straight into `hrefLanguageSlug` without re-checking it. Drop this
      // gate and a container gains a link that bounces off /watch.
      it("does not admit a descendant whose language slug is not publicly routable", async () => {
        expect(
          await resolveContainer({ dubLanguagePublicSlug: false }),
        ).toMatchObject({ kind: "unavailable" })
      }, 35_000)

      it("falls back to a related-language descendant", async () => {
        expect(
          await resolveContainer({ depth: 1, dubLanguage: "fallback" }),
        ).toMatchObject({ kind: "container", languageSlug: "fallback" })
      }, 35_000)

      it("leaves an unpublished container unavailable", async () => {
        expect(
          await resolveContainer({ containerPublished: false }),
        ).toMatchObject({ kind: "unavailable" })
      }, 35_000)

      it("leaves a noIndex container unavailable", async () => {
        expect(
          await resolveContainer({ containerNoIndex: true }),
        ).toMatchObject({ kind: "unavailable" })
      }, 35_000)

      it("leaves an internal-style slug unavailable", async () => {
        expect(
          await resolveContainer({ containerSlug: "Nua_Know_God" }),
        ).toMatchObject({ kind: "unavailable" })
      }, 35_000)

      // PUBLIC_CONTENT_SLUG_SQL_PATTERN is `^[a-z0-9_-]+$`, so UPPERCASE is
      // what excludes `Nua_Know_God` -- the underscore does not. The fixture
      // above confounds both, so on its own it would pass just as happily
      // against a gate that wrongly rejected every underscore. These two
      // isolate the characters that actually decide admission.
      it("leaves an uppercase slug unavailable", async () => {
        expect(
          await resolveContainer({ containerSlug: "NuaKnowGod" }),
        ).toMatchObject({ kind: "unavailable" })
      }, 35_000)

      it("admits a lowercase slug containing underscores", async () => {
        expect(
          await resolveContainer({ containerSlug: "nua_know_god" }),
        ).toMatchObject({ kind: "container", languageSlug: "target" })
      }, 35_000)

      it("leaves a watch-restricted container unavailable despite a visible playable child", async () => {
        expect(
          await resolveContainer({ containerRestrictedFromWatch: true }),
        ).toMatchObject({ kind: "unavailable" })
      }, 35_000)

      it("does not count a watch-restricted child", async () => {
        expect(
          await resolveContainer({ childRestrictedFromWatch: true }),
        ).toMatchObject({ kind: "unavailable" })
      }, 35_000)

      it("does not count a soft-deleted child", async () => {
        expect(await resolveContainer({ childDeleted: true })).toMatchObject({
          kind: "unavailable",
        })
      }, 35_000)

      it("does not count a child with no published locale", async () => {
        expect(await resolveContainer({ childPublished: false })).toMatchObject(
          {
            kind: "unavailable",
          },
        )
      }, 35_000)

      it("does not count an unpublished child Dub", async () => {
        expect(await resolveContainer({ dubPublished: false })).toMatchObject({
          kind: "unavailable",
        })
      }, 35_000)

      it("does not count a child Dub with empty hls", async () => {
        expect(await resolveContainer({ dubHls: "" })).toMatchObject({
          kind: "unavailable",
        })
      }, 35_000)

      it("does not reach a grandchild through a watch-restricted intermediate", async () => {
        // The grandchild is fully visible and playable; only the series
        // between it and the container is hidden. Filtering the evaluated
        // descendant alone would call this container browsable, while the
        // series page renders the intermediate out and shows nothing.
        expect(
          await resolveContainer({
            depth: 2,
            intermediateRestrictedFromWatch: true,
          }),
        ).toMatchObject({ kind: "unavailable" })
      }, 35_000)

      it("still reaches a grandchild through a visible intermediate", async () => {
        expect(
          await resolveContainer({
            depth: 2,
            intermediateRestrictedFromWatch: false,
          }),
        ).toMatchObject({ kind: "container", languageSlug: "target" })
      }, 35_000)

      it("does not admit a non-Series-Shaped parent that carries children", async () => {
        expect(
          await resolveContainer({ containerLabel: "FEATURE_FILM" }),
        ).toMatchObject({ kind: "unavailable" })
      }, 35_000)

      it("keeps a container's own playable Dub ahead of its descendants", async () => {
        expect(await resolveContainer({ containerOwnDub: true })).toMatchObject(
          {
            kind: "target_audio",
          },
        )
      }, 35_000)
    })

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
