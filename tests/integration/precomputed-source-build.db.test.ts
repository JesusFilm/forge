import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { env } from "../../apps/admin/src/config/env"
import { currentAdminMigrationSql } from "../../apps/admin/src/services/recommendations/current-schema.test-fixture"
import {
  PrecomputedCatalogError,
  readPrecomputedCatalog,
} from "../../apps/admin/src/services/recommendations/precomputed/catalog"
import {
  loadPrecomputedRecommendationComparison,
  PrecomputedRecommendationError,
  submitPrecomputedRecommendation,
} from "../../apps/admin/src/services/recommendations/precomputed/contract"
// Repository-level integration harness. Neither app imports the other.
import {
  runPrecomputedSource,
  type SourceCatalog,
  type SourceIngest,
} from "../../apps/mastra/src/services/precomputed-recommendations/source-generation"
import type { StructuredModel } from "../../apps/mastra/src/services/precomputed-recommendations/astra-provider"
import { gaWatchHistoryFixture } from "./fixtures/ga-watch-history"

const bearer = "Bearer preview-test-key"
const reviewer = { id: "preview-operator", role: "ADMIN" } as const
const qualifiedWatchFixture = {
  sourceTable: "fixture.events.watch",
  observedStart: "2020-01-01",
  observedEnd: "2026-10-04",
  watchScope: {
    version: "jesusfilm-watch-v1",
    hosts: ["jesusfilm.org", "www.jesusfilm.org"],
    pathRule: "watch-route-and-children",
    totalEvents: 12,
    includedEvents: 7,
    missingUrlEvents: 1,
    malformedUrlEvents: 1,
    excludedHostEvents: 1,
    excludedPathEvents: 2,
  },
  videoIdCoverage: {
    eventName: "videostarts",
    inScopeEvents: 4,
    withIdEvents: 3,
    mappedEvents: null,
  },
  engagement: {
    definitionVersion: "watch-videostarts-v1",
    botBasis: "unverified",
    overlapIdentity: "unknown",
  },
  transitions: {
    status: "available",
    definitionVersion: "consecutive-videostarts-v1",
    continuity: "all_video_starts",
    sessionIdentity: "verified",
    ordering: "timestamp_and_sequence",
    botBasis: "unverified",
    overlapIdentity: "unknown",
  },
} as const

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "controlled Astra output through native Admin persistence",
  () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const schema = `precomputed_producer_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const sourceId = `a-source-${suffix}`
    const targetId = `b-target-${suffix}`
    const metadataId = `c-metadata-${suffix}`
    const sourceSlug = `watch-source-${suffix}`
    const targetSlug = `watch-target-${suffix}`
    const metadataSlug = `watch-metadata-${suffix}`
    const excerpt = "Una historia de esperanza para todos"
    const targetChunkId = `chunk-target-${suffix}`
    let prisma: PrismaClient
    let admin: Client
    let catalog: SourceCatalog
    let ingest: SourceIngest
    let cutoff: string

    beforeAll(async () => {
      admin = new Client({ connectionString: env.DATABASE_URL })
      await admin.connect()
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`SET search_path TO "${schema}", public`)
      for (const migration of currentAdminMigrationSql)
        await admin.query(migration)
      const url = new URL(env.DATABASE_URL)
      url.searchParams.set("schema", schema)
      prisma = new PrismaClient({
        datasources: { db: { url: url.toString() } },
      })
      const languageId = `language-${suffix}`
      await prisma.language.create({
        data: { id: languageId, coreId: languageId, slug: "english" },
      })
      const muxId = `mux-${suffix}`
      await prisma.muxVideo.create({
        data: { id: muxId, playbackId: `playback-${suffix}` },
      })
      for (const [index, id] of [sourceId, targetId, metadataId].entries()) {
        await prisma.video.create({
          data: {
            id,
            coreId: `core-${id}`,
            slug: [sourceSlug, targetSlug, metadataSlug][index]!,
          },
        })
        await prisma.videoLocale.create({
          data: {
            id: `locale-${id}`,
            videoId: id,
            locale: index === 1 ? "es" : "en",
            status: "PUBLISHED",
            title:
              index === 0
                ? "A journey toward hope"
                : index === 1
                  ? "Una historia distinta"
                  : "A study of courage",
            description:
              "A distinct story of hope, courage, and a changed life.",
          },
        })
        await prisma.videoDub.create({
          data: {
            id: `dub-${id}`,
            coreId: `dub-core-${id}`,
            videoId: id,
            languageId,
            muxVideoId: muxId,
            published: true,
          },
        })
        if (index < 2) {
          const editionId = `edition-${id}`
          await prisma.videoEdition.create({
            data: { id: editionId, coreId: editionId, name: "Spanish edition" },
          })
          const transcriptId = `transcript-${id}`
          await prisma.videoTranscript.create({
            data: {
              id: transcriptId,
              videoEditionId: editionId,
              videoId: id,
              language: "es",
              model: "fixture",
              dimensions: 1536,
              chunkingType: "fixture",
              maxChunkTokens: 100,
              overlapTokens: 0,
              totalChunks: 1,
              totalTokens: 10,
              generatedAt: new Date(),
            },
          })
          await prisma.videoTranscriptChunk.create({
            data: {
              id: index === 1 ? targetChunkId : `chunk-source-${suffix}`,
              transcriptId,
              language: "es",
              chunkIndex: 0,
              chunkId: "chunk-0",
              text: `${excerpt} en tiempos difíciles.`,
              rawSourceText: `${excerpt} en tiempos difíciles.`,
              tokenCount: 10,
            },
          })
        }
      }
      cutoff = new Date(Date.now() + 5_000).toISOString()
      catalog = {
        async video(input) {
          const result = await readPrecomputedCatalog(
            prisma,
            { action: "video", ...input },
            bearer,
          )
          if (result.action !== "video")
            throw new Error("Wrong catalog response")
          return result.video
        },
        async catalog(input) {
          const result = await readPrecomputedCatalog(
            prisma,
            { action: "catalog", limit: 40, ...input },
            bearer,
          )
          if (result.action !== "catalog")
            throw new Error("Wrong catalog response")
          return result
        },
        async chunks(input) {
          const result = await readPrecomputedCatalog(
            prisma,
            { action: "chunks", limit: 20, ...input },
            bearer,
          )
          if (result.action !== "chunks")
            throw new Error("Wrong catalog response")
          return result
        },
      }
      ingest = async (input) => {
        try {
          return await submitPrecomputedRecommendation(prisma, input, bearer)
        } catch (error) {
          if (
            error instanceof PrecomputedRecommendationError &&
            error.code === "not_found" &&
            typeof input === "object" &&
            input !== null &&
            "action" in input &&
            input.action === "status"
          )
            return null
          throw error
        }
      }
    }, 120_000)

    afterAll(async () => {
      await prisma?.$disconnect()
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
    })

    function model(
      options: {
        invented?: boolean
        sparse?: boolean
        malformed?: boolean
        accessDenied?: boolean
        badMetadataField?: "themes" | "keywords"
      } = {},
    ): StructuredModel {
      return {
        generate: vi.fn(async ({ schema, prompt }) => {
          const data = JSON.parse(prompt) as {
            task: string
            untrustedCatalogData: { candidate?: { id: string } }
          }
          if (options.accessDenied && data.task === "catalog_discovery")
            throw { statusCode: 403 }
          let output: unknown
          if (data.task === "source_summary")
            output = {
              summaryEnglish:
                "A Spanish account of hope and change in difficult times.",
            }
          else if (data.task === "catalog_discovery")
            output = {
              candidateVideoIds: options.malformed
                ? "invalid"
                : options.sparse
                  ? []
                  : [targetId, metadataId],
            }
          else if (data.task === "analytics_query_plan")
            output = { candidateVideoIds: [targetId, metadataId] }
          else if (data.untrustedCatalogData.candidate?.id === targetId)
            output = {
              connections: [
                {
                  kind: "direct",
                  relationship: "more_like_this",
                  strength: 90,
                  reasonEnglish:
                    "A distinct Spanish story explores the same hope in hardship.",
                  evidence: {
                    basis: "transcript",
                    passages: [
                      {
                        chunkId: targetChunkId,
                        excerpt: options.invented
                          ? "An invented sentence in the transcript"
                          : excerpt,
                      },
                    ],
                  },
                },
              ],
            }
          else
            output = {
              connections: [
                {
                  kind: "alternative",
                  relationship: "useful_next_watch",
                  strength: 70,
                  reasonEnglish:
                    "This separate story expands the theme of courage.",
                  evidence: {
                    basis: "metadata",
                    fields: options.badMetadataField
                      ? [options.badMetadataField]
                      : ["title", "description"],
                  },
                },
              ],
            }
          return {
            output: schema.parse(output),
            usage: {
              inputTokens: 100,
              outputTokens: 20,
              cachedInputTokens: 10,
            },
          }
        }),
      } as StructuredModel
    }

    it("builds multilingual and metadata-only connections, reports usage, and replays without another model call", async () => {
      const generationId = `successful-${suffix}`
      const controlled = model()
      const first = await runPrecomputedSource(
        { generationId, sourceVideoId: sourceId, inputCutoff: cutoff },
        { catalog, ingest, model: controlled },
      )
      expect(first).toMatchObject({ state: "complete", acceptedCount: 2 })
      const comparison = await loadPrecomputedRecommendationComparison(prisma, {
        generationId,
        sourceVideoId: sourceId,
        audioLanguageSlug: "english",
        reviewer,
      })
      expect(comparison).toMatchObject({
        state: "ready",
        generation: {
          modelId: "gpt-6-astra",
          inputMode: "content_only",
          inputSnapshotMode: "observed_fenced",
        },
        allAcceptedCount: 2,
        usage: { callCount: 4, inputTokens: 400, outputTokens: 80 },
        experimental: [
          {
            targetVideoId: targetId,
            kind: "direct",
            evidence: {
              basis: "transcript",
              passages: [{ language: "es", excerpt }],
            },
          },
          {
            targetVideoId: metadataId,
            kind: "alternative",
            evidence: { basis: "metadata" },
          },
        ],
      })
      const replay = await runPrecomputedSource(
        { generationId, sourceVideoId: sourceId, inputCutoff: cutoff },
        { catalog, ingest, model: controlled },
      )
      expect(replay.state).toBe("replayed")
      expect(controlled.generate).toHaveBeenCalledTimes(4)
      await expect(
        runPrecomputedSource(
          { generationId, sourceVideoId: targetId, inputCutoff: cutoff },
          { catalog, ingest, model: controlled },
        ),
      ).rejects.toMatchObject({ code: "contract_rejected" })
      await expect(
        runPrecomputedSource(
          {
            generationId,
            sourceVideoId: sourceId,
            inputCutoff: new Date(Date.parse(cutoff) - 1_000).toISOString(),
          },
          { catalog, ingest, model: controlled },
        ),
      ).rejects.toMatchObject({ code: "contract_rejected" })
      expect(controlled.generate).toHaveBeenCalledTimes(4)
      expect(
        await submitPrecomputedRecommendation(
          prisma,
          { action: "status", generationId, sourceVideoId: sourceId },
          bearer,
        ),
      ).toMatchObject({
        state: "complete",
        source: { status: "complete", acceptedCount: 2 },
      })
    })

    it("carries mapped GA navigation into model decisions and saved Admin review without claiming ordered playback", async () => {
      const generationId = `ga-navigation-${suffix}`
      const controlled = model()
      const prompts: Array<{
        task: string
        untrustedCatalogData: Record<string, unknown>
      }> = []
      const history = gaWatchHistoryFixture({
        sourceSlug,
        targetSlug,
        metadataSlug,
      })
      const observingModel: StructuredModel = {
        async generate(input) {
          expect(input.prompt).not.toContain("watchRouteIdentity")
          expect(input.prompt).not.toContain("fixture-token")
          const prompt = JSON.parse(input.prompt)
          prompts.push(prompt)
          const result = await controlled.generate(input)
          if (
            prompt.task === "candidate_judgment" &&
            prompt.untrustedCatalogData.historicalNavigation === 7
          ) {
            return {
              ...result,
              output: input.schema.parse({
                connections: [
                  {
                    kind: "direct",
                    relationship: "useful_next_watch",
                    strength: 95,
                    reasonEnglish:
                      "Transcript support and seven observed referrer-associated starts support this next watch.",
                    evidence: {
                      basis: "transcript",
                      passages: [{ chunkId: targetChunkId, excerpt }],
                    },
                  },
                ],
              }),
            }
          }
          return result
        },
      }
      const result = await runPrecomputedSource(
        {
          generationId,
          sourceVideoId: sourceId,
          inputCutoff: cutoff,
          historyRequired: true,
        },
        { catalog, ingest, model: observingModel, history },
      )
      expect(result).toMatchObject({ state: "complete", acceptedCount: 2 })
      expect(prompts).toContainEqual(
        expect.objectContaining({
          task: "candidate_judgment",
          untrustedCatalogData: expect.objectContaining({
            candidate: expect.objectContaining({ id: targetId }),
            historicalNavigation: 7,
            historicalSourceSignal: {
              videoKey: sourceId,
              views: 100,
              engagedViews: null,
              exposures: null,
            },
            historicalCandidateSignal: {
              videoKey: targetId,
              views: 80,
              engagedViews: null,
              exposures: null,
            },
          }),
        }),
      )
      const comparison = await loadPrecomputedRecommendationComparison(prisma, {
        generationId,
        sourceVideoId: sourceId,
        audioLanguageSlug: "english",
        reviewer,
      })
      expect(comparison).toMatchObject({
        state: "ready",
        generation: {
          inputMode: "historical_analytics",
          promptVersion: "astra-source-history-navigation-v1",
        },
        history: {
          provider: "ga_data_api",
          rangeStart: "2022-08-06",
          rangeEnd: "2026-10-03",
          qualification: {
            sourceAvailability: {
              coverage: "partial_source_history",
              unavailablePrefixStart: "2022-06-21",
              unavailablePrefixEnd: "2022-08-05",
            },
            transitions: {
              status: "unavailable",
              reason: "missing_session_identity",
            },
            navigation: { interpretation: "navigation_not_playback_sequence" },
            mapping: { historicalOwnership: "unverified" },
          },
          navigationCoverage: {
            candidateEvents: 10,
            qualifiedEvents: 7,
            unmappedEvents: 3,
          },
        },
        experimental: expect.arrayContaining([
          expect.objectContaining({
            targetVideoId: targetId,
            reasonEnglish:
              "Transcript support and seven observed referrer-associated starts support this next watch.",
          }),
        ]),
      })
    })

    it("shows qualified aggregate provenance beside a history-informed saved source", async () => {
      const generationId = `historical-${suffix}`
      const observedPrompts: string[] = []
      const observedQueries: Array<{
        kind: string
        rangeStart: string
        rangeEnd: string
        sourceKey: string
        targetKeys: string[]
        limit: number
      }> = []
      const controlled = model()
      const history = {
        async describe() {
          return {
            provider: "fixture" as const,
            queryId: "verified-ga-history-fixture-v1",
            rangeStart: "2023-01-01",
            rangeEnd: "2026-10-04",
            identity: "core_id" as const,
            botFiltering: "unknown" as const,
            measurement: "observed_events" as const,
            overlap: "unknown" as const,
            qualification: qualifiedWatchFixture,
          }
        },
        async readPage(input: {
          kind: "engagement" | "transitions"
          after?: string
          videoKeys: string[]
          targetKeys: string[]
          rangeStart: string
          rangeEnd: string
          sourceKey: string
          limit: number
        }) {
          observedQueries.push(input)
          if (
            input.kind === "engagement" &&
            input.videoKeys.includes(`core-${sourceId}`)
          )
            return {
              rows: [
                {
                  videoKey: `core-${sourceId}`,
                  views: 100,
                  engagedViews: 60,
                  exposures: null,
                },
              ],
              nextCursor: null,
              totalRows: 1,
              queryExecutionId: "source-engagement-job",
              jobComplete: true,
              bytesProcessed: 1024,
            }
          if (input.kind === "engagement" && !input.after)
            return {
              rows: [
                {
                  videoKey: `core-${targetId}`,
                  views: 0,
                  engagedViews: 0,
                  exposures: 0,
                },
              ],
              nextCursor: "page-2",
              totalRows: 2,
              queryExecutionId: "candidate-engagement-job",
              jobComplete: true,
              bytesProcessed: 1024,
            }
          if (input.kind === "engagement")
            return {
              rows: [
                {
                  videoKey: "unknown-legacy-video",
                  views: 3,
                  engagedViews: 2,
                  exposures: null,
                },
              ],
              nextCursor: null,
              totalRows: 2,
              queryExecutionId: "candidate-engagement-job",
              jobComplete: true,
              bytesProcessed: 1024,
            }
          if (input.targetKeys.length === 0)
            return {
              rows: [],
              nextCursor: null,
              totalRows: 0,
              queryExecutionId: "source-transition-job",
              jobComplete: true,
              bytesProcessed: 0,
            }
          return {
            rows: [
              {
                sourceKey: `core-${sourceId}`,
                targetKey: `core-${targetId}`,
                transitions: 7,
              },
            ],
            nextCursor: null,
            totalRows: 1,
            queryExecutionId: "candidate-transition-job",
            jobComplete: true,
            bytesProcessed: 2048,
          }
        },
      }
      const observingModel: StructuredModel = {
        generate: async (input) => {
          observedPrompts.push(input.prompt)
          const generated = await controlled.generate(input)
          const prompt = JSON.parse(input.prompt) as {
            task: string
            untrustedCatalogData: { historicalTransitions?: number }
          }
          if (
            prompt.task === "candidate_judgment" &&
            prompt.untrustedCatalogData.historicalTransitions === 7
          ) {
            return {
              ...generated,
              output: input.schema.parse({
                connections: [
                  {
                    kind: "direct",
                    relationship: "useful_next_watch",
                    strength: 95,
                    reasonEnglish:
                      "The matching story of hope has transcript support and an observed historical next-watch transition.",
                    evidence: {
                      basis: "transcript",
                      passages: [{ chunkId: targetChunkId, excerpt }],
                    },
                  },
                ],
              }),
            }
          }
          return generated
        },
      }
      const result = await runPrecomputedSource(
        {
          generationId,
          sourceVideoId: sourceId,
          inputCutoff: cutoff,
          historyRequired: true,
        },
        { catalog, ingest, model: observingModel, history },
      )
      expect(result).toMatchObject({ state: "complete", acceptedCount: 2 })
      expect(observedPrompts.join(" ")).toContain('"historicalTransitions":7')
      expect(observedPrompts.join(" ")).not.toContain("unknown-legacy-video")
      expect(
        observedQueries.every(
          (query) =>
            query.rangeStart === "2023-01-01" &&
            query.rangeEnd === "2026-10-04" &&
            query.sourceKey === `core-${sourceId}` &&
            query.limit === 100,
        ),
      ).toBe(true)
      expect(
        observedQueries.some(
          (query) =>
            query.kind === "transitions" &&
            query.targetKeys.includes(`core-${targetId}`),
        ),
      ).toBe(true)
      const comparison = await loadPrecomputedRecommendationComparison(prisma, {
        generationId,
        sourceVideoId: sourceId,
        audioLanguageSlug: "english",
        reviewer,
      })
      expect(comparison).toMatchObject({
        state: "ready",
        generation: {
          inputMode: "historical_fixture",
          promptVersion: "astra-source-history-v1",
        },
        history: {
          provider: "fixture",
          status: "complete",
          botFiltering: "unknown",
          mappedRows: 3,
          unmappedRows: 1,
          rowCount: 4,
          catalogCandidates: 2,
          inspectedCandidates: 2,
          unmappedCandidates: 0,
          bytesProcessed: 4096,
          queryExecutionCount: 3,
          overlap: "unknown",
          qualification: qualifiedWatchFixture,
        },
      })
      if (comparison.state !== "ready")
        throw new Error("History build not ready")
      expect(comparison.experimental[0]).toMatchObject({
        targetVideoId: targetId,
        reasonEnglish:
          "The matching story of hope has transcript support and an observed historical next-watch transition.",
        evidence: { basis: "transcript" },
      })
      const status = (await submitPrecomputedRecommendation(
        prisma,
        { action: "status", generationId, sourceVideoId: sourceId },
        bearer,
      )) as { history: unknown }
      expect(JSON.stringify(status)).not.toContain("candidate-engagement-job")
      expect(
        await submitPrecomputedRecommendation(
          prisma,
          { action: "history", generationId, history: status.history },
          bearer,
        ),
      ).toMatchObject({ replay: true })
    })

    it("fails a history-required build when no warehouse reader is configured", async () => {
      const generationId = `historical-unavailable-${suffix}`
      const result = await runPrecomputedSource(
        {
          generationId,
          sourceVideoId: sourceId,
          inputCutoff: cutoff,
          historyRequired: true,
        },
        { catalog, ingest, model: model() },
      )
      expect(result).toMatchObject({
        state: "failed",
        failureCode: "analytics_unavailable",
      })
      expect(
        await loadPrecomputedRecommendationComparison(prisma, {
          generationId,
          sourceVideoId: sourceId,
          audioLanguageSlug: "english",
          reviewer,
        }),
      ).toMatchObject({ state: "failed", failureCode: "analytics_unavailable" })
    })

    it("does not treat totals-only aggregates as complete historical transitions", async () => {
      const generationId = `historical-totals-only-${suffix}`
      const controlled = model()
      const result = await runPrecomputedSource(
        {
          generationId,
          sourceVideoId: sourceId,
          inputCutoff: cutoff,
          historyRequired: true,
        },
        {
          catalog,
          ingest,
          model: controlled,
          history: {
            async describe() {
              return {
                provider: "fixture",
                queryId: "totals-only-fixture",
                rangeStart: "2020-01-01",
                rangeEnd: "2026-10-04",
                identity: "core_id",
                botFiltering: "unknown",
                measurement: "observed_events",
                overlap: "unknown",
                qualification: {
                  ...qualifiedWatchFixture,
                  transitions: {
                    status: "unavailable",
                    reason: "totals_only",
                  },
                },
              } as const
            },
            async readPage() {
              throw new Error("totals-only source must not be queried")
            },
          },
        },
      )
      expect(result).toMatchObject({
        state: "failed",
        failureCode: "analytics_transition_totals_only",
      })
      expect(controlled.generate).not.toHaveBeenCalled()
      expect(
        await loadPrecomputedRecommendationComparison(prisma, {
          generationId,
          sourceVideoId: sourceId,
          audioLanguageSlug: "english",
          reviewer,
        }),
      ).toMatchObject({
        state: "failed",
        failureCode: "analytics_transition_totals_only",
        history: null,
      })
    })

    it("marks missing pages as failed instead of claiming complete historical coverage", async () => {
      const generationId = `historical-page-gap-${suffix}`
      const controlled = model()
      const result = await runPrecomputedSource(
        {
          generationId,
          sourceVideoId: sourceId,
          inputCutoff: cutoff,
          historyRequired: true,
        },
        {
          catalog,
          ingest,
          model: controlled,
          history: {
            async describe() {
              return {
                provider: "fixture",
                queryId: "broken-paging-fixture",
                rangeStart: "2020-01-01",
                rangeEnd: "2026-10-04",
                identity: "core_id",
                botFiltering: "unknown",
                measurement: "observed_events",
                overlap: "unknown",
                qualification: qualifiedWatchFixture,
              } as const
            },
            async readPage() {
              return {
                rows: [
                  {
                    videoKey: `core-${sourceId}`,
                    views: 4,
                    engagedViews: 2,
                    exposures: null,
                  },
                ],
                nextCursor: null,
                totalRows: 2,
                queryExecutionId: "missing-page-job",
                jobComplete: true,
                bytesProcessed: null,
              }
            },
          },
        },
      )
      expect(result).toMatchObject({
        state: "failed",
        failureCode: "analytics_incomplete",
      })
      expect(controlled.generate).not.toHaveBeenCalled()
      expect(
        await loadPrecomputedRecommendationComparison(prisma, {
          generationId,
          sourceVideoId: sourceId,
          audioLanguageSlug: "english",
          reviewer,
        }),
      ).toMatchObject({
        state: "failed",
        failureCode: "analytics_incomplete",
        history: null,
      })
    })

    it("rejects continuation pages from a different warehouse job", async () => {
      const generationId = `historical-job-drift-${suffix}`
      const result = await runPrecomputedSource(
        {
          generationId,
          sourceVideoId: sourceId,
          inputCutoff: cutoff,
          historyRequired: true,
        },
        {
          catalog,
          ingest,
          model: model(),
          history: {
            async describe() {
              return {
                provider: "fixture",
                queryId: "job-drift-fixture",
                rangeStart: "2020-01-01",
                rangeEnd: "2026-10-04",
                identity: "core_id",
                botFiltering: "unknown",
                measurement: "observed_events",
                overlap: "unknown",
                qualification: qualifiedWatchFixture,
              } as const
            },
            async readPage(input) {
              return {
                rows: [
                  {
                    videoKey: `core-${sourceId}`,
                    views: 4,
                    engagedViews: 2,
                    exposures: null,
                  },
                ],
                nextCursor: input.after ? null : "next-page",
                totalRows: 2,
                queryExecutionId: input.after ? "different-job" : "first-job",
                jobComplete: true,
                bytesProcessed: 1024,
              }
            },
          },
        },
      )
      expect(result).toMatchObject({
        state: "failed",
        failureCode: "analytics_incomplete",
      })
    })

    it("rejects an individual viewer field in aggregate rows before model input", async () => {
      const generationId = `historical-raw-row-${suffix}`
      const controlled = model()
      const result = await runPrecomputedSource(
        {
          generationId,
          sourceVideoId: sourceId,
          inputCutoff: cutoff,
          historyRequired: true,
        },
        {
          catalog,
          ingest,
          model: controlled,
          history: {
            async describe() {
              return {
                provider: "fixture",
                queryId: "raw-row-fixture",
                rangeStart: "2020-01-01",
                rangeEnd: "2026-10-04",
                identity: "core_id",
                botFiltering: "unknown",
                measurement: "observed_events",
                overlap: "unknown",
                qualification: qualifiedWatchFixture,
              } as const
            },
            async readPage() {
              return {
                rows: [
                  {
                    videoKey: `core-${sourceId}`,
                    views: 4,
                    engagedViews: 2,
                    exposures: null,
                    viewerId: "private-viewer",
                  },
                ],
                nextCursor: null,
                totalRows: 1,
                queryExecutionId: "raw-row-job",
                jobComplete: true,
                bytesProcessed: 1,
              }
            },
          },
        },
      )
      expect(result).toMatchObject({
        state: "failed",
        failureCode: "analytics_incomplete",
      })
      expect(controlled.generate).not.toHaveBeenCalled()
      const status = await submitPrecomputedRecommendation(
        prisma,
        { action: "status", generationId, sourceVideoId: sourceId },
        bearer,
      )
      expect(JSON.stringify(status)).not.toContain("private-viewer")
    })

    it("does not accept a schema claim or unfinished query job as historical coverage", async () => {
      const definition = {
        provider: "fixture" as const,
        queryId: "schema-check-fixture",
        rangeStart: "2020-01-01",
        rangeEnd: "2026-10-04",
        identity: "core_id" as const,
        botFiltering: "unknown" as const,
        measurement: "observed_events" as const,
        overlap: "unknown" as const,
        qualification: qualifiedWatchFixture,
      }
      const noSchema = await runPrecomputedSource(
        {
          generationId: `historical-schema-gap-${suffix}`,
          sourceVideoId: sourceId,
          inputCutoff: cutoff,
          historyRequired: true,
        },
        {
          catalog,
          ingest,
          model: model(),
          history: {
            async describe() {
              return {
                ...definition,
                identity: "unverified_event_url" as never,
              }
            },
            async readPage() {
              throw new Error("should not query an unverified schema")
            },
          },
        },
      )
      expect(noSchema).toMatchObject({
        state: "failed",
        failureCode: "analytics_unavailable",
      })
      const unfinished = await runPrecomputedSource(
        {
          generationId: `historical-unfinished-job-${suffix}`,
          sourceVideoId: sourceId,
          inputCutoff: cutoff,
          historyRequired: true,
        },
        {
          catalog,
          ingest,
          model: model(),
          history: {
            async describe() {
              return definition
            },
            async readPage() {
              return {
                rows: [],
                nextCursor: null,
                totalRows: 0,
                queryExecutionId: "pending-query-job",
                jobComplete: false,
                bytesProcessed: null,
              }
            },
          },
        },
      )
      expect(unfinished).toMatchObject({
        state: "failed",
        failureCode: "analytics_incomplete",
      })
    })

    it("does not sum multiple legacy aliases for one source without proven disjointness", async () => {
      const generationId = `historical-alias-overlap-${suffix}`
      const result = await runPrecomputedSource(
        {
          generationId,
          sourceVideoId: sourceId,
          inputCutoff: cutoff,
          historyRequired: true,
        },
        {
          catalog,
          ingest,
          model: model(),
          history: {
            async describe() {
              return {
                provider: "fixture",
                queryId: "alias-overlap-fixture",
                rangeStart: "2020-01-01",
                rangeEnd: "2026-10-04",
                identity: "verified_alias",
                aliases: {
                  "https://watch.example/legacy-one": sourceId,
                  "https://watch.example/legacy-two": sourceId,
                },
                botFiltering: "unknown",
                measurement: "observed_events",
                overlap: "unknown",
                qualification: qualifiedWatchFixture,
              } as const
            },
            async readPage() {
              throw new Error("ambiguous source must not be queried")
            },
          },
        },
      )
      expect(result).toMatchObject({
        state: "failed",
        failureCode: "analytics_mapping_unverified",
      })
      expect(
        await loadPrecomputedRecommendationComparison(prisma, {
          generationId,
          sourceVideoId: sourceId,
          audioLanguageSlug: "english",
          reviewer,
        }),
      ).toMatchObject({
        state: "failed",
        failureCode: "analytics_mapping_unverified",
      })
    })

    it("fails invented transcript evidence without publishing a partial source", async () => {
      const generationId = `invented-${suffix}`
      const result = await runPrecomputedSource(
        { generationId, sourceVideoId: sourceId, inputCutoff: cutoff },
        {
          catalog,
          ingest,
          model: model({ invented: true }),
        },
      )
      expect(result).toMatchObject({
        state: "failed",
        failureCode: "provider_invalid_output",
      })
      expect(
        await submitPrecomputedRecommendation(
          prisma,
          { action: "status", generationId, sourceVideoId: sourceId },
          bearer,
        ),
      ).toMatchObject({
        state: "failed",
        source: { status: "failed", failureCode: "provider_invalid_output" },
        usage: { callCount: 3, inputTokens: 300, unknownUsageCallCount: 0 },
      })
      expect(
        await loadPrecomputedRecommendationComparison(prisma, {
          generationId,
          sourceVideoId: sourceId,
          audioLanguageSlug: "english",
          reviewer,
        }),
      ).toMatchObject({
        state: "failed",
        failureCode: "provider_invalid_output",
      })
    })

    it("accepts a sparse zero-choice build as complete", async () => {
      const generationId = `sparse-${suffix}`
      const result = await runPrecomputedSource(
        { generationId, sourceVideoId: sourceId, inputCutoff: cutoff },
        {
          catalog,
          ingest,
          model: model({ sparse: true }),
        },
      )
      expect(result).toMatchObject({ state: "complete", acceptedCount: 0 })
      expect(
        await loadPrecomputedRecommendationComparison(prisma, {
          generationId,
          sourceVideoId: sourceId,
          audioLanguageSlug: "english",
          reviewer,
        }),
      ).toMatchObject({ state: "ready", coverageGap: "no_connections" })
    })

    it("records malformed provider output and an explicit model access failure", async () => {
      for (const [label, controlled, code] of [
        ["malformed", model({ malformed: true }), "provider_invalid_output"],
        [
          "access-denied",
          model({ accessDenied: true }),
          "provider_access_unavailable",
        ],
      ] as const) {
        const generationId = `${label}-${suffix}`
        const result = await runPrecomputedSource(
          { generationId, sourceVideoId: sourceId, inputCutoff: cutoff },
          {
            catalog,
            ingest,
            model: controlled,
          },
        )
        expect(result).toMatchObject({ state: "failed", failureCode: code })
        expect(
          await submitPrecomputedRecommendation(
            prisma,
            { action: "status", generationId, sourceVideoId: sourceId },
            bearer,
          ),
        ).toMatchObject({
          state: "failed",
          source: { status: "failed", failureCode: code },
          usage: { unknownUsageCallCount: 1 },
        })
      }
    })

    it("rejects metadata evidence for unavailable candidate fields", async () => {
      for (const field of ["themes", "keywords"] as const) {
        const generationId = `invalid-metadata-${field}-${suffix}`
        const result = await runPrecomputedSource(
          { generationId, sourceVideoId: sourceId, inputCutoff: cutoff },
          { catalog, ingest, model: model({ badMetadataField: field }) },
        )
        expect(result).toMatchObject({
          state: "failed",
          failureCode: "provider_invalid_output",
        })
        expect(
          await submitPrecomputedRecommendation(
            prisma,
            {
              action: "status",
              generationId,
              sourceVideoId: sourceId,
            },
            bearer,
          ),
        ).toMatchObject({
          state: "failed",
          source: { status: "failed" },
          usage: { unknownUsageCallCount: 0 },
        })
      }
    })

    it("persists a qualified preflight failure without spending on the model", async () => {
      const generationId = `preflight-stale-${suffix}`
      const controlled = model()
      const staleCatalog: SourceCatalog = {
        ...catalog,
        video: async () => {
          throw new PrecomputedCatalogError(
            "stale_cutoff",
            "Observed version changed",
          )
        },
      }
      const result = await runPrecomputedSource(
        { generationId, sourceVideoId: sourceId, inputCutoff: cutoff },
        { catalog: staleCatalog, ingest, model: controlled },
      )
      expect(result).toMatchObject({
        state: "failed",
        failureCode: "input_stale",
      })
      expect(controlled.generate).not.toHaveBeenCalled()
      expect(
        await submitPrecomputedRecommendation(
          prisma,
          {
            action: "status",
            generationId,
            sourceVideoId: sourceId,
          },
          bearer,
        ),
      ).toMatchObject({
        state: "failed",
        inputSnapshotMode: "preflight_failed",
        generationFailureCode: "input_stale",
        source: { status: "failed", failureCode: "input_stale" },
      })
      expect(
        await loadPrecomputedRecommendationComparison(prisma, {
          generationId,
          sourceVideoId: sourceId,
          audioLanguageSlug: "english",
          reviewer,
        }),
      ).toMatchObject({
        state: "failed",
        failureCode: "input_stale",
        inputSnapshotMode: "preflight_failed",
      })
      expect(
        await runPrecomputedSource(
          { generationId, sourceVideoId: sourceId, inputCutoff: cutoff },
          { catalog: staleCatalog, ingest, model: controlled },
        ),
      ).toMatchObject({ state: "replayed" })
    })

    it("rejects a selected input changed after judgment but before Admin commit", async () => {
      const generationId = `post-judgment-change-${suffix}`
      let changed = false
      const racingIngest: SourceIngest = async (input) => {
        if (
          !changed &&
          typeof input === "object" &&
          input !== null &&
          "action" in input &&
          input.action === "source"
        ) {
          changed = true
          await prisma.videoLocale.update({
            where: { id: `locale-${targetId}` },
            data: { updatedAt: new Date(Date.parse(cutoff) + 1_000) },
          })
        }
        return ingest(input)
      }
      const result = await runPrecomputedSource(
        { generationId, sourceVideoId: sourceId, inputCutoff: cutoff },
        { catalog, ingest: racingIngest, model: model() },
      )
      expect(changed).toBe(true)
      expect(result).toMatchObject({
        state: "failed",
        failureCode: "input_stale",
      })
      expect(
        await submitPrecomputedRecommendation(
          prisma,
          {
            action: "status",
            generationId,
            sourceVideoId: sourceId,
          },
          bearer,
        ),
      ).toMatchObject({
        state: "failed",
        source: { status: "failed", failureCode: "input_stale" },
      })
    })
  },
)
