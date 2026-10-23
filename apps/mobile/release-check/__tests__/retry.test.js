/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
// The retry rules of the failure diagram (KTD14, R27, AE5, AE6).
const {
  RESTARTS_PER_RUN,
  ensureResponsive,
} = require("../lib/devices/inventory")
const { attemptRecord, runJourney, runQueue } = require("../lib/journeys/retry")

const DEVICE = "ipad-pro-13"
const JOURNEY = "previous-video"
const KNOWN = {
  journey: JOURNEY,
  devices: [DEVICE],
  step: "Video B shows",
  check: "assertion_failed",
  ticket: "FORGE-123",
}

function failed(fields) {
  return {
    passed: false,
    deviceAnswered: true,
    retryAfterMs: null,
    record: attemptRecord({
      journey: JOURNEY,
      deviceId: DEVICE,
      class: "assertion_failed",
      failedStep: "Video B shows",
      ...fields,
    }),
  }
}

function passed(attempt) {
  return {
    passed: true,
    record: attemptRecord({
      journey: JOURNEY,
      deviceId: DEVICE,
      attempt,
      status: "passed",
    }),
  }
}

// A fake device behind U5's real restart rule: `answers` decides each probe.
function fakeDevice(answers) {
  const handle = {
    restarts: 0,
    probes: 0,
    async probe() {
      handle.probes += 1
      return answers(handle) ? { ok: true } : { ok: false, error: "no answer" }
    },
    async restart() {
      return { ok: true }
    },
  }
  return handle
}

function journeyRun(outcomes, fields = {}) {
  const calls = { attempts: 0, cleanUps: 0, waits: [], recovers: [] }
  const handle = fields.handle ?? fakeDevice(() => true)
  const promise = runJourney({
    journey: JOURNEY,
    deviceId: DEVICE,
    knownBugs: [KNOWN],
    runAttempt: async (n) => {
      calls.attempts += 1
      return outcomes[n - 1]
    },
    recover: async (reason) => {
      calls.recovers.push(reason)
      for (;;) {
        const result = await ensureResponsive(handle)
        if (result.answered || result.exhausted || !result.restarted) {
          return result
        }
      }
    },
    cleanUp: async () => {
      calls.cleanUps += 1
    },
    wait: async (ms) => {
      calls.waits.push(ms)
    },
    ...fields,
  })
  return promise.then((result) => ({ result, calls }))
}

describe("Known-Bug entries (AE5)", () => {
  it("labels a failure at the named step and check known, with its ticket, and does not retry", async () => {
    const { result, calls } = await journeyRun([failed({ attempt: 1 })])
    expect(calls.attempts).toBe(1)
    expect(result.label).toBe("known")
    expect(result.attempts).toHaveLength(1)
    expect(result.attempts[0].knownBugTicket).toBe("FORGE-123")
    expect(calls.cleanUps).toBe(1)
  })

  it("gives no known label to a failure at another step of the same journey", async () => {
    const other = { failedStep: "Video A shows" }
    const { result, calls } = await journeyRun([
      failed({ attempt: 1, ...other }),
      failed({ attempt: 2, ...other }),
    ])
    expect(calls.attempts).toBe(2)
    expect(result.label).toBe("new")
    expect(result.attempts.map((attempt) => attempt.label)).toEqual([
      "new",
      "new",
    ])
    expect(result.attempts.every((a) => a.knownBugTicket === null)).toBe(true)
  })

  it("labels a failure that passes on its retry flaky", async () => {
    const { result, calls } = await journeyRun([
      failed({ attempt: 1, failedStep: "Video A shows" }),
      passed(2),
    ])
    expect(result.label).toBe("flaky")
    expect(result.attempts.map((attempt) => attempt.status)).toEqual([
      "failed",
      "passed",
    ])
    expect(result.attempts.map((attempt) => attempt.label)).toEqual([
      "flaky",
      "flaky",
    ])
    expect(calls.cleanUps).toBe(1)
  })
})

