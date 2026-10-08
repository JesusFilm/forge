import { PrismaClient, type Prisma } from "@prisma/client"
import { createHash, randomUUID } from "node:crypto"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { env } from "@/config/env"
import { currentAdminMigrationSql } from "@/services/recommendations/current-schema.test-fixture"
import { POST } from "./route"

let fixturePrisma: PrismaClient
// Substitute only the connection: the route and services still use native
// PostgreSQL with the current migrations in this test's isolated schema.
vi.mock("@/db/client", () => ({
  get prisma() {
    return fixturePrisma
  },
}))

describe("private precomputed recommendation producer", () => {
  it("denies writes without its dedicated bearer", async () => {
    const response = await POST(
      new Request(
        "http://localhost/api/internal/mastra/precomputed-recommendations",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "complete",
            generationId: "untrusted",
          }),
        },
      ),
    )
    expect(response.status).toBe(401)
  })
})

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "authenticated producer on PostgreSQL",
  () => {
    let admin: Client
    const schema = `precomputed_route_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const generationId = `route-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`
    beforeAll(async () => {
      admin = new Client({ connectionString: env.DATABASE_URL })
      await admin.connect()
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`SET search_path TO "${schema}", public`)
      for (const migration of currentAdminMigrationSql)
        await admin.query(migration)
      const url = new URL(env.DATABASE_URL)
      url.searchParams.set("schema", schema)
      fixturePrisma = new PrismaClient<Prisma.PrismaClientOptions>({
        datasources: { db: { url: url.toString() } },
      })
    }, 120_000)

    afterAll(async () => {
      await fixturePrisma?.$disconnect()
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
    })

    function post(body: unknown) {
      return POST(
        new Request(
          "http://localhost/api/internal/mastra/precomputed-recommendations",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer preview-test-key",
            },
            body: JSON.stringify(body),
          },
        ),
      )
    }

    it("starts and completes an authenticated, empty private generation", async () => {
      const started = await post({
        action: "start",
        generationId,
        modelId: "fixture",
        promptVersion: "route-v1",
        inputDigest: "7".repeat(64),
        sourceSetDigest: createHash("sha256").update("[]").digest("hex"),
        inputCutoff: "2026-10-05T00:00:00Z",
        expectedSourceCount: 0,
      })
      expect(started.status).toBe(200)
      expect(await started.json()).toMatchObject({
        result: { state: "incomplete", replay: false },
      })
      const completed = await post({ action: "complete", generationId })
      expect(await completed.json()).toMatchObject({
        result: { state: "complete" },
      })
    })

    it("routes a bounded subscription attempt through the existing producer bearer", async () => {
      const id = `${generationId}-subscription`
      const now = new Date().toISOString()
      const attemptId = randomUUID()
      const started = await post({
        action: "start",
        generationId: id,
        protocolVersion: 2,
        modelId: "gpt-6-astra",
        promptVersion: "route-v1",
        inputDigest: "7".repeat(64),
        sourceSetDigest: createHash("sha256").update("[]").digest("hex"),
        inputCutoff: "2026-10-05T00:00:00Z",
        expectedSourceCount: 0,
        inputMode: "content_only",
        executionAttempt: {
          attemptId,
          invocation: "start",
          accountRef: "local-account-ref-123",
          backend: "codex_chatgpt_subscription",
          billingBasis: "included_subscription",
          authMethod: "chatgpt",
          modelId: "gpt-6-astra",
          identityObservedAt: now,
          allowanceObservedAt: now,
          weeklyRemainingPercent: 50,
          fiveHour: { kind: "limited", remainingPercent: 50 },
        },
      })
      expect(started.status).toBe(200)
      expect(await started.json()).toMatchObject({
        result: {
          executionBackend: "codex_chatgpt_subscription",
          attemptId,
        },
      })
      const status = await post({
        action: "status",
        generationId: id,
        generationInputDigest: "7".repeat(64),
      })
      expect(status.status).toBe(200)
      expect(await status.json()).toMatchObject({
        result: {
          executionBackend: "codex_chatgpt_subscription",
          usage: {
            attempts: [{ accountRef: "local-account-ref-123", callCount: 0 }],
          },
        },
      })
    })

    it("rejects a profile action above the 64 KiB wire ceiling", async () => {
      const response = await post({
        action: "profile_status",
        generationId: "fixture",
        generationInputDigest: "7".repeat(64),
        cacheKey: "8".repeat(64),
        padding: "x".repeat(70_000),
      })
      expect(response.status).toBe(413)
    })
  },
)
