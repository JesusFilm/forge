import {
  evidenceCollector,
  disconnectEvidenceCollector,
} from "../evidence-observability"
import {
  EVIDENCE_COUNTER_PREFIX,
  parseEvidenceCounterField,
  type RecommendationEvidenceObservation,
} from "../evidence-observability-contract"

export type EvidenceTransportOverview = {
  state: "unknown" | "observed" | "partial"
  start: Date
  end: Date
  rows: Array<
    RecommendationEvidenceObservation & {
      source: "web" | "admin"
      count: number
    }
  >
  suppressed: boolean
}
// Operational observations are best effort, not an authoritative committed-evidence ledger.
export async function loadEvidenceTransportOverview(
  now = new Date(),
  read: (
    keys: string[],
  ) => Promise<Array<Record<string, string>>> = readCounters,
): Promise<EvidenceTransportOverview> {
  const hour = Math.floor(now.getTime() / 3_600_000)
  const sources = ["web", "admin"] as const
  const keys = sources.flatMap((source) =>
    Array.from(
      { length: 24 },
      (_, i) => `${EVIDENCE_COUNTER_PREFIX}:${source}:${hour - 23 + i}`,
    ),
  )
  const result: EvidenceTransportOverview = {
    state: "unknown",
    start: new Date((hour - 23) * 3_600_000),
    end: now,
    rows: [],
    suppressed: false,
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const buckets = await Promise.race([
      read(keys),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("collector_timeout")), 150)
      }),
    ])
    if (buckets.length !== keys.length) return result
    const rows = new Map<string, EvidenceTransportOverview["rows"][number]>()
    const observed = new Set<string>()
    let incomplete = false
    for (let i = 0; i < buckets.length; i++) {
      const source = sources[Math.floor(i / 24)]
      for (const [field, raw] of Object.entries(buckets[i])) {
        if (!/^\d{1,10}$/.test(raw)) {
          incomplete = true
          continue
        }
        const count = Number(raw)
        if (!Number.isSafeInteger(count) || count <= 0) {
          incomplete = true
          continue
        }
        if (field === "overflow") {
          incomplete = true
          continue
        }
        const event = parseEvidenceCounterField(field)
        if (!event) {
          incomplete = true
          continue
        }
        observed.add(source)
        const key = `${source}:${field}`
        const previous = rows.get(key)
        if (previous) previous.count += count
        else if (rows.size < 512) rows.set(key, { ...event, source, count })
        else incomplete = true
      }
    }
    result.suppressed = [...rows.values()].some((row) => row.count < 3)
    result.rows = [...rows.values()]
      .filter((row) => row.count >= 3)
      .sort((a, b) => b.count - a.count)
      .slice(0, 100)
    if (rows.size > 100) incomplete = true
    result.state =
      observed.size === 0
        ? "unknown"
        : observed.size < 2 || incomplete
          ? "partial"
          : "observed"
    return result
  } catch {
    return result
  } finally {
    clearTimeout(timer)
  }
}
async function readCounters(
  keys: string[],
): Promise<Array<Record<string, string>>> {
  let redis: Awaited<ReturnType<typeof evidenceCollector>> = null
  try {
    redis = await evidenceCollector()
    if (!redis) throw new Error("collector_unavailable")
    const pipeline = redis.pipeline()
    for (const key of keys) pipeline.hgetall(key)
    const responses = await pipeline.exec()
    if (!responses || responses.some(([error]) => error))
      throw new Error("collector_unavailable")
    return responses.map(([, value]) => value as Record<string, string>)
  } catch {
    if (redis) disconnectEvidenceCollector(redis)
    throw new Error("collector_unavailable")
  }
}
