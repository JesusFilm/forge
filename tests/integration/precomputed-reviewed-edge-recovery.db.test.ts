import { createHash, randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../apps/admin/src/config/env"
import { currentAdminMigrationSql } from "../../apps/admin/src/services/recommendations/current-schema.test-fixture"
import { submitDurablePrecomputedRecommendation } from "../../apps/admin/src/services/recommendations/precomputed/durable-build"
import { loadQualifiedManualEdgeRecovery } from "../../apps/admin/src/services/recommendations/precomputed/edge-ledger"
import { REVIEWED_EDGE_RECOVERIES } from "../../apps/admin/src/services/recommendations/precomputed/reviewed-edge-recoveries"
import fixture from "./fixtures/precomputed-reviewed-recovery.json"

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")
const generationId = fixture.generation.id
const generationInputDigest = fixture.generation.inputDigest
const accountRef = "native-reviewed-operator"
const scopes = REVIEWED_EDGE_RECOVERIES.filter((scope) =>
  fixture.calls.some((call) => call.callId === scope.callId),
)
const oldDate = new Date("2026-10-01T00:00:00Z")

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "reviewed multi-call recovery on native PostgreSQL",
  () => {
    let prisma: PrismaClient
    let admin: Client
    const schema = `reviewed_recovery_${Date.now()}`
    const submit = (input: unknown) =>
      submitDurablePrecomputedRecommendation(
        prisma,
        input,
        "Bearer preview-test-key",
      )
    const whereCall = (callId: string) => ({
      generationId_callId: { generationId, callId },
    })
    const base = (attemptId: string) => ({
      generationId,
      generationInputDigest,
      attemptId,
    })
    async function attempt(attemptId: string, closed = false) {
      await prisma.recommendationPrecomputedExecutionAttempt.create({
        data: {
          generationId,
          attemptId,
          invocation: "resume",
          accountRef,
          backend: "codex_chatgpt_subscription",
          billingBasis: "included_subscription",
          authMethod: "chatgpt",
          modelId: "gpt-6-astra",
          identityObservedAt: new Date(),
          allowanceObservedAt: new Date(),
          weeklyRemainingPercent: 50,
          fiveHourKind: "limited",
          fiveHourRemainingPercent: 50,
          startedAt: oldDate,
          endedAt: closed ? oldDate : null,
          endReason: closed ? "paused" : null,
        },
      })
    }
    async function video(videoId: string, cacheKey?: string) {
      await prisma.video.upsert({
        where: { id: videoId },
        update: {},
        create: {
          id: videoId,
          coreId: digest(videoId),
          slug: videoId,
          createdAt: oldDate,
          updatedAt: oldDate,
          locales: {
            create: {
              locale: "en",
              title: videoId,
              status: "PUBLISHED",
              createdAt: oldDate,
              updatedAt: oldDate,
            },
          },
        },
      })
      await prisma.recommendationPrecomputedBuildSource.upsert({
        where: {
          generationId_sourceVideoId: { generationId, sourceVideoId: videoId },
        },
        update: {},
        create: { generationId, sourceVideoId: videoId },
      })
      if (cacheKey)
        await prisma.recommendationPrecomputedContentProfile.upsert({
          where: { generationId_cacheKey: { generationId, cacheKey } },
          update: {},
          create: {
            generationId,
            cacheKey,
            videoId,
            modelId: "gpt-6-astra",
            backend: "codex_chatgpt_subscription",
            promptVersion: "native-fixture",
            schemaVersion: "native-fixture",
            metadataDigest: digest([videoId, "metadata"]),
            chunkDigest: digest([]),
            selectedTranscriptCount: 0,
            selectedChunkCount: 0,
            sourceTextBytes: 0,
            partDigests: [],
            coverageDigest: digest([videoId, "coverage"]),
            kind: "metadata_only",
            state: "ready",
            terminalAt: oldDate,
          },
        })
    }
    beforeAll(async () => {
      admin = new Client({ connectionString: env.DATABASE_URL })
      await admin.connect()
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`SET search_path TO "${schema}", public`)
      for (const sql of currentAdminMigrationSql) await admin.query(sql)
      const url = new URL(env.DATABASE_URL)
      url.searchParams.set("schema", schema)
      prisma = new PrismaClient({
        datasources: { db: { url: url.toString() } },
      })
      await prisma.recommendationPrecomputedGeneration.create({
        data: {
          ...fixture.generation,
          inputCutoff: new Date(`${fixture.generation.inputCutoff}Z`),
          modelId: "gpt-6-astra",
          promptVersion: "native-fixture",
          protocolVersion: 4,
          executionBackend: "codex_chatgpt_subscription",
          inputMode: "historical_analytics",
          inputSnapshotMode: "observed_fenced",
          manifestCommittedAt: oldDate,
          capacityPreflight: {
            status: "passed",
            measuredAt: new Date().toISOString(),
            projectedBytes: 1_000_000_000,
          },
        },
      })
      await prisma.recommendationPrecomputedBuildBudget.create({
        data: { generationId },
      })
      const imported = fixture.import
      await prisma.recommendationPrecomputedGaCaptureImport.create({
        data: {
          destinationGenerationId: generationId,
          destinationIdentity: imported.destination_identity,
          preparedDigest: imported.prepared_digest,
          originGenerationId: imported.origin_generation_id,
          originIdentity: imported.origin_identity,
          originProofDigest: imported.origin_proof_digest,
          artifactSha256: imported.artifact_sha256,
          artifactBytes: imported.artifact_bytes,
          storageKey: imported.storage_key,
          copyRequestDigest: digest("native-copy"),
          copyAttemptId: randomUUID(),
          state: "bound",
          stagingDeadlineAt: new Date(),
          confirmedAt: new Date(),
          boundAt: new Date(),
        },
      })
      for (const scope of scopes) {
        await attempt(scope.attemptId, true)
        const callData = {
          generationId,
          attemptId: scope.attemptId,
          modelId: "gpt-6-astra",
          backend: "codex_chatgpt_subscription",
          promptVersion: "native-fixture",
          schemaVersion: "native-fixture",
          inputDigest: scope.inputDigest,
          membershipDigest: scope.membershipDigest,
          selectedCorpusDigest: scope.selectedCorpusDigest!,
          candidatePoolDigest: scope.candidatePoolDigest,
          captureRefDigest: scope.captureRefDigest,
          spanOfferDigest: scope.spanOfferDigest!,
          spanOffers: fixture.calls.find(
            (call) => call.callId === scope.callId,
          )!.spanOffers,
          requestDigest: scope.requestDigest!,
          startedAt: oldDate,
          status: "pending",
        }
        await prisma.recommendationPrecomputedEdgeBatchCall.create({
          data: { ...callData, callId: scope.callId },
        })
        for (const member of fixture.members.filter(
          (member) => member.callId === scope.callId,
        )) {
          await video(member.sourceVideoId, member.sourceProfileKey)
          for (const target of member.candidates)
            await video(target.targetVideoId, target.targetProfileKey)
          await prisma.recommendationPrecomputedBuildSource.update({
            where: {
              generationId_sourceVideoId: {
                generationId,
                sourceVideoId: member.sourceVideoId,
              },
            },
            data: {
              state: "claimed",
              leaseToken: randomUUID(),
              leaseExpiresAt: oldDate,
              checkpointRevision: member.checkpointRevision,
              edgeSourceCandidateCount: member.sourceCandidateCount,
              edgeSourceCandidateDigest: member.sourceCandidateDigest,
              edgeSourceProfileKey: member.sourceProfileKey,
              edgeCandidatePoolDigest: scope.candidatePoolDigest,
              edgeHistoricalRefDigest: member.historicalRefDigest,
              historicalProvenance: { fixture: true },
            },
          })
          await prisma.recommendationPrecomputedEdgeBatchMember.create({
            data: {
              ...member,
              generationId,
              leaseToken: randomUUID(),
              applicationState: "pending",
            },
          })
          // Synthetic prior pages establish contiguous coverage; the interrupted
          // page and all reviewed seals above are copied from the sealed incident.
          const firstRank = member.candidates[0]!.poolRank
          for (let pageIndex = 0; pageIndex < member.pageIndex; pageIndex++) {
            const begin = Math.floor((firstRank * pageIndex) / member.pageIndex)
            const end = Math.floor(
              (firstRank * (pageIndex + 1)) / member.pageIndex,
            )
            const candidates = []
            for (let poolRank = begin; poolRank < end; poolRank++) {
              const targetVideoId = `prior-${member.sourceVideoId}-${poolRank}`
              await video(targetVideoId)
              candidates.push({
                targetVideoId,
                targetProfileKey: digest(targetVideoId),
                poolRank,
              })
            }
            const callId = randomUUID()
            await prisma.recommendationPrecomputedEdgeBatchCall.create({
              data: {
                ...callData,
                callId,
                status: "succeeded",
                inputTokens: 10,
                outputTokens: 0,
                outputDigest: digest([]),
                receiptDigest: digest(callId),
                finishedAt: oldDate,
              },
            })
            await prisma.recommendationPrecomputedEdgeBatchMember.create({
              data: {
                ...member,
                generationId,
                callId,
                leaseToken: randomUUID(),
                pageIndex,
                candidates,
                candidatePageDigest: digest([
                  member.sourceVideoId,
                  pageIndex,
                  candidates.map((c) => [
                    c.poolRank,
                    c.targetVideoId,
                    c.targetProfileKey,
                  ]),
                ]),
                applicationState: "applied_empty",
                appliedRevision: pageIndex + 2,
                resultChoiceCount: 0,
              },
            })
          }
        }
      }
    }, 120_000)
    afterAll(async () => {
      await prisma?.$disconnect()
      if (admin) {
        await admin.query("ROLLBACK").catch(() => undefined)
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
    })

    it("recovers two reviewed calls serially through the native API, preserving unknown usage", async () => {
      let qualified = 0
      let previousReplacement: string | undefined
      for (const scope of scopes) {
        const attemptId = randomUUID()
        await attempt(attemptId)
        const replacementCallId = randomUUID()
        const acknowledgement = {
          action: "edge_manual_recovery_ack",
          ...base(attemptId),
          originalCallId: scope.callId,
          replacementCallId,
          operatorAccountRef: accountRef,
          oldProcessExitedAttested: true,
        }
        await expect(
          submit({ ...acknowledgement, originalCallId: randomUUID() }),
        ).rejects.toThrow("scope differs")
        if (previousReplacement)
          await expect(
            submit({
              ...acknowledgement,
              replacementCallId: previousReplacement,
            }),
          ).rejects.toThrow("already used")
        await prisma.recommendationPrecomputedEdgeBatchCall.update({
          where: whereCall(scope.callId),
          data: { requestDigest: digest("tampered") },
        })
        await expect(submit(acknowledgement)).rejects.toThrow(
          "reservation differs",
        )
        await prisma.recommendationPrecomputedEdgeBatchCall.update({
          where: whereCall(scope.callId),
          data: { requestDigest: scope.requestDigest },
        })
        await expect(
          prisma.recommendationPrecomputedExecutionAttempt.update({
            where: {
              generationId_attemptId: {
                generationId,
                attemptId: scope.attemptId,
              },
            },
            data: { endedAt: null, endReason: null },
          }),
        ).rejects.toThrow("Unique constraint")
        const sourceWhere = {
          generationId_sourceVideoId: {
            generationId,
            sourceVideoId: scope.members[0]!.sourceVideoId,
          },
        }
        await prisma.recommendationPrecomputedBuildSource.update({
          where: sourceWhere,
          data: { leaseExpiresAt: new Date(Date.now() + 60_000) },
        })
        await expect(submit(acknowledgement)).rejects.toThrow("no live leases")
        await prisma.recommendationPrecomputedBuildSource.update({
          where: sourceWhere,
          data: { leaseExpiresAt: oldDate },
        })
        expect(await submit(acknowledgement)).toMatchObject({
          state: "acknowledged_unknown",
        })
        expect(await submit(acknowledgement)).toMatchObject({ replay: true })
        const next = scopes.find(
          (other) => other.callId !== scope.callId && !previousReplacement,
        )
        if (next)
          await expect(
            submit({
              ...acknowledgement,
              originalCallId: next.callId,
              replacementCallId: randomUUID(),
            }),
          ).rejects.toThrow("has not safely applied")
        await expect(
          prisma.recommendationPrecomputedEdgeBatchCall.update({
            where: whereCall(scope.callId),
            data: { inputTokens: 1 },
          }),
        ).rejects.toThrow("immutable")
        await expect(
          prisma.recommendationPrecomputedEdgeBatchMember.updateMany({
            where: { generationId, callId: scope.callId },
            data: { applicationState: "pending" },
          }),
        ).rejects.toThrow("immutable")
        const members = []
        for (const frozen of fixture.members.filter(
          (member) => member.callId === scope.callId,
        )) {
          const claimed = await submit({
            action: "claim",
            ...base(attemptId),
            sourceVideoId: frozen.sourceVideoId,
            claimId: randomUUID(),
          })
          members.push({
            sourceVideoId: frozen.sourceVideoId,
            leaseToken: claimed.leaseToken,
            checkpointRevision: claimed.checkpointRevision,
            pageIndex: frozen.pageIndex,
            sourceProfileKey: frozen.sourceProfileKey,
            candidates: frozen.candidates.map((c) => ({
              targetVideoId: c.targetVideoId,
              targetProfileKey: c.targetProfileKey,
              poolRank: c.poolRank,
            })),
            candidatePageDigest: frozen.candidatePageDigest,
            sourceCandidateCount: frozen.sourceCandidateCount,
            sourceCandidateDigest: frozen.sourceCandidateDigest,
            historicalRefDigest: frozen.historicalRefDigest,
          })
        }
        const start = {
          action: "edge_batch_start",
          ...base(attemptId),
          callId: replacementCallId,
          modelId: "gpt-6-astra",
          backend: "codex_chatgpt_subscription",
          promptVersion: "native-fixture",
          schemaVersion: "native-fixture",
          inputDigest: digest([replacementCallId, "input"]),
          membershipDigest: digest(
            members.map(({ leaseToken: _leaseToken, ...identity }) => identity),
          ),
          selectedCorpusDigest: scope.selectedCorpusDigest,
          candidatePoolDigest: scope.candidatePoolDigest,
          captureRefDigest: scope.captureRefDigest,
          spanOfferDigest: digest([]),
          spanOffers: [],
          startedAt: new Date().toISOString(),
          members,
        }
        await expect(
          submit({
            ...start,
            members: members.map((m) => ({ ...m, pageIndex: m.pageIndex + 1 })),
          }),
        ).rejects.toThrow("differs")
        expect(await submit(start)).toMatchObject({ state: "pending" })
        const results = members.map((m) => ({
          sourceVideoId: m.sourceVideoId,
          choices: [],
        }))
        expect(
          await submit({
            action: "edge_batch_finish",
            ...base(attemptId),
            callId: replacementCallId,
            inputDigest: start.inputDigest,
            membershipDigest: start.membershipDigest,
            spanOfferDigest: start.spanOfferDigest,
            status: "succeeded",
            outputDigest: digest(results),
            results,
            usage: { inputTokens: 100, outputTokens: 5 },
            finishedAt: new Date().toISOString(),
          }),
        ).toMatchObject({ state: "succeeded", receiptStored: true })
        expect(
          await loadQualifiedManualEdgeRecovery(prisma, generationId),
        ).toMatchObject({ qualifiedAcknowledgedUnknownCount: qualified })
        await submit({
          action: "attempt_close",
          ...base(attemptId),
          reason: "paused",
        })
        qualified++
        expect(
          await loadQualifiedManualEdgeRecovery(prisma, generationId),
        ).toMatchObject({ qualifiedAcknowledgedUnknownCount: qualified })
        expect(
          await prisma.recommendationPrecomputedEdgeBatchCall.findUniqueOrThrow(
            { where: whereCall(scope.callId) },
          ),
        ).toMatchObject({
          status: "pending",
          inputTokens: null,
          outputTokens: null,
          outputDigest: null,
          receiptDigest: null,
          finishedAt: null,
          recoveryReplacementCallId: replacementCallId,
        })
        expect(
          await prisma.recommendationPrecomputedBuildSource.count({
            where: {
              generationId,
              state: "claimed",
              leaseExpiresAt: { gt: new Date() },
            },
          }),
        ).toBe(0)
        previousReplacement = replacementCallId
      }
      expect(qualified).toBe(2)
    }, 60_000)
  },
)
