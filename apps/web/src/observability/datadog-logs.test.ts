import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const send = vi.fn()
const unref = vi.fn()
const on = vi.fn()
const createSocket = vi.fn(() => ({ on, send, unref }))
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

vi.mock("@/env", () => ({
  env: {
    DD_AGENT_HOST: "datadog-agent.railway.internal",
    DD_AGENT_SYSLOG_PORT: 514,
    DD_ENV: "prod",
    DD_SERVICE: "forge-web",
    DD_VERSION: "abc123",
  },
}))

const {
  buildDatadogSyslogMessage,
  configureDatadogLogForwarding,
  formatConsoleArguments,
  sendDatadogStructuredLog,
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

function readPayload(message: string): Record<string, unknown> {
  return JSON.parse(message.slice(message.indexOf("{"))) as Record<
    string,
    unknown
  >
}

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
      environment: "prod",
      hostname: "web-host",
      level: "error",
      message: "request failed",
      service: "forge-web",
      spanId: "987654321",
      timestamp: new Date("2026-06-26T02:00:00.000Z"),
      traceId: "123456789",
      version: "abc123",
    })

    expect(message).toContain(
      "<131>1 2026-06-26T02:00:00.000Z web-host forge-web - - - ",
    )
    expect(message).toContain('"message":"request failed"')
    expect(message).toContain('"status":"error"')
    expect(message).toContain('"env":"prod"')
    expect(message).toContain('"service":"forge-web"')
    expect(message).toContain(
      '"ddtags":"env:prod,service:forge-web,version:abc123"',
    )
    expect(message).toContain('"dd.trace_id":"123456789"')
    expect(message).toContain('"dd.span_id":"987654321"')
  })

  it("preserves watch_search fields as structured attributes", () => {
    const message = buildDatadogSyslogMessage({
      attributes: {
        "watch_search.latency_ms": 42,
        "watch_search.outcome": "completed",
        "watch_search.query": "person@example.com",
        "watch_search.result_source": "algolia",
      },
      environment: "prod",
      hostname: "web-host",
      level: "info",
      message: "watch_search analytics",
      service: "forge-web",
      timestamp: new Date("2026-06-26T02:00:00.000Z"),
      version: "abc123",
    })

    const payload = readPayload(message)
    expect(payload.message).toBe("watch_search analytics")
    expect(payload["watch_search.query"]).toBe("person@example.com")
    expect(payload["watch_search.outcome"]).toBe("completed")
    expect(payload["watch_search.result_source"]).toBe("algolia")
    expect(payload["watch_search.latency_ms"]).toBe(42)
  })
})

describe("configureDatadogLogForwarding", () => {
  it("does not throw or mark configured when UDP socket setup fails", () => {
    createSocket.mockImplementationOnce(() => {
      throw new Error("socket failed")
    })

    expect(() => configureDatadogLogForwarding()).not.toThrow()
    expect(console.error).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it("forwards patched console logs to the Datadog Agent over UDP syslog", () => {
    configureDatadogLogForwarding()

    console.error("request failed", { status: 500 })

    expect(createSocket).toHaveBeenCalledWith("udp6")
    expect(unref).toHaveBeenCalled()
    expect(on).toHaveBeenCalledWith("error", expect.any(Function))
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

describe("sendDatadogStructuredLog", () => {
  it("sends structured attributes without going through console", () => {
    sendDatadogStructuredLog({
      attributes: {
        "watch_search.query": "Jesus",
        "watch_search.search_request_id": "search_12345678",
      },
      message: "watch_search analytics",
    })

    expect(console.log).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledTimes(1)
    const payload = readPayload(String(send.mock.calls[0]?.[0]))
    expect(payload.message).toBe("watch_search analytics")
    expect(payload["watch_search.query"]).toBe("Jesus")
    expect(payload["watch_search.search_request_id"]).toBe("search_12345678")
  })

  it("is a no-op when no Datadog Agent host is configured", () => {
    sendDatadogStructuredLog(
      {
        attributes: { "watch_search.query": "Jesus" },
        message: "watch_search analytics",
      },
      { agentHost: "" },
    )

    expect(send).not.toHaveBeenCalled()
  })
})
