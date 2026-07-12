import { datadogLog } from "../datadog"
import { logWatchHomeFallback } from "./logWatchHomeFallback"

// Mock the whole datadog module so the native SDK / env are never loaded here.
jest.mock("../datadog", () => ({
  datadogLog: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}))

const warn = datadogLog.warn as jest.Mock

describe("logWatchHomeFallback (R12)", () => {
  beforeEach(() => warn.mockClear())

  it("emits watch_home_fallback with the reason as a context attribute", () => {
    logWatchHomeFallback({ reason: "topup-error" })
    // reason must be the SECOND arg (a facetable context attribute), NOT baked
    // into the message string — that is the whole point of the contract.
    expect(warn).toHaveBeenCalledWith("watch_home_fallback", {
      reason: "topup-error",
    })
  })

  it("passes each reason through unchanged", () => {
    for (const reason of [
      "null",
      "error",
      "empty",
      "error-recovered",
      "topup-error",
    ] as const) {
      warn.mockClear()
      logWatchHomeFallback({ reason })
      expect(warn).toHaveBeenCalledWith("watch_home_fallback", { reason })
    }
  })
})
