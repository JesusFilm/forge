import { readFileSync } from "node:fs"
import { describe, expect, it, vi, afterEach } from "vitest"
import {
  createEvidenceObserver,
  evidenceCounterField,
  normalizeEvidenceObservation,
  parseEvidenceCounterField,
} from "./evidence-observability-contract"

afterEach(() => vi.useRealTimers())
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
  it("drops unknown values and strips identity fields before logging or collecting", async () => {
    const write = vi.fn().mockResolvedValue(1),
      log = vi.fn()
    const observe = createEvidenceObserver({
      service: "admin",
      write,
      log,
      now: () => 0,
    })
    const candidate = {
      action: "facts" as const,
      outcome: "accepted" as const,
      capability: "secret",
      eventId: "private",
    }
    observe(candidate)
    expect(write).toHaveBeenCalledWith(
      "recommendation:evidence:v1:admin:0",
      "facts|accepted|none|none|none|unknown|0|unknown",
    )
    expect(log.mock.calls.join("")).not.toMatch(
      /secret|private|capability|eventId/,
    )
    expect(
      normalizeEvidenceObservation({
        action: "facts",
        outcome: "secret-token",
      }),
    ).toBeNull()
    expect(
      normalizeEvidenceObservation({
        action: "facts",
        outcome: "accepted",
        reason: "private",
      }),
    ).toBeNull()
    expect(
      normalizeEvidenceObservation({
        action: "facts",
        outcome: "accepted",
        retryAttempt: 65,
      }),
    ).toBeNull()
    expect(
      normalizeEvidenceObservation({
        action: "facts",
        outcome: "accepted",
        httpStatus: 999,
      }),
    ).toBeNull()
  })
  it("bounds in-flight collection and returns immediately when the collector stalls", async () => {
    vi.useFakeTimers()
    const write = vi.fn(() => new Promise(() => {})),
      log = vi.fn()
    const observe = createEvidenceObserver({ service: "web", write, log })
    for (let i = 0; i < 30; i++)
      expect(observe({ action: "claim", outcome: "accepted" })).toBeUndefined()
    expect(write).toHaveBeenCalledTimes(16)
    expect(log.mock.calls.join("")).toContain("reason=dropped")
    await vi.advanceTimersByTimeAsync(151)
    expect(log.mock.calls.join("")).not.toContain("collector_timeout")
  })
  it("never propagates a collector or logger exception", async () => {
    const observe = createEvidenceObserver({
      service: "web",
      write: () => {
        throw new Error("secret")
      },
      log: () => {
        throw new Error("secret")
      },
    })
    expect(() => observe({ action: "claim", outcome: "failed" })).not.toThrow()
    await Promise.resolve()
  })
  it("preserves unknown retry attempts and bounds known attempt cardinality", () => {
    expect(
      parseEvidenceCounterField(
        evidenceCounterField({ action: "claim", outcome: "accepted" }),
      )?.retryAttempt,
    ).toBeUndefined()
    expect(
      parseEvidenceCounterField(
        evidenceCounterField({
          action: "facts",
          outcome: "replay",
          retryAttempt: 64,
        }),
      )?.retryAttempt,
    ).toBe(4)
  })
})
