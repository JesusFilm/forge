import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/auth/rate-limit", () => ({
  rateLimitAuthRoute: vi.fn(),
}))

vi.mock("@/services/embeddings.service", () => ({
  generateExperienceEmbedding: vi.fn(),
}))

vi.mock("@/db/client", () => ({ prisma: {} }))

vi.mock("@/services/search-trace.service", () => ({
  getSearchTraceCaptureStats: vi.fn(() => ({
    writeSuccesses: 0,
    writeFailures: 0,
    writeTimeouts: 0,
    rawCaptureDisabled: 0,
    lastWriteSuccessAt: null,
    lastWriteFailureAt: null,
    lastWriteTimeoutAt: null,
    lastRawCaptureDisabledAt: null,
  })),
}))

vi.mock("@/services/search-trace-retention.service", () => ({
  readSearchTraceRetentionHealth: vi.fn(),
}))

import { rateLimitAuthRoute } from "@/auth/rate-limit"
import { generateExperienceEmbedding } from "@/services/embeddings.service"
import { __resetSearchHealthForTest } from "@/services/hybrid-search-health"
import { readSearchTraceRetentionHealth } from "@/services/search-trace-retention.service"
import { GET } from "./route"

const allowRateLimit = () =>
  vi.mocked(rateLimitAuthRoute).mockResolvedValue({
    allowed: true,
    source: "local",
    count: 1,
  })

const denyRateLimit = () =>
  vi.mocked(rateLimitAuthRoute).mockResolvedValue({
    allowed: false,
    source: "local",
    count: 31,
  })

function req(): Request {
  return new Request("http://localhost/api/search/health", { method: "GET" })
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetSearchHealthForTest()
  allowRateLimit()
  vi.mocked(readSearchTraceRetentionHealth).mockResolvedValue({
    healthy: true,
    reason: "not-production",
    latestPurgeAt: null,
    activeSchedulerRunId: null,
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/search/health", () => {
  it("returns 200 + status=ok when embedding succeeds", async () => {
    vi.mocked(generateExperienceEmbedding).mockResolvedValue({
      model: "nvidia/llama-nemotron-embed-vl-1b-v2:free",
      dimensions: 2048,
      embedding: new Array(2048).fill(0.1),
    })

    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("ok")
    expect(body.error).toBeNull()
    expect(body.attempts).toBe(1)
    expect(body.failures).toBe(0)
    expect(body.retention).toMatchObject({ healthy: true })
    expect(body.traceCapture).toMatchObject({
      writeSuccesses: 0,
      writeFailures: 0,
    })
  })

  it("returns 200 + status=degraded when embedding throws", async () => {
    vi.mocked(generateExperienceEmbedding).mockRejectedValue(
      new Error("provider down"),
    )

    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("degraded")
    expect(body.error).toBe("provider down")
    expect(body.attempts).toBe(1)
    expect(body.failures).toBe(1)
    expect(body.lastErrorClass).toBe("Error")
    expect(body.lastErrorMessage).toBe("provider down")
    expect(body.lastErrorAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(body.retention).toMatchObject({ healthy: true })
  })

  it("returns status=degraded when trace retention is unhealthy", async () => {
    vi.mocked(generateExperienceEmbedding).mockResolvedValue({
      model: "text-embedding-3-small",
      dimensions: 1536,
      embedding: new Array(1536).fill(0.1),
    })
    vi.mocked(readSearchTraceRetentionHealth).mockResolvedValueOnce({
      healthy: false,
      reason: "missing",
      latestPurgeAt: null,
      activeSchedulerRunId: null,
    })

    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("degraded")
    expect(body.error).toBe("search trace retention unhealthy")
    expect(body.retention).toMatchObject({
      healthy: false,
      reason: "missing",
    })
  })

  // Timeout behavior itself is covered by hybrid-search-health.test.ts;
  // an end-to-end timeout probe here would require real-time sleeps and
  // add flakiness without additional coverage.

  it("returns 429 when rate limit exceeded", async () => {
    denyRateLimit()
    const res = await GET(req())
    expect(res.status).toBe(429)
  })
})
