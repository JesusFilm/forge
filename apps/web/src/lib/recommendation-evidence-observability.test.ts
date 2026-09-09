import { describe, expect, it, vi } from "vitest"
import {
  createEvidenceObserver,
  normalizeEvidenceObservation,
} from "./recommendation-evidence-observability-contract"
describe("Web evidence observer", () => {
  it("emits only allowlisted operational fields and isolates collection failure", async () => {
    const log = vi.fn()
    const observe = createEvidenceObserver({
      service: "web",
      write: async () => {
        throw new Error("secret-token")
      },
      log,
    })
    observe({
      action: "playback",
      outcome: "rejected",
      reason: "crawler_rejected",
      crawler: "recognized",
      httpStatus: 403,
    })
    await vi.waitFor(() =>
      expect(log.mock.calls.join("")).toContain(
        "recommendation.evidence.collector",
      ),
    )
    expect(log.mock.calls.join("")).not.toContain("secret-token")
    expect(log.mock.calls[0][0]).toContain(
      "event=recommendation.evidence source=web action=playback",
    )
    expect(log.mock.calls[0][0]).toContain("crawler=recognized")
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
})

describe("Web collector connection shutdown", () => {
  it("isolates concurrent timeout shutdown and starts a fresh connection after backoff", async () => {
    vi.useFakeTimers()
    vi.resetModules()
    const log = vi.spyOn(console, "info").mockImplementation(() => {})
    const first = {
      on: vi.fn(),
      isOpen: true,
      connect: vi.fn().mockResolvedValue(undefined),
      eval: vi.fn(() => new Promise(() => {})),
      destroy: vi.fn(() => {
        throw new Error("ClientClosedError")
      }),
    }
    const second = {
      ...first,
      eval: vi.fn().mockResolvedValue(1),
      destroy: vi.fn(),
    }
    const createClient = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValue(second)
    vi.doMock("redis", () => ({ createClient }))
    vi.doMock("@/env", () => ({
      env: { RECOMMENDATION_EVIDENCE_REDIS_URL: "redis://localhost:6379" },
    }))
    try {
      const { observeRecommendationEvidence } =
        await import("./recommendation-evidence-observability")
      observeRecommendationEvidence({ action: "claim", outcome: "accepted" })
      observeRecommendationEvidence({ action: "claim", outcome: "accepted" })
      await vi.advanceTimersByTimeAsync(151)
      expect(first.destroy).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(5_000)
      observeRecommendationEvidence({ action: "claim", outcome: "accepted" })
      await vi.advanceTimersByTimeAsync(1)
      expect(createClient).toHaveBeenCalledTimes(2)
      expect(second.eval).toHaveBeenCalledOnce()
      expect(log.mock.calls.join("")).not.toContain("ClientClosedError")
    } finally {
      vi.useRealTimers()
      log.mockRestore()
      vi.doUnmock("redis")
      vi.doUnmock("@/env")
    }
  })
})
