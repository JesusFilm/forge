import { describe, expect, it, vi } from "vitest"
import {
  createEvidenceObserver,
  normalizeEvidenceObservation,
} from "./recommendation-evidence-observability-contract"
import { observeRecommendationEvidence } from "./recommendation-evidence-observability"

describe("Web evidence observer", () => {
  it("preserves the crawler rejection signal used by transport monitors", () => {
    const log = vi.fn()
    const observe = createEvidenceObserver({ service: "web", log })
    observe({
      action: "playback",
      outcome: "rejected",
      reason: "crawler_rejected",
      crawler: "recognized",
      httpStatus: 403,
    })
    expect(log).toHaveBeenCalledExactlyOnceWith(
      "event=recommendation.evidence source=web action=playback outcome=rejected reason=crawler_rejected crawler=recognized httpStatus=403",
    )
  })

  it("rejects user-derived dimensions at runtime", () => {
    expect(
      normalizeEvidenceObservation({
        action: "claim",
        outcome: "rejected",
        crawler: "Applebot",
      }),
    ).toBeNull()
    expect(
      normalizeEvidenceObservation({
        action: "secret-session",
        outcome: "accepted",
      }),
    ).toBeNull()
  })

  it("logs through the production wrapper without collector configuration", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {})
    try {
      observeRecommendationEvidence({
        action: "claim",
        outcome: "rejected",
        reason: "invalid_binding",
        retryDisposition: "terminal",
        httpStatus: 409,
      })
      expect(log).toHaveBeenCalledExactlyOnceWith(
        "event=recommendation.evidence source=web action=claim outcome=rejected reason=invalid_binding retryDisposition=terminal httpStatus=409",
      )
    } finally {
      log.mockRestore()
    }
  })

  it("does not propagate failure of the production logger", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {
      throw new Error("log transport unavailable")
    })
    try {
      expect(() =>
        observeRecommendationEvidence({
          action: "facts",
          outcome: "accepted",
        }),
      ).not.toThrow()
    } finally {
      log.mockRestore()
    }
  })
})
