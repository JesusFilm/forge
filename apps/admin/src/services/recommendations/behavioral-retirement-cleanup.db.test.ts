import { createHash, randomUUID } from "node:crypto"
import { Client } from "pg"
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { env } from "@/config/env"
import { currentAdminMigrationSql } from "./current-schema.test-fixture"
import { RecommendationViewerService } from "./viewer-identity.service"
import { RecommendationProfileService } from "./profile.service"
import { runRecommendationProfileProjectionJob } from "./profiles/job"
import { purgeExpiredRecommendationRequests } from "./retention.service"
import {
  RetirementAdmissionError,
  RetirementBatchFailureError,
  RetirementUncertainCommitError,
  runBehavioralRetirementWindow,
  RETIREMENT_PHASES,
  type RetirementCutoverProof,
} from "./behavioral-retirement-cleanup"

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex")
const source = "b".repeat(40)
const day = 86_400_000
const projectionRuntime =
  "workflow//./src/workflows/recommendationProfileProjection//runRecommendationProfileProjection"

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "behavioral retirement on populated PostgreSQL",
  () => {
    const schema = `behavioral_cleanup_${randomUUID().replaceAll("-", "")}`
    let client: Client
    let db: PrismaClient
    let connected = false
    let ownedWorkflowSchema = false
    let ownedWorkflowTable = false
    let ownedTestSchema = false
    const baseUrl = env.DATABASE_URL
    const proof = { releaseBCommit: source } as RetirementCutoverProof
    const operationId = randomUUID()

    async function reconnect(): Promise<Client> {
      const next = new Client({ connectionString: baseUrl })
      await next.connect()
      await next.query(`SET search_path TO "${schema}", public`)
      return next
    }

    async function run(maxBatches = 20, batchSize = 2) {
      return runBehavioralRetirementWindow(client, {
        operationId,
        sourceCommit: source,
        batchSize,
        maxBatches,
        cutoverProof: proof,
        reconnectForReceipt: reconnect,
      })
    }

    async function linkedProfileFixture(expiresAt: Date) {
      const tag = randomUUID()
      const now = new Date()
      const manifestId = `privacy-${tag}`
      const profileDigest = digest(`${tag}-profile`)
      const sessionDigest = digest(`${tag}-session`)
      await db.recommendationStrategyManifest.create({
        data: {
          id: manifestId,
          strategyVersion: manifestId,
          contractVersion: "semantic-recommendation-v1",
          surfaceVersion: "watch-below-player-v1",
          generator: "semantic",
          maxItems: 1,
        },
      })
      const profile = await db.recommendationProfile.create({
        data: {
          tokenDigest: profileDigest,
          privacyGeneration: 1,
          choice: "DURABLE_ALLOWED",
          state: "ACTIVE",
          expiresAt,
        },
      })
      await db.recommendationProfileSessionLink.create({
        data: {
          profileId: profile.id,
          privacyGeneration: 1,
          sessionDigest,
          expiresAt,
        },
      })
      const generation =
        await db.recommendationProfileProjectionGeneration.create({
          data: {
            id: `privacy-generation-${tag}`,
            manifestId,
            scope: "DURABLE",
            profileId: profile.id,
            privacyGeneration: 1,
            generation: 1,
            state: "PUBLISHED",
            projectionVersion: "fixture",
            clusteringVersion: "fixture",
            eligibilityPolicyVersion: "fixture",
            outcomeClassifierVersion: "fixture",
            inputWindowStart: new Date(now.getTime() - day),
            inputWindowEnd: now,
            inputDigest: digest(`${tag}-generation`),
            retentionDays: 180,
            publishedAt: now,
            expiresAt: new Date(now.getTime() + 20 * day),
          },
        })
      const request = await db.recommendationRequest.create({
        data: {
          id: `privacy-request-${tag}`,
          contractVersion: "semantic-recommendation-v1",
          surfaceVersion: "watch-below-player-v1",
          manifestId,
          strategyVersion: manifestId,
          classifierVersion: "fixture",
          sessionDigest: digest(`${tag}-request`),
          locale: "en",
          seedMediaId: "fixture",
          expectedItemCount: 0,
          state: "ISSUED",
          result: "EMPTY",
          deliveryJti: randomUUID(),
          signingKid: "fixture",
          issuedAt: now,
          createdAt: now,
          expiresAt: new Date(now.getTime() + 20 * day),
        },
      })
      await db.recommendationPersonalizationDecision.create({
        data: {
          requestId: request.id,
          effectiveManifestId: manifestId,
          lane: "profile_challenger",
          projectionGenerationId: generation.id,
          projectionScope: "durable",
          projectionVersion: "fixture",
          projectionGenerationNumber: 1,
          interestCount: 1,
          expiresAt: new Date(now.getTime() + 20 * day),
        },
      })
      return {
        profile,
        profileDigest,
        sessionDigest,
        generation,
        request,
        manifestId,
      }
    }

    async function createOwnedWorkflowFixture(target: Client): Promise<void> {
      const existing = await target.query<{ present: boolean }>(
        "SELECT to_regnamespace('workflow') IS NOT NULL AS present",
      )
      if (existing.rows[0]?.present)
        throw new Error("Refusing to adopt a preexisting workflow schema")
      await target.query("CREATE SCHEMA workflow")
      ownedWorkflowSchema = true
      await target.query(`CREATE TABLE workflow.workflow_runs (
        id text PRIMARY KEY, name text NOT NULL, status text NOT NULL,
        completed_at timestamptz
      )`)
      ownedWorkflowTable = true
    }

    beforeAll(async () => {
      const url = new URL(baseUrl)
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.pathname !== "/forge_test" ||
        url.search ||
        url.hash
      )
        throw new Error("Explicit owned loopback forge_test fixture required")
      client = await reconnect()
      connected = true
      await createOwnedWorkflowFixture(client)
      await client.query(`CREATE SCHEMA "${schema}"`)
      ownedTestSchema = true
      await client.query(`SET search_path TO "${schema}", public`)
      for (const migration of currentAdminMigrationSql)
        await client.query(migration)
      const prismaUrl = new URL(baseUrl)
      prismaUrl.searchParams.set("schema", schema)
      db = new PrismaClient({
        datasources: { db: { url: prismaUrl.toString() } },
      })
    }, 180_000)

    afterAll(async () => {
      await db?.$disconnect()
      if (connected) {
        if (ownedTestSchema)
          await client.query(`DROP SCHEMA "${schema}" CASCADE`)
        if (ownedWorkflowTable)
          await client.query("DROP TABLE workflow.workflow_runs")
        if (ownedWorkflowSchema)
          await client.query("DROP SCHEMA workflow RESTRICT")
        await client.end()
      }
    })

    it("refuses to adopt an existing workflow schema without changing it", async () => {
      const before = await client.query<{ n: number }>(
        "SELECT count(*)::integer AS n FROM pg_class WHERE relnamespace = 'workflow'::regnamespace",
      )
      await expect(createOwnedWorkflowFixture(client)).rejects.toThrow(
        "Refusing to adopt a preexisting workflow schema",
      )
      const after = await client.query<{ n: number }>(
        "SELECT count(*)::integer AS n FROM pg_class WHERE relnamespace = 'workflow'::regnamespace",
      )
      expect(after.rows[0]?.n).toBe(before.rows[0]?.n)
    })

    it("refuses a nonterminal learner before any batch or retained-row change", async () => {
      const runId = randomUUID()
      const runtimeId = randomUUID()
      await client.query(
        "INSERT INTO workflow.workflow_runs (id, name, status) VALUES ($1, $2, 'running')",
        [runtimeId, projectionRuntime],
      )
      await db.workflowRun.create({
        data: {
          id: runId,
          runtimeRunId: runtimeId,
          workflowKey: "recommendation-profile-projection",
          trigger: "MANUAL",
          status: "RUNNING",
        },
      })
      await expect(run()).rejects.toBeInstanceOf(RetirementAdmissionError)
      expect(await db.recommendationBehavioralRetirementBatch.count()).toBe(0)
      await db.workflowRun.update({
        where: { id: runId },
        data: { status: "CANCELLED" },
      })
      await client.query(
        "UPDATE workflow.workflow_runs SET status = 'failed', completed_at = now() WHERE id = $1",
        [runtimeId],
      )
    })

    it("admits a historical queued business row only when its actual runtime is terminal", async () => {
      const runtimeId = randomUUID()
      await client.query(
        "INSERT INTO workflow.workflow_runs (id, name, status, completed_at) VALUES ($1, $2, 'failed', now())",
        [runtimeId, projectionRuntime],
      )
      await db.workflowRun.create({
        data: {
          id: randomUUID(),
          runtimeRunId: runtimeId,
          workflowKey: "recommendation-profile-projection",
          trigger: "MANUAL",
          status: "QUEUED",
        },
      })
      expect((await run()).status).toBe("complete")
    })

    it("refuses an orphan runtime or a missing runtime join", async () => {
      const runtimeId = randomUUID()
      await client.query(
        "INSERT INTO workflow.workflow_runs (id, name, status) VALUES ($1, $2, 'pending')",
        [runtimeId, projectionRuntime],
      )
      await expect(run()).rejects.toBeInstanceOf(RetirementAdmissionError)
      await client.query(
        "UPDATE workflow.workflow_runs SET status = 'cancelled' WHERE id = $1",
        [runtimeId],
      )
      const ledger = await db.workflowRun.create({
        data: {
          id: randomUUID(),
          runtimeRunId: randomUUID(),
          workflowKey: "recommendation-profile-projection",
          trigger: "MANUAL",
          status: "QUEUED",
        },
      })
      await expect(run()).rejects.toBeInstanceOf(RetirementAdmissionError)
      await db.workflowRun.delete({ where: { id: ledger.id } })
    })

    it("fences pending and claimed projection runs under the terminal check without rewriting historical failures", async () => {
      const now = new Date()
      const expiresAt = new Date(now.getTime() + day)
      const pendingId = `pending-retirement-${randomUUID()}`
      const claimedId = `claimed-retirement-${randomUUID()}`
      const historicalId = `failed-retirement-${randomUUID()}`
      const ids = [pendingId, claimedId, historicalId]
      await db.recommendationProfileProjectionRun.createMany({
        data: [
          {
            id: pendingId,
            scope: "SESSION",
            sessionDigest: digest(pendingId),
            state: "PENDING",
            expiresAt,
          },
          {
            id: claimedId,
            scope: "SESSION",
            sessionDigest: digest(claimedId),
            state: "CLAIMED",
            attemptCount: 1,
            claimId: randomUUID(),
            claimedAt: now,
            heartbeatAt: now,
            leaseExpiresAt: new Date(now.getTime() + 60_000),
            expiresAt,
          },
          {
            id: historicalId,
            scope: "SESSION",
            sessionDigest: digest(historicalId),
            state: "FAILED",
            completedAt: now,
            failureReason: "historical_failure",
            lastTransitionReason: "historical_failure",
            expiresAt,
          },
        ],
      })
      try {
        const historicalBefore =
          await db.recommendationProfileProjectionRun.findUniqueOrThrow({
            where: { id: historicalId },
          })
        for (const id of [pendingId, claimedId]) {
          await expect(
            runRecommendationProfileProjectionJob(
              { runId: id, expectedGeneration: 1 },
              db,
            ),
          ).resolves.toMatchObject({
            status: "fenced",
            reason: "behavioral_recommendations_retired",
          })
          expect(
            await db.recommendationProfileProjectionRun.findUniqueOrThrow({
              where: { id },
            }),
          ).toMatchObject({
            state: "FENCED",
            failureReason: "behavioral_recommendations_retired",
            lastTransitionReason: "behavioral_recommendations_retired",
            completedAt: expect.any(Date),
            leaseExpiresAt: null,
          })
        }
        await runRecommendationProfileProjectionJob(
          { runId: historicalId, expectedGeneration: 1 },
          db,
        )
        expect(
          await db.recommendationProfileProjectionRun.findUniqueOrThrow({
            where: { id: historicalId },
          }),
        ).toEqual(historicalBefore)
      } finally {
        await db.recommendationProfileProjectionRun.deleteMany({
          where: { id: { in: ids } },
        })
      }
    })

    it("detaches historical experiment, shadow and decision references, then drains retired rows", async () => {
      const tag = randomUUID()
      const now = new Date()
      const createdAt = new Date(now.getTime() - 10_000)
      const future = new Date(now.getTime() + 20 * day)
      const manifestId = `retirement-${tag}`
      await db.recommendationStrategyManifest.create({
        data: {
          id: manifestId,
          strategyVersion: manifestId,
          contractVersion: "semantic-recommendation-v1",
          surfaceVersion: "watch-below-player-v1",
          generator: "semantic",
          maxItems: 1,
        },
      })
      const profile = await db.recommendationProfile.create({
        data: {
          tokenDigest: digest(tag),
          privacyGeneration: 1,
          choice: "DURABLE_ALLOWED",
          state: "ACTIVE",
          expiresAt: future,
        },
      })
      await db.recommendationConsentReceipt.create({
        data: {
          tokenDigest: digest(`${tag}-receipt`),
          contractVersion: "fixture",
          choice: "PERSONALIZATION",
          profileId: profile.id,
          privacyGeneration: 1,
          expiresAt: future,
        },
      })
      await db.recommendationConsentTransition.create({
        data: {
          auditId: randomUUID(),
          profileId: profile.id,
          kind: "GRANT",
          toGeneration: 1,
          choice: "DURABLE_ALLOWED",
          occurredAt: now,
          expiresAt: future,
        },
      })
      await db.recommendationProfileSessionLink.create({
        data: {
          profileId: profile.id,
          privacyGeneration: 1,
          sessionDigest: digest(`${tag}-session`),
          expiresAt: future,
        },
      })
      const experiment = await db.recommendationExperiment.create({
        data: {
          id: tag,
          experimentVersion: tag,
          surfaceVersion: "owned-retirement",
          controlManifestId: manifestId,
          challengerManifestId: manifestId,
          assignmentPolicyVersion: "fixture",
          outcomePolicyVersion: "fixture",
          integrityPolicyVersion: "fixture",
          evaluationPolicyVersion: "fixture",
          configurationDigest: digest(`${tag}-config`),
          challengerProbability: 0.5,
          startsAt: createdAt,
          endsAt: now,
          expiresAt: future,
        },
      })
      const assignment = await db.recommendationExperimentAssignment.create({
        data: {
          experimentId: experiment.id,
          unitKind: "ANONYMOUS_PROFILE",
          unitDigest: digest(`${tag}-unit`),
          profileId: profile.id,
          privacyGeneration: 1,
          arm: "CONTROL",
          assignmentProbability: 0.5,
          configurationDigest: digest(`${tag}-config`),
          expiresAt: future,
        },
      })
      const { request, item } = await db.$transaction(async (tx) => {
        const request = await tx.recommendationRequest.create({
          data: {
            id: `request-${tag}`,
            contractVersion: "semantic-recommendation-v1",
            surfaceVersion: "watch-below-player-v1",
            manifestId,
            strategyVersion: manifestId,
            classifierVersion: "fixture",
            sessionDigest: digest(`${tag}-request`),
            locale: "en",
            seedMediaId: "fixture",
            expectedItemCount: 1,
            state: "ISSUED",
            result: "SERVED",
            deliveryJti: randomUUID(),
            signingKid: "fixture",
            experimentAssignmentId: assignment.id,
            issuedAt: createdAt,
            createdAt,
            expiresAt: future,
          },
        })
        const item = await tx.recommendationServedItem.create({
          data: {
            requestId: request.id,
            position: 0,
            targetMediaId: "fixture-target",
            canonicalHref: "/watch/fixture.html",
            candidateGenerator: "semantic",
            candidateProvenance: {},
            capabilityJti: randomUUID(),
            signingKid: "fixture",
            presentation: "video",
            createdAt,
            expiresAt: future,
          },
        })
        return { request, item }
      })
      const exposure = await db.recommendationExperimentExposure.create({
        data: {
          assignmentId: assignment.id,
          requestId: request.id,
          itemId: item.id,
          eventId: `exposure-${tag}`,
          arm: "CONTROL",
          effectiveManifestId: manifestId,
          assignmentProbability: 0.5,
          payloadDigest: digest(`${tag}-exposure`),
          occurredAt: now,
          receivedAt: now,
          expiresAt: future,
        },
      })
      const evaluation = await db.recommendationShadowEvaluation.create({
        data: {
          id: `evaluation-${tag}`,
          manifestId,
          generatorVersion: "fixture",
          contextVersion: "fixture",
          eligibilityVersion: "fixture",
          samplingVersion: "fixture",
          retentionPolicyVersion: "fixture",
          windowStart: new Date(createdAt.getTime() - day),
          windowEnd: createdAt,
          requestedSampleSize: 1,
          createdAt,
          expiresAt: future,
        },
      })
      const protocol = await db.recommendationCompositionProtocol.create({
        data: {
          id: randomUUID(),
          shadowEvaluationId: evaluation.id,
          sourceManifestId: manifestId,
          generatorVersion: "fixture",
          challengerManifestId: manifestId,
          composerVersion: "fixture",
          protocolVersion: "fixture",
          config: {},
          configDigest: digest(`${tag}-protocol`),
          actorId: "owned-retirement-test",
          createdAt,
          expiresAt: future,
        },
      })
      const shadow = await db.recommendationShadowRun.create({
        data: {
          id: `shadow-${tag}`,
          evaluationId: evaluation.id,
          requestId: request.id,
          projectionProfileId: profile.id,
          privacyGeneration: 1,
          sampleOrdinal: 0,
          samplingDigest: digest(`${tag}-shadow`),
          contextProjectionVersion: "fixture",
          eligibilityVersion: "fixture",
          retentionPolicyVersion: "fixture",
          inputCapturedAt: createdAt,
          state: "PUBLISHED",
          claimedAt: now,
          expiresAt: future,
        },
      })
      await db.recommendationCompositionObservation.create({
        data: {
          runId: shadow.id,
          protocolId: protocol.id,
          inputDigest: digest(`${tag}-input`),
          outputDigest: digest(`${tag}-output`),
          metrics: {},
          createdAt: now,
          expiresAt: future,
        },
      })
      const generation =
        await db.recommendationProfileProjectionGeneration.create({
          data: {
            id: `generation-${tag}`,
            manifestId,
            scope: "DURABLE",
            profileId: profile.id,
            privacyGeneration: 1,
            generation: 1,
            state: "PUBLISHED",
            projectionVersion: "fixture",
            clusteringVersion: "fixture",
            eligibilityPolicyVersion: "fixture",
            outcomeClassifierVersion: "fixture",
            inputWindowStart: createdAt,
            inputWindowEnd: now,
            inputDigest: digest(`${tag}-generation`),
            retentionDays: 180,
            publishedAt: now,
            createdAt,
            expiresAt: future,
          },
        })
      await db.recommendationProfileProjectionPointer.create({
        data: {
          scopeDigest: digest(`${tag}-scope`),
          scope: "DURABLE",
          profileId: profile.id,
          privacyGeneration: 1,
          generationId: generation.id,
          pointerGeneration: 1,
        },
      })
      await db.recommendationProfileProjectionRun.create({
        data: {
          id: `projection-run-${tag}`,
          scope: "DURABLE",
          profileId: profile.id,
          privacyGeneration: 1,
          sessionDigest: digest(`${tag}-session`),
          state: "COMPLETED",
          projectionId: generation.id,
          completedAt: now,
          expiresAt: future,
        },
      })
      const vectorDigest = digest(`${tag}-vector`)
      const vector = `[1,${Array(1535).fill("0").join(",")}]`
      await db.$executeRaw`
        INSERT INTO recommendation_profile_vector_snapshot (digest, embedding, created_at)
        VALUES (${vectorDigest}, ${vector}::public.vector, ${createdAt})
      `
      await db.recommendationProfileInterest.create({
        data: {
          generationId: generation.id,
          kind: "DURABLE",
          interestOrdinal: 0,
          medoidMediaId: "fixture-target",
          medoidSourceDigest: digest(`${tag}-medoid`),
          vectorDigest,
          weight: 0.5,
          supportCount: 1,
          stability: 0.5,
          createdAt: now,
          expiresAt: future,
        },
      })
      await db.recommendationProfileProjectionContribution.create({
        data: {
          generationId: generation.id,
          kind: "EXPLICIT_PREFERENCE",
          sourceIdDigest: digest(`${tag}-contribution`),
          targetMediaId: "fixture-target",
          weight: 0.5,
          occurredAt: createdAt,
          createdAt: now,
          expiresAt: future,
        },
      })
      await db.recommendationPersonalizationDecision.create({
        data: {
          requestId: request.id,
          effectiveManifestId: manifestId,
          lane: "profile_challenger",
          projectionGenerationId: generation.id,
          projectionScope: "durable",
          projectionVersion: "fixture",
          projectionGenerationNumber: 1,
          interestCount: 1,
          expiresAt: future,
        },
      })
      const viewer = await new RecommendationViewerService(db).bootstrap({
        id: null,
        role: "CONSUMER_BEARER",
        fleet: true,
        rateLimitBucketKey: "owned-retirement-fixture",
      })
      const precomputedGeneration =
        await db.recommendationPrecomputedGeneration.create({
          data: {
            id: `precomputed-${tag}`,
            modelId: "fixture",
            promptVersion: "fixture",
            inputDigest: digest(`${tag}-precomputed-input`),
            sourceSetDigest: digest(`${tag}-precomputed-sources`),
            inputCutoff: now,
            expectedSourceCount: 0,
            status: "complete",
            completedAt: now,
          },
        })
      const precomputedExperiment =
        await db.recommendationPrecomputedExperiment.create({
          data: {
            id: `precomputed-experiment-${tag}`,
            generationId: precomputedGeneration.id,
            controlManifestId: "semantic-transcript-pgvector-v1",
            challengerManifestId: "precomputed-watch-preview-v1",
            controlManifestDigest: digest(`${tag}-control`),
            controlRoutingDigest: digest(`${tag}-routing`),
            sourceSetDigest: digest(`${tag}-precomputed-sources`),
            assignmentPolicyVersion: "fixture",
            eligibilityPolicyVersion: "fixture",
            deliveryPolicyVersion: "fixture",
            configurationDigest: digest(`${tag}-config2`),
            state: "private_test",
            startsAt: createdAt,
            endsAt: now,
            expiresAt: future,
          },
        })
      const visit = await db.recommendationPrecomputedVisit.create({
        data: {
          id: randomUUID(),
          experimentId: precomputedExperiment.id,
          sourceVideoId: "fixture-target",
          locale: "en",
          audioLanguageSlug: "english",
          eligibility: "eligible",
          qualification: "fixture_human",
          arm: "CONTROL",
          browserUnitDigest: digest(`${tag}-precomputed-browser`),
          expiresAt: future,
        },
      })
      const episode = await db.recommendationPlaybackEpisode.create({
        data: {
          id: `episode-${tag}`,
          mediaId: "fixture-target",
          discoverySource: "direct",
          sessionDigest: digest(`${tag}-episode`),
          state: "FINALIZED",
          nextFactSequence: 1,
          activeUntil: new Date(now.getTime() + day),
          hardUntil: new Date(now.getTime() + 2 * day),
          finalizedAt: now,
          claimedAt: now,
          createdAt,
          expiresAt: future,
        },
      })
      await db.recommendationViewingModeEvidence.create({
        data: {
          episodeId: episode.id,
          profileId: profile.id,
          privacyGeneration: 1,
          sessionDigest: episode.sessionDigest,
          mediaId: episode.mediaId,
          policyVersion: "fixture",
          factWatermark: 1,
          soundOffMilliseconds: 1000,
          soundOnMilliseconds: 1000,
          soundOffProgressSeconds: 1,
          soundOnProgressSeconds: 1,
          soundOffQualified: true,
          soundOnQualified: true,
          previewMilliseconds: 0,
          durationSeconds: 30,
          observedAt: now,
          expiresAt: future,
        },
      })
      await db.recommendationCowatchSuppression.create({
        data: { episodeId: episode.id, expiresAt: future },
      })
      const secondEpisode = await db.recommendationPlaybackEpisode.create({
        data: {
          id: `second-episode-${tag}`,
          mediaId: "fixture-second",
          discoverySource: "direct",
          sessionDigest: episode.sessionDigest,
          state: "FINALIZED",
          nextFactSequence: 1,
          activeUntil: new Date(now.getTime() + day),
          hardUntil: new Date(now.getTime() + 2 * day),
          finalizedAt: now,
          claimedAt: now,
          createdAt,
          expiresAt: future,
        },
      })
      async function outcomeFor(episodeId: string, suffix: string) {
        return db.recommendationOutcomeRevision.create({
          data: {
            id: `outcome-${suffix}-${tag}`,
            episodeId,
            classifierVersion: "active-watch-proxy-v1",
            factWatermark: 1,
            inputDigest: digest(`${tag}-outcome-${suffix}`),
            revision: 1,
            qualifiedView: true,
            viewQualityWeight: 1,
            viewQualityWeightReason: "active_fraction_of_duration",
            activePlaybackMilliseconds: 30_000,
            durationSeconds: 30,
            durationCohort: "short",
            activeCoverage: "complete",
            generation: 1,
            createdAt: now,
            expiresAt: future,
          },
        })
      }
      const sourceOutcome = await outcomeFor(episode.id, "source")
      const targetOutcome = await outcomeFor(secondEpisode.id, "target")
      const eligibility = await db.recommendationEligibilityDecision.create({
        data: {
          sourceType: "PLAYBACK_OUTCOME",
          sourceKey: `retirement-${tag}`,
          outcomeId: sourceOutcome.id,
          policyVersion: "fixture",
          revision: 1,
          actorClass: "HUMAN_SIGNED_IN",
          state: "ELIGIBLE",
          eligibleScopes: ["profile", "aggregate"],
          contributionWeight: 1,
          contributionOrdinal: 1,
          distinctSupport: 6,
          identityConcentration: 0.1,
          inputDigest: digest(`${tag}-eligibility`),
          expiresAt: future,
        },
      })
      const graphId = digest(`${tag}-graph`)
      await db.recommendationCowatchGeneration.create({
        data: {
          id: graphId,
          projectionVersion: "fixture",
          featureVersion: "fixture",
          sourceCount: 1,
          contributionCount: 1,
          edgeCount: 1,
          distinctViewerCount: 1,
          windowEnd: createdAt,
          terminalDecision: "published",
          decisionReason: "fixture",
          publishedAt: now,
          expiresAt: future,
        },
      })
      await db.recommendationCowatchEdge.create({
        data: {
          generationId: graphId,
          sourceMediaId: "fixture-source",
          targetMediaId: "fixture-target",
          sessionSupport: 1,
          distinctViewerSupport: 1,
          confidence: 0.5,
          popularityCorrectedLift: 0.5,
          recencyWeight: 0.5,
          qualityWeight: 0.5,
          effectiveWeight: 0.5,
          contamination: 0,
          eligible: true,
        },
      })
      await db.recommendationCowatchSourceContribution.create({
        data: {
          generationId: graphId,
          outcomeId: sourceOutcome.id,
          eligibilityDecisionId: eligibility.id,
          eligibilityRevision: 1,
          eligibilityPolicyVersion: "fixture",
          viewerProfileId: profile.id,
          viewerPrivacyGeneration: 1,
          mediaId: episode.mediaId,
          sessionDigest: episode.sessionDigest,
          viewerKeyDigest: digest(`${tag}-viewer-key`),
          qualityWeight: 1,
          occurredAt: now,
          expiresAt: future,
        },
      })
      await db.recommendationCowatchContribution.create({
        data: {
          generationId: graphId,
          sourceOutcomeId: sourceOutcome.id,
          targetOutcomeId: targetOutcome.id,
          viewerProfileId: profile.id,
          sourceMediaId: episode.mediaId,
          targetMediaId: secondEpisode.mediaId,
          sessionDigest: episode.sessionDigest,
          viewerKeyDigest: digest(`${tag}-viewer-key`),
          gapMs: 1000,
          qualityWeight: 1,
          recencyWeight: 1,
          effectiveWeight: 1,
          expiresAt: future,
        },
      })
      await db.recommendationCowatchTrialAuthority.create({
        data: {
          generationId: graphId,
          rawPopulationExpiresAt: future,
          bindingDigest: digest(`${tag}-authority`),
          binding: {},
          dependencyExpiresAt: future,
          trialValidUntil: new Date(now.getTime() + 10 * day),
          qualifiedAt: now,
        },
      })
      const grant = await db.recommendationCowatchRefreshGrant.create({
        data: {
          id: randomUUID(),
          anchorReleaseId: randomUUID(),
          anchorPointerGeneration: 1,
          influenceFloorGeneration: 0,
          manifestDigest: digest(`${tag}-grant-manifest`),
          configurationDigest: digest(`${tag}-grant-config`),
          policyVersion: "cowatch-refresh-seven-day-mature-v1",
          budget: {},
          approvedById: "owned-retirement-fixture",
          approvedAt: now,
          validUntil: new Date(now.getTime() + 29 * day),
        },
      })
      const windowStart = new Date(now.getTime() - 8 * day)
      const windowEnd = new Date(windowStart.getTime() + 7 * day)
      await db.recommendationCowatchRefreshAttempt.create({
        data: {
          id: randomUUID(),
          grantId: grant.id,
          expectedPointerGeneration: 1,
          windowStart,
          windowEnd,
          evaluationAsOf: new Date(windowEnd.getTime() + 7 * 60 * 60_000),
          startedAt: now,
          leaseUntil: future,
          status: "refused",
          completedAt: now,
          reason: "fixture",
        },
      })
      expect(
        await db.recommendationPersonalizationDecision.count({
          where: { projectionGenerationId: generation.id },
        }),
      ).toBe(1)

      let result = await run(20, 2)
      const committedBatches = [...result.batches]
      while (result.status === "batch_limit") {
        result = await run(20, 2)
        committedBatches.push(...result.batches)
      }
      expect(result.status).toBe("complete")
      for (const phase of RETIREMENT_PHASES.filter(
        (phase) => phase.kind === "delete",
      )) {
        expect(
          committedBatches.some(
            (batch) => batch.phase === phase.name && batch.deleted > 0,
          ),
          `${phase.table} direct-delete receipt`,
        ).toBe(true)
        const count = await client.query<{ n: number }>(
          `SELECT count(*)::integer AS n FROM ${phase.table}`,
        )
        expect(count.rows[0]?.n, phase.table).toBe(0)
      }
      for (const phase of RETIREMENT_PHASES.filter(
        (phase) => phase.kind === "detach",
      )) {
        expect(
          committedBatches.some(
            (batch) => batch.phase === phase.name && batch.updated > 0,
          ),
          `${phase.table} explicit-detach receipt`,
        ).toBe(true)
      }
      const durable = await db.recommendationBehavioralRetirementBatch.findMany(
        {
          where: { operationId },
        },
      )
      expect(durable).toHaveLength(committedBatches.length)
      expect(durable.reduce((sum, batch) => sum + batch.deletedCount, 0)).toBe(
        committedBatches.reduce((sum, batch) => sum + batch.deleted, 0),
      )
      const retainedAssignment =
        await db.recommendationExperimentAssignment.findUniqueOrThrow({
          where: { id: assignment.id },
        })
      expect(retainedAssignment).toMatchObject({
        profileId: null,
        privacyGeneration: null,
        unitKind: "ANONYMOUS_PROFILE",
        state: "FENCED",
      })
      expect(
        await db.recommendationShadowRun.findUniqueOrThrow({
          where: { id: shadow.id },
        }),
      ).toMatchObject({
        projectionProfileId: null,
        privacyGeneration: null,
      })
      expect(
        await db.recommendationCompositionObservation.count({
          where: { runId: shadow.id },
        }),
      ).toBe(1)
      expect(
        await db.recommendationPersonalizationDecision.findUniqueOrThrow({
          where: { requestId: request.id },
        }),
      ).toMatchObject({
        projectionGenerationId: null,
        lane: "profile_challenger",
        interestCount: 1,
      })
      expect(
        await db.recommendationRequest.count({ where: { id: request.id } }),
      ).toBe(1)
      expect(
        await db.recommendationExperimentExposure.count({
          where: { id: exposure.id },
        }),
      ).toBe(1)
      expect(await db.recommendationViewer.count()).toBe(1)
      expect(viewer.personalization).toBe(false)
      expect(
        await db.recommendationPrecomputedVisit.count({
          where: { id: visit.id },
        }),
      ).toBe(1)
      expect(
        await db.recommendationPlaybackEpisode.count({
          where: { id: episode.id },
        }),
      ).toBe(1)
      expect(
        await db.recommendationPlaybackEpisode.count({
          where: { id: secondEpisode.id },
        }),
      ).toBe(1)
      expect(
        await db.recommendationOutcomeRevision.count({
          where: { id: { in: [sourceOutcome.id, targetOutcome.id] } },
        }),
      ).toBe(2)
      expect(
        await db.recommendationEligibilityDecision.count({
          where: { id: eligibility.id },
        }),
      ).toBe(1)
      expect(
        await db.recommendationBehavioralRetirementBatch.count({
          where: { operationId },
        }),
      ).toBeGreaterThan(0)
      expect((await run()).status).toBe("complete")
    }, 120_000)

    it("does not report completion when the only remaining row is locked", async () => {
      const profile = await db.recommendationProfile.create({
        data: {
          tokenDigest: digest(randomUUID()),
          privacyGeneration: 1,
          choice: "DURABLE_ALLOWED",
          expiresAt: new Date(Date.now() + day),
        },
      })
      const blocker = await reconnect()
      try {
        await blocker.query("BEGIN")
        await blocker.query(
          "SELECT id FROM recommendation_profile WHERE id = $1 FOR UPDATE",
          [profile.id],
        )
        const result = await run()
        expect(result).toMatchObject({
          status: "locked_rows",
          nextPhase: "profile",
        })
        expect(
          await db.recommendationProfile.count({ where: { id: profile.id } }),
        ).toBe(1)
      } finally {
        await blocker.query("ROLLBACK")
        await blocker.end()
      }
      expect((await run()).status).toBe("complete")
    })

    it("keeps status withdrawal and completed erasure working with a linked decision", async () => {
      const fixture = await linkedProfileFixture(new Date(Date.now() + day))
      const service = new RecommendationProfileService({ prisma: db })
      const receipt = await service.status({
        caller: {
          id: "forge-web",
          role: "CONSUMER_BEARER",
          rateLimitBucketKey: "forge-web",
        },
        contractVersion: "recommendation-profile-v1",
        sessionDigest: fixture.sessionDigest,
        profileDigest: fixture.profileDigest,
      })
      expect(receipt.erasureState).toBe("pending")
      await expect(
        service.completeErasure({
          profileId: fixture.profile.id,
          privacyGeneration: 1,
        }),
      ).resolves.toBe(true)
      expect(
        await db.recommendationProfileProjectionGeneration.count({
          where: { id: fixture.generation.id },
        }),
      ).toBe(0)
      expect(
        await db.recommendationPersonalizationDecision.findUniqueOrThrow({
          where: { requestId: fixture.request.id },
        }),
      ).toMatchObject({ projectionGenerationId: null })
      expect(
        await db.recommendationProfile.findUniqueOrThrow({
          where: { id: fixture.profile.id },
        }),
      ).toMatchObject({ tokenDigest: null, erasureState: "COMPLETED" })
      await db.recommendationProfile.delete({
        where: { id: fixture.profile.id },
      })
    })

    it("keeps ordinary expiry working with an unexpired linked decision", async () => {
      const now = new Date()
      const fixture = await linkedProfileFixture(new Date(now.getTime() - day))
      const result = await purgeExpiredRecommendationRequests(
        db,
        now,
        100,
        "scheduled",
      )
      expect(result.status).toBe("succeeded")
      expect(
        await db.recommendationProfileProjectionGeneration.count({
          where: { id: fixture.generation.id },
        }),
      ).toBe(0)
      expect(
        await db.recommendationPersonalizationDecision.findUniqueOrThrow({
          where: { requestId: fixture.request.id },
        }),
      ).toMatchObject({ projectionGenerationId: null })
      expect(
        await db.recommendationProfile.findUniqueOrThrow({
          where: { id: fixture.profile.id },
        }),
      ).toMatchObject({ tokenDigest: null })
      await db.recommendationProfile.delete({
        where: { id: fixture.profile.id },
      })
    })

    it("reconciles a lost COMMIT acknowledgement through the batch receipt", async () => {
      const profile = await db.recommendationProfile.create({
        data: {
          tokenDigest: digest(randomUUID()),
          privacyGeneration: 1,
          choice: "DURABLE_ALLOWED",
          expiresAt: new Date(Date.now() + day),
        },
      })
      const query = client.query.bind(client)
      let intercepted = false
      let committedProfile = false
      vi.spyOn(client, "query").mockImplementation(
        async (...args: Parameters<Client["query"]>) => {
          if (
            typeof args[0] === "string" &&
            args[0].includes("DELETE FROM recommendation_profile target")
          )
            committedProfile = true
          const result = await query(...args)
          if (args[0] === "COMMIT" && committedProfile && !intercepted) {
            intercepted = true
            throw new Error("owned fixture: acknowledgement lost")
          }
          return result
        },
      )
      let caught: unknown
      try {
        await run()
      } catch (error) {
        caught = error
      }
      vi.restoreAllMocks()
      expect(caught).toBeInstanceOf(RetirementUncertainCommitError)
      expect((caught as RetirementUncertainCommitError).durableState).toBe(
        "committed",
      )
      expect(
        await db.recommendationProfile.count({ where: { id: profile.id } }),
      ).toBe(0)
      expect(
        await db.recommendationBehavioralRetirementBatch.count({
          where: { operationId },
        }),
      ).toBeGreaterThan(0)
    })

    it("reports a rolled-back batch failure without claiming an uncertain commit", async () => {
      const profile = await db.recommendationProfile.create({
        data: {
          tokenDigest: digest(randomUUID()),
          privacyGeneration: 1,
          choice: "DURABLE_ALLOWED",
          expiresAt: new Date(Date.now() + day),
        },
      })
      const query = client.query.bind(client)
      vi.spyOn(client, "query").mockImplementation(
        async (...args: Parameters<Client["query"]>) => {
          if (
            typeof args[0] === "string" &&
            args[0].includes("DELETE FROM recommendation_profile target")
          )
            throw new Error("owned fixture: mutation failed before commit")
          return query(...args)
        },
      )
      await expect(run()).rejects.toBeInstanceOf(RetirementBatchFailureError)
      vi.restoreAllMocks()
      expect(
        await db.recommendationProfile.count({ where: { id: profile.id } }),
      ).toBe(1)
    })

    it("stops before implicit decision unlink when a reference appears after detachment", async () => {
      const fixture = await linkedProfileFixture(new Date(Date.now() + day))
      const query = client.query.bind(client)
      let injected = false
      const secondRequestId = `late-reference-${randomUUID()}`
      vi.spyOn(client, "query").mockImplementation(
        async (...args: Parameters<Client["query"]>) => {
          if (
            !injected &&
            typeof args[0] === "string" &&
            args[0].includes(
              "SELECT id AS id FROM recommendation_profile_projection_generation ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED",
            )
          ) {
            injected = true
            const now = new Date()
            await db.recommendationRequest.create({
              data: {
                id: secondRequestId,
                contractVersion: "semantic-recommendation-v1",
                surfaceVersion: "watch-below-player-v1",
                manifestId: fixture.manifestId,
                strategyVersion: fixture.manifestId,
                classifierVersion: "fixture",
                sessionDigest: digest(secondRequestId),
                locale: "en",
                seedMediaId: "fixture",
                expectedItemCount: 0,
                state: "ISSUED",
                result: "EMPTY",
                deliveryJti: randomUUID(),
                signingKid: "fixture",
                issuedAt: now,
                createdAt: now,
                expiresAt: new Date(now.getTime() + 20 * day),
              },
            })
            await db.recommendationPersonalizationDecision.create({
              data: {
                requestId: secondRequestId,
                effectiveManifestId: fixture.manifestId,
                lane: "profile_challenger",
                projectionGenerationId: fixture.generation.id,
                projectionScope: "durable",
                projectionVersion: "fixture",
                projectionGenerationNumber: 1,
                interestCount: 1,
                expiresAt: new Date(now.getTime() + 20 * day),
              },
            })
          }
          return query(...args)
        },
      )
      let result
      try {
        result = await run()
        while (result.status === "batch_limit") result = await run()
      } finally {
        vi.restoreAllMocks()
      }
      expect(injected).toBe(true)
      expect(result.status).toBe("blocked_references")
      expect(result.nextPhase).toBe("profile_generation")
      expect(
        await db.recommendationProfileProjectionGeneration.count({
          where: { id: fixture.generation.id },
        }),
      ).toBe(1)
      expect(
        await db.recommendationPersonalizationDecision.findUniqueOrThrow({
          where: { requestId: secondRequestId },
        }),
      ).toMatchObject({ projectionGenerationId: fixture.generation.id })
    })

    it("skips a parent held by a concurrent child FK insert without implicit unlink", async () => {
      const fixture = await linkedProfileFixture(new Date(Date.now() + day))
      const now = new Date()
      const secondRequestId = `concurrent-reference-${randomUUID()}`
      await db.recommendationRequest.create({
        data: {
          id: secondRequestId,
          contractVersion: "semantic-recommendation-v1",
          surfaceVersion: "watch-below-player-v1",
          manifestId: fixture.manifestId,
          strategyVersion: fixture.manifestId,
          classifierVersion: "fixture",
          sessionDigest: digest(secondRequestId),
          locale: "en",
          seedMediaId: "fixture",
          expectedItemCount: 0,
          state: "ISSUED",
          result: "EMPTY",
          deliveryJti: randomUUID(),
          signingKid: "fixture",
          issuedAt: now,
          createdAt: now,
          expiresAt: new Date(now.getTime() + 20 * day),
        },
      })
      const blocker = await reconnect()
      try {
        await blocker.query("BEGIN")
        await blocker.query(
          `INSERT INTO recommendation_personalization_decision
            (request_id, effective_manifest_id, lane, projection_generation_id,
             projection_scope, projection_version, projection_generation_number,
             interest_count, expires_at)
           VALUES ($1, $2, 'profile_challenger', $3,
             'durable', 'fixture', 1, 1, $4)`,
          [
            secondRequestId,
            fixture.manifestId,
            fixture.generation.id,
            new Date(now.getTime() + 20 * day),
          ],
        )
        let result = await run()
        while (result.status === "batch_limit") result = await run()
        expect(result.status).toBe("locked_rows")
        expect(result.nextPhase).toBe("profile_generation")
        expect(
          await db.recommendationProfileProjectionGeneration.count({
            where: { id: fixture.generation.id },
          }),
        ).toBe(1)
        await blocker.query("COMMIT")
        expect(
          await db.recommendationPersonalizationDecision.findUniqueOrThrow({
            where: { requestId: secondRequestId },
          }),
        ).toMatchObject({ projectionGenerationId: fixture.generation.id })
      } finally {
        await blocker.query("ROLLBACK").catch(() => undefined)
        await blocker.end()
      }
    })
  },
)
