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
    })
  })

  it("carries the error-recovered reason (reused last-good over a live error)", () => {
    logWatchHomeFallback({ reason: "error-recovered" })
    expect(mockWarn).toHaveBeenCalledWith("watch_home_fallback", {
      reason: "error-recovered",
    })
  })
})
