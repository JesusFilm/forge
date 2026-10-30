import { describe, expect, it, vi } from "vitest"
import type { Prisma, PrismaClient } from "@prisma/client"
import { createRecommendationDeliveryDependencies } from "./delivery.factory"
import { input, makeHarness } from "./delivery.service.test-helpers"
import { BOOTSTRAP_RECOMMENDATION_MANIFEST_ID } from "./manifest.service"

vi.mock("@/config/env", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/env")>()
  return {
    ...original,
    env: { ...original.env, RECOMMENDATION_SEMANTIC_SERVING_ENABLED: "true" },
  }
})

vi.mock("./runtime-token", () => ({
  createRuntimeRecommendationTokenService: () => ({ activeKid: "test-key" }),
}))

describe("recommendation delivery during background cleanup", () => {
  it.each(["overdue", "missing_watermark", "unavailable"])(
    "serves public Watch cards independently of %s cleanup health",
    async (health) => {
      const retentionReads = vi.fn(() => {
        if (health === "unavailable") throw new Error("cleanup probe failed")
        return [
          {
            latestSuccessAt: health === "missing_watermark" ? null : new Date(),
            oldestOverdueAt: health === "overdue" ? new Date(0) : null,
          },
        ]
      })
      const tx = {
        $queryRaw: vi.fn(async (query: Prisma.Sql | TemplateStringsArray) => {
          const sql = "sql" in query ? query.sql : query.join("")
          return sql.includes("recommendation_retention_run")
            ? retentionReads()
            : []
        }),
        recommendationServingControl: {
          findUnique: vi.fn(async () => ({
            enabled: true,
            manifestId: BOOTSTRAP_RECOMMENDATION_MANIFEST_ID,
            emergencyRevokedKids: [],
            manifest: {
              id: BOOTSTRAP_RECOMMENDATION_MANIFEST_ID,
              strategyVersion: BOOTSTRAP_RECOMMENDATION_MANIFEST_ID,
              contractVersion: "semantic-recommendation-v1",
              surfaceVersion: "watch-below-player-v1",
              generator: "semantic",
              enabled: true,
              maxItems: 6,
            },
          })),
        },
      }
      const prisma = {
        $transaction: vi.fn(async (work: (client: typeof tx) => unknown) =>
          work(tx),
        ),
      }
      const dependencies = createRecommendationDeliveryDependencies(
        prisma as unknown as PrismaClient,
      )
      const h = makeHarness({ getServingState: dependencies.getServingState })

      const result = await h.service.deliver(input(`cleanup-${health}`))

      expect(result).toMatchObject({
        surfaceVersion: "watch-below-player-v1",
        result: "served",
        items: [{ targetMediaId: "target-video" }],
      })
      expect([...h.requests.values()]).toEqual([
        expect.objectContaining({ state: "ISSUED" }),
      ])
      expect(retentionReads).not.toHaveBeenCalled()
    },
  )
})
