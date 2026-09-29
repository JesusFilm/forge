import { createHash, randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { RECOMMENDATION_INTEGRITY_POLICY_VERSION } from "../integrity-policy"
import { loadCowatchPlayableRows } from "./candidate.service"
import { loadCowatchInspection } from "./inspection.service"
import {
  buildCowatchGraph,
  COWATCH_FEATURE_VERSION,
  COWATCH_DURABLE_LINEAGE_VERSION,
  COWATCH_PROJECTION_VERSION,
} from "./graph"
import { suppressCowatchForProfiles } from "./privacy"
import {
  loadCowatchSourceRows,
  COWATCH_PUBLICATION_LOCK_ID,
  preflightCowatchShadowGeneration,
  publishCowatchShadowGeneration,
} from "./projection.service"

const RUN_REAL_DB_TEST = env.RECOMMENDATION_DB_TEST === "1"
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex")

describe.skipIf(!RUN_REAL_DB_TEST)(
  "co-watch shadow on migrated PostgreSQL",
  () => {
    let prisma: PrismaClient
    const prefix = `cowatch-${randomUUID()}`
    const mediaA = `${prefix}-A`
    const mediaB = `${prefix}-B`
    const mediaC = `${prefix}-C`
    const episodeIds: string[] = []
    const generationIds: string[] = []
    const catalogIds: string[] = []
    const languageId = `${prefix}-language`
    const muxIds: string[] = []
    const now = new Date()
    const expiresAt = new Date(now.getTime() + 20 * 86_400_000)

    beforeAll(() => {
      const url = new URL(env.DATABASE_URL)
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        !["/forge_test", "/forge_feat387_test", "/forge_feat565_test"].includes(
          url.pathname,
        )
      )
        throw new Error(
          "Co-watch native tests require an owned loopback fixture database",
        )
      prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url.toString(), max: 2 }),
      })
    })

    afterAll(async () => {
      if (!prisma) return
      await prisma.recommendationCowatchGeneration.deleteMany({
        where: { id: { in: generationIds } },
      })
      await prisma.recommendationPlaybackEpisode.deleteMany({
        where: {
          OR: [
            { id: { in: episodeIds } },
            { id: { startsWith: `${prefix}-bulk-` } },
          ],
        },
      })
      await prisma.video.deleteMany({ where: { id: { in: catalogIds } } })
      await prisma.muxVideo.deleteMany({ where: { id: { in: muxIds } } })
      await prisma.language.deleteMany({ where: { id: languageId } })
      await prisma.$disconnect()
    })

    async function episode(
      viewer: number,
      media: string,
      offsetMs: number,
      outcomeCreatedAt?: Date,
    ) {
      const id = `${prefix}-${viewer}-${media}-${offsetMs}`
      episodeIds.push(id)
      const sessionDigest = digest(`${prefix}-session-${viewer}`)
      const occurredAt = new Date(now.getTime() - 86_400_000 + offsetMs)
      await prisma.recommendationPlaybackEpisode.create({
        data: {
          id,
          mediaId: media,
          sessionDigest,
          state: "FINALIZED",
          nextFactSequence: 2,
          activeUntil: new Date(now.getTime() + 86_400_000),
          hardUntil: new Date(now.getTime() + 2 * 86_400_000),
          finalizedAt: occurredAt,
          claimedAt: occurredAt,
          createdAt: occurredAt,
          expiresAt,
        },
      })
      const outcomeId = `${id}-r1`
      await prisma.recommendationOutcomeRevision.create({
        data: {
          id: outcomeId,
          episodeId: id,
          classifierVersion: "active-watch-proxy-v1",
          factWatermark: 1,
          inputDigest: digest(outcomeId),
          revision: 1,
          qualifiedView: true,
          viewQualityWeight: 1,
          viewQualityWeightReason: "active_fraction_of_duration",
          activePlaybackMilliseconds: 30_000,
          durationSeconds: 30,
          durationCohort: "short",
          activeCoverage: "complete",
          generation: 1,
          createdAt: outcomeCreatedAt ?? occurredAt,
          expiresAt,
        },
      })
      await prisma.recommendationEligibilityDecision.create({
        data: {
          id: `${id}-eligibility`,
          sourceType: "PLAYBACK_OUTCOME",
          sourceKey: `${prefix}-${id}`,
          outcomeId,
          policyVersion: RECOMMENDATION_INTEGRITY_POLICY_VERSION,
          revision: 1,
          actorClass: "HUMAN_SIGNED_IN",
          state: "ELIGIBLE",
          eligibleScopes: ["profile", "aggregate"],
          contributionWeight: 1,
          contributionOrdinal: 1,
          distinctSupport: 6,
          identityConcentration: 0.1,
          inputDigest: digest(`${id}-eligibility`),
          expiresAt,
        },
      })
      return { id, outcomeId }
    }

    async function bulkEpisodes(
      count: number,
      eligible: boolean,
      groupSize: number,
      distinctMedia = false,
    ) {
      const bulkPrefix = `${prefix}-bulk-`
      const eventStart = new Date(now.getTime() - 20 * 86_400_000)
      await prisma.$executeRaw`
        INSERT INTO recommendation_playback_episode
          (id, media_id, session_digest, state, next_fact_sequence, active_until, hard_until, finalized_at, claimed_at, created_at, expires_at)
        SELECT ${bulkPrefix} || n, ${mediaA} || CASE WHEN ${distinctMedia} THEN '-' || n ELSE '' END, repeat(md5(${bulkPrefix} || ((n - 1) / ${groupSize})::text), 2),
          'finalized'::"RecommendationEpisodeState", 2, ${now}::timestamptz + INTERVAL '1 day', ${now}::timestamptz + INTERVAL '2 days',
          ${eventStart}::timestamptz + n * INTERVAL '1 millisecond', ${eventStart}::timestamptz + n * INTERVAL '1 millisecond',
          ${eventStart}::timestamptz + n * INTERVAL '1 millisecond', ${expiresAt}
        FROM generate_series(1, ${count}::integer) n
      `
      await prisma.$executeRaw`
        INSERT INTO recommendation_outcome_revision
          (id, episode_id, classifier_version, fact_watermark, input_digest, revision, qualified_view, view_quality_weight, view_quality_weight_reason, active_playback_milliseconds, duration_seconds, duration_cohort, active_coverage, generation, created_at, expires_at)
        SELECT id || '-r1', id, 'active-watch-proxy-v1', 1, repeat(md5(id), 2), 1, true, 1, 'active_fraction_of_duration', 30000, 30, 'short', 'complete', 1, created_at, expires_at
        FROM recommendation_playback_episode WHERE starts_with(id, ${bulkPrefix})
      `
      if (eligible) {
        await prisma.$executeRaw`
          INSERT INTO recommendation_eligibility_decision
            (id, source_type, source_key, outcome_id, policy_version, revision, actor_class, state, eligible_scopes, contribution_weight, contribution_ordinal, distinct_support, identity_concentration, input_digest, expires_at)
          SELECT id || '-decision', 'playback_outcome'::"RecommendationEligibilitySourceType", id, id,
            ${RECOMMENDATION_INTEGRITY_POLICY_VERSION}, 1, 'human_signed_in'::"RecommendationContentActionActorClass",
            'eligible'::"RecommendationEligibilityState", ARRAY['aggregate'], 1, 1, 6, 0.1, input_digest, expires_at
          FROM recommendation_outcome_revision WHERE starts_with(episode_id, ${bulkPrefix})
        `
      }
    }

    async function clearBulkEpisodes() {
      await prisma.recommendationPlaybackEpisode.deleteMany({
        where: { id: { startsWith: `${prefix}-bulk-` } },
      })
    }

    it("publishes exact sources, replaces revisions, suppresses deletion and matches a fresh rebuild", async () => {
      const bEpisodes: Array<{ id: string; outcomeId: string }> = []
      for (let viewer = 0; viewer < 3; viewer++) {
        await episode(viewer, mediaA, 0)
        bEpisodes.push(await episode(viewer, mediaB, 1_000))
      }
      for (let viewer = 3; viewer < 6; viewer++)
        await episode(viewer, mediaC, 0)

      const first = await publishCowatchShadowGeneration(prisma, now)
      expect(first.status).toBe("published")
      expect(first.sourceCount).toBe(9)
      expect(first.contributionCount).toBe(3)
      generationIds.push(first.generation!)
      const initial = await loadCowatchInspection(prisma, {
        now,
        sourceMediaId: mediaA,
      })
      expect(initial.state).toBe("current")
      expect(initial.sourceWindow?.version).toBe(
        "legacy-outcome-write-window-v1",
      )
      expect(initial.candidates.map((edge) => edge.targetMediaId)).toContain(
        mediaB,
      )
      expect(initial.reverseEdges).toHaveLength(0)

      const correctedId = `${bEpisodes[0].id}-r2`
      await prisma.recommendationOutcomeRevision.create({
        data: {
          id: correctedId,
          episodeId: bEpisodes[0].id,
          classifierVersion: "active-watch-proxy-v1",
          factWatermark: 2,
          inputDigest: digest(correctedId),
          revision: 2,
          supersedesId: bEpisodes[0].outcomeId,
          qualifiedView: false,
          viewQualityWeight: 0,
          viewQualityWeightReason: "active_fraction_of_duration",
          activePlaybackMilliseconds: 0,
          durationSeconds: 30,
          durationCohort: "short",
          activeCoverage: "complete",
          generation: 2,
          createdAt: new Date(now.getTime() + 1),
          expiresAt,
        },
      })
      const afterRevision = new Date(now.getTime() + 2)
      const second = await publishCowatchShadowGeneration(prisma, afterRevision)
      generationIds.push(second.generation!)
      expect(second.sourceCount).toBe(8)
      expect(second.contributionCount).toBe(2)
      expect(second.generation).not.toBe(first.generation)
      const revised = await loadCowatchInspection(prisma, {
        now: afterRevision,
        sourceMediaId: mediaA,
      })
      expect(revised.state).toBe("current")
      expect(revised.candidates).toHaveLength(0)

      await prisma.recommendationCowatchSuppression.create({
        data: { episodeId: bEpisodes[1].id, expiresAt },
      })
      const afterDeletion = new Date(now.getTime() + 4)
      const third = await publishCowatchShadowGeneration(prisma, afterDeletion)
      generationIds.push(third.generation!)
      expect(third.sourceCount).toBe(7)
      expect(third.contributionCount).toBe(1)
      const fresh = await loadCowatchSourceRows(prisma, afterDeletion)
      expect(
        fresh.filter((row) => row.integrityEligible && row.qualified),
      ).toHaveLength(7)
      const stored =
        await prisma.recommendationCowatchGeneration.findUniqueOrThrow({
          where: { id: third.generation! },
          include: { sources: true, contributions: true, edges: true },
        })
      expect(stored.sources).toHaveLength(7)
      expect(stored.contributions).toHaveLength(1)
      expect(stored.edges).toHaveLength(1)
      expect(stored.terminalDecision).toBe("no_promotion")
      const rebuilt = buildCowatchGraph(
        fresh.map((row) => ({
          outcomeId: row.outcomeId,
          episodeId: row.episodeId,
          revision: row.revision,
          mediaId: row.mediaId,
          sessionDigest: row.sessionDigest,
          viewerKey:
            row.profileId == null
              ? `session:${row.sessionDigest}`
              : `profile:${row.profileId}`,
          occurredAt: row.occurredAt,
          qualified: row.qualified,
          finalized: row.finalized,
          integrityEligible: row.integrityEligible,
          eligibilityDecisionId: row.eligibilityDecisionId,
          eligibilityRevision: row.eligibilityRevision,
          eligibilityPolicyVersion: row.eligibilityPolicyVersion,
          qualityWeight: row.qualityWeight ?? 0,
          expiresAt: row.expiresAt,
        })),
        afterDeletion,
      )
      expect(third.generation).toBe(rebuilt.generation)
      expect(stored.edges).toHaveLength(rebuilt.edges.length)
      for (const edge of rebuilt.edges) {
        const actual = stored.edges.find(
          (row) =>
            row.sourceMediaId === edge.sourceMediaId &&
            row.targetMediaId === edge.targetMediaId,
        )
        expect(actual).toBeDefined()
        expect(actual).toMatchObject({
          sessionSupport: edge.sessionSupport,
          distinctViewerSupport: edge.distinctViewerSupport,
          eligible: edge.eligible,
        })
        for (const metric of [
          "confidence",
          "popularityCorrectedLift",
          "recencyWeight",
          "qualityWeight",
          "effectiveWeight",
          "contamination",
        ] as const) {
          expect(actual![metric]).toBeCloseTo(edge[metric], 12)
        }
      }

      // Source facts invalidate a still-current, still-eligible decision.
      await prisma.recommendationPlaybackEpisode.update({
        where: { id: bEpisodes[2].id },
        data: { conflictCount: 1 },
      })
      const stale = await loadCowatchInspection(prisma, {
        now: new Date(now.getTime() + 5),
        sourceMediaId: mediaA,
      })
      expect(stale.state).toBe("stale")
      expect(stale.staleReasons).toContain("source_lineage_invalid")
      const afterConflict = new Date(now.getTime() + 6)
      const fourth = await publishCowatchShadowGeneration(prisma, afterConflict)
      generationIds.push(fourth.generation!)
      expect(fourth.sourceCount).toBe(6)
      expect(fourth.contributionCount).toBe(0)

      // Eligible-to-eligible decision replacement changes exact lineage.
      const aOutcomeId = `${prefix}-2-${mediaA}-0-r1`
      const oldDecision =
        await prisma.recommendationEligibilityDecision.findFirstOrThrow({
          where: { outcomeId: aOutcomeId, isCurrent: true },
        })
      await prisma.recommendationEligibilityDecision.update({
        where: { id: oldDecision.id },
        data: { isCurrent: false },
      })
      await prisma.recommendationEligibilityDecision.create({
        data: {
          id: `${aOutcomeId}-decision-r2`,
          sourceType: "PLAYBACK_OUTCOME",
          sourceKey: oldDecision.sourceKey,
          outcomeId: aOutcomeId,
          policyVersion: RECOMMENDATION_INTEGRITY_POLICY_VERSION,
          revision: 2,
          actorClass: "HUMAN_SIGNED_IN",
          state: "ELIGIBLE",
          eligibleScopes: ["profile", "aggregate"],
          contributionWeight: 1,
          contributionOrdinal: 1,
          distinctSupport: 6,
          identityConcentration: 0.1,
          inputDigest: digest(`${aOutcomeId}-decision-r2`),
          expiresAt,
        },
      })
      const staleDecision = await loadCowatchInspection(prisma, {
        now: new Date(now.getTime() + 7),
        sourceMediaId: mediaA,
      })
      expect(staleDecision.state).toBe("stale")
      const fifth = await publishCowatchShadowGeneration(
        prisma,
        new Date(now.getTime() + 8),
      )
      generationIds.push(fifth.generation!)
      expect(fifth.sourceCount).toBe(fourth.sourceCount)
      expect(fifth.generation).not.toBe(fourth.generation)
      const newSource =
        await prisma.recommendationCowatchSourceContribution.findFirstOrThrow({
          where: { generationId: fifth.generation!, outcomeId: aOutcomeId },
        })
      expect(newSource.eligibilityRevision).toBe(2)

      // Privacy erasure suppresses linked episodes before the link is removed.
      const profileId = `${prefix}-profile`
      await prisma.recommendationProfile.create({
        data: {
          id: profileId,
          tokenDigest: digest(profileId),
          privacyGeneration: 1,
          choice: "DURABLE_ALLOWED",
          expiresAt,
        },
      })
      const sessionDigest = digest(`${prefix}-session-2`)
      await prisma.recommendationProfileSessionLink.create({
        data: { profileId, privacyGeneration: 1, sessionDigest, expiresAt },
      })
      const linked = await publishCowatchShadowGeneration(
        prisma,
        new Date(now.getTime() + 9),
      )
      generationIds.push(linked.generation!)
      expect(
        await prisma.recommendationCowatchSourceContribution.count({
          where: {
            generationId: linked.generation!,
            viewerProfileId: profileId,
          },
        }),
      ).toBe(1)
      await prisma.$transaction(async (tx) => {
        await suppressCowatchForProfiles(tx, [profileId])
        await tx.recommendationProfileSessionLink.deleteMany({
          where: { profileId },
        })
      })
      expect(
        await prisma.recommendationCowatchSuppression.count({
          where: {
            episodeId: { in: [`${prefix}-2-${mediaA}-0`, bEpisodes[2].id] },
          },
        }),
      ).toBe(2)
      const erased = await loadCowatchInspection(prisma, {
        now: new Date(now.getTime() + 10),
        sourceMediaId: mediaA,
      })
      expect(erased.state).toBe("stale")
      await prisma.recommendationProfile.delete({ where: { id: profileId } })
    })

    it("hydrates only watch-playable, published-locale, matching-dub candidates", async () => {
      await prisma.language.create({
        data: {
          id: languageId,
          coreId: languageId,
          slug: `${prefix}-audio`,
        },
      })
      const cases = [
        "playable",
        "restricted",
        "draft",
        "no-dub",
        "deleted",
      ] as const
      for (const name of cases) {
        const id = `${prefix}-${name}`
        catalogIds.push(id)
        await prisma.video.create({
          data: {
            id,
            coreId: id,
            slug: id,
            restrictViewPlatforms: name === "restricted" ? ["watch"] : [],
            deletedAt: name === "deleted" ? now : null,
          },
        })
        await prisma.videoLocale.create({
          data: {
            id: `${id}-locale`,
            videoId: id,
            locale: "en",
            title: `${name} title`,
            languageSlug: `${prefix}-audio`,
            status: name === "draft" ? "DRAFT" : "PUBLISHED",
          },
        })
        if (name !== "no-dub") {
          const muxId = `${id}-mux`
          muxIds.push(muxId)
          await prisma.muxVideo.create({
            data: { id: muxId, playbackId: `${id}-playback` },
          })
          await prisma.videoDub.create({
            data: {
              id: `${id}-dub`,
              coreId: `${id}-dub`,
              videoId: id,
              languageId,
              muxVideoId: muxId,
              published: true,
              duration: 120,
            },
          })
        }
      }
      const rows = await loadCowatchPlayableRows(prisma, catalogIds, {
        locale: "en",
        audioLanguageSlug: `${prefix}-audio`,
      })
      expect(rows.map((row) => row.videoId)).toEqual([catalogIds[0]])
      expect(rows[0]).toMatchObject({
        videoTitle: "playable title",
        playbackId: `${catalogIds[0]}-playback`,
      })
    })

    it("selects event boundaries independently of outcome-write time and classifier cutoff", async () => {
      const day = 86_400_000
      const start = await episode(100, mediaA, -3 * day)
      const delayed = await episode(
        101,
        mediaB,
        -3 * day + 1_000,
        new Date(now.getTime() - day),
      )
      await episode(102, mediaC, -3 * day - 1)
      await episode(103, mediaC, -2 * day)
      await prisma.recommendationPlaybackEpisode.update({
        where: { id: start.id },
        data: { claimedAt: null },
      })
      const scope = {
        version: "episode-event-window-v1" as const,
        windowStart: new Date(now.getTime() - 4 * day),
        windowEnd: new Date(now.getTime() - 3 * day),
        evaluationAsOf: now,
      }
      const rows = await loadCowatchSourceRows(prisma, now, scope)
      expect(rows.map((row) => row.episodeId)).toEqual([start.id, delayed.id])
      const original =
        await prisma.recommendationOutcomeRevision.findUniqueOrThrow({
          where: { id: delayed.outcomeId },
        })
      await prisma.recommendationOutcomeRevision.create({
        data: {
          ...original,
          activeIntervals: undefined,
          id: `${delayed.outcomeId}-negative`,
          inputDigest: digest(`${delayed.outcomeId}-negative`),
          revision: 2,
          supersedesId: original.id,
          qualifiedView: false,
          createdAt: new Date(now.getTime() - 1),
        },
      })
      const corrected = await loadCowatchSourceRows(prisma, now, scope)
      expect(
        corrected.find((row) => row.episodeId === delayed.id),
      ).toMatchObject({
        revision: 2,
        qualified: false,
      })
      await prisma.recommendationOutcomeRevision.create({
        data: {
          ...original,
          activeIntervals: undefined,
          id: `${delayed.outcomeId}-future`,
          inputDigest: digest(`${delayed.outcomeId}-future`),
          revision: 3,
          supersedesId: `${delayed.outcomeId}-negative`,
          createdAt: new Date(now.getTime() + 1),
        },
      })
      await prisma.recommendationOutcomeRevision.create({
        data: {
          ...original,
          activeIntervals: undefined,
          id: `${start.outcomeId}-other`,
          episodeId: start.id,
          classifierVersion: "other-classifier",
          revision: 99,
          inputDigest: digest(`${start.outcomeId}-other`),
          qualifiedView: false,
          createdAt: new Date(now.getTime() - 1),
        },
      })
      const cutoffRows = await loadCowatchSourceRows(prisma, now, scope)
      expect(
        cutoffRows.find((row) => row.episodeId === delayed.id),
      ).toMatchObject({
        revision: 2,
        qualified: false,
        integrityEligible: false,
      })
      expect(
        cutoffRows.find((row) => row.episodeId === start.id),
      ).toMatchObject({ revision: 1, qualified: true })
      const preflight = await preflightCowatchShadowGeneration(
        prisma,
        now,
        scope,
      )
      expect(preflight).toMatchObject({
        status: "ready",
        rawSourceCount: 2,
        sourceCount: 1,
      })
    })

    it("keeps older writers and their unrecorded scope metadata compatible", async () => {
      const id = digest(`${prefix}-legacy-writer`)
      generationIds.push(id)
      await prisma.recommendationCowatchGeneration.create({
        data: {
          id,
          projectionVersion: COWATCH_PROJECTION_VERSION,
          featureVersion: COWATCH_FEATURE_VERSION,
          sourceCount: 0,
          contributionCount: 0,
          edgeCount: 0,
          distinctViewerCount: 0,
          windowEnd: now,
          publishedAt: now,
          expiresAt,
          terminalDecision: "no_promotion",
          decisionReason: "no_eligible_finalized_outcomes",
        },
      })
      expect(
        await loadCowatchInspection(prisma, { now, generationId: id }),
      ).toMatchObject({
        generation: id,
        state: "current",
        rawSourceCount: null,
        attemptedPairCount: null,
        sourceWindow: {
          version: "legacy-outcome-write-window-v1",
          windowEnd: now,
          evaluationAsOf: now,
        },
      })
    })

    it("preflights without writes, preserves exact publication identity and rebuilds after erasure", async () => {
      const day = 86_400_000
      const a = await episode(200, mediaA, -6 * day)
      const b = await episode(200, mediaB, -6 * day + 1_000)
      await episode(201, mediaC, -6 * day + 2_000)
      const scope = {
        version: "episode-event-window-v1" as const,
        windowStart: new Date(now.getTime() - 7 * day),
        windowEnd: new Date(now.getTime() - 6 * day),
        evaluationAsOf: new Date(now.getTime() - 3_600_000),
      }
      const profileId = `${prefix}-finite-profile`
      await prisma.recommendationProfile.create({
        data: {
          id: profileId,
          tokenDigest: digest(profileId),
          privacyGeneration: 1,
          choice: "DURABLE_ALLOWED",
          expiresAt,
        },
      })
      await prisma.recommendationProfileSessionLink.create({
        data: {
          profileId,
          privacyGeneration: 1,
          sessionDigest: digest(`${prefix}-session-200`),
          expiresAt,
        },
      })
      try {
        const beforeCount = await prisma.recommendationCowatchGeneration.count()
        const preflight = await preflightCowatchShadowGeneration(
          prisma,
          now,
          scope,
        )
        expect(preflight).toMatchObject({
          status: "ready",
          rawSourceCount: 3,
          sourceCount: 3,
          attemptedPairCount: 1,
          contributionCount: 1,
          edgeCount: 1,
          publicationRowCount: 6,
          publishedAt: null,
        })
        expect(await prisma.recommendationCowatchGeneration.count()).toBe(
          beforeCount,
        )
        const first = await publishCowatchShadowGeneration(prisma, now, scope)
        generationIds.push(first.generation!)
        expect(first.generation).toBe(preflight.generation)
        expect(first.publishedAt!.getTime()).toBeGreaterThan(
          scope.evaluationAsOf.getTime(),
        )
        const stored =
          await prisma.recommendationCowatchGeneration.findUniqueOrThrow({
            where: { id: first.generation! },
            include: { sources: true },
          })
        expect(stored).toMatchObject({
          sourceWindowVersion: scope.version,
          windowStart: scope.windowStart,
          windowEnd: scope.windowEnd,
          evaluationAsOf: scope.evaluationAsOf,
          rawSourceCount: 3,
          attemptedPairCount: 1,
        })
        expect(stored.sources).toHaveLength(3)
        const repeat = await publishCowatchShadowGeneration(
          prisma,
          new Date(now.getTime() + 1_000),
          scope,
        )
        expect(repeat).toMatchObject({
          status: "unchanged",
          generation: first.generation,
          publishedAt: first.publishedAt,
        })
        const second = await publishCowatchShadowGeneration(prisma, now, {
          ...scope,
          windowStart: new Date(scope.windowStart.getTime() - 1),
        })
        generationIds.push(second.generation!)
        expect(second.generation).not.toBe(first.generation)
        const pinned = await loadCowatchInspection(prisma, {
          now,
          generationId: first.generation!,
        })
        expect(pinned).toMatchObject({
          state: "current",
          generation: first.generation,
          sourceWindow: scope,
          rawSourceCount: 3,
          attemptedPairCount: 1,
        })
        expect(
          (
            await loadCowatchInspection(prisma, {
              now,
              generationId: "0".repeat(64),
            })
          ).state,
        ).toBe("unavailable")
        expect(
          (
            await loadCowatchInspection(prisma, {
              now: new Date(first.publishedAt!.getTime() + day + 1),
              generationId: first.generation!,
            })
          ).state,
        ).toBe("stale")
        await prisma.$transaction(async (tx) => {
          await suppressCowatchForProfiles(tx, [profileId])
          await tx.recommendationProfileSessionLink.deleteMany({
            where: { profileId },
          })
        })
        const erased = await loadCowatchInspection(prisma, {
          now,
          generationId: first.generation!,
        })
        expect(erased).toMatchObject({
          state: "stale",
          generation: first.generation,
          candidates: [],
        })
        const rebuilt = await publishCowatchShadowGeneration(prisma, now, scope)
        generationIds.push(rebuilt.generation!)
        expect(rebuilt).toMatchObject({
          rawSourceCount: 3,
          sourceCount: 1,
          contributionCount: 0,
          edgeCount: 0,
        })
        const fresh = await loadCowatchSourceRows(prisma, now, scope)
        const expected = buildCowatchGraph(
          fresh.map((row) => ({
            ...row,
            viewerKey: row.profileId
              ? `profile:${row.profileId}:${row.privacyGeneration}`
              : `session:${row.sessionDigest}`,
            qualityWeight: row.qualityWeight ?? 0,
          })),
          now,
          scope,
          COWATCH_DURABLE_LINEAGE_VERSION,
        )
        expect(rebuilt.generation).toBe(expected.generation)
        expect(
          await prisma.recommendationCowatchSourceContribution.count({
            where: {
              generationId: rebuilt.generation!,
              outcomeId: { in: [a.outcomeId, b.outcomeId] },
            },
          }),
        ).toBe(0)
      } finally {
        await prisma.recommendationProfile.delete({ where: { id: profileId } })
      }
    })

    it("refuses raw, per-session and pair-work overflow without a partial generation", async () => {
      const scope = {
        version: "episode-event-window-v1" as const,
        windowStart: new Date(now.getTime() - 20 * 86_400_000),
        windowEnd: new Date(now.getTime() - 19 * 86_400_000),
        evaluationAsOf: now,
      }
      const beforeCount = await prisma.recommendationCowatchGeneration.count()
      try {
        await bulkEpisodes(50_001, false, 1)
        const rawStarted = performance.now()
        const raw = await publishCowatchShadowGeneration(prisma, now, scope)
        console.info(
          "cowatch_owned_fixture_raw_overflow",
          JSON.stringify({
            rawSourceCount: raw.rawSourceCount,
            status: raw.status,
            elapsedMs: Math.round(performance.now() - rawStarted),
          }),
        )
        expect(raw).toMatchObject({
          status: "source_overflow",
          rawSourceCount: 50_001,
          rawSourceCountIsLowerBound: true,
          sourceCount: null,
          attemptedPairCount: null,
          generation: null,
          publicationRowCount: null,
          publishedAt: null,
        })
        await clearBulkEpisodes()
        await bulkEpisodes(257, true, 257)
        const session = await publishCowatchShadowGeneration(prisma, now, scope)
        expect(session).toMatchObject({
          status: "work_overflow",
          rawSourceCount: 257,
          sourceCount: 257,
          attemptedPairCount: 0,
          generation: null,
          publicationRowCount: null,
        })
        await clearBulkEpisodes()
        await bulkEpisodes(2_048, true, 256)
        const pairs = await publishCowatchShadowGeneration(prisma, now, scope)
        expect(pairs).toMatchObject({
          status: "work_overflow",
          rawSourceCount: 2_048,
          sourceCount: 2_048,
          attemptedPairCount: 250_001,
          generation: null,
          contributionCount: null,
          edgeCount: null,
        })
        expect(await prisma.recommendationCowatchGeneration.count()).toBe(
          beforeCount,
        )
      } finally {
        await clearBulkEpisodes()
      }
    }, 180_000)

    it("refuses a concurrent different-scope publisher and rolls back when the first hits its write deadline", async () => {
      const day = 86_400_000
      await episode(300, mediaA, -8 * day)
      await episode(300, mediaB, -8 * day + 1_000)
      const scope = {
        version: "episode-event-window-v1" as const,
        windowStart: new Date(now.getTime() - 9 * day),
        windowEnd: new Date(now.getTime() - 8 * day),
        evaluationAsOf: now,
      }
      const beforeCount = await prisma.recommendationCowatchGeneration.count()
      const controller = new Client({ connectionString: env.DATABASE_URL })
      await controller.connect()
      await controller.query("BEGIN")
      await controller.query(
        "LOCK TABLE recommendation_cowatch_edge IN ACCESS EXCLUSIVE MODE",
      )
      const first = publishCowatchShadowGeneration(prisma, now, scope).then(
        (result) => ({ result, error: null }),
        (error: unknown) => ({ result: null, error }),
      )
      try {
        let acquired = false
        for (let attempt = 0; attempt < 50; attempt++) {
          const locks = await controller.query<{ acquired: boolean }>(
            "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 0 AND objid = $1 AND granted) AS acquired",
            [COWATCH_PUBLICATION_LOCK_ID],
          )
          if (locks.rows[0].acquired) {
            acquired = true
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        expect(acquired).toBe(true)
        await expect(
          publishCowatchShadowGeneration(prisma, now, {
            ...scope,
            windowEnd: new Date(scope.windowEnd.getTime() + 1),
          }),
        ).rejects.toThrow(/publication is already running/)
        expect(
          (await preflightCowatchShadowGeneration(prisma, now, scope)).status,
        ).toBe("ready")
        expect((await first).error).toMatchObject({
          message: expect.stringMatching(/lock timeout/),
        })
      } finally {
        await controller.query("ROLLBACK")
        await controller.end()
        await first
      }
      expect(await prisma.recommendationCowatchGeneration.count()).toBe(
        beforeCount,
      )
      const retry = await publishCowatchShadowGeneration(prisma, now, scope)
      generationIds.push(retry.generation!)
      expect(retry).toMatchObject({
        status: "published",
        sourceCount: 2,
        contributionCount: 1,
        edgeCount: 1,
        publicationRowCount: 5,
      })
    })

    it("publishes a measured dense fixture within the unchanged transaction bounds", async () => {
      const scope = {
        version: "episode-event-window-v1" as const,
        windowStart: new Date(now.getTime() - 20 * 86_400_000),
        windowEnd: new Date(now.getTime() - 19 * 86_400_000),
        evaluationAsOf: now,
      }
      try {
        await bulkEpisodes(128, true, 128, true)
        const preflight = await preflightCowatchShadowGeneration(
          prisma,
          now,
          scope,
        )
        expect(preflight).toMatchObject({
          status: "ready",
          rawSourceCount: 128,
          sourceCount: 128,
          attemptedPairCount: 8_128,
          contributionCount: 8_128,
          edgeCount: 8_128,
          publicationRowCount: 16_385,
        })
        const allocation = () => prisma.$queryRaw<
          Array<{
            relation: string
            heapBytes: bigint
            indexBytes: bigint
            totalBytes: bigint
          }>
        >`
          SELECT relname::text AS relation, pg_relation_size(oid) AS "heapBytes", pg_indexes_size(oid) AS "indexBytes", pg_total_relation_size(oid) AS "totalBytes"
          FROM pg_class WHERE relname IN ('recommendation_cowatch_generation', 'recommendation_cowatch_source_contribution', 'recommendation_cowatch_contribution', 'recommendation_cowatch_edge') ORDER BY relname
        `
        const beforeAllocation = await allocation()
        const [beforeWal] = await prisma.$queryRaw<
          Array<{ lsn: string }>
        >`SELECT pg_current_wal_lsn()::text AS lsn`
        const beforeMemory = process.memoryUsage()
        const started = performance.now()
        const result = await publishCowatchShadowGeneration(prisma, now, scope)
        const elapsedMs = performance.now() - started
        generationIds.push(result.generation!)
        expect(result.status).toBe("published")
        const afterMemory = process.memoryUsage()
        const afterAllocation = await allocation()
        const [wal] = await prisma.$queryRaw<
          Array<{ bytes: bigint }>
        >`SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), ${beforeWal.lsn}::pg_lsn)::bigint AS bytes`
        const [temp] = await prisma.$queryRaw<
          Array<{ bytes: bigint }>
        >`SELECT temp_bytes AS bytes FROM pg_stat_database WHERE datname = current_database()`
        console.info(
          "cowatch_owned_fixture_measurement",
          JSON.stringify({
            rawSourceCount: result.rawSourceCount,
            sourceCount: result.sourceCount,
            attemptedPairCount: result.attemptedPairCount,
            contributionCount: result.contributionCount,
            edgeCount: result.edgeCount,
            publicationRowCount: result.publicationRowCount,
            elapsedMs: Math.round(elapsedMs),
            walBytes: Number(wal.bytes),
            reportedDatabaseTempBytes: Number(temp.bytes),
            heapUsedBefore: beforeMemory.heapUsed,
            heapUsedAfter: afterMemory.heapUsed,
            processMaxRssKiB: process.resourceUsage().maxRSS,
            allocationDelta: afterAllocation.map((row, index) => ({
              relation: row.relation,
              heapBytes: Number(
                row.heapBytes - beforeAllocation[index].heapBytes,
              ),
              indexBytes: Number(
                row.indexBytes - beforeAllocation[index].indexBytes,
              ),
              totalBytes: Number(
                row.totalBytes - beforeAllocation[index].totalBytes,
              ),
            })),
            limits: {
              fixtureCpus: 2,
              fixtureMemoryGiB: 2,
              publishers: 1,
              statementMs: 5_000,
              lockMs: 1_000,
              transactionMs: 30_000,
            },
          }),
        )
      } finally {
        await clearBulkEpisodes()
      }
    }, 30_000)
  },
)
