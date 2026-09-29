import { createHash, randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { RECOMMENDATION_INTEGRITY_POLICY_VERSION } from "../integrity-policy"
import { recommendationManifestDigest } from "../promotion/manifest"
import { COWATCH_SHADOW_GENERATOR_KEY } from "./graph"
import { loadCowatchInspection } from "./inspection.service"
import {
  createDatabaseCowatchLiveSource,
  type CowatchLiveContext,
} from "./live.service"
import { publishCowatchShadowGeneration } from "./projection.service"
import { suppressCowatchForProfiles } from "./privacy"
import {
  COWATCH_FROZEN_TRIAL_MODE,
  qualifyCowatchTrialAuthority,
  readCowatchTrialAuthority,
  type CowatchTrialBinding,
} from "./trial-authority.service"

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex")
const day = 86_400_000
const enabled = env.RECOMMENDATION_DB_TEST === "1"

describe.skipIf(!enabled)(
  "frozen co-watch authority on owned PostgreSQL",
  () => {
    let prisma: PrismaClient
    const observedQueries: string[] = []
    let observeQueries = false
    const prefix = `trial-${randomUUID()}`
    const graphIds: string[] = []
    let ordinal = 0
    beforeAll(() => {
      const url = new URL(env.DATABASE_URL)
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/forge_feat565_test"
      )
        throw new Error(
          "Frozen trial native tests require the owned local forge_feat565_test fixture",
        )
      const client = new PrismaClient({
        log: [{ emit: "event", level: "query" }],
        adapter: new PrismaPg({ connectionString: env.DATABASE_URL, max: 4 }),
      })
      client.$on("query", (event) => {
        if (observeQueries) observedQueries.push(event.query)
      })
      prisma = client
    })
    afterAll(async () => {
      if (!prisma) return
      await prisma.recommendationCowatchGeneration.deleteMany({
        where: { id: { in: graphIds } },
      })
      await prisma.recommendationPlaybackEpisode.deleteMany({
        where: { id: { startsWith: prefix } },
      })
      await prisma.recommendationProfile.deleteMany({
        where: { id: { startsWith: prefix } },
      })
      await prisma.video.deleteMany({ where: { id: { startsWith: prefix } } })
      await prisma.videoEdition.deleteMany({
        where: { id: { startsWith: prefix } },
      })
      await prisma.muxVideo.deleteMany({
        where: { id: { startsWith: prefix } },
      })
      await prisma.language.deleteMany({
        where: { id: { startsWith: prefix } },
      })
      await prisma.$disconnect()
    })
    async function fixture(
      linkedProfile = true,
      options: { profileLifetimeMs?: number; negativeEpisode?: boolean } = {},
    ) {
      const id = `${prefix}-${ordinal++}`
      const created = new Date()
      const start = new Date(created.getTime() - 10 * day + ordinal * 3_600_000)
      const expiresAt = new Date(created.getTime() + 20 * day)
      const mediaA = `${id}-A`,
        mediaB = `${id}-B`,
        mediaC = `${id}-C`
      const profileId = `${id}-profile`
      await prisma.recommendationProfile.create({
        data: {
          id: profileId,
          privacyGeneration: 1,
          tokenDigest: digest(profileId),
          choice: "DURABLE_ALLOWED",
          expiresAt: new Date(
            created.getTime() + (options.profileLifetimeMs ?? 20 * day),
          ),
        },
      })
      if (linkedProfile)
        await prisma.recommendationProfileSessionLink.create({
          data: {
            profileId,
            privacyGeneration: 1,
            sessionDigest: digest(`${id}-viewer-0`),
            expiresAt: new Date(created.getTime() + 60_000),
          },
        })
      const episodes: string[] = []
      for (let viewer = 0; viewer < 10; viewer++) {
        for (const [index, mediaId] of (viewer < 5
          ? [mediaA, mediaB]
          : [mediaC]
        ).entries()) {
          const episodeId = `${id}-episode-${viewer}-${index}`
          const qualifiedView = !(
            options.negativeEpisode &&
            viewer === 0 &&
            index === 1
          )
          const occurredAt = new Date(start.getTime() + index * 1_000)
          episodes.push(episodeId)
          await prisma.recommendationPlaybackEpisode.create({
            data: {
              id: episodeId,
              mediaId,
              sessionDigest: digest(`${id}-viewer-${viewer}`),
              state: "FINALIZED",
              nextFactSequence: 2,
              activeUntil: new Date(created.getTime() + day),
              hardUntil: new Date(created.getTime() + 2 * day),
              finalizedAt: occurredAt,
              claimedAt: occurredAt,
              createdAt: occurredAt,
              expiresAt,
            },
          })
          await prisma.recommendationOutcomeRevision.create({
            data: {
              id: `${episodeId}-r1`,
              episodeId,
              classifierVersion: "active-watch-proxy-v1",
              factWatermark: 1,
              inputDigest: digest(episodeId),
              revision: 1,
              qualifiedView,
              viewQualityWeight: 1,
              viewQualityWeightReason: "active_fraction_of_duration",
              activePlaybackMilliseconds: 30_000,
              durationSeconds: 30,
              durationCohort: "short",
              activeCoverage: "complete",
              generation: 1,
              createdAt: occurredAt,
              expiresAt,
            },
          })
          await prisma.recommendationEligibilityDecision.create({
            data: {
              id: `${episodeId}-eligible`,
              sourceType: "PLAYBACK_OUTCOME",
              sourceKey: episodeId,
              outcomeId: `${episodeId}-r1`,
              policyVersion: RECOMMENDATION_INTEGRITY_POLICY_VERSION,
              revision: 1,
              actorClass: "HUMAN_SIGNED_IN",
              state: "ELIGIBLE",
              eligibleScopes: ["aggregate", "profile"],
              contributionWeight: 1,
              contributionOrdinal: 1,
              distinctSupport: 10,
              identityConcentration: 0.1,
              inputDigest: digest(`${episodeId}-eligible`),
              expiresAt,
            },
          })
        }
      }
      const sourceWindow = {
        version: "episode-event-window-v1" as const,
        windowStart: start,
        windowEnd: new Date(start.getTime() + 3_600_000),
        evaluationAsOf: created,
      }
      const publication = await publishCowatchShadowGeneration(
        prisma,
        created,
        sourceWindow,
      )
      expect(publication.status).toBe("published")
      const graphGenerationId = publication.generation!
      graphIds.push(graphGenerationId)
      const now = new Date(publication.publishedAt!.getTime() + 1_000)
      const manifestId = `${id}-manifest`
      const manifest = await prisma.recommendationStrategyManifest.create({
        data: {
          id: manifestId,
          strategyVersion: id.slice(-60),
          contractVersion: "test",
          surfaceVersion: "watch-below-player-v1",
          generator: "hybrid",
          maxItems: 6,
        },
      })
      const shadowEvaluationId = `${id}-evaluation`,
        shadowDecisionId = `${id}-decision`
      await prisma.recommendationShadowEvaluation.create({
        data: {
          id: shadowEvaluationId,
          manifestId,
          cowatchGenerationId: graphGenerationId,
          generatorVersion: COWATCH_SHADOW_GENERATOR_KEY,
          samplingVersion: "fixture",
          contextVersion: "fixture",
          eligibilityVersion: "fixture",
          retentionPolicyVersion: "fixture",
          windowStart: sourceWindow.windowStart,
          windowEnd: sourceWindow.windowEnd,
          requestedSampleSize: 1,
          createdAt: now,
          expiresAt,
        },
      })
      await prisma.recommendationShadowDecision.create({
        data: {
          id: shadowDecisionId,
          evaluationId: shadowEvaluationId,
          decision: "PROMOTE_TO_EXPERIMENT",
          reasonCode: "synthetic_native_fixture",
          reevaluationCondition: "test fixture only",
          inputDigest: digest(shadowEvaluationId),
          decidedAt: now,
          expiresAt,
        },
      })
      await prisma.recommendationShadowEvaluation.update({
        where: { id: shadowEvaluationId },
        data: { state: "TERMINAL" },
      })
      const binding: CowatchTrialBinding = {
        mode: COWATCH_FROZEN_TRIAL_MODE,
        studyId: `${id}-study`,
        experimentGeneration: 1,
        protocolDigest: digest(`${id}-protocol`),
        manifestId,
        manifestDigest: recommendationManifestDigest(manifest),
        graphGenerationId,
        sourceWindow,
        calibrationCompletedAt: new Date(created.getTime() - 1),
        enrollmentEnd: new Date(now.getTime() + 3 * day),
        trialValidUntil: new Date(now.getTime() + 3 * day + 30 * 3_600_000),
        shadowEvaluationId,
        shadowDecisionId,
      }
      const context: CowatchLiveContext = {
        seedMediaId: mediaA,
        locale: "en",
        audioLanguageSlug: `${id}-audio`,
        profileProjectionId: null,
        requestContextDigest: digest(`${id}-context`),
        deadlineAt: Date.now() + 2_000,
      }
      return {
        id,
        now,
        expiresAt,
        mediaA,
        mediaB,
        mediaC,
        profileId,
        episodes,
        binding,
        context,
      }
    }
    async function reclassify(episodeId: string, createdAt: Date) {
      const original =
        await prisma.recommendationOutcomeRevision.findUniqueOrThrow({
          where: { id: `${episodeId}-r1` },
        })
      const eligibility =
        await prisma.recommendationEligibilityDecision.findUniqueOrThrow({
          where: { id: `${episodeId}-eligible` },
        })
      const outcomeId = `${episodeId}-r2`
      await prisma.recommendationOutcomeRevision.create({
        data: {
          ...original,
          id: outcomeId,
          revision: 2,
          supersedesId: original.id,
          qualifiedView: true,
          activeIntervals: undefined,
          inputDigest: digest(outcomeId),
          createdAt,
        },
      })
      await prisma.recommendationEligibilityDecision.update({
        where: { id: eligibility.id },
        data: { isCurrent: false },
      })
      await prisma.recommendationEligibilityDecision.create({
        data: {
          ...eligibility,
          id: `${episodeId}-eligible-r2`,
          outcomeId,
          revision: 2,
          inputDigest: digest(`${outcomeId}-eligible`),
        },
      })
      return outcomeId
    }
    async function playable(f: Awaited<ReturnType<typeof fixture>>) {
      await prisma.language.create({
        data: {
          id: `${f.id}-lang`,
          coreId: `${f.id}-lang`,
          slug: f.context.audioLanguageSlug,
        },
      })
      await prisma.video.create({
        data: { id: f.mediaB, coreId: f.mediaB, slug: f.mediaB },
      })
      await prisma.videoLocale.create({
        data: {
          id: `${f.id}-locale`,
          videoId: f.mediaB,
          locale: "en",
          title: "Current target",
          languageSlug: f.context.audioLanguageSlug,
          status: "PUBLISHED",
        },
      })
      await prisma.muxVideo.create({
        data: { id: `${f.id}-mux`, playbackId: `${f.id}-playback` },
      })
      await prisma.videoEdition.create({
        data: {
          id: `${f.id}-edition`,
          coreId: `${f.id}-edition`,
          name: "Fixture edition",
        },
      })
      const pointer =
        await prisma.contentEmbeddingContractPointer.findUniqueOrThrow({
          where: { id: "content-embedding-contract-pointer" },
          include: { activeContract: true },
        })
      const contract = pointer.activeContract!
      await prisma.videoTranscript.create({
        data: {
          id: `${f.id}-transcript`,
          videoEditionId: `${f.id}-edition`,
          videoId: f.mediaB,
          language: "en",
          model: contract.storageModel,
          dimensions: contract.storageDimensions,
          embeddingProvider: contract.storageProvider,
          embeddingNativeDimensions: contract.storageNativeDimensions,
          embeddingTransformVersion: contract.storageTransformVersion,
          chunkingType: "fixture",
          maxChunkTokens: 100,
          overlapTokens: 0,
          totalChunks: 1,
          totalTokens: 10,
          generatedAt: f.now,
        },
      })
      await prisma.videoTranscriptChunk.create({
        data: {
          id: `${f.id}-chunk`,
          transcriptId: `${f.id}-transcript`,
          language: "en",
          chunkIndex: 0,
          chunkId: "first",
          text: "Current published transcript",
          tokenCount: 10,
          model: contract.storageModel,
          dimensions: contract.storageDimensions,
          feltNeeds: [
            "hope",
            ...Array.from(
              { length: 18 },
              (_, index) => `theme-${index}-${"x".repeat(80)}`,
            ),
          ],
        },
      })
      await prisma.videoDub.create({
        data: {
          id: `${f.id}-dub`,
          coreId: `${f.id}-dub`,
          videoId: f.mediaB,
          videoEditionId: `${f.id}-edition`,
          languageId: `${f.id}-lang`,
          muxVideoId: `${f.id}-mux`,
          published: true,
          duration: 120,
        },
      })
    }
    async function qualify(f: Awaited<ReturnType<typeof fixture>>) {
      const result = await qualifyCowatchTrialAuthority(
        prisma,
        f.binding,
        f.now,
      )
      expect(result.status).toBe("qualified")
      return result
    }
    it("qualifies exact fresh evidence once and keeps ordinary 24h freshness separate", async () => {
      const f = await fixture()
      expect(
        await readCowatchTrialAuthority(prisma, f.binding, f.now),
      ).toMatchObject({
        status: "refused",
        reason: "cowatch_authority_unqualified",
      })
      await qualify(f)
      expect(
        (await qualifyCowatchTrialAuthority(prisma, f.binding, f.now)).status,
      ).toBe("unchanged")
      const later = new Date(f.now.getTime() + 25 * 3_600_000)
      expect(
        (
          await loadCowatchInspection(prisma, {
            generationId: f.binding.graphGenerationId,
            sourceMediaId: f.mediaA,
            now: later,
          })
        ).staleReasons,
      ).toContain("generation_stale")
      expect(
        (await readCowatchTrialAuthority(prisma, f.binding, later)).status,
      ).toBe("current")
      expect(
        await qualifyCowatchTrialAuthority(
          prisma,
          { ...f.binding, protocolDigest: digest("changed") },
          f.now,
        ),
      ).toMatchObject({
        status: "refused",
        reason: "cowatch_authority_mismatch",
      })
      expect(
        await readCowatchTrialAuthority(
          prisma,
          { ...f.binding, manifestDigest: digest("changed") },
          f.now,
        ),
      ).toMatchObject({
        status: "refused",
        reason: "cowatch_authority_mismatch",
      })
      expect(
        await readCowatchTrialAuthority(
          prisma,
          f.binding,
          f.binding.trialValidUntil,
        ),
      ).toMatchObject({ status: "refused", reason: "cowatch_trial_expired" })
    })
    it("retains first source revocation for retrospective analysis after graph deletion", async () => {
      const f = await fixture(false)
      // The shared fixture places shadow evidence 1s after publication; let the
      // DB clock reach it before proving real revocation timestamp ordering.
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, f.now.getTime() - Date.now())),
      )
      await qualify(f)
      const mutationStarted = new Date()
      await prisma.recommendationPlaybackEpisode.update({
        where: { id: f.episodes.at(-1)! },
        data: { conflictCount: 1 },
      })
      const graph =
        await prisma.recommendationCowatchGeneration.findUniqueOrThrow({
          where: { id: f.binding.graphGenerationId },
        })
      const first =
        await prisma.recommendationCowatchTrialAuthority.findUniqueOrThrow({
          where: { generationId: f.binding.graphGenerationId },
        })
      expect(first.revokedAt).toEqual(graph.invalidatedAt)
      expect(first.revokedAt!.getTime()).toBeGreaterThanOrEqual(
        mutationStarted.getTime(),
      )
      expect(first.revokedAt!.getTime()).toBeLessThanOrEqual(Date.now())
      expect(first.revokedAt!.getTime()).toBeLessThan(
        f.binding.trialValidUntil.getTime(),
      )
      await prisma.recommendationPlaybackEpisode.update({
        where: { id: f.episodes.at(-1)! },
        data: { conflictCount: 2 },
      })
      await prisma.recommendationCowatchGeneration.delete({
        where: { id: f.binding.graphGenerationId },
      })
      const analysisAt = new Date(f.binding.trialValidUntil.getTime() + day)
      const retained =
        await prisma.recommendationCowatchTrialAuthority.findUniqueOrThrow({
          where: { generationId: f.binding.graphGenerationId },
        })
      expect(retained).toEqual(first)
      expect(retained.rawPopulationExpiresAt.getTime()).toBeGreaterThan(
        analysisAt.getTime(),
      )
      // This is the retained timestamp U4 compares to the original trial horizon,
      // independent of whether the graph still exists when analysis runs.
      expect(retained.revokedAt! <= f.binding.trialValidUntil).toBe(true)
      await expect(
        prisma.recommendationCowatchTrialAuthority.update({
          where: { generationId: f.binding.graphGenerationId },
          data: { revokedAt: analysisAt },
        }),
      ).rejects.toThrow(
        "co-watch trial qualification cannot be renewed or changed",
      )
    })
    it("retains one-use authority across deletion and exact same-ID republish", async () => {
      const f = await fixture(false)
      await qualify(f)
      await prisma.recommendationCowatchGeneration.delete({
        where: { id: f.binding.graphGenerationId },
      })
      expect(
        await readCowatchTrialAuthority(prisma, f.binding, f.now),
      ).toMatchObject({
        status: "refused",
        reason: "cowatch_generation_unavailable",
      })
      expect(
        (
          await publishCowatchShadowGeneration(
            prisma,
            f.now,
            f.binding.sourceWindow,
          )
        ).generation,
      ).toBe(f.binding.graphGenerationId)
      expect(
        await qualifyCowatchTrialAuthority(prisma, f.binding, f.now),
      ).toMatchObject({
        status: "refused",
        reason: "cowatch_generation_invalidated",
      })
      expect(
        await readCowatchTrialAuthority(prisma, f.binding, f.now),
      ).toMatchObject({
        status: "refused",
        reason: "cowatch_generation_invalidated",
      })
    })
    it("refuses the exact earliest expiry boundary and unrelated evidence", async () => {
      const f = await fixture()
      const tooLong = {
        ...f.binding,
        trialValidUntil: f.expiresAt,
        enrollmentEnd: new Date(f.expiresAt.getTime() - 30 * 3_600_000),
      }
      expect(
        await qualifyCowatchTrialAuthority(prisma, tooLong, f.now),
      ).toMatchObject({
        status: "refused",
        reason: "cowatch_dependency_expiry_insufficient",
      })
      expect(
        await qualifyCowatchTrialAuthority(
          prisma,
          { ...f.binding, shadowDecisionId: "wrong" },
          f.now,
        ),
      ).toMatchObject({
        status: "refused",
        reason: "cowatch_shadow_evidence_invalid",
      })
      await expect(
        prisma.recommendationShadowEvaluation.update({
          where: { id: f.binding.shadowEvaluationId },
          data: { cowatchGenerationId: digest("wrong") },
        }),
      ).rejects.toThrow()
      await qualify(f)
    })
    it.each(["source", "graph", "outcome"] as const)(
      "does not anonymize episodes after %s lineage deletion and link cleanup",
      async (kind) => {
        const f = await fixture()
        await qualify(f)
        await prisma.recommendationProfileSessionLink.deleteMany({
          where: { profileId: f.profileId },
        })
        const outcomeId = `${f.episodes[0]}-r1`
        const original =
          await prisma.recommendationOutcomeRevision.findUniqueOrThrow({
            where: { id: outcomeId },
          })
        const eligibility =
          await prisma.recommendationEligibilityDecision.findUniqueOrThrow({
            where: { id: `${f.episodes[0]}-eligible` },
          })
        if (kind === "source")
          await prisma.recommendationCowatchSourceContribution.deleteMany({
            where: { generationId: f.binding.graphGenerationId, outcomeId },
          })
        else if (kind === "graph")
          await prisma.recommendationCowatchGeneration.delete({
            where: { id: f.binding.graphGenerationId },
          })
        else {
          await prisma.recommendationOutcomeRevision.delete({
            where: { id: outcomeId },
          })
          await prisma.recommendationOutcomeRevision.create({
            data: {
              ...original,
              id: `${outcomeId}-reclassified`,
              revision: 2,
              activeIntervals: undefined,
              inputDigest: digest(`${outcomeId}-reclassified`),
              createdAt: original.createdAt,
            },
          })
          await prisma.recommendationEligibilityDecision.create({
            data: {
              ...eligibility,
              id: `${eligibility.id}-reclassified`,
              outcomeId: `${outcomeId}-reclassified`,
              revision: 2,
              inputDigest: digest(`${eligibility.id}-reclassified`),
            },
          })
        }
        expect(
          await prisma.recommendationCowatchSuppression.count({
            where: { episodeId: f.episodes[0] },
          }),
        ).toBe(1)
        const rebuilt = await publishCowatchShadowGeneration(
          prisma,
          f.now,
          f.binding.sourceWindow,
        )
        graphIds.push(rebuilt.generation!)
        expect(rebuilt.sourceCount).toBe(13)
        expect(
          await prisma.recommendationCowatchSourceContribution.count({
            where: {
              generationId: rebuilt.generation!,
              outcome: { episodeId: f.episodes[0] },
            },
          }),
        ).toBe(0)
        expect(
          (
            await publishCowatchShadowGeneration(
              prisma,
              f.now,
              f.binding.sourceWindow,
            )
          ).generation,
        ).toBe(rebuilt.generation)
      },
    )
    it("prevents in-place source ownership or expiry changes", async () => {
      const f = await fixture()
      const source =
        await prisma.recommendationCowatchSourceContribution.findUniqueOrThrow({
          where: {
            generationId_outcomeId: {
              generationId: f.binding.graphGenerationId,
              outcomeId: `${f.episodes[0]}-r1`,
            },
          },
        })
      await expect(
        prisma.recommendationCowatchSourceContribution.update({
          where: { id: source.id },
          data: { viewerProfileId: null, viewerPrivacyGeneration: null },
        }),
      ).rejects.toThrow("co-watch source lineage is append only")
      await expect(
        prisma.recommendationCowatchSourceContribution.update({
          where: { id: source.id },
          data: { expiresAt: new Date(source.expiresAt.getTime() - day) },
        }),
      ).rejects.toThrow("co-watch source lineage is append only")
      expect(
        await prisma.recommendationCowatchSourceContribution.findUniqueOrThrow({
          where: { id: source.id },
        }),
      ).toMatchObject({
        viewerProfileId: f.profileId,
        expiresAt: source.expiresAt,
      })
    })
    it.each([false, true])(
      "recovers retained ownership after link cleanup when previously negative is %s",
      async (negativeEpisode) => {
        const f = await fixture(true, { negativeEpisode })
        await prisma.recommendationProfileSessionLink.deleteMany({
          where: { profileId: f.profileId },
        })
        const episodeId = f.episodes[1]
        const outcomeId = await reclassify(episodeId, f.now)
        const rebuilt = await publishCowatchShadowGeneration(prisma, f.now, {
          ...f.binding.sourceWindow,
          evaluationAsOf: f.now,
        })
        graphIds.push(rebuilt.generation!)
        expect(rebuilt.sourceCount).toBe(15)
        expect(
          await prisma.recommendationCowatchSourceContribution.findUniqueOrThrow(
            {
              where: {
                generationId_outcomeId: {
                  generationId: rebuilt.generation!,
                  outcomeId,
                },
              },
            },
          ),
        ).toMatchObject({
          viewerProfileId: f.profileId,
          viewerPrivacyGeneration: 1,
        })
      },
    )
    it("excludes passive expired retained ownership instead of converting it to anonymous", async () => {
      const f = await fixture(true, { profileLifetimeMs: 3_600_000 })
      await prisma.recommendationProfileSessionLink.deleteMany({
        where: { profileId: f.profileId },
      })
      const rebuilt = await publishCowatchShadowGeneration(
        prisma,
        new Date(f.now.getTime() + 2 * 3_600_000),
        f.binding.sourceWindow,
      )
      graphIds.push(rebuilt.generation!)
      expect(rebuilt.sourceCount).toBe(13)
      expect(
        await prisma.recommendationCowatchSourceContribution.count({
          where: {
            generationId: rebuilt.generation!,
            outcome: { episodeId: { in: f.episodes.slice(0, 2) } },
          },
        }),
      ).toBe(0)
    })
    it.each(["reset", "service", "source-delete"] as const)(
      "preserves exact episode ownership across a session change during %s",
      async (mode) => {
        const f = await fixture()
        await prisma.recommendationProfileSessionLink.deleteMany({
          where: { profileId: f.profileId },
        })
        await prisma.recommendationPlaybackEpisode.update({
          where: { id: f.episodes[0] },
          data: { sessionDigest: digest(`${f.id}-changed-session`) },
        })
        if (mode === "reset")
          await prisma.recommendationProfile.update({
            where: { id: f.profileId },
            data: { privacyGeneration: 2 },
          })
        else if (mode === "service")
          await prisma.$transaction((tx) =>
            suppressCowatchForProfiles(tx, [f.profileId]),
          )
        else
          await prisma.recommendationCowatchSourceContribution.deleteMany({
            where: { outcomeId: `${f.episodes[0]}-r1` },
          })
        const rebuilt = await publishCowatchShadowGeneration(
          prisma,
          f.now,
          f.binding.sourceWindow,
        )
        graphIds.push(rebuilt.generation!)
        expect(rebuilt.sourceCount).toBe(13)
        expect(
          await prisma.recommendationCowatchSuppression.count({
            where: { episodeId: { in: f.episodes.slice(0, 2) } },
          }),
        ).toBe(2)
      },
    )
    it("suppresses previously negative session episodes when cleanup and reclassification race with reset", async () => {
      const f = await fixture(true, { negativeEpisode: true })
      const gate = new Client({ connectionString: env.DATABASE_URL })
      const cleaner = new Client({
        connectionString: env.DATABASE_URL,
        application_name: `${f.id}-cleaner`,
      })
      await gate.connect()
      await cleaner.connect()
      let cleanup: Promise<unknown> | undefined
      let correction: Promise<unknown> | undefined
      try {
        await gate.query("BEGIN")
        await gate.query(
          "SELECT id FROM recommendation_cowatch_generation WHERE id = $1 FOR UPDATE",
          [f.binding.graphGenerationId],
        )
        // A link-cleanup transaction removes the discovery row, then waits on
        // the graph while deleting the last retained owner. Concurrent outcome
        // correction may commit first: reset must still suppress that episode.
        await cleaner.query("BEGIN")
        await cleaner.query(
          "DELETE FROM recommendation_profile_session_link WHERE profile_id = $1",
          [f.profileId],
        )
        cleanup = cleaner.query(
          "DELETE FROM recommendation_cowatch_source_contribution WHERE viewer_profile_id = $1",
          [f.profileId],
        )
        await eventually(
          async () =>
            (
              await gate.query(
                "SELECT wait_event_type FROM pg_stat_activity WHERE application_name = $1",
                [`${f.id}-cleaner`],
              )
            ).rows[0]?.wait_event_type === "Lock",
        )
        correction = reclassify(f.episodes[1], f.now)
        await correction
        await gate.query("COMMIT")
        await cleanup
        await cleaner.query("COMMIT")
        await prisma.recommendationProfile.update({
          where: { id: f.profileId },
          data: { privacyGeneration: 2 },
        })
        const rebuilt = await publishCowatchShadowGeneration(prisma, f.now, {
          ...f.binding.sourceWindow,
          evaluationAsOf: f.now,
        })
        graphIds.push(rebuilt.generation!)
        expect(rebuilt.sourceCount).toBe(13)
        expect(
          await prisma.recommendationCowatchSuppression.count({
            where: { episodeId: { in: f.episodes.slice(0, 2) } },
          }),
        ).toBe(2)
      } finally {
        await gate.query("ROLLBACK")
        await Promise.allSettled([cleanup, correction])
        await cleaner.query("ROLLBACK")
        await cleaner.end()
        await gate.end()
      }
    })
    it.each(["reset", "delete", "service"] as const)(
      "retains suppression after link cleanup on %s",
      async (mode) => {
        const f = await fixture()
        await qualify(f)
        await prisma.recommendationProfileSessionLink.deleteMany({
          where: { profileId: f.profileId },
        })
        expect(
          (
            await loadCowatchInspection(prisma, {
              generationId: f.binding.graphGenerationId,
              now: f.now,
            })
          ).state,
        ).toBe("current")
        expect(
          (await readCowatchTrialAuthority(prisma, f.binding, f.now)).status,
        ).toBe("current")
        expect(
          (
            await publishCowatchShadowGeneration(
              prisma,
              f.now,
              f.binding.sourceWindow,
            )
          ).generation,
        ).toBe(f.binding.graphGenerationId)
        if (mode === "reset")
          await prisma.recommendationProfile.update({
            where: { id: f.profileId },
            data: { privacyGeneration: 2 },
          })
        else if (mode === "delete")
          await prisma.recommendationProfile.delete({
            where: { id: f.profileId },
          })
        else
          await prisma.$transaction((tx) =>
            suppressCowatchForProfiles(tx, [f.profileId]),
          )
        expect(
          await prisma.recommendationCowatchSuppression.count({
            where: { episodeId: { in: f.episodes.slice(0, 2) } },
          }),
        ).toBe(2)
        expect(
          await readCowatchTrialAuthority(prisma, f.binding, f.now),
        ).toMatchObject({
          status: "refused",
          reason: "cowatch_generation_invalidated",
        })
        await expect(
          prisma.recommendationCowatchSuppression.delete({
            where: { episodeId: f.episodes[0] },
          }),
        ).rejects.toThrow("co-watch privacy suppression")
        const rebuilt = await publishCowatchShadowGeneration(
          prisma,
          f.now,
          f.binding.sourceWindow,
        )
        graphIds.push(rebuilt.generation!)
        expect(rebuilt.sourceCount).toBe(13)
        expect(rebuilt.generation).not.toBe(f.binding.graphGenerationId)
        expect(
          (
            await publishCowatchShadowGeneration(
              prisma,
              f.now,
              f.binding.sourceWindow,
            )
          ).generation,
        ).toBe(rebuilt.generation)
      },
    )
    it.each([
      "negative",
      "superseding-classifier",
      "eligibility",
      "episode",
      "source",
      "profile-expiry",
      "late-fact",
      "episode-delete",
      "outcome-delete",
      "eligibility-delete",
    ] as const)(
      "invalidates the whole authority on %s mutation",
      async (kind) => {
        const f = await fixture()
        await qualify(f)
        const singleton = f.episodes.at(-1)!
        if (kind === "negative" || kind === "superseding-classifier") {
          const prior =
            await prisma.recommendationOutcomeRevision.findUniqueOrThrow({
              where: { id: `${singleton}-r1` },
            })
          await prisma.recommendationOutcomeRevision.create({
            data: {
              ...prior,
              activeIntervals: undefined,
              id: `${singleton}-r2`,
              classifierVersion:
                kind === "superseding-classifier"
                  ? "corrected-proxy-v2"
                  : prior.classifierVersion,
              revision: 2,
              qualifiedView: false,
              supersedesId: prior.id,
              inputDigest: digest(`${singleton}-r2`),
              createdAt: f.now,
            },
          })
        } else if (kind === "eligibility")
          await prisma.recommendationEligibilityDecision.update({
            where: { id: `${singleton}-eligible` },
            data: { isCurrent: false },
          })
        else if (kind === "episode")
          await prisma.recommendationPlaybackEpisode.update({
            where: { id: singleton },
            data: { conflictCount: 1 },
          })
        else if (kind === "source")
          await prisma.recommendationCowatchSourceContribution.deleteMany({
            where: {
              generationId: f.binding.graphGenerationId,
              outcomeId: `${singleton}-r1`,
            },
          })
        else if (kind === "episode-delete")
          await prisma.recommendationPlaybackEpisode.delete({
            where: { id: singleton },
          })
        else if (kind === "outcome-delete")
          await prisma.recommendationOutcomeRevision.delete({
            where: { id: `${singleton}-r1` },
          })
        else if (kind === "eligibility-delete")
          await prisma.recommendationEligibilityDecision.delete({
            where: { id: `${singleton}-eligible` },
          })
        else if (kind === "profile-expiry")
          await prisma.recommendationProfile.update({
            where: { id: f.profileId },
            data: {
              expiresAt: new Date(f.binding.trialValidUntil.getTime() - 1),
            },
          })
        else
          await prisma.recommendationPlaybackFact.create({
            data: {
              episodeId: singleton,
              capabilityJti: "fixture",
              eventId: "late",
              payloadDigest: digest("late"),
              sequence: 2,
              kind: "progress",
              occurredAt: f.now,
              expiresAt: f.expiresAt,
              late: true,
            },
          })
        expect(
          await readCowatchTrialAuthority(prisma, f.binding, f.now),
        ).toMatchObject({
          status: "refused",
          reason: "cowatch_generation_invalidated",
        })
        expect(
          await qualifyCowatchTrialAuthority(prisma, f.binding, f.now),
        ).toMatchObject({
          status: "refused",
          reason: "cowatch_generation_invalidated",
        })
      },
    )
    it("hydrates current content, returns exact provenance, and bounds slow authority resolution", async () => {
      const f = await fixture()
      await qualify(f)
      await playable(f)
      const live = createDatabaseCowatchLiveSource(prisma, {
        now: () => f.now,
        resolveActiveAuthority: async () => ({
          binding: f.binding,
          validUntil: f.binding.trialValidUntil,
          requestContextDigest: f.context.requestContextDigest,
        }),
      })
      const result = await live({
        ...f.context,
        deadlineAt: Date.now() + 2_000,
      })
      expect(result).toMatchObject({
        disposition: "candidate",
        fallbackReason: null,
        provenance: {
          graphGenerationId: f.binding.graphGenerationId,
          protocolDigest: f.binding.protocolDigest,
          shadowDecisionId: f.binding.shadowDecisionId,
        },
      })
      expect(result.nominations.map((row) => row.targetMediaId)).toEqual([
        f.mediaB,
      ])
      // A resolver may read the same pool. A one-connection pool proves that
      // registry callbacks run after our hydration transaction releases it.
      const singleConnection = new PrismaClient({
        adapter: new PrismaPg({ connectionString: env.DATABASE_URL, max: 1 }),
      })
      try {
        const pooled = createDatabaseCowatchLiveSource(singleConnection, {
          now: () => f.now,
          resolveActiveAuthority: async () => {
            await singleConnection.$queryRaw`SELECT 1`
            return {
              binding: f.binding,
              validUntil: f.binding.trialValidUntil,
              requestContextDigest: f.context.requestContextDigest,
            }
          },
        })
        expect(
          (await pooled({ ...f.context, deadlineAt: Date.now() + 2_000 }))
            .disposition,
        ).toBe("candidate")
      } finally {
        await singleConnection.$disconnect()
      }
      expect(result.nominations[0].presentation.themes).toHaveLength(16)
      expect(result.nominations[0].presentation.themes[0]).toBe("hope")
      expect(result.nominations[0].presentation.themes[1]).toHaveLength(64)
      await prisma.videoTranscript.update({
        where: { id: `${f.id}-transcript` },
        data: { embeddingProvider: "inactive-provider" },
      })
      const missingThemes = await live({
        ...f.context,
        deadlineAt: Date.now() + 2_000,
      })
      expect(missingThemes.nominations[0].presentation.themes).toEqual([])
      expect(result.nominations[0].source.generatorVersion).toBe(
        COWATCH_FROZEN_TRIAL_MODE,
      )
      await prisma.videoLocale.update({
        where: { id: `${f.id}-locale` },
        data: { status: "DRAFT" },
      })
      expect(
        await live({ ...f.context, deadlineAt: Date.now() + 2_000 }),
      ).toMatchObject({
        disposition: "fallback",
        fallbackReason: "cowatch_unplayable",
        nominations: [],
      })
      expect(
        await live({
          ...f.context,
          requestContextDigest: digest("other"),
          deadlineAt: Date.now() + 2_000,
        }),
      ).toMatchObject({ fallbackReason: "cowatch_request_context_mismatch" })
      const slow = createDatabaseCowatchLiveSource(prisma, {
        resolveActiveAuthority: () => new Promise(() => {}),
      })
      const started = Date.now()
      expect(
        await slow({ ...f.context, deadlineAt: Date.now() + 30 }),
      ).toMatchObject({ fallbackReason: "cowatch_deadline_exceeded" })
      expect(Date.now() - started).toBeLessThan(300)
    })
    it("measures indexed live reads among 10,000 unrelated edges without source scans", async () => {
      const size = () =>
        prisma.$queryRaw<
          Array<{ heap: bigint; indexes: bigint; wal: string }>
        >`SELECT SUM(pg_table_size(oid))::bigint AS heap, SUM(pg_indexes_size(oid))::bigint AS indexes, pg_current_wal_lsn()::text AS wal FROM pg_class WHERE relname IN ('recommendation_cowatch_generation','recommendation_cowatch_source_contribution','recommendation_cowatch_contribution','recommendation_cowatch_edge','recommendation_cowatch_trial_authority')`
      const [before] = await size()
      const f = await fixture()
      await qualify(f)
      await playable(f)
      const original =
        await prisma.recommendationCowatchGeneration.findUniqueOrThrow({
          where: { id: f.binding.graphGenerationId },
        })
      const noiseId = digest(`${f.id}-index-fixture`)
      graphIds.push(noiseId)
      await prisma.recommendationCowatchGeneration.create({
        data: {
          ...original,
          id: noiseId,
          sourceCount: 0,
          contributionCount: 0,
          edgeCount: 10_000,
        },
      })
      const edge = await prisma.recommendationCowatchEdge.findFirstOrThrow({
        where: { generationId: original.id },
      })
      for (let offset = 0; offset < 10_000; offset += 500)
        await prisma.recommendationCowatchEdge.createMany({
          data: Array.from({ length: 500 }, (_, i) => ({
            ...edge,
            id: `${f.id}-noise-${offset + i}`,
            generationId: noiseId,
            sourceMediaId: "background-anchor",
            targetMediaId: `background-${offset + i}`,
          })),
        })
      await prisma.$executeRaw`ANALYZE recommendation_cowatch_edge`
      const live = createDatabaseCowatchLiveSource(prisma, {
        now: () => f.now,
        resolveActiveAuthority: async () => ({
          binding: f.binding,
          validUntil: f.binding.trialValidUntil,
          requestContextDigest: f.context.requestContextDigest,
        }),
      })
      const elapsed: number[] = []
      observedQueries.length = 0
      observeQueries = true
      try {
        for (let i = 0; i < 30; i++) {
          const start = performance.now()
          expect(
            (await live({ ...f.context, deadlineAt: Date.now() + 2_000 }))
              .disposition,
          ).toBe("candidate")
          elapsed.push(performance.now() - start)
        }
      } finally {
        observeQueries = false
      }
      expect(
        observedQueries.some(
          (query) =>
            query.includes("recommendation_cowatch_source_contribution") ||
            query.includes("recommendation_cowatch_contribution"),
        ),
      ).toBe(false)
      const plan =
        await prisma.$queryRaw`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM recommendation_cowatch_edge WHERE generation_id = ${original.id} AND source_media_id = ${f.mediaA} AND eligible ORDER BY confidence DESC, popularity_corrected_lift DESC, target_media_id LIMIT 32`
      expect(JSON.stringify(plan)).toContain("Index Scan")
      const densePlan =
        await prisma.$queryRaw`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM recommendation_cowatch_edge WHERE generation_id = ${noiseId} AND source_media_id = 'background-anchor' AND eligible ORDER BY confidence DESC, popularity_corrected_lift DESC, target_media_id LIMIT 32`
      expect(JSON.stringify(densePlan)).toContain(
        "recommendation_cowatch_edge_live_idx",
      )
      expect(JSON.stringify(densePlan)).toContain('"Actual Rows":32')
      expect(observedQueries.length).toBeGreaterThan(30)
      const [after] = await size()
      const [wal] = await prisma.$queryRaw<
        Array<{ bytes: bigint }>
      >`SELECT pg_wal_lsn_diff(${after.wal}::pg_lsn, ${before.wal}::pg_lsn)::bigint AS bytes`
      const mutationStart = performance.now()
      await prisma.recommendationPlaybackEpisode.update({
        where: { id: f.episodes.at(-1)! },
        data: { conflictCount: 1 },
      })
      const mutationMs = performance.now() - mutationStart
      const [mutationWal] = await prisma.$queryRaw<
        Array<{ bytes: bigint }>
      >`SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), ${after.wal}::pg_lsn)::bigint AS bytes`
      console.info("cowatch frozen local fixture envelope", {
        sources: 15,
        pairs: 5,
        publishedEdges: 1,
        backgroundIndexEdges: 10_000,
        liveCalls: 30,
        liveQueries: observedQueries.length,
        p50Ms: elapsed.sort((a, b) => a - b)[15],
        p95Ms: elapsed[28],
        heapAllocationDelta: Number(after.heap - before.heap),
        indexAllocationDelta: Number(after.indexes - before.indexes),
        walBytes: Number(wal.bytes),
        invalidationMs: mutationMs,
        invalidationWalBytes: Number(mutationWal.bytes),
        plan,
      })
    }, 30_000)
    it("a source writer cannot commit valid authority while qualification holds the graph lock", async () => {
      const f = await fixture()
      const gate = new Client({ connectionString: env.DATABASE_URL })
      const writer = new Client({
        connectionString: env.DATABASE_URL,
        application_name: `${f.id}-writer`,
      })
      await gate.connect()
      await writer.connect()
      const lockId = 565000001
      let qualification:
        | ReturnType<typeof qualifyCowatchTrialAuthority>
        | undefined
      let mutation: Promise<unknown> | undefined
      try {
        await gate.query("SELECT pg_advisory_lock($1)", [lockId])
        await gate.query(
          `CREATE OR REPLACE FUNCTION cowatch_test_qualification_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${lockId}); RETURN NEW; END $$`,
        )
        await gate.query(
          "CREATE TRIGGER cowatch_test_qualification_gate BEFORE INSERT ON recommendation_cowatch_trial_authority FOR EACH ROW EXECUTE FUNCTION cowatch_test_qualification_gate()",
        )
        qualification = qualifyCowatchTrialAuthority(prisma, f.binding, f.now)
        await eventually(
          async () =>
            Number(
              (
                await gate.query(
                  "SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND objid = $1 AND NOT granted",
                  [lockId],
                )
              ).rows[0].n,
            ) > 0,
        )
        let committed = false
        mutation = writer
          .query(
            "UPDATE recommendation_profile SET privacy_generation = privacy_generation + 1 WHERE id = $1",
            [f.profileId],
          )
          .then(() => {
            committed = true
          })
        await eventually(
          async () =>
            (
              await gate.query(
                "SELECT wait_event_type FROM pg_stat_activity WHERE application_name = $1",
                [`${f.id}-writer`],
              )
            ).rows[0]?.wait_event_type === "Lock",
        )
        expect(committed).toBe(false)
        await gate.query("SELECT pg_advisory_unlock($1)", [lockId])
        expect((await qualification).status).toBe("qualified")
        await mutation
        const revoked =
          await prisma.recommendationCowatchTrialAuthority.findUniqueOrThrow({
            where: { generationId: f.binding.graphGenerationId },
          })
        const invalidated =
          await prisma.recommendationCowatchGeneration.findUniqueOrThrow({
            where: { id: f.binding.graphGenerationId },
          })
        expect(revoked.revokedAt).not.toBeNull()
        expect(revoked.revokedAt).toEqual(invalidated.invalidatedAt)
        expect(
          await readCowatchTrialAuthority(prisma, f.binding, f.now),
        ).toMatchObject({
          status: "refused",
          reason: "cowatch_generation_invalidated",
        })
      } finally {
        await gate.query("SELECT pg_advisory_unlock($1)", [lockId])
        await Promise.allSettled([qualification, mutation])
        await gate.query(
          "DROP TRIGGER IF EXISTS cowatch_test_qualification_gate ON recommendation_cowatch_trial_authority",
        )
        await gate.query(
          "DROP FUNCTION IF EXISTS cowatch_test_qualification_gate()",
        )
        await writer.end()
        await gate.end()
      }
    })
  },
)
async function eventually(predicate: () => Promise<boolean>) {
  const deadline = Date.now() + 2_000
  while (!(await predicate())) {
    if (Date.now() >= deadline)
      throw new Error("native race did not reach expected lock")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
