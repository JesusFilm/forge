import { PrismaClient, type Prisma } from "@prisma/client"
import { createHash } from "node:crypto"
import { Client } from "pg"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { PrecomputedComparisonView } from "@/app/dashboard/recommendations/precomputed/view"
import {
  CURATED_POOL_POINTER_ID,
  CURATED_POOL_VALIDATION_VERSION,
} from "../curated-pools.types"
import { currentAdminMigrationSql } from "../current-schema.test-fixture"
import {
  loadPrecomputedRecommendationComparison as loadComparisonAuthorized,
  submitPrecomputedRecommendation as submitAuthorized,
} from "./contract"

function submitPrecomputedRecommendation(prisma: PrismaClient, input: unknown) {
  return submitAuthorized(prisma, input, "Bearer preview-test-key")
}

const reviewer = { id: "preview-operator", role: "ADMIN" } as const
function loadPrecomputedRecommendationComparison(
  prisma: PrismaClient,
  input: Omit<Parameters<typeof loadComparisonAuthorized>[1], "reviewer">,
) {
  return loadComparisonAuthorized(prisma, { ...input, reviewer })
}

// Approved ticket boundary: a producer build is observable through private
// Admin review, without any public Watch request or recommendation evidence.
describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "precomputed recommendation build to Admin review on PostgreSQL",
  () => {
    let prisma: PrismaClient
    let admin: Client
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const schema = `precomputed_preview_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const sourceVideoId = `preview-source-${suffix}`
    const sourceSetDigest = createHash("sha256")
      .update(JSON.stringify([sourceVideoId]))
      .digest("hex")
    const generationId = `preview-generation-${suffix}`
    const createdVideoIds = [sourceVideoId]
    const createdGenerationIds = [generationId]
    const muxIds: string[] = []
    const editionIds: string[] = []
    const curatedGenerationId = `curated-${suffix}`
    const audioLanguageId = `preview-language-${suffix}`
    const audioLanguageSlug = "english"

    async function createTarget(
      number: number,
      playable = true,
      published = true,
    ) {
      const videoId = `preview-target-${number}-${suffix}`
      createdVideoIds.push(videoId)
      await prisma.video.create({
        data: {
          id: videoId,
          coreId: `preview-target-core-${number}-${suffix}`,
          slug: videoId,
        },
      })
      await prisma.videoLocale.create({
        data: {
          id: `locale-${videoId}`,
          videoId,
          locale: "en",
          status: "PUBLISHED",
          title: `Distinct target ${number}`,
        },
      })
      if (playable) {
        const muxId = `mux-${videoId}`
        muxIds.push(muxId)
        await prisma.muxVideo.create({
          data: { id: muxId, playbackId: `playback-${number}` },
        })
        await prisma.videoDub.create({
          data: {
            id: `dub-${videoId}`,
            coreId: `dub-core-${videoId}`,
            videoId,
            languageId: audioLanguageId,
            muxVideoId: muxId,
            published,
          },
        })
      }
      return videoId
    }

    beforeAll(async () => {
      admin = new Client({ connectionString: env.DATABASE_URL })
      await admin.connect()
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`SET search_path TO "${schema}", public`)
      for (const migration of currentAdminMigrationSql) {
        await admin.query(migration)
      }
      const url = new URL(env.DATABASE_URL)
      url.searchParams.set("schema", schema)
      prisma = new PrismaClient<Prisma.PrismaClientOptions>({
        datasources: { db: { url: url.toString() } },
      })
      await prisma.video.create({
        data: {
          id: sourceVideoId,
          coreId: `preview-core-${suffix}`,
          slug: `preview-source-${suffix}`,
        },
      })
      await prisma.language.create({
        data: {
          id: audioLanguageId,
          coreId: `language-core-${suffix}`,
          slug: audioLanguageSlug,
        },
      })
    }, 120_000)

    afterAll(async () => {
      await prisma?.$disconnect()
      if (admin) {
        await admin.query("ROLLBACK").catch(() => undefined)
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
    })

    it("makes an explicit zero-connection source ready only after completion", async () => {
      await expect(
        submitAuthorized(prisma, { action: "start", generationId }, null),
      ).rejects.toMatchObject({ code: "unauthorized" })
      await expect(
        loadComparisonAuthorized(prisma, {
          generationId,
          sourceVideoId,
          audioLanguageSlug,
          reviewer: null,
        }),
      ).rejects.toMatchObject({ code: "unauthorized" })
      await submitPrecomputedRecommendation(prisma, {
        action: "start",
        generationId,
        modelId: "fixture",
        promptVersion: "preview-fixture-v1",
        inputDigest: "a".repeat(64),
        sourceSetDigest,
        inputCutoff: "2026-10-05T00:00:00.000Z",
        expectedSourceCount: 1,
      })
      await submitPrecomputedRecommendation(prisma, {
        action: "source",
        generationId,
        sourceVideoId,
        choices: [],
      })

      const incomplete = await loadPrecomputedRecommendationComparison(prisma, {
        generationId,
        sourceVideoId,
        audioLanguageSlug,
      })
      expect(incomplete.state).toBe("incomplete")

      await submitPrecomputedRecommendation(prisma, {
        action: "complete",
        generationId,
      })
      const ready = await loadPrecomputedRecommendationComparison(prisma, {
        generationId,
        sourceVideoId,
        audioLanguageSlug,
      })
      expect(ready).toMatchObject({
        state: "ready",
        experimental: [],
        coverageGap: "no_connections",
      })
    })

    it("records content-only provenance and each model call once across retries", async () => {
      const generation = `astra-usage-${suffix}`
      createdGenerationIds.push(generation)
      await submitPrecomputedRecommendation(prisma, {
        action: "start",
        generationId: generation,
        modelId: "gpt-6-astra",
        promptVersion: "source-v1",
        inputMode: "content_only",
        inputDigest: "a".repeat(64),
        sourceSetDigest,
        inputCutoff: new Date(Date.now() + 5_000).toISOString(),
        expectedSourceCount: 1,
      })
      const modelCall = {
        action: "model_call" as const,
        generationId: generation,
        sourceVideoId,
        callId: `call-${suffix}`,
        stage: "catalog_discovery",
        status: "succeeded",
        modelId: "gpt-6-astra",
        inputDigest: "b".repeat(64),
        outputDigest: "c".repeat(64),
        inputTokens: 120,
        outputTokens: 30,
        cachedInputTokens: 20,
        startedAt: "2026-10-05T00:00:01.000Z",
        finishedAt: "2026-10-05T00:00:02.000Z",
      }
      expect(
        (await submitPrecomputedRecommendation(prisma, modelCall)).replay,
      ).toBe(false)
      expect(
        (await submitPrecomputedRecommendation(prisma, modelCall)).replay,
      ).toBe(true)
      await expect(
        submitPrecomputedRecommendation(prisma, {
          ...modelCall,
          outputDigest: "d".repeat(64),
        }),
      ).rejects.toMatchObject({ code: "conflict" })
      await submitPrecomputedRecommendation(prisma, {
        action: "source",
        generationId: generation,
        sourceVideoId,
        choices: [],
      })
      await submitPrecomputedRecommendation(prisma, {
        action: "complete",
        generationId: generation,
      })
      expect(
        await submitPrecomputedRecommendation(prisma, {
          action: "status",
          generationId: generation,
          sourceVideoId,
        }),
      ).toMatchObject({
        state: "complete",
        inputMode: "content_only",
        source: { status: "complete", acceptedCount: 0 },
        usage: {
          callCount: 1,
          inputTokens: 120,
          outputTokens: 30,
          cachedInputTokens: 20,
        },
      })
      const comparison = await loadPrecomputedRecommendationComparison(prisma, {
        generationId: generation,
        sourceVideoId,
        audioLanguageSlug,
      })
      expect(comparison).toMatchObject({
        state: "ready",
        generation: { inputMode: "content_only" },
        usage: { callCount: 1, inputTokens: 120, outputTokens: 30 },
      })
    })

    it("reviews a completed usable GA navigation snapshot while retaining its unknown historical prefix", async () => {
      const generation = `ga-navigation-${suffix}`
      const cutoff = new Date(Date.now() + 5_000).toISOString()
      createdGenerationIds.push(generation)
      await submitPrecomputedRecommendation(prisma, {
        action: "start",
        generationId: generation,
        modelId: "gpt-6-astra",
        promptVersion: "astra-source-history-navigation-v1",
        inputMode: "historical_analytics",
        inputDigest: "a".repeat(64),
        sourceSetDigest,
        inputCutoff: cutoff,
        expectedSourceCount: 1,
      })
      const history = {
        provider: "ga_data_api",
        status: "complete",
        queryId: "watch-referrer-navigation-v1",
        rangeStart: "2022-08-06",
        rangeEnd: "2026-10-03",
        cutoff,
        identity: "current_catalog_watch_path",
        botFiltering: "unknown",
        measurement: "observed_events",
        overlap: "unknown",
        qualification: {
          evidenceKind: "referrer_navigation_v1",
          sourceResource: "properties/320198532",
          sourceAvailability: {
            coverage: "partial_source_history",
            requestedStart: "2020-01-01",
            requestedEnd: "2026-10-03",
            usableStart: "2022-08-06",
            usableEnd: "2026-10-03",
            truncationType: "DATA_TRUNCATION_TYPE_PROPERTY",
            truncationDate: "2022-08-05",
            unavailablePrefixStart: "2020-01-01",
            unavailablePrefixEnd: "2022-08-05",
            observedFirstMonth: "202208",
            observedLastMonth: "202610",
          },
          watchScope: {
            version: "jesusfilm-watch-v1",
            hosts: ["jesusfilm.org", "www.jesusfilm.org"],
            pathRule: "watch-route-and-children",
            eventName: "videostarts",
            includedEvents: 10,
            totalEvents: null,
            missingUrlEvents: null,
            malformedUrlEvents: null,
            excludedHostEvents: null,
            excludedPathEvents: null,
          },
          mediaComponentIdCoverage: {
            sourceDimension: "customEvent:mediacomponentid",
            inScopeEvents: 10,
            withMediaComponentIdEvents: 7,
            canonicalVideoMappedEvents: null,
          },
          engagement: {
            definitionVersion: "watch-videostarts-v1",
            botBasis: "unverified",
            overlapIdentity: "unknown",
            exposures: "unavailable",
          },
          transitions: {
            status: "unavailable",
            reason: "missing_session_identity",
          },
          navigation: {
            status: "available",
            definitionVersion: "watch-referrer-v1",
            basis: "same_event_page_referrer_to_page_path",
            interpretation: "navigation_not_playback_sequence",
            botBasis: "unverified",
            overlapIdentity: "unknown",
          },
          mapping: {
            basis: "current_catalog_cutoff_fenced",
            historicalOwnership: "unverified",
          },
        },
        navigationCoverage: {
          candidateEvents: 10,
          qualifiedEvents: 3,
          homeEvents: 1,
          selfEvents: 1,
          crossHostEvents: 1,
          malformedEvents: 1,
          unmappedEvents: 2,
          ambiguousEvents: 1,
        },
        rowCount: 2,
        catalogCandidates: 1,
        inspectedCandidates: 1,
        unmappedCandidates: 0,
        mappedRows: 1,
        unmappedRows: 1,
        pageCount: 2,
        queryExecutionCount: 2,
        queryUsageDigest: "b".repeat(64),
        resultDigest: "c".repeat(64),
        unmappedDigest: "d".repeat(64),
        bytesProcessed: null,
        costQualification: "unavailable",
      }
      await expect(
        submitPrecomputedRecommendation(prisma, {
          action: "history",
          generationId: generation,
          history: {
            ...history,
            navigationCoverage: {
              ...history.navigationCoverage,
              candidateEvents: 11,
            },
          },
        }),
      ).rejects.toMatchObject({ code: "invalid" })
      await expect(
        submitPrecomputedRecommendation(prisma, {
          action: "history",
          generationId: generation,
          history: {
            ...history,
            qualification: {
              ...history.qualification,
              sourceAvailability: {
                ...history.qualification.sourceAvailability,
                unavailablePrefixEnd: "2022-08-04",
              },
            },
          },
        }),
      ).rejects.toMatchObject({ code: "invalid" })
      await expect(
        submitPrecomputedRecommendation(prisma, {
          action: "history",
          generationId: generation,
          history: {
            ...history,
            qualification: {
              ...history.qualification,
              watchScope: {
                ...history.qualification.watchScope,
                totalEvents: 0,
              },
            },
          },
        }),
      ).rejects.toMatchObject({ code: "invalid" })
      await expect(
        submitPrecomputedRecommendation(prisma, {
          action: "history",
          generationId: generation,
          history,
        }),
      ).resolves.toMatchObject({ replay: false })
      await submitPrecomputedRecommendation(prisma, {
        action: "source",
        generationId: generation,
        sourceVideoId,
        choices: [],
      })
      await submitPrecomputedRecommendation(prisma, {
        action: "complete",
        generationId: generation,
      })
      const comparison = await loadPrecomputedRecommendationComparison(prisma, {
        generationId: generation,
        sourceVideoId,
        audioLanguageSlug,
      })
      expect(comparison).toMatchObject({
        state: "ready",
        history: {
          provider: "ga_data_api",
          qualification: {
            sourceAvailability: {
              coverage: "partial_source_history",
              requestedStart: "2020-01-01",
              usableStart: "2022-08-06",
            },
          },
        },
      })
      const html = renderToStaticMarkup(
        createElement(PrecomputedComparisonView, { comparison }),
      )
      expect(html).toContain("Usable snapshot complete")
      expect(html).toContain("full requested history 2020-01-01")
      expect(html).toContain("usable query interval 2022-08-06")
      expect(html).toContain("Unavailable historical prefix")
      expect(html).toContain(
        "navigation evidence, not a consecutive watched-video transition",
      )
      expect(html).toContain(
        "Current-catalog Watch path mapping has unverified historical ownership",
      )
      expect(html).toContain("These counts describe only queried rows")
    })

    it("records a failed source and prevents it from completing the generation", async () => {
      const generation = `astra-failed-${suffix}`
      createdGenerationIds.push(generation)
      await submitPrecomputedRecommendation(prisma, {
        action: "start",
        generationId: generation,
        modelId: "gpt-6-astra",
        promptVersion: "source-v1",
        inputMode: "content_only",
        inputDigest: "e".repeat(64),
        sourceSetDigest,
        inputCutoff: "2026-10-05T00:00:00.000Z",
        expectedSourceCount: 1,
      })
      await submitPrecomputedRecommendation(prisma, {
        action: "model_call",
        generationId: generation,
        sourceVideoId,
        callId: `failed-call-${suffix}`,
        stage: "candidate_judgment",
        status: "failed",
        modelId: "gpt-6-astra",
        inputDigest: "f".repeat(64),
        errorCode: "provider_invalid_output",
        startedAt: "2026-10-05T00:00:01.000Z",
        finishedAt: "2026-10-05T00:00:02.000Z",
      })
      await submitPrecomputedRecommendation(prisma, {
        action: "fail",
        generationId: generation,
        sourceVideoId,
        failureCode: "provider_invalid_output",
      })
      expect(
        await submitPrecomputedRecommendation(prisma, {
          action: "status",
          generationId: generation,
          sourceVideoId,
        }),
      ).toMatchObject({
        state: "failed",
        source: { status: "failed", failureCode: "provider_invalid_output" },
        usage: { callCount: 1, unknownUsageCallCount: 1 },
      })
      await expect(
        submitPrecomputedRecommendation(prisma, {
          action: "complete",
          generationId: generation,
        }),
      ).rejects.toMatchObject({ code: "conflict" })
    })

    it("completes a mixed-case source cohort using JavaScript ID ordering", async () => {
      const generation = `mixed-order-${suffix}`
      const sourceIds = ["video-a", "Video-B", "video_1", "video-2"].map(
        (name) => `${name}-${suffix}`,
      )
      createdGenerationIds.push(generation)
      createdVideoIds.push(...sourceIds)
      await prisma.video.createMany({
        data: sourceIds.map((videoId) => ({
          id: videoId,
          coreId: `core-${videoId}`,
          slug: videoId,
        })),
      })
      const sourceSetDigest = createHash("sha256")
        .update(JSON.stringify([...sourceIds].sort()))
        .digest("hex")
      await submitPrecomputedRecommendation(prisma, {
        action: "start",
        generationId: generation,
        modelId: "fixture",
        promptVersion: "preview-fixture-v1",
        inputDigest: "1".repeat(64),
        sourceSetDigest,
        inputCutoff: "2026-10-05T00:00:00.000Z",
        expectedSourceCount: sourceIds.length,
      })
      for (const sourceVideoId of [...sourceIds].reverse()) {
        await submitPrecomputedRecommendation(prisma, {
          action: "source",
          generationId: generation,
          sourceVideoId,
          choices: [],
        })
      }
      await expect(
        submitPrecomputedRecommendation(prisma, {
          action: "complete",
          generationId: generation,
        }),
      ).resolves.toMatchObject({ state: "complete", replay: false })
      expect(
        await prisma.recommendationPrecomputedSource.count({
          where: { generationId: generation },
        }),
      ).toBe(sourceIds.length)
    })

    it("retains every ranked connection while showing six playable choices and honest language gaps", async () => {
      const generation = `ranked-${suffix}`
      createdGenerationIds.push(generation)
      const targets = []
      for (let number = 1; number <= 8; number += 1) {
        targets.push(await createTarget(number, number !== 1))
      }
      await submitPrecomputedRecommendation(prisma, {
        action: "start",
        generationId: generation,
        modelId: "fixture",
        promptVersion: "preview-fixture-v1",
        inputDigest: "b".repeat(64),
        sourceSetDigest,
        inputCutoff: "2026-10-05T00:00:00.000Z",
        expectedSourceCount: 1,
      })
      await submitPrecomputedRecommendation(prisma, {
        action: "source",
        generationId: generation,
        sourceVideoId,
        choices: targets.map((targetVideoId, index) => ({
          targetVideoId,
          kind: index === 7 ? "alternative" : "direct",
          rank: index === 7 ? 1 : index + 1,
          relationship: "useful_next_watch",
          reasonEnglish: `The story continues with distinct topic number ${index + 1}.`,
          evidence: { basis: "metadata", fields: ["title"] },
        })),
      })
      await submitPrecomputedRecommendation(prisma, {
        action: "complete",
        generationId: generation,
      })
      const comparison = await loadPrecomputedRecommendationComparison(prisma, {
        generationId: generation,
        sourceVideoId,
        audioLanguageSlug,
      })
      expect(comparison).toMatchObject({
        state: "ready",
        allAcceptedCount: 8,
        gaps: [{ targetVideoId: targets[0], reason: "audio_unavailable" }],
      })
      expect(comparison.experimental).toHaveLength(6)
      expect(comparison.experimental[0]).toMatchObject({
        targetVideoId: targets[1],
        evidence: { basis: "metadata" },
      })
    })

    it("rejects invalid transcript references without making a partial source ready", async () => {
      const generation = `invalid-${suffix}`
      createdGenerationIds.push(generation)
      await submitPrecomputedRecommendation(prisma, {
        action: "start",
        generationId: generation,
        modelId: "fixture",
        promptVersion: "preview-fixture-v1",
        inputDigest: "c".repeat(64),
        sourceSetDigest,
        inputCutoff: "2026-10-05T00:00:00.000Z",
        expectedSourceCount: 1,
      })
      await expect(
        submitPrecomputedRecommendation(prisma, {
          action: "source",
          generationId: generation,
          sourceVideoId,
          choices: [
            {
              targetVideoId: createdVideoIds[1],
              kind: "direct",
              rank: 1,
              relationship: "more_like_this",
              reasonEnglish: "A similar story with a different perspective.",
              evidence: {
                basis: "transcript",
                passages: [
                  {
                    chunkId: "missing-chunk",
                    excerpt: "An invented supporting passage",
                  },
                ],
              },
            },
          ],
        }),
      ).rejects.toMatchObject({ code: "invalid" })
      await expect(
        submitPrecomputedRecommendation(prisma, {
          action: "complete",
          generationId: generation,
        }),
      ).rejects.toMatchObject({ code: "conflict" })
      expect(
        (
          await loadPrecomputedRecommendationComparison(prisma, {
            generationId: generation,
            sourceVideoId,
            audioLanguageSlug,
          })
        ).state,
      ).toBe("incomplete")
    })

    it("uses a saved alternative when the direct target has only an unpublished dub", async () => {
      const generation = `alternative-${suffix}`
      createdGenerationIds.push(generation)
      const directId = await createTarget(9, true, false)
      const alternativeId = await createTarget(10)
      await submitPrecomputedRecommendation(prisma, {
        action: "start",
        generationId: generation,
        modelId: "fixture",
        promptVersion: "preview-fixture-v1",
        inputDigest: "d".repeat(64),
        sourceSetDigest,
        inputCutoff: "2026-10-05T00:00:00.000Z",
        expectedSourceCount: 1,
      })
      await submitPrecomputedRecommendation(prisma, {
        action: "source",
        generationId: generation,
        sourceVideoId,
        choices: [
          {
            targetVideoId: directId,
            kind: "direct",
            rank: 1,
            relationship: "more_like_this",
            reasonEnglish: "This film addresses the same audience concern.",
            evidence: { basis: "metadata", fields: ["title"] },
          },
          {
            targetVideoId: alternativeId,
            kind: "alternative",
            rank: 1,
            relationship: "unexpected_connection",
            reasonEnglish:
              "This film gives a broader complementary perspective.",
            evidence: { basis: "metadata", fields: ["title"] },
          },
        ],
      })
      await submitPrecomputedRecommendation(prisma, {
        action: "complete",
        generationId: generation,
      })
      const comparison = await loadPrecomputedRecommendationComparison(prisma, {
        generationId: generation,
        sourceVideoId,
        audioLanguageSlug,
      })
      expect(comparison).toMatchObject({
        state: "ready",
        experimental: [{ targetVideoId: alternativeId, kind: "alternative" }],
        gaps: [{ targetVideoId: directId, reason: "audio_unavailable" }],
      })
    })

    it("normalizes start timestamps and accepts two concurrent identical starts", async () => {
      const generation = `concurrent-${suffix}`
      createdGenerationIds.push(generation)
      const input = {
        action: "start" as const,
        generationId: generation,
        modelId: "fixture",
        promptVersion: "preview-fixture-v1",
        inputDigest: "e".repeat(64),
        sourceSetDigest,
        inputCutoff: "2026-10-01T00:00:00Z",
        expectedSourceCount: 1,
      }
      const results = await Promise.all([
        submitPrecomputedRecommendation(prisma, input),
        submitPrecomputedRecommendation(prisma, input),
      ])
      expect(results.map((result) => result.replay).sort()).toEqual([
        false,
        true,
      ])
      expect(
        (await submitPrecomputedRecommendation(prisma, input)).replay,
      ).toBe(true)
    })

    it("refuses incomplete cohort identity atomically and records a failed build", async () => {
      const generation = `wrong-cohort-${suffix}`
      createdGenerationIds.push(generation)
      await submitPrecomputedRecommendation(prisma, {
        action: "start",
        generationId: generation,
        modelId: "fixture",
        promptVersion: "preview-fixture-v1",
        inputDigest: "2".repeat(64),
        sourceSetDigest: "0".repeat(64),
        inputCutoff: "2026-10-05T00:00:00.000Z",
        expectedSourceCount: 1,
      })
      await submitPrecomputedRecommendation(prisma, {
        action: "source",
        generationId: generation,
        sourceVideoId,
        choices: [],
      })
      await expect(
        submitPrecomputedRecommendation(prisma, {
          action: "complete",
          generationId: generation,
        }),
      ).rejects.toMatchObject({ code: "conflict" })
      expect(
        (
          await loadPrecomputedRecommendationComparison(prisma, {
            generationId: generation,
            sourceVideoId,
            audioLanguageSlug,
          })
        ).state,
      ).toBe("incomplete")
      await submitPrecomputedRecommendation(prisma, {
        action: "fail",
        generationId: generation,
      })
      expect(
        (
          await loadPrecomputedRecommendationComparison(prisma, {
            generationId: generation,
            sourceVideoId,
            audioLanguageSlug,
          })
        ).state,
      ).toBe("failed")
      expect(
        (
          await loadPrecomputedRecommendationComparison(prisma, {
            generationId,
            sourceVideoId,
            audioLanguageSlug,
          })
        ).state,
      ).toBe("ready")
    })

    it("excludes self and duplicate content but permits a chapter with added viewing value", async () => {
      const generation = `chapter-${suffix}`
      createdGenerationIds.push(generation)
      const chapterId = await createTarget(15)
      const duplicateId = await createTarget(16)
      await prisma.videoLocale.update({
        where: { id: `locale-${duplicateId}` },
        data: { title: "Distinct target 15" },
      })
      await prisma.videoRelation.create({
        data: {
          id: `relation-${suffix}`,
          parentId: sourceVideoId,
          childId: chapterId,
        },
      })
      await submitPrecomputedRecommendation(prisma, {
        action: "start",
        generationId: generation,
        modelId: "fixture",
        promptVersion: "preview-fixture-v1",
        inputDigest: "3".repeat(64),
        sourceSetDigest,
        inputCutoff: "2026-10-05T00:00:00.000Z",
        expectedSourceCount: 1,
      })
      const base = {
        kind: "direct" as const,
        rank: 1,
        relationship: "useful_next_watch",
        reasonEnglish: "The chapter gives a focused view of the larger story.",
        evidence: { basis: "metadata" as const, fields: ["title"] },
      }
      await expect(
        submitPrecomputedRecommendation(prisma, {
          action: "source",
          generationId: generation,
          sourceVideoId,
          choices: [{ ...base, targetVideoId: sourceVideoId }],
        }),
      ).rejects.toMatchObject({ code: "invalid" })
      await expect(
        submitPrecomputedRecommendation(prisma, {
          action: "source",
          generationId: generation,
          sourceVideoId,
          choices: [{ ...base, targetVideoId: chapterId }],
        }),
      ).rejects.toMatchObject({ code: "invalid" })
      await expect(
        submitPrecomputedRecommendation(prisma, {
          action: "source",
          generationId: generation,
          sourceVideoId,
          choices: [
            {
              ...base,
              targetVideoId: chapterId,
              addedViewingValueEnglish:
                "This focused chapter offers details absent from the full film.",
            },
            { ...base, targetVideoId: duplicateId, rank: 2 },
          ],
        }),
      ).rejects.toMatchObject({ code: "invalid" })
      await submitPrecomputedRecommendation(prisma, {
        action: "source",
        generationId: generation,
        sourceVideoId,
        choices: [
          {
            ...base,
            targetVideoId: chapterId,
            addedViewingValueEnglish:
              "This focused chapter offers details absent from the full film.",
          },
        ],
      })
      await submitPrecomputedRecommendation(prisma, {
        action: "complete",
        generationId: generation,
      })
      expect(
        (
          await loadPrecomputedRecommendationComparison(prisma, {
            generationId: generation,
            sourceVideoId,
            audioLanguageSlug,
          })
        ).experimental,
      ).toMatchObject([
        {
          targetVideoId: chapterId,
          addedViewingValueEnglish:
            "This focused chapter offers details absent from the full film.",
        },
      ])
    })

    it("accepts an identical source retry after the target catalog row disappears", async () => {
      const generation = `replay-${suffix}`
      createdGenerationIds.push(generation)
      const targetVideoId = await createTarget(11)
      await submitPrecomputedRecommendation(prisma, {
        action: "start",
        generationId: generation,
        modelId: "fixture",
        promptVersion: "preview-fixture-v1",
        inputDigest: "f".repeat(64),
        sourceSetDigest,
        inputCutoff: "2026-10-05T00:00:00.000Z",
        expectedSourceCount: 1,
      })
      const input = {
        action: "source" as const,
        generationId: generation,
        sourceVideoId,
        choices: [
          {
            targetVideoId,
            kind: "direct",
            rank: 1,
            relationship: "more_like_this",
            reasonEnglish: "This is another useful story about the same topic.",
            evidence: { basis: "metadata", fields: ["title"] },
          },
        ],
      }
      expect(
        (await submitPrecomputedRecommendation(prisma, input)).replay,
      ).toBe(false)
      await prisma.video.delete({ where: { id: targetVideoId } })
      expect(
        (await submitPrecomputedRecommendation(prisma, input)).replay,
      ).toBe(true)
      await expect(
        submitPrecomputedRecommendation(prisma, {
          ...input,
          choices: [
            {
              ...input.choices[0],
              reasonEnglish: "A different reason on a conflicting retry.",
            },
          ],
        }),
      ).rejects.toMatchObject({ code: "conflict" })
    })

    it("preserves a non-English supporting passage with an English reason", async () => {
      const generation = `spanish-evidence-${suffix}`
      createdGenerationIds.push(generation)
      const targetVideoId = await createTarget(12)
      const editionId = `edition-${suffix}`
      editionIds.push(editionId)
      await prisma.videoEdition.create({
        data: {
          id: editionId,
          coreId: `edition-core-${suffix}`,
          name: "Spanish source",
        },
      })
      const transcriptId = `transcript-${suffix}`
      await prisma.videoTranscript.create({
        data: {
          id: transcriptId,
          videoEditionId: editionId,
          videoId: targetVideoId,
          language: "es",
          model: "fixture",
          dimensions: 1536,
          chunkingType: "fixture",
          maxChunkTokens: 100,
          overlapTokens: 0,
          totalChunks: 1,
          totalTokens: 10,
          generatedAt: new Date("2026-10-05T00:00:00Z"),
        },
      })
      const excerpt = "Una historia de esperanza para todos"
      const chunkId = `spanish-chunk-${suffix}`
      await prisma.videoTranscriptChunk.create({
        data: {
          id: chunkId,
          transcriptId,
          language: "es",
          chunkIndex: 0,
          chunkId: "chunk-0",
          text: `${excerpt} en tiempos difíciles.`,
          rawSourceText: `${excerpt} en tiempos difíciles.`,
          tokenCount: 10,
        },
      })
      await submitPrecomputedRecommendation(prisma, {
        action: "start",
        generationId: generation,
        modelId: "fixture",
        promptVersion: "preview-fixture-v1",
        inputDigest: "1".repeat(64),
        sourceSetDigest,
        inputCutoff: "2026-10-05T00:00:00.000Z",
        expectedSourceCount: 1,
      })
      await submitPrecomputedRecommendation(prisma, {
        action: "source",
        generationId: generation,
        sourceVideoId,
        choices: [
          {
            targetVideoId,
            kind: "direct",
            rank: 1,
            relationship: "useful_next_watch",
            reasonEnglish: "This Spanish passage explores hope in hardship.",
            evidence: { basis: "transcript", passages: [{ chunkId, excerpt }] },
          },
        ],
      })
      await submitPrecomputedRecommendation(prisma, {
        action: "complete",
        generationId: generation,
      })
      const comparison = await loadPrecomputedRecommendationComparison(prisma, {
        generationId: generation,
        sourceVideoId,
        audioLanguageSlug,
      })
      expect(comparison.experimental).toMatchObject([
        {
          targetVideoId,
          reasonEnglish: "This Spanish passage explores hope in hardship.",
          evidence: {
            basis: "transcript",
            passages: [{ chunkId, language: "es", excerpt }],
          },
        },
      ])
    })

    it("shows anonymous curated recovery when semantic retrieval has no seed embedding", async () => {
      const generation = `contextual-${suffix}`
      createdGenerationIds.push(generation)
      const targetVideoId = await createTarget(14)
      await prisma.videoImage.create({
        data: {
          id: `image-${targetVideoId}`,
          videoId: targetVideoId,
          url: "https://example.com/curated.jpg",
        },
      })
      await prisma.recommendationCuratedGeneration.create({
        data: {
          id: curatedGenerationId,
          version: curatedGenerationId,
          sourceDigest: "8".repeat(64),
          validationVersion: CURATED_POOL_VALIDATION_VERSION,
          sourceManifest: {},
          coverageReport: { passed: true },
        },
      })
      await prisma.recommendationCuratedPool.create({
        data: {
          generationId: curatedGenerationId,
          locale: "en",
          audioLanguageSlug,
          coreLanguageId: `language-core-${suffix}`,
          poolKey: "start",
          videoIds: [targetVideoId],
        },
      })
      await prisma.recommendationCuratedMembership.create({
        data: {
          generationId: curatedGenerationId,
          videoId: targetVideoId,
          coreVideoId: `preview-target-core-14-${suffix}`,
          themeKeys: [],
          editorialRank: 1,
          metadata: {},
        },
      })
      await prisma.recommendationCuratedGeneration.update({
        where: { id: curatedGenerationId },
        data: { sealedAt: new Date() },
      })
      await prisma.recommendationCuratedPointer.create({
        data: {
          id: CURATED_POOL_POINTER_ID,
          generationId: curatedGenerationId,
        },
      })
      await submitPrecomputedRecommendation(prisma, {
        action: "start",
        generationId: generation,
        modelId: "fixture",
        promptVersion: "preview-fixture-v1",
        inputDigest: "9".repeat(64),
        sourceSetDigest,
        inputCutoff: "2026-10-05T00:00:00.000Z",
        expectedSourceCount: 1,
      })
      await submitPrecomputedRecommendation(prisma, {
        action: "source",
        generationId: generation,
        sourceVideoId,
        choices: [],
      })
      await submitPrecomputedRecommendation(prisma, {
        action: "complete",
        generationId: generation,
      })
      const comparison = await loadPrecomputedRecommendationComparison(prisma, {
        generationId: generation,
        sourceVideoId,
        audioLanguageSlug,
      })
      expect(comparison).toMatchObject({
        state: "ready",
        semanticBaselineState: "unavailable",
        anonymousBaselineState: "available",
        anonymousBaseline: [
          { videoId: targetVideoId, videoTitle: "Distinct target 14" },
        ],
        experimental: [],
        coverageGap: "no_connections",
      })
    })
  },
)
