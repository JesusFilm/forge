import { createHash, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import {
  loadCowatchSourceRows,
  publishCowatchShadowGeneration,
} from "./projection.service"
import { buildCowatchGraph, COWATCH_DURABLE_LINEAGE_VERSION } from "./graph"

const NOW = new Date("2026-09-30T19:38:04.000Z")
const scope = {
  version: "episode-event-window-v1" as const,
  windowStart: new Date("2026-09-23T12:00:00.000Z"),
  windowEnd: new Date("2026-09-30T12:00:00.000Z"),
  evaluationAsOf: new Date("2026-09-30T19:00:00.000Z"),
}
const expiresAt = new Date("2026-10-20T00:00:00.000Z")
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex")
const reference = readFileSync(
  new URL("./projection-source-reference.sql", import.meta.url),
  "utf8",
)

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "co-watch source query equivalence",
  () => {
    const prefix = `query-${randomUUID()}`
    let prisma: PrismaClient
    const graphs: string[] = []
    const profiles: string[] = []
    beforeAll(() => {
      const url = new URL(env.DATABASE_URL)
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        !["/forge_feat565_test", "/forge_cowatch_query_test"].includes(
          url.pathname,
        )
      )
        throw new Error("Source query tests require an owned loopback fixture")
      prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url.toString(), max: 2 }),
      })
    })
    afterAll(async () => {
      if (!prisma) return
      await prisma.recommendationCowatchGeneration.deleteMany({
        where: { id: { in: graphs } },
      })
      await prisma.recommendationPlaybackEpisode.deleteMany({
        where: { id: { startsWith: prefix } },
      })
      await prisma.recommendationProfile.deleteMany({
        where: { id: { in: profiles } },
      })
      await prisma.$disconnect()
    })

    async function seed(name: string, session = name, qualified = true) {
      const id = `${prefix}-${name}`
      const occurredAt = new Date(
        scope.windowStart.getTime() + name.length * 1000,
      )
      await prisma.recommendationPlaybackEpisode.create({
        data: {
          id,
          mediaId: `${prefix}-media-${name}`,
          sessionDigest: digest(`${prefix}-${session}`),
          state: "FINALIZED",
          nextFactSequence: 2,
          activeUntil: new Date(NOW.getTime() + 86_400_000),
          hardUntil: new Date(NOW.getTime() + 2 * 86_400_000),
          finalizedAt: occurredAt,
          claimedAt: occurredAt,
          createdAt: occurredAt,
          expiresAt,
        },
      })
      await prisma.recommendationOutcomeRevision.create({
        data: {
          id: `${id}-outcome`,
          episodeId: id,
          classifierVersion: "active-watch-proxy-v1",
          factWatermark: 1,
          inputDigest: digest(id),
          revision: 1,
          qualifiedView: qualified,
          viewQualityWeight: qualified ? 1 : 0,
          viewQualityWeightReason: "active_fraction_of_duration",
          activePlaybackMilliseconds: qualified ? 30_000 : 0,
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
          id: `${id}-decision`,
          sourceType: "PLAYBACK_OUTCOME",
          sourceKey: `${id}-outcome`,
          outcomeId: `${id}-outcome`,
          policyVersion: "recommendation-integrity-v1",
          revision: 1,
          actorClass: "HUMAN_SIGNED_IN",
          state: "ELIGIBLE",
          eligibleScopes: ["profile", "aggregate"],
          contributionWeight: 1,
          contributionOrdinal: 1,
          distinctSupport: 3,
          identityConcentration: 0.1,
          inputDigest: digest(`${id}-decision`),
          expiresAt,
        },
      })
      return id
    }

    async function link(session: string, suffix: string, linkedAt: Date) {
      const id = `${prefix}-profile-${suffix}`
      profiles.push(id)
      await prisma.recommendationProfile.create({
        data: {
          id,
          tokenDigest: digest(id),
          privacyGeneration: 1,
          choice: "DURABLE_ALLOWED",
          expiresAt,
        },
      })
      await prisma.recommendationProfileSessionLink.create({
        data: {
          id: `${id}-link`,
          profileId: id,
          privacyGeneration: 1,
          sessionDigest: digest(`${prefix}-${session}`),
          linkedAt,
          expiresAt,
        },
      })
      return id
    }

    it("keeps exact source rows and graph lineage across retained identity priority, denied sources and changed dependencies", async () => {
      const retained = await seed("retained", "shared")
      const olderProfile = await link(
        "shared",
        "older",
        new Date(NOW.getTime() - 2000),
      )
      const first = await publishCowatchShadowGeneration(prisma, NOW, scope)
      graphs.push(first.generation!)
      await prisma.recommendationProfileSessionLink.deleteMany({
        where: { profileId: olderProfile },
      })
      const sibling = await seed("new-sibling", "shared")
      const activeProfile = await link(
        "shared",
        "active",
        new Date(NOW.getTime() - 1000),
      )
      const second = await publishCowatchShadowGeneration(prisma, NOW, scope)
      graphs.push(second.generation!)
      await prisma.recommendationProfileSessionLink.deleteMany({
        where: { profileId: activeProfile },
      })
      const recovered = await seed("later-sibling", "shared")
      const denied = await seed("negative", "shared", false)
      const noAggregate = await seed("no-aggregate")
      await prisma.recommendationEligibilityDecision.update({
        where: { id: `${noAggregate}-decision` },
        data: { eligibleScopes: ["profile"] },
      })
      const conflict = await seed("conflict")
      await prisma.recommendationPlaybackEpisode.update({
        where: { id: conflict },
        data: { conflictCount: 1 },
      })
      const replay = await seed("replay")
      await prisma.recommendationPlaybackEpisode.update({
        where: { id: replay },
        data: { replayCount: 4 },
      })
      const expired = await seed("expired")
      await prisma.recommendationPlaybackEpisode.update({
        where: { id: expired },
        data: {
          activeUntil: new Date(NOW.getTime() - 3),
          hardUntil: new Date(NOW.getTime() - 2),
          expiresAt: new Date(NOW.getTime() - 1),
        },
      })
      const pending = await seed("pending")
      await prisma.recommendationPlaybackEpisode.update({
        where: { id: pending },
        data: {
          state: "PENDING",
          finalizedAt: null,
          claimNonceDigest: digest(pending),
          handoffExpiresAt: new Date(NOW.getTime() + 60_000),
        },
      })
      const suppressed = await seed("suppressed")
      await prisma.recommendationCowatchSuppression.create({
        data: { episodeId: suppressed, expiresAt },
      })
      const staleWatermark = await seed("watermark")
      await prisma.recommendationPlaybackEpisode.update({
        where: { id: staleWatermark },
        data: { nextFactSequence: 3 },
      })
      const corrected = await seed("corrected")
      await prisma.recommendationOutcomeRevision.create({
        data: {
          id: `${corrected}-future`,
          episodeId: corrected,
          classifierVersion: "active-watch-proxy-v1",
          factWatermark: 1,
          inputDigest: digest(`${corrected}-future`),
          revision: 2,
          supersedesId: `${corrected}-outcome`,
          qualifiedView: false,
          viewQualityWeight: 0,
          viewQualityWeightReason: "active_fraction_of_duration",
          activePlaybackMilliseconds: 0,
          durationSeconds: 30,
          durationCohort: "short",
          activeCoverage: "complete",
          generation: 2,
          createdAt: new Date(scope.evaluationAsOf.getTime() + 1),
          expiresAt,
        },
      })
      const late = await seed("late")
      await prisma.recommendationPlaybackFact.create({
        data: {
          id: `${late}-fact`,
          episodeId: late,
          capabilityJti: `${late}-capability`,
          occurredAt: NOW,
          eventId: `${late}-event`,
          sequence: 1,
          kind: "SUMMARY",
          payloadDigest: digest(late),
          payload: {},
          late: true,
          receivedAt: NOW,
          expiresAt,
        },
      })

      async function compare() {
        const oldRows = await prisma.$queryRawUnsafe<
          Awaited<ReturnType<typeof loadCowatchSourceRows>>
        >(
          reference,
          NOW,
          scope.windowStart,
          scope.windowEnd,
          scope.evaluationAsOf,
        )
        const newRows = await loadCowatchSourceRows(prisma, NOW, scope)
        expect(newRows).toEqual(oldRows)
        const graph = (rows: typeof newRows) =>
          buildCowatchGraph(
            rows.map((row) => ({
              ...row,
              viewerKey:
                row.profileId == null
                  ? `session:${row.sessionDigest}`
                  : `profile:${row.profileId}:${row.privacyGeneration}`,
              qualityWeight: row.qualityWeight ?? 0,
            })),
            NOW,
            scope,
            COWATCH_DURABLE_LINEAGE_VERSION,
          )
        expect(graph(newRows)).toEqual(graph(oldRows))
        return newRows
      }
      const rows = await compare()
      expect(rows).toHaveLength(13)
      expect(
        rows.find((row) => row.episodeId === retained)?.profileId,
      ).not.toBeNull()
      expect(rows.find((row) => row.episodeId === sibling)?.profileId).toBe(
        activeProfile,
      )
      expect(
        rows.find((row) => row.episodeId === recovered)?.profileId,
      ).not.toBeNull()
      expect(rows.find((row) => row.episodeId === denied)?.qualified).toBe(
        false,
      )
      for (const id of [
        noAggregate,
        conflict,
        replay,
        expired,
        suppressed,
        staleWatermark,
        corrected,
        late,
      ])
        expect(
          rows.find((row) => row.episodeId === id)?.integrityEligible,
        ).toBe(false)
      expect(rows.find((row) => row.episodeId === pending)?.finalized).toBe(
        false,
      )
      // The same receipt can survive in many retained generations. Resolve
      // ownership before joining episodes while preserving the original oracle.
      const template =
        await prisma.recommendationCowatchGeneration.findUniqueOrThrow({
          where: { id: second.generation! },
        })
      const retainedSources =
        await prisma.recommendationCowatchSourceContribution.findMany({
          where: { generationId: second.generation! },
        })
      const overlap = Array.from({ length: 58 }, (_, index) => ({
        ...template,
        id: digest(`${prefix}-overlap-${index}`),
      }))
      graphs.push(...overlap.map((generation) => generation.id))
      await prisma.recommendationCowatchGeneration.createMany({
        data: overlap,
      })
      await prisma.recommendationCowatchSourceContribution.createMany({
        data: overlap.flatMap((generation) =>
          retainedSources.map((source) => ({
            ...source,
            id: digest(`${generation.id}-${source.id}`),
            generationId: generation.id,
          })),
        ),
      })
      const manyRetained = await compare()
      expect(manyRetained).toHaveLength(13)
      expect(
        manyRetained.find((row) => row.episodeId === sibling)?.profileId,
      ).toBe(activeProfile)
      // An exact-episode receipt need not share the current session. It must
      // still participate in both identity priority and invalid-owner fencing.
      const foreignProfile = await link("foreign", "foreign", NOW)
      await prisma.recommendationProfileSessionLink.deleteMany({
        where: { profileId: foreignProfile },
      })
      const foreignGeneration = digest(`${prefix}-foreign-generation`)
      graphs.push(foreignGeneration)
      await prisma.recommendationCowatchGeneration.create({
        data: { ...template, id: foreignGeneration },
      })
      const exactSource = retainedSources.find(
        (source) => source.outcomeId === `${retained}-outcome`,
      )!
      await prisma.recommendationCowatchSourceContribution.create({
        data: {
          ...exactSource,
          id: digest(`${prefix}-foreign-source`),
          generationId: foreignGeneration,
          sessionDigest: digest(`${prefix}-foreign-session`),
          viewerProfileId: foreignProfile,
          occurredAt: NOW,
        },
      })
      const foreignExact = await compare()
      expect(
        foreignExact.find((row) => row.episodeId === retained)?.profileId,
      ).toBe(foreignProfile)
      const directProfile = await link("shared", "direct", NOW)
      const directlyLinked = await compare()
      for (const id of [retained, sibling, recovered, denied])
        expect(
          directlyLinked.find((row) => row.episodeId === id)?.profileId,
        ).toBe(directProfile)
      await prisma.recommendationProfileSessionLink.deleteMany({
        where: { profileId: directProfile },
      })
      await prisma.recommendationProfile.update({
        where: { id: foreignProfile },
        data: { privacyGeneration: 2 },
      })
      const exactFenced = await compare()
      for (const id of [retained, sibling, recovered, denied])
        expect(
          exactFenced.find((row) => row.episodeId === id)?.integrityEligible,
        ).toBe(id !== retained)
      await prisma.recommendationProfile.update({
        where: { id: olderProfile },
        data: { privacyGeneration: 2 },
      })
      const fenced = await compare()
      for (const id of [retained, sibling, recovered, denied])
        expect(
          fenced.find((row) => row.episodeId === id)?.integrityEligible,
        ).toBe(false)
      const legacyOnly = await seed("legacy-only")
      const legacyProfile = await link("legacy-only", "legacy", NOW)
      await prisma.recommendationProfileSessionLink.deleteMany({
        where: { profileId: legacyProfile },
      })
      const legacyGeneration = digest(`${prefix}-legacy-generation`)
      graphs.push(legacyGeneration)
      await prisma.recommendationCowatchGeneration.create({
        data: {
          ...template,
          id: legacyGeneration,
          lineageVersion: "discovery-link-v1",
        },
      })
      await prisma.recommendationCowatchSourceContribution.create({
        data: {
          ...exactSource,
          id: digest(`${prefix}-legacy-source`),
          generationId: legacyGeneration,
          outcomeId: `${legacyOnly}-outcome`,
          eligibilityDecisionId: `${legacyOnly}-decision`,
          viewerProfileId: legacyProfile,
          viewerPrivacyGeneration: null,
          sessionDigest: digest(`${prefix}-legacy-only`),
        },
      })
      const legacyKnown = await compare()
      expect(
        legacyKnown.find((row) => row.episodeId === legacyOnly),
      ).toMatchObject({ profileId: null, integrityEligible: false })
      const legacyLinked = await link("legacy-only", "legacy-current", NOW)
      const legacyWithLink = await compare()
      expect(
        legacyWithLink.find((row) => row.episodeId === legacyOnly),
      ).toMatchObject({ profileId: legacyLinked, integrityEligible: true })
    })
  },
)
