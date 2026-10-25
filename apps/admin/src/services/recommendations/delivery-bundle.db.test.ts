import { randomUUID } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { env } from "@/config/env"
import {
  activateBundleFixtureStudy,
  bundleFixtureArm,
  bundleFixtureDay,
  bundleFixtureDigest,
  seedMatureBundleCalibration,
} from "./delivery-bundle-calibration.test-helper"
import { seedApprovedBundleGraph } from "./delivery-bundle-graph.test-helper"
import {
  composeDeliveryCowatchTrial,
  resolveDeliveryStudyAuthority,
} from "./delivery-trial.service"
import {
  makeHarness,
  personalizedInput,
  profileCandidateResult,
  semanticCandidates,
} from "./delivery.service.test-helpers"
import {
  parseStudyProtocol,
  studyProtocolDigest,
} from "./experiment/study-protocol"
import { assignProfileUsefulnessExperiment } from "./experiment/usefulness-routing"
import { extractUsefulnessSnapshot } from "./experiment/usefulness-extractor"
import {
  COWATCH_MMR_TRIAL_MANIFEST,
  COWATCH_MMR_GENERATOR_SET_VERSION,
  INCUMBENT_HYBRID_MANIFEST_ID,
  recommendationManifestDigest,
} from "./promotion/manifest"

