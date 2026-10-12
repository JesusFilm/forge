import { createHash, randomUUID } from "node:crypto"
import { PrismaClient, type Prisma } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { currentAdminMigrationSql } from "../current-schema.test-fixture"
import { submitDurablePrecomputedRecommendation } from "./durable-build"
import { purgeExpiredPrecomputedGenerations } from "./generation-retention"

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")
const nodeKey = (
  cacheKey: string,
  stage: string,
  slot: unknown,
  stagePromptVersion: string,
) => digest([cacheKey, stage, slot, stagePromptVersion])

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "content profile ledger on native PostgreSQL",
  () => {
    let prisma: PrismaClient
    let admin: Client
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const schema = `profile_ledger_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const videoId = `source-${suffix}`
    const anchorVideoId = `anchor-source-${suffix}`
    const generationInputDigest = "a".repeat(64)
    const bearer = "Bearer preview-test-key"
    const submit = (input: unknown) =>
      submitDurablePrecomputedRecommendation(prisma, input, bearer)
    const attempt = (
      attemptId: string,
      invocation: "start" | "resume" = "start",
    ) => ({
      attemptId,
      invocation,
      accountRef: "profile-account-123",
      backend: "codex_chatgpt_subscription",
      billingBasis: "included_subscription",
      authMethod: "chatgpt",
      modelId: "gpt-6-astra",
      identityObservedAt: new Date().toISOString(),
      allowanceObservedAt: new Date().toISOString(),
      weeklyRemainingPercent: 50,
      fiveHour: { kind: "limited", remainingPercent: 50 },
    })
    async function build(name: string, sourceId = videoId) {
      const generationId = `${name}-${suffix}`
      const attemptId = randomUUID()
      const base = { generationId, generationInputDigest }
      await submit({
        action: "start",
        generationId,
        protocolVersion: 4,
        modelId: "gpt-6-astra",
        promptVersion: "build-v4",
        inputDigest: generationInputDigest,
        sourceSetDigest: digest([sourceId]),
        inputCutoff: new Date(Date.now() + 60_000).toISOString(),
        expectedSourceCount: 1,
        inputMode: "content_only",
        executionAttempt: attempt(attemptId),
      })
      await submit({
        action: "manifest",
        ...base,
        attemptId,
        sourceVideoIds: [sourceId],
      })
      const probe = await submit({ action: "capacity_probe", ...base })
      await submit({
        action: "capacity",
        ...base,
        attemptId,
        measurement: {
          measuredAt: new Date().toISOString(),
          clusterSystemId: probe.clusterSystemId,
          observedDbBytes: probe.observedDbBytes,
          availableBytes: 20_000_000_000,
          reserveBytes: 5_000_000_000,
          projectedBytes: 1_000_000,
          sampleSourceCount: 1,
          sampleBytes: 100_000,
          source: "operator_verified_pgdata_df",
        },
      })
      return { ...base, attemptId }
    }
    function registration(
      base: {
        generationId: string
        generationInputDigest: string
        attemptId: string
      },
      kind: "transcript" | "metadata_only",
      partDigests: string[],
      sourceId = videoId,
    ) {
      const metadataDigest = digest(["metadata", sourceId])
      const chunkDigest = digest(["chunks", kind])
      const promptVersion = "complete-profile-v1"
      const schemaVersion = "profile-schema-v1"
      const cacheKey = digest({
        revision: "complete-selected-profile-plan-v1",
        videoId: sourceId,
        metadataDigest,
        chunkDigest,
        modelId: "gpt-6-astra",
        backend: "codex_chatgpt_subscription",
        promptVersion,
        schemaVersion,
        partDigests,
      })
      return {
        action: "profile_register",
        ...base,
        cacheKey,
        videoId: sourceId,
        modelId: "gpt-6-astra",
        backend: "codex_chatgpt_subscription",
        promptVersion,
        schemaVersion,
        metadataDigest,
        chunkDigest,
        selectedTranscriptCount: kind === "metadata_only" ? 0 : 1,
        selectedChunkCount: kind === "metadata_only" ? 0 : partDigests.length,
        sourceTextBytes: kind === "metadata_only" ? 0 : 100,
        partDigests,
        coverageDigest: digest([cacheKey, "coverage"]),
        kind,
      }
    }
    const profile = {
      version: "complete_profile_v1",
      summaryEnglish: "A concise account of the selected passage.",
      themes: ["hope"],
      people: [],
      places: [],
      citations: [],
      anchors: [],
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
      await prisma.video.create({
        data: { id: videoId, coreId: `core-${videoId}`, slug: videoId },
      })
      await prisma.videoLocale.create({
        data: {
          videoId,
          locale: "en",
          title: "Profile fixture",
          status: "PUBLISHED",
        },
      })
      await prisma.video.create({
        data: {
          id: anchorVideoId,
          coreId: `core-${anchorVideoId}`,
          slug: anchorVideoId,
        },
      })
      await prisma.videoLocale.create({
        data: {
          videoId: anchorVideoId,
          locale: "en",
          title: "Anchor fixture",
          status: "PUBLISHED",
        },
      })
    }, 120_000)
    afterAll(async () => {
      await prisma?.$disconnect()
      if (admin) {
        await admin.query("ROLLBACK").catch(() => undefined)
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
    })
    it("records a deterministic metadata-only ready profile and keeps v4 unservable", async () => {
      const base = await build("profile-metadata")
      const input = registration(base, "metadata_only", [])
      expect(await submit(input)).toMatchObject({
        state: "ready",
        kind: "metadata_only",
        replay: false,
      })
      expect(await submit(input)).toMatchObject({
        state: "ready",
        replay: true,
      })
      const status = await submit({
        action: "profile_status",
        generationId: base.generationId,
        generationInputDigest,
        cacheKey: input.cacheKey,
      })
      expect(status).toMatchObject({
        profile: { state: "ready", profileJson: null, finalCallId: null },
        calls: [],
      })
      await expect(submit({ action: "complete", ...base })).rejects.toThrow(
        "Profile protocol awaits",
      )
      expect(
        await prisma.recommendationPrecomputedProfileCall.count({
          where: { generationId: base.generationId },
        }),
      ).toBe(0)
    })
    it("reserves each physical map call, records observed usage, and finalizes exact coverage", async () => {
      const base = await build("profile-map")
      const input = registration(base, "transcript", [digest("part-zero")])
      await submit(input)
      const callId = randomUUID()
      const stagePromptVersion = `${input.promptVersion}:map`
      const binding = {
        ...base,
        callId,
        cacheKey: input.cacheKey,
        stage: "map",
        stagePromptVersion,
        nodeKey: nodeKey(input.cacheKey, "map", 0, stagePromptVersion),
        inputDigest: digest("model-input"),
        partIndex: 0,
      }
      const startedAt = new Date().toISOString()
      expect(
        await submit({ action: "profile_call_start", ...binding, startedAt }),
      ).toMatchObject({ state: "pending", replay: false })
      expect(
        await submit({ action: "profile_call_start", ...binding, startedAt }),
      ).toMatchObject({ state: "pending", replay: true })
      const node = {
        profile,
        coveredPartStart: 0,
        coveredPartEnd: 1,
        childNodeDigests: [],
      }
      const finish = {
        action: "profile_call_finish",
        ...binding,
        status: "succeeded",
        outputDigest: digest(node),
        node,
        usage: { inputTokens: 27, outputTokens: 4 },
        finishedAt: new Date().toISOString(),
      }
      expect(await submit(finish)).toMatchObject({
        state: "succeeded",
        receiptStored: true,
        nodeApplied: true,
        replay: false,
      })
      expect(await submit(finish)).toMatchObject({
        state: "succeeded",
        receiptStored: true,
        replay: true,
      })
      const status = await submit({
        action: "profile_status",
        generationId: base.generationId,
        generationInputDigest,
        cacheKey: input.cacheKey,
      })
      expect(status).toMatchObject({
        profile: { state: "in_progress" },
        calls: [{ callId, status: "succeeded", node }],
      })
      const accepted = (
        status as { calls: Array<{ node: unknown; outputDigest: string }> }
      ).calls[0]!
      expect(digest(accepted.node)).toBe(accepted.outputDigest)
      const finalize = {
        action: "profile_finalize",
        ...base,
        cacheKey: input.cacheKey,
        finalCallId: callId,
        coverageDigest: input.coverageDigest,
        expectedNodeDigests: [digest(node)],
      }
      expect(await submit(finalize)).toMatchObject({
        state: "ready",
        profileJson: profile,
      })
      expect(await submit(finalize)).toMatchObject({
        state: "ready",
        replay: true,
      })
      await expect(
        submit({ ...finalize, expectedNodeDigests: [digest("different")] }),
      ).rejects.toThrow("finalization retry differs")
      expect(
        await prisma.recommendationPrecomputedProfileCall.findUniqueOrThrow({
          where: {
            generationId_callId: { generationId: base.generationId, callId },
          },
        }),
      ).toMatchObject({
        inputTokens: 27,
        outputTokens: 4,
        cachedInputTokens: null,
      })
    })
    it("retains observed usage when JSONB expands a valid near-limit compact node", async () => {
      const base = await build("profile-jsonb-boundary")
      const input = registration(base, "transcript", [digest("part-zero")])
      await submit(input)
      const callId = randomUUID()
      const stagePromptVersion = `${input.promptVersion}:map`
      const binding = {
        ...base,
        callId,
        cacheKey: input.cacheKey,
        stage: "map",
        stagePromptVersion,
        nodeKey: nodeKey(input.cacheKey, "map", 0, stagePromptVersion),
        inputDigest: digest("boundary-prompt"),
        partIndex: 0,
      }
      await submit({
        action: "profile_call_start",
        ...binding,
        startedAt: new Date().toISOString(),
      })
      const node = {
        profile: {
          version: "complete_profile_v1",
          summaryEnglish: "S".repeat(600),
          themes: Array(12).fill("T".repeat(80)),
          people: Array(3).fill("P".repeat(80)),
          places: [],
          citations: [],
          anchors: [],
        },
        coveredPartStart: 0,
        coveredPartEnd: 1,
        childNodeDigests: [],
      }
      expect(
        Buffer.byteLength(JSON.stringify(node), "utf8"),
      ).toBeLessThanOrEqual(2048)
      expect(
        await submit({
          action: "profile_call_finish",
          ...binding,
          status: "succeeded",
          outputDigest: digest(node),
          node,
          usage: { inputTokens: 33, outputTokens: 6 },
          finishedAt: new Date().toISOString(),
        }),
      ).toMatchObject({ receiptStored: true, nodeApplied: true })
      const [stored] = await prisma.$queryRaw<Array<{ bytes: number }>>`
        SELECT octet_length(node_json::text)::integer AS bytes
        FROM recommendation_precomputed_profile_call
        WHERE generation_id = ${base.generationId} AND call_id = ${callId}::uuid`
      expect(stored!.bytes).toBeGreaterThan(2048)
      expect(
        await submit({
          action: "profile_finalize",
          ...base,
          cacheKey: input.cacheKey,
          finalCallId: callId,
          coverageDigest: input.coverageDigest,
          expectedNodeDigests: [digest(node)],
        }),
      ).toMatchObject({ state: "ready" })
    })
    it("validates a passage anchor against the selected frozen chunk", async () => {
      const editionId = `anchor-edition-${suffix}`
      const transcriptId = `anchor-transcript-${suffix}`
      const chunkId = `anchor-chunk-${suffix}`
      const text = "Faith grows as people share a story of hope."
      await prisma.videoEdition.create({
        data: { id: editionId, coreId: editionId, name: "Anchor edition" },
      })
      await prisma.videoTranscript.create({
        data: {
          id: transcriptId,
          videoEditionId: editionId,
          videoId: anchorVideoId,
          language: "en",
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
          language: "en",
          chunkIndex: 0,
          chunkId: "selected-0",
          text,
          rawSourceText: text,
          tokenCount: 10,
        },
      })
      const base = await build("profile-anchor", anchorVideoId)
      const input = registration(
        base,
        "transcript",
        [digest("part-zero")],
        anchorVideoId,
      )
      await submit(input)
      const callId = randomUUID()
      const stagePromptVersion = `${input.promptVersion}:map`
      const binding = {
        ...base,
        callId,
        cacheKey: input.cacheKey,
        stage: "map",
        stagePromptVersion,
        nodeKey: nodeKey(input.cacheKey, "map", 0, stagePromptVersion),
        inputDigest: digest("anchor-prompt"),
        partIndex: 0,
      }
      await submit({
        action: "profile_call_start",
        ...binding,
        startedAt: new Date().toISOString(),
      })
      const excerpt = "share a story of hope"
      const startChar = text.indexOf(excerpt)
      const node = {
        profile: {
          ...profile,
          anchors: [
            {
              videoId: anchorVideoId,
              chunkId,
              transcriptId,
              language: "en",
              chunkIndex: 0,
              startChar,
              endChar: startChar + excerpt.length,
              textSha256: createHash("sha256").update(excerpt).digest("hex"),
              claimEnglish: "Sharing this story brings hope.",
            },
          ],
        },
        coveredPartStart: 0,
        coveredPartEnd: 1,
        childNodeDigests: [],
      }
      expect(
        await submit({
          action: "profile_call_finish",
          ...binding,
          status: "succeeded",
          outputDigest: digest(node),
          node,
          usage: { inputTokens: 20, outputTokens: 3 },
          finishedAt: new Date().toISOString(),
        }),
      ).toMatchObject({ state: "succeeded", nodeApplied: true })
      expect(
        await submit({
          action: "profile_finalize",
          ...base,
          cacheKey: input.cacheKey,
          finalCallId: callId,
          coverageDigest: input.coverageDigest,
          expectedNodeDigests: [digest(node)],
        }),
      ).toMatchObject({ state: "ready" })
      const metadataBuild = await build(
        "profile-anchor-metadata",
        anchorVideoId,
      )
      expect(
        await submit(
          registration(metadataBuild, "metadata_only", [], anchorVideoId),
        ),
      ).toMatchObject({ state: "invalid", kind: "metadata_only" })
    })

    it("stores malformed output with its observed tokens and refuses a new call", async () => {
      const base = await build("profile-rejected")
      const input = registration(base, "transcript", [digest("part-zero")])
      await submit(input)
      const callId = randomUUID()
      const stagePromptVersion = `${input.promptVersion}:map`
      const binding = {
        ...base,
        callId,
        cacheKey: input.cacheKey,
        stage: "map",
        stagePromptVersion,
        nodeKey: nodeKey(input.cacheKey, "map", 0, stagePromptVersion),
        inputDigest: digest("model-input"),
        partIndex: 0,
      }
      await submit({
        action: "profile_call_start",
        ...binding,
        startedAt: new Date().toISOString(),
      })
      const malformed = {
        profile: {
          ...profile,
          anchors: [
            {
              videoId,
              chunkId: "missing",
              transcriptId: "missing",
              language: "en",
              chunkIndex: 0,
              startChar: 0,
              endChar: 10,
              textSha256: digest("missing"),
              claimEnglish: "This anchor is unsupported.",
            },
          ],
        },
        coveredPartStart: 0,
        coveredPartEnd: 1,
        childNodeDigests: [],
      }
      expect(
        await submit({
          action: "profile_call_finish",
          ...binding,
          status: "succeeded",
          outputDigest: digest(malformed),
          node: malformed,
          usage: { inputTokens: 19, outputTokens: 2, cachedInputTokens: 0 },
          finishedAt: new Date().toISOString(),
        }),
      ).toMatchObject({
        state: "rejected",
        receiptStored: true,
        nodeApplied: false,
      })
      expect(
        await prisma.recommendationPrecomputedContentProfile.findUniqueOrThrow({
          where: {
            generationId_cacheKey: {
              generationId: base.generationId,
              cacheKey: input.cacheKey,
            },
          },
        }),
      ).toMatchObject({
        state: "rejected",
        failureCode: "profile_anchor_invalid",
      })
      await expect(
        submit({
          action: "profile_call_start",
          ...binding,
          callId: randomUUID(),
          startedAt: new Date().toISOString(),
        }),
      ).rejects.toThrow("terminal")
    })
    it("accepts only a contiguous reduction tree spanning all selected parts", async () => {
      const base = await build("profile-reduce")
      const input = registration(base, "transcript", [
        digest("part-zero"),
        digest("part-one"),
      ])
      await submit(input)
      const mapPrompt = `${input.promptVersion}:map`
      const childIds: string[] = []
      const childDigests: string[] = []
      for (let partIndex = 0; partIndex < 2; partIndex++) {
        const callId = randomUUID()
        const binding = {
          ...base,
          callId,
          cacheKey: input.cacheKey,
          stage: "map",
          stagePromptVersion: mapPrompt,
          nodeKey: nodeKey(input.cacheKey, "map", partIndex, mapPrompt),
          inputDigest: digest(["map", partIndex]),
          partIndex,
        }
        await submit({
          action: "profile_call_start",
          ...binding,
          startedAt: new Date().toISOString(),
        })
        const node = {
          profile,
          coveredPartStart: partIndex,
          coveredPartEnd: partIndex + 1,
          childNodeDigests: [],
        }
        expect(
          await submit({
            action: "profile_call_finish",
            ...binding,
            status: "succeeded",
            outputDigest: digest(node),
            node,
            usage: { inputTokens: 10, outputTokens: 1 },
            finishedAt: new Date().toISOString(),
          }),
        ).toMatchObject({ nodeApplied: true })
        childIds.push(callId)
        childDigests.push(digest(node))
      }
      const callId = randomUUID()
      const reducePrompt = `${input.promptVersion}:reduce`
      const binding = {
        ...base,
        callId,
        cacheKey: input.cacheKey,
        stage: "reduce",
        stagePromptVersion: reducePrompt,
        nodeKey: nodeKey(input.cacheKey, "reduce", childDigests, reducePrompt),
        inputDigest: digest("reduce-model-input"),
        childCallIds: childIds,
      }
      await submit({
        action: "profile_call_start",
        ...binding,
        startedAt: new Date().toISOString(),
      })
      const node = {
        profile,
        coveredPartStart: 0,
        coveredPartEnd: 2,
        childNodeDigests: childDigests,
      }
      expect(
        await submit({
          action: "profile_call_finish",
          ...binding,
          status: "succeeded",
          outputDigest: digest(node),
          node,
          usage: { inputTokens: 15, outputTokens: 2 },
          finishedAt: new Date().toISOString(),
        }),
      ).toMatchObject({ nodeApplied: true })
      expect(
        await submit({
          action: "profile_finalize",
          ...base,
          cacheKey: input.cacheKey,
          finalCallId: callId,
          coverageDigest: input.coverageDigest,
          expectedNodeDigests: [...childDigests, digest(node)],
        }),
      ).toMatchObject({ state: "ready" })
      const report = await prisma.recommendationPrecomputedProfileCall.count({
        where: { generationId: base.generationId, status: "succeeded" },
      })
      expect(report).toBe(3)
    })
    it("retains late usage after attempt close without applying the node", async () => {
      const base = await build("profile-late")
      const input = registration(base, "transcript", [
        digest("part-zero"),
        digest("part-one"),
      ])
      await submit(input)
      const callId = randomUUID()
      const stagePromptVersion = `${input.promptVersion}:map`
      const binding = {
        ...base,
        callId,
        cacheKey: input.cacheKey,
        stage: "map",
        stagePromptVersion,
        nodeKey: nodeKey(input.cacheKey, "map", 0, stagePromptVersion),
        inputDigest: digest("model-input"),
        partIndex: 0,
      }
      await submit({
        action: "profile_call_start",
        ...binding,
        startedAt: new Date().toISOString(),
      })
      await submit({ action: "attempt_close", ...base, reason: "paused" })
      const node = {
        profile,
        coveredPartStart: 0,
        coveredPartEnd: 1,
        childNodeDigests: [],
      }
      const finish = {
        action: "profile_call_finish",
        ...binding,
        status: "succeeded",
        outputDigest: digest(node),
        node,
        usage: { inputTokens: 12, outputTokens: 1 },
        finishedAt: new Date().toISOString(),
      }
      expect(await submit(finish)).toMatchObject({
        receiptStored: true,
        nodeApplied: false,
      })
      expect(
        await submit({
          action: "profile_status",
          generationId: base.generationId,
          generationInputDigest,
          cacheKey: input.cacheKey,
        }),
      ).toMatchObject({
        calls: [{ callId, status: "succeeded", nodeApplied: false }],
      })
      expect(
        await prisma.recommendationPrecomputedContentProfile.findUniqueOrThrow({
          where: {
            generationId_cacheKey: {
              generationId: base.generationId,
              cacheKey: input.cacheKey,
            },
          },
        }),
      ).toMatchObject({ state: "blocked_unknown", finalCallId: null })
      await expect(
        submit({
          action: "profile_finalize",
          ...base,
          cacheKey: input.cacheKey,
          finalCallId: callId,
          coverageDigest: input.coverageDigest,
          expectedNodeDigests: [digest(node)],
        }),
      ).rejects.toThrow("inactive")
      const resumedAttemptId = randomUUID()
      await submit({
        action: "resume_attempt",
        generationId: base.generationId,
        generationInputDigest,
        executionAttempt: attempt(resumedAttemptId, "resume"),
      })
      await expect(
        submit({
          action: "profile_finalize",
          ...base,
          attemptId: resumedAttemptId,
          cacheKey: input.cacheKey,
          finalCallId: callId,
          coverageDigest: input.coverageDigest,
          expectedNodeDigests: [digest(node)],
        }),
      ).rejects.toThrow("Unapplied profile receipt")
      const secondCallId = randomUUID()
      const secondBinding = {
        ...base,
        attemptId: resumedAttemptId,
        callId: secondCallId,
        cacheKey: input.cacheKey,
        stage: "map",
        stagePromptVersion,
        nodeKey: nodeKey(input.cacheKey, "map", 1, stagePromptVersion),
        inputDigest: digest("second-model-input"),
        partIndex: 1,
      }
      await submit({
        action: "profile_call_start",
        ...secondBinding,
        startedAt: new Date().toISOString(),
      })
      const secondNode = {
        profile,
        coveredPartStart: 1,
        coveredPartEnd: 2,
        childNodeDigests: [],
      }
      expect(
        await submit({
          action: "profile_call_finish",
          ...secondBinding,
          status: "succeeded",
          outputDigest: digest(secondNode),
          node: secondNode,
          usage: { inputTokens: 11, outputTokens: 2 },
          finishedAt: new Date().toISOString(),
        }),
      ).toMatchObject({ nodeApplied: true })
      const reducePrompt = `${input.promptVersion}:reduce`
      await expect(
        submit({
          action: "profile_call_start",
          ...base,
          attemptId: resumedAttemptId,
          callId: randomUUID(),
          cacheKey: input.cacheKey,
          stage: "reduce",
          stagePromptVersion: reducePrompt,
          nodeKey: nodeKey(
            input.cacheKey,
            "reduce",
            [digest(node), digest(secondNode)],
            reducePrompt,
          ),
          inputDigest: digest("reduce-model-input"),
          childCallIds: [callId, secondCallId],
          startedAt: new Date().toISOString(),
        }),
      ).rejects.toThrow("Reduce children")
      expect(await submit(finish)).toMatchObject({
        receiptStored: true,
        nodeApplied: false,
        replay: true,
      })
    })
    it("records observed usage without applying a node after capacity expires", async () => {
      const base = await build("profile-expired-capacity")
      const input = registration(base, "transcript", [digest("part-zero")])
      await submit(input)
      const stagePromptVersion = `${input.promptVersion}:map`
      const binding = {
        ...base,
        callId: randomUUID(),
        cacheKey: input.cacheKey,
        stage: "map",
        stagePromptVersion,
        nodeKey: nodeKey(input.cacheKey, "map", 0, stagePromptVersion),
        inputDigest: digest("capacity-model-input"),
        partIndex: 0,
      }
      await submit({
        action: "profile_call_start",
        ...binding,
        startedAt: new Date().toISOString(),
      })
      await prisma.$executeRaw`
        UPDATE recommendation_precomputed_generation
        SET capacity_preflight = jsonb_set(
          capacity_preflight, '{measuredAt}',
          to_jsonb(${new Date(Date.now() - 3_600_000).toISOString()}::text)
        )
        WHERE id = ${base.generationId}`
      const node = {
        profile,
        coveredPartStart: 0,
        coveredPartEnd: 1,
        childNodeDigests: [],
      }
      expect(
        await submit({
          action: "profile_call_finish",
          ...binding,
          status: "succeeded",
          outputDigest: digest(node),
          node,
          usage: { inputTokens: 12, outputTokens: 1 },
          finishedAt: new Date().toISOString(),
        }),
      ).toMatchObject({ receiptStored: true, nodeApplied: false })
      expect(
        await prisma.recommendationPrecomputedContentProfile.findUniqueOrThrow({
          where: {
            generationId_cacheKey: {
              generationId: base.generationId,
              cacheKey: input.cacheKey,
            },
          },
        }),
      ).toMatchObject({ state: "blocked_unknown", finalCallId: null })
    })
    it("keeps an unknown pending invocation fenced across a manual resume", async () => {
      const base = await build("profile-unknown")
      const input = registration(base, "transcript", [digest("part-zero")])
      await submit(input)
      const stagePromptVersion = `${input.promptVersion}:map`
      const pending = {
        ...base,
        callId: randomUUID(),
        cacheKey: input.cacheKey,
        stage: "map",
        stagePromptVersion,
        nodeKey: nodeKey(input.cacheKey, "map", 0, stagePromptVersion),
        inputDigest: digest("first-model-input"),
        partIndex: 0,
      }
      await submit({
        action: "profile_call_start",
        ...pending,
        startedAt: new Date().toISOString(),
      })
      const resumedAttemptId = randomUUID()
      await submit({
        action: "resume_attempt",
        generationId: base.generationId,
        generationInputDigest,
        executionAttempt: attempt(resumedAttemptId, "resume"),
      })
      const status = await submit({
        action: "profile_status",
        generationId: base.generationId,
        generationInputDigest,
        cacheKey: input.cacheKey,
      })
      expect(status).toMatchObject({
        profile: { state: "blocked_unknown" },
        calls: [
          {
            callId: pending.callId,
            nodeKey: pending.nodeKey,
            status: "pending",
            node: null,
          },
        ],
      })
      await expect(
        submit({
          action: "profile_call_start",
          ...pending,
          attemptId: resumedAttemptId,
          callId: randomUUID(),
          startedAt: new Date().toISOString(),
        }),
      ).rejects.toThrow("Unresolved profile call")
    })
    it("drains profile calls before profiles and attempts during generation retirement", async () => {
      const base = await build("profile-retire")
      const input = registration(base, "transcript", [digest("part-zero")])
      await submit(input)
      const stagePromptVersion = `${input.promptVersion}:map`
      await submit({
        action: "profile_call_start",
        ...base,
        callId: randomUUID(),
        cacheKey: input.cacheKey,
        stage: "map",
        stagePromptVersion,
        nodeKey: nodeKey(input.cacheKey, "map", 0, stagePromptVersion),
        inputDigest: digest("pending-input"),
        partIndex: 0,
        startedAt: new Date().toISOString(),
      })
      await prisma.recommendationPrecomputedGeneration.update({
        where: { id: base.generationId },
        data: { status: "cancelled", cancelledAt: new Date() },
      })
      const future = new Date(Date.now() + 100 * 86_400_000)
      const result = await prisma.$transaction((tx) =>
        purgeExpiredPrecomputedGenerations(tx, future, 1),
      )
      expect(result).toMatchObject({
        profileCallsDeleted: 1,
        profilesDeleted: 1,
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
