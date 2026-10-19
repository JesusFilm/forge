import { createHash, randomUUID } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import {
  planContentProfile,
  type ContentProfilePlan,
} from "../../apps/mastra/src/services/precomputed-recommendations/content-profile-plan"
import {
  readPrecomputedCatalog,
  assertPrecomputedProfileVersion,
} from "../../apps/admin/src/services/recommendations/precomputed/catalog"
import { createCodexSubscriptionAstraModel } from "../../apps/mastra/src/services/precomputed-recommendations/codex-subscription-astra"
import { createEdgeBatchPersistence } from "../../apps/mastra/src/services/precomputed-recommendations/edge-batch-client"
import {
  auditedNoDispatchIsSafe,
  finalizeEdgeSource,
} from "../../apps/mastra/src/services/precomputed-recommendations/edge-batch-executor"
import { loadLiveEvidence } from "../../apps/admin/src/services/recommendations/precomputed/live-evidence"
import { loadPrecomputedPublicReadiness } from "../../apps/admin/src/services/recommendations/precomputed/public-readiness"
import { env } from "../../apps/admin/src/config/env"
import { currentAdminMigrationSql } from "../../apps/admin/src/services/recommendations/current-schema.test-fixture"
import {
  submitDurablePrecomputedRecommendation,
  loadDurablePrecomputedBuildReport,
} from "../../apps/admin/src/services/recommendations/precomputed/durable-build"
import { purgeExpiredPrecomputedGenerations } from "../../apps/admin/src/services/recommendations/precomputed/generation-retention"
import { loadPrecomputedStorageCapacityReport } from "../../apps/admin/src/services/recommendations/precomputed/storage-capacity"
import { loadQualifiedManualEdgeRecovery } from "../../apps/admin/src/services/recommendations/precomputed/edge-ledger"

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "shared edge ledger on native PostgreSQL",
  () => {
    let prisma: PrismaClient
    let reservationQueries: string[] | null = null
    let admin: Client
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const schema = `edge_ledger_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const sourceVideoId = `edge-source-${suffix}`
    const targetVideoId = `edge-target-${suffix}`
    const spanTargetVideoId = `edge-span-target-${suffix}`
    const thirdVideoId = `edge-third-${suffix}`
    const generationInputDigest = "a".repeat(64)
    const submit = (input: unknown) =>
      submitDurablePrecomputedRecommendation(
        prisma,
        input,
        "Bearer preview-test-key",
      )
    async function build(
      name: string,
      sourceIds = [sourceVideoId, targetVideoId],
      identity?: {
        generationId: string
        attemptId: string
        generationInputDigest: string
      },
    ) {
      const generationId = identity?.generationId ?? `${name}-${suffix}`
      const attemptId = identity?.attemptId ?? randomUUID()
      const inputDigest =
        identity?.generationInputDigest ?? generationInputDigest
      const base = {
        generationId,
        generationInputDigest: inputDigest,
        attemptId,
      }
      await submit({
        action: "start",
        generationId,
        protocolVersion: 4,
        modelId: "gpt-6-astra",
        promptVersion: "build-v4",
        inputDigest,
        sourceSetDigest: digest([...sourceIds].sort()),
        inputCutoff: new Date(Date.now() + 60_000).toISOString(),
        expectedSourceCount: sourceIds.length,
        inputMode: "content_only",
        executionAttempt: {
          attemptId,
          invocation: "start",
          accountRef: "edge-account-123",
          backend: "codex_chatgpt_subscription",
          billingBasis: "included_subscription",
          authMethod: "chatgpt",
          modelId: "gpt-6-astra",
          identityObservedAt: new Date().toISOString(),
          allowanceObservedAt: new Date().toISOString(),
          weeklyRemainingPercent: 50,
          fiveHour: { kind: "limited", remainingPercent: 50 },
        },
      })
      await submit({
        action: "manifest",
        ...base,
        sourceVideoIds: [...sourceIds].sort(),
      })
      const probe = await submit({ action: "capacity_probe", ...base })
      await submit({
        action: "capacity",
        ...base,
        measurement: {
          measuredAt: new Date().toISOString(),
          clusterSystemId: probe.clusterSystemId,
          observedDbBytes: probe.observedDbBytes,
          availableBytes: 20_000_000_000,
          reserveBytes: 5_000_000_000,
          projectedBytes: identity ? 20_000_000 : 1_000_000,
          sampleSourceCount: sourceIds.length,
          sampleBytes: 100_000,
          source: "operator_verified_pgdata_df",
        },
      })
      return base
    }
    async function readyMetadataProfile(
      base: {
        generationId: string
        generationInputDigest: string
        attemptId: string
      },
      videoId: string,
      plan?: ContentProfilePlan,
    ) {
      const metadataDigest =
        plan?.metadataDigest ?? digest(["metadata", videoId])
      const chunkDigest =
        plan?.chunkDigest ?? digest(["chunks", "metadata_only"])
      const promptVersion = plan ? "complete-profile-v6" : "complete-profile-v1"
      const schemaVersion = "profile-schema-v1"
      const cacheKey = digest({
        revision: "complete-selected-profile-plan-v1",
        videoId,
        metadataDigest,
        chunkDigest,
        modelId: "gpt-6-astra",
        backend: "codex_chatgpt_subscription",
        promptVersion,
        schemaVersion,
        partDigests: [],
      })
      await submit({
        action: "profile_register",
        ...base,
        cacheKey,
        videoId,
        modelId: "gpt-6-astra",
        backend: "codex_chatgpt_subscription",
        promptVersion,
        schemaVersion,
        metadataDigest,
        chunkDigest,
        selectedTranscriptCount: 0,
        selectedChunkCount: 0,
        sourceTextBytes: 0,
        partDigests: [],
        coverageDigest: digest([cacheKey, "coverage"]),
        kind: "metadata_only",
      })
      return cacheKey
    }
    async function claim(
      base: {
        generationId: string
        generationInputDigest: string
        attemptId: string
      },
      videoId: string,
    ) {
      return (await submit({
        action: "claim",
        ...base,
        sourceVideoId: videoId,
        claimId: randomUUID(),
      })) as { leaseToken: string; checkpointRevision: number }
    }
    async function reserveOne(name: string, reserve = true) {
      const base = await build(name)
      const sourceKey = await readyMetadataProfile(base, sourceVideoId)
      const targetKey = await readyMetadataProfile(base, targetVideoId)
      const sourceClaim = await claim(base, sourceVideoId)
      const member = {
        sourceVideoId,
        leaseToken: sourceClaim.leaseToken,
        checkpointRevision: sourceClaim.checkpointRevision,
        pageIndex: 0,
        sourceProfileKey: sourceKey,
        candidates: [
          { targetVideoId, targetProfileKey: targetKey, poolRank: 0 },
        ],
        candidatePageDigest: digest([
          sourceVideoId,
          0,
          [[0, targetVideoId, targetKey]],
        ]),
        sourceCandidateCount: 1,
        sourceCandidateDigest: digest([targetVideoId]),
        historicalRefDigest: digest(["none", sourceVideoId]),
      }
      const { leaseToken: _leaseToken, ...memberIdentity } = member
      void _leaseToken
      const start = {
        action: "edge_batch_start",
        ...base,
        callId: randomUUID(),
        modelId: "gpt-6-astra",
        backend: "codex_chatgpt_subscription",
        promptVersion: "edge-v1",
        schemaVersion: "edge-schema-v1",
        inputDigest: digest([name, "transient-input"]),
        membershipDigest: digest([memberIdentity]),
        selectedCorpusDigest: digest("selected-corpus"),
        candidatePoolDigest: digest("candidate-pool"),
        captureRefDigest: null,
        spanOfferDigest: digest([]),
        startedAt: new Date().toISOString(),
        members: [member],
        spanOffers: [],
      }
      if (reserve) await submit(start)
      return { base, sourceKey, targetKey, sourceClaim, start }
    }
    async function readyTranscriptProfile(
      base: {
        generationId: string
        generationInputDigest: string
        attemptId: string
      },
      videoId: string,
      chunkId: string,
      transcriptId: string,
      text: string,
      excerpt: string,
      plan?: ContentProfilePlan,
    ) {
      const metadataDigest =
        plan?.metadataDigest ?? digest(["metadata", videoId])
      const chunkDigest =
        plan?.chunkDigest ?? digest(["selected-chunk", chunkId, text])
      const partDigests = [digest(["part", chunkId])]
      const promptVersion = plan ? "complete-profile-v6" : "complete-profile-v1"
      const schemaVersion = "profile-schema-v1"
      const cacheKey = digest({
        revision: "complete-selected-profile-plan-v1",
        videoId,
        metadataDigest,
        chunkDigest,
        modelId: "gpt-6-astra",
        backend: "codex_chatgpt_subscription",
        promptVersion,
        schemaVersion,
        partDigests,
      })
      const coverageDigest = digest([cacheKey, "coverage"])
      await submit({
        action: "profile_register",
        ...base,
        cacheKey,
        videoId,
        modelId: "gpt-6-astra",
        backend: "codex_chatgpt_subscription",
        promptVersion,
        schemaVersion,
        metadataDigest,
        chunkDigest,
        selectedTranscriptCount: 1,
        selectedChunkCount: 1,
        sourceTextBytes: Buffer.byteLength(text),
        partDigests,
        coverageDigest,
        kind: "transcript",
      })
      const callId = randomUUID()
      const stagePromptVersion = `${promptVersion}:map`
      const binding = {
        ...base,
        callId,
        cacheKey,
        nodeKey: digest([cacheKey, "map", 0, stagePromptVersion]),
        stage: "map",
        stagePromptVersion,
        inputDigest: digest(["map-input", chunkId]),
        partIndex: 0,
      }
      await submit({
        action: "profile_call_start",
        ...binding,
        startedAt: new Date().toISOString(),
      })
      const startChar = text.indexOf(excerpt)
      const textSha256 = createHash("sha256")
        .update(excerpt, "utf8")
        .digest("hex")
      const node = {
        profile: {
          version: "complete_profile_v1",
          summaryEnglish: "A story about people finding hope together.",
          themes: ["hope"],
          people: [],
          places: [],
          citations: [],
          anchors: [
            {
              videoId,
              chunkId,
              transcriptId,
              language: "es",
              chunkIndex: 0,
              startChar,
              endChar: startChar + excerpt.length,
              textSha256,
              claimEnglish: "This passage presents a shared story of hope.",
            },
          ],
        },
        coveredPartStart: 0,
        coveredPartEnd: 1,
        childNodeDigests: [],
      }
      await submit({
        action: "profile_call_finish",
        ...binding,
        status: "succeeded",
        outputDigest: digest(node),
        node,
        usage: { inputTokens: 29, outputTokens: 5 },
        finishedAt: new Date().toISOString(),
      })
      await submit({
        action: "profile_finalize",
        ...base,
        cacheKey,
        finalCallId: callId,
        coverageDigest,
        expectedNodeDigests: [digest(node)],
      })
      return { cacheKey, startChar, textSha256 }
    }
    beforeAll(async () => {
      admin = new Client({ connectionString: env.DATABASE_URL })
      await admin.connect()
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`SET search_path TO "${schema}", public`)
      for (const migration of currentAdminMigrationSql)
        await admin.query(migration)
      const url = new URL(env.DATABASE_URL)
      url.searchParams.set("schema", schema)
      const queryClient = new PrismaClient({
        datasources: { db: { url: url.toString() } },
        log: [{ emit: "event", level: "query" }],
      })
      queryClient.$on("query", (event) => {
        reservationQueries?.push(event.query)
      })
      prisma = queryClient
      for (const [id, title] of [
        [sourceVideoId, "Source story"],
        [targetVideoId, "Another story"],
        [spanTargetVideoId, "Spanish transcript story"],
        [thirdVideoId, "Third story"],
      ]) {
        await prisma.video.create({
          data: { id, coreId: `core-${id}`, slug: id },
        })
        await prisma.videoLocale.create({
          data: { videoId: id, locale: "en", title, status: "PUBLISHED" },
        })
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
    it("reports an untouched v4 source without inventing edge calls", async () => {
      const base = await build("edge-empty-status")
      expect(
        await submit({
          action: "edge_batch_status",
          generationId: base.generationId,
          generationInputDigest,
          sourceVideoId,
        }),
      ).toMatchObject({
        generationId: base.generationId,
        sourceVideoId,
        sourceCandidateCount: null,
        sourceCandidateDigest: null,
        calls: [],
      })
    })
    it("retains concurrent reservations and receipts for independent sources in one attempt", async () => {
      const sourceIds = [sourceVideoId, targetVideoId]
      const base = await build("concurrent-sources", [
        ...sourceIds,
        thirdVideoId,
      ])
      const targetKey = await readyMetadataProfile(base, thirdVideoId)
      const starts = await Promise.all(
        sourceIds.map(async (id) => {
          const sourceKey = await readyMetadataProfile(base, id)
          const claimed = await claim(base, id)
          const member = {
            sourceVideoId: id,
            checkpointRevision: claimed.checkpointRevision,
            pageIndex: 0,
            sourceProfileKey: sourceKey,
            candidates: [
              {
                targetVideoId: thirdVideoId,
                targetProfileKey: targetKey,
                poolRank: 0,
              },
            ],
            candidatePageDigest: digest([
              id,
              0,
              [[0, thirdVideoId, targetKey]],
            ]),
            sourceCandidateCount: 1,
            sourceCandidateDigest: digest([thirdVideoId]),
            historicalRefDigest: digest(["none", id]),
          }
          return {
            action: "edge_batch_start",
            ...base,
            callId: randomUUID(),
            modelId: "gpt-6-astra",
            backend: "codex_chatgpt_subscription",
            promptVersion: "edge-v1",
            schemaVersion: "edge-schema-v1",
            inputDigest: digest([id, "input"]),
            membershipDigest: digest([member]),
            selectedCorpusDigest: digest("selected-corpus"),
            candidatePoolDigest: digest("candidate-pool"),
            captureRefDigest: null,
            spanOfferDigest: digest([]),
            spanOffers: [],
            startedAt: new Date().toISOString(),
            members: [{ ...member, leaseToken: claimed.leaseToken }],
          }
        }),
      )
      const reserved = await Promise.all(starts.map(submit))
      expect(reserved).toEqual(
        starts.map((start) =>
          expect.objectContaining({ callId: start.callId, state: "pending" }),
        ),
      )
      const pending = await loadDurablePrecomputedBuildReport(prisma, {
        generationId: base.generationId,
        reviewer: { id: "fixture-reviewer", role: "ADMIN" },
      })
      expect(pending).toMatchObject({
        edgeLedger: { physicalReservationCount: 2, unresolvedPendingCount: 2 },
      })
      const finishes = await Promise.all(
        starts.map((start) => {
          const results = start.members.map((member) => ({
            sourceVideoId: member.sourceVideoId,
            choices: [],
          }))
          return submit({
            action: "edge_batch_finish",
            ...base,
            callId: start.callId,
            inputDigest: start.inputDigest,
            membershipDigest: start.membershipDigest,
            spanOfferDigest: start.spanOfferDigest,
            status: "succeeded",
            outputDigest: digest(results),
            results,
            usage: { inputTokens: 40, outputTokens: 9 },
            finishedAt: new Date().toISOString(),
          })
        }),
      )
      expect(finishes).toEqual(
        starts.map((start) =>
          expect.objectContaining({
            callId: start.callId,
            state: "succeeded",
            receiptStored: true,
          }),
        ),
      )
      const report = await loadDurablePrecomputedBuildReport(prisma, {
        generationId: base.generationId,
        reviewer: { id: "fixture-reviewer", role: "ADMIN" },
      })
      expect(report).toMatchObject({
        edgeLedger: {
          physicalReservationCount: 2,
          observedInferenceCount: 2,
          unresolvedPendingCount: 0,
        },
      })
      await submit({ action: "attempt_close", ...base, reason: "paused" })
      expect(
        await prisma.recommendationPrecomputedBuildSource.count({
          where: {
            generationId: base.generationId,
            leaseExpiresAt: { gt: new Date() },
          },
        }),
      ).toBe(0)
      const nextAttempt = { ...base, attemptId: randomUUID() }
      await submit({
        action: "resume_attempt",
        generationId: base.generationId,
        generationInputDigest: base.generationInputDigest,
        executionAttempt: {
          attemptId: nextAttempt.attemptId,
          invocation: "resume",
          accountRef: "edge-account-123",
          backend: "codex_chatgpt_subscription",
          billingBasis: "included_subscription",
          authMethod: "chatgpt",
          modelId: "gpt-6-astra",
          identityObservedAt: new Date().toISOString(),
          allowanceObservedAt: new Date().toISOString(),
          weeklyRemainingPercent: 50,
          fiveHour: { kind: "limited", remainingPercent: 50 },
        },
      })
      const nextClaim = await claim(nextAttempt, sourceVideoId)
      expect(
        await submit({ action: "attempt_close", ...base, reason: "paused" }),
      ).toMatchObject({ replay: true })
      const sourceAfterReplay =
        await prisma.recommendationPrecomputedBuildSource.findUniqueOrThrow({
          where: {
            generationId_sourceVideoId: {
              generationId: base.generationId,
              sourceVideoId,
            },
          },
        })
      expect(sourceAfterReplay.leaseToken).toBe(nextClaim.leaseToken)
      expect(sourceAfterReplay.leaseExpiresAt!.getTime()).toBeGreaterThan(
        Date.now(),
      )
      await submit({
        action: "attempt_close",
        ...nextAttempt,
        reason: "paused",
      })
    })
    it("leaves a late native reservation pending without launching the external CLI", async () => {
      const fixture = await reserveOne("late-native-reservation", false)
      const directory = await mkdtemp(
        join(tmpdir(), "edge-no-dispatch-native-"),
      )
      const executable = join(directory, "fake-codex")
      const capture = join(directory, "launched")
      await writeFile(
        executable,
        `#!/usr/bin/env node\nrequire("node:fs").writeFileSync(${JSON.stringify(capture)}, "launched")\nprocess.exit(1)\n`,
        { mode: 0o700 },
      )
      for (const key of [
        "CI",
        "RAILWAY_ENVIRONMENT",
        "RAILWAY_ENVIRONMENT_NAME",
        "RAILWAY_SERVICE_ID",
      ])
        vi.stubEnv(key, "")
      try {
        const adapter = createCodexSubscriptionAstraModel({
          codexExecutable: executable,
          initiatingAccountRef: "edge-account-123",
          readAllowance: async () => ({
            observedAt: new Date().toISOString(),
            accountRef: "edge-account-123",
            billingBasis: "included_subscription",
            weeklyRemainingPercent: 50,
            fiveHour: { kind: "limited", remainingPercent: 50 },
          }),
          readOperatorIdentity: async () => ({
            observedAt: new Date().toISOString(),
            accountRef: "edge-account-123",
            authMethod: "chatgpt",
          }),
        })
        let releaseResponse: () => void = () => {
          throw new Error("Reservation callback did not begin")
        }
        const delayedResponse = new Promise<void>((resolve) => {
          releaseResponse = resolve
        })
        let committed = false
        await expect(
          adapter.generateReserved(
            {
              schema: z.object({ summary: z.string() }).strict(),
              system: "Choose a summary.",
              prompt: "Synthetic native reservation.",
              maxOutputTokens: 200,
            },
            async () => {
              const response = await submit(fixture.start)
              committed = true
              await delayedResponse
              return { kind: "dispatch", reservation: response }
            },
          ),
        ).rejects.toMatchObject({ code: "reservation_uncertain" })
        expect(committed).toBe(true)
        releaseResponse()
        await new Promise((resolve) => setTimeout(resolve, 50))
        await expect(readFile(capture)).rejects.toMatchObject({
          code: "ENOENT",
        })
        expect(
          await submit({
            action: "edge_batch_status",
            generationId: fixture.base.generationId,
            generationInputDigest: fixture.base.generationInputDigest,
            sourceVideoId,
          }),
        ).toMatchObject({
          calls: [
            {
              status: "pending",
              applicationState: "pending",
              finishedAt: null,
            },
          ],
        })
      } finally {
        vi.unstubAllEnvs()
        await rm(directory, { recursive: true, force: true })
      }
    }, 60_000)
    it("audits the reviewed no-dispatch reservation without creating a provider receipt", async () => {
      const reviewedSource = "cmp76xcw602imny01vnsbwwy9"
      await prisma.video.create({
        data: {
          id: reviewedSource,
          coreId: reviewedSource,
          slug: reviewedSource,
        },
      })
      const targetIds = Array.from(
        { length: 86 },
        (_, index) => `no-dispatch-target-${index}-${suffix}`,
      )
      await prisma.video.createMany({
        data: targetIds.map((id) => ({ id, coreId: randomUUID(), slug: id })),
      })
      await prisma.videoLocale.createMany({
        data: [reviewedSource, ...targetIds].map((videoId, index) => ({
          videoId,
          locale: "en",
          title: `Distinct reviewed story ${index}`,
          status: "PUBLISHED",
        })),
      })
      const base = await build(
        "reviewed-no-dispatch",
        [reviewedSource, ...targetIds],
        {
          generationId: "production-astra-catalog-20261013-v6",
          attemptId: "93be0f68-3564-4da7-a81d-0d7bb4b79212",
          generationInputDigest:
            "e2ad59bb95b497738290c6dee1d0dd487886f34019ea721ce6971e12dfddd3a5",
        },
      )
      const sourceKey = await readyMetadataProfile(base, reviewedSource)
      const profileKeys = new Map<string, string>()
      for (const id of targetIds)
        profileKeys.set(id, await readyMetadataProfile(base, id))
      const sourceClaim = await claim(base, reviewedSource)
      const callId = "f6cdb507-e7e3-4172-b31f-27ace231f2c3"
      const requestDigest =
        "dd72735e1bcdb439f39a824dbdfe37c408af7e414ff8a095cdf5c549e1dd5437"
      const candidates = targetIds
        .slice(68, 76)
        .map((targetVideoId, index) => ({
          targetVideoId,
          targetProfileKey: profileKeys.get(targetVideoId)!,
          poolRank: 68 + index,
        }))
      // Seed the retained late-committed reservation, never a provider receipt.
      await prisma.recommendationPrecomputedBuildSource.update({
        where: {
          generationId_sourceVideoId: {
            generationId: base.generationId,
            sourceVideoId: reviewedSource,
          },
        },
        data: {
          checkpointRevision: 21,
          checkpoint: {
            stage: "edge_page_applied_v1",
            cursor: { candidateIndex: 68 },
          },
        },
      })
      await prisma.recommendationPrecomputedEdgeBatchCall.create({
        data: {
          generationId: base.generationId,
          callId,
          attemptId: base.attemptId,
          modelId: "gpt-6-astra",
          backend: "codex_chatgpt_subscription",
          promptVersion: "edge-v1",
          schemaVersion: "edge-schema-v1",
          inputDigest: digest("reviewed-input"),
          membershipDigest: digest("reviewed-members"),
          selectedCorpusDigest: digest("reviewed-corpus"),
          candidatePoolDigest: digest("reviewed-pool"),
          captureRefDigest: null,
          spanOfferDigest: digest([]),
          spanOffers: [],
          requestDigest,
          startedAt: new Date(),
          status: "pending",
          members: {
            create: [
              {
                sourceVideoId: reviewedSource,
                leaseToken: sourceClaim.leaseToken,
                checkpointRevision: 21,
                pageIndex: 20,
                sourceProfileKey: sourceKey,
                candidates,
                candidatePageDigest: digest([
                  reviewedSource,
                  20,
                  candidates.map((item) => [
                    item.poolRank,
                    item.targetVideoId,
                    item.targetProfileKey,
                  ]),
                ]),
                sourceCandidateCount: 86,
                sourceCandidateDigest: digest(targetIds),
                historicalRefDigest: digest(["none", reviewedSource]),
                applicationState: "pending",
              },
            ],
          },
        },
      })
      const originalCall =
        await prisma.recommendationPrecomputedEdgeBatchCall.findUniqueOrThrow({
          where: {
            generationId_callId: { generationId: base.generationId, callId },
          },
        })
      const originalMember =
        await prisma.recommendationPrecomputedEdgeBatchMember.findUniqueOrThrow(
          {
            where: {
              generationId_callId_sourceVideoId: {
                generationId: base.generationId,
                callId,
                sourceVideoId: reviewedSource,
              },
            },
          },
        )
      let priorRank = 0
      await prisma.recommendationPrecomputedBuildSource.update({
        where: {
          generationId_sourceVideoId: {
            generationId: base.generationId,
            sourceVideoId: reviewedSource,
          },
        },
        data: {
          edgeSourceCandidateCount: originalMember.sourceCandidateCount,
          edgeSourceCandidateDigest: originalMember.sourceCandidateDigest,
          edgeSourceProfileKey: originalMember.sourceProfileKey,
          edgeCandidatePoolDigest: originalCall.candidatePoolDigest,
          edgeHistoricalRefDigest: originalMember.historicalRefDigest,
        },
      })
      const {
        generationId: _originalGeneration,
        callId: _originalCallId,
        ...originalMemberPayload
      } = originalMember
      void [_originalGeneration, _originalCallId]
      for (let page = 0; page < 20; page++) {
        const pageSize = page < 12 ? 3 : 4
        const priorCandidates = targetIds
          .slice(priorRank, priorRank + pageSize)
          .map((targetVideoId, index) => ({
            targetVideoId,
            targetProfileKey: profileKeys.get(targetVideoId)!,
            poolRank: priorRank + index,
          }))
        const priorCallId = randomUUID()
        await prisma.recommendationPrecomputedEdgeBatchCall.create({
          data: {
            ...originalCall,
            callId: priorCallId,
            spanOffers: [],
            status: "succeeded",
            inputTokens: 10,
            outputTokens: 1,
            receiptDigest: digest([page, "receipt"]),
            outputDigest: digest([]),
            finishedAt: new Date(),
            members: {
              create: [
                {
                  ...originalMemberPayload,
                  candidates: priorCandidates,
                  checkpointRevision: page + 1,
                  pageIndex: page,
                  candidatePageDigest: digest([
                    reviewedSource,
                    page,
                    priorCandidates.map((item) => [
                      item.poolRank,
                      item.targetVideoId,
                      item.targetProfileKey,
                    ]),
                  ]),
                  applicationState: "applied_empty",
                  appliedRevision: page + 2,
                  resultChoiceCount: 0,
                },
              ],
            },
          },
        })
        priorRank += pageSize
      }
      expect(priorRank).toBe(68)
      await submit({ action: "attempt_close", ...base, reason: "paused" })
      const maintenanceId = randomUUID()
      const maintenance = { ...base, attemptId: maintenanceId }
      await prisma.recommendationPrecomputedBuildSource.updateMany({
        where: { generationId: base.generationId, state: "claimed" },
        data: { leaseExpiresAt: new Date(0) },
      })
      await submit({
        action: "resume_attempt",
        generationId: base.generationId,
        generationInputDigest: base.generationInputDigest,
        executionAttempt: {
          attemptId: maintenanceId,
          invocation: "resume",
          accountRef: "edge-account-123",
          backend: "codex_chatgpt_subscription",
          billingBasis: "included_subscription",
          authMethod: "chatgpt",
          modelId: "gpt-6-astra",
          identityObservedAt: new Date().toISOString(),
          allowanceObservedAt: new Date().toISOString(),
          weeklyRemainingPercent: 50,
          fiveHour: { kind: "limited", remainingPercent: 50 },
        },
      })
      const acknowledgement = {
        action: "edge_no_dispatch_ack",
        ...maintenance,
        originalCallId: callId,
        originalAttemptId: base.attemptId,
        expectedRequestDigest: requestDigest,
        evidenceDigest:
          "43cdc25082e85c9b2a743a62da0dfc2857ce7b037d52a4467818dbf9a1e9422d",
        operatorAccountRef: "edge-account-123",
        oldProcessExitedAttested: true,
      }
      const budgetBefore =
        await prisma.recommendationPrecomputedBuildBudget.findUniqueOrThrow({
          where: { generationId: base.generationId },
        })
      const closedAttempt =
        await prisma.recommendationPrecomputedExecutionAttempt.findUniqueOrThrow(
          {
            where: {
              generationId_attemptId: {
                generationId: base.generationId,
                attemptId: base.attemptId,
              },
            },
          },
        )
      await prisma.recommendationPrecomputedExecutionAttempt.update({
        where: {
          generationId_attemptId: {
            generationId: base.generationId,
            attemptId: maintenanceId,
          },
        },
        data: { endedAt: new Date(), endReason: "paused" },
      })
      await prisma.recommendationPrecomputedExecutionAttempt.update({
        where: {
          generationId_attemptId: {
            generationId: base.generationId,
            attemptId: base.attemptId,
          },
        },
        data: { endedAt: null, endReason: null },
      })
      await expect(submit(acknowledgement)).rejects.toMatchObject({
        code: "conflict",
      })
      await prisma.recommendationPrecomputedExecutionAttempt.update({
        where: {
          generationId_attemptId: {
            generationId: base.generationId,
            attemptId: base.attemptId,
          },
        },
        data: {
          endedAt: closedAttempt.endedAt,
          endReason: closedAttempt.endReason,
        },
      })
      await prisma.recommendationPrecomputedExecutionAttempt.update({
        where: {
          generationId_attemptId: {
            generationId: base.generationId,
            attemptId: maintenanceId,
          },
        },
        data: { endedAt: null, endReason: null },
      })
      await prisma.recommendationPrecomputedBuildSource.update({
        where: {
          generationId_sourceVideoId: {
            generationId: base.generationId,
            sourceVideoId: reviewedSource,
          },
        },
        data: { leaseExpiresAt: new Date(Date.now() + 60_000) },
      })
      await expect(submit(acknowledgement)).rejects.toMatchObject({
        code: "conflict",
      })
      await prisma.recommendationPrecomputedBuildSource.update({
        where: {
          generationId_sourceVideoId: {
            generationId: base.generationId,
            sourceVideoId: reviewedSource,
          },
        },
        data: {
          leaseExpiresAt: new Date(0),
          checkpoint: {
            stage: "edge_page_applied_v1",
            cursor: { candidateIndex: 69 },
          },
        },
      })
      await expect(submit(acknowledgement)).rejects.toMatchObject({
        code: "conflict",
      })
      await prisma.recommendationPrecomputedBuildSource.update({
        where: {
          generationId_sourceVideoId: {
            generationId: base.generationId,
            sourceVideoId: reviewedSource,
          },
        },
        data: {
          checkpoint: {
            stage: "edge_page_applied_v1",
            cursor: { candidateIndex: 68 },
          },
          edgeSourceCandidateDigest: "f".repeat(64),
        },
      })
      await expect(submit(acknowledgement)).rejects.toMatchObject({
        code: "conflict",
      })
      await prisma.recommendationPrecomputedBuildSource.update({
        where: {
          generationId_sourceVideoId: {
            generationId: base.generationId,
            sourceVideoId: reviewedSource,
          },
        },
        data: {
          edgeSourceCandidateDigest: originalMember.sourceCandidateDigest,
        },
      })
      await expect(
        submit({ ...acknowledgement, expectedRequestDigest: "f".repeat(64) }),
      ).rejects.toMatchObject({ code: "conflict" })
      const lateFinish = {
        action: "edge_batch_finish",
        ...base,
        callId,
        inputDigest: originalCall.inputDigest,
        membershipDigest: originalCall.membershipDigest,
        spanOfferDigest: originalCall.spanOfferDigest,
        status: "succeeded",
        results: [{ sourceVideoId: reviewedSource, choices: [] }],
        outputDigest: digest([{ sourceVideoId: reviewedSource, choices: [] }]),
        usage: { inputTokens: 10, outputTokens: 1 },
        finishedAt: new Date().toISOString(),
      }
      // Hold the source fence until a real finish has acquired its generation
      // share lock; the competing acknowledgement then queues behind it.
      await admin.query("BEGIN")
      await admin.query(
        "SELECT source_video_id FROM recommendation_precomputed_build_source WHERE generation_id=$1 AND source_video_id=$2 FOR UPDATE",
        [base.generationId, reviewedSource],
      )
      const finishRace = submit(lateFinish).then(
        (value) => ({ accepted: true, value }),
        (error: unknown) => ({ accepted: false, error }),
      )
      let startAcknowledgement: () => void = () => {
        throw new Error("Race gate not initialized")
      }
      const finishReady = new Promise<void>((resolve) => {
        startAcknowledgement = resolve
      })
      const acknowledgementRace = finishReady
        .then(() => submit(acknowledgement))
        .then(
          (value) => ({ accepted: true, value }),
          (error: unknown) => ({ accepted: false, error }),
        )
      let finishWaiting = false
      try {
        for (let probe = 0; probe < 100; probe++) {
          await admin.query("SELECT pg_stat_clear_snapshot()")
          const waiting = await admin.query<{ waiting: boolean }>(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%recommendation_precomputed_build_source%') AS waiting",
          )
          if (waiting.rows[0]?.waiting) {
            finishWaiting = true
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        expect(finishWaiting).toBe(true)
        startAcknowledgement()
        let acknowledgementWaiting = false
        for (let probe = 0; probe < 100; probe++) {
          await admin.query("SELECT pg_stat_clear_snapshot()")
          const waiting = await admin.query<{ waiting: boolean }>(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%recommendation_precomputed_generation%') AS waiting",
          )
          if (waiting.rows[0]?.waiting) {
            acknowledgementWaiting = true
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        expect(acknowledgementWaiting).toBe(true)
      } finally {
        await admin.query("COMMIT")
      }
      const race = await Promise.all([finishRace, acknowledgementRace])
      expect(race.map((item) => item.accepted)).toEqual([true, false])
      expect(
        await prisma.recommendationPrecomputedEdgeNoDispatchDisposition.count({
          where: { generationId: base.generationId },
        }),
      ).toBe(0)
      expect(
        await prisma.recommendationPrecomputedEdgeBatchCall.findUniqueOrThrow({
          where: {
            generationId_callId: { generationId: base.generationId, callId },
          },
        }),
      ).toMatchObject({ inputTokens: 10, outputTokens: 1 })
      // Reset only synthetic fixture state to exercise the opposite winner:
      // acknowledgement is accepted and every subsequent finish is refused.
      await prisma.recommendationPrecomputedEdgeBatchCall.update({
        where: {
          generationId_callId: { generationId: base.generationId, callId },
        },
        data: {
          status: "pending",
          inputTokens: null,
          outputTokens: null,
          cachedInputTokens: null,
          outputDigest: null,
          errorCode: null,
          finishedAt: null,
          receiptDigest: null,
        },
      })
      await prisma.recommendationPrecomputedEdgeBatchMember.update({
        where: {
          generationId_callId_sourceVideoId: {
            generationId: base.generationId,
            callId,
            sourceVideoId: reviewedSource,
          },
        },
        data: {
          applicationState: "pending",
          appliedRevision: null,
          resultChoiceCount: null,
        },
      })
      const acknowledgements = await Promise.all([
        submit(acknowledgement),
        submit(acknowledgement),
      ])
      expect(acknowledgements.map((item) => item.replay).sort()).toEqual([
        false,
        true,
      ])
      expect(acknowledgements[0]).toMatchObject({
        disposition: "reservation_timeout_before_dispatch",
      })
      const budgetAfter =
        await prisma.recommendationPrecomputedBuildBudget.findUniqueOrThrow({
          where: { generationId: base.generationId },
        })
      expect(budgetAfter.consumedBytes - budgetBefore.consumedBytes).toBe(
        16_384n,
      )
      await expect(
        submit({ ...acknowledgement, evidenceDigest: "f".repeat(64) }),
      ).rejects.toMatchObject({ code: "conflict" })
      await expect(
        submit({ ...acknowledgement, operatorAccountRef: "different-account" }),
      ).rejects.toMatchObject({ code: "conflict" })
      await expect(
        submit({
          action: "edge_batch_finish",
          ...base,
          callId,
          inputDigest: originalCall.inputDigest,
          membershipDigest: originalCall.membershipDigest,
          spanOfferDigest: originalCall.spanOfferDigest,
          status: "succeeded",
          results: [{ sourceVideoId: reviewedSource, choices: [] }],
          outputDigest: digest([
            { sourceVideoId: reviewedSource, choices: [] },
          ]),
          usage: { inputTokens: 10, outputTokens: 1 },
          finishedAt: new Date().toISOString(),
        }),
      ).rejects.toMatchObject({ code: "conflict" })
      await expect(
        prisma.recommendationPrecomputedEdgeNoDispatchDisposition.update({
          where: {
            generationId_callId: { generationId: base.generationId, callId },
          },
          data: { evidenceDigest: "f".repeat(64) },
        }),
      ).rejects.toThrow("immutable")
      await expect(
        prisma.recommendationPrecomputedEdgeBatchMember.update({
          where: {
            generationId_callId_sourceVideoId: {
              generationId: base.generationId,
              callId,
              sourceVideoId: reviewedSource,
            },
          },
          data: { applicationState: "pending" },
        }),
      ).rejects.toThrow("immutable")
      const report = await loadDurablePrecomputedBuildReport(prisma, {
        generationId: base.generationId,
        reviewer: { id: "fixture-reviewer", role: "ADMIN" },
      })
      expect(report).toMatchObject({
        edgeLedger: {
          unresolvedPendingCount: 0,
          noDispatchReservationCount: 1,
          pendingCalls: [],
        },
      })
      expect(
        report?.usage.attempts.find(
          (attempt) => attempt.attemptId === base.attemptId,
        ),
      ).toMatchObject({
        edgeBatchCallCount: 20,
        edgeBatchReservationCount: 21,
        edgeBatchNoDispatchReservationCount: 1,
      })
      await prisma.recommendationPrecomputedGeneration.update({
        where: { id: base.generationId },
        data: { status: "complete", completedAt: new Date() },
      })
      const policySettings = {
        baselineHumanVisitCtr: 0.04,
        minimumDetectableAbsoluteUplift: 0.02,
        minimumPracticalAbsoluteUplift: 0.01,
        plannedPower: 0.8,
        minimumEligibleVisitsPerArm: 100,
        minimumIndependentBrowsersPerArm: 100,
        minimumDurationHours: 168,
        lateEventCutoffHours: 48,
        maximumActualFallbackRate: 0.05,
        maximumUnlinkedDeliveryRate: 0.01,
        maximumEndToEndLossRate: 0.1,
      }
      const live = await loadLiveEvidence(prisma, {
        generationId: base.generationId,
        startsAt: new Date(),
        now: new Date(),
        policySettings,
        policyAgreement: null,
        operatorId: "fixture-reviewer",
        webMeasurement: null,
      })
      expect(live.snapshot).toMatchObject({
        modelCallCount: 20,
        unknownModelCostCount: 0,
      })
      expect(live.reasons).not.toContain("model_usage_unknown")
      const readiness = await loadPrecomputedPublicReadiness(prisma, {
        id: "fixture-reviewer",
        role: "ADMIN",
      })
      expect(readiness.generationModelUsage).toMatchObject({
        modelCallCount: 20,
        unknownModelUsageCount: 0,
      })
      await prisma.recommendationPrecomputedGeneration.update({
        where: { id: base.generationId },
        data: { status: "incomplete", completedAt: null },
      })
      const status = await submit({
        action: "edge_batch_status",
        generationId: base.generationId,
        generationInputDigest: base.generationInputDigest,
        sourceVideoId: reviewedSource,
      })
      expect(status).toMatchObject({
        checkpointRevision: 21,
        calls: expect.arrayContaining([
          expect.objectContaining({
            status: "pending",
            applicationState: "no_dispatch_unapplied",
            reservationDisposition: {
              reason: "reservation_timeout_before_dispatch",
              evidenceDigest: acknowledgement.evidenceDigest,
              acknowledgedAt: expect.any(String),
            },
          }),
        ]),
      })
      expect(
        await prisma.recommendationPrecomputedEdgeBatchCall.findUniqueOrThrow({
          where: {
            generationId_callId: { generationId: base.generationId, callId },
          },
        }),
      ).toEqual(originalCall)
      expect(
        await prisma.recommendationPrecomputedEdgeBatchMember.findUniqueOrThrow(
          {
            where: {
              generationId_callId_sourceVideoId: {
                generationId: base.generationId,
                callId,
                sourceVideoId: reviewedSource,
              },
            },
          },
        ),
      ).toEqual({
        ...originalMember,
        applicationState: "no_dispatch_unapplied",
      })
      await submit({
        action: "attempt_close",
        ...maintenance,
        reason: "paused",
      })
      const producer = { ...base, attemptId: randomUUID() }
      expect(await submit(acknowledgement)).toMatchObject({ replay: true })
      await submit({
        action: "resume_attempt",
        generationId: base.generationId,
        generationInputDigest: base.generationInputDigest,
        executionAttempt: {
          attemptId: producer.attemptId,
          invocation: "resume",
          accountRef: "edge-account-123",
          backend: "codex_chatgpt_subscription",
          billingBasis: "included_subscription",
          authMethod: "chatgpt",
          modelId: "gpt-6-astra",
          identityObservedAt: new Date().toISOString(),
          allowanceObservedAt: new Date().toISOString(),
          weeklyRemainingPercent: 50,
          fiveHour: { kind: "limited", remainingPercent: 50 },
        },
      })
      const freshClaim = await claim(producer, reviewedSource)
      // Real consumer parsing recognizes the audited reservation, but its
      // unconsumed page never contributes applied coverage or finalization.
      await expect(
        finalizeEdgeSource({
          ...producer,
          sourceVideoId: reviewedSource,
          leaseToken: freshClaim.leaseToken,
          expectedRevision: 21,
          sourceProfileKey: sourceKey,
          orderedCandidateIds: targetIds,
          profileKeysByVideoId: profileKeys,
          persistence: createEdgeBatchPersistence(submit),
        }),
      ).rejects.toMatchObject({ code: "candidate_page_invalid" })
      const memberIdentity = {
        sourceVideoId: reviewedSource,
        checkpointRevision: freshClaim.checkpointRevision,
        pageIndex: 20,
        sourceProfileKey: sourceKey,
        candidates,
        candidatePageDigest: originalMember.candidatePageDigest,
        sourceCandidateCount: 86,
        sourceCandidateDigest: originalMember.sourceCandidateDigest,
        historicalRefDigest: originalMember.historicalRefDigest,
      }
      const nextCallId = randomUUID()
      expect(
        await submit({
          action: "edge_batch_start",
          ...producer,
          callId: nextCallId,
          modelId: originalCall.modelId,
          backend: originalCall.backend,
          promptVersion: originalCall.promptVersion,
          schemaVersion: originalCall.schemaVersion,
          inputDigest: digest("next-model-input"),
          membershipDigest: digest([memberIdentity]),
          selectedCorpusDigest: originalCall.selectedCorpusDigest,
          candidatePoolDigest: originalCall.candidatePoolDigest,
          captureRefDigest: null,
          spanOfferDigest: digest([]),
          startedAt: new Date().toISOString(),
          members: [{ ...memberIdentity, leaseToken: freshClaim.leaseToken }],
          spanOffers: [],
        }),
      ).toMatchObject({ state: "pending", replay: false })
      const continued = await submit({
        action: "edge_batch_status",
        generationId: base.generationId,
        generationInputDigest: base.generationInputDigest,
        sourceVideoId: reviewedSource,
      })
      expect(continued).toMatchObject({
        checkpointRevision: 21,
        calls: expect.arrayContaining([
          expect.objectContaining({
            callId: nextCallId,
            pageIndex: 20,
            candidates,
          }),
        ]),
      })
      const unresolvedReport = await loadDurablePrecomputedBuildReport(prisma, {
        generationId: base.generationId,
        reviewer: { id: "fixture-reviewer", role: "ADMIN" },
      })
      expect(unresolvedReport).toMatchObject({
        edgeLedger: {
          physicalReservationCount: 22,
          observedInferenceCount: 20,
          unresolvedPendingCount: 1,
          noDispatchReservationCount: 1,
        },
      })
      const unresolvedLive = await loadLiveEvidence(prisma, {
        generationId: base.generationId,
        startsAt: new Date(),
        now: new Date(),
        policySettings,
        policyAgreement: null,
        operatorId: "fixture-reviewer",
        webMeasurement: null,
      })
      expect(unresolvedLive.snapshot).toMatchObject({
        modelCallCount: 21,
        unknownModelCostCount: 1,
      })
      expect(unresolvedLive.reasons).toContain("model_usage_unknown")
      await submit({ action: "attempt_close", ...producer, reason: "paused" })
      await prisma.recommendationPrecomputedGeneration.update({
        where: { id: base.generationId },
        data: { status: "cancelled", cancelledAt: new Date() },
      })
      await prisma.$transaction((tx) =>
        purgeExpiredPrecomputedGenerations(tx, new Date(), 1),
      )
      expect(
        await prisma.recommendationPrecomputedEdgeNoDispatchDisposition.count({
          where: { generationId: base.generationId },
        }),
      ).toBe(1)
      await prisma.$transaction((tx) =>
        purgeExpiredPrecomputedGenerations(
          tx,
          new Date(Date.now() + 100 * 86_400_000),
          1,
        ),
      )
      expect(
        await prisma.recommendationPrecomputedEdgeNoDispatchDisposition.count({
          where: { generationId: base.generationId },
        }),
      ).toBe(0)
      for (let page = 0; page < 10; page++) {
        if (
          !(await prisma.recommendationPrecomputedGeneration.findUnique({
            where: { id: base.generationId },
          }))
        )
          break
        await prisma.$transaction((tx) =>
          purgeExpiredPrecomputedGenerations(
            tx,
            new Date(Date.now() + 100 * 86_400_000),
            1,
          ),
        )
      }
      expect(
        await prisma.recommendationPrecomputedGeneration.findUnique({
          where: { id: base.generationId },
        }),
      ).toBeNull()
    })
    it.each([
      {
        callId: "d541c707-abd6-4f01-9a8f-038c11b2a4e7",
        attemptId: "b01b7bb1-5b87-4630-baca-7640e76cfd62",
        requestDigest:
          "72ef38c5db10293ad056e13a7de10e37995b9e6d54e614766a5ae2008fd242af",
        evidenceDigest:
          "ff0f204b63dbc2ccd51e60d8225cc714c2d6c2aa82d0a866d506bb44384d1c92",
        sourceIds: ["cmokmkp5h0nvkqsccj7ysgsz2", "cmokmkra70nw2qscc6utvnl84"],
        firstRanks: [8, 7],
        candidateCounts: [4, 3],
        sourceCounts: [51, 51],
        pageIndex: 2,
        checkpointRevision: 3,
      },
      {
        callId: "734caa08-6a97-4704-b1a7-bab5b2b017e7",
        attemptId: "b29eb01c-ba09-4ae2-8d32-a0fb5b581b15",
        requestDigest:
          "025d1acbe592eb0b91d9bf38335659d6674c1b9d00913eaa912d7592ffe827c6",
        evidenceDigest:
          "b988c277eb6acc82ef3cbacde68407292ae700d2143eba6199dceb55863b1d3f",
        sourceIds: ["cmokmltnh0o4sqscc538f8ft5", "cmokmlvtk0o5cqscc95pobxr0"],
        firstRanks: [32, 29],
        candidateCounts: [3, 2],
        sourceCounts: [54, 62],
        pageIndex: 9,
        checkpointRevision: 10,
      },
    ])(
      "audits both members of $callId without advancing either source",
      async (incident) => {
        // Clear the prior isolated case in FK order; never touch public data.
        await prisma.recommendationPrecomputedEdgeBatchMember.deleteMany({
          where: { generationId: "production-astra-catalog-20261013-v6" },
        })
        await prisma.recommendationPrecomputedEdgeBatchCall.deleteMany({
          where: { generationId: "production-astra-catalog-20261013-v6" },
        })
        await prisma.recommendationPrecomputedContentProfile.deleteMany({
          where: { generationId: "production-astra-catalog-20261013-v6" },
        })
        await prisma.recommendationPrecomputedGeneration.deleteMany({
          where: { id: "production-astra-catalog-20261013-v6" },
        })
        // Both incident fixtures intentionally use the production-pinned generation
        // ID. The preceding retention test has removed its generation; reset only
        // its retirement proof inside this disposable schema before this fixture.
        await prisma.recommendationPrecomputedGenerationRetentionProof.deleteMany(
          {
            where: { generationId: "production-astra-catalog-20261013-v6" },
          },
        )
        const sourceIds = incident.sourceIds
        await prisma.video.createMany({
          data: sourceIds.map((id) => ({ id, coreId: id, slug: id })),
        })
        const base = await build("concurrent-no-dispatch", sourceIds, {
          generationId: "production-astra-catalog-20261013-v6",
          attemptId: incident.attemptId,
          generationInputDigest:
            "e2ad59bb95b497738290c6dee1d0dd487886f34019ea721ce6971e12dfddd3a5",
        })
        const callId = incident.callId
        const requestDigest = incident.requestDigest
        const members = []
        for (const [index, sourceVideoId] of sourceIds.entries()) {
          const claimed = await claim(base, sourceVideoId)
          const sourceProfileKey = await readyMetadataProfile(
            base,
            sourceVideoId,
          )
          const firstRank = incident.firstRanks[index]!
          const candidates = Array.from(
            { length: incident.candidateCounts[index]! },
            (_, offset) => ({
              targetVideoId: `retained-fixture-target-${index}-${offset}`,
              targetProfileKey: digest([index, offset]),
              poolRank: firstRank + offset,
            }),
          )
          const item = {
            sourceVideoId,
            leaseToken: claimed.leaseToken,
            checkpointRevision: incident.checkpointRevision,
            pageIndex: incident.pageIndex,
            sourceProfileKey,
            candidates,
            candidatePageDigest: digest(candidates),
            sourceCandidateCount: incident.sourceCounts[index]!,
            sourceCandidateDigest: digest([sourceVideoId, "pool"]),
            historicalRefDigest: digest([sourceVideoId, "history"]),
            applicationState: "pending",
          }
          members.push(item)
          await prisma.recommendationPrecomputedBuildSource.update({
            where: {
              generationId_sourceVideoId: {
                generationId: base.generationId,
                sourceVideoId,
              },
            },
            data: {
              checkpointRevision: incident.checkpointRevision,
              checkpoint: {
                stage: "edge_page_applied_v1",
                cursor: { candidateIndex: firstRank },
              },
              edgeSourceCandidateCount: incident.sourceCounts[index]!,
              edgeSourceCandidateDigest: item.sourceCandidateDigest,
              edgeSourceProfileKey: sourceProfileKey,
              edgeCandidatePoolDigest: digest("pool"),
              edgeHistoricalRefDigest: item.historicalRefDigest,
              leaseExpiresAt: new Date(0),
            },
          })
        }
        await prisma.recommendationPrecomputedEdgeBatchCall.create({
          data: {
            generationId: base.generationId,
            callId,
            attemptId: base.attemptId,
            modelId: "gpt-6-astra",
            backend: "codex_chatgpt_subscription",
            promptVersion: "edge-v1",
            schemaVersion: "edge-schema-v1",
            inputDigest: digest("input"),
            membershipDigest: digest(members),
            selectedCorpusDigest: digest("corpus"),
            candidatePoolDigest: digest("pool"),
            captureRefDigest: null,
            spanOfferDigest: digest([]),
            spanOffers: [],
            requestDigest,
            startedAt: new Date(),
            status: "pending",
            members: { create: members },
          },
        })
        const originalCall =
          await prisma.recommendationPrecomputedEdgeBatchCall.findUniqueOrThrow(
            {
              where: {
                generationId_callId: {
                  generationId: base.generationId,
                  callId,
                },
              },
            },
          )
        const originalMembers =
          await prisma.recommendationPrecomputedEdgeBatchMember.findMany({
            where: { generationId: base.generationId, callId },
            orderBy: { sourceVideoId: "asc" },
          })
        await submit({ action: "attempt_close", ...base, reason: "paused" })
        const maintenance = { ...base, attemptId: randomUUID() }
        await submit({
          action: "resume_attempt",
          generationId: base.generationId,
          generationInputDigest: base.generationInputDigest,
          executionAttempt: {
            attemptId: maintenance.attemptId,
            invocation: "resume",
            accountRef: "edge-account-123",
            backend: "codex_chatgpt_subscription",
            billingBasis: "included_subscription",
            authMethod: "chatgpt",
            modelId: "gpt-6-astra",
            identityObservedAt: new Date().toISOString(),
            allowanceObservedAt: new Date().toISOString(),
            weeklyRemainingPercent: 50,
            fiveHour: { kind: "limited", remainingPercent: 50 },
          },
        })
        const acknowledgement = {
          action: "edge_no_dispatch_ack",
          ...maintenance,
          originalCallId: callId,
          originalAttemptId: base.attemptId,
          expectedRequestDigest: requestDigest,
          evidenceDigest: incident.evidenceDigest,
          operatorAccountRef: "edge-account-123",
          oldProcessExitedAttested: true,
        }
        await expect(
          submit({ ...acknowledgement, evidenceDigest: "b".repeat(64) }),
        ).rejects.toMatchObject({ code: "conflict" })
        const secondSource = {
          generationId_sourceVideoId: {
            generationId: base.generationId,
            sourceVideoId: sourceIds[1]!,
          },
        }
        await prisma.recommendationPrecomputedBuildSource.update({
          where: secondSource,
          data: { checkpointRevision: incident.checkpointRevision + 1 },
        })
        await expect(submit(acknowledgement)).rejects.toMatchObject({
          code: "conflict",
        })
        await prisma.recommendationPrecomputedBuildSource.update({
          where: secondSource,
          data: { checkpointRevision: incident.checkpointRevision },
        })
        const originalSources =
          await prisma.recommendationPrecomputedBuildSource.findMany({
            where: { generationId: base.generationId },
            orderBy: { sourceVideoId: "asc" },
          })
        await expect(submit(acknowledgement)).resolves.toMatchObject({
          disposition: "reservation_timeout_before_dispatch",
          replay: false,
        })
        await expect(submit(acknowledgement)).resolves.toMatchObject({
          replay: true,
        })
        expect(
          await prisma.recommendationPrecomputedEdgeBatchCall.findUniqueOrThrow(
            {
              where: {
                generationId_callId: {
                  generationId: base.generationId,
                  callId,
                },
              },
            },
          ),
        ).toEqual(originalCall)
        expect(
          await prisma.recommendationPrecomputedEdgeBatchMember.findMany({
            where: { generationId: base.generationId, callId },
            orderBy: { sourceVideoId: "asc" },
          }),
        ).toEqual(
          originalMembers.map((member) => ({
            ...member,
            applicationState: "no_dispatch_unapplied",
          })),
        )
        expect(
          await prisma.recommendationPrecomputedBuildSource.findMany({
            where: { generationId: base.generationId },
            orderBy: { sourceVideoId: "asc" },
          }),
        ).toEqual(originalSources)
        const report = await loadDurablePrecomputedBuildReport(prisma, {
          generationId: base.generationId,
          reviewer: { id: "fixture-reviewer", role: "ADMIN" },
        })
        expect(report).toMatchObject({
          edgeLedger: {
            physicalReservationCount: 1,
            observedInferenceCount: 0,
            unresolvedPendingCount: 0,
            noDispatchReservationCount: 1,
          },
        })
        for (const sourceVideoId of sourceIds) {
          const auditedStatus = await createEdgeBatchPersistence(submit).status(
            {
              action: "edge_batch_status",
              generationId: base.generationId,
              generationInputDigest: base.generationInputDigest,
              sourceVideoId,
            },
          )
          expect(auditedNoDispatchIsSafe(auditedStatus.calls[0]!)).toBe(true)
          expect(
            await submit({
              action: "edge_batch_status",
              generationId: base.generationId,
              generationInputDigest: base.generationInputDigest,
              sourceVideoId,
            }),
          ).toMatchObject({
            checkpointRevision: incident.checkpointRevision,
            calls: [
              expect.objectContaining({
                status: "pending",
                applicationState: "no_dispatch_unapplied",
              }),
            ],
          })
        }
        await submit({
          action: "attempt_close",
          ...maintenance,
          reason: "paused",
        })
      },
    )
    it("reserves one physical call for two fenced source members and replays exactly", async () => {
      const base = await build("edge-shared-start")
      const sourceKey = await readyMetadataProfile(base, sourceVideoId)
      const targetKey = await readyMetadataProfile(base, targetVideoId)
      const sourceClaim = await claim(base, sourceVideoId)
      const targetClaim = await claim(base, targetVideoId)
      const members = [
        {
          sourceVideoId,
          leaseToken: sourceClaim.leaseToken,
          checkpointRevision: sourceClaim.checkpointRevision,
          pageIndex: 0,
          sourceProfileKey: sourceKey,
          candidates: [
            { targetVideoId, targetProfileKey: targetKey, poolRank: 0 },
          ],
          candidatePageDigest: digest([
            sourceVideoId,
            0,
            [[0, targetVideoId, targetKey]],
          ]),
          sourceCandidateCount: 1,
          sourceCandidateDigest: digest([targetVideoId]),
          historicalRefDigest: digest(["none", sourceVideoId]),
        },
        {
          sourceVideoId: targetVideoId,
          leaseToken: targetClaim.leaseToken,
          checkpointRevision: targetClaim.checkpointRevision,
          pageIndex: 0,
          sourceProfileKey: targetKey,
          candidates: [
            {
              targetVideoId: sourceVideoId,
              targetProfileKey: sourceKey,
              poolRank: 0,
            },
          ],
          candidatePageDigest: digest([
            targetVideoId,
            0,
            [[0, sourceVideoId, sourceKey]],
          ]),
          sourceCandidateCount: 1,
          sourceCandidateDigest: digest([sourceVideoId]),
          historicalRefDigest: digest(["none", targetVideoId]),
        },
      ].sort((a, b) => a.sourceVideoId.localeCompare(b.sourceVideoId))
      const start = {
        action: "edge_batch_start",
        ...base,
        callId: randomUUID(),
        modelId: "gpt-6-astra",
        backend: "codex_chatgpt_subscription",
        promptVersion: "edge-v1",
        schemaVersion: "edge-schema-v1",
        inputDigest: digest("transient-model-input"),
        membershipDigest: digest(
          members.map(({ leaseToken: _leaseToken, ...member }) => member),
        ),
        selectedCorpusDigest: digest("selected-corpus"),
        candidatePoolDigest: digest("candidate-pool"),
        captureRefDigest: null,
        spanOfferDigest: digest([]),
        startedAt: new Date().toISOString(),
        members,
        spanOffers: [],
      }
      expect(await submit(start)).toMatchObject({
        state: "pending",
        replay: false,
        members: [
          { applicationState: "pending" },
          { applicationState: "pending" },
        ],
      })
      expect(await submit(start)).toMatchObject({
        state: "pending",
        replay: true,
      })
      expect(
        await prisma.recommendationPrecomputedEdgeBatchCall.count({
          where: { generationId: base.generationId },
        }),
      ).toBe(1)
      await expect(submit({ ...start, callId: randomUUID() })).rejects.toThrow(
        "pending",
      )
      const staleSourceVideoId = members[0]!.sourceVideoId
      await prisma.recommendationPrecomputedBuildSource.update({
        where: {
          generationId_sourceVideoId: {
            generationId: base.generationId,
            sourceVideoId: staleSourceVideoId,
          },
        },
        data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
      })
      const results = members.map((item) => ({
        sourceVideoId: item.sourceVideoId,
        choices: [],
      }))
      const finish = {
        action: "edge_batch_finish",
        ...base,
        callId: start.callId,
        inputDigest: start.inputDigest,
        membershipDigest: start.membershipDigest,
        spanOfferDigest: start.spanOfferDigest,
        status: "succeeded",
        outputDigest: digest(results),
        results,
        usage: { inputTokens: 120, outputTokens: 30 },
        finishedAt: new Date().toISOString(),
      }
      expect(await submit(finish)).toMatchObject({
        receiptStored: true,
        members: [
          {
            sourceVideoId: members[0]!.sourceVideoId,
            applicationState: "stale_unapplied",
          },
          {
            sourceVideoId: members[1]!.sourceVideoId,
            applicationState: "applied_empty",
          },
        ],
      })
      expect(await submit(finish)).toMatchObject({ replay: true })
      expect(
        await prisma.recommendationPrecomputedEdgeBatchCall.findUniqueOrThrow({
          where: {
            generationId_callId: {
              generationId: base.generationId,
              callId: start.callId,
            },
          },
        }),
      ).toMatchObject({ inputTokens: 120, outputTokens: 30 })
    })
    it("excludes a duplicate-content candidate before reserving a model call", async () => {
      const { base, start } = await reserveOne("edge-duplicate-content", false)
      await prisma.video.update({
        where: { id: targetVideoId },
        data: { coreId: `core-${sourceVideoId}-copy` },
      })
      try {
        await expect(submit(start)).rejects.toThrow("duplicate Video content")
        expect(
          await prisma.recommendationPrecomputedEdgeBatchCall.count({
            where: { generationId: base.generationId },
          }),
        ).toBe(0)
      } finally {
        await prisma.video.update({
          where: { id: targetVideoId },
          data: { coreId: `core-${targetVideoId}` },
        })
      }
    })
    it("stores one observed receipt and applies a metadata-backed edge to the fenced source", async () => {
      const base = await build("edge-one-receipt")
      const sourceKey = await readyMetadataProfile(base, sourceVideoId)
      const targetKey = await readyMetadataProfile(base, targetVideoId)
      const sourceClaim = await claim(base, sourceVideoId)
      const member = {
        sourceVideoId,
        leaseToken: sourceClaim.leaseToken,
        checkpointRevision: sourceClaim.checkpointRevision,
        pageIndex: 0,
        sourceProfileKey: sourceKey,
        candidates: [
          { targetVideoId, targetProfileKey: targetKey, poolRank: 0 },
        ],
        candidatePageDigest: digest([
          sourceVideoId,
          0,
          [[0, targetVideoId, targetKey]],
        ]),
        sourceCandidateCount: 1,
        sourceCandidateDigest: digest([targetVideoId]),
        historicalRefDigest: digest(["none", sourceVideoId]),
      }
      const start = {
        action: "edge_batch_start",
        ...base,
        callId: randomUUID(),
        modelId: "gpt-6-astra",
        backend: "codex_chatgpt_subscription",
        promptVersion: "edge-v1",
        schemaVersion: "edge-schema-v1",
        inputDigest: digest("one-source-input"),
        membershipDigest: digest([{ ...member, leaseToken: undefined }]),
        selectedCorpusDigest: digest("selected-corpus"),
        candidatePoolDigest: digest("candidate-pool"),
        captureRefDigest: null,
        spanOfferDigest: digest([]),
        startedAt: new Date().toISOString(),
        members: [member],
        spanOffers: [],
      }
      await submit(start)
      const results = [
        {
          sourceVideoId,
          choices: [
            {
              targetVideoId,
              kind: "direct",
              strength: 73,
              relationship: "A related story",
              reasonEnglish:
                "Both stories explore hope through a difficult choice.",
              evidence: { basis: "metadata", fields: ["title"] },
            },
          ],
        },
      ]
      const finish = {
        action: "edge_batch_finish",
        ...base,
        callId: start.callId,
        inputDigest: start.inputDigest,
        membershipDigest: start.membershipDigest,
        spanOfferDigest: start.spanOfferDigest,
        status: "succeeded",
        outputDigest: digest(results),
        results,
        usage: { inputTokens: 120, outputTokens: 30 },
        finishedAt: new Date().toISOString(),
      }
      expect(await submit(finish)).toMatchObject({
        state: "succeeded",
        receiptStored: true,
        replay: false,
        members: [
          {
            sourceVideoId,
            applicationState: "applied_edges",
            appliedRevision: 1,
          },
        ],
      })
      expect(await submit(finish)).toMatchObject({ replay: true })
      expect(
        await prisma.recommendationPrecomputedEdgeBatchCall.findUniqueOrThrow({
          where: {
            generationId_callId: {
              generationId: base.generationId,
              callId: start.callId,
            },
          },
        }),
      ).toMatchObject({ inputTokens: 120, outputTokens: 30 })
      expect(
        await prisma.recommendationPrecomputedBuildChoice.count({
          where: { generationId: base.generationId, sourceVideoId },
        }),
      ).toBe(1)
      expect(
        await submit({
          action: "edge_source_finalize",
          ...base,
          sourceVideoId,
          leaseToken: sourceClaim.leaseToken,
          expectedRevision: 1,
          sourceProfileKey: sourceKey,
          sourceCandidateCount: 1,
          sourceCandidateDigest: digest([targetVideoId]),
        }),
      ).toMatchObject({
        sourceState: "complete_edges",
        acceptedCount: 1,
        replay: false,
      })
      const final =
        await prisma.recommendationPrecomputedSource.findUniqueOrThrow({
          where: {
            generationId_sourceVideoId: {
              generationId: base.generationId,
              sourceVideoId,
            },
          },
        })
      expect(final.payload).toMatchObject([
        { targetVideoId, kind: "direct", rank: 1 },
      ])
    })
    it("closes a zero-candidate source without inventing a model call", async () => {
      const base = await build("edge-zero-pool")
      const sourceKey = await readyMetadataProfile(base, sourceVideoId)
      const sourceClaim = await claim(base, sourceVideoId)
      const close = {
        action: "edge_source_close_empty",
        ...base,
        sourceVideoId,
        leaseToken: sourceClaim.leaseToken,
        expectedRevision: sourceClaim.checkpointRevision,
        sourceProfileKey: sourceKey,
        candidatePoolDigest: digest("empty-candidate-pool"),
        sourceCandidateCount: 0,
        sourceCandidateDigest: digest([]),
        historicalRefDigest: digest(["none", sourceVideoId]),
      }
      expect(await submit(close)).toMatchObject({
        sourceState: "complete_empty",
        acceptedCount: 0,
        replay: false,
      })
      expect(await submit(close)).toMatchObject({ replay: true })
      expect(
        await prisma.recommendationPrecomputedEdgeBatchCall.count({
          where: { generationId: base.generationId },
        }),
      ).toBe(0)
      expect(
        await submit({
          action: "edge_batch_status",
          generationId: base.generationId,
          generationInputDigest,
          sourceVideoId,
        }),
      ).toMatchObject({
        sourceCandidateCount: 0,
        sourceCandidateDigest: digest([]),
        calls: [],
      })
    })
    it("journals a malformed result with its real usage and permits a new settled retry", async () => {
      const { base, start } = await reserveOne("edge-rejected")
      const finish = {
        action: "edge_batch_finish",
        ...base,
        callId: start.callId,
        inputDigest: start.inputDigest,
        membershipDigest: start.membershipDigest,
        spanOfferDigest: start.spanOfferDigest,
        status: "succeeded",
        outputDigest: digest([]),
        results: [],
        usage: { inputTokens: 17, outputTokens: 3 },
        finishedAt: new Date().toISOString(),
      }
      expect(await submit(finish)).toMatchObject({
        state: "rejected",
        receiptStored: true,
        members: [{ applicationState: "rejected_unapplied" }],
      })
      expect(await submit(finish)).toMatchObject({ replay: true })
      expect(
        await prisma.recommendationPrecomputedEdgeBatchCall.findUniqueOrThrow({
          where: {
            generationId_callId: {
              generationId: base.generationId,
              callId: start.callId,
            },
          },
        }),
      ).toMatchObject({ inputTokens: 17, outputTokens: 3, status: "rejected" })
      expect(
        await submit({
          ...start,
          callId: randomUUID(),
          startedAt: new Date().toISOString(),
        }),
      ).toMatchObject({ state: "pending", replay: false })
    })
    for (const [name, choices] of [
      [
        "unoffered target",
        [
          {
            targetVideoId: thirdVideoId,
            kind: "direct",
            strength: 50,
            relationship: "A supposed connection",
            reasonEnglish: "This target was never offered to the model call.",
            evidence: { basis: "metadata", fields: ["title"] },
          },
        ],
      ],
      [
        "duplicate target",
        [
          {
            targetVideoId,
            kind: "direct",
            strength: 50,
            relationship: "A supposed connection",
            reasonEnglish: "The first repeated choice has no separate value.",
            evidence: { basis: "metadata", fields: ["title"] },
          },
          {
            targetVideoId,
            kind: "alternative",
            strength: 40,
            relationship: "The same target again",
            reasonEnglish: "The second repeated choice must be rejected too.",
            evidence: { basis: "metadata", fields: ["title"] },
          },
        ],
      ],
      [
        "noncanonical themes metadata",
        [
          {
            targetVideoId,
            kind: "direct",
            strength: 50,
            relationship: "A supposed theme",
            reasonEnglish: "Generated profile themes are not catalog metadata.",
            evidence: { basis: "metadata", fields: ["themes"] },
          },
        ],
      ],
      [
        "unoffered transcript span",
        [
          {
            targetVideoId,
            kind: "direct",
            strength: 50,
            relationship: "An invented passage",
            reasonEnglish: "A copied passage must bind to a reserved offer.",
            evidence: {
              basis: "transcript",
              spanIds: ["f".repeat(32)],
              passages: [
                {
                  chunkId: "unoffered-chunk",
                  excerpt: "A passage not offered",
                },
              ],
            },
          },
        ],
      ],
    ] as const) {
      it(`rejects ${name} with an observed usage receipt`, async () => {
        const { base, start } = await reserveOne(
          `edge-${name.replaceAll(" ", "-")}`,
        )
        const results = [{ sourceVideoId, choices }]
        expect(
          await submit({
            action: "edge_batch_finish",
            ...base,
            callId: start.callId,
            inputDigest: start.inputDigest,
            membershipDigest: start.membershipDigest,
            spanOfferDigest: start.spanOfferDigest,
            status: "succeeded",
            outputDigest: digest(results),
            results,
            usage: { inputTokens: 15, outputTokens: 2 },
            finishedAt: new Date().toISOString(),
          }),
        ).toMatchObject({ state: "rejected", receiptStored: true })
        expect(
          await prisma.recommendationPrecomputedBuildChoice.count({
            where: { generationId: base.generationId, sourceVideoId },
          }),
        ).toBe(0)
      })
    }
    it("keeps an unknown-consumption reservation pending across attempted redispatch", async () => {
      const { base, start } = await reserveOne("edge-unknown")
      await expect(
        submit({
          action: "edge_batch_finish",
          ...base,
          callId: start.callId,
          inputDigest: start.inputDigest,
          membershipDigest: start.membershipDigest,
          spanOfferDigest: start.spanOfferDigest,
          status: "failed",
          errorCode: "provider_unavailable",
          finishedAt: new Date().toISOString(),
        }),
      ).rejects.toThrow("Invalid edge action")
      const status = await submit({
        action: "edge_batch_status",
        generationId: base.generationId,
        generationInputDigest,
        sourceVideoId,
      })
      expect(status).toMatchObject({
        calls: [
          {
            callId: start.callId,
            status: "pending",
            applicationState: "pending",
          },
        ],
      })
      await expect(submit({ ...start, callId: randomUUID() })).rejects.toThrow(
        "pending",
      )
    })
    it("rejects an unreviewed recovery acknowledgement at the database boundary", async () => {
      const { base, start } = await reserveOne("edge-recovery-ddl")
      await expect(
        prisma.recommendationPrecomputedEdgeBatchCall.update({
          where: {
            generationId_callId: {
              generationId: base.generationId,
              callId: start.callId,
            },
          },
          data: {
            recoveryReplacementCallId: randomUUID(),
            recoveryOperatorAccountRef: "edge-account-123",
            recoveryAcknowledgedAt: new Date(),
            recoveryOldProcessExitedAttested: true,
          },
        }),
      ).rejects.toThrow("precomputed_edge_reviewed_recovery_scope_check")
    })
    it("qualifies only the exact acknowledged unknown after a known two-member replacement is applied and closed", async () => {
      const recoveryGenerationId = "subscription-astra-budget2-20261008-v4"
      const originalCallId = "8ab8a620-1608-4115-812e-200bb2fb4b6d"
      const originalAttemptId = "6ef8681b-1607-4ae9-b0b1-c28c41225d6b"
      const replacementCallId = randomUUID()
      const replacementAttemptId = randomUUID()
      const recoveredSources = [
        "cmokmj8ka0njkqsccfvhbto3g",
        "cmokmjc390nk2qscc79tyun6g",
      ]
      await prisma.recommendationPrecomputedGeneration.create({
        data: {
          id: recoveryGenerationId,
          modelId: "gpt-6-astra",
          promptVersion: "recovery-fixture",
          inputDigest:
            "36d168040f404b12e12be8d4ecdf8b75c102fe459bcefb22753f434fe29443b9",
          sourceSetDigest: digest(recoveredSources),
          inputCutoff: new Date(),
          expectedSourceCount: 2,
          protocolVersion: 4,
          executionBackend: "codex_chatgpt_subscription",
        },
      })
      for (const sourceVideoId of recoveredSources) {
        await prisma.video.create({
          data: {
            id: sourceVideoId,
            coreId: `core-${sourceVideoId}`,
            slug: sourceVideoId,
          },
        })
        await prisma.recommendationPrecomputedBuildSource.create({
          data: { generationId: recoveryGenerationId, sourceVideoId },
        })
        await prisma.recommendationPrecomputedContentProfile.create({
          data: {
            generationId: recoveryGenerationId,
            cacheKey: digest(["profile", sourceVideoId]),
            videoId: sourceVideoId,
            modelId: "gpt-6-astra",
            backend: "codex_chatgpt_subscription",
            promptVersion: "recovery-fixture",
            schemaVersion: "recovery-fixture",
            metadataDigest: digest(["metadata", sourceVideoId]),
            chunkDigest: digest(["chunks", sourceVideoId]),
            selectedTranscriptCount: 0,
            selectedChunkCount: 0,
            sourceTextBytes: 0,
            partDigests: [],
            coverageDigest: digest(["coverage", sourceVideoId]),
            kind: "metadata_only",
            state: "ready",
            terminalAt: new Date(),
          },
        })
      }
      for (const [attemptId, endedAt] of [
        [originalAttemptId, new Date(Date.now() - 30_000)],
        [replacementAttemptId, null],
      ] as const)
        await prisma.recommendationPrecomputedExecutionAttempt.create({
          data: {
            generationId: recoveryGenerationId,
            attemptId,
            invocation: "start",
            accountRef: "edge-account-123",
            backend: "codex_chatgpt_subscription",
            billingBasis: "included_subscription",
            authMethod: "chatgpt",
            modelId: "gpt-6-astra",
            identityObservedAt: new Date(),
            allowanceObservedAt: new Date(),
            weeklyRemainingPercent: 50,
            fiveHourKind: "limited",
            fiveHourRemainingPercent: 50,
            startedAt: new Date(Date.now() - 60_000),
            endedAt,
            endReason: endedAt ? "paused" : null,
          },
        })
      const candidatesFor = (sourceVideoId: string) =>
        Array.from({ length: 4 }, (_, poolRank) => ({
          poolRank,
          targetVideoId: `target-${sourceVideoId}-${poolRank}`,
          targetProfileKey: digest([sourceVideoId, poolRank]),
        }))
      const members = recoveredSources.map((sourceVideoId) => {
        const candidates = candidatesFor(sourceVideoId)
        return {
          sourceVideoId,
          leaseToken: randomUUID(),
          checkpointRevision: 1,
          pageIndex: 0,
          sourceProfileKey: digest(["profile", sourceVideoId]),
          candidates,
          candidatePageDigest: digest([
            sourceVideoId,
            0,
            candidates.map((item) => [
              item.poolRank,
              item.targetVideoId,
              item.targetProfileKey,
            ]),
          ]),
          sourceCandidateCount: 4,
          sourceCandidateDigest: digest(["source-candidates", sourceVideoId]),
          historicalRefDigest: digest(["history", sourceVideoId]),
          applicationState: "pending",
        }
      })
      const call = {
        generationId: recoveryGenerationId,
        modelId: "gpt-6-astra",
        backend: "codex_chatgpt_subscription",
        promptVersion: "recovery-fixture",
        schemaVersion: "recovery-fixture",
        membershipDigest:
          "ec3d4b7ffdfad5bd1ef03d68a5577df2aa6b14969191e9de53b9a0ac8d983b72",
        selectedCorpusDigest: digest("selected-corpus"),
        candidatePoolDigest:
          "0780cfd0199c04f88076afcd7869140b56bca02b3253dd5d3c21cd0de4a8797a",
        captureRefDigest:
          "8edf8cce9a1ed5abf1ad847c47dd7f3389a9d1e431f8690ad9b3f0450b3e1cc8",
        spanOfferDigest: digest([]),
        spanOffers: [],
        requestDigest: digest("request"),
        startedAt: new Date(),
        status: "pending",
      }
      await prisma.recommendationPrecomputedEdgeBatchCall.create({
        data: {
          ...call,
          callId: originalCallId,
          attemptId: originalAttemptId,
          inputDigest:
            "d87ad22523187a6e2bdedbb6a948057fddaa9d18f7a1efe8bb3a3224587a8824",
        },
      })
      await prisma.recommendationPrecomputedEdgeBatchMember.createMany({
        data: members.map((member) => ({
          ...member,
          generationId: recoveryGenerationId,
          callId: originalCallId,
        })),
      })
      expect(
        await loadQualifiedManualEdgeRecovery(prisma, recoveryGenerationId),
      ).toMatchObject({ qualifiedAcknowledgedUnknownCount: 0 })
      await prisma.recommendationPrecomputedEdgeBatchCall.update({
        where: {
          generationId_callId: {
            generationId: recoveryGenerationId,
            callId: originalCallId,
          },
        },
        data: {
          recoveryReplacementCallId: replacementCallId,
          recoveryOperatorAccountRef: "edge-account-123",
          recoveryAcknowledgedAt: new Date(),
          recoveryOldProcessExitedAttested: true,
        },
      })
      await prisma.recommendationPrecomputedEdgeBatchMember.updateMany({
        where: { generationId: recoveryGenerationId, callId: originalCallId },
        data: { applicationState: "acknowledged_unknown" },
      })
      await prisma.recommendationPrecomputedEdgeBatchCall.create({
        data: {
          ...call,
          callId: replacementCallId,
          attemptId: replacementAttemptId,
          inputDigest: digest("repaired-envelope"),
        },
      })
      await prisma.recommendationPrecomputedEdgeBatchMember.createMany({
        data: members.map((member) => ({
          ...member,
          generationId: recoveryGenerationId,
          callId: replacementCallId,
          leaseToken: randomUUID(),
        })),
      })
      expect(
        await loadQualifiedManualEdgeRecovery(prisma, recoveryGenerationId),
      ).toMatchObject({ qualifiedAcknowledgedUnknownCount: 0 })
      await prisma.recommendationPrecomputedEdgeBatchCall.update({
        where: {
          generationId_callId: {
            generationId: recoveryGenerationId,
            callId: replacementCallId,
          },
        },
        data: {
          status: "succeeded",
          outputDigest: digest("validated-result"),
          inputTokens: 33_110,
          outputTokens: 1_496,
          finishedAt: new Date(),
          receiptDigest: digest("validated-receipt"),
        },
      })
      await prisma.recommendationPrecomputedEdgeBatchMember.updateMany({
        where: {
          generationId: recoveryGenerationId,
          callId: replacementCallId,
        },
        data: { applicationState: "applied_edges", appliedRevision: 2 },
      })
      await prisma.recommendationPrecomputedExecutionAttempt.update({
        where: {
          generationId_attemptId: {
            generationId: recoveryGenerationId,
            attemptId: replacementAttemptId,
          },
        },
        data: { endedAt: new Date(), endReason: "completed" },
      })
      expect(
        await loadQualifiedManualEdgeRecovery(prisma, recoveryGenerationId),
      ).toMatchObject({
        qualifiedAcknowledgedUnknownCount: 1,
        qualifiedAcknowledgmentDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
      expect(
        await prisma.recommendationPrecomputedEdgeBatchCall.count({
          where: {
            generationId: recoveryGenerationId,
            OR: [{ inputTokens: null }, { outputTokens: null }],
          },
        }),
      ).toBe(1)
      expect(
        await prisma.recommendationPrecomputedEdgeBatchCall.findUniqueOrThrow({
          where: {
            generationId_callId: {
              generationId: recoveryGenerationId,
              callId: originalCallId,
            },
          },
        }),
      ).toMatchObject({
        status: "pending",
        inputTokens: null,
        outputTokens: null,
      })
    })
    it("records known failed invocation usage even when its output envelope is contradictory", async () => {
      const { base, start } = await reserveOne("edge-failed-envelope")
      expect(
        await submit({
          action: "edge_batch_finish",
          ...base,
          callId: start.callId,
          inputDigest: start.inputDigest,
          membershipDigest: start.membershipDigest,
          spanOfferDigest: start.spanOfferDigest,
          status: "failed",
          outputDigest: digest([]),
          errorCode: "provider_unavailable",
          usage: { inputTokens: 19, outputTokens: 0 },
          finishedAt: new Date().toISOString(),
        }),
      ).toMatchObject({
        state: "rejected",
        receiptStored: true,
        members: [{ applicationState: "rejected_unapplied" }],
      })
      expect(
        await prisma.recommendationPrecomputedEdgeBatchCall.findUniqueOrThrow({
          where: {
            generationId_callId: {
              generationId: base.generationId,
              callId: start.callId,
            },
          },
        }),
      ).toMatchObject({ inputTokens: 19, outputTokens: 0, status: "rejected" })
    })
    it("requires every variable-length page and a stable whole-source historical digest", async () => {
      const base = await build("edge-two-pages", [
        sourceVideoId,
        targetVideoId,
        thirdVideoId,
      ])
      const sourceKey = await readyMetadataProfile(base, sourceVideoId)
      const targetKey = await readyMetadataProfile(base, targetVideoId)
      const thirdKey = await readyMetadataProfile(base, thirdVideoId)
      const sourceClaim = await claim(base, sourceVideoId)
      const wholeDigest = digest([targetVideoId, thirdVideoId])
      const historicalRefDigest = digest([
        "qualified-whole-source-history-v1",
        sourceVideoId,
        [targetVideoId, thirdVideoId],
        "source-engagement",
        "definitions-v1",
      ])
      const page = async (
        pageIndex: number,
        target: string,
        targetKey: string,
        checkpointRevision: number,
        choices: unknown[],
      ) => {
        const member = {
          sourceVideoId,
          leaseToken: sourceClaim.leaseToken,
          checkpointRevision,
          pageIndex,
          sourceProfileKey: sourceKey,
          candidates: [
            {
              targetVideoId: target,
              targetProfileKey: targetKey,
              poolRank: pageIndex,
            },
          ],
          candidatePageDigest: digest([
            sourceVideoId,
            pageIndex,
            [[pageIndex, target, targetKey]],
          ]),
          sourceCandidateCount: 2,
          sourceCandidateDigest: wholeDigest,
          historicalRefDigest,
        }
        const { leaseToken: _leaseToken, ...identity } = member
        void _leaseToken
        const start = {
          action: "edge_batch_start",
          ...base,
          callId: randomUUID(),
          modelId: "gpt-6-astra",
          backend: "codex_chatgpt_subscription",
          promptVersion: "edge-v1",
          schemaVersion: "edge-schema-v1",
          inputDigest: digest(["page-specific-history", pageIndex, target]),
          membershipDigest: digest([identity]),
          selectedCorpusDigest: digest("selected-corpus"),
          candidatePoolDigest: digest("candidate-pool"),
          captureRefDigest: null,
          spanOfferDigest: digest([]),
          startedAt: new Date().toISOString(),
          members: [member],
          spanOffers: [],
        }
        await submit(start)
        const results = [{ sourceVideoId, choices }]
        expect(
          await submit({
            action: "edge_batch_finish",
            ...base,
            callId: start.callId,
            inputDigest: start.inputDigest,
            membershipDigest: start.membershipDigest,
            spanOfferDigest: start.spanOfferDigest,
            status: "succeeded",
            outputDigest: digest(results),
            results,
            usage: { inputTokens: 20, outputTokens: 5 },
            finishedAt: new Date().toISOString(),
          }),
        ).toMatchObject({
          state: "succeeded",
          members: [{ appliedRevision: checkpointRevision + 1 }],
        })
      }
      await page(0, targetVideoId, targetKey, 0, [])
      const repeatedMember = {
        sourceVideoId,
        leaseToken: sourceClaim.leaseToken,
        checkpointRevision: 1,
        pageIndex: 1,
        sourceProfileKey: sourceKey,
        candidates: [
          { targetVideoId, targetProfileKey: targetKey, poolRank: 1 },
        ],
        candidatePageDigest: digest([
          sourceVideoId,
          1,
          [[1, targetVideoId, targetKey]],
        ]),
        sourceCandidateCount: 2,
        sourceCandidateDigest: wholeDigest,
        historicalRefDigest,
      }
      const { leaseToken: _repeatedLease, ...repeatedIdentity } = repeatedMember
      void _repeatedLease
      await expect(
        submit({
          action: "edge_batch_start",
          ...base,
          callId: randomUUID(),
          modelId: "gpt-6-astra",
          backend: "codex_chatgpt_subscription",
          promptVersion: "edge-v1",
          schemaVersion: "edge-schema-v1",
          inputDigest: digest("repeat-across-pages"),
          membershipDigest: digest([repeatedIdentity]),
          selectedCorpusDigest: digest("selected-corpus"),
          candidatePoolDigest: digest("candidate-pool"),
          captureRefDigest: null,
          spanOfferDigest: digest([]),
          startedAt: new Date().toISOString(),
          members: [repeatedMember],
          spanOffers: [],
        }),
      ).rejects.toThrow("repeats a prior target")
      await expect(
        submit({
          action: "edge_source_finalize",
          ...base,
          sourceVideoId,
          leaseToken: sourceClaim.leaseToken,
          expectedRevision: 1,
          sourceProfileKey: sourceKey,
          sourceCandidateCount: 2,
          sourceCandidateDigest: wholeDigest,
        }),
      ).rejects.toThrow("incomplete")
      await page(1, thirdVideoId, thirdKey, 1, [
        {
          targetVideoId: thirdVideoId,
          kind: "alternative",
          strength: 66,
          relationship: "An unexpected connection",
          reasonEnglish:
            "The third story explores a related decision in another setting.",
          evidence: { basis: "metadata", fields: ["title"] },
        },
      ])
      expect(
        await submit({
          action: "edge_source_finalize",
          ...base,
          sourceVideoId,
          leaseToken: sourceClaim.leaseToken,
          expectedRevision: 2,
          sourceProfileKey: sourceKey,
          sourceCandidateCount: 2,
          sourceCandidateDigest: wholeDigest,
        }),
      ).toMatchObject({ sourceState: "complete_edges", acceptedCount: 1 })
      const status = await submit({
        action: "edge_batch_status",
        generationId: base.generationId,
        generationInputDigest,
        sourceVideoId,
      })
      expect(status).toMatchObject({
        sourceCandidateCount: 2,
        sourceCandidateDigest: wholeDigest,
        calls: [
          {
            pageIndex: 0,
            applicationState: "applied_empty",
            candidates: [{ poolRank: 0 }],
          },
          {
            pageIndex: 1,
            applicationState: "applied_edges",
            candidates: [{ poolRank: 1 }],
          },
        ],
      })
    })
    it("stores real usage after attempt closure without applying a member", async () => {
      const { base, start } = await reserveOne("edge-closed-attempt")
      const sourceWhere = {
        generationId_sourceVideoId: {
          generationId: base.generationId,
          sourceVideoId,
        },
      }
      const leaseBefore =
        await prisma.recommendationPrecomputedBuildSource.findUniqueOrThrow({
          where: sourceWhere,
        })
      await submit({ action: "attempt_close", ...base, reason: "paused" })
      const leaseAfter =
        await prisma.recommendationPrecomputedBuildSource.findUniqueOrThrow({
          where: sourceWhere,
        })
      expect(leaseAfter.leaseExpiresAt).toEqual(leaseBefore.leaseExpiresAt)
      expect(leaseAfter.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now())
      const results = [{ sourceVideoId, choices: [] }]
      const finish = {
        action: "edge_batch_finish",
        ...base,
        callId: start.callId,
        inputDigest: start.inputDigest,
        membershipDigest: start.membershipDigest,
        spanOfferDigest: start.spanOfferDigest,
        status: "succeeded",
        outputDigest: digest(results),
        results,
        usage: { inputTokens: 31, outputTokens: 4 },
        finishedAt: new Date().toISOString(),
      }
      expect(await submit(finish)).toMatchObject({
        receiptStored: true,
        members: [
          { applicationState: "stale_unapplied", appliedRevision: null },
        ],
      })
      expect(
        await prisma.recommendationPrecomputedEdgeBatchCall.findUniqueOrThrow({
          where: {
            generationId_callId: {
              generationId: base.generationId,
              callId: start.callId,
            },
          },
        }),
      ).toMatchObject({ inputTokens: 31, outputTokens: 4 })
      expect(
        await prisma.recommendationPrecomputedBuildSource.findUniqueOrThrow({
          where: {
            generationId_sourceVideoId: {
              generationId: base.generationId,
              sourceVideoId,
            },
          },
        }),
      ).toMatchObject({ checkpointRevision: 0, state: "claimed" })
      await expect(
        submit({
          action: "edge_source_finalize",
          ...base,
          sourceVideoId,
          leaseToken: start.members[0]!.leaseToken,
          expectedRevision: 0,
          sourceProfileKey: start.members[0]!.sourceProfileKey,
          sourceCandidateCount: 1,
          sourceCandidateDigest: digest([targetVideoId]),
        }),
      ).rejects.toThrow("inactive")
    })
    it("stores usage but not choices after the capacity attestation expires", async () => {
      const { base, start } = await reserveOne("edge-expired-capacity")
      await prisma.$executeRaw`
        UPDATE recommendation_precomputed_generation
        SET capacity_preflight = jsonb_set(
          capacity_preflight, '{measuredAt}',
          to_jsonb(${new Date(Date.now() - 3_600_000).toISOString()}::text)
        )
        WHERE id = ${base.generationId}`
      const results = [{ sourceVideoId, choices: [] }]
      expect(
        await submit({
          action: "edge_batch_finish",
          ...base,
          callId: start.callId,
          inputDigest: start.inputDigest,
          membershipDigest: start.membershipDigest,
          spanOfferDigest: start.spanOfferDigest,
          status: "succeeded",
          outputDigest: digest(results),
          results,
          usage: { inputTokens: 22, outputTokens: 3 },
          finishedAt: new Date().toISOString(),
        }),
      ).toMatchObject({
        receiptStored: true,
        members: [{ applicationState: "stale_unapplied" }],
      })
      expect(
        await prisma.recommendationPrecomputedBuildChoice.count({
          where: { generationId: base.generationId, sourceVideoId },
        }),
      ).toBe(0)
    })
    it("keeps offline comparison queries out of parallel shared memory without changing the connection default", async () => {
      const baseline = await prisma.$queryRaw<[{ value: string }]>`
        SELECT current_setting('max_parallel_workers_per_gather') AS value`
      expect(Number(baseline[0].value)).toBeGreaterThan(0)
      await admin.query(`
        CREATE FUNCTION require_serial_edge_query() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
          IF current_setting('max_parallel_workers_per_gather') <> '0' THEN
            RAISE EXCEPTION 'Offline comparison can allocate parallel shared memory';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER check_edge_query_memory BEFORE INSERT
          ON recommendation_precomputed_edge_batch_call
          FOR EACH ROW EXECUTE FUNCTION require_serial_edge_query();
      `)
      try {
        const { start } = await reserveOne("serial-edge-query")
        expect(await submit(start)).toMatchObject({ replay: true })
        expect(
          await prisma.$queryRaw`SELECT current_setting('max_parallel_workers_per_gather') AS value`,
        ).toEqual(baseline)
      } finally {
        await admin.query(`
          DROP TRIGGER check_edge_query_memory ON recommendation_precomputed_edge_batch_call;
          DROP FUNCTION require_serial_edge_query();
        `)
      }
    })

    it("persists the exact selected Spanish passage selected by a frozen span ID", async () => {
      const languageId = `span-language-${suffix}`
      const muxId = `span-mux-${suffix}`
      await prisma.language.create({
        data: { id: languageId, coreId: languageId, slug: "spanish" },
      })
      await prisma.muxVideo.create({
        data: { id: muxId, playbackId: "fixture-playback" },
      })
      for (const videoId of [sourceVideoId, spanTargetVideoId]) {
        await prisma.videoDub.create({
          data: {
            id: `span-dub-${videoId}`,
            coreId: `span-dub-${videoId}`,
            videoId,
            languageId,
            muxVideoId: muxId,
            published: true,
          },
        })
      }
      const editionId = `edge-span-edition-${suffix}`
      const transcriptId = `edge-span-transcript-${suffix}`
      const chunkId = `edge-span-chunk-${suffix}`
      const text = "La esperanza crece cuando compartimos una historia."
      const excerpt = "compartimos una historia"
      await prisma.videoEdition.create({
        data: { id: editionId, coreId: editionId, name: "Spanish edition" },
      })
      await prisma.videoTranscript.create({
        data: {
          id: transcriptId,
          videoEditionId: editionId,
          videoId: spanTargetVideoId,
          language: "es",
          model: "fixture",
          dimensions: 1536,
          chunkingType: "fixture",
          maxChunkTokens: 100,
          overlapTokens: 0,
          totalChunks: 1,
          totalTokens: 10,
          generatedAt: new Date(),
        },
      })
      await prisma.videoTranscriptChunk.create({
        data: {
          id: chunkId,
          transcriptId,
          language: "es",
          chunkIndex: 0,
          chunkId: "selected-es-0",
          text,
          rawSourceText: text,
          tokenCount: 10,
        },
      })
      const base = await build("edge-span-es", [
        sourceVideoId,
        spanTargetVideoId,
      ])
      const inputCutoff = (
        await prisma.recommendationPrecomputedGeneration.findUniqueOrThrow({
          where: { id: base.generationId },
          select: { inputCutoff: true },
        })
      ).inputCutoff.toISOString()
      async function nativePlan(videoId: string) {
        const video = await readPrecomputedCatalog(
          prisma,
          { action: "video", videoId, cutoff: inputCutoff },
          "Bearer preview-test-key",
        )
        const chunks = await readPrecomputedCatalog(
          prisma,
          { action: "chunks", videoId, cutoff: inputCutoff },
          "Bearer preview-test-key",
        )
        if (
          video.action !== "video" ||
          chunks.action !== "chunks" ||
          chunks.nextCursor
        )
          throw new Error("Invalid fixture")
        return planContentProfile({
          video: video.video,
          chunks: chunks.chunks,
          maxPartBytes: 24_576,
          modelId: "gpt-6-astra",
          backend: "codex_chatgpt_subscription",
          promptVersion: "complete-profile-v6",
          schemaVersion: "profile-schema-v1",
        })
      }
      const sourcePlan = await nativePlan(sourceVideoId)
      const sourceKey = await readyMetadataProfile(
        base,
        sourceVideoId,
        sourcePlan,
      )
      const targetProfile = await readyTranscriptProfile(
        base,
        spanTargetVideoId,
        chunkId,
        transcriptId,
        text,
        excerpt,
        await nativePlan(spanTargetVideoId),
      )
      const sourceClaim = await claim(base, sourceVideoId)
      const verify = (
        generationId = base.generationId,
        cutoff = new Date(inputCutoff),
      ) =>
        prisma.$transaction((tx) =>
          assertPrecomputedProfileVersion(
            tx,
            [sourceVideoId, spanTargetVideoId],
            cutoff,
            generationId,
          ),
        )
      // A hard deletion leaves no later timestamp to find. It must still fail.
      const originalChunk = await prisma.videoTranscriptChunk.findUniqueOrThrow(
        { where: { id: chunkId } },
      )
      await prisma.videoTranscriptChunk.delete({ where: { id: chunkId } })
      await expect(verify()).rejects.toMatchObject({ code: "stale_cutoff" })
      await prisma.videoTranscriptChunk.create({ data: originalChunk })
      // Simulate a sync after the original cutoff without changing profile bytes.
      const changedAt = new Date(new Date(inputCutoff).getTime() + 1_000)
      await prisma.videoTranscriptChunk.update({
        where: { id: chunkId },
        data: { updatedAt: changedAt },
      })
      await expect(verify()).resolves.toBeUndefined()
      await expect(verify("unrelated-generation")).rejects.toMatchObject({
        code: "stale_cutoff",
      })
      await expect(
        verify(
          base.generationId,
          new Date(new Date(inputCutoff).getTime() - 1),
        ),
      ).rejects.toMatchObject({ code: "stale_cutoff" })
      // Same chunk count and same offered excerpt, but changed unseen content.
      await prisma.videoTranscriptChunk.update({
        where: { id: chunkId },
        data: {
          rawSourceText: `${text} Changed elsewhere.`,
          updatedAt: changedAt,
        },
      })
      await expect(verify()).rejects.toMatchObject({ code: "stale_cutoff" })
      await prisma.videoTranscriptChunk.update({
        where: { id: chunkId },
        data: { rawSourceText: text, updatedAt: changedAt },
      })
      await prisma.videoLocale.updateMany({
        where: { videoId: spanTargetVideoId },
        data: { title: "Changed title", updatedAt: changedAt },
      })
      await expect(verify()).rejects.toMatchObject({ code: "stale_cutoff" })
      await prisma.videoLocale.updateMany({
        where: { videoId: spanTargetVideoId },
        data: { title: "Spanish transcript story", updatedAt: changedAt },
      })
      await prisma.video.update({
        where: { id: spanTargetVideoId },
        data: { restrictViewPlatforms: ["watch"], updatedAt: changedAt },
      })
      await expect(verify()).rejects.toMatchObject({ code: "stale_cutoff" })
      await prisma.video.update({
        where: { id: spanTargetVideoId },
        data: { restrictViewPlatforms: [], updatedAt: changedAt },
      })
      await expect(verify()).resolves.toBeUndefined()
      const callId = randomUUID()
      const offer = {
        spanId: digest([
          generationInputDigest,
          inputCutoff,
          callId,
          sourceVideoId,
          spanTargetVideoId,
          spanTargetVideoId,
          chunkId,
          targetProfile.startChar,
          targetProfile.startChar + excerpt.length,
          targetProfile.textSha256,
        ]).slice(0, 32),
        sourceVideoId,
        targetVideoId: spanTargetVideoId,
        videoId: spanTargetVideoId,
        chunkId,
        startChar: targetProfile.startChar,
        endChar: targetProfile.startChar + excerpt.length,
        textSha256: targetProfile.textSha256,
      }
      const member = {
        sourceVideoId,
        leaseToken: sourceClaim.leaseToken,
        checkpointRevision: 0,
        pageIndex: 0,
        sourceProfileKey: sourceKey,
        candidates: [
          {
            targetVideoId: spanTargetVideoId,
            targetProfileKey: targetProfile.cacheKey,
            poolRank: 0,
          },
        ],
        candidatePageDigest: digest([
          sourceVideoId,
          0,
          [[0, spanTargetVideoId, targetProfile.cacheKey]],
        ]),
        sourceCandidateCount: 1,
        sourceCandidateDigest: digest([spanTargetVideoId]),
        historicalRefDigest: digest(["none", sourceVideoId]),
      }
      const { leaseToken: _leaseToken, ...memberIdentity } = member
      void _leaseToken
      const start = {
        action: "edge_batch_start",
        ...base,
        callId,
        modelId: "gpt-6-astra",
        backend: "codex_chatgpt_subscription",
        promptVersion: "edge-v1",
        schemaVersion: "edge-schema-v1",
        inputDigest: digest("span-model-input"),
        membershipDigest: digest([memberIdentity]),
        selectedCorpusDigest: digest("selected-corpus"),
        candidatePoolDigest: digest("candidate-pool"),
        captureRefDigest: null,
        spanOfferDigest: digest([offer]),
        startedAt: new Date().toISOString(),
        members: [member],
        spanOffers: [offer],
      }
      // Eight exact offers from one selected chunk should share the same
      // external database reads rather than repeat its selection aggregate.
      const additionalOffers = Array.from(
        { length: text.length - 8 },
        (_, i) => i + 8,
      )
        .filter((end) => text.slice(0, end) === text.slice(0, end).trim())
        .slice(0, 7)
        .map((endChar) => {
          const textSha256 = createHash("sha256")
            .update(text.slice(0, endChar))
            .digest("hex")
          return {
            ...offer,
            startChar: 0,
            endChar,
            textSha256,
            spanId: digest([
              generationInputDigest,
              inputCutoff,
              callId,
              sourceVideoId,
              spanTargetVideoId,
              spanTargetVideoId,
              chunkId,
              0,
              endChar,
              textSha256,
            ]).slice(0, 32),
          }
        })
      start.spanOffers = [offer, ...additionalOffers]
      start.spanOfferDigest = digest(start.spanOffers)
      // A database read failure must remain an infrastructure error, not an
      // invalid passage. Rename only this disposable fixture's table, then
      // restore it before exercising the exact same valid reservation.
      await admin.query("ALTER TABLE video RENAME TO unavailable_video")
      try {
        await expect(submit(start)).rejects.toMatchObject({ code: "P2021" })
      } finally {
        await admin.query("ALTER TABLE unavailable_video RENAME TO video")
      }
      reservationQueries = []
      await submit(start)
      const selectionQueries = reservationQueries.filter((query) =>
        query.includes("WITH candidates AS"),
      )
      reservationQueries = null
      expect(start.spanOffers).toHaveLength(8)
      expect(selectionQueries).toHaveLength(2)
      const results = [
        {
          sourceVideoId,
          choices: [
            {
              targetVideoId: spanTargetVideoId,
              kind: "direct",
              strength: 81,
              relationship: "A shared theme of hope",
              reasonEnglish:
                "The Spanish passage gives a useful next perspective on hope.",
              evidence: {
                basis: "transcript",
                spanIds: [offer.spanId],
                passages: [{ chunkId, excerpt }],
              },
            },
          ],
        },
      ]
      expect(
        await submit({
          action: "edge_batch_finish",
          ...base,
          callId,
          inputDigest: start.inputDigest,
          membershipDigest: start.membershipDigest,
          spanOfferDigest: start.spanOfferDigest,
          status: "succeeded",
          outputDigest: digest(results),
          results,
          usage: { inputTokens: 40, outputTokens: 9 },
          finishedAt: new Date().toISOString(),
        }),
      ).toMatchObject({
        state: "succeeded",
        members: [{ applicationState: "applied_edges" }],
      })
      await submit({
        action: "edge_source_finalize",
        ...base,
        sourceVideoId,
        leaseToken: sourceClaim.leaseToken,
        expectedRevision: 1,
        sourceProfileKey: sourceKey,
        sourceCandidateCount: 1,
        sourceCandidateDigest: digest([spanTargetVideoId]),
      })
      const final =
        await prisma.recommendationPrecomputedSource.findUniqueOrThrow({
          where: {
            generationId_sourceVideoId: {
              generationId: base.generationId,
              sourceVideoId,
            },
          },
        })
      expect(final.payload).toMatchObject([
        {
          targetVideoId: spanTargetVideoId,
          evidence: {
            basis: "transcript",
            passages: [{ chunkId, excerpt, language: "es" }],
          },
        },
      ])
      await prisma.videoTranscriptChunk.update({
        where: { id: chunkId },
        data: { rawSourceText: "Changed after finalization." },
      })
      expect(
        (
          await prisma.recommendationPrecomputedSource.findUniqueOrThrow({
            where: {
              generationId_sourceVideoId: {
                generationId: base.generationId,
                sourceVideoId,
              },
            },
          })
        ).payload,
      ).toMatchObject([
        {
          evidence: { passages: [{ excerpt }] },
        },
      ])
    })
    it("serializes simultaneous exact starts and immutable terminal receipts", async () => {
      const first = await reserveOne("edge-concurrent-start", false)
      const starts = await Promise.all([
        submit(first.start),
        submit(first.start),
      ])
      expect(starts.map((item) => item.replay).sort()).toEqual([false, true])
      expect(
        await prisma.recommendationPrecomputedEdgeBatchCall.count({
          where: { generationId: first.base.generationId },
        }),
      ).toBe(1)
      const results = [{ sourceVideoId, choices: [] }]
      const finish = {
        action: "edge_batch_finish",
        ...first.base,
        callId: first.start.callId,
        inputDigest: first.start.inputDigest,
        membershipDigest: first.start.membershipDigest,
        spanOfferDigest: first.start.spanOfferDigest,
        status: "succeeded",
        outputDigest: digest(results),
        results,
        usage: { inputTokens: 26, outputTokens: 7 },
        finishedAt: new Date().toISOString(),
      }
      const receipts = await Promise.all([submit(finish), submit(finish)])
      expect(receipts.map((item) => item.replay).sort()).toEqual([false, true])
      expect(receipts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            members: [
              expect.objectContaining({
                applicationState: "applied_empty",
                appliedRevision: 1,
              }),
            ],
          }),
        ]),
      )
      expect(
        await prisma.recommendationPrecomputedEdgeBatchCall.findUniqueOrThrow({
          where: {
            generationId_callId: {
              generationId: first.base.generationId,
              callId: first.start.callId,
            },
          },
        }),
      ).toMatchObject({ inputTokens: 26, outputTokens: 7 })

      const conflictCase = await reserveOne("edge-concurrent-conflict")
      const empty = [{ sourceVideoId, choices: [] }]
      const firstFinish = {
        action: "edge_batch_finish",
        ...conflictCase.base,
        callId: conflictCase.start.callId,
        inputDigest: conflictCase.start.inputDigest,
        membershipDigest: conflictCase.start.membershipDigest,
        spanOfferDigest: conflictCase.start.spanOfferDigest,
        status: "succeeded",
        outputDigest: digest(empty),
        results: empty,
        usage: { inputTokens: 28, outputTokens: 2 },
        finishedAt: new Date().toISOString(),
      }
      const secondFinish = {
        ...firstFinish,
        status: "failed",
        outputDigest: undefined,
        results: undefined,
        errorCode: "provider_unavailable",
        usage: { inputTokens: 29, outputTokens: 0 },
      }
      const competing = await Promise.allSettled([
        submit(firstFinish),
        submit(secondFinish),
      ])
      expect(
        competing.filter((item) => item.status === "fulfilled"),
      ).toHaveLength(1)
      expect(
        competing.filter((item) => item.status === "rejected"),
      ).toHaveLength(1)
      const winner = competing.find(
        (item) => item.status === "fulfilled",
      ) as PromiseFulfilledResult<Record<string, unknown>>
      const storedCall =
        await prisma.recommendationPrecomputedEdgeBatchCall.findUniqueOrThrow({
          where: {
            generationId_callId: {
              generationId: conflictCase.base.generationId,
              callId: conflictCase.start.callId,
            },
          },
          include: { members: true },
        })
      expect(storedCall.inputTokens).toBe(
        winner.value.state === "succeeded" ? 28 : 29,
      )
      expect(storedCall.members[0]!.applicationState).toBe(
        (winner.value.members as Array<{ applicationState: string }>)[0]!
          .applicationState,
      )
    })
    it("counts shared call and member storage, then drains both before source retirement", async () => {
      const { base } = await reserveOne("edge-retirement")
      const report = await loadPrecomputedStorageCapacityReport(prisma, {
        generationId: base.generationId,
      })
      expect(report.selectedGeneration?.inlineTupleBytes).toBeGreaterThan(0)
      expect(
        report.relations.find(
          (item) => item.table === "recommendation_precomputed_edge_batch_call",
        )?.totalBytes,
      ).toBeGreaterThan(0)
      expect(
        report.relations.find(
          (item) =>
            item.table === "recommendation_precomputed_edge_batch_member",
        )?.totalBytes,
      ).toBeGreaterThan(0)
      await prisma.recommendationPrecomputedGeneration.update({
        where: { id: base.generationId },
        data: { status: "cancelled", cancelledAt: new Date() },
      })
      const future = new Date(Date.now() + 100 * 86_400_000)
      const result = await prisma.$transaction((tx) =>
        purgeExpiredPrecomputedGenerations(tx, future, 1),
      )
      expect(result).toMatchObject({
        edgeBatchMembersDeleted: 1,
        edgeBatchCallsDeleted: 1,
        profilesDeleted: 2,
        executionAttemptsDeleted: 1,
        generationsDeleted: 1,
      })
      expect(
        await prisma.recommendationPrecomputedGeneration.findUnique({
          where: { id: base.generationId },
        }),
      ).toBeNull()
    })
  },
)
