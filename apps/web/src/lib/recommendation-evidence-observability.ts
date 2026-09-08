import "server-only"
import { createClient } from "redis"
import { env } from "@/env"
import {
  createEvidenceObserver,
  EVIDENCE_COUNTER_SCRIPT,
  EVIDENCE_COUNTER_TTL_SECONDS,
} from "./recommendation-evidence-observability-contract"
export type { RecommendationEvidenceObservation } from "./recommendation-evidence-observability-contract"

let client: ReturnType<typeof createClient> | undefined
let connection: Promise<unknown> | undefined
let retryAt = 0
function closeCollector(current: ReturnType<typeof createClient>) {
  try {
    if (current.isOpen) current.destroy()
  } catch {
    /* A concurrent timeout may already have closed it. */
  }
}
async function write(key: string, field: string) {
  const url = env.RECOMMENDATION_EVIDENCE_REDIS_URL
  if (!url || Date.now() < retryAt) throw new Error("collector_unavailable")
  if (!client) {
    client = createClient({
      url,
      socket: { connectTimeout: 150, reconnectStrategy: false },
      disableOfflineQueue: true,
    })
    client.on("error", () => {})
    connection = client.connect()
  }
  const current = client
  const timer = setTimeout(() => {
    closeCollector(current)
    if (client === current) {
      client = undefined
      connection = undefined
      retryAt = Date.now() + 5_000
    }
  }, 150)
  try {
    await connection
    return await current.eval(EVIDENCE_COUNTER_SCRIPT, {
      keys: [key],
      arguments: [field, String(EVIDENCE_COUNTER_TTL_SECONDS)],
    })
  } catch {
    closeCollector(current)
    if (client === current) {
      client = undefined
      connection = undefined
      retryAt = Date.now() + 5_000
    }
    throw new Error("collector_unavailable")
  } finally {
    clearTimeout(timer)
  }
}
export const observeRecommendationEvidence = createEvidenceObserver({
  service: "web",
  write,
  log: (message) => console.info(message),
})
