jest.mock("../../datadog", () => ({
  datadogLog: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}))

import { datadogLog } from "../../datadog"
import { logWatchHomeFallback } from "../logWatchHomeFallback"

const mockWarn = datadogLog.warn as jest.Mock

describe("logWatchHomeFallback", () => {
  beforeEach(() => jest.clearAllMocks())

  it("emits one structured Datadog warn carrying the reason (R11 — never silent)", () => {
    logWatchHomeFallback({ reason: "empty" })
    expect(mockWarn).toHaveBeenCalledTimes(1)
    expect(mockWarn).toHaveBeenCalledWith("watch_home_fallback", {
      reason: "empty",
      body_source: "config",
    })
  })

  it("carries the error-recovered reason (reused last-good over a live error)", () => {
    logWatchHomeFallback({ reason: "error-recovered" })
    expect(mockWarn).toHaveBeenCalledWith("watch_home_fallback", {
      reason: "error-recovered",
      body_source: "experience",
    })
  })

  it("carries the topup-error reason (a dropped hydration top-up stays observable)", () => {
    logWatchHomeFallback({ reason: "topup-error" })
    expect(mockWarn).toHaveBeenCalledWith("watch_home_fallback", {
      reason: "topup-error",
      body_source: "experience",
    })
  })

  // The event NAME says "fallback" for all five reasons, but two fire while
  // admin-curated content is on screen. body_source is what lets an operator
  // tell "users saw frozen content" from "degraded but fine".
  it.each([
    ["null", "config"],
    ["error", "config"],
    ["empty", "config"],
    ["error-recovered", "experience"],
    ["topup-error", "experience"],
  ] as const)(
    "reason %s reports body_source %s",
    (reason, expectedBodySource) => {
      logWatchHomeFallback({ reason })
      expect(mockWarn).toHaveBeenCalledWith("watch_home_fallback", {
        reason,
        body_source: expectedBodySource,
      })
    },
  )

  // Anti-vacuous: the two experience-body reasons must NOT be classified as
  // config, or the attribute silently reverts to restating the event name.
  it("never labels an experience-body reason as config", () => {
    for (const reason of ["error-recovered", "topup-error"] as const) {
      mockWarn.mockClear()
      logWatchHomeFallback({ reason })
      expect(mockWarn).not.toHaveBeenCalledWith("watch_home_fallback", {
        reason,
        body_source: "config",
      })
    }
  })
})
