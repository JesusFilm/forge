import { randomUUID } from "node:crypto"
import Redis from "ioredis"
import { describe, expect, it } from "vitest"
import { env } from "@/config/env"
import {
  EVIDENCE_COUNTER_PREFIX,
  EVIDENCE_COUNTER_SCRIPT,
  EVIDENCE_COUNTER_TTL_SECONDS,
  evidenceCounterField,
} from "./evidence-observability-contract"
import { loadEvidenceTransportOverview } from "./admin-ops/evidence-transport.service"

describe.skipIf(env.RECOMMENDATION_REDIS_TEST !== "1")(
  "evidence operational collector against Redis",
  () => {
    it("atomically counts concurrent observations with TTL and reconciles both sources", async () => {
      if (!env.RECOMMENDATION_EVIDENCE_REDIS_URL)
        throw new Error("Explicit local collector URL required")
      const redis = new Redis(env.RECOMMENDATION_EVIDENCE_REDIS_URL, {
        maxRetriesPerRequest: 0,
      })
      const now = new Date()
      const hour = Math.floor(now.getTime() / 3_600_000)
      const prefix = `test:recommendation-evidence:${randomUUID()}`
      const keys = [`${prefix}:web:${hour}`, `${prefix}:admin:${hour}`]
      const field = evidenceCounterField({
        action: "facts",
        outcome: "accepted",
        httpStatus: 200,
      })
      try {
        await Promise.all(
          keys.flatMap((key) =>
            Array.from({ length: 8 }, () =>
              redis.eval(
                EVIDENCE_COUNTER_SCRIPT,
                1,
                key,
                field,
                String(EVIDENCE_COUNTER_TTL_SECONDS),
              ),
            ),
          ),
        )
        expect(await redis.hget(keys[0], field)).toBe("8")
        expect(await redis.ttl(keys[0])).toBeGreaterThan(47 * 3600)
        expect(await redis.ttl(keys[0])).toBeLessThanOrEqual(48 * 3600)
        const overview = await loadEvidenceTransportOverview(
          now,
          async (requested) => {
            const pipeline = redis.pipeline()
            for (const key of requested)
              pipeline.hgetall(key.replace(EVIDENCE_COUNTER_PREFIX, prefix))
            const results = await pipeline.exec()
            if (!results || results.some(([error]) => error))
              throw new Error("Fixture read failed")
            return results.map(([, row]) => row as Record<string, string>)
          },
        )
        expect(overview.state).toBe("observed")
        expect(overview.rows).toEqual([
          expect.objectContaining({ source: "web", count: 8 }),
          expect.objectContaining({ source: "admin", count: 8 }),
        ])
      } finally {
        await redis.del(...keys)
        await redis.quit()
      }
    })
  },
)
