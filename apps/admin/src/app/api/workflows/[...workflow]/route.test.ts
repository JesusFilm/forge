import { createHmac } from "node:crypto"
import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/config/env", () => ({
  env: {
    WORKFLOW_API_KEYS: "key-one,key-two",
    WORKFLOW_HMAC_SECRET: "test-secret",
  },
}))

function sign(body: string, timestamp: string, key = "key-one"): string {
  return createHmac("sha256", key).update(`${timestamp}\n${body}`).digest("hex")
}

function makeRequest(
  body: string,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/api/workflows/test", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  })
}

describe("workflow endpoint auth", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rejects requests without auth headers", async () => {
    const { POST } = await import("./route")
    const res = await POST(makeRequest('{"action":"run"}'))
    expect(res.status).toBe(401)
  })

  it("rejects stale timestamp (>5min skew)", async () => {
    const staleTs = String(Date.now() - 6 * 60 * 1000)
    const body = '{"action":"run"}'
    const { POST } = await import("./route")
    const res = await POST(
      makeRequest(body, {
        "x-workflow-timestamp": staleTs,
        "x-workflow-signature": sign(body, staleTs),
      }),
    )
    expect(res.status).toBe(401)
  })

  it("rejects bad signature", async () => {
    const ts = String(Date.now())
    const { POST } = await import("./route")
    const res = await POST(
      makeRequest('{"action":"run"}', {
        "x-workflow-timestamp": ts,
        "x-workflow-signature": "bad-sig",
      }),
    )
    expect(res.status).toBe(401)
  })

  it("accepts valid signature with primary key", async () => {
    const ts = String(Date.now())
    const body = '{"action":"run"}'
    const { POST } = await import("./route")
    const res = await POST(
      makeRequest(body, {
        "x-workflow-timestamp": ts,
        "x-workflow-signature": sign(body, ts, "key-one"),
      }),
    )
    expect(res.status).toBe(200)
  })

  it("accepts valid signature with rotated key", async () => {
    const ts = String(Date.now())
    const body = '{"action":"run"}'
    const { POST } = await import("./route")
    const res = await POST(
      makeRequest(body, {
        "x-workflow-timestamp": ts,
        "x-workflow-signature": sign(body, ts, "key-two"),
      }),
    )
    expect(res.status).toBe(200)
  })

  it("GET returns 401", async () => {
    const { GET } = await import("./route")
    const res = await GET()
    expect(res.status).toBe(401)
  })
})
