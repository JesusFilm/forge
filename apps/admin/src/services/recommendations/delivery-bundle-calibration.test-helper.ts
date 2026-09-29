import { createHash, randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import { expect } from "vitest"
import { chooseExperimentArm } from "./experiment/assignment"
import { assertStudyAuthority } from "./experiment/study-authority"
import { seedStudyQualifiedEpisode } from "./experiment/study-outcome.test-helper"
import { RecommendationStudyService } from "./experiment/study-service"
import { assignProfileUsefulnessExperiment } from "./experiment/usefulness-routing"
import { type StudyProtocol } from "./experiment/study-protocol"
import {
  INCUMBENT_HYBRID_MANIFEST,
  INCUMBENT_HYBRID_AA_MANIFEST,
  recommendationManifestDigest,
} from "./promotion/manifest"

export const bundleFixtureDay = 86_400_000
export const bundleFixtureDigest = (value: string) =>
  createHash("sha256").update(value).digest("hex")
export const bundleFixtureActor = {
  id: "native-bundle-operator",
  role: "ADMIN",
} as const
const receipt = {
  source: "reviewed-artifact",
  reference: "owned-synthetic-native-fixture-not-production-evidence",
  sha256: bundleFixtureDigest("native-bundle-fixture"),
}

/** Explicit fixture identity selection, never a production assignment override. */
export function bundleFixtureArm(
  studyId: string,
  protocolDigest: string,
  profileId: string,
) {
  return chooseExperimentArm({
    unitDigest: bundleFixtureDigest(
      `recommendation-experiment-unit:v1\0${studyId}\0profile:${profileId}:1`,
    ),
    configurationDigest: protocolDigest,
    challengerProbability: 0.5,
  })
}

export async function activateBundleFixtureStudy(
  db: PrismaClient,
  protocol: StudyProtocol,
  now: Date,
) {
  const service = new RecommendationStudyService(db, () => now)
  const prepared = await service.prepare(bundleFixtureActor, protocol)
  const evidenceId = randomUUID()
  await service.recordEvidence(bundleFixtureActor, {
    studyId: protocol.studyId,
    protocolDigest: prepared.protocolDigest,
    evidenceId,
    evidence: {
      kind: "readiness",
      capturedAt: now.toISOString(),
      validUntil: new Date(now.getTime() + bundleFixtureDay).toISOString(),
      collection: receipt,
      retention: receipt,
      storage: receipt,
      rollback: receipt,
    },
  })
  const pointer = await db.recommendationPromotionPointer.findUniqueOrThrow({
    where: { id: "recommendation-promotion-pointer" },
  })
  await service.activate(bundleFixtureActor, {
    studyId: protocol.studyId,
    protocolDigest: prepared.protocolDigest,
    evidenceId,
    operationId: randomUUID(),
    expectedPointerGeneration: pointer.generation,
  })
  return prepared
}

/** A real mature calibration publication from 400 assigned units and 40 joined outcomes.
 * Every row is synthetic local input. No PASS/authority row is inserted by this helper.
 */
export async function seedMatureBundleCalibration(db: PrismaClient) {
  const day = bundleFixtureDay
  const start = new Date(Math.floor(Date.now() / day) * day - 5 * day)
  const endsAt = new Date(start.getTime() + 2 * day)
  const expiresAt = new Date(start.getTime() + 25 * day)
  const protocol: StudyProtocol = {
    version: "profile-study-governance-v1",
    studyId: `bundle-calibration-${randomUUID()}`,
    mode: "calibration",
    comparison: "incumbent-aa",
    identity: "anonymous-profile-generation-v1",
    surface: "watch-below-player-v1",
    cohort: "human-en-english-durable-client-cowatch-mmr-v1",
    controlManifestId: INCUMBENT_HYBRID_MANIFEST.id,
    challengerManifestId: INCUMBENT_HYBRID_AA_MANIFEST.id,
    controlManifestDigest: recommendationManifestDigest(
      INCUMBENT_HYBRID_MANIFEST,
    ),
    challengerManifestDigest: recommendationManifestDigest(
      INCUMBENT_HYBRID_AA_MANIFEST,
    ),
    incumbentExecution: "hybrid_personalized",
    controlExecution: "profile-viewing-mode-incumbent-v1",
    admissionBps: 10_000,
    challengerProbability: 0.5,
    startsAt: start.toISOString(),
    endsAt: endsAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    stoppingRule: "fixed-enrollment-window-v1",
    plannedAssignmentsPerArm: 200,
    minimumUsefulDelta: null,
    evidenceMaxAgeHours: 24,
    calibrationEvaluationId: null,
  }
  const prepared = await activateBundleFixtureStudy(
    db,
    protocol,
    new Date(start.getTime() - 3_600_000),
  )
  for (const arm of ["CONTROL", "CHALLENGER"] as const) {
    for (let index = 0; index < 200; index++) {
      let profileId: string
      do {
        profileId = randomUUID()
      } while (
        bundleFixtureArm(
          protocol.studyId,
          prepared.protocolDigest,
          profileId,
        ) !== arm
      )
      const tokenDigest = bundleFixtureDigest(profileId)
      await db.recommendationProfile.create({
        data: {
          id: profileId,
          tokenDigest,
          choice: "DURABLE_ALLOWED",
          privacyGeneration: 1,
          expiresAt,
        },
      })
      const enrollment = {
        sessionDigest: tokenDigest,
        profileTokenDigest: tokenDigest,
        eligibleForEnrollment: true,
        clientDeliveryContract: "cowatch-mmr-v1",
        now: new Date(start.getTime() + 3_600_000),
        deadlineAt: Date.now() + 5_000,
      }
      if (index === 0) {
        for (const clientDeliveryContract of [null, "unknown-parser"])
          expect(
            await assignProfileUsefulnessExperiment(db, {
              ...enrollment,
              clientDeliveryContract,
            }),
          ).toEqual({ assignment: null, bypassReason: "cohort_ineligible" })
        expect(
          await db.recommendationExperimentAssignment.count({
            where: { profileId },
          }),
        ).toBe(0)
      }
      const resolution = await assignProfileUsefulnessExperiment(db, enrollment)
      expect(resolution.assignment?.arm).toBe(arm.toLowerCase())
      if (!resolution.assignment)
        throw new Error("Native calibration enrollment failed")
      if (index < 20)
        await seedStudyQualifiedEpisode(db, {
          assignment: {
            id: resolution.assignment.assignmentId,
            arm,
            profileId,
          },
          runtime: "incumbent",
          protocol,
          startsAt: start,
          expiresAt,
        })
    }
  }
  const now = new Date()
  await db.recommendationRetentionRun.create({
    data: { status: "SUCCEEDED", batchSize: 100, completedAt: now, expiresAt },
  })
  const service = new RecommendationStudyService(db, () => now)
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
  await service.recordEvidence(bundleFixtureActor, {
    studyId: protocol.studyId,
    protocolDigest: prepared.protocolDigest,
    evidenceId,
    evidence: {
      kind: "outcomes",
      capturedAt: now.toISOString(),
      validUntil: new Date(now.getTime() + day).toISOString(),
      windowStart: start.toISOString(),
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
  const evaluation = await service.evaluate(bundleFixtureActor, {
    studyId: protocol.studyId,
    protocolDigest: prepared.protocolDigest,
    evidenceId,
    operationId: randomUUID(),
  })
  expect(evaluation.result).toMatchObject({
    decision: "calibration_pass",
    comparatorMatchesIncumbent: true,
    permanentDefaultAuthority: false,
  })
  await db.$transaction((tx) =>
    assertStudyAuthority(tx, {
      evaluationId: evaluation.evaluationId,
      purpose: "calibration",
      now,
    }),
  )
  return {
    protocol,
    evaluationId: evaluation.evaluationId,
    completedAt: now,
    expiresAt,
  }
}
