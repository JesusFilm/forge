import { createHash, randomUUID } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import type { Principal } from "@/auth/principal"
import { recommendationManifestDigest } from "../promotion/manifest"
import { RecommendationStudyService } from "./study-service"
import { assertStudyAuthority } from "./study-authority"
import { assignProfileUsefulnessExperiment } from "./usefulness-routing"

// Disposable synthetic fixture: proves storage/routing/publication contracts,
// never production health, calibrated sample size, usefulness or permission.
describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "governed study lifecycle on PostgreSQL",
  () => {
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
            n === "0107_recommendation_governed_study",
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
          where: { id: "semantic-transcript-pgvector-v1" },
        })
      const challenger =
        await prisma.recommendationStrategyManifest.findUniqueOrThrow({
          where: { id: "semantic-experiment-aa-v1" },
        })
      protocol = {
        version: "profile-study-governance-v1",
        studyId: "fixture-calibration",
        mode: "calibration",
        comparison: "semantic-aa",
        identity: "anonymous-profile-generation-v1",
        surface: "watch-below-player-v1",
        cohort: "human-en-english-durable-v1",
        controlManifestId: control.id,
        challengerManifestId: challenger.id,
        controlManifestDigest: recommendationManifestDigest(control),
        challengerManifestDigest: recommendationManifestDigest(challenger),
        incumbentExecution: "hybrid_personalized",
        controlExecution: "semantic_contextual",
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
    }, 30_000)
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
          now: assignedAt,
          deadlineAt: Date.now() + 5000,
        }
        const result = await assignProfileUsefulnessExperiment(prisma, input)
        expect(result.assignment).not.toBeNull()
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
            now: endsAt,
            deadlineAt: Date.now() + 5000,
          })
        ).assignment,
      ).toBeNull()
    }, 30_000)

    it("publishes a mature v2 calibration, then revokes authority on privacy changes and keeps the erased denominator", async () => {
      // Twenty real joined attributed outcomes in each arm; remaining units stay zero.
      for (const arm of ["CONTROL", "CHALLENGER"] as const)
        for (const assignment of assignments
          .filter((a) => a.arm === arm)
          .slice(0, 20))
          await qualifiedEpisode(assignment)
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
      const authority = await service.evaluate(actor, operation)
      expect(authority.result).toMatchObject({
        schemaVersion: "recommendation-usefulness-offline-v2",
        decision: "calibration_pass",
        minimumUsefulDelta: null,
        comparatorMatchesIncumbent: false,
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
    }, 30_000)

    async function qualifiedEpisode(assignment: (typeof assignments)[number]) {
      const assignedAt = new Date(startsAt.getTime() + 3_600_000),
        itemId = randomUUID(),
        eventId = randomUUID(),
        hash = digest(itemId)
      const manifestId =
        assignment.arm === "CONTROL"
          ? "semantic-transcript-pgvector-v1"
          : "semantic-experiment-aa-v1"
      const request = await prisma.recommendationRequest.create({
        data: {
          contractVersion: "semantic-recommendation-v1",
          surfaceVersion: "watch-below-player-v1",
          manifestId,
          strategyVersion: "semantic-transcript-pgvector-v1",
          classifierVersion: "legacy-position-v0",
          sessionDigest: hash,
          seedMediaId: "seed",
          locale: "en",
          expectedItemCount: 1,
          state: "ISSUED",
          result: "SERVED",
          deliveryJti: randomUUID(),
          signingKid: "test",
          createdAt: assignedAt,
          issuedAt: assignedAt,
          expiresAt,
          experimentAssignmentId: assignment.id,
          items: {
            create: {
              id: itemId,
              position: 0,
              targetMediaId: "target",
              canonicalHref: "/watch/target.html",
              candidateGenerator: "semantic",
              candidateProvenance: {},
              expiresAt,
            },
          },
        },
      })
      await prisma.recommendationPersonalizationDecision.create({
        data: {
          requestId: request.id,
          lane: "semantic_control",
          executionMode: "semantic_contextual",
          effectiveManifestId: manifestId,
          expiresAt,
        },
      })
      await prisma.recommendationCandidateRun.create({
        data: {
          requestId: request.id,
          purpose: "watch",
          contextVersion: "recommendation-context-v1",
          generatorVersion: "semantic-transcript-candidate-v1",
          unionVersion: "canonical-video-union-v1",
          eligibilityVersion: "watch-playable-locale-v1",
          rankerVersion: "semantic-deterministic-ranker-v1",
          composerVersion: "minimal-playable-slate-v1",
          candidateEligibilityParity: "passed",
          rankerParity: "passed",
          nominatedCount: 1,
          canonicalizedCount: 1,
          deduplicatedCount: 1,
          rejectedCount: 0,
          scoredCount: 1,
          orderedCount: 1,
          composedCount: 1,
          evidenceComplete: true,
          expiresAt,
        },
      })
      await prisma.recommendationImpression.create({
        data: {
          requestId: request.id,
          itemId,
          capabilityJti: eventId,
          eventId,
          payloadDigest: hash,
          visibilityPolicy: "watch-below-player-v1",
          occurredAt: assignedAt,
          receivedAt: assignedAt,
          expiresAt,
        },
      })
      await prisma.recommendationExperimentExposure.create({
        data: {
          assignmentId: assignment.id,
          requestId: request.id,
          itemId,
          eventId,
          arm: assignment.arm,
          effectiveManifestId: manifestId,
          assignmentProbability: 0.5,
          payloadDigest: hash,
          occurredAt: assignedAt,
          receivedAt: assignedAt,
          expiresAt,
        },
      })
      const selection = await prisma.recommendationSelection.create({
        data: {
          requestId: request.id,
          itemId,
          capabilityJti: randomUUID(),
          eventId: randomUUID(),
          payloadDigest: hash,
          claimNonceDigest: hash,
          handoffExpiresAt: expiresAt,
          occurredAt: assignedAt,
          receivedAt: assignedAt,
          attributionEligibleAt: assignedAt,
          expiresAt,
        },
      })
      const episode = await prisma.recommendationPlaybackEpisode.create({
        data: {
          requestId: request.id,
          itemId,
          selectionId: selection.id,
          mediaId: "target",
          sessionDigest: hash,
          state: "FINALIZED",
          claimedAt: assignedAt,
          createdAt: assignedAt,
          activeUntil: new Date(assignedAt.getTime() + 3_600_000),
          hardUntil: new Date(assignedAt.getTime() + 6 * 3_600_000),
          expiresAt,
        },
      })
      const outcome = await prisma.recommendationOutcomeRevision.create({
        data: {
          requestId: request.id,
          itemId,
          episodeId: episode.id,
          classifierVersion: "active-watch-proxy-v1",
          revision: 1,
          factWatermark: 1,
          inputDigest: hash,
          qualifiedView: true,
          viewQualityWeight: 1,
          viewQualityWeightReason: "active_fraction_of_duration",
          activePlaybackMilliseconds: 30_000,
          durationSeconds: 30,
          durationCohort: "short",
          activeCoverage: "complete",
          generation: 1,
          expiresAt,
        },
      })
      await prisma.recommendationEligibilityDecision.create({
        data: {
          sourceType: "PLAYBACK_OUTCOME",
          sourceKey: `playback_outcome:${outcome.id}`,
          outcomeId: outcome.id,
          policyVersion: "recommendation-integrity-v1",
          revision: 1,
          actorClass: "HUMAN_ANONYMOUS",
          state: "ELIGIBLE",
          eligibleScopes: ["experiment"],
          contributionWeight: 1,
          contributionOrdinal: 1,
          distinctSupport: 1,
          identityConcentration: 1,
          inputDigest: hash,
          expiresAt,
        },
      })
    }
  },
)
