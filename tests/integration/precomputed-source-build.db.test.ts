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

const bearer = "Bearer preview-test-key"
const reviewer = { id: "preview-operator", role: "ADMIN" } as const

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "controlled Astra output through native Admin persistence",
  () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const schema = `precomputed_producer_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const sourceId = `a-source-${suffix}`
    const targetId = `b-target-${suffix}`
    const metadataId = `c-metadata-${suffix}`
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
          data: { id, coreId: `core-${id}`, slug: id },
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
