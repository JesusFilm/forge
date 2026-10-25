import { createHash, randomUUID } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Principal } from "@/auth/principal"
import { env } from "@/config/env"
import type { LiveProfileCandidateResult } from "./candidates/profile-candidate.service"
import { HYBRID_CANDIDATE_GENERATOR_SET_VERSION } from "./candidate"
import { resolveDeliveryStudyAuthority } from "./delivery-trial.service"
import {
  makeHarness,
  personalizedInput,
  profileCandidateResult,
  semanticCandidates,
} from "./delivery.service.test-helpers"
import {
  chooseExperimentArm,
  type ExperimentAssignmentContext,
} from "./experiment/assignment"
import { RecommendationStudyService } from "./experiment/study-service"
import { assignProfileUsefulnessExperiment } from "./experiment/usefulness-routing"
import { extractUsefulnessSnapshot } from "./experiment/usefulness-extractor"
import {
  INCUMBENT_HYBRID_MANIFEST_ID,
  INCUMBENT_HYBRID_AA_MANIFEST_ID,
  recommendationManifestDigest,
} from "./promotion/manifest"

// Real study lifecycle, enrollment, current authority, final issuance locks and
// PostgreSQL constraints. Catalog/profile retrieval, admission and signing are
// synthetic boundaries; this is not a source-quality or usefulness experiment.
describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "activated incumbent A/A through native delivery",
  () => {
    const schema = `delivery_trial_${randomUUID().replaceAll("-", "")}`
    const day = 86_400_000
    const startsAt = new Date(Math.floor(Date.now() / day) * day)
    const expiresAt = new Date(startsAt.getTime() + 25 * day)
    const preparationTime = new Date(startsAt.getTime() - 3_600_000)
    const studyId = `delivery-study-${randomUUID()}`
    const actor: Principal = { id: "native-delivery-operator", role: "ADMIN" }
    const digest = (value: string) =>
      createHash("sha256").update(value).digest("hex")
    let admin: Client
    let prisma: PrismaClient
    let protocolDigest: string

    beforeAll(async () => {
      const url = new URL(env.DATABASE_URL)
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        !["/forge_test", "/forge_study", "/forge_feat565_test"].includes(
          url.pathname,
        )
      )
        throw new Error("Owned loopback recommendation fixture required")
      admin = new Client({ connectionString: env.DATABASE_URL })
      await admin.connect()
      // Only our random schema is created/dropped. Existing fixture migrations,
      // schemas and data are never reset or rewritten.
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`SET search_path TO "${schema}", public`)
      const root = new URL("../../../prisma/migrations/", import.meta.url)
      for (const name of readdirSync(root)
        .filter((name) => {
          const number = Number(name.slice(0, 4))
          return (
            (number >= 52 &&
              number <= 110 &&
              name.includes("recommendation")) ||
            name === "0057_semantic_control_readiness"
          )
        })
        .sort())
        await admin.query(
          readFileSync(new URL(`${name}/migration.sql`, root), "utf8"),
        )
      prisma = new PrismaClient({
        adapter: new PrismaPg(
          {
            connectionString: env.DATABASE_URL,
            options: `-c search_path=${schema},public`,
          },
          { schema },
        ),
      })
      const service = new RecommendationStudyService(
        prisma,
        () => preparationTime,
      )
      const control =
        await prisma.recommendationStrategyManifest.findUniqueOrThrow({
          where: { id: INCUMBENT_HYBRID_MANIFEST_ID },
        })
      const challenger =
        await prisma.recommendationStrategyManifest.findUniqueOrThrow({
          where: { id: INCUMBENT_HYBRID_AA_MANIFEST_ID },
        })
      const prepared = await service.prepare(actor, {
        version: "profile-study-governance-v1",
        studyId,
        mode: "calibration",
        comparison: "incumbent-aa",
        identity: "anonymous-profile-generation-v1",
        surface: "watch-below-player-v1",
        cohort: "human-en-english-durable-client-cowatch-mmr-v1",
        controlManifestId: control.id,
        challengerManifestId: challenger.id,
        controlManifestDigest: recommendationManifestDigest(control),
        challengerManifestDigest: recommendationManifestDigest(challenger),
        incumbentExecution: "hybrid_personalized",
        controlExecution: "profile-viewing-mode-incumbent-v1",
        admissionBps: 10_000,
        challengerProbability: 0.5,
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 2 * day).toISOString(),
        expiresAt: expiresAt.toISOString(),
        stoppingRule: "fixed-enrollment-window-v1",
        plannedAssignmentsPerArm: 200,
        minimumUsefulDelta: null,
        evidenceMaxAgeHours: 24,
        calibrationEvaluationId: null,
      })
      protocolDigest = prepared.protocolDigest
      const evidenceId = randomUUID()
      const receipt = {
        source: "reviewed-artifact",
        reference: "synthetic-native-delivery-fixture-only",
        sha256: digest(schema),
      }
      await service.recordEvidence(actor, {
        studyId,
        protocolDigest,
        evidenceId,
        evidence: {
          kind: "readiness",
          capturedAt: preparationTime.toISOString(),
          validUntil: new Date(startsAt.getTime() + 3_600_000).toISOString(),
          collection: receipt,
          retention: receipt,
          storage: receipt,
          rollback: receipt,
        },
      })
      const pointer =
        await prisma.recommendationPromotionPointer.findUniqueOrThrow({
          where: { id: "recommendation-promotion-pointer" },
        })
      await service.activate(actor, {
        studyId,
        protocolDigest,
        evidenceId,
        operationId: randomUUID(),
        expectedPointerGeneration: pointer.generation,
      })
      expect(await prisma.recommendationExperimentEvaluation.count()).toBe(0)
    }, 60_000)

    afterAll(async () => {
      await prisma?.$disconnect()
      if (admin) {
        await admin.query("ROLLBACK")
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
    })

    async function viewer(arm: "CONTROL" | "CHALLENGER") {
      // Choose fixture identities for each arm without overriding assignment or
      // inserting its row. Actual enrollment still happens inside deliver().
      const prefix = randomUUID()
      let profileId = ""
      for (let index = 0; index < 100; index++) {
        const candidate = `${prefix}-${index}`
        const unitDigest = digest(
          `recommendation-experiment-unit:v1\0${studyId}\0profile:${candidate}:1`,
        )
        if (
          chooseExperimentArm({
            unitDigest,
            configurationDigest: protocolDigest,
            challengerProbability: 0.5,
          }) === arm
        ) {
          profileId = candidate
          break
        }
      }
      expect(profileId).not.toBe("")
      const tokenDigest = digest(profileId)
      await prisma.recommendationProfile.create({
        data: {
          id: profileId,
          tokenDigest,
          choice: "DURABLE_ALLOWED",
          privacyGeneration: 1,
          expiresAt,
        },
      })
      const now = new Date()
      const projection =
        await prisma.recommendationProfileProjectionGeneration.create({
          data: {
            manifestId: "semantic-profile-hybrid-v1",
            scope: "DURABLE",
            profileId,
            privacyGeneration: 1,
            generation: 1,
            state: "PUBLISHED",
            projectionVersion: "multi-interest-profile-projection-v1",
            clusteringVersion: "deterministic-farthest-first-medoids-v1",
            eligibilityPolicyVersion: "recommendation-integrity-v1",
            outcomeClassifierVersion: "active-watch-proxy-v1",
            inputWindowStart: new Date(now.getTime() - day),
            inputWindowEnd: now,
            inputDigest: digest(`projection:${profileId}`),
            durableInterestCount: 1,
            cohortQuality: 0.8,
            publishedAt: now,
            expiresAt,
            retentionDays: 180,
          },
        })
      const profile: LiveProfileCandidateResult = {
        ...profileCandidateResult,
        projection: {
          ...profileCandidateResult.projection,
          id: projection.id,
          scope: "durable",
          generation: 1,
          inputDigest: projection.inputDigest,
          publishedAt: now,
          expiresAt,
          sessionIntentPresent: false,
        },
        nominations: profileCandidateResult.nominations.map((row) => ({
          ...row,
          source: {
            ...row.source,
            evidence: { ...row.source.evidence, interestKind: "durable" },
          },
        })),
      }
      const harness = makeHarness({
        database: prisma,
        candidateTraceFormat: "compact",
        profileComparison: true,
        study: {
          resolveStudyAuthority: (input) =>
            resolveDeliveryStudyAuthority(prisma, input),
        },
      })
      harness.assignProfileExperiment.mockImplementation(
        (input?: Parameters<typeof assignProfileUsefulnessExperiment>[1]) => {
          if (!input) throw new Error("Delivery assignment input required")
          return assignProfileUsefulnessExperiment(prisma, input)
        },
      )
      harness.retrieve.mockResolvedValue(semanticCandidates(6))
      harness.retrieveProfile.mockResolvedValue(profile)
      const request = (seed = `delivery-native-${randomUUID()}`) => ({
        ...personalizedInput(seed),
        clientDeliveryContract: "cowatch-mmr-v1",
        sessionDigest: digest(`session:${profileId}`),
        profileTokenDigest: tokenDigest,
      })
      return { harness, request, profileId, projectionId: projection.id }
    }

    async function persisted(requestId: string) {
      const [request, run, personalization] = await Promise.all([
        prisma.recommendationRequest.findUniqueOrThrow({
          where: { id: requestId },
          include: { items: { orderBy: { position: "asc" } } },
        }),
        prisma.recommendationCandidateRun.findUniqueOrThrow({
          where: { requestId },
        }),
        prisma.recommendationPersonalizationDecision.findUniqueOrThrow({
          where: { requestId },
        }),
      ])
      return { request, run, personalization }
    }

    it("issues both real A/A arms under the same incumbent policy and retains sticky assignments", async () => {
      const orders: string[][] = []
      for (const arm of ["CONTROL", "CHALLENGER"] as const) {
        const { harness, request, profileId, projectionId } = await viewer(arm)
        const response = await harness.service.deliver(request())
        expect(response.result).toBe("served")
        expect(response.items).toHaveLength(6)
        const row = await persisted(response.requestId!)
        const assignment =
          await prisma.recommendationExperimentAssignment.findUniqueOrThrow({
            where: { id: row.request.experimentAssignmentId! },
          })
        expect(assignment).toMatchObject({
          profileId,
          arm,
          experimentId: studyId,
          configurationDigest: protocolDigest,
          assignmentProbability: 0.5,
          privacyGeneration: 1,
          state: "ACTIVE",
        })
        expect(row.request).toMatchObject({ state: "ISSUED", result: "SERVED" })
        expect(row.request.items).toHaveLength(6)
        expect(row.personalization).toMatchObject({
          effectiveManifestId:
            arm === "CONTROL"
              ? INCUMBENT_HYBRID_MANIFEST_ID
              : INCUMBENT_HYBRID_AA_MANIFEST_ID,
          executionMode: "hybrid_personalized",
          projectionGenerationId: projectionId,
          projectionScope: "durable",
          interestCount: 1,
        })
        expect(row.run).toMatchObject({
          generatorVersion: HYBRID_CANDIDATE_GENERATOR_SET_VERSION,
          rankerVersion: "source-rank-hybrid-ranker-v1",
          composerVersion: "recent-video-refill-composer-v1",
          evidenceComplete: true,
          traceFormatVersion: 1,
          composedCount: 6,
        })
        expect(row.run.tracePayload).toMatchObject({
          stages: expect.arrayContaining([
            expect.objectContaining({ stage: "nominated" }),
            expect.objectContaining({ stage: "composed" }),
          ]),
        })
        expect(
          await prisma.recommendationCandidateStageEvidence.count({
            where: { runId: row.run.id },
          }),
        ).toBe(0)
        expect(harness.loadViewingModeAffinity).toHaveBeenCalled()
        orders.push(row.request.items.map((item) => item.targetMediaId))
        const repeated = await harness.service.deliver({
          ...request(),
          sessionDigest: digest(`another-session:${profileId}`),
        })
        expect(repeated.result).toBe("served")
        expect((await persisted(repeated.requestId!)).request).toMatchObject({
          experimentAssignmentId: assignment.id,
        })
        expect(
          await prisma.recommendationExperimentAssignment.count({
            where: { profileId, experimentId: studyId },
          }),
        ).toBe(1)
      }
      expect(orders[0]).toEqual(orders[1])
    })

    it("persists the viewing-mode incumbent in both arms with the real profile issuance fence", async () => {
      const orders: string[][] = []
      for (const arm of ["CONTROL", "CHALLENGER"] as const) {
        const { harness, request, profileId } = await viewer(arm)
        harness.loadViewingModeAffinity.mockResolvedValue({
          authority: { profileId, privacyGeneration: 1 },
          version: "viewing-mode-affinity-v1",
          soundOffPreference: 1,
          confidence: 1,
          qualifiedVideos: 3,
          candidates: [
            {
              mediaId: "semantic-video-2",
              viewers: 30,
              qualifiedViewers: 28,
              affinity: 0.8,
            },
          ],
        })
        const response = await harness.service.deliver(request())
        expect(response).toMatchObject({
          result: "served",
          personalization: {
            executionMode: "viewing_mode_personalized",
            reason: "viewing_mode_preference",
          },
        })
        const row = await persisted(response.requestId!)
        expect(row.run.rankerVersion).toBe("viewing-mode-affinity-v1")
        expect(row.personalization).toMatchObject({
          executionMode: "viewing_mode_personalized",
          effectiveManifestId:
            arm === "CONTROL"
              ? INCUMBENT_HYBRID_MANIFEST_ID
              : INCUMBENT_HYBRID_AA_MANIFEST_ID,
        })
        orders.push(row.request.items.map((item) => item.targetMediaId))
      }
      expect(orders[0]).toEqual(orders[1])
    })

    it.each(["source-error", "cold-start"])(
      "persists %s fallback without losing the original assigned denominator",
      async (failure) => {
        const { harness, request, profileId } = await viewer("CHALLENGER")
        const initial = await harness.service.deliver(request())
        expect(initial.result).toBe("served")
        const initialRow = await persisted(initial.requestId!)
        if (failure === "source-error")
          harness.retrieveProfile.mockRejectedValue(
            new Error("fixture source down"),
          )
        else harness.retrieveProfile.mockResolvedValue(null)
        const fallback = await harness.service.deliver(request())
        expect(fallback).toMatchObject({
          result: "fallback",
          personalization: {
            effectiveManifestId: INCUMBENT_HYBRID_MANIFEST_ID,
            executionMode: "semantic_fallback",
            reason: "incumbent_operational_fallback",
          },
        })
        const row = await persisted(fallback.requestId!)
        expect(row.request).toMatchObject({
          state: "ISSUED",
          result: "FALLBACK",
          experimentAssignmentId: initialRow.request.experimentAssignmentId,
        })
        expect(row.personalization).toMatchObject({
          effectiveManifestId: INCUMBENT_HYBRID_MANIFEST_ID,
          reasonCode: "incumbent_operational_fallback",
          projectionGenerationId: null,
        })
        expect(row.run.evidenceComplete).toBe(false)
        expect(row.run.tracePayload).toMatchObject({
          stages: expect.arrayContaining([
            expect.objectContaining({
              reasonCodes: expect.arrayContaining([
                failure === "source-error"
                  ? "profile_projection_unavailable"
                  : "profile_cold_start",
              ]),
            }),
          ]),
        })
        expect(
          await prisma.recommendationExperimentAssignment.count({
            where: { profileId, experimentId: studyId },
          }),
        ).toBe(1)
        const assignment =
          await prisma.recommendationExperimentAssignment.findUniqueOrThrow({
            where: { id: row.request.experimentAssignmentId! },
          })
        const extracted = await extractUsefulnessSnapshot(prisma, {
          experimentId: studyId,
          configurationDigest: protocolDigest,
          enrollmentStart: startsAt,
          enrollmentEnd: new Date(startsAt.getTime() + 2 * day),
          plannedAssignmentsPerArm: 200,
          minimumUsefulDelta: null,
        })
        expect(extracted.snapshot.units).toContainEqual(
          expect.objectContaining({
            unitDigest: assignment.unitDigest,
            arm: "challenger",
            qualifiedViews: 0,
          }),
        )
        expect(extracted.snapshot.health.contaminatedAssignments).toBe(0)
        expect(extracted.snapshot.health.routingVerified).toBe(true)
        // A tiny, unfinished native fixture must never manufacture A/A PASS.
        expect(extracted.snapshot.health.aaPassed).toBe(false)
      },
    )

    it("does not issue if active authority disappears after real enrollment", async () => {
      const { harness, request, profileId } = await viewer("CONTROL")
      harness.assignProfileExperiment.mockImplementationOnce(
        async (
          input?: Parameters<typeof assignProfileUsefulnessExperiment>[1],
        ) => {
          if (!input) throw new Error("Delivery assignment input required")
          const resolution = await assignProfileUsefulnessExperiment(
            prisma,
            input,
          )
          expect(resolution.assignment).not.toBeNull()
          await prisma.recommendationPromotionPointer.update({
            where: { id: "recommendation-promotion-pointer" },
            data: { killSwitchEnabled: true },
          })
          return resolution
        },
      )
      const input = request()
      try {
        expect(await harness.service.deliver(input)).toMatchObject({
          result: "unavailable",
          reason: "study_authority_unavailable",
          requestId: null,
          items: [],
        })
        expect(harness.signDeliveryCapability).not.toHaveBeenCalled()
        expect(
          await prisma.recommendationRequest.count({
            where: { seedMediaId: input.seedMediaId },
          }),
        ).toBe(0)
        expect(
          await prisma.recommendationExperimentAssignment.count({
            where: { profileId, experimentId: studyId },
          }),
        ).toBe(1)
      } finally {
        await prisma.recommendationPromotionPointer.update({
          where: { id: "recommendation-promotion-pointer" },
          data: { killSwitchEnabled: false },
        })
      }
    })

    it.each(["privacy", "promotion"] as const)(
      "fences a real %s change after selection and commits no partial issuance",
      async (change) => {
        const { harness, request, profileId } = await viewer("CHALLENGER")
        const input = request()
        harness.signDeliveryCapability.mockImplementationOnce(
          async ({ jti }) => {
            // The signer runs after assignment/authority resolution and candidate
            // selection, but before the real final issuance transaction.
            if (change === "privacy")
              await prisma.recommendationProfile.update({
                where: { id: profileId },
                data: { privacyGeneration: { increment: 1 } },
              })
            else
              await prisma.recommendationPromotionPointer.update({
                where: { id: "recommendation-promotion-pointer" },
                data: { killSwitchEnabled: true },
              })
            return `token:${jti}`
          },
        )
        try {
          const response = await harness.service.deliver(input)
          expect(harness.signDeliveryCapability).toHaveBeenCalledTimes(6)
          expect(response).toMatchObject({
            result: "unavailable",
            reason: "persistence_unavailable",
            items: [],
          })
          expect(
            await prisma.recommendationRequest.count({
              where: { seedMediaId: input.seedMediaId },
            }),
          ).toBe(0)
          const assignment =
            await prisma.recommendationExperimentAssignment.findFirstOrThrow({
              where: { profileId, experimentId: studyId },
            })
          expect(assignment.privacyGeneration).toBe(1)
          expect(
            await prisma.recommendationRequest.count({
              where: { experimentAssignmentId: assignment.id },
            }),
          ).toBe(0)
        } finally {
          if (change === "promotion")
            await prisma.recommendationPromotionPointer.update({
              where: { id: "recommendation-promotion-pointer" },
              data: { killSwitchEnabled: false },
            })
        }
      },
    )

    it("rejects wrong exact assignment bindings and expired current authority", async () => {
      const { harness, request } = await viewer("CONTROL")
      const response = await harness.service.deliver(request())
      expect(response.result).toBe("served")
      const resolution =
        await harness.assignProfileExperiment.mock.results[0]!.value
      const assignment = resolution.assignment!
      const read = (context: ExperimentAssignmentContext, now = new Date()) =>
        resolveDeliveryStudyAuthority(prisma, {
          assignment: context,
          now,
          deadlineAt: Date.now() + 2_000,
        })
      const authority = await read(assignment)
      expect(authority).toMatchObject({
        execution: "incumbent",
        experimentId: studyId,
        protocolDigest,
        challengerManifestId: INCUMBENT_HYBRID_AA_MANIFEST_ID,
        cowatch: null,
        composition: null,
      })
      for (const change of [
        { configurationDigest: "f".repeat(64) },
        { effectiveManifestId: INCUMBENT_HYBRID_AA_MANIFEST_ID },
        { experimentGeneration: assignment.experimentGeneration + 1 },
      ])
        expect(await read({ ...assignment, ...change })).toBeNull()
      expect(await read(assignment, authority!.validUntil)).toBeNull()
    })
  },
)
