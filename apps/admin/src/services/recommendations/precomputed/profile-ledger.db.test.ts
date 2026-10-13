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
    it.each(["succeeded", "rejected"])(
      "manually replaces one known rejected map (%s) without rewriting receipts",
      async (outcome) => {
        const oldBase = await build(
          outcome === "succeeded"
            ? "漢".repeat(150)
            : "profile-manual-replacement-failure",
        )
        const input = registration(
          oldBase,
          "transcript",
          Array.from({ length: 6 }, (_, i) => digest(`part-${i}`)),
        )
        await submit(input)
        const bindings = Array.from({ length: 6 }, (_, partIndex) => ({
          ...oldBase,
          cacheKey: input.cacheKey,
          callId: randomUUID(),
          stage: "map",
          stagePromptVersion: `${input.promptVersion}:map`,
          partIndex,
          nodeKey: nodeKey(
            input.cacheKey,
            "map",
            partIndex,
            `${input.promptVersion}:map`,
          ),
          inputDigest: digest(`prompt-${partIndex}`),
        }))
        const nodeFor = (partIndex: number) => ({
          profile,
          coveredPartStart: partIndex,
          coveredPartEnd: partIndex + 1,
          childNodeDigests: [],
        })
        for (const binding of bindings.slice(0, 4)) {
          await submit({
            action: "profile_call_start",
            ...binding,
            startedAt: new Date().toISOString(),
          })
          const rejected = binding.partIndex === 3
          await submit({
            action: "profile_call_finish",
            ...binding,
            status: rejected ? "rejected" : "succeeded",
            ...(rejected
              ? { errorCode: "profile_map_anchor_invalid" }
              : {
                  node: nodeFor(binding.partIndex),
                  outputDigest: digest(nodeFor(binding.partIndex)),
                }),
            usage: { inputTokens: 33, outputTokens: 6 },
            finishedAt: new Date().toISOString(),
          })
        }
        const original =
          await prisma.recommendationPrecomputedProfileCall.findUniqueOrThrow({
            where: {
              generationId_callId: {
                generationId: oldBase.generationId,
                callId: bindings[3]!.callId,
              },
            },
          })
        const accepted =
          await prisma.recommendationPrecomputedProfileCall.findMany({
            where: { generationId: oldBase.generationId, status: "succeeded" },
            orderBy: { callId: "asc" },
          })
        const base = { ...oldBase, attemptId: randomUUID() }
        await submit({
          action: "resume_attempt",
          generationId: base.generationId,
          generationInputDigest,
          executionAttempt: attempt(base.attemptId, "resume"),
        })
        const replacement = {
          ...bindings[3]!,
          attemptId: base.attemptId,
          callId: randomUUID(),
        }
        const request = {
          action: "profile_manual_replacement_start",
          ...replacement,
          originalCallId: original.callId,
          originalReceiptDigest: original.receiptDigest,
          coverageDigest: input.coverageDigest,
          oldProcessExitedAttested: true,
          startedAt: new Date().toISOString(),
        }
        await expect(
          submit({ ...request, oldProcessExitedAttested: false }),
        ).rejects.toThrow()
        await expect(
          submit({ ...request, inputDigest: digest("changed-prompt") }),
        ).rejects.toThrow()
        for (const invalid of [
          { originalCallId: randomUUID() },
          { originalReceiptDigest: "c".repeat(64) },
          { attemptId: oldBase.attemptId },
          { partIndex: 2 },
          { stage: "reduce" },
          { coverageDigest: "d".repeat(64) },
          { nodeKey: "e".repeat(64) },
          { stagePromptVersion: "changed:map" },
          { operatorAccountRef: "caller-forged-actor" },
        ])
          await expect(submit({ ...request, ...invalid })).rejects.toThrow()
        const budget = async () =>
          (
            await prisma.$queryRaw<
              Array<{ bytes: bigint }>
            >`SELECT consumed_bytes AS bytes FROM recommendation_precomputed_build_budget WHERE generation_id = ${base.generationId}`
          )[0]!.bytes
        const beforeBudget = await budget()
        const newActor =
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
              attemptId: base.attemptId,
            },
          },
          data: { accountRef: "different-account" },
        })
        await expect(submit(request)).rejects.toThrow(
          "matching operator resume",
        )
        await prisma.recommendationPrecomputedExecutionAttempt.update({
          where: {
            generationId_attemptId: {
              generationId: base.generationId,
              attemptId: base.attemptId,
            },
          },
          data: {
            accountRef: newActor.accountRef,
            startedAt: new Date(original.finishedAt!.getTime() - 1),
          },
        })
        await expect(submit(request)).rejects.toThrow(
          "matching operator resume",
        )
        await prisma.recommendationPrecomputedExecutionAttempt.update({
          where: {
            generationId_attemptId: {
              generationId: base.generationId,
              attemptId: base.attemptId,
            },
          },
          data: { startedAt: newActor.startedAt },
        })
        await prisma.$executeRaw`UPDATE recommendation_precomputed_generation SET capacity_preflight = jsonb_set(capacity_preflight, '{measuredAt}', to_jsonb(${new Date(Date.now() - 31 * 60000).toISOString()}::text)) WHERE id = ${base.generationId}`
        await expect(submit(request)).rejects.toThrow()
        await prisma.$executeRaw`UPDATE recommendation_precomputed_generation SET capacity_preflight = jsonb_set(capacity_preflight, '{measuredAt}', to_jsonb(${new Date().toISOString()}::text)) WHERE id = ${base.generationId}`
        const pendingId = randomUUID()
        await prisma.recommendationPrecomputedProfileCall.create({
          data: {
            generationId: base.generationId,
            cacheKey: input.cacheKey,
            attemptId: base.attemptId,
            callId: pendingId,
            stage: "map",
            stagePromptVersion: `${input.promptVersion}:map`,
            nodeKey: digest("pending-other-node"),
            inputDigest: digest("pending-input"),
            partIndex: 5,
            startedAt: new Date(),
            status: "pending",
          },
        })
        await expect(submit(request)).rejects.toThrow(
          "Unknown generation consumption",
        )
        await prisma.recommendationPrecomputedProfileCall.delete({
          where: {
            generationId_callId: {
              generationId: base.generationId,
              callId: pendingId,
            },
          },
        })
        for (const attemptId of [null, base.attemptId]) {
          const unknownId = randomUUID()
          await prisma.recommendationPrecomputedModelCall.create({
            data: {
              generationId: base.generationId,
              callId: unknownId,
              sourceVideoId: videoId,
              stage: "source_summary",
              status: "failed",
              modelId: "gpt-6-astra",
              inputDigest: digest("unknown-consumption"),
              attemptId,
              errorCode: "provider_unavailable",
              startedAt: new Date(),
              finishedAt: new Date(),
            },
          })
          await expect(submit(request)).rejects.toThrow(
            "Unknown generation consumption",
          )
          await prisma.recommendationPrecomputedModelCall.delete({
            where: {
              generationId_callId: {
                generationId: base.generationId,
                callId: unknownId,
              },
            },
          })
        }
        const overflow = Array.from({ length: 123 }, (_, i) => ({
          generationId: base.generationId,
          cacheKey: input.cacheKey,
          attemptId: base.attemptId,
          callId: randomUUID(),
          stage: "map",
          stagePromptVersion: `${input.promptVersion}:map`,
          nodeKey: digest(["overflow", i]),
          inputDigest: digest(["overflow-input", i]),
          partIndex: 5,
          startedAt: new Date(),
          finishedAt: new Date(),
          status: "rejected",
          inputTokens: 1,
          outputTokens: 0,
          receiptDigest: digest(["overflow-receipt", i]),
          receiptNodeApplied: false,
          errorCode: "profile_map_anchor_invalid",
        }))
        await prisma.recommendationPrecomputedProfileCall.createMany({
          data: overflow,
        })
        await expect(submit(request)).rejects.toThrow("Profile call limit")
        await prisma.recommendationPrecomputedProfileCall.deleteMany({
          where: {
            generationId: base.generationId,
            callId: { in: overflow.map((row) => row.callId) },
          },
        })
        expect(await budget()).toBe(beforeBudget)
        await prisma.$executeRaw`UPDATE recommendation_precomputed_generation SET capacity_preflight = jsonb_set(capacity_preflight, '{projectedBytes}', to_jsonb(${beforeBudget + 5120n}::bigint)) WHERE id = ${base.generationId}`
        await expect(submit(request)).rejects.toMatchObject({
          code: "capacity_budget_exceeded",
        })
        expect(await budget()).toBe(beforeBudget)
        expect(
          await prisma.recommendationPrecomputedProfileCall.count({
            where: { generationId: base.generationId, status: "pending" },
          }),
        ).toBe(0)
        expect(
          (
            await prisma.$queryRaw<
              Array<{ count: bigint }>
            >`SELECT count(*) AS count FROM recommendation_precomputed_profile_manual_replacement WHERE generation_id = ${base.generationId}`
          )[0]!.count,
        ).toBe(0n)
        await prisma.$executeRaw`UPDATE recommendation_precomputed_generation SET capacity_preflight = jsonb_set(capacity_preflight, '{projectedBytes}', '1000000'::jsonb) WHERE id = ${base.generationId}`
        const initial = await Promise.all([submit(request), submit(request)])
        expect(initial.map((row) => row.replay).sort()).toEqual([false, true])

        const authorizationRecord = {
          generationId: base.generationId,
          cacheKey: input.cacheKey,
          originalCallId: original.callId,
          replacementCallId: replacement.callId,
          originalReceiptDigest: original.receiptDigest,
          attemptId: base.attemptId,
          accountRef: "profile-account-123",
        }
        if (outcome === "succeeded")
          expect(
            Buffer.byteLength(JSON.stringify(authorizationRecord), "utf8") +
              256,
          ).toBeGreaterThan(1024)
        expect(await budget()).toBe(
          beforeBudget +
            BigInt(
              5120 +
                Buffer.byteLength(JSON.stringify(authorizationRecord), "utf8") +
                256,
            ),
        )
        await expect(
          prisma.$executeRaw`UPDATE recommendation_precomputed_profile_manual_replacement SET account_ref = 'forged-account' WHERE generation_id = ${base.generationId}`,
        ).rejects.toThrow("immutable")
        const duplicate = await Promise.all([submit(request), submit(request)])
        expect(duplicate).toMatchObject([{ replay: true }, { replay: true }])
        expect(await budget()).toBe(
          beforeBudget +
            BigInt(
              5120 +
                Buffer.byteLength(JSON.stringify(authorizationRecord), "utf8") +
                256,
            ),
        )

        expect(await submit(request)).toMatchObject({
          state: "pending",
          replay: true,
        })
        await expect(
          submit({ ...request, callId: randomUUID() }),
        ).rejects.toThrow()
        await submit({
          action: "profile_call_finish",
          ...replacement,
          status: outcome,
          ...(outcome === "succeeded"
            ? { node: nodeFor(3), outputDigest: digest(nodeFor(3)) }
            : { errorCode: "profile_map_anchor_invalid" }),
          usage: { inputTokens: 44, outputTokens: 7 },
          finishedAt: new Date().toISOString(),
        })
        if (outcome === "rejected") {
          expect(await submit(request)).toMatchObject({
            state: "rejected",
            replay: true,
          })
          await expect(
            submit({ ...request, callId: randomUUID() }),
          ).rejects.toThrow("already authorized")
          await expect(
            submit({
              action: "profile_finalize",
              ...base,
              cacheKey: input.cacheKey,
              finalCallId: replacement.callId,
              coverageDigest: input.coverageDigest,
              expectedNodeDigests: [digest(nodeFor(3))],
            }),
          ).rejects.toThrow("Profile is terminal")
          expect(
            await prisma.recommendationPrecomputedProfileCall.findUniqueOrThrow(
              {
                where: {
                  generationId_callId: {
                    generationId: base.generationId,
                    callId: original.callId,
                  },
                },
              },
            ),
          ).toEqual(original)
          expect(
            await prisma.recommendationPrecomputedProfileCall.findMany({
              where: {
                generationId: base.generationId,
                callId: { in: accepted.map((c) => c.callId) },
              },
              orderBy: { callId: "asc" },
            }),
          ).toEqual(accepted)
          const rows =
            await prisma.recommendationPrecomputedProfileCall.findMany({
              where: { generationId: base.generationId },
            })
          expect(rows).toHaveLength(5)
          expect(rows.reduce((total, row) => total + row.inputTokens!, 0)).toBe(
            4 * 33 + 44,
          )
          await prisma.recommendationPrecomputedGeneration.update({
            where: { id: base.generationId },
            data: { status: "cancelled", cancelledAt: new Date() },
          })
          expect(
            await prisma.$transaction((tx) =>
              purgeExpiredPrecomputedGenerations(
                tx,
                new Date(Date.now() + 100 * 86400000),
                1,
              ),
            ),
          ).toMatchObject({
            profileCallsDeleted: 5,
            executionAttemptsDeleted: 2,
            generationsDeleted: 1,
          })
          return
        }
        await expect(
          submit({
            action: "profile_call_start",
            ...replacement,
            callId: randomUUID(),
            startedAt: new Date().toISOString(),
          }),
        ).rejects.toThrow("already has an accepted receipt")
        const mapBindings = [...bindings.slice(0, 3), replacement]
        for (const binding of bindings.slice(4)) {
          const current = { ...binding, attemptId: base.attemptId }
          await submit({
            action: "profile_call_start",
            ...current,
            startedAt: new Date().toISOString(),
          })
          await submit({
            action: "profile_call_finish",
            ...current,
            status: "succeeded",
            node: nodeFor(binding.partIndex),
            outputDigest: digest(nodeFor(binding.partIndex)),
            usage: { inputTokens: 33, outputTokens: 6 },
            finishedAt: new Date().toISOString(),
          })
          mapBindings.push(current)
        }
        const childNodeDigests = mapBindings.map((b) =>
          digest(nodeFor(b.partIndex)),
        )
        const reduceNode = {
          profile,
          coveredPartStart: 0,
          coveredPartEnd: 6,
          childNodeDigests,
        }
        const reduce = {
          ...base,
          cacheKey: input.cacheKey,
          callId: randomUUID(),
          stage: "reduce",
          stagePromptVersion: `${input.promptVersion}:reduce`,
          nodeKey: nodeKey(
            input.cacheKey,
            "reduce",
            childNodeDigests,
            `${input.promptVersion}:reduce`,
          ),
          inputDigest: digest("reduce-prompt"),
          childCallIds: mapBindings.map((b) => b.callId),
        }
        await submit({
          action: "profile_call_start",
          ...reduce,
          startedAt: new Date().toISOString(),
        })
        await submit({
          action: "profile_call_finish",
          ...reduce,
          status: "succeeded",
          node: reduceNode,
          outputDigest: digest(reduceNode),
          usage: { inputTokens: 55, outputTokens: 8 },
          finishedAt: new Date().toISOString(),
        })
        expect(
          await submit({
            action: "profile_finalize",
            ...base,
            cacheKey: input.cacheKey,
            finalCallId: reduce.callId,
            coverageDigest: input.coverageDigest,
            expectedNodeDigests: [...childNodeDigests, digest(reduceNode)],
          }),
        ).toMatchObject({ state: "ready" })
        expect(
          await prisma.recommendationPrecomputedProfileCall.findUniqueOrThrow({
            where: {
              generationId_callId: {
                generationId: base.generationId,
                callId: original.callId,
              },
            },
          }),
        ).toEqual(original)
        expect(
          await prisma.recommendationPrecomputedProfileCall.findMany({
            where: {
              generationId: base.generationId,
              callId: { in: accepted.map((c) => c.callId) },
            },
            orderBy: { callId: "asc" },
          }),
        ).toEqual(accepted)
        const status = await submit({
          action: "profile_status",
          generationId: base.generationId,
          generationInputDigest,
          cacheKey: input.cacheKey,
        })
        expect(status).toMatchObject({
          profile: {
            manualReplacement: {
              originalCallId: original.callId,
              replacementCallId: replacement.callId,
            },
          },
        })
        const calls =
          await prisma.recommendationPrecomputedProfileCall.findMany({
            where: { generationId: base.generationId },
          })
        expect(calls).toHaveLength(8)
        expect(calls.reduce((total, c) => total + c.inputTokens!, 0)).toBe(
          6 * 33 + 44 + 55,
        )
        const capacity = await loadPrecomputedStorageCapacityReport(prisma, {
          generationId: base.generationId,
        })
        expect(
          capacity.relations.find(
            (row) =>
              row.table ===
              "recommendation_precomputed_profile_manual_replacement",
          )!.totalBytes,
        ).toBeGreaterThan(0)
        const auditCount = async () =>
          Number(
            (
              await prisma.$queryRaw<
                Array<{ count: bigint }>
              >`SELECT count(*) AS count FROM recommendation_precomputed_profile_manual_replacement WHERE generation_id = ${base.generationId}`
            )[0]!.count,
          )
        await prisma.recommendationPrecomputedGeneration.update({
          where: { id: base.generationId },
          data: {
            status: "cancelled",
            cancelledAt: new Date(),
            rollbackRetentionHold: true,
          },
        })
        const future = new Date(Date.now() + 100 * 86_400_000)
        await prisma.$transaction((tx) =>
          purgeExpiredPrecomputedGenerations(tx, future, 1),
        )
        expect(await auditCount()).toBe(1)
        await prisma.recommendationPrecomputedGeneration.update({
          where: { id: base.generationId },
          data: { rollbackRetentionHold: false },
        })
        expect(
          await prisma.$transaction((tx) =>
            purgeExpiredPrecomputedGenerations(tx, future, 1),
          ),
        ).toMatchObject({
          profileCallsDeleted: 8,
          profilesDeleted: 1,
          executionAttemptsDeleted: 2,
          generationsDeleted: 1,
        })
        expect(await auditCount()).toBe(0)
      },
    )
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
          people: Array(12).fill("P".repeat(80)),
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
      ).toBeLessThanOrEqual(4096)
      expect(Buffer.byteLength(JSON.stringify(node), "utf8")).toBeGreaterThan(
        2048,
      )
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
    it.each([4096, 4097])(
      "enforces the exact canonical %s-byte node boundary with usage and replay",
      async (targetBytes) => {
        const base = await build(`profile-canonical-${targetBytes}`)
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
            people: Array(12).fill("P".repeat(80)),
            places: Array(12).fill("é"),
            citations: Array(12).fill("C"),
            anchors: [],
          },
          coveredPartStart: 0,
          coveredPartEnd: 1,
          childNodeDigests: [],
        }
        const bytes = () => Buffer.byteLength(JSON.stringify(node), "utf8")
        for (const list of [node.profile.places, node.profile.citations]) {
          for (let index = 0; index < list.length; index++) {
            list[index] += "x".repeat(
              Math.min(80 - list[index]!.length, targetBytes - bytes()),
            )
          }
        }
        expect(bytes()).toBe(targetBytes)
        const finish = {
          action: "profile_call_finish",
          ...binding,
          status: "succeeded",
          outputDigest: digest(node),
          node,
          usage: { inputTokens: 33, outputTokens: 6 },
          finishedAt: new Date().toISOString(),
        }
        expect(await submit(finish)).toMatchObject({
          receiptStored: true,
          nodeApplied: targetBytes === 4096,
          state: targetBytes === 4096 ? "succeeded" : "rejected",
          replay: false,
        })
        expect(await submit(finish)).toMatchObject({
          receiptStored: true,
          nodeApplied: targetBytes === 4096,
          replay: true,
        })
        const status = await submit({
          action: "profile_status",
          generationId: base.generationId,
          generationInputDigest,
          cacheKey: input.cacheKey,
        })
        expect(status).toMatchObject({
          calls: [{ status: targetBytes === 4096 ? "succeeded" : "rejected" }],
        })
        const row =
          await prisma.recommendationPrecomputedProfileCall.findFirstOrThrow({
            where: { generationId: base.generationId, callId },
          })
        expect(row).toMatchObject({
          inputTokens: 33,
          outputTokens: 6,
          receiptNodeApplied: targetBytes === 4096,
        })
        if (targetBytes > 4096) {
          expect(row.nodeJson).toBeNull()
          await expect(
            submit({
              action: "profile_call_start",
              ...binding,
              callId: randomUUID(),
              startedAt: new Date().toISOString(),
            }),
          ).rejects.toThrow("Profile is terminal")
          return
        }
        const [stored] = await prisma.$queryRaw<Array<{ bytes: number }>>`
        SELECT octet_length(node_json::text)::integer AS bytes
        FROM recommendation_precomputed_profile_call
        WHERE generation_id = ${base.generationId} AND call_id = ${callId}::uuid`
        expect(stored!.bytes).toBeGreaterThan(4096)
        expect(stored!.bytes).toBeLessThanOrEqual(8192)
        const [constraint] = await prisma.$queryRaw<
          Array<{ validated: boolean; definition: string }>
        >`
          SELECT convalidated AS validated, pg_get_constraintdef(oid) AS definition
          FROM pg_constraint
          WHERE conrelid = 'recommendation_precomputed_profile_call'::regclass
            AND conname = 'recommendation_precomputed_profile_call_node_json_check'`
        expect(constraint!.validated).toBe(true)
        expect(constraint!.definition).toContain("8192")
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
      },
    )
    it("reserves 4 KiB plus receipt overhead and refuses the former 3 KiB headroom before a call", async () => {
      const base = await build("profile-call-reservation")
      const input = registration(base, "transcript", [digest("part-zero")])
      await submit(input)
      const budget = async () => {
        const [row] = await prisma.$queryRaw<Array<{ consumed_bytes: bigint }>>`
          SELECT consumed_bytes FROM recommendation_precomputed_build_budget
          WHERE generation_id = ${base.generationId}`
        return row!.consumed_bytes
      }
      const before = await budget()
      await prisma.$executeRaw`
        UPDATE recommendation_precomputed_generation
        SET capacity_preflight = jsonb_set(capacity_preflight, '{projectedBytes}', to_jsonb(${before + 3072n}::bigint))
        WHERE id = ${base.generationId}`
      const callId = randomUUID()
      const stagePromptVersion = `${input.promptVersion}:map`
      const start = {
        action: "profile_call_start",
        ...base,
        callId,
        cacheKey: input.cacheKey,
        stage: "map",
        stagePromptVersion,
        nodeKey: nodeKey(input.cacheKey, "map", 0, stagePromptVersion),
        inputDigest: digest("reservation-prompt"),
        partIndex: 0,
        startedAt: new Date().toISOString(),
      }
      await expect(submit(start)).rejects.toMatchObject({
        code: "capacity_budget_exceeded",
      })
      expect(await budget()).toBe(before)
      expect(
        await prisma.recommendationPrecomputedProfileCall.count({
          where: { generationId: base.generationId },
        }),
      ).toBe(0)
      await prisma.$executeRaw`
        UPDATE recommendation_precomputed_generation
        SET capacity_preflight = jsonb_set(capacity_preflight, '{projectedBytes}', to_jsonb(${before + 5120n}::bigint))
        WHERE id = ${base.generationId}`
      expect(await submit(start)).toMatchObject({
        state: "pending",
        replay: false,
      })
      expect(await budget()).toBe(before + 5120n)
      expect(await submit(start)).toMatchObject({
        state: "pending",
        replay: true,
      })
      expect(await budget()).toBe(before + 5120n)
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
