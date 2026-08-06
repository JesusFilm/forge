import { afterEach, describe, expect, it, vi } from "vitest"

import { logDeviceEvent, sanitizeLogValue } from "./device-log"

afterEach(() => {
  vi.restoreAllMocks()
})

function captureLog(run: () => void): string[] {
  const lines: string[] = []
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    lines.push(String(line))
  })
  run()
  return lines
}

describe("sanitizeLogValue", () => {
  it("collapses newlines and tabs so a value cannot forge a second log line", () => {
    expect(sanitizeLogValue("a\nb\rc\td")).toBe("a b c d")
  })

  it("caps length so an attacker-supplied value cannot flood the log", () => {
    expect(sanitizeLogValue("x".repeat(500))).toHaveLength(64)
  })

  it("renders absent values explicitly rather than as empty", () => {
    expect(sanitizeLogValue(null)).toBe("none")
    expect(sanitizeLogValue(undefined)).toBe("none")
  })
})

describe("logDeviceEvent", () => {
  it("emits plain key=value, never JSON", () => {
    // Railway logsV2 silently drops JSON.stringify payloads written from App
    // Router runtime handlers, which makes post-deploy validation look like the
    // endpoints were never reached.
    const [line] = captureLog(() =>
      logDeviceEvent("token_issued", { clientId: "jfp_tv_production" }),
    )

    expect(line).toBe("[device] event=token_issued clientId=jfp_tv_production")
    expect(() => JSON.parse(line)).toThrow()
  })

  it("keeps a log-injected value on one line", () => {
    const [line] = captureLog(() =>
      logDeviceEvent("code_rejected", {
        attemptedClientId: "evil\n[device] event=token_issued userId=admin",
      }),
    )

    expect(line.split("\n")).toHaveLength(1)
    expect(line).toContain("attemptedClientId=evil [device]")
  })

  it("omits undefined fields instead of printing the word undefined", () => {
    const [line] = captureLog(() =>
      logDeviceEvent("approved", { userId: "u1", scopes: undefined }),
    )

    expect(line).toBe("[device] event=approved userId=u1")
  })

  it("prints a null field, because a present-but-empty value is signal", () => {
    const [line] = captureLog(() =>
      logDeviceEvent("approved", { sessionId: null }),
    )

    expect(line).toBe("[device] event=approved sessionId=none")
  })
})
