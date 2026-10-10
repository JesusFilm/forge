import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"
import {
  createEvidenceObserver,
  normalizeEvidenceObservation,
} from "./evidence-observability-contract"

describe("evidence observation privacy and isolation", () => {
  it("keeps the Web/Admin wire contract identical", () => {
    expect(
      readFileSync(
        new URL("./evidence-observability-contract.ts", import.meta.url),
        "utf8",
      ),
    ).toBe(
      readFileSync(
        new URL(
          "../../../../web/src/lib/recommendation-evidence-observability-contract.ts",
          import.meta.url,
        ),
        "utf8",
      ),
    )
  })

  it("strips identity fields while preserving the operational log contract", () => {
    const log = vi.fn()
    const observe = createEvidenceObserver({ service: "admin", log })
    const candidate = {
      action: "facts" as const,
      outcome: "replay" as const,
      retryAttempt: 64,
      capability: "secret",
      eventId: "private",
    }
    observe(candidate)
    expect(log).toHaveBeenCalledExactlyOnceWith(
      "event=recommendation.evidence source=admin action=facts outcome=replay retryAttempt=64",
    )
  })

  it.each([
    { action: "facts", outcome: "secret-token" },
    { action: "facts", outcome: "accepted", reason: "private" },
    { action: "facts", outcome: "accepted", retryAttempt: 65 },
    { action: "facts", outcome: "accepted", retryAttempt: -1 },
    { action: "facts", outcome: "accepted", retryAttempt: 1.5 },
    { action: "facts", outcome: "accepted", httpStatus: 999 },
  ])("rejects unbounded operational dimensions: %j", (candidate) => {
    expect(normalizeEvidenceObservation(candidate)).toBeNull()
  })

  it("isolates logger exceptions so evidence mutations can still complete", () => {
    const observe = createEvidenceObserver({
      service: "admin",
      log: () => {
        throw new Error("logger unavailable")
      },
    })
    expect(() =>
      observe({ action: "claim", outcome: "accepted" }),
    ).not.toThrow()
  })

  it("isolates malformed runtime input without logging raw errors", () => {
    const log = vi.fn()
    const observe = createEvidenceObserver({ service: "admin", log })
    const input = {
      get action(): "claim" {
        throw new Error("private capability")
      },
      outcome: "accepted" as const,
    }
    expect(() => observe(input)).not.toThrow()
    expect(log).not.toHaveBeenCalled()
  })
})
