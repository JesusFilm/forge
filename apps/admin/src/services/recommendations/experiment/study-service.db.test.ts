import { createHash, randomUUID } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import type { Principal } from "@/auth/principal"
import {
  recommendationManifestDigest,
  INCUMBENT_HYBRID_MANIFEST,
  COWATCH_MMR_TRIAL_MANIFEST,
} from "../promotion/manifest"
import { cowatchTrialBindingDigest } from "../cowatch/trial-authority.service"
import { parseStudyProtocol } from "./study-protocol"
import {
  lockStudyDependenciesForEvaluation,
  studyCowatchBinding,
  studyDependencyInterruption,
} from "./study-dependencies"
import { RecommendationStudyService } from "./study-service"
import { seedStudyQualifiedEpisode } from "./study-outcome.test-helper"
import { assertStudyAuthority } from "./study-authority"
import { assignProfileUsefulnessExperiment } from "./usefulness-routing"
import {
  readActiveStudyAuthority,
  lockActiveStudyAuthorityForIssuance,
  activeStudyAuthorityDigest,
} from "./active-study-authority"

// Disposable synthetic fixture: proves storage/routing/publication contracts,
// never production health, calibrated sample size, usefulness or permission.
describe
  .skipIf(env.RECOMMENDATION_DB_TEST !== "1")
  .each(["semantic", "incumbent"])(
  "governed %s study lifecycle on PostgreSQL",
  (runtime) => {
    const schema = `study_${randomUUID().replaceAll("-", "")}`
    const day = 86_400_000
    const actualNow = new Date()
    const startsAt = new Date(
      Math.floor(actualNow.getTime() / day) * day - 5 * day,
    )
    const endsAt = new Date(startsAt.getTime() + 2 * day)
    const expiresAt = new Date(startsAt.getTime() + 25 * day)
    let clock = new Date(startsAt.getTime() - 3_600_000)
    let admin: Client
    let prisma: PrismaClient
    let service: RecommendationStudyService
    let protocol: Record<string, unknown>
    let protocolDigest: string
    const actor: Principal = { id: "fixture-operator", role: "ADMIN" }
    const receipt = {
      source: "reviewed-artifact",
      reference: "disposable-fixture-only",
      sha256: "a".repeat(64),
    }
    const digest = (s: string) => createHash("sha256").update(s).digest("hex")
    const assignments: {
      id: string
      arm: "CONTROL" | "CHALLENGER"
      profileId: string
    }[] = []
    let evaluationId: string

    beforeAll(async () => {
      const url = new URL(env.DATABASE_URL)
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.pathname !== "/forge_study"
      )
        throw new Error("Owned loopback forge_study fixture database required")
      admin = new Client({ connectionString: env.DATABASE_URL })
      await admin.connect()
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`SET search_path TO "${schema}", public`)
      const root = new URL("../../../../prisma/migrations/", import.meta.url)
      for (const name of readdirSync(root)
        .filter(
          (n) =>
            (Number(n.slice(0, 4)) >= 52 &&
              Number(n.slice(0, 4)) <= 82 &&
              n.includes("recommendation")) ||
            n === "0082_user_recommendation_identity" ||
            n === "0098_recommendation_viewing_mode" ||
            n === "0057_semantic_control_readiness" ||
            n === "0100_recommendation_candidate_compact_trace" ||
            n === "0103_recommendation_impression_visibility_capability" ||
            n === "0104_recommendation_cowatch_shadow" ||
            n === "0106_recommendation_cowatch_source_window" ||
            n === "0107_recommendation_governed_study" ||
            n === "0108_recommendation_cowatch_frozen_trial" ||
            n === "0109_recommendation_composition_authority" ||
            n === "0110_recommendation_live_policy_manifests",
        )
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
      service = new RecommendationStudyService(prisma, () => clock)
      const control =
        await prisma.recommendationStrategyManifest.findUniqueOrThrow({
          where: {
            id:
              runtime === "incumbent"
                ? "hybrid-profile-viewing-mode-v1"
                : "semantic-transcript-pgvector-v1",
          },
        })
      const challenger =
        await prisma.recommendationStrategyManifest.findUniqueOrThrow({
          where: {
            id:
              runtime === "incumbent"
                ? "hybrid-profile-viewing-mode-aa-v1"
                : "semantic-experiment-aa-v1",
          },
        })
      if (runtime === "incumbent") {
        const registry = await import("../promotion/manifest")
        expect(registry.isExactIncumbentHybridManifest(control)).toBe(true)
        expect(registry.isExactIncumbentHybridAaManifest(challenger)).toBe(true)
        const trial =
          await prisma.recommendationStrategyManifest.findUniqueOrThrow({
            where: { id: registry.COWATCH_MMR_TRIAL_MANIFEST_ID },
          })
        expect(registry.isExactCowatchMmrTrialManifest(trial)).toBe(true)
      }
      protocol = {
        version: "profile-study-governance-v1",
        studyId: "fixture-calibration",
        mode: "calibration",
        comparison: runtime === "incumbent" ? "incumbent-aa" : "semantic-aa",
        identity: "anonymous-profile-generation-v1",
        surface: "watch-below-player-v1",
        cohort:
          runtime === "incumbent"
            ? "human-en-english-durable-client-cowatch-mmr-v1"
            : "human-en-english-durable-v1",
        controlManifestId: control.id,
        challengerManifestId: challenger.id,
        controlManifestDigest: recommendationManifestDigest(control),
        challengerManifestDigest: recommendationManifestDigest(challenger),
        incumbentExecution: "hybrid_personalized",
        controlExecution:
          runtime === "incumbent"
            ? "profile-viewing-mode-incumbent-v1"
            : "semantic_contextual",
        admissionBps: 10_000,
        challengerProbability: 0.5,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        stoppingRule: "fixed-enrollment-window-v1",
        plannedAssignmentsPerArm: 200,
        minimumUsefulDelta: null,
        evidenceMaxAgeHours: 24,
        calibrationEvaluationId: null,
      }
    }, 60_000)
    afterAll(async () => {
      await prisma?.$disconnect()
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
    })

    it("prepares immutable inactive truth and bootstraps exact A/A only after reviewed readiness", async () => {
      const prepared = await service.prepare(actor, protocol)
      protocolDigest = prepared.protocolDigest
      expect((await service.prepare(actor, protocol)).protocolDigest).toBe(
        protocolDigest,
      )
      expect(
        (
          await prisma.recommendationExperiment.findUniqueOrThrow({
            where: { id: prepared.experimentId },
          })
        ).state,
      ).toBe("CLOSED")
      expect(await prisma.recommendationExperimentEvaluation.count()).toBe(0)
      await expect(
        service.prepare(actor, { ...protocol, admissionBps: 2000 }),
      ).rejects.toThrow("another protocol")
      await expect(
        prisma.recommendationStudy.update({
          where: { experimentId: prepared.experimentId },
          data: { protocolDigest: "f".repeat(64) },
        }),
      ).rejects.toThrow("immutable")
      const evidenceId = randomUUID()
      await service.recordEvidence(actor, {
        studyId: prepared.experimentId,
        protocolDigest,
        evidenceId,
        evidence: {
          kind: "readiness",
          capturedAt: clock.toISOString(),
          validUntil: new Date(clock.getTime() + day).toISOString(),
          collection: receipt,
          retention: receipt,
          storage: receipt,
          rollback: receipt,
        },
      })
      const operation = {
        studyId: prepared.experimentId,
        protocolDigest,
        evidenceId,
        operationId: randomUUID(),
        expectedPointerGeneration: 1,
      }
      expect((await service.activate(actor, operation)).replay).toBe(false)
      expect((await service.activate(actor, operation)).replay).toBe(true)
      await expect(
        service.activate(actor, { ...operation, evidenceId: randomUUID() }),
      ).rejects.toThrow("another operation")
      await expect(
        service.activate(actor, { ...operation, operationId: randomUUID() }),
      ).rejects.toThrow("another operation")
      expect(await prisma.recommendationExperimentEvaluation.count()).toBe(0)
      expect(
        await prisma.recommendationPromotionPointer.findUnique({
          where: { id: "recommendation-promotion-pointer" },
        }),
      ).toMatchObject({
        stage: "BOUNDED",
        exposureCeilingBps: 5000,
        generation: 2,
      })
    })

    it("enrolls complete sticky profile units, keeps zero exposure and closes at the frozen time", async () => {
      const assignedAt = new Date(startsAt.getTime() + 3_600_000)
      for (let i = 0; i < 500; i++) {
        const token = digest(`profile:${i}`)
        const profile = await prisma.recommendationProfile.create({
          data: {
            tokenDigest: token,
            choice: "DURABLE_ALLOWED",
            privacyGeneration: 1,
            expiresAt,
          },
        })
        const input = {
          sessionDigest: digest(`session:${i}`),
          profileTokenDigest: token,
          eligibleForEnrollment: true,
          clientDeliveryContract: "cowatch-mmr-v1",
          now: assignedAt,
          deadlineAt: Date.now() + 5000,
        }
        const result = await assignProfileUsefulnessExperiment(prisma, input)
        expect(result.assignment).not.toBeNull()
        if (i === 0) {
          const authority = await prisma.$transaction((tx) =>
            readActiveStudyAuthority(tx, {
              assignment: result.assignment!,
              now: assignedAt,
            }),
          )
          expect(authority?.execution).toBe(
            runtime === "incumbent" ? "incumbent" : "semantic",
          )
          if (!authority) throw new Error("fixture authority missing")
          await expect(
            prisma.$transaction((tx) =>
              lockActiveStudyAuthorityForIssuance(tx, {
                assignment: result.assignment!,
                expected: authority,
                now: assignedAt,
              }),
            ),
          ).resolves.toEqual(authority)
          const changed = {
            ...authority,
            validUntil: new Date(authority.validUntil.getTime() + 1),
          }
          expect(activeStudyAuthorityDigest(changed)).not.toBe(
            activeStudyAuthorityDigest(authority),
          )
          await expect(
            prisma.$transaction((tx) =>
              lockActiveStudyAuthorityForIssuance(tx, {
                assignment: result.assignment!,
                expected: changed,
                now: assignedAt,
              }),
            ),
          ).rejects.toThrow("active_study_authority_fenced")
        }
        const row =
          await prisma.recommendationExperimentAssignment.findUniqueOrThrow({
            where: { id: result.assignment!.assignmentId },
          })
        assignments.push({ id: row.id, arm: row.arm, profileId: profile.id })
        if (i === 0)
          expect(
            await assignProfileUsefulnessExperiment(prisma, {
              ...input,
              sessionDigest: digest("another-session"),
              eligibleForEnrollment: false,
            }),
          ).toEqual(result)
      }
      const study = await prisma.recommendationStudy.findUniqueOrThrow({
        where: { experimentId: "fixture-calibration" },
      })
      expect(study.enrolledCount).toBe(500)
      expect(
        assignments.filter((a) => a.arm === "CONTROL").length,
      ).toBeGreaterThanOrEqual(200)
      expect(
        assignments.filter((a) => a.arm === "CHALLENGER").length,
      ).toBeGreaterThanOrEqual(200)
      const late = digest("late-profile")
      await prisma.recommendationProfile.create({
        data: {
          tokenDigest: late,
          choice: "DURABLE_ALLOWED",
          privacyGeneration: 1,
          expiresAt,
        },
      })
      expect(
        (
          await assignProfileUsefulnessExperiment(prisma, {
            sessionDigest: late,
            profileTokenDigest: late,
            eligibleForEnrollment: true,
            clientDeliveryContract: "cowatch-mmr-v1",
            now: endsAt,
            deadlineAt: Date.now() + 5000,
          })
        ).assignment,
      ).toBeNull()
    }, 60_000)

    it("publishes a mature v2 calibration, then revokes authority on privacy changes and keeps the erased denominator", async () => {
      // Twenty real joined attributed outcomes in each arm; remaining units stay zero.
      for (const arm of ["CONTROL", "CHALLENGER"] as const)
        for (const assignment of assignments
          .filter((a) => a.arm === arm)
          .slice(0, 20))
          await qualifiedEpisode(assignment)
      if (runtime === "incumbent") {
        const decision =
          await prisma.recommendationPersonalizationDecision.findFirstOrThrow(
            {},
          )
        // Preserve real mode-only provenance without relaxing ordinary profile
        // provenance or permitting arbitrary reason codes.
        await prisma.recommendationPersonalizationDecision.update({
          where: { requestId: decision.requestId },
          data: {
            projectionGenerationId: null,
            projectionVersion: null,
            projectionGenerationNumber: null,
            interestCount: 0,
            reasonCode: "viewing_mode_preference",
          },
        })
        await expect(
          prisma.recommendationPersonalizationDecision.update({
            where: { requestId: decision.requestId },
            data: { reasonCode: "unreviewed_reason" },
          }),
        ).rejects.toThrow("recommendation_personalization_projection_check")
        await expect(
          prisma.recommendationPersonalizationDecision.update({
            where: { requestId: decision.requestId },
            data: { reasonCode: null },
          }),
        ).rejects.toThrow("recommendation_personalization_projection_check")
        await prisma.recommendationCandidateRun.update({
          where: { requestId: decision.requestId },
          data: { generatorVersion: "semantic-transcript-candidate-v1" },
        })
        // A declared operational fallback stays in its original assigned arm.
        await prisma.recommendationRequest.update({
          where: { id: decision.requestId },
          data: {
            result: "FALLBACK",
            fallbackReason: "fixture_incumbent_thin",
          },
        })
        await prisma.recommendationPersonalizationDecision.update({
          where: { requestId: decision.requestId },
          data: {
            effectiveManifestId: "hybrid-profile-viewing-mode-v1",
            reasonCode: "incumbent_operational_fallback",
          },
        })
      }
      if (runtime === "incumbent") {
        const curated =
          await prisma.recommendationPersonalizationDecision.findFirstOrThrow({
            where: { reasonCode: "viewing_mode_preference", interestCount: 1 },
          })
        await prisma.recommendationRequest.update({
          where: { id: curated.requestId },
          data: {
            result: "FALLBACK",
            fallbackReason: "fixture_curated_empty_semantic",
          },
        })
        await prisma.recommendationPersonalizationDecision.update({
          where: { requestId: curated.requestId },
          data: {
            lane: "semantic_fallback",
            executionMode: "curated_fallback",
            effectiveManifestId: "hybrid-profile-viewing-mode-v1",
            reasonCode: "incumbent_operational_fallback",
            projectionGenerationId: null,
            projectionScope: null,
            projectionVersion: null,
            projectionGenerationNumber: null,
            interestCount: 0,
          },
        })
        await prisma.recommendationCandidateRun.update({
          where: { requestId: curated.requestId },
          data: {
            generatorVersion: "seeded-curated-empty-fallback-v1",
            rankerVersion: "source-rank-hybrid-ranker-v1",
            composerVersion: "recent-video-refill-composer-v1",
          },
        })
      }
      await prisma.recommendationRetentionRun.create({
        data: {
          status: "SUCCEEDED",
          batchSize: 100,
          completedAt: actualNow,
          expiresAt,
        },
      })
      clock = new Date()
      const evidenceId = randomUUID()
      const counts = {
        requests: 1000,
        timeoutsOrErrors: 0,
        requestsWithCards: 1000,
        p95LatencyMs: 200,
        claimedEpisodes: 20,
        missingActiveEpisodes: 0,
        attributionFailures: 0,
        fatalPlaybackErrors: 0,
      }
      await service.recordEvidence(actor, {
        studyId: "fixture-calibration",
        protocolDigest,
        evidenceId,
        evidence: {
          kind: "outcomes",
          capturedAt: clock.toISOString(),
          validUntil: new Date(clock.getTime() + day).toISOString(),
          windowStart: startsAt.toISOString(),
          windowEnd: new Date(endsAt.getTime() + 30 * 3_600_000).toISOString(),
          delivery: receipt,
          playback: receipt,
          collection: receipt,
          retention: receipt,
          browserJourney: receipt,
          control: counts,
          challenger: counts,
        },
      })
      const operation = {
        studyId: "fixture-calibration",
        protocolDigest,
        evidenceId,
        operationId: randomUUID(),
      }
      const firstPublicationWriter = new Client({
        connectionString: env.DATABASE_URL,
      })
      await firstPublicationWriter.connect()
      await firstPublicationWriter.query(
        `SET search_path TO "${schema}", public`,
      )
      await firstPublicationWriter.query(
        "BEGIN ISOLATION LEVEL REPEATABLE READ",
      )
      await firstPublicationWriter.query(
        "SELECT privacy_revision FROM recommendation_study",
      )
      const authority = await service.evaluate(actor, operation)
      try {
        const firstRequest =
          await prisma.recommendationRequest.findFirstOrThrow({})
        await expect(
          firstPublicationWriter.query(
            "UPDATE recommendation_request SET locale = locale WHERE id = $1",
            [firstRequest.id],
          ),
        ).rejects.toMatchObject({ code: "40001" })
      } finally {
        await firstPublicationWriter.query("ROLLBACK")
        await firstPublicationWriter.end()
      }
      expect(authority.result).toMatchObject({
        schemaVersion: "recommendation-usefulness-offline-v2",
        decision: "calibration_pass",
        minimumUsefulDelta: null,
        comparatorMatchesIncumbent: runtime === "incumbent",
      })
      expect((await service.evaluate(actor, operation)).evaluationId).toBe(
        authority.evaluationId,
      )
      evaluationId = authority.evaluationId
      await expect(
        prisma.$transaction((tx) =>
          assertStudyAuthority(tx, {
            evaluationId,
            purpose: "calibration",
            now: clock,
          }),
        ),
      ).resolves.toMatchObject({ evaluationId })
      await expect(
        prisma.$transaction((tx) =>
          assertStudyAuthority(tx, {
            evaluationId,
            purpose: "advancement",
            now: clock,
          }),
        ),
      ).rejects.toThrow("invalid")
      await expect(
        prisma.$transaction((tx) =>
          assertStudyAuthority(tx, {
            evaluationId,
            purpose: "calibration",
            now: expiresAt,
          }),
        ),
      ).rejects.toThrow("invalid")
      // A late request/source mutation invalidates current publication once;
      // further playback writes do not keep updating a hot study row.
      const request = await prisma.recommendationRequest.findFirstOrThrow({})
      const epoch = async () =>
        (
          await prisma.recommendationStudy.findUniqueOrThrow({
            where: { experimentId: "fixture-calibration" },
          })
        ).privacyRevision
      const publishedEpoch = await epoch()
      await prisma.recommendationRequest.update({
        where: { id: request.id },
        data: { locale: "en" },
      })
      expect(await epoch()).toBe(publishedEpoch + 1)
      await prisma.recommendationRequest.update({
        where: { id: request.id },
        data: { locale: "en" },
      })
      expect(await epoch()).toBe(publishedEpoch + 1)
      await expect(
        prisma.$transaction((tx) =>
          assertStudyAuthority(tx, {
            evaluationId,
            purpose: "calibration",
            now: clock,
          }),
        ),
      ).rejects.toThrow("invalid")
      const concurrentWriters = await Promise.all(
        [0, 1].map(async () => {
          const client = new Client({ connectionString: env.DATABASE_URL })
          await client.connect()
          await client.query(`SET search_path TO "${schema}", public`)
          await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE")
          await client.query("SET LOCAL lock_timeout = '500ms'")
          return client
        }),
      )
      try {
        const roots = await prisma.recommendationRequest.findMany({ take: 2 })
        await concurrentWriters[0].query(
          "UPDATE recommendation_request SET locale = locale WHERE id = $1",
          [roots[0].id],
        )
        // The first writer remains open. The second must acquire a compatible
        // shared study fence, with no study-row write after invalidation.
        await concurrentWriters[1].query(
          "UPDATE recommendation_request SET locale = locale WHERE id = $1",
          [roots[1].id],
        )
        await concurrentWriters[0].query("COMMIT")
        await concurrentWriters[1].query("COMMIT")
        expect(await epoch()).toBe(publishedEpoch + 1)
      } finally {
        for (const client of concurrentWriters) {
          await client.query("ROLLBACK")
          await client.end()
        }
      }
      const republish = async () => {
        const result = await service.evaluate(actor, {
          ...operation,
          operationId: randomUUID(),
        })
        expect(result.result).toMatchObject({ decision: "calibration_pass" })
        evaluationId = result.evaluationId
      }
      await republish()
      const writer = new Client({ connectionString: env.DATABASE_URL })
      await writer.connect()
      await writer.query(`SET search_path TO "${schema}", public`)
      try {
        // An older fixed snapshot cannot miss a publication it cannot yet see.
        await writer.query("BEGIN ISOLATION LEVEL REPEATABLE READ")
        await writer.query("SELECT privacy_revision FROM recommendation_study")
        await republish()
        await expect(
          writer.query(
            "UPDATE recommendation_request SET locale = locale WHERE id = $1",
            [request.id],
          ),
        ).rejects.toMatchObject({ code: "40001" })
        await writer.query("ROLLBACK")
        // Issuance's shared study lock orders the invalidation after issuance.
        await writer.query("BEGIN")
        await writer.query(
          "SELECT experiment_id FROM recommendation_study FOR SHARE",
        )
        let mutationFinished = false
        const mutation = prisma.recommendationRequest
          .update({ where: { id: request.id }, data: { locale: "en" } })
          .then(() => {
            mutationFinished = true
          })
        await new Promise((resolve) => setTimeout(resolve, 75))
        expect(mutationFinished).toBe(false)
        await writer.query("COMMIT")
        await mutation
        await expect(
          prisma.$transaction((tx) =>
            assertStudyAuthority(tx, {
              evaluationId,
              purpose: "calibration",
              now: clock,
            }),
          ),
        ).rejects.toThrow("invalid")
        await republish()
        // Publication waits for a concurrent source writer, then extracts its
        // committed state with a new READ COMMITTED snapshot.
        await writer.query("BEGIN")
        await writer.query(
          "UPDATE recommendation_request SET locale = locale WHERE id = $1",
          [request.id],
        )
        let publicationFinished = false
        const publication = republish().then(() => {
          publicationFinished = true
        })
        await new Promise((resolve) => setTimeout(resolve, 75))
        expect(publicationFinished).toBe(false)
        await writer.query("COMMIT")
        await publication
        await expect(
          prisma.$transaction((tx) =>
            assertStudyAuthority(tx, {
              evaluationId,
              purpose: "calibration",
              now: clock,
            }),
          ),
        ).resolves.toMatchObject({ evaluationId })
      } finally {
        await writer.query("ROLLBACK")
        await writer.end()
      }
      const erased = assignments[499]
      await prisma.recommendationProfile.update({
        where: { id: erased.profileId },
        data: { privacyGeneration: { increment: 1 } },
      })
      await expect(
        prisma.$transaction((tx) =>
          assertStudyAuthority(tx, {
            evaluationId,
            purpose: "calibration",
            now: clock,
          }),
        ),
      ).rejects.toThrow("invalid")
      await prisma.recommendationExperimentAssignment.delete({
        where: { id: erased.id },
      })
      const unhealthy = await service.evaluate(actor, {
        ...operation,
        operationId: randomUUID(),
      })
      expect(unhealthy.result).toMatchObject({
        decision: "data_unhealthy",
        reasonCodes: expect.arrayContaining([
          "assignment_denominator_mismatch",
        ]),
      })
      expect(
        (
          await prisma.recommendationStudy.findUniqueOrThrow({
            where: { experimentId: "fixture-calibration" },
          })
        ).enrolledCount,
      ).toBe(500)
      await expect(
        prisma.$transaction((tx) =>
          assertStudyAuthority(tx, {
            evaluationId,
            purpose: "calibration",
            now: clock,
          }),
        ),
      ).rejects.toThrow("invalid")
    }, 60_000)

    it("serializes evaluation with unrelated graph-source invalidation and retains its first interruption after deletion", async () => {
      const graphId = digest(`dependency-race:${runtime}`)
      const start = new Date(Math.floor(Date.now() / day) * day)
      const end = new Date(start.getTime() + 2 * day)
      const horizon = new Date(end.getTime() + 30 * 3_600_000)
      const dependencyExpiry = new Date(horizon.getTime() + day)
      const p = parseStudyProtocol({
        ...protocol,
        studyId: "dependency-race",
        mode: "efficacy",
        comparison: "incumbent-cowatch-mmr",
        controlManifestId: INCUMBENT_HYBRID_MANIFEST.id,
        challengerManifestId: COWATCH_MMR_TRIAL_MANIFEST.id,
        controlManifestDigest: recommendationManifestDigest(
          INCUMBENT_HYBRID_MANIFEST,
        ),
        challengerManifestDigest: recommendationManifestDigest(
          COWATCH_MMR_TRIAL_MANIFEST,
        ),
        controlExecution: "profile-viewing-mode-incumbent-v1",
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        expiresAt: new Date(start.getTime() + 25 * day).toISOString(),
        minimumUsefulDelta: 0.01,
        calibrationEvaluationId: "fixture-calibration-result",
        cowatch: {
          mode: "frozen-source-controlled-trial-v1",
          graphGenerationId: graphId,
          sourceWindow: {
            version: "episode-event-window-v1",
            windowStart: new Date(start.getTime() - 3 * day).toISOString(),
            windowEnd: new Date(start.getTime() - day).toISOString(),
            evaluationAsOf: new Date(start.getTime() - day).toISOString(),
          },
          calibrationCompletedAt: new Date(
            start.getTime() - 2 * day,
          ).toISOString(),
          trialValidUntil: horizon.toISOString(),
          earliestDependencyExpiresAt: dependencyExpiry.toISOString(),
          shadowEvaluationId: randomUUID(),
          shadowDecisionId: randomUUID(),
        },
        composition: {
          protocolId: randomUUID(),
          manifestId: COWATCH_MMR_TRIAL_MANIFEST.id,
          composerVersion: "source-interest-theme-mmr-v1",
          configDigest: digest("config"),
          evidenceDigest: digest("evidence"),
          reviewDigest: digest("review"),
          authorityRevision: 0,
          cowatchGenerationId: graphId,
        },
      })
      const identity = {
        experimentId: p.studyId,
        experimentGeneration: 1,
        protocolDigest: digest("protocol"),
      }
      const binding = studyCowatchBinding(p, identity)!
      await prisma.recommendationCowatchGeneration.create({
        data: {
          id: graphId,
          projectionVersion: "fixture",
          featureVersion: "fixture",
          sourceCount: 0,
          contributionCount: 0,
          edgeCount: 0,
          distinctViewerCount: 0,
          windowEnd: new Date(p.cowatch!.sourceWindow.windowEnd),
          terminalDecision: "insufficient_support",
          decisionReason: "fixture-only",
          expiresAt: dependencyExpiry,
        },
      })
      await prisma.recommendationCowatchTrialAuthority.create({
        data: {
          generationId: graphId,
          bindingDigest: cowatchTrialBindingDigest(binding),
          binding: {},
          rawPopulationExpiresAt: dependencyExpiry,
          dependencyExpiresAt: dependencyExpiry,
          trialValidUntil: horizon,
          qualifiedAt: new Date(start.getTime() - 1000),
        },
      })
      const writer = new Client({ connectionString: env.DATABASE_URL })
      await writer.connect()
      await writer.query(`SET search_path TO "${schema}", public`)
      try {
        await writer.query("BEGIN")
        // This is the exact invalidator used by all source/privacy triggers.
        // It has no enrolled profile/assignment and therefore no study fence.
        await writer.query(
          "SELECT invalidate_cowatch_generations(ARRAY[$1::char(64)], 'fixture_source_change')",
          [graphId],
        )
        let completed = false
        const evaluation = prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
          await lockStudyDependenciesForEvaluation(
            tx,
            p,
            identity,
            new Date(horizon.getTime() + day),
          )
          const reason = await studyDependencyInterruption(tx, p, identity)
          completed = true
          return reason
        })
        await new Promise((resolve) => setTimeout(resolve, 75))
        expect(completed).toBe(false)
        await writer.query("COMMIT")
        expect(await evaluation).toBe("cowatch_source_interrupted")
        const first =
          await prisma.recommendationCowatchTrialAuthority.findUniqueOrThrow({
            where: { generationId: graphId },
          })
        expect(first.revokedAt! < horizon).toBe(true)
        await prisma.recommendationCowatchGeneration.delete({
          where: { id: graphId },
        })
        expect(
          (
            await prisma.recommendationCowatchTrialAuthority.findUniqueOrThrow({
              where: { generationId: graphId },
            })
          ).revokedAt,
        ).toEqual(first.revokedAt)
        expect(
          await prisma.$transaction((tx) =>
            studyDependencyInterruption(tx, p, identity),
          ),
        ).toBe("cowatch_source_interrupted")
      } finally {
        await writer.query("ROLLBACK")
        await writer.end()
      }
    })

    async function qualifiedEpisode(assignment: (typeof assignments)[number]) {
      return seedStudyQualifiedEpisode(prisma, {
        assignment,
        runtime,
        protocol: {
          controlManifestId: protocol.controlManifestId,
          challengerManifestId: protocol.challengerManifestId,
        },
        startsAt,
        expiresAt,
      })
    }
  },
)
