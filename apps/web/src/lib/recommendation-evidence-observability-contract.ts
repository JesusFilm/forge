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
export function createEvidenceObserver(deps: {
  service: "web" | "admin"
  log: (message: string) => void
}) {
  return (input: RecommendationEvidenceObservation): void => {
    try {
      // Even untyped call sites cannot place raw values in logs.
      const event = normalizeEvidenceObservation(input)
      if (!event) return
      deps.log(
        Object.entries({
          event: "recommendation.evidence",
          source: deps.service,
          ...event,
        })
          .map(([key, value]) => `${key}=${value}`)
          .join(" "),
      )
    } catch {
      /* Observability cannot affect playback. */
    }
  }
}
