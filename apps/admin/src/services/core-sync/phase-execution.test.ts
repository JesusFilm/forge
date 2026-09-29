import { describe, expect, it } from "vitest"
import { parseCoreSyncPhaseResult } from "./phase-execution"

describe("durable Core phase results", () => {
  it("replays a completed phase without losing its errors or counters", () => {
    const result = {
      phase: "videos",
      created: 0,
      updated: 25,
      softDeleted: 0,
      errors: 1,
      durationMs: 600_000,
    }
    expect(parseCoreSyncPhaseResult(result)).toEqual(result)
  })

  it("rejects incomplete or corrupt persisted results", () => {
    expect(() =>
      parseCoreSyncPhaseResult({ phase: "videos", updated: 25 }),
    ).toThrow()
    expect(() =>
      parseCoreSyncPhaseResult({
        phase: "videos",
        created: 0,
        updated: -1,
        softDeleted: 0,
        errors: 0,
        durationMs: 1,
      }),
    ).toThrow()
  })
})
