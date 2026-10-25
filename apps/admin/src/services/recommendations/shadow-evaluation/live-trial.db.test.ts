import { randomUUID } from "node:crypto"
import { PrismaClient, type Prisma } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import {
  CANDIDATE_CONTEXT_VERSION,
  CANDIDATE_ELIGIBILITY_VERSION,
} from "../candidate"
import { compositionDigest } from "../composition/policy"
import { MMR_SLATE_POLICY_VERSION } from "../composition/mmr"
import { nominations, thresholds } from "../composition/test-helpers"
import {
  prepareCompositionProtocol,
  decideCompositionProtocol,
  recordCompositionCalibration,
  resolveCompositionQualification,
  type CompositionBinding,
} from "../composition/service"
import { COWATCH_SHADOW_GENERATOR_KEY } from "../cowatch/graph"
import {
  COWATCH_FROZEN_TRIAL_MODE,
  qualifyCowatchTrialAuthority,
  readCowatchTrialAuthority,
  type CowatchTrialBinding,
} from "../cowatch/trial-authority.service"
import {
  COWATCH_MMR_TRIAL_MANIFEST,
  recommendationManifestDigest,
} from "../promotion/manifest"
import {
  createShadowEvaluation,
  sampleProfileShadowEvaluationContexts,
  claimNextShadowRun,
  executeClaimedShadowRun,
  completeShadowEvaluation,
} from "./service"
import { seedLiveTrialGraph } from "./live-trial.test-helpers"

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "integrated co-watch shadow and composition authority",
  () => {
    let db: PrismaClient
    beforeAll(async () => {
      const url = new URL(env.DATABASE_URL)
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.pathname !== "/forge_test" ||
        url.search ||
        url.hash
      )
        throw new Error("Owned loopback forge_test database required")
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url.toString(), max: 4 }),
      })
      await db.recommendationStrategyManifest.upsert({
        where: { id: COWATCH_MMR_TRIAL_MANIFEST.id },
        create: COWATCH_MMR_TRIAL_MANIFEST,
        update: {},
      })
    })
    // Immutable aggregate decisions remain in this disposable database until expiry.
    afterAll(async () => db?.$disconnect())
    it.each(["approval", "request_deleted_before_publication"] as const)(
      "pins a real graph across sampling and publication: %s",
      async (scenario) => {
        const graph = await seedLiveTrialGraph(db)
        const now = new Date(graph.publication.publishedAt!.getTime() + 1_000)
        const requestAt = new Date(graph.created.getTime() - 600_000)
        const evaluationId = randomUUID(),
          protocolId = randomUUID(),
          requestId = randomUUID()
        const operator = {
          actor: { id: "native-integration-operator", role: "ADMIN" as const },
          authenticatedAt: now,
        }
        const manifest = COWATCH_MMR_TRIAL_MANIFEST
        const projection =
          await db.recommendationProfileProjectionGeneration.create({
            data: {
              id: randomUUID(),
              manifestId: manifest.id,
              scope: "DURABLE",
              profileId: graph.profileId,
              privacyGeneration: 1,
              generation: 1,
              state: "PUBLISHED",
              projectionVersion: "multi-interest-profile-projection-v1",
              clusteringVersion: "deterministic-farthest-first-medoids-v1",
              eligibilityPolicyVersion: "fixture",
              outcomeClassifierVersion: "active-watch-proxy-v1",
              inputWindowStart: graph.sourceWindow.windowStart,
              inputWindowEnd: graph.sourceWindow.windowEnd,
              inputDigest: compositionDigest(requestId),
              durableInterestCount: 1,
              retentionDays: 180,
              publishedAt: graph.created,
              expiresAt: graph.expiresAt,
            },
          })
        await db.recommendationProfileProjectionPointer.create({
          data: {
            scopeDigest: compositionDigest(projection.id),
            scope: "DURABLE",
            profileId: graph.profileId,
            privacyGeneration: 1,
            generationId: projection.id,
            pointerGeneration: 1,
          },
        })
        const candidates = nominations().map((row, index) =>
          index === 0
            ? {
                ...row,
                targetMediaId: graph.mediaB,
                canonicalIdentity: {
                  ...row.canonicalIdentity,
                  videoId: graph.mediaB,
                  videoCoreId: graph.mediaB,
                },
                source: {
                  ...row.source,
                  generator: "directional-cowatch",
                  generatorVersion: COWATCH_SHADOW_GENERATOR_KEY,
                  evidence: {
                    ...row.source.evidence,
                    generation: graph.graphGenerationId,
                  },
                },
              }
            : row,
        )
        const requestData = {
          id: requestId,
          manifestId: manifest.id,
          contractVersion: manifest.contractVersion,
          surfaceVersion: manifest.surfaceVersion,
          strategyVersion: manifest.strategyVersion,
          classifierVersion: "active-watch-proxy-v1",
          sessionDigest: graph.sessionDigest,
          locale: "en",
          seedMediaId: graph.mediaA,
          expectedItemCount: 2,
          state: "ISSUED",
          result: "SERVED",
          signingKid: "fixture",
          deliveryJti: randomUUID(),
          issuedAt: requestAt,
          createdAt: requestAt,
          expiresAt: graph.expiresAt,
          items: {
            create: candidates.slice(0, 2).map((row, position) => ({
              position,
              targetMediaId: row.targetMediaId,
              canonicalHref: `/watch/${row.targetMediaId}.html`,
              candidateGenerator: "semantic",
              candidateProvenance: {},
              capabilityJti: randomUUID(),
              signingKid: "fixture",
              presentation: row.presentation,
              createdAt: requestAt,
              expiresAt: graph.expiresAt,
            })),
          },
          candidateRun: {
            create: {
              purpose: "watch",
              contextVersion: CANDIDATE_CONTEXT_VERSION,
              generatorVersion: "fixture",
              unionVersion: "fixture",
              eligibilityVersion: CANDIDATE_ELIGIBILITY_VERSION,
              rankerVersion: "fixture",
              composerVersion: "fixture",
              candidateEligibilityParity: "passed",
              rankerParity: "passed",
              nominatedCount: 2,
              canonicalizedCount: 2,
              deduplicatedCount: 0,
              rejectedCount: 0,
              scoredCount: 2,
              orderedCount: 2,
              composedCount: 2,
              evidenceComplete: true,
              createdAt: requestAt,
              expiresAt: graph.expiresAt,
            },
          },
        } satisfies Prisma.RecommendationRequestUncheckedCreateInput
        await db.recommendationRequest.create({ data: requestData })
        const createSiblingRequest = (id: string, createdAt = requestAt) =>
          db.recommendationRequest.create({
            data: {
              ...requestData,
              id,
              createdAt,
              issuedAt: createdAt,
              deliveryJti: randomUUID(),
              items: {
                create: requestData.items.create.map((item) => ({
                  ...item,
                  capabilityJti: randomUUID(),
                  createdAt,
                })),
              },
            },
          })
        const siblingId = randomUUID()
        const sampledCount = scenario === "approval" ? 1 : 2
        if (sampledCount === 2) await createSiblingRequest(siblingId)
        // These issued requests share the same window. Exclusion is a frozen
        // cohort predicate before hashing, not a filter of failed sampled runs.
        const sessionDigest = compositionDigest(randomUUID())
        await db.recommendationProfileProjectionGeneration
          .create({
            data: {
              ...projection,
              id: randomUUID(),
              scope: "SESSION",
              profileId: null,
              privacyGeneration: null,
              sessionDigest,
              generation: 1,
              durableInterestCount: 0,
              sessionIntentPresent: true,
              retentionDays: 1,
              expiresAt: new Date(now.getTime() + 3_600_000),
            },
          })
          .then(async (sessionProjection) => {
            await db.recommendationProfileProjectionPointer.create({
              data: {
                scopeDigest: compositionDigest(sessionProjection.id),
                scope: "SESSION",
                sessionDigest,
                generationId: sessionProjection.id,
                pointerGeneration: 1,
              },
            })
          })
        for (const kind of [
          "anonymous",
          "session",
          "locale",
          "audio",
        ] as const) {
          await db.recommendationRequest.create({
            data: {
              ...requestData,
              id: randomUUID(),
              deliveryJti: randomUUID(),
              sessionDigest:
                kind === "anonymous"
                  ? compositionDigest(randomUUID())
                  : kind === "session"
                    ? sessionDigest
                    : graph.sessionDigest,
              locale: kind === "locale" ? "fr" : "en",
              items: {
                create: candidates.slice(0, 2).map((row, position) => ({
                  position,
                  targetMediaId: row.targetMediaId,
                  canonicalHref: `/watch/${row.targetMediaId}.html`,
                  candidateGenerator: "semantic",
                  candidateProvenance: {},
                  capabilityJti: randomUUID(),
                  signingKid: "fixture",
                  presentation: {
                    ...row.presentation,
                    audioLanguageSlug: kind === "audio" ? "french" : "english",
                  },
                  createdAt: requestAt,
                  expiresAt: graph.expiresAt,
                })),
              },
            },
          })
        }
        const create = {
          evaluationId,
          manifestId: manifest.id,
          generatorVersion: COWATCH_SHADOW_GENERATOR_KEY,
          contextVersion: CANDIDATE_CONTEXT_VERSION,
          eligibilityVersion: CANDIDATE_ELIGIBILITY_VERSION,
          cowatchGenerationId: graph.graphGenerationId,
          windowStart: new Date(requestAt.getTime() - 1),
          windowEnd: new Date(requestAt.getTime() + 1),
          requestedSampleSize: 500,
          now,
        }
        await expect(createShadowEvaluation(db, create)).rejects.toThrow(
          "cowatch_trial_protocol_invalid",
        )
        const protocol = await prepareCompositionProtocol(
          db,
          operator,
          {
            protocolId,
            shadowEvaluationId: evaluationId,
            sourceManifestId: manifest.id,
            challengerManifestId: manifest.id,
            generatorVersion: COWATCH_SHADOW_GENERATOR_KEY,
            cowatchGenerationId: graph.graphGenerationId,
            thresholds,
          },
          now,
        )
        if (scenario === "approval") {
          const emptyEvaluationId = randomUUID()
          const emptyWindow = new Date(requestAt.getTime() - 60_000)
          await prepareCompositionProtocol(
            db,
            operator,
            {
              protocolId: randomUUID(),
              shadowEvaluationId: emptyEvaluationId,
              sourceManifestId: manifest.id,
              challengerManifestId: manifest.id,
              generatorVersion: COWATCH_SHADOW_GENERATOR_KEY,
              cowatchGenerationId: graph.graphGenerationId,
              thresholds,
            },
            now,
          )
          await createShadowEvaluation(db, {
            ...create,
            evaluationId: emptyEvaluationId,
            windowStart: emptyWindow,
            windowEnd: new Date(emptyWindow.getTime() + 1),
          })
          const emptySample = {
            evaluationId: emptyEvaluationId,
            expectedGeneration: 1,
            now,
          }
          expect(
            await sampleProfileShadowEvaluationContexts(db, emptySample),
          ).toMatchObject({
            status: "sampled",
            sampledCount: 0,
            createdCount: 0,
          })
          await createSiblingRequest(randomUUID(), emptyWindow)
          expect(
            await sampleProfileShadowEvaluationContexts(db, emptySample),
          ).toMatchObject({
            status: "sampled",
            sampledCount: 0,
            createdCount: 0,
          })
          const receipt =
            await db.recommendationShadowEvaluation.findUniqueOrThrow({
              where: { id: emptyEvaluationId },
            })
          expect(receipt.sampledAt).toEqual(now)
          for (const data of [
            { sampledAt: null },
            { sampledAt: new Date(now.getTime() + 1) },
            { sampledCount: 1 },
          ])
            await expect(
              db.recommendationShadowEvaluation.update({
                where: { id: emptyEvaluationId },
                data,
              }),
            ).rejects.toThrow("sampling receipt is immutable")
        }
        await createShadowEvaluation(db, create)
        await expect(
          db.recommendationShadowEvaluation.update({
            where: { id: evaluationId },
            data: { cowatchGenerationId: "b".repeat(64) },
          }),
        ).rejects.toThrow()
        expect(
          await sampleProfileShadowEvaluationContexts(db, {
            evaluationId,
            expectedGeneration: 1,
            now,
          }),
        ).toMatchObject({ status: "sampled", sampledCount })
        for (let index = 0; index < sampledCount; index++) {
          const claim = await claimNextShadowRun(db, {
            evaluationId,
            expectedGeneration: 1,
            now,
          })
          if (claim.status !== "claimed")
            throw new Error("Native claim missing")
          const run = await db.recommendationShadowRun.findUniqueOrThrow({
            where: { id: claim.runId },
          })
          expect(run.contextProjectionRef).toBe(projection.id)
          expect([requestId, siblingId]).toContain(run.requestId)
          expect(
            await executeClaimedShadowRun(db, {
              runId: claim.runId,
              expectedRunGeneration: claim.generation,
              expectedEvaluationGeneration: 1,
              claimId: claim.claimId,
              now,
              // Only retrieval is a deterministic synthetic fixture; sampling, claim,
              // graph/source checks, publication, observation and approvals are real DB services.
              generator: async () => ({
                nominations: candidates,
                cohortQuality: 1,
                projectionCapturedAt: now,
              }),
            }),
          ).toMatchObject({ status: "published" })
        }
        if (scenario === "request_deleted_before_publication") {
          let release!: () => void
          let reached!: () => void
          const paused = new Promise<void>((resolve) => {
            reached = resolve
          })
          const resume = new Promise<void>((resolve) => {
            release = resolve
          })
          let intercepted = false
          // Pause a real transaction just before its graph SHARE lock. This is
          // after the terminal service's initial cohort snapshot. The former
          // implementation also read protocol authority before reaching this gap.
          const observed = db.$extends({
            query: {
              async $queryRaw({ args, query }) {
                const sql = args as Prisma.Sql
                if (
                  !intercepted &&
                  sql.sql?.includes("FROM recommendation_cowatch_generation") &&
                  sql.sql.includes("FOR SHARE")
                ) {
                  intercepted = true
                  reached()
                  await resume
                }
                return query(args)
              },
            },
          })
          const terminal = completeShadowEvaluation(
            observed as unknown as PrismaClient,
            {
              evaluationId,
              expectedGeneration: 1,
              minimumRuns: 1,
              now,
            },
          )
          try {
            await Promise.race([
              paused,
              terminal.then(() => {
                throw new Error("Publication did not reach the graph fence")
              }),
            ])
            await db.recommendationRequest.delete({ where: { id: requestId } })
            expect(
              await db.recommendationShadowRun.count({
                where: { evaluationId },
              }),
            ).toBe(1)
            expect(
              (
                await db.recommendationCowatchGeneration.findUniqueOrThrow({
                  where: { id: graph.graphGenerationId },
                })
              ).invalidatedAt,
            ).toBeNull()
          } finally {
            release()
          }
          expect(await terminal).toMatchObject({
            status: "decided",
            decision: "inconclusive",
          })
          expect(
            await db.recommendationShadowDecision.findUniqueOrThrow({
              where: { evaluationId },
            }),
          ).toMatchObject({
            reasonCode: "cowatch_trial_protocol_invalid",
          })
          expect(
            await db.recommendationShadowEvaluation.findUniqueOrThrow({
              where: { id: evaluationId },
            }),
          ).toMatchObject({
            sampledCount: 2,
          })
          return
        }
        const terminal = await completeShadowEvaluation(db, {
          evaluationId,
          expectedGeneration: 1,
          minimumRuns: 1,
          now,
        })
        expect(terminal).toMatchObject({
          status: "decided",
          decision: "promote_to_experiment",
        })
        const candidateDecision =
          await db.recommendationShadowDecision.findUniqueOrThrow({
            where: { evaluationId },
          })
        const decision = await decideCompositionProtocol(
          db,
          operator,
          protocolId,
          now,
        )
        expect(decision.decision).toBe("qualify_for_controlled_study")
        const review = await recordCompositionCalibration(
          db,
          operator,
          {
            protocolId,
            configDigest: protocol.configDigest,
            evidenceDigest: decision.evidenceDigest,
            rationale:
              "Synthetic native integration fixture; no production calibration or efficacy claim.",
          },
          now,
        )
        const composition: CompositionBinding = {
          protocolId,
          manifestId: manifest.id,
          composerVersion: MMR_SLATE_POLICY_VERSION,
          configDigest: protocol.configDigest,
          evidenceDigest: decision.evidenceDigest,
          reviewDigest: review.reviewDigest,
          authorityRevision: 1,
          cowatchGenerationId: graph.graphGenerationId,
        }
        expect(
          await resolveCompositionQualification(db, composition, now),
        ).not.toBeNull()
        const enrollmentEnd = new Date(now.getTime() + 3 * 86_400_000)
        const binding: CowatchTrialBinding = {
          mode: COWATCH_FROZEN_TRIAL_MODE,
          studyId: randomUUID(),
          experimentGeneration: 1,
          protocolDigest: compositionDigest(protocolId),
          manifestId: manifest.id,
          manifestDigest: recommendationManifestDigest(manifest),
          graphGenerationId: graph.graphGenerationId,
          sourceWindow: graph.sourceWindow,
          calibrationCompletedAt: new Date(graph.created.getTime() - 1),
          enrollmentEnd,
          trialValidUntil: new Date(enrollmentEnd.getTime() + 30 * 3_600_000),
          shadowEvaluationId: evaluationId,
          shadowDecisionId: candidateDecision.id,
        }
        expect(
          await qualifyCowatchTrialAuthority(db, binding, now),
        ).toMatchObject({ status: "qualified" })
        await db.recommendationProfile.update({
          where: { id: graph.profileId },
          data: { privacyGeneration: 2 },
        })
        expect(await readCowatchTrialAuthority(db, binding, now)).toMatchObject(
          {
            status: "refused",
          },
        )
        expect(
          await resolveCompositionQualification(db, composition, now),
        ).toBeNull()
      },
      30_000,
    )
  },
)
