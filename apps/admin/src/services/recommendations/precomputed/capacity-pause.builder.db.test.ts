import { createHash, randomUUID } from "node:crypto"
import { PrismaClient, type Prisma } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { currentAdminMigrationSql } from "../current-schema.test-fixture"
import { submitDurablePrecomputedRecommendation } from "./durable-build"
import { purgeExpiredPrecomputedGenerations } from "./generation-retention"

// Disposable native PostgreSQL only; no provider, capture, production or tokenizer.
const H = "a".repeat(64)
const sourceId = `pause-source-${randomUUID()}`
const schema = `capacity_pause_${Date.now()}_${Math.random().toString(36).slice(2)}`
const bearer = "Bearer preview-test-key"
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "preserving reversible capacity pause on current PostgreSQL schema",
  () => {
    let db: PrismaClient
    let sql: Client
    const submit = (value: unknown, auth: string | null = bearer) =>
      submitDurablePrecomputedRecommendation(db, value, auth)
    const base = (generationId: string) => ({
      generationId,
      generationInputDigest: H,
    })
    const pause = (generationId: string) =>
      submit({
        action: "capacity_pause",
        ...base(generationId),
        reason: "superseded_by_new_sol_generation",
        noLiveProducerAttested: true,
      })
    const row = (id: string) =>
      db.recommendationPrecomputedGeneration.findUniqueOrThrow({
        where: { id },
      })

    async function build(protocolVersion = 3) {
      const generationId = `pause-${randomUUID()}`
      await db.recommendationPrecomputedGeneration.create({
        data: {
          id: generationId,
          modelId: "gpt-6-astra",
          promptVersion: "pause-native-fixture",
          inputDigest: H,
          sourceSetDigest: hash([sourceId]),
          inputCutoff: new Date(),
          expectedSourceCount: 1,
          protocolVersion,
          inputMode:
            protocolVersion === 3 ? "historical_analytics" : "content_only",
          inputSnapshotMode:
            protocolVersion === 3
              ? "ga_aggregate_capture_v1"
              : "observed_fenced",
          executionBackend:
            protocolVersion === 4 ? "codex_chatgpt_subscription" : null,
          manifestCommittedAt: new Date(),
        },
      })
      await db.recommendationPrecomputedBuildBudget.create({
        data: { generationId, consumedBytes: 123n },
      })
      await db.recommendationPrecomputedBuildSource.create({
        data: {
          generationId,
          sourceVideoId: sourceId,
          checkpoint: { stage: "preserved", cursor: {} },
          checkpointId: "saved-checkpoint",
          checkpointDigest: H,
        },
      })
      const probe = await submit({
        action: "capacity_probe",
        ...base(generationId),
      })
      const measurement = {
        measuredAt: new Date().toISOString(),
        clusterSystemId: probe.clusterSystemId as string,
        observedDbBytes: probe.observedDbBytes as number,
        availableBytes: 50_000_000_000,
        reserveBytes: 5_000_000_000,
        projectedBytes: 200_000_000,
        sampleSourceCount: 1,
        sampleBytes: 100_000,
        source: "operator_verified_pgdata_df",
      }
      // Fixture's existing admitted reservation, without inventing a production observation.
      await db.recommendationPrecomputedGeneration.update({
        where: { id: generationId },
        data: {
          capacityPreflight: {
            ...measurement,
            status: "passed",
            heldProjectionBytes: 200_000_000,
            lastPassedAt: new Date(Date.now() - 1000).toISOString(),
            blockedAt: null,
          },
        },
      })
      return { generationId, measurement }
    }
    async function attempt(
      generationId: string,
      closed = false,
      client: Pick<
        Prisma.TransactionClient,
        "recommendationPrecomputedExecutionAttempt"
      > = db,
    ) {
      return client.recommendationPrecomputedExecutionAttempt.create({
        data: {
          generationId,
          attemptId: randomUUID(),
          invocation: "start",
          accountRef: "pause-native-account",
          backend: "codex_chatgpt_subscription",
          billingBasis: "included_subscription",
          authMethod: "chatgpt",
          modelId: "gpt-6-astra",
          identityObservedAt: new Date(),
          allowanceObservedAt: new Date(),
          weeklyRemainingPercent: 70,
          startedAt: new Date(Date.now() - 1000),
          fiveHourKind: "limited",
          fiveHourRemainingPercent: 70,
          ...(closed ? { endedAt: new Date(), endReason: "paused" } : {}),
        },
      })
    }
    beforeAll(async () => {
      const url = new URL(env.DATABASE_URL)
      if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
        throw Error("loopback_database_required")
      sql = new Client({ connectionString: env.DATABASE_URL })
      await sql.connect()
      await sql.query(`CREATE SCHEMA "${schema}"`)
      await sql.query(`SET search_path TO "${schema}", public`)
      for (const migration of currentAdminMigrationSql)
        await sql.query(migration)
      url.searchParams.set("schema", schema)
      db = new PrismaClient<Prisma.PrismaClientOptions>({
        datasources: { db: { url: url.toString() } },
      })
      await db.video.create({
        data: { id: sourceId, coreId: sourceId, slug: sourceId },
      })
    }, 120_000)
    afterAll(async () => {
      await db?.$disconnect()
      if (sql) {
        await sql.query("ROLLBACK")
        await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await sql.end()
      }
    })

    it("authenticates and requires an explicit exact stopped-producer attestation", async () => {
      const g = await build()
      const body = {
        action: "capacity_pause",
        ...base(g.generationId),
        reason: "superseded_by_new_sol_generation",
      }
      await expect(
        submit({ ...body, noLiveProducerAttested: true }, null),
      ).rejects.toMatchObject({ code: "unauthorized" })
      await expect(submit(body)).rejects.toMatchObject({ code: "invalid" })
      await expect(
        submit({ ...body, noLiveProducerAttested: false }),
      ).rejects.toMatchObject({ code: "invalid" })
      await expect(
        submit({ ...body, reason: "cancel", noLiveProducerAttested: true }),
      ).rejects.toMatchObject({ code: "invalid" })
      await expect(
        submit({
          ...body,
          generationInputDigest: "b".repeat(64),
          noLiveProducerAttested: true,
        }),
      ).rejects.toMatchObject({ code: "conflict" })
      expect((await row(g.generationId)).status).toBe("incomplete")
    })

    it("pauses and replays without changing measurements, identities, checkpoint, budget or unknown usage", async () => {
      const g = await build(4)
      const closed = await attempt(g.generationId, true)
      await db.recommendationPrecomputedEdgeBatchCall.create({
        data: {
          generationId: g.generationId,
          callId: randomUUID(),
          attemptId: closed.attemptId,
          modelId: "gpt-6-astra",
          backend: "codex_chatgpt_subscription",
          promptVersion: "edge-batch-v1",
          schemaVersion: "edge-schema-v1",
          inputDigest: H,
          membershipDigest: H,
          selectedCorpusDigest: H,
          candidatePoolDigest: H,
          spanOfferDigest: H,
          spanOffers: [],
          requestDigest: H,
          startedAt: new Date(),
          status: "pending",
        },
      })
      const children = async () => ({
        sources: await db.recommendationPrecomputedBuildSource.findMany({
          where: { generationId: g.generationId },
        }),
        calls: await db.recommendationPrecomputedEdgeBatchCall.findMany({
          where: { generationId: g.generationId },
        }),
        attempts: await db.recommendationPrecomputedExecutionAttempt.findMany({
          where: { generationId: g.generationId },
        }),
        budget: await db.recommendationPrecomputedBuildBudget.findUnique({
          where: { generationId: g.generationId },
        }),
      })
      const before = await row(g.generationId),
        saved = await children()
      const first = await pause(g.generationId)
      expect(first).toMatchObject({
        state: "capacity_blocked",
        replay: false,
        capacity: {
          status: "paused",
          heldProjectionBytes: 200_000_000,
          pause: {
            reason: "superseded_by_new_sol_generation",
            noLiveProducerAttested: true,
            priorCapacity: before.capacityPreflight,
          },
        },
      })
      const after = await row(g.generationId)
      expect({
        ...after,
        status: before.status,
        capacityPreflight: before.capacityPreflight,
        rollbackRetentionHold: before.rollbackRetentionHold,
      }).toEqual(before)
      expect(after.rollbackRetentionHold).toBe(true)
      expect(await children()).toEqual(saved)
      expect(saved.calls[0]).toMatchObject({
        status: "pending",
        inputTokens: null,
        outputTokens: null,
        receiptDigest: null,
      })
      expect(await pause(g.generationId)).toEqual({ ...first, replay: true })
      expect(await row(g.generationId)).toEqual(after)
    })

    it("refuses open attempts, live leases, terminal states and protocol2", async () => {
      const g = await build(4)
      const open = await attempt(g.generationId)
      await expect(pause(g.generationId)).rejects.toThrow(
        "execution attempt is still open",
      )
      await db.recommendationPrecomputedExecutionAttempt.update({
        where: {
          generationId_attemptId: {
            generationId: g.generationId,
            attemptId: open.attemptId,
          },
        },
        data: { endedAt: new Date(), endReason: "paused" },
      })
      await db.recommendationPrecomputedBuildSource.update({
        where: {
          generationId_sourceVideoId: {
            generationId: g.generationId,
            sourceVideoId: sourceId,
          },
        },
        data: {
          state: "claimed",
          leaseToken: randomUUID(),
          leaseExpiresAt: new Date(Date.now() + 60000),
        },
      })
      await expect(pause(g.generationId)).rejects.toThrow(
        "source lease is still live",
      )
      const protocol2 = await build(2)
      await expect(pause(protocol2.generationId)).rejects.toThrow(
        "cannot be capacity paused",
      )
      const terminal = await build()
      await db.recommendationPrecomputedGeneration.update({
        where: { id: terminal.generationId },
        data: { status: "complete", completedAt: new Date() },
      })
      await expect(pause(terminal.generationId)).rejects.toThrow(
        "cannot be capacity paused",
      )
    })

    it("charges pre-pause samples, releases only for newer physical samples, and preserves provenance on refresh", async () => {
      const writing = await build(),
        waiting = await build()
      const older = new Date(Date.now() + 1).toISOString()
      // Move past fixture admission epochs and take the real probe before pause.
      await new Promise((resolve) => setTimeout(resolve, 5))
      const observed = await submit({
        action: "capacity_probe",
        ...base(waiting.generationId),
      })
      await pause(writing.generationId)
      const prior = (await row(writing.generationId))
        .capacityPreflight as Record<string, Prisma.JsonValue>
      await expect(
        submit({
          action: "capacity",
          ...base(writing.generationId),
          measurement: { ...writing.measurement, measuredAt: older },
        }),
      ).rejects.toThrow("postdate the pause")
      const all = await db.recommendationPrecomputedGeneration.findMany({
        select: { id: true, status: true, capacityPreflight: true },
      })
      const otherActive = all
        .filter(
          (g) =>
            g.id !== waiting.generationId &&
            g.id !== writing.generationId &&
            g.status === "incomplete",
        )
        .reduce(
          (sum, g) =>
            sum +
            Number(
              (g.capacityPreflight as Record<string, unknown>)
                ?.heldProjectionBytes ?? 0,
            ),
          0,
        )
      const measurement = {
        ...waiting.measurement,
        measuredAt: older,
        observedDbBytes: observed.observedDbBytes,
        availableBytes: 5_100_000_000 + otherActive + 100_000_000,
        projectedBytes: 200_000_000,
      }
      expect(
        await submit({
          action: "capacity",
          ...base(waiting.generationId),
          measurement,
        }),
      ).toMatchObject({
        state: "capacity_blocked",
        capacity: { otherReservedBytes: otherActive + 200_000_000 },
      })
      await new Promise((resolve) => setTimeout(resolve, 5))
      const fresh = await submit({
        action: "capacity_probe",
        ...base(waiting.generationId),
      })
      expect(
        await submit({
          action: "capacity",
          ...base(waiting.generationId),
          measurement: {
            ...measurement,
            measuredAt: new Date().toISOString(),
            observedDbBytes: fresh.observedDbBytes,
            availableBytes: measurement.availableBytes + 100_000_000,
          },
        }),
      ).toMatchObject({
        state: "incomplete",
        capacity: { otherReservedBytes: otherActive },
      })
      await new Promise((resolve) => setTimeout(resolve, 5))
      const refreshed = await submit({
        action: "capacity",
        ...base(writing.generationId),
        measurement: {
          ...writing.measurement,
          measuredAt: new Date().toISOString(),
          observedDbBytes: fresh.observedDbBytes,
        },
      })
      expect(refreshed).toMatchObject({
        state: "incomplete",
        capacity: { status: "passed", pause: prior.pause },
      })
      expect((await row(writing.generationId)).rollbackRetentionHold).toBe(true)
      // The new provenance is excluded from measurement equality, so ordinary replay remains stable.
      const capacity = refreshed.capacity as Record<string, unknown>
      const fields = Object.keys(writing.measurement)
      expect(
        await submit({
          action: "capacity",
          ...base(writing.generationId),
          measurement: Object.fromEntries(fields.map((k) => [k, capacity[k]])),
        }),
      ).toMatchObject({ replay: true })
    })

    it("protects idle abandonment AND terminal checkpoint pruning with the preservation hold", async () => {
      const g = await build()
      await pause(g.generationId)
      const ancient = new Date(Date.now() - 200 * 86400000)
      await db.recommendationPrecomputedGeneration.update({
        where: { id: g.generationId },
        data: { createdAt: ancient, manifestCommittedAt: ancient },
      })
      const before = await db.recommendationPrecomputedBuildSource.findMany({
        where: { generationId: g.generationId },
      })
      await db.$transaction((tx) =>
        purgeExpiredPrecomputedGenerations(
          tx,
          new Date(Date.now() + 400 * 86400000),
          1,
        ),
      )
      expect((await row(g.generationId)).status).toBe("capacity_blocked")
      expect(
        await db.recommendationPrecomputedBuildSource.findMany({
          where: { generationId: g.generationId },
        }),
      ).toEqual(before)
      await db.recommendationPrecomputedGeneration.update({
        where: { id: g.generationId },
        data: {
          status: "failed",
          failedAt: ancient,
          failureCode: "fixture_failure",
        },
      })
      await db.$transaction((tx) =>
        purgeExpiredPrecomputedGenerations(
          tx,
          new Date(Date.now() + 400 * 86400000),
          1,
        ),
      )
      expect((await row(g.generationId)).status).toBe("failed")
      expect(
        await db.recommendationPrecomputedBuildSource.findMany({
          where: { generationId: g.generationId },
        }),
      ).toEqual(before)
    })

    it("resumes only the original model with explicit fresh attempt and post-pause capacity", async () => {
      const g = await build(4)
      await pause(g.generationId)
      const executionAttempt = {
        attemptId: randomUUID(),
        invocation: "resume",
        accountRef: "pause-native-account",
        backend: "codex_chatgpt_subscription",
        billingBasis: "included_subscription",
        authMethod: "chatgpt",
        modelId: "gpt-6-astra",
        identityObservedAt: new Date().toISOString(),
        allowanceObservedAt: new Date().toISOString(),
        weeklyRemainingPercent: 70,
        fiveHour: { kind: "limited", remainingPercent: 70 },
      }
      await expect(
        submit({
          action: "resume_attempt",
          ...base(g.generationId),
          executionAttempt: {
            ...executionAttempt,
            modelId: "gpt-6.1-sol",
          },
        }),
      ).rejects.toThrow("not resumable by subscription")
      await submit({
        action: "resume_attempt",
        ...base(g.generationId),
        executionAttempt,
      })
      await expect(
        submit({
          action: "claim",
          ...base(g.generationId),
          attemptId: executionAttempt.attemptId,
          sourceVideoId: sourceId,
          claimId: "after-pause",
        }),
      ).rejects.toThrow("Measured capacity preflight is required")
      await new Promise((resolve) => setTimeout(resolve, 5))
      const observed = await submit({
        action: "capacity_probe",
        ...base(g.generationId),
      })
      expect(
        await submit({
          action: "capacity",
          ...base(g.generationId),
          attemptId: executionAttempt.attemptId,
          measurement: {
            ...g.measurement,
            measuredAt: new Date().toISOString(),
            observedDbBytes: observed.observedDbBytes,
          },
        }),
      ).toMatchObject({ state: "incomplete" })
      expect(await row(g.generationId)).toMatchObject({
        modelId: "gpt-6-astra",
        rollbackRetentionHold: true,
        capacityPreflight: {
          status: "passed",
          pause: { reason: "superseded_by_new_sol_generation" },
        },
      })
    })

    it("waits for a concurrent attempt writer then refuses its committed open attempt", async () => {
      const g = await build(4)
      let unlock!: () => void
      let signalLocked!: () => void
      const gate = new Promise<void>((resolve) => {
        unlock = resolve
      })
      const locked = new Promise<void>((resolve) => {
        signalLocked = resolve
      })
      const writer = db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM recommendation_precomputed_generation WHERE id = ${g.generationId} FOR UPDATE`
        await attempt(g.generationId, false, tx)
        signalLocked()
        await gate
      })
      await locked
      let settled = false
      const pending = pause(g.generationId).then(
        (value) => {
          settled = true
          return value
        },
        (error) => {
          settled = true
          return error
        },
      )
      try {
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(settled).toBe(false)
      } finally {
        unlock()
      }
      await writer
      expect(await pending).toMatchObject({
        code: "conflict",
        message: "An execution attempt is still open",
      })
      expect((await row(g.generationId)).status).toBe("incomplete")
    })

    it("serializes concurrent pause replays under the generation row lock", async () => {
      const g = await build()
      const outcomes = await Promise.all([
        pause(g.generationId),
        pause(g.generationId),
      ])
      expect(outcomes.map((r) => r.replay).sort()).toEqual([false, true])
      expect(outcomes[0].capacity).toEqual(outcomes[1].capacity)
    })
  },
)