// Full native dependency chain; all inputs are local synthetic fixtures, never
// production evidence. The service computes every approval/PASS itself.
describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "activated co-watch/MMR bundle through delivery",
  () => {
    const databaseName = `delivery_bundle_${randomUUID().replaceAll("-", "")}`
    let admin: Client, migration: Client, db: PrismaClient
    let created = false
    beforeAll(async () => {
      const url = new URL(env.DATABASE_URL)
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        !["/forge_feat565_test", "/forge_test"].includes(url.pathname) ||
        url.search ||
        url.hash
      )
        throw new Error("Owned loopback recommendation fixture required")
      admin = new Client({ connectionString: url.toString() })
      await admin.connect()
      // Create/drop only this uniquely named child database. The parent fixture
      // remains untouched, including its schemas and migration bookkeeping.
      await admin.query(`CREATE DATABASE "${databaseName}"`)
      created = true
      url.pathname = `/${databaseName}`
      migration = new Client({ connectionString: url.toString() })
      await migration.connect()
      const root = new URL("../../../prisma/migrations/", import.meta.url)
      for (const name of readdirSync(root)
        .filter((name) => /^\d{4}_/.test(name))
        .sort())
        await migration.query(
          readFileSync(new URL(`${name}/migration.sql`, root), "utf8"),
        )
      await migration.end()
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url.toString(), max: 4 }),
      })
    }, 120_000)
    afterAll(async () => {
      await db?.$disconnect()
      await migration?.end().catch(() => {})
      if (admin) {
        if (created)
          await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`)
        await admin.end()
      }
    })

    it("activates exact approved lineage, issues the real composed slate, and fences fallback/invalidation", async () => {
      const calibration = await seedMatureBundleCalibration(db)
      const source = await seedApprovedBundleGraph(db)
      const { graph } = source
      expect(source.generation.publishedAt >= calibration.completedAt).toBe(
        true,
      )
      const activationAt = new Date()
      const startsAt = new Date(activationAt.getTime() + 1_000)
      const endsAt = new Date(startsAt.getTime() + bundleFixtureDay)
      const trialValidUntil = new Date(endsAt.getTime() + 30 * 3_600_000)
      const earliestDependencyExpiresAt = new Date(
        Math.min(
          source.compositionValidUntil.getTime(),
          source.generation.expiresAt.getTime(),
        ),
      )
      expect(earliestDependencyExpiresAt > trialValidUntil).toBe(true)
      const protocolInput = {
        ...calibration.protocol,
        mode: "efficacy",
        comparison: "incumbent-cowatch-mmr",
        challengerManifestId: COWATCH_MMR_TRIAL_MANIFEST.id,
        challengerManifestDigest: recommendationManifestDigest(
          COWATCH_MMR_TRIAL_MANIFEST,
        ),
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        expiresAt: calibration.expiresAt.toISOString(),
        minimumUsefulDelta: 0.01,
        calibrationEvaluationId: calibration.evaluationId,
        cowatch: {
          mode: "frozen-source-controlled-trial-v1",
          graphGenerationId: graph.graphGenerationId,
          sourceWindow: {
            version: graph.sourceWindow.version,
            windowStart: graph.sourceWindow.windowStart.toISOString(),
            windowEnd: graph.sourceWindow.windowEnd.toISOString(),
            evaluationAsOf: graph.sourceWindow.evaluationAsOf.toISOString(),
          },
          calibrationCompletedAt: calibration.completedAt.toISOString(),
          trialValidUntil: trialValidUntil.toISOString(),
          earliestDependencyExpiresAt:
            earliestDependencyExpiresAt.toISOString(),
          shadowEvaluationId: source.evaluationId,
          shadowDecisionId: source.shadowDecisionId,
        },
        composition: source.composition,
      }
      let protocol = parseStudyProtocol({
        ...protocolInput,
        studyId: `bundle-trial-${randomUUID()}`,
      })
      while (
        bundleFixtureArm(
          protocol.studyId,
          studyProtocolDigest(protocol),
          graph.profileId,
        ) !== "CHALLENGER"
      )
        protocol = parseStudyProtocol({
          ...protocolInput,
          studyId: `bundle-trial-${randomUUID()}`,
        })
      const prepared = await activateBundleFixtureStudy(
        db,
        protocol,
        activationAt,
      )
      const graphAuthority =
        await db.recommendationCowatchTrialAuthority.findUniqueOrThrow({
          where: { generationId: graph.graphGenerationId },
        })
      expect(graphAuthority.binding).toMatchObject({
        studyId: protocol.studyId,
        protocolDigest: prepared.protocolDigest,
        shadowEvaluationId: source.evaluationId,
        shadowDecisionId: source.shadowDecisionId,
        graphGenerationId: graph.graphGenerationId,
      })
      expect(graphAuthority.revokedAt).toBeNull()
      // Real serving clocks remain in use. Only setup needed a historical A/A
      // interval; activate still precedes this actual enrollment start.
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, startsAt.getTime() - Date.now() + 1)),
      )
      const compose = vi.fn(
        (input: Parameters<typeof composeDeliveryCowatchTrial>[1]) =>
          composeDeliveryCowatchTrial(db, input),
      )
      const harness = makeHarness({
        database: db,
        profileComparison: true,
        candidateTraceFormat: "compact",
        study: {
          resolveStudyAuthority: (input) =>
            resolveDeliveryStudyAuthority(db, input),
          composeCowatchTrial: compose,
        },
      })
      harness.assignProfileExperiment.mockImplementation(
        (input?: Parameters<typeof assignProfileUsefulnessExperiment>[1]) => {
          if (!input) throw new Error("Native assignment input required")
          return assignProfileUsefulnessExperiment(db, input)
        },
      )
      harness.retrieve.mockResolvedValue(semanticCandidates(6))
      harness.retrieveProfile.mockResolvedValue({
        ...profileCandidateResult,
        projection: {
          ...profileCandidateResult.projection,
          id: source.projection.id,
          scope: "durable",
          generation: 1,
          inputDigest: source.projection.inputDigest,
          publishedAt: source.projection.publishedAt,
          expiresAt: graph.expiresAt,
          sessionIntentPresent: false,
        },
        nominations: profileCandidateResult.nominations.map((row) => ({
          ...row,
          source: {
            ...row.source,
            evidence: { ...row.source.evidence, interestKind: "durable" },
          },
        })),
      })
      const input = {
        ...personalizedInput(graph.mediaA),
        clientDeliveryContract: "cowatch-mmr-v1",
        sessionDigest: graph.sessionDigest,
        profileTokenDigest: bundleFixtureDigest(graph.profileId),
      }
      // Legacy/unknown parsers get ordinary recommendations, but cannot enroll.
      for (const clientDeliveryContract of [null, "unknown-parser"]) {
        const ordinary = await harness.service.deliver({
          ...input,
          clientDeliveryContract,
        })
        expect(ordinary).toMatchObject({
          result: "served",
          personalization: { executionMode: "hybrid_personalized" },
        })
        expect(
          await db.recommendationRequest.findUniqueOrThrow({
            where: { id: ordinary.requestId! },
          }),
        ).toMatchObject({ experimentAssignmentId: null })
      }
      expect(compose).not.toHaveBeenCalled()
      expect(
        await db.recommendationExperimentAssignment.count({
          where: { experimentId: protocol.studyId },
        }),
      ).toBe(0)
      const coldStarted = performance.now()
      const delivered = await harness.service.deliver(input)
      const coldElapsedMs = performance.now() - coldStarted
      expect(await compose.mock.results[0]?.value).toMatchObject({
        status: "composed",
      })
      expect(delivered).toMatchObject({
        result: "served",
        personalization: {
          executionMode: "cowatch_mmr_personalized",
          effectiveManifestId: COWATCH_MMR_TRIAL_MANIFEST.id,
        },
      })
      const request = await db.recommendationRequest.findUniqueOrThrow({
        where: { id: delivered.requestId! },
        include: {
          items: true,
          candidateRun: true,
          personalizationDecision: true,
        },
      })
      expect(request.state).toBe("ISSUED")
      expect(
        request.items.find((item) => item.targetMediaId === graph.mediaB),
      ).toMatchObject({ candidateGenerator: "directional-cowatch" })
      expect(request.candidateRun).toMatchObject({
        generatorVersion: COWATCH_MMR_GENERATOR_SET_VERSION,
        composerVersion: "source-interest-theme-mmr-v1",
        evidenceComplete: true,
      })
      const trace = JSON.stringify(request.candidateRun!.tracePayload)
      expect(trace).toContain(source.composition.protocolId)
      expect(trace).toContain(prepared.protocolDigest)
      expect(trace).toContain(graph.graphGenerationId)
      expect(trace.match(/"compositionProtocolId"/g)).toHaveLength(1)
      const assignment =
        await db.recommendationExperimentAssignment.findUniqueOrThrow({
          where: { id: request.experimentAssignmentId! },
        })
      expect(assignment).toMatchObject({
        experimentId: protocol.studyId,
        arm: "CHALLENGER",
        configurationDigest: prepared.protocolDigest,
        assignmentProbability: 0.5,
      })
      // Older-tab follow-up retains assignment, but uses the real incumbent.
      const oldTab = await harness.service.deliver({
        ...input,
        clientDeliveryContract: null,
        sessionDigest: bundleFixtureDigest("older-tab-session"),
      })
      expect(oldTab).toMatchObject({
        result: "fallback",
        reason: "client_contract_unsupported",
        personalization: {
          executionMode: "hybrid_personalized",
          effectiveManifestId: INCUMBENT_HYBRID_MANIFEST_ID,
          reason: "cowatch_mmr_incumbent_fallback",
        },
      })
      expect(
        oldTab.items.every((item) =>
          ["semantic", "multi-interest-profile", "curated"].includes(
            item.candidateGenerator,
          ),
        ),
      ).toBe(true)
      expect(compose).toHaveBeenCalledTimes(1)
      expect(
        await db.recommendationRequest.findUniqueOrThrow({
          where: { id: oldTab.requestId! },
        }),
      ).toMatchObject({
        state: "ISSUED",
        experimentAssignmentId: assignment.id,
        fallbackReason: "client_contract_unsupported",
      })
      const warmStarted = performance.now()
      const warm = await harness.service.deliver(input)
      const warmElapsedMs = performance.now() - warmStarted
      expect(await compose.mock.results[1]?.value).toMatchObject({
        status: "composed",
      })
      expect(warm).toMatchObject({
        result: "served",
        personalization: {
          executionMode: "cowatch_mmr_personalized",
          effectiveManifestId: COWATCH_MMR_TRIAL_MANIFEST.id,
        },
      })
      expect(
        await db.recommendationRequest.findUniqueOrThrow({
          where: { id: warm.requestId! },
        }),
      ).toMatchObject({
        state: "ISSUED",
        experimentAssignmentId: assignment.id,
      })
      expect(
        await db.recommendationExperimentAssignment.count({
          where: { experimentId: protocol.studyId },
        }),
      ).toBe(1)
      const extracted = await extractUsefulnessSnapshot(db, {
        experimentId: protocol.studyId,
        configurationDigest: prepared.protocolDigest,
        enrollmentStart: startsAt,
        enrollmentEnd: endsAt,
        plannedAssignmentsPerArm: protocol.plannedAssignmentsPerArm,
        minimumUsefulDelta: protocol.minimumUsefulDelta,
      })
      expect(extracted.snapshot.units).toContainEqual(
        expect.objectContaining({
          unitDigest: assignment.unitDigest,
          arm: "challenger",
          qualifiedViews: 0,
        }),
      )
      expect(extracted.snapshot.health.contaminatedAssignments).toBe(0)
      // Full graph/authority/MMR/issuance latency in this isolated fixture only;
      // this is a deadline regression guard, not production-load evidence.
      expect(coldElapsedMs).toBeLessThan(1_500)
      expect(warmElapsedMs).toBeLessThan(1_500)
      console.info("Native activated-bundle fixture delivery milliseconds", {
        cold: Math.round(coldElapsedMs),
        warm: Math.round(warmElapsedMs),
      })

      // A request-local catalog miss retains the actual incumbent and assignment.
      await db.videoDub.updateMany({
        where: { videoId: graph.mediaB },
        data: { published: false },
      })
      const fallback = await harness.service.deliver(input)
      expect(await compose.mock.results[2]?.value).toEqual({
        status: "fallback",
        reason: "cowatch_unplayable",
      })
      expect(fallback).toMatchObject({
        result: "fallback",
        personalization: {
          executionMode: "hybrid_personalized",
          effectiveManifestId: INCUMBENT_HYBRID_MANIFEST_ID,
          reason: "cowatch_mmr_incumbent_fallback",
        },
      })
      expect(
        await db.recommendationRequest.findUniqueOrThrow({
          where: { id: fallback.requestId! },
        }),
      ).toMatchObject({
        state: "ISSUED",
        experimentAssignmentId: assignment.id,
      })
      await db.videoDub.updateMany({
        where: { videoId: graph.mediaB },
        data: { published: true },
      })

      // Change an unrelated graph contributor after real composition. The final
      // issuance transaction must observe its durable graph/study invalidation.
      const countBefore = await db.recommendationRequest.count({
        where: { experimentAssignmentId: assignment.id },
      })
      harness.signDeliveryCapability.mockImplementationOnce(async ({ jti }) => {
        await db.recommendationPlaybackEpisode.update({
          where: { id: graph.episodes[2]! },
          data: { conflictCount: 1 },
        })
        return `token:${jti}`
      })
      const fenced = await harness.service.deliver(input)
      expect(await compose.mock.results[3]?.value).toMatchObject({
        status: "composed",
      })
      expect(fenced).toMatchObject({
        result: "unavailable",
        reason: "persistence_unavailable",
        items: [],
      })
      expect(
        await db.recommendationRequest.count({
          where: { experimentAssignmentId: assignment.id },
        }),
      ).toBe(countBefore)
      expect(
        (
          await db.recommendationCowatchTrialAuthority.findUniqueOrThrow({
            where: { generationId: graph.graphGenerationId },
          })
        ).revokedAt,
      ).not.toBeNull()
      expect(
        await db.recommendationExperimentAssignment.count({
          where: { id: assignment.id },
        }),
      ).toBe(1)
    }, 120_000)
  },
)
