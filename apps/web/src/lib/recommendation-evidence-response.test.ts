import { beforeEach, describe, expect, it, vi } from "vitest"
const observe = vi.hoisted(() => vi.fn())
vi.mock("./recommendation-evidence-observability", () => ({
  observeRecommendationEvidence: observe,
}))
import { observeEvidenceResponse } from "./recommendation-evidence-response"
import { RecommendationRuntimeError } from "./recommendation-errors"
import { RecommendationRouteError } from "./recommendation-route-policy"

describe("evidence HTTP observations", () => {
  beforeEach(() => vi.clearAllMocks())
  const request = () =>
    new Request("http://localhost/api/recommendations/playback", {
      headers: { "user-agent": "Mozilla/5.0" },
    })
  it("reports terminal binding rejection without leaking request or error identity", () => {
    observeEvidenceResponse(
      request(),
      "claim",
      409,
      new RecommendationRuntimeError("playback_binding_invalid"),
    )
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "claim",
        outcome: "rejected",
        reason: "invalid_binding",
        retryDisposition: "terminal",
        httpStatus: 409,
      }),
    )
    observeEvidenceResponse(
      request(),
      "facts",
      503,
      new Error("secret-capability-and-history"),
    )
    expect(JSON.stringify(observe.mock.calls)).not.toContain(
      "secret-capability",
    )
  })
  it("distinguishes ambiguous upstream acknowledgement from definitive rejection", () => {
    observeEvidenceResponse(
      request(),
      "facts",
      503,
      new DOMException("private upstream URL", "TimeoutError"),
    )
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "ambiguous",
        timeoutStage: "upstream",
        retryDisposition: "retryable",
      }),
    )
  })
  it("records recognized crawler rejection before the playback action is known", () => {
    observeEvidenceResponse(
      new Request("http://localhost", {
        headers: { "user-agent": "Applebot" },
      }),
      "playback",
      403,
      new RecommendationRouteError(403, "machine_evidence_rejected"),
    )
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "playback",
        crawler: "recognized",
        reason: "crawler_rejected",
        retryDisposition: "terminal",
      }),
    )
  })
  it("does not report a missing user agent as human", () => {
    observeEvidenceResponse(new Request("http://localhost"), "context", 200)
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({ crawler: "unknown" }),
    )
  })
  it("distinguishes receipt conflict and exact replay without forwarding receipt identifiers", () => {
    observeEvidenceResponse(request(), "facts", 200, undefined, [
      { status: "conflict" },
    ])
    expect(observe).toHaveBeenLastCalledWith(
      expect.objectContaining({
        outcome: "conflict",
        reason: "payload_conflict",
        retryDisposition: "terminal",
      }),
    )
    observeEvidenceResponse(request(), "facts", 200, undefined, [
      { status: "replay" },
    ])
    expect(observe).toHaveBeenLastCalledWith(
      expect.objectContaining({
        outcome: "replay",
        retryDisposition: "idempotent_replay",
      }),
    )
  })
})
