import { RecommendationRuntimeError } from "./recommendation-errors"
import { RecommendationRouteError } from "./recommendation-route-policy"
import { isEligibleHumanRequest } from "./recommendation-human-admission"
import {
  observeRecommendationEvidence,
  type RecommendationEvidenceObservation,
} from "./recommendation-evidence-observability"
import { EVIDENCE_VOCABULARY } from "./recommendation-evidence-observability-contract"

function networkErrorCode(
  error: unknown,
): NonNullable<RecommendationEvidenceObservation["networkErrorCode"]> {
  try {
    // Native fetch wraps Node/Undici errors in cause. Bound traversal even for
    // malformed/cyclic errors, and never copy messages, URLs or arbitrary codes.
    let current = error
    for (let depth = 0; depth < 4; depth++) {
      if (!current || typeof current !== "object") break
      const record = current as { code?: unknown; cause?: unknown }
      const code = record.code
      const allowed = EVIDENCE_VOCABULARY.networkErrorCode.find(
        (value) => value === code,
      )
      if (allowed) return allowed
      current = record.cause
    }
  } catch {
    // Reading a malformed diagnostic object must not change the HTTP response.
  }
  return "unknown"
}

export function observeEvidenceResponse(
  request: Request,
  action: RecommendationEvidenceObservation["action"],
  status: number,
  error?: unknown,
  receipts?: ReadonlyArray<{ status: string }>,
): void {
  const code =
    error instanceof RecommendationRuntimeError ||
    error instanceof RecommendationRouteError
      ? error.code
      : undefined
  const timeout =
    code === "deadline" ||
    (error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  const crawler = !isEligibleHumanRequest(request)
    ? "recognized"
    : request.headers.get("user-agent")
      ? "not_recognized"
      : "unknown"
  const conflict = receipts?.some((receipt) => receipt.status === "conflict")
  const replay =
    receipts != null &&
    receipts.length > 0 &&
    receipts.every((receipt) => receipt.status === "replay")
  const reason: RecommendationEvidenceObservation["reason"] =
    code === "playback_binding_invalid"
      ? "invalid_binding"
      : code === "machine_evidence_rejected"
        ? "crawler_rejected"
        : code === "rate_limited"
          ? "rate_limited"
          : code === "admission_unavailable"
            ? "admission_unavailable"
            : conflict
              ? "payload_conflict"
              : status === 401 || status === 403
                ? "forbidden"
                : status >= 400 && status < 500
                  ? "invalid_request"
                  : status >= 500
                    ? "upstream_unavailable"
                    : "none"
  observeRecommendationEvidence({
    action,
    outcome: timeout
      ? "ambiguous"
      : status >= 500
        ? "failed"
        : status >= 400
          ? "rejected"
          : conflict
            ? "conflict"
            : replay
              ? "replay"
              : "accepted",
    reason,
    timeoutStage: timeout ? "upstream" : "none",
    retryDisposition:
      reason === "invalid_binding" ||
      (status >= 400 && status < 500 && status !== 429) ||
      conflict
        ? "terminal"
        : timeout || status >= 500 || status === 429
          ? "retryable"
          : replay
            ? "idempotent_replay"
            : "none",
    crawler,
    ...(status >= 500 ? { networkErrorCode: networkErrorCode(error) } : {}),
    ...(EVIDENCE_VOCABULARY.httpStatus.includes(
      status as RecommendationEvidenceObservation["httpStatus"] & number,
    )
      ? {
          httpStatus: status as RecommendationEvidenceObservation["httpStatus"],
        }
      : {}),
  })
}
