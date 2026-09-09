import Redis from "ioredis"
import { env } from "@/config/env"
import {
  createEvidenceObserver,
  EVIDENCE_COUNTER_SCRIPT,
  EVIDENCE_COUNTER_TTL_SECONDS,
} from "./evidence-observability-contract"
export type { RecommendationEvidenceObservation } from "./evidence-observability-contract"

let client: Redis | undefined
let retryAt = 0
let connection: Promise<void> | undefined
export async function evidenceCollector(): Promise<Redis | null> {
  if (!env.RECOMMENDATION_EVIDENCE_REDIS_URL || Date.now() < retryAt)
    return null
  if (!client) {
    client = new Redis(env.RECOMMENDATION_EVIDENCE_REDIS_URL, {
      lazyConnect: true,
      connectTimeout: 150,
      commandTimeout: 150,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    })
    client.on("error", () => {})
    connection = client.connect()
  }
  const current = client
  try {
    await connection
    return current
  } catch {
    disconnectEvidenceCollector(current)
    throw new Error("collector_unavailable")
  }
}
export function disconnectEvidenceCollector(
  expected: Redis | undefined = client,
) {
  if (client !== expected) return
  try {
    client?.disconnect()
  } catch {
    /* Collector shutdown must remain isolated. */
  }
  client = undefined
  connection = undefined
  retryAt = Date.now() + 5_000
}
export const observeRecommendationEvidence = createEvidenceObserver({
  service: "admin",
  write: async (key, field) => {
    const redis = await evidenceCollector()
    if (!redis) throw new Error("collector_unavailable")
    try {
      return await redis.eval(
        EVIDENCE_COUNTER_SCRIPT,
        1,
        key,
        field,
        String(EVIDENCE_COUNTER_TTL_SECONDS),
      )
    } catch {
      disconnectEvidenceCollector(redis)
      throw new Error("collector_unavailable")
    }
  },
  log: (message) => console.info(message),
})
