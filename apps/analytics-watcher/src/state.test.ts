import { describe, expect, it } from "vitest"
import {
  MINUTE,
  emptyState,
  recordGaActivity,
  recordObservation,
  type Observation,
} from "./state.js"

const bad: Observation = { status: "bad", detail: "No intake." }
const good: Observation = { status: "good", detail: "Received events." }
const unknown: Observation = {
  status: "unknown",
  detail: "API authentication failed.",
}
const start = Date.parse("2026-09-14T00:00:00Z")

describe("confirmed incidents", () => {
  it("ignores a transient failure and stays quiet while healthy", () => {
    const state = emptyState("test")
    recordObservation(state, "ga", bad, start)
    recordObservation(state, "ga", good, start + 5 * MINUTE)
    recordObservation(state, "ga", bad, start + 10 * MINUTE)
    expect(state.outbox).toEqual([])
  })
  it("requires three observations spanning ten minutes, then opens only once", () => {
    const state = emptyState("test")
    for (const minute of [0, 1, 2, 5])
      recordObservation(state, "ga", bad, start + minute * MINUTE)
    expect(state.outbox).toEqual([])
    for (const minute of [10, 15, 20])
      recordObservation(state, "ga", bad, start + minute * MINUTE)
    expect(state.outbox).toHaveLength(1)
    expect(state.outbox[0]).toMatchObject({ check: "ga", kind: "opened" })
  })
  it("does not treat a scheduler gap as evidence of continuous failure", () => {
    const state = emptyState("test")
    for (const minute of [0, 5, 120])
      recordObservation(state, "ga", bad, start + minute * MINUTE)
    expect(state.outbox).toEqual([])
  })
  it("immediate retries and duplicate timestamps cannot confirm failure", () => {
    const state = emptyState("test")
    for (let i = 0; i < 10; i++) recordObservation(state, "ga", bad, start)
    recordObservation(state, "ga", bad, start + 10 * MINUTE)
    expect(state.outbox).toEqual([])
  })
  it("requires two good checks over five minutes and survives a restart", () => {
    let state = emptyState("test")
    for (const minute of [0, 5, 10])
      recordObservation(state, "ga", bad, start + minute * MINUTE)
    recordObservation(state, "ga", good, start + 15 * MINUTE)
    state = JSON.parse(JSON.stringify(state))
    recordObservation(state, "ga", good, start + 16 * MINUTE)
    expect(state.outbox).toHaveLength(1)
    recordObservation(state, "ga", good, start + 20 * MINUTE)
    expect(state.outbox.map((n) => n.kind)).toEqual(["opened", "recovered"])
    expect(state.outbox[1].incidentId).toBe(state.outbox[0].incidentId)
  })
  it("unknown does not confirm failure or recover an existing incident", () => {
    const state = emptyState("test")
    for (const minute of [0, 5, 10])
      recordObservation(state, "ga", bad, start + minute * MINUTE)
    for (const minute of [15, 20, 25])
      recordObservation(state, "ga", unknown, start + minute * MINUTE)
    expect(state.checks.ga.incident).toBeDefined()
    expect(state.outbox.map((n) => n.check)).toEqual(["ga", "ga:visibility"])
    expect(state.outbox.every((n) => n.kind === "opened")).toBe(true)
  })
  it("separates provider authentication failures from an analytics outage", () => {
    const state = emptyState("test")
    for (const minute of [0, 5, 10])
      recordObservation(state, "datadog", unknown, start + minute * MINUTE)
    expect(state.checks.datadog.incident).toBeUndefined()
    expect(state.outbox[0].check).toBe("datadog:visibility")
  })
})

describe("GA silence coverage", () => {
  it("waits for two hours and then still requires independent confirmation", () => {
    const state = emptyState("test")
    let result: Observation = good
    for (let minute = 0; minute <= 90; minute += 5) {
      result = recordGaActivity(state, null, start + minute * MINUTE)
      recordObservation(state, "ga", result, start + minute * MINUTE)
    }
    expect(result.status).toBe("waiting")
    expect(state.outbox).toEqual([])
    for (const minute of [95, 100]) {
      recordObservation(
        state,
        "ga",
        recordGaActivity(state, null, start + minute * MINUTE),
        start + minute * MINUTE,
      )
    }
    expect(state.outbox).toEqual([])
    recordObservation(
      state,
      "ga",
      recordGaActivity(state, null, start + 105 * MINUTE),
      start + 105 * MINUTE,
    )
    expect(state.outbox).toHaveLength(1)
  })
  it("fresh activity clears accumulated silence", () => {
    const state = emptyState("test")
    for (let minute = 0; minute <= 120; minute += 5)
      recordGaActivity(state, null, start + minute * MINUTE)
    expect(
      recordGaActivity(state, start + 124 * MINUTE, start + 125 * MINUTE)
        .status,
    ).toBe("good")
    expect(recordGaActivity(state, null, start + 130 * MINUTE).status).toBe(
      "waiting",
    )
  })
  it("restarts coverage after missing runs or an unknown provider query", () => {
    const state = emptyState("test")
    state.ga = { lastQueryAt: start, lastActivityAt: start }
    expect(recordGaActivity(state, null, start + 180 * MINUTE).status).toBe(
      "waiting",
    )
    delete state.ga
    expect(recordGaActivity(state, null, start + 190 * MINUTE).status).toBe(
      "waiting",
    )
  })
})
