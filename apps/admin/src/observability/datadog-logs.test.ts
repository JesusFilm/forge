import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const send = vi.fn()
const unref = vi.fn()
const createSocket = vi.fn(() => ({ send, unref }))
const toTraceId = vi.fn(() => "123456789")
const toSpanId = vi.fn(() => "987654321")
const active = vi.fn(() => ({
  context: () => ({
    toSpanId,
    toTraceId,
  }),
}))

vi.mock("node:dgram", () => ({
  default: { createSocket },
}))

vi.mock("dd-trace", () => ({
  default: {
    scope: () => ({ active }),
  },
}))

vi.mock("@/config/env", () => ({
  env: {
    DD_AGENT_HOST: "datadog-agent.railway.internal",
    DD_AGENT_SYSLOG_PORT: 514,
    DD_ENV: "production",
    DD_SERVICE: "forge-admin",
    DD_VERSION: "abc123",
  },
}))

const {
  buildDatadogSyslogMessage,
  configureDatadogLogForwarding,
  formatConsoleArguments,
} = await import("./datadog-logs")

const originalConsole = {
  debug: console.debug,
  error: console.error,
  info: console.info,
  log: console.log,
  warn: console.warn,
}

beforeEach(() => {
  vi.clearAllMocks()
  console.debug = vi.fn()
  console.error = vi.fn()
  console.info = vi.fn()
  console.log = vi.fn()
  console.warn = vi.fn()
})

afterEach(() => {
  console.debug = originalConsole.debug
  console.error = originalConsole.error
  console.info = originalConsole.info
  console.log = originalConsole.log
  console.warn = originalConsole.warn
})

describe("formatConsoleArguments", () => {
  it("renders strings, errors, and objects into one log message", () => {
    const error = new Error("boom")

    const message = formatConsoleArguments(["message", error, { ok: true }])

    expect(message).toContain("message Error: boom")
    expect(message).toContain("{ ok: true }")
  })
})

describe("buildDatadogSyslogMessage", () => {
  it("formats a syslog message with Datadog service tags and trace ids", () => {
    const message = buildDatadogSyslogMessage({
      environment: "production",
      hostname: "admin-host",
      level: "error",
      message: "request failed",
      service: "forge-admin",
      spanId: "987654321",
      timestamp: new Date("2026-06-26T02:00:00.000Z"),
      traceId: "123456789",
      version: "abc123",
    })

    expect(message).toContain(
      "<131>1 2026-06-26T02:00:00.000Z admin-host forge-admin - - - ",
    )
    expect(message).toContain('"message":"request failed"')
    expect(message).toContain('"status":"error"')
    expect(message).toContain('"service":"forge-admin"')
    expect(message).toContain(
      '"ddtags":"env:production,service:forge-admin,version:abc123"',
    )
    expect(message).toContain('"dd.trace_id":"123456789"')
    expect(message).toContain('"dd.span_id":"987654321"')
  })
})

describe("configureDatadogLogForwarding", () => {
  it("forwards patched console logs to the Datadog Agent over UDP syslog", () => {
    configureDatadogLogForwarding()

    console.error("request failed", { status: 500 })

    expect(createSocket).toHaveBeenCalledWith("udp6")
    expect(unref).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[1]).toBe(514)
    expect(send.mock.calls[0]?.[2]).toBe("datadog-agent.railway.internal")
    expect(String(send.mock.calls[0]?.[0])).toContain("request failed")
    expect(String(send.mock.calls[0]?.[0])).toContain('"status":"error"')
    expect(String(send.mock.calls[0]?.[0])).toContain(
      '"dd.trace_id":"123456789"',
    )
  })
})
