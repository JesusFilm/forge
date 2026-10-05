import { PrismaClient } from "@prisma/client"
import { createHash } from "node:crypto"
import { afterAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { POST } from "./route"

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
    const prisma = new PrismaClient()
    const generationId = `route-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`
    afterAll(async () => {
      await prisma.recommendationPrecomputedGeneration.deleteMany({
        where: { id: generationId },
      })
      await prisma.$disconnect()
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
  },
)
