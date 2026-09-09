// Mirrored across Web/Admin: the parity test protects the operational wire format.
export const EVIDENCE_VOCABULARY = {
  action: [
    "playback",
    "context",
    "claim",
    "facts",
    "evidence",
    "select",
    "finalize",
  ],
  outcome: [
    "accepted",
    "rejected",
    "failed",
    "ambiguous",
    "replay",
    "conflict",
  ],
  reason: [
    "none",
    "invalid_binding",
    "invalid_request",
    "forbidden",
    "crawler_rejected",
    "rate_limited",
    "admission_unavailable",
    "upstream_unavailable",
    "payload_conflict",
    "transaction_busy",
    "transaction_exhausted",
    "unknown",
  ],
  timeoutStage: ["none", "upstream", "transaction", "acknowledgement"],
  retryDisposition: [
    "none",
    "terminal",
    "retryable",
    "idempotent_replay",
    "exhausted",
  ],
  crawler: ["unknown", "recognized", "not_recognized"],
  httpStatus: [
    200, 202, 400, 401, 403, 408, 409, 413, 415, 429, 500, 502, 503, 504,
  ],
} as const
type Vocabulary = typeof EVIDENCE_VOCABULARY
export type RecommendationEvidenceObservation = {
  action: Vocabulary["action"][number]
  outcome: Vocabulary["outcome"][number]
  reason?: Vocabulary["reason"][number]
  timeoutStage?: Vocabulary["timeoutStage"][number]
  retryDisposition?: Vocabulary["retryDisposition"][number]
  crawler?: Vocabulary["crawler"][number]
  httpStatus?: Vocabulary["httpStatus"][number]
  retryAttempt?: number
}
export function normalizeEvidenceObservation(
  input: unknown,
): RecommendationEvidenceObservation | null {
  if (!input || typeof input !== "object") return null
  const candidate = input as Record<string, unknown>
  const result: Record<string, string | number> = {}
  for (const [key, values] of Object.entries(EVIDENCE_VOCABULARY)) {
    const value = candidate[key]
    if (value === undefined && key !== "action" && key !== "outcome") continue
    if (!(values as readonly unknown[]).includes(value)) return null
    result[key] = value as string | number
  }
  if (candidate.retryAttempt !== undefined) {
    if (
      typeof candidate.retryAttempt !== "number" ||
      !Number.isInteger(candidate.retryAttempt) ||
      candidate.retryAttempt < 0 ||
      candidate.retryAttempt > 64
    )
      return null
    result.retryAttempt = candidate.retryAttempt
  }
  return result as RecommendationEvidenceObservation
}
export const EVIDENCE_COUNTER_PREFIX = "recommendation:evidence:v1"
export const EVIDENCE_COUNTER_TTL_SECONDS = 48 * 60 * 60
export const EVIDENCE_COLLECTOR_TIMEOUT_MS = 150
export const EVIDENCE_COUNTER_SCRIPT = `
local exists = redis.call('HEXISTS', KEYS[1], ARGV[1])
if exists == 0 and redis.call('HLEN', KEYS[1]) >= 512 then
  redis.call('HINCRBY', KEYS[1], 'overflow', 1)
else
  redis.call('HINCRBY', KEYS[1], ARGV[1], 1)
end
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
`
export function evidenceCounterField(
  event: RecommendationEvidenceObservation,
): string {
  return [
    event.action,
    event.outcome,
    event.reason ?? "none",
    event.timeoutStage ?? "none",
    event.retryDisposition ?? "none",
    event.crawler ?? "unknown",
    event.httpStatus ?? 0,
    event.retryAttempt === undefined
      ? "unknown"
      : Math.min(event.retryAttempt, 4),
  ].join("|")
}
export function parseEvidenceCounterField(
  field: string,
): RecommendationEvidenceObservation | null {
  const parts = field.split("|")
  if (parts.length !== 8) return null
  return normalizeEvidenceObservation({
    action: parts[0],
    outcome: parts[1],
    reason: parts[2],
    timeoutStage: parts[3],
    retryDisposition: parts[4],
    crawler: parts[5],
    ...(parts[6] === "0" ? {} : { httpStatus: Number(parts[6]) }),
    ...(parts[7] === "unknown" ? {} : { retryAttempt: Number(parts[7]) }),
  })
}
export function createEvidenceObserver(deps: {
  service: "web" | "admin"
  write: (key: string, field: string) => Promise<unknown>
  log: (message: string) => void
  now?: () => number
}) {
  let pending = 0
  let lastCollectorLog = -Infinity
  function log(value: object, collector = false) {
    if (collector) {
      const now = deps.now?.() ?? Date.now()
      if (now - lastCollectorLog < 5_000) return
      lastCollectorLog = now
    }
    try {
      deps.log(
        Object.entries({
          event: collector
            ? "recommendation.evidence.collector"
            : "recommendation.evidence",
          source: deps.service,
          ...value,
        })
          .map(([key, value]) => `${key}=${value}`)
          .join(" "),
      )
    } catch {
      /* Observability cannot affect playback. */
    }
  }
  return (input: RecommendationEvidenceObservation): void => {
    // Even untyped call sites cannot place raw values in logs or Redis.
    let event: RecommendationEvidenceObservation | null
    try {
      event = normalizeEvidenceObservation(input)
    } catch {
      return
    }
    if (!event) return
    log(event)
    if (pending >= 16) {
      log({ reason: "dropped" }, true)
      return
    }
    pending++
    void (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const key = `${EVIDENCE_COUNTER_PREFIX}:${deps.service}:${Math.floor((deps.now?.() ?? Date.now()) / 3_600_000)}`
        await Promise.race([
          deps.write(key, evidenceCounterField(event)),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("collector_timeout")),
              EVIDENCE_COLLECTOR_TIMEOUT_MS,
            )
          }),
        ])
      } catch {
        log({ reason: "unavailable" }, true)
      } finally {
        clearTimeout(timer)
        pending--
      }
    })()
  }
}
