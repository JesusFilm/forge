import { createHash, randomUUID } from "node:crypto"
import { PrismaClient, type Prisma } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { currentAdminMigrationSql } from "../current-schema.test-fixture"
import { submitDurablePrecomputedRecommendation } from "./durable-build"
import { purgeExpiredPrecomputedGenerations } from "./generation-retention"
import { loadPrecomputedStorageCapacityReport } from "./storage-capacity"

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "shared edge ledger on native PostgreSQL",
  () => {
    let prisma: PrismaClient
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
    ) {
      const generationId = `${name}-${suffix}`
      const attemptId = randomUUID()
      const base = { generationId, generationInputDigest, attemptId }
      await submit({
        action: "start",
        generationId,
        protocolVersion: 4,
        modelId: "gpt-6-astra",
        promptVersion: "build-v4",
        inputDigest: generationInputDigest,
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
          projectedBytes: 1_000_000,
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
    ) {
      const metadataDigest = digest(["metadata", videoId])
      const chunkDigest = digest(["chunks", "metadata_only"])
      const promptVersion = "complete-profile-v1"
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
    ) {
      const metadataDigest = digest(["metadata", videoId])
      const chunkDigest = digest(["selected-chunk", chunkId, text])
      const partDigests = [digest(["part", chunkId])]
      const promptVersion = "complete-profile-v1"
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
      prisma = new PrismaClient<Prisma.PrismaClientOptions>({
        datasources: { db: { url: url.toString() } },
      })
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
      await submit({ action: "attempt_close", ...base, reason: "paused" })
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
    it("persists the exact selected Spanish passage selected by a frozen span ID", async () => {
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
      const sourceKey = await readyMetadataProfile(base, sourceVideoId)
      const targetProfile = await readyTranscriptProfile(
        base,
        spanTargetVideoId,
        chunkId,
        transcriptId,
        text,
        excerpt,
      )
      const sourceClaim = await claim(base, sourceVideoId)
      const inputCutoff = (
        await prisma.recommendationPrecomputedGeneration.findUniqueOrThrow({
          where: { id: base.generationId },
          select: { inputCutoff: true },
        })
      ).inputCutoff.toISOString()
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
      await submit(start)
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
