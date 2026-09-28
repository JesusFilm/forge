import { createHash, randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { RECOMMENDATION_INTEGRITY_POLICY_VERSION } from "../integrity-policy"
import { loadCowatchPlayableRows } from "./candidate.service"
import { loadCowatchInspection } from "./inspection.service"
import { buildCowatchGraph } from "./graph"
import { suppressCowatchForProfiles } from "./privacy"
import {
  loadCowatchSourceRows,
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
      prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: env.DATABASE_URL, max: 2 }),
      })
    })

    afterAll(async () => {
      if (!prisma) return
      await prisma.recommendationCowatchGeneration.deleteMany({
        where: { id: { in: generationIds } },
      })
      await prisma.recommendationPlaybackEpisode.deleteMany({
        where: { id: { in: episodeIds } },
      })
      await prisma.video.deleteMany({ where: { id: { in: catalogIds } } })
      await prisma.muxVideo.deleteMany({ where: { id: { in: muxIds } } })
      await prisma.language.deleteMany({ where: { id: languageId } })
      await prisma.$disconnect()
    })

    async function episode(viewer: number, media: string, offsetMs: number) {
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
          createdAt: occurredAt,
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
  },
)
