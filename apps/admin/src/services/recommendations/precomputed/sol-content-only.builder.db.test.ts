import { createHash, randomUUID } from "node:crypto"
import { PrismaClient, type Prisma } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { currentAdminMigrationSql } from "../current-schema.test-fixture"
import { submitDurablePrecomputedRecommendation } from "./durable-build"

const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex")
const H = "a".repeat(64)
const sourceId = `content-source-${randomUUID()}`
const schema = `content_only_${Date.now()}_${Math.random().toString(36).slice(2)}`
describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "protocol 4 intentional content-only native completion",
  () => {
    let db: PrismaClient
    let sql: Client
    const submit = (v: unknown) =>
      submitDurablePrecomputedRecommendation(db, v, "Bearer preview-test-key")
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
    }, 120000)
    afterAll(async () => {
      await db?.$disconnect()
      if (sql) {
        await sql.query("ROLLBACK")
        await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await sql.end()
      }
    })
    async function build() {
      const generationId = `content-only-${randomUUID()}`
      const attemptId = randomUUID()
      // Deliberate local completed-empty fixture: native completion must verify it;
      // real edge execution/resume is covered independently and by the runner test.
      await db.recommendationPrecomputedGeneration.create({
        data: {
          id: generationId,
          modelId: "gpt-6.1-sol",
          promptVersion: "subscription-profile-edge-content-only-v1",
          inputDigest: H,
          sourceSetDigest: hash([sourceId]),
          inputCutoff: new Date(),
          expectedSourceCount: 1,
          protocolVersion: 4,
          inputMode: "content_only",
          inputSnapshotMode: "observed_fenced",
          executionBackend: "codex_chatgpt_subscription",
          manifestCommittedAt: new Date(),
          capacityPreflight: {
            status: "passed",
            measuredAt: new Date().toISOString(),
            lastPassedAt: new Date().toISOString(),
          },
        },
      })
      await db.recommendationPrecomputedExecutionAttempt.create({
        data: {
          generationId,
          attemptId,
          invocation: "start",
          accountRef: "native-content-only",
          backend: "codex_chatgpt_subscription",
          billingBasis: "included_subscription",
          authMethod: "chatgpt",
          modelId: "gpt-6.1-sol",
          identityObservedAt: new Date(),
          allowanceObservedAt: new Date(),
          weeklyRemainingPercent: 70,
          fiveHourKind: "limited",
          fiveHourRemainingPercent: 70,
          startedAt: new Date(),
        },
      })
      await db.recommendationPrecomputedBuildSource.create({
        data: {
          generationId,
          sourceVideoId: sourceId,
          state: "complete_empty",
        },
      })
      await db.recommendationPrecomputedSource.create({
        data: {
          generationId,
          sourceVideoId: sourceId,
          payload: [],
          submissionDigest: H,
          acceptedCount: 0,
        },
      })
      return { generationId, generationInputDigest: H, attemptId }
    }
    it("completes/replays a valid intentionally analytics-disabled build without changing public control", async () => {
      const before = await sql.query(
        "SELECT to_jsonb(t) AS row FROM recommendation_precomputed_public_control t ORDER BY id",
      )
      const g = await build()
      expect(await submit({ action: "complete", ...g })).toMatchObject({
        state: "complete",
        replay: false,
      })
      expect(await submit({ action: "complete", ...g })).toMatchObject({
        state: "complete",
        replay: true,
      })
      const row =
        await db.recommendationPrecomputedGeneration.findUniqueOrThrow({
          where: { id: g.generationId },
        })
      expect(row.historicalQualification).toBeNull()
      expect(row.historicalQualificationDigest).toBeNull()
      expect(
        (
          await sql.query(
            "SELECT to_jsonb(t) AS row FROM recommendation_precomputed_public_control t ORDER BY id",
          )
        ).rows,
      ).toEqual(before.rows)
    })
    it.each(["coverage", "capacity", "final-row", "history"])(
      "refuses %s defects",
      async (mode) => {
        const g = await build()
        if (mode === "coverage")
          await db.recommendationPrecomputedBuildSource.updateMany({
            where: { generationId: g.generationId },
            data: { state: "pending" },
          })
        if (mode === "capacity")
          await db.recommendationPrecomputedGeneration.update({
            where: { id: g.generationId },
            data: { capacityPreflight: { status: "failed" } },
          })
        if (mode === "final-row")
          await db.recommendationPrecomputedSource.deleteMany({
            where: { generationId: g.generationId },
          })
        if (mode === "history")
          await db.recommendationPrecomputedBuildSource.updateMany({
            where: { generationId: g.generationId },
            data: { historicalProvenance: { injected: true } },
          })
        await expect(
          submit({ action: "complete", ...g }),
        ).rejects.toMatchObject({ code: "conflict" })
        expect(
          (
            await db.recommendationPrecomputedGeneration.findUniqueOrThrow({
              where: { id: g.generationId },
            })
          ).status,
        ).toBe("incomplete")
      },
    )
    it("preserves unknown physical usage and refuses completion even with finalized source rows", async () => {
      const g = await build()
      const callId = randomUUID()
      await db.recommendationPrecomputedEdgeBatchCall.create({
        data: {
          generationId: g.generationId,
          attemptId: g.attemptId,
          callId,
          modelId: "gpt-6.1-sol",
          backend: "codex_chatgpt_subscription",
          promptVersion: "shared-edge-content-only-v1",
          schemaVersion: "shared-edge-schema-v1",
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
      await expect(submit({ action: "complete", ...g })).rejects.toMatchObject({
        code: "conflict",
      })
      const row =
        await db.recommendationPrecomputedEdgeBatchCall.findUniqueOrThrow({
          where: {
            generationId_callId: { generationId: g.generationId, callId },
          },
        })
      expect(row.status).toBe("pending")
      expect(row.inputTokens).toBeNull()
      expect(row.outputTokens).toBeNull()
    })
    it("rejects an empty source's invented historical digest before applying any checkpoint", async () => {
      const g = await build()
      await expect(
        submit({
          action: "edge_source_close_empty",
          ...g,
          sourceVideoId: sourceId,
          leaseToken: randomUUID(),
          expectedRevision: 0,
          sourceProfileKey: H,
          sourceCandidateCount: 0,
          sourceCandidateDigest: hash([]),
          candidatePoolDigest: H,
          historicalRefDigest: H,
        }),
      ).rejects.toMatchObject({
        code: "invalid",
        message: expect.stringContaining("analytics history"),
      })
      expect(
        (
          await db.recommendationPrecomputedBuildSource.findUniqueOrThrow({
            where: {
              generationId_sourceVideoId: {
                generationId: g.generationId,
                sourceVideoId: sourceId,
              },
            },
          })
        ).checkpointRevision,
      ).toBe(0)
    })
    it("rejects injected GA history and member historical digest before reservation", async () => {
      const g = await build()
      const navigationCoverage = {
        candidateEvents: 0,
        qualifiedEvents: 0,
        homeEvents: 0,
        selfEvents: 0,
        crossHostEvents: 0,
        malformedEvents: 0,
        unmappedEvents: 0,
        ambiguousEvents: 0,
      }
      await expect(
        submit({
          action: "source_history",
          ...g,
          sourceVideoId: sourceId,
          leaseToken: randomUUID(),
          history: {
            evidenceKind: "referrer_navigation_v1",
            sourceResource: "properties/320198532",
            queryId: "injected",
            rangeStart: "2026-10-01",
            rangeEnd: "2026-10-18",
            resultDigest: H,
            rowCount: 0,
            mappedRows: 0,
            unmappedRows: 0,
            pageCount: 0,
            queryExecutionCount: 0,
            navigationCoverage,
            qualificationDigest: H,
            status: "complete",
          },
        }),
      ).rejects.toMatchObject({
        code: "conflict",
        message: expect.stringContaining("cannot accept analytics history"),
      })
      await expect(
        submit({
          action: "edge_batch_start",
          ...g,
          callId: randomUUID(),
          modelId: "gpt-6.1-sol",
          backend: "codex_chatgpt_subscription",
          promptVersion: "shared-edge-content-only-v1",
          schemaVersion: "shared-edge-schema-v1",
          inputDigest: H,
          membershipDigest: H,
          selectedCorpusDigest: H,
          candidatePoolDigest: H,
          captureRefDigest: null,
          spanOfferDigest: hash([]),
          spanOffers: [],
          startedAt: new Date().toISOString(),
          members: [
            {
              sourceVideoId: sourceId,
              leaseToken: randomUUID(),
              checkpointRevision: 0,
              pageIndex: 0,
              sourceProfileKey: H,
              candidates: [
                { targetVideoId: "target", targetProfileKey: H, poolRank: 0 },
              ],
              candidatePageDigest: H,
              sourceCandidateCount: 1,
              sourceCandidateDigest: H,
              historicalRefDigest: H,
            },
          ],
        }),
      ).rejects.toMatchObject({
        code: "invalid",
        message: expect.stringContaining("historical capture or history"),
      })
      expect(
        await db.recommendationPrecomputedEdgeBatchCall.count({
          where: { generationId: g.generationId },
        }),
      ).toBe(0)
      expect(
        (
          await db.recommendationPrecomputedBuildSource.findUniqueOrThrow({
            where: {
              generationId_sourceVideoId: {
                generationId: g.generationId,
                sourceVideoId: sourceId,
              },
            },
          })
        ).historicalProvenance,
      ).toBeNull()
    })
  },
)