describe("rate limits", () => {
  it("waits for the Retry-After time before the one retry", async () => {
    const limited = failed({ attempt: 1, class: "rate_limited" })
    limited.retryAfterMs = 60_000
    const { result, calls } = await journeyRun([limited, passed(2)])
    expect(calls.waits).toEqual([60_000])
    expect(result.label).toBe("flaky")
  })

  it("waits before the one retry of an upstream_error too, but not of an assertion_failed", async () => {
    const upstream = failed({ attempt: 1, class: "upstream_error" })
    upstream.retryAfterMs = 60_000
    const waited = await journeyRun([upstream, passed(2)])
    expect(waited.calls.waits).toEqual([60_000])
    expect(waited.result.label).toBe("flaky")

    const assertion = failed({ attempt: 1, failedStep: "Video A shows" })
    assertion.retryAfterMs = 60_000
    const direct = await journeyRun([assertion, passed(2)])
    expect(direct.calls.waits).toEqual([])
    expect(direct.result.label).toBe("flaky")
  })
})

describe("device restarts (AE6)", () => {
  it("restarts a device that does not answer and labels the pass after it flaky", async () => {
    const handle = fakeDevice((device) => device.restarts > 0)
    const lost = failed({ attempt: 1, class: "device_unresponsive" })
    lost.deviceAnswered = false
    const { result, calls } = await journeyRun([lost, passed(2)], { handle })
    expect(handle.restarts).toBe(1)
    expect(result.label).toBe("flaky")
    expect(result.attempts[0].restart).toBe(true)
    expect(result.attempts[1].status).toBe("passed")
    expect(calls.cleanUps).toBe(0)
  })

  it("does not restart a device that answers when the app stops responding", async () => {
    const handle = fakeDevice(() => true)
    const hung = failed({ attempt: 1, class: "app_unresponsive" })
    const { result, calls } = await journeyRun([hung, passed(2)], { handle })
    expect(handle.restarts).toBe(0)
    expect(calls.recovers).toEqual([])
    expect(result.label).toBe("flaky")
    expect(result.attempts[0].restart).toBe(false)
  })

  it("marks the rest of the queue not run after a third failure on a device with two restarts", async () => {
    const handle = fakeDevice(() => false)
    const queue = ["journey-a", "journey-b", "journey-c", "journey-d"]
    const result = await runQueue({
      deviceId: DEVICE,
      journeys: queue,
      probeId: "settings-probe",
      runOne: (journey) =>
        runJourney({
          journey,
          deviceId: DEVICE,
          knownBugs: [],
          runAttempt: async (n) => {
            const lost = failed({
              journey,
              attempt: n,
              class: "device_unresponsive",
            })
            lost.deviceAnswered = false
            return lost
          },
          recover: async () => {
            for (;;) {
              const answer = await ensureResponsive(handle)
              if (answer.answered || answer.exhausted || !answer.restarted) {
                return answer
              }
            }
          },
          cleanUp: async () => {},
          wait: async () => {},
        }),
    })
    expect(RESTARTS_PER_RUN).toBe(2)
    expect(handle.restarts).toBe(2)
    expect(result.deviceLost).toBe(true)
    const byJourney = (journey) =>
      result.attempts.filter((attempt) => attempt.journey === journey)
    expect(byJourney("journey-a").map((a) => a.label)).toEqual(["new", "new"])
    expect(byJourney("journey-b").map((a) => a.status)).toEqual(["failed"])
    expect(byJourney("journey-c")).toEqual([
      expect.objectContaining({ status: "not_run", label: "not_run" }),
    ])
    expect(byJourney("journey-d")).toEqual([
      expect.objectContaining({ status: "not_run", label: "not_run" }),
    ])
  })
})

describe("a stop", () => {
  it("records the stopped attempt as not run and ends the queue", async () => {
    const result = await runQueue({
      deviceId: DEVICE,
      journeys: ["journey-a", "journey-b"],
      probeId: "settings-probe",
      runOne: (journey) =>
        runJourney({
          journey,
          deviceId: DEVICE,
          knownBugs: [],
          runAttempt: async () => ({ stopped: true }),
          recover: async () => ({ answered: true }),
          cleanUp: async () => {},
          wait: async () => {},
        }),
    })
    expect(result.stopped).toBe(true)
    expect(result.attempts.map((a) => [a.journey, a.status])).toEqual([
      ["journey-a", "not_run"],
      ["journey-b", "not_run"],
    ])
  })
})
