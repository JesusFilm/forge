import { createHash } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { DurableBuildReportView } from "@/app/dashboard/recommendations/precomputed/build-report-view"
import { currentAdminMigrationSql } from "../current-schema.test-fixture"
import { submitPrecomputedRecommendation as submitLegacy } from "./contract"
import {
  loadDurablePrecomputedBuildReport,
  submitDurablePrecomputedRecommendation,
} from "./durable-build"

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "durable precomputed build lifecycle on PostgreSQL",
  () => {
    let prisma: PrismaClient
    let admin: Client
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const schema = `durable_build_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const generationId = `durable-${suffix}`
    const sourceVideoId = `source-${suffix}`
    const sourceSetDigest = digest([sourceVideoId])
    const generationInputDigest = "a".repeat(64)
    const bearer = "Bearer preview-test-key"
    const submit = (input: unknown) =>
      submitDurablePrecomputedRecommendation(prisma, input, bearer)
    const base = { generationId, generationInputDigest }
    async function setupBuild(
      name: string,
      inputMode: "content_only" | "historical_analytics" = "content_only",
    ) {
      const generationId = `${name}-${suffix}`
      const build = { generationId, generationInputDigest }
      await submit({
        action: "start",
        generationId,
        protocolVersion: 2,
        modelId: "gpt-6-astra",
        promptVersion: "durable-v1",
        inputDigest: generationInputDigest,
        sourceSetDigest,
        inputCutoff: new Date(Date.now() + 60_000).toISOString(),
        expectedSourceCount: 1,
        inputMode,
      })
      await submit({
        action: "manifest",
        ...build,
        sourceVideoIds: [sourceVideoId],
      })
      const probe = await submit({ action: "capacity_probe", ...build })
      const measurement = {
        measuredAt: new Date().toISOString(),
        clusterSystemId: probe.clusterSystemId as string,
        observedDbBytes: probe.observedDbBytes as number,
        availableBytes: 20_000_000_000,
        reserveBytes: 5_000_000_000,
        projectedBytes: 1_000_000,
        sampleSourceCount: 1,
        sampleBytes: 100_000,
        source: "operator_verified_pgdata_df",
      }
      await submit({ action: "capacity", ...build, measurement })
      return { ...build, measurement }
    }
    async function otherActiveProjectionBytes(excludeIds: string[]) {
      const active = await prisma.recommendationPrecomputedGeneration.findMany({
        where: {
          protocolVersion: 2,
          status: "incomplete",
          id: { notIn: excludeIds },
        },
        select: { capacityPreflight: true },
      })
      return active.reduce((total, row) => {
        const capacity = row.capacityPreflight as {
          status?: string
          projectedBytes?: number
          heldProjectionBytes?: number
        } | null
        return (
          total +
          (capacity?.status === "passed"
            ? Math.max(
                capacity.projectedBytes ?? 0,
                capacity.heldProjectionBytes ?? 0,
              )
            : 0)
        )
      }, 0)
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
      prisma = new PrismaClient({
        datasources: { db: { url: url.toString() } },
      })
      await prisma.video.create({
        data: {
          id: sourceVideoId,
          coreId: `core-${sourceVideoId}`,
          slug: sourceVideoId,
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

    it("requires a measured capacity gate and complete manifest before ready", async () => {
      await submit({
        action: "start",
        generationId,
        protocolVersion: 2,
        modelId: "gpt-6-astra",
        promptVersion: "durable-v1",
        inputDigest: generationInputDigest,
        sourceSetDigest,
        inputCutoff: new Date(Date.now() + 60_000).toISOString(),
        expectedSourceCount: 1,
        inputMode: "content_only",
      })
      await expect(
        submit({ action: "claim", ...base, sourceVideoId, claimId: "first" }),
      ).rejects.toMatchObject({ code: "conflict" })
      expect(
        await submit({
          action: "manifest",
          ...base,
          sourceVideoIds: [sourceVideoId],
        }),
      ).toMatchObject({ replay: false, pendingSourceCount: 1 })
      const probe = await submit({ action: "capacity_probe", ...base })
      expect(probe).toMatchObject({ availableBytes: null })
      const measuredAt = new Date().toISOString()
      await submit({
        action: "capacity",
        ...base,
        measurement: {
          measuredAt,
          clusterSystemId: probe.clusterSystemId as string,
          observedDbBytes: probe.observedDbBytes as number,
          availableBytes: 20_000_000_000,
          reserveBytes: 5_000_000_000,
          projectedBytes: 1_000_000,
          sampleSourceCount: 1,
          sampleBytes: 100_000,
          source: "operator_verified_pgdata_df",
        },
      })
      const claim = await submit({
        action: "claim",
        ...base,
        sourceVideoId,
        claimId: "first",
      })
      expect(claim).toMatchObject({ sourceState: "claimed", attemptNumber: 1 })
      await expect(
        submit({ action: "complete", ...base }),
      ).rejects.toMatchObject({
        code: "conflict",
      })
      await submit({
        action: "source",
        ...base,
        sourceVideoId,
        leaseToken: claim.leaseToken,
      })
      expect(await submit({ action: "complete", ...base })).toMatchObject({
        state: "complete",
      })
      const status = await submit({ action: "status", ...base, sourceVideoId })
      expect(status).toMatchObject({
        state: "complete",
        completeEmptySourceCount: 1,
        source: { state: "complete_empty" },
      })
    })

    it("keeps a charged stale attempt while fencing its checkpoint and completion", async () => {
      const build = await setupBuild("stale")
      const first = await submit({
        action: "claim",
        ...build,
        sourceVideoId,
        claimId: "attempt-one",
      })
      const firstToken = first.leaseToken as string
      const call = {
        action: "model_call_start",
        ...build,
        sourceVideoId,
        leaseToken: firstToken,
        callId: `stale-call-${suffix}`,
        stage: "catalog_discovery",
        modelId: "gpt-6-astra",
        inputDigest: "b".repeat(64),
        startedAt: new Date(Date.now() - 2_000).toISOString(),
      }
      await submit(call)
      expect(
        (await submit({ action: "status", ...build })).usage,
      ).toMatchObject({
        modelPendingCount: 1,
        modelUnknownCostCount: 1,
      })
      await prisma.recommendationPrecomputedBuildSource.update({
        where: {
          generationId_sourceVideoId: {
            generationId: build.generationId,
            sourceVideoId,
          },
        },
        data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
      })
      const second = await submit({
        action: "claim",
        ...build,
        sourceVideoId,
        claimId: "attempt-two",
      })
      expect(second).toMatchObject({ attemptNumber: 2, checkpointRevision: 0 })
      const terminal = {
        ...call,
        action: "model_call",
        status: "succeeded",
        outputDigest: "c".repeat(64),
        inputTokens: 100,
        outputTokens: 20,
        costUsd: 0.01,
        finishedAt: new Date().toISOString(),
        expectedRevision: 0,
        checkpointId: `stale-checkpoint-${suffix}`,
        checkpoint: { stage: "discovery", cursor: { catalogIndex: 1 } },
      }
      expect(await submit(terminal)).toMatchObject({
        receiptStored: true,
        checkpointApplied: false,
        staleLease: true,
      })
      expect(
        (await submit({ action: "status", ...build, sourceVideoId })).usage,
      ).toMatchObject({
        modelCallCount: 1,
        modelPendingCount: 0,
        modelKnownCostUsd: 0.01,
      })
      await expect(
        submit({
          action: "source",
          ...build,
          sourceVideoId,
          leaseToken: firstToken,
        }),
      ).rejects.toMatchObject({ code: "conflict" })
      const secondToken = second.leaseToken as string
      const newCall = {
        ...call,
        leaseToken: secondToken,
        callId: `new-call-${suffix}`,
        startedAt: new Date(Date.now() - 1_000).toISOString(),
      }
      await submit(newCall)
      const terminalNewCall = {
        ...terminal,
        ...newCall,
        action: "model_call",
        checkpointId: `new-checkpoint-${suffix}`,
        costUsd: 0.02,
        finishedAt: new Date().toISOString(),
      }
      const current = await submit(terminalNewCall)
      expect(current).toMatchObject({
        receiptStored: true,
        checkpointApplied: true,
        checkpointRevision: 1,
      })
      expect(await submit(terminalNewCall)).toMatchObject({
        receiptStored: true,
        replay: true,
        checkpointApplied: true,
        checkpointRevision: 1,
      })
      await submit({
        action: "source",
        ...build,
        sourceVideoId,
        leaseToken: secondToken,
      })
      await submit({ action: "complete", ...build })
      expect(
        (await submit({ action: "status", ...build })).usage,
      ).toMatchObject({
        modelCallCount: 2,
        modelKnownCostUsd: 0.03,
      })
    })

    it("serializes conflicting terminal callbacks for one paid call", async () => {
      const build = await setupBuild("receipt-race")
      const claim = await submit({
        action: "claim",
        ...build,
        sourceVideoId,
        claimId: "race",
      })
      const leaseToken = claim.leaseToken as string
      const startedAt = new Date(Date.now() - 1_000).toISOString()
      const callId = `race-call-${suffix}`
      await submit({
        action: "model_call_start",
        ...build,
        sourceVideoId,
        leaseToken,
        callId,
        stage: "candidate_judgment",
        modelId: "gpt-6-astra",
        inputDigest: "d".repeat(64),
        startedAt,
      })
      const terminal = {
        action: "model_call",
        ...build,
        sourceVideoId,
        leaseToken,
        callId,
        stage: "candidate_judgment",
        modelId: "gpt-6-astra",
        inputDigest: "d".repeat(64),
        startedAt,
        finishedAt: new Date().toISOString(),
        status: "succeeded",
        outputDigest: "e".repeat(64),
        expectedRevision: 0,
        checkpointId: `race-step-${suffix}`,
        checkpoint: { stage: "judgment", cursor: { candidateIndex: 1 } },
      }
      const results = await Promise.allSettled([
        submit({ ...terminal, costUsd: 0.02 }),
        submit({ ...terminal, costUsd: 0.03 }),
      ])
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1)
      expect(
        results.filter((result) => result.status === "rejected"),
      ).toHaveLength(1)
      const cost = (await submit({ action: "status", ...build })).usage as {
        modelKnownCostUsd: number
      }
      expect([0.02, 0.03]).toContain(cost.modelKnownCostUsd)
    })

    it("keeps a paid receipt when its optional choice conflicts", async () => {
      const build = await setupBuild("receipt-choice-conflict")
      const claim = await submit({
        action: "claim",
        ...build,
        sourceVideoId,
        claimId: "choice-conflict",
      })
      const leaseToken = claim.leaseToken as string
      const choice = {
        targetVideoId: `target-${suffix}`,
        kind: "direct",
        relationship: "shared theme",
        reasonEnglish: "Both videos explore the same theme.",
        evidence: { basis: "metadata", fields: ["title"] },
        strength: 70,
      }
      await submit({
        action: "choice",
        ...build,
        sourceVideoId,
        leaseToken,
        choice,
      })
      const call = {
        ...build,
        sourceVideoId,
        leaseToken,
        callId: `choice-conflict-call-${suffix}`,
        stage: "candidate_judgment",
        modelId: "gpt-6-astra",
        inputDigest: "3".repeat(64),
        startedAt: new Date(Date.now() - 1_000).toISOString(),
      }
      await submit({ action: "model_call_start", ...call })
      const terminal = {
        action: "model_call",
        ...call,
        status: "succeeded",
        outputDigest: "4".repeat(64),
        costUsd: 0.025,
        finishedAt: new Date().toISOString(),
        expectedRevision: 0,
        checkpointId: `choice-conflict-checkpoint-${suffix}`,
        checkpoint: { stage: "judgment", cursor: { candidateIndex: 1 } },
        choice: {
          ...choice,
          reasonEnglish: "A different explanation for that same target.",
        },
      }
      expect(await submit(terminal)).toMatchObject({
        receiptStored: true,
        checkpointApplied: false,
        checkpointRejected: "conflict",
      })
      expect(await submit(terminal)).toMatchObject({
        receiptStored: true,
        replay: true,
        checkpointApplied: false,
      })
      expect(await submit({ action: "status", ...build })).toMatchObject({
        usage: { modelKnownCostUsd: 0.025 },
      })
      const stored =
        await prisma.recommendationPrecomputedBuildChoice.findUniqueOrThrow({
          where: {
            generationId_sourceVideoId_targetVideoId: {
              generationId: build.generationId,
              sourceVideoId,
              targetVideoId: choice.targetVideoId,
            },
          },
        })
      expect(stored.payload).toMatchObject({
        reasonEnglish: choice.reasonEnglish,
      })
    })

    it("holds writes on expired or insufficient capacity and resumes after a fresh attestation", async () => {
      const build = await setupBuild("capacity-refresh")
      const claim = await submit({
        action: "claim",
        ...build,
        sourceVideoId,
        claimId: "capacity-claim",
      })
      const leaseToken = claim.leaseToken as string
      const startedAt = new Date(Date.now() - 1_000).toISOString()
      await submit({
        action: "model_call_start",
        ...build,
        sourceVideoId,
        leaseToken,
        callId: `capacity-paid-${suffix}`,
        stage: "catalog_discovery",
        modelId: "gpt-6-astra",
        inputDigest: "9".repeat(64),
        startedAt,
      })
      await prisma.recommendationPrecomputedGeneration.update({
        where: { id: build.generationId },
        data: {
          capacityPreflight: {
            ...build.measurement,
            status: "passed",
            measuredAt: new Date(Date.now() - 31 * 60_000).toISOString(),
          },
        },
      })
      await expect(
        submit({
          action: "checkpoint",
          ...build,
          sourceVideoId,
          leaseToken,
          expectedRevision: 0,
          checkpointId: "held",
          checkpoint: { stage: "discovery", cursor: {} },
        }),
      ).rejects.toMatchObject({ code: "capacity_attestation_expired" })
      expect(
        await submit({
          action: "model_call",
          ...build,
          sourceVideoId,
          leaseToken,
          callId: `capacity-paid-${suffix}`,
          stage: "catalog_discovery",
          modelId: "gpt-6-astra",
          inputDigest: "9".repeat(64),
          startedAt,
          status: "succeeded",
          outputDigest: "8".repeat(64),
          costUsd: 0.005,
          finishedAt: new Date().toISOString(),
          expectedRevision: 0,
          checkpointId: "capacity-output",
          checkpoint: { stage: "discovery", cursor: { catalogIndex: 1 } },
        }),
      ).toMatchObject({
        receiptStored: true,
        checkpointApplied: false,
        capacityBlocked: true,
      })
      expect(
        (await submit({ action: "status", ...build })).usage,
      ).toMatchObject({ modelKnownCostUsd: 0.005 })
      const probe = await submit({ action: "capacity_probe", ...build })
      const fresh = {
        ...build.measurement,
        measuredAt: new Date().toISOString(),
        clusterSystemId: probe.clusterSystemId as string,
        observedDbBytes: probe.observedDbBytes as number,
      }
      expect(
        await submit({
          action: "capacity",
          ...build,
          measurement: {
            ...fresh,
            availableBytes: 5_000_000_000,
          },
        }),
      ).toMatchObject({ state: "capacity_blocked" })
      await expect(
        submit({
          action: "checkpoint",
          ...build,
          sourceVideoId,
          leaseToken,
          expectedRevision: 0,
          checkpointId: "blocked",
          checkpoint: { stage: "discovery", cursor: {} },
        }),
      ).rejects.toMatchObject({ code: "conflict" })
      await new Promise((resolve) => setTimeout(resolve, 5))
      const refreshed = {
        ...fresh,
        measuredAt: new Date().toISOString(),
      }
      expect(
        await submit({ action: "capacity", ...build, measurement: refreshed }),
      ).toMatchObject({ state: "incomplete" })
      expect(
        await submit({
          action: "checkpoint",
          ...build,
          sourceVideoId,
          leaseToken,
          expectedRevision: 0,
          checkpointId: "resumed",
          checkpoint: { stage: "discovery", cursor: {} },
        }),
      ).toMatchObject({ checkpointRevision: 1 })
      await prisma.recommendationPrecomputedBuildBudget.update({
        where: { generationId: build.generationId },
        data: { consumedBytes: 999_950n },
      })
      await expect(
        submit({
          action: "checkpoint",
          ...build,
          sourceVideoId,
          leaseToken,
          expectedRevision: 1,
          checkpointId: "over-budget",
          checkpoint: { stage: "discovery", cursor: { catalogIndex: 2 } },
        }),
      ).rejects.toMatchObject({ code: "capacity_budget_exceeded" })
      await new Promise((resolve) => setTimeout(resolve, 5))
      expect(
        await submit({
          action: "capacity",
          ...build,
          measurement: {
            ...refreshed,
            measuredAt: new Date().toISOString(),
          },
        }),
      ).toMatchObject({ state: "incomplete" })
      expect(
        await submit({
          action: "checkpoint",
          ...build,
          sourceVideoId,
          leaseToken,
          expectedRevision: 1,
          checkpointId: "after-budget-refresh",
          checkpoint: { stage: "discovery", cursor: { catalogIndex: 2 } },
        }),
      ).toMatchObject({ checkpointRevision: 2 })
    })

    it("holds a terminal build's projection until the next physical observation", async () => {
      const completed = await setupBuild("completed-before-admission")
      const freshProbe = await submit({
        action: "capacity_probe",
        ...completed,
      })
      await submit({
        action: "capacity",
        ...completed,
        measurement: {
          ...completed.measurement,
          measuredAt: new Date().toISOString(),
          observedDbBytes: freshProbe.observedDbBytes,
          projectedBytes: 200_000_000,
        },
      })
      const waiting = {
        generationId: `waiting-admission-${suffix}`,
        generationInputDigest,
      }
      await submit({
        action: "start",
        ...waiting,
        protocolVersion: 2,
        modelId: "gpt-6-astra",
        promptVersion: "durable-v1",
        inputDigest: generationInputDigest,
        sourceSetDigest,
        inputCutoff: new Date(Date.now() + 60_000).toISOString(),
        expectedSourceCount: 1,
        inputMode: "content_only",
      })
      await submit({
        action: "manifest",
        ...waiting,
        sourceVideoIds: [sourceVideoId],
      })
      const beforeWrites = await submit({
        action: "capacity_probe",
        ...waiting,
      })
      const measuredAt = new Date().toISOString()
      const claim = await submit({
        action: "claim",
        ...completed,
        sourceVideoId,
        claimId: "finished-before-waiting-admission",
      })
      await submit({
        action: "source",
        ...completed,
        sourceVideoId,
        leaseToken: claim.leaseToken,
      })
      await submit({ action: "complete", ...completed })
      const sample = {
        measuredAt,
        clusterSystemId: beforeWrites.clusterSystemId,
        observedDbBytes: beforeWrites.observedDbBytes,
        availableBytes: 6_100_000_000,
        reserveBytes: 5_000_000_000,
        projectedBytes: 1_000_000_000,
        sampleSourceCount: 1,
        sampleBytes: 100_000,
        source: "operator_verified_pgdata_df",
      }
      const blocked = await submit({
        action: "capacity",
        ...waiting,
        measurement: sample,
      })
      expect(blocked).toMatchObject({
        state: "capacity_blocked",
        capacity: { recentTerminalProjectedBytes: 200_000_000 },
      })
      await new Promise((resolve) => setTimeout(resolve, 5))
      const afterWrites = await submit({
        action: "capacity_probe",
        ...waiting,
      })
      const admitted = await submit({
        action: "capacity",
        ...waiting,
        measurement: {
          ...sample,
          measuredAt: new Date().toISOString(),
          observedDbBytes: afterWrites.observedDbBytes,
        },
      })
      expect(admitted).toMatchObject({
        state: "incomplete",
        capacity: { recentTerminalProjectedBytes: 0 },
      })
    })

    it("retains a blocked build's prior reservation against an older sample", async () => {
      const writing = await setupBuild("blocked-after-writing")
      const writingProbe = await submit({
        action: "capacity_probe",
        ...writing,
      })
      await submit({
        action: "capacity",
        ...writing,
        measurement: {
          ...writing.measurement,
          measuredAt: new Date().toISOString(),
          observedDbBytes: writingProbe.observedDbBytes,
          projectedBytes: 200_000_000,
        },
      })
      const waiting = await setupBuild("waiting-on-blocked")
      const beforeWrites = await submit({
        action: "capacity_probe",
        ...waiting,
      })
      const measuredAt = new Date().toISOString()
      const claim = await submit({
        action: "claim",
        ...writing,
        sourceVideoId,
        claimId: "write-before-block",
      })
      await submit({
        action: "source",
        ...writing,
        sourceVideoId,
        leaseToken: claim.leaseToken,
      })
      const blockedProbe = await submit({
        action: "capacity_probe",
        ...writing,
      })
      expect(
        await submit({
          action: "capacity",
          ...writing,
          measurement: {
            ...writing.measurement,
            measuredAt: new Date().toISOString(),
            observedDbBytes: blockedProbe.observedDbBytes,
            projectedBytes: 200_000_000,
            availableBytes: 5_000_000_000,
          },
        }),
      ).toMatchObject({
        state: "capacity_blocked",
        capacity: { heldProjectionBytes: 200_000_000 },
      })
      const sample = {
        ...waiting.measurement,
        measuredAt,
        observedDbBytes: beforeWrites.observedDbBytes,
        availableBytes:
          6_100_000_000 +
          (await otherActiveProjectionBytes([
            writing.generationId,
            waiting.generationId,
          ])),
        projectedBytes: 1_000_000_000,
      }
      expect(
        await submit({ action: "capacity", ...waiting, measurement: sample }),
      ).toMatchObject({
        state: "capacity_blocked",
        capacity: { otherReservedBytes: expect.any(Number) },
      })
      await new Promise((resolve) => setTimeout(resolve, 5))
      const afterWrites = await submit({
        action: "capacity_probe",
        ...waiting,
      })
      expect(
        await submit({
          action: "capacity",
          ...waiting,
          measurement: {
            ...sample,
            measuredAt: new Date().toISOString(),
            observedDbBytes: afterWrites.observedDbBytes,
          },
        }),
      ).toMatchObject({ state: "incomplete" })
    })

    it("rejects a sample older than another build's second passed capacity epoch", async () => {
      const writing = await setupBuild("two-capacity-epochs")
      const waiting = await setupBuild("waiting-on-second-epoch")
      const oldProbe = await submit({ action: "capacity_probe", ...waiting })
      const oldMeasuredAt = new Date().toISOString()
      const claim = await submit({
        action: "claim",
        ...writing,
        sourceVideoId,
        claimId: "first-capacity-epoch",
      })
      await submit({
        action: "source",
        ...writing,
        sourceVideoId,
        leaseToken: claim.leaseToken,
      })
      await new Promise((resolve) => setTimeout(resolve, 5))
      const newerProbe = await submit({ action: "capacity_probe", ...writing })
      expect(
        await submit({
          action: "capacity",
          ...writing,
          measurement: {
            ...writing.measurement,
            measuredAt: new Date().toISOString(),
            observedDbBytes: newerProbe.observedDbBytes,
            projectedBytes: 1_000_000_000,
          },
        }),
      ).toMatchObject({ state: "incomplete" })
      const oldSample = {
        ...waiting.measurement,
        measuredAt: oldMeasuredAt,
        observedDbBytes: oldProbe.observedDbBytes,
        availableBytes:
          7_100_000_000 +
          (await otherActiveProjectionBytes([
            writing.generationId,
            waiting.generationId,
          ])),
        projectedBytes: 1_000_000_000,
      }
      await expect(
        submit({ action: "capacity", ...waiting, measurement: oldSample }),
      ).rejects.toMatchObject({ code: "conflict" })
      const freshProbe = await submit({ action: "capacity_probe", ...waiting })
      expect(
        await submit({
          action: "capacity",
          ...waiting,
          measurement: {
            ...oldSample,
            measuredAt: new Date().toISOString(),
            observedDbBytes: freshProbe.observedDbBytes,
          },
        }),
      ).toMatchObject({ state: "incomplete" })
    })

    it("keeps incurred call usage after cancellation while fencing source writes", async () => {
      const build = await setupBuild("cancel")
      const claim = await submit({
        action: "claim",
        ...build,
        sourceVideoId,
        claimId: "cancel-claim",
      })
      const leaseToken = claim.leaseToken as string
      const startedAt = new Date(Date.now() - 1_000).toISOString()
      const callId = `cancel-call-${suffix}`
      await submit({
        action: "model_call_start",
        ...build,
        sourceVideoId,
        leaseToken,
        callId,
        stage: "source_summary",
        modelId: "gpt-6-astra",
        inputDigest: "f".repeat(64),
        startedAt,
      })
      await submit({ action: "cancel", ...build })
      expect(
        await submit({
          action: "model_call",
          ...build,
          sourceVideoId,
          leaseToken,
          callId,
          stage: "source_summary",
          modelId: "gpt-6-astra",
          inputDigest: "f".repeat(64),
          startedAt,
          status: "failed",
          errorCode: "provider_unavailable",
          costUsd: 0.015,
          inputTokens: 50,
          outputTokens: 5,
          finishedAt: new Date().toISOString(),
        }),
      ).toMatchObject({ receiptStored: true, checkpointApplied: false })
      await expect(
        submit({ action: "source", ...build, sourceVideoId, leaseToken }),
      ).rejects.toMatchObject({ code: "conflict" })
      const terminalStatus = await submit({ action: "status", ...build })
      expect(terminalStatus).toMatchObject({
        state: "cancelled",
        usage: { modelKnownCostUsd: 0.015 },
      })
      await new Promise((resolve) => setTimeout(resolve, 5))
      expect((await submit({ action: "status", ...build })).elapsedMs).toBe(
        terminalStatus.elapsedMs,
      )
    })

    it("reports a failed source separately from an explicit empty source", async () => {
      const build = await setupBuild("failed-source")
      const claim = await submit({
        action: "claim",
        ...build,
        sourceVideoId,
        claimId: "failed-claim",
      })
      await submit({
        action: "fail",
        ...build,
        sourceVideoId,
        leaseToken: claim.leaseToken,
        failureCode: "provider_invalid_output",
      })
      await expect(
        submit({ action: "complete", ...build }),
      ).rejects.toMatchObject({ code: "conflict" })
      expect(
        await submit({ action: "status", ...build, sourceVideoId }),
      ).toMatchObject({
        state: "incomplete",
        failedSourceCount: 1,
        completeEmptySourceCount: 0,
        source: { state: "failed", failureCode: "provider_invalid_output" },
      })
      await submit({
        action: "fail",
        ...build,
        failureCode: "provider_invalid_output",
      })
      expect(await submit({ action: "status", ...build })).toMatchObject({
        state: "failed",
      })
    })

    it("rejects every legacy producer action against a durable generation", async () => {
      const build = await setupBuild("protocol-fence")
      const legacy = (input: unknown) => submitLegacy(prisma, input, bearer)
      const generation =
        await prisma.recommendationPrecomputedGeneration.findUniqueOrThrow({
          where: { id: build.generationId },
        })
      const actions = [
        {
          action: "start",
          generationId: build.generationId,
          modelId: generation.modelId,
          promptVersion: generation.promptVersion,
          inputDigest: generation.inputDigest,
          sourceSetDigest: generation.sourceSetDigest,
          inputCutoff: generation.inputCutoff.toISOString(),
          expectedSourceCount: generation.expectedSourceCount,
          inputMode: generation.inputMode,
          inputSnapshotMode: generation.inputSnapshotMode,
        },
        {
          action: "source",
          generationId: build.generationId,
          sourceVideoId,
          choices: [],
        },
        {
          action: "model_call",
          generationId: build.generationId,
          sourceVideoId,
          callId: "legacy-bypass",
          stage: "catalog_discovery",
          status: "failed",
          modelId: "gpt-6-astra",
          inputDigest: "a".repeat(64),
          errorCode: "provider_unavailable",
          startedAt: new Date(Date.now() - 1_000).toISOString(),
          finishedAt: new Date().toISOString(),
        },
        {
          action: "fail",
          generationId: build.generationId,
          failureCode: "internal_failure",
        },
        { action: "complete", generationId: build.generationId },
        { action: "status", generationId: build.generationId },
      ]
      for (const action of actions)
        await expect(legacy(action)).rejects.toMatchObject({ code: "conflict" })
      expect(await submit({ action: "status", ...build })).toMatchObject({
        state: "incomplete",
        pendingSourceCount: 1,
        acceptedCount: 0,
      })
    })

    it("stores GA qualification separately from per-source snapshot and counts every HTTP attempt", async () => {
      const build = await setupBuild("history", "historical_analytics")
      const qualification = {
        evidenceKind: "referrer_navigation_v1",
        sourceResource: "properties/320198532",
        sourceAvailability: {
          coverage: "partial_source_history",
          requestedStart: "2020-01-01",
          requestedEnd: "2026-10-03",
          usableStart: "2022-08-06",
          usableEnd: "2026-10-03",
          truncationType: "DATA_TRUNCATION_TYPE_PROPERTY",
          truncationDate: "2022-08-05",
          unavailablePrefixStart: "2020-01-01",
          unavailablePrefixEnd: "2022-08-05",
          observedFirstMonth: "202208",
          observedLastMonth: "202610",
        },
        watchScope: {
          version: "jesusfilm-watch-v1",
          hosts: ["jesusfilm.org", "www.jesusfilm.org"],
          pathRule: "watch-route-and-children",
          eventName: "videostarts",
          includedEvents: 10,
          totalEvents: null,
          missingUrlEvents: null,
          malformedUrlEvents: null,
          excludedHostEvents: null,
          excludedPathEvents: null,
        },
        mediaComponentIdCoverage: {
          sourceDimension: "customEvent:mediacomponentid",
          inScopeEvents: 10,
          withMediaComponentIdEvents: 7,
          canonicalVideoMappedEvents: null,
        },
        engagement: {
          definitionVersion: "watch-videostarts-v1",
          botBasis: "unverified",
          overlapIdentity: "unknown",
          exposures: "unavailable",
        },
        transitions: {
          status: "unavailable",
          reason: "missing_session_identity",
        },
        navigation: {
          status: "available",
          definitionVersion: "watch-referrer-v1",
          basis: "same_event_page_referrer_to_page_path",
          interpretation: "navigation_not_playback_sequence",
          botBasis: "unverified",
          overlapIdentity: "unknown",
        },
        mapping: {
          basis: "current_catalog_cutoff_fenced",
          historicalOwnership: "unverified",
        },
      }
      const qualified = await submit({
        action: "history_qualification",
        ...build,
        qualification,
      })
      const claim = await submit({
        action: "claim",
        ...build,
        sourceVideoId,
        claimId: "ga-source",
      })
      const leaseToken = claim.leaseToken as string
      await expect(
        submit({ action: "source", ...build, sourceVideoId, leaseToken }),
      ).rejects.toMatchObject({ code: "conflict" })
      const startedAt = new Date(Date.now() - 1_000).toISOString()
      for (const [index, stage] of [
        "qualification",
        "snapshot_page",
        "retry",
      ].entries()) {
        const callId = `ga-${index}-${suffix}`
        await submit({
          action: "history_call_start",
          ...build,
          sourceVideoId,
          leaseToken,
          callId,
          stage,
          requestDigest: `${index + 1}`.repeat(64),
          startedAt,
        })
        await submit({
          action: "history_call",
          ...build,
          callId,
          status: "succeeded",
          finishedAt: new Date().toISOString(),
        })
      }
      await submit({
        action: "checkpoint",
        ...build,
        sourceVideoId,
        leaseToken,
        expectedRevision: 0,
        checkpointId: `ga-snapshot-${suffix}`,
        checkpoint: {
          stage: "history",
          cursor: {},
          historySummary: {
            resultDigest: "e".repeat(64),
            rowCount: 2,
            mappedRows: 1,
            unmappedRows: 1,
            pageCount: 2,
            queryExecutionCount: 2,
            navigationCoverage: {
              candidateEvents: 10,
              qualifiedEvents: 7,
              homeEvents: 0,
              selfEvents: 0,
              crossHostEvents: 0,
              malformedEvents: 0,
              unmappedEvents: 3,
              ambiguousEvents: 0,
            },
          },
        },
      })
      await submit({
        action: "source_history",
        ...build,
        sourceVideoId,
        leaseToken,
        history: {
          evidenceKind: "referrer_navigation_v1",
          sourceResource: "properties/320198532",
          queryId: "watch-referrer-navigation-v1",
          rangeStart: "2022-08-06",
          rangeEnd: "2026-10-03",
          resultDigest: "e".repeat(64),
          rowCount: 2,
          mappedRows: 1,
          unmappedRows: 1,
          pageCount: 2,
          queryExecutionCount: 2,
          qualificationDigest: qualified.qualificationDigest,
          navigationCoverage: {
            candidateEvents: 10,
            qualifiedEvents: 7,
            homeEvents: 0,
            selfEvents: 0,
            crossHostEvents: 0,
            malformedEvents: 0,
            unmappedEvents: 3,
            ambiguousEvents: 0,
          },
          status: "complete",
        },
      })
      await submit({ action: "source", ...build, sourceVideoId, leaseToken })
      await submit({ action: "complete", ...build })
      const report = await loadDurablePrecomputedBuildReport(prisma, {
        generationId: build.generationId,
        sourceVideoId,
        reviewer: { id: "reviewer", role: "ADMIN" },
      })
      expect(report).toMatchObject({
        historicalQualification: {
          sourceAvailability: { unavailablePrefixStart: "2020-01-01" },
        },
        source: { historicalProvenance: { mappedRows: 1, unmappedRows: 1 } },
        historyTotals: {
          navigationCoverage: { qualifiedEvents: 7, unmappedEvents: 3 },
        },
        usage: {
          historyCallCount: 3,
          historyUnknownCostCount: 3,
          historyUnknownBytesCount: 3,
        },
      })
      const html = renderToStaticMarkup(
        createElement(DurableBuildReportView, { report: report! }),
      )
      expect(html).toContain("Unavailable historical prefix")
      expect(html).toContain(
        "navigation evidence, not a consecutive watched-video transition",
      )
      expect(html).toContain("unknown")
    })
  },
)
