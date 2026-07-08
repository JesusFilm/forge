import { logWatchHomeFallback } from "../logWatchHomeFallback"

describe("logWatchHomeFallback", () => {
  it("emits one structured warn carrying the reason (R11 — never silent)", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {})
    logWatchHomeFallback({ reason: "empty" })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[WatchHome] fallback"),
    )
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("reason=empty"))
    warn.mockRestore()
  })
})
