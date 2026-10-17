import { randomUUID } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { PrismaPg } from "@prisma/adapter-pg"
import { Prisma, PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { recommendationManifestDigest } from "../promotion/manifest"
import {
  PROFILE_USEFULNESS_ASSIGNMENT_POLICY_VERSION,
  PROFILE_USEFULNESS_OUTCOME_POLICY_VERSION,
} from "./assignment"
import {
  assignProfileUsefulnessExperiment,
  lockProfileUsefulnessAssignment,
} from "./usefulness-routing"
import { parseStudyProtocol, studyProtocolDigest } from "./study-protocol"
import { extractUsefulnessSnapshot } from "./usefulness-extractor"

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "profile comparison on PostgreSQL",
  () => {
    const schema = `usefulness_${randomUUID().replaceAll("-", "")}`
    const now = new Date()
    const assignedAt = new Date(now.getTime() - 48 * 3_600_000)
    const expiresAt = new Date(now.getTime() + 14 * 86_400_000)
    let admin: Client
    let prisma: PrismaClient
    let profileId: string
    const digest = "9".repeat(64)
    let configurationDigest = "7".repeat(64)
    const extraction = {
      experimentId: "semantic-aa-v1",
      configurationDigest,
      enrollmentStart: new Date(
        Math.floor(now.getTime() / 86_400_000) * 86_400_000 - 3 * 86_400_000,
      ),
      enrollmentEnd: new Date(
        Math.floor(now.getTime() / 86_400_000) * 86_400_000 - 86_400_000,
      ),
      plannedAssignmentsPerArm: 200,
      minimumUsefulDelta: 0.01,
    }
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
          (name) =>
            (Number(name.slice(0, 4)) >= 52 &&
              Number(name.slice(0, 4)) <= 82 &&
              name.includes("recommendation")) ||
            name === "0082_user_recommendation_identity" ||
            name === "0098_recommendation_viewing_mode" ||
            name === "0057_semantic_control_readiness" ||
            name === "0100_recommendation_candidate_compact_trace" ||
            name === "0103_recommendation_impression_visibility_capability" ||
            name === "0107_recommendation_governed_study",
        )
        .sort()) {
        await admin.query(
          readFileSync(new URL(`${name}/migration.sql`, root), "utf8"),
        )
      }
      prisma = new PrismaClient({
        adapter: new PrismaPg(
          {
            connectionString: env.DATABASE_URL,
            options: `-c search_path=${schema},public`,
          },
          { schema },
        ),
      })
      await prisma.recommendationExperiment.update({
        where: { id: "semantic-aa-v1" },
        data: {
          assignmentPolicyVersion: PROFILE_USEFULNESS_ASSIGNMENT_POLICY_VERSION,
          outcomePolicyVersion: PROFILE_USEFULNESS_OUTCOME_POLICY_VERSION,
          configurationDigest,
          startsAt: extraction.enrollmentStart,
          endsAt: extraction.enrollmentEnd,
          expiresAt,
        },
      })
      const manifest =
        await prisma.recommendationStrategyManifest.findUniqueOrThrow({
          where: { id: "semantic-experiment-aa-v1" },
        })
      const control =
        await prisma.recommendationStrategyManifest.findUniqueOrThrow({
          where: { id: "semantic-transcript-pgvector-v1" },
        })
      const protocol = parseStudyProtocol({
        version: "profile-study-governance-v1",
        studyId: extraction.experimentId,
        mode: "calibration",
        comparison: "semantic-aa",
        identity: "anonymous-profile-generation-v1",
        surface: "watch-below-player-v1",
        cohort: "human-en-english-durable-v1",
        controlManifestId: control.id,
        challengerManifestId: manifest.id,
        controlManifestDigest: recommendationManifestDigest(control),
        challengerManifestDigest: recommendationManifestDigest(manifest),
        incumbentExecution: "hybrid_personalized",
        controlExecution: "semantic_contextual",
        admissionBps: 10000,
        challengerProbability: 0.5,
        startsAt: extraction.enrollmentStart.toISOString(),
        endsAt: extraction.enrollmentEnd.toISOString(),
        expiresAt: expiresAt.toISOString(),
        stoppingRule: "fixed-enrollment-window-v1",
        plannedAssignmentsPerArm: 200,
        minimumUsefulDelta: null,
        evidenceMaxAgeHours: 24,
        calibrationEvaluationId: null,
      })
      configurationDigest = studyProtocolDigest(protocol)
      extraction.configurationDigest = configurationDigest
      await prisma.recommendationExperiment.update({
        where: { id: extraction.experimentId },
        data: { configurationDigest },
      })
      await prisma.recommendationStudy.create({
        data: {
          experimentId: extraction.experimentId,
          protocol,
          protocolDigest: configurationDigest,
          preparedById: "fixture-operator",
          activationId: randomUUID(),
          activationInputDigest: "a".repeat(64),
          activatedAt: extraction.enrollmentStart,
          expiresAt,
        },
      })
      const approval = await prisma.recommendationPromotionApproval.create({
        data: {
          manifestId: manifest.id,
          manifestDigest: recommendationManifestDigest(manifest),
          maxExposureBps: 5000,
          approvedById: "disposable-fixture-operator",
          expiresAt,
        },
      })
      await prisma.recommendationPromotionPointer.update({
        where: { id: "recommendation-promotion-pointer" },
        data: {
          activeManifestId: manifest.id,
          activeApprovalId: approval.id,
          stage: "BOUNDED",
          exposureCeilingBps: 5000,
        },
      })
      const profile = await prisma.recommendationProfile.create({
        data: {
          tokenDigest: digest,
          choice: "DURABLE_ALLOWED",
          privacyGeneration: 1,
          expiresAt,
        },
      })
      profileId = profile.id
    })
    afterAll(async () => {
      await prisma?.$disconnect()
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
    })

    it("serializes concurrent profile assignment, preserves zero-exposure units and fences changed generations", async () => {
      const assign = () =>
        assignProfileUsefulnessExperiment(prisma, {
          sessionDigest: digest,
          profileTokenDigest: digest,
          eligibleForEnrollment: true,
          now: assignedAt,
          deadlineAt: Date.now() + 3000,
        })
      const [first, second] = await Promise.all([assign(), assign()])
      expect(first.assignment).not.toBeNull()
      expect(second).toEqual(first)
      expect(await prisma.recommendationExperimentAssignment.count()).toBe(1)
      await prisma.$transaction((tx) =>
        lockProfileUsefulnessAssignment(tx, {
          assignment: first.assignment!,
          profileTokenDigest: digest,
          now: assignedAt,
        }),
      )
      await prisma.recommendationExperimentAssignment.updateMany({
        data: { assignedAt },
      })
      const empty = await extractUsefulnessSnapshot(prisma, extraction)
      expect(empty.snapshot.units).toHaveLength(1)
      expect(empty.snapshot.units[0]?.qualifiedViews).toBe(0)
      expect(empty.snapshot.health.assignmentLedgerCount).toBe(1)
      expect(empty.snapshot.health.aaPassed).toBe(false)
      expect(empty.assessment.decision).toBe("data_unhealthy")
      await prisma.recommendationProfile.update({
        where: { id: profileId },
        data: { privacyGeneration: { increment: 1 } },
      })
      await expect(
        prisma.$transaction((tx) =>
          lockProfileUsefulnessAssignment(tx, {
            assignment: first.assignment!,
            profileTokenDigest: digest,
            now: assignedAt,
          }),
        ),
      ).rejects.toThrow("experiment_assignment_fenced")
      expect(
        (await extractUsefulnessSnapshot(prisma, extraction)).snapshot.health
          .fencedAssignments,
      ).toBe(1)
    })

    it("refuses overlapping studies during an existing cohort's follow-up", async () => {
      const original = await prisma.recommendationExperiment.findUniqueOrThrow({
        where: { id: extraction.experimentId },
      })
      const duplicate = await prisma.recommendationExperiment.create({
        data: {
          ...original,
          id: "overlapping-profile-study",
          experimentVersion: "overlapping-profile-study",
        },
      })
      const count = await prisma.recommendationExperimentAssignment.count()
      expect(
        await assignProfileUsefulnessExperiment(prisma, {
          sessionDigest: digest,
          profileTokenDigest: digest,
          eligibleForEnrollment: true,
          now: assignedAt,
          deadlineAt: Date.now() + 3000,
        }),
      ).toEqual({ assignment: null, bypassReason: "no_active_experiment" })
      expect(await prisma.recommendationExperimentAssignment.count()).toBe(
        count,
      )
      await prisma.recommendationExperiment.delete({
        where: { id: duplicate.id },
      })
    })

    it("counts a qualified muted preview once and uses the latest compatible manual revision", async () => {
      const profile = await prisma.recommendationProfile.create({
        data: {
          tokenDigest: "8".repeat(64),
          choice: "DURABLE_ALLOWED",
          privacyGeneration: 1,
          expiresAt,
        },
      })
      const assignment = await prisma.recommendationExperimentAssignment.create(
        {
          data: {
            experimentId: extraction.experimentId,
            unitKind: "ANONYMOUS_PROFILE",
            unitDigest: "6".repeat(64),
            profileId: profile.id,
            privacyGeneration: 1,
            arm: "CONTROL",
            assignmentProbability: 0.5,
            configurationDigest,
            assignedAt,
            expiresAt,
          },
        },
      )
      const request = await prisma.recommendationRequest.create({
        data: {
          contractVersion: "semantic-recommendation-v1",
          surfaceVersion: "watch-below-player-v1",
          manifestId: "semantic-transcript-pgvector-v1",
          strategyVersion: "semantic-transcript-pgvector-v1",
          classifierVersion: "legacy-position-v0",
          sessionDigest: "8".repeat(64),
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
              id: "comparison-item",
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
          effectiveManifestId: "semantic-transcript-pgvector-v1",
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
          itemId: "comparison-item",
          capabilityJti: "impression",
          eventId: "impression",
          payloadDigest: digest,
          visibilityPolicy: "watch-below-player-v1",
          occurredAt: assignedAt,
          receivedAt: assignedAt,
          expiresAt,
        },
      })
      const selection = await prisma.recommendationSelection.create({
        data: {
          requestId: request.id,
          itemId: "comparison-item",
          capabilityJti: "selection",
          eventId: "selection",
          payloadDigest: digest,
          claimNonceDigest: digest,
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
          itemId: "comparison-item",
          selectionId: selection.id,
          mediaId: "target",
          sessionDigest: "8".repeat(64),
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
          itemId: "comparison-item",
          episodeId: episode.id,
          classifierVersion: "active-watch-proxy-v1",
          revision: 1,
          factWatermark: 1,
          inputDigest: digest,
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
          inputDigest: digest,
          expiresAt,
        },
      })
      await prisma.recommendationViewingModeEvidence.create({
        data: {
          episodeId: episode.id,
          profileId: profile.id,
          privacyGeneration: 1,
          sessionDigest: "8".repeat(64),
          mediaId: "target",
          policyVersion: "sound-off-viewing-v1",
          factWatermark: 1,
          soundOffMilliseconds: 30_000,
          soundOnMilliseconds: 30_000,
          soundOffProgressSeconds: 30,
          soundOnProgressSeconds: 30,
          soundOffQualified: true,
          soundOnQualified: true,
          previewMilliseconds: 30_000,
          durationSeconds: 120,
          observedAt: assignedAt,
          expiresAt,
        },
      })
      const count = async () =>
        (
          await extractUsefulnessSnapshot(prisma, extraction)
        ).snapshot.units.find(
          (unit) => unit.unitDigest === assignment.unitDigest,
        )?.qualifiedViews
      expect(await count()).toBe(1) // Sound on, sound off and manual evidence are one episode.
      await prisma.recommendationViewingModeEvidence.delete({
        where: { episodeId: episode.id },
      })
      expect(await count()).toBe(1)
      await prisma.recommendationOutcomeRevision.create({
        data: {
          ...outcome,
          id: randomUUID(),
          activeIntervals: outcome.activeIntervals ?? Prisma.JsonNull,
          revision: 2,
          factWatermark: 2,
          inputDigest: "5".repeat(64),
          qualifiedView: false,
          supersedesId: outcome.id,
        },
      })
      expect(await count()).toBe(0)
    })
  },
)
