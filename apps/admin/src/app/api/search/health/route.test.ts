import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/auth/rate-limit", () => ({
  rateLimitAuthRoute: vi.fn(),
}))

vi.mock("@/services/embeddings.service", () => ({
  generateExperienceEmbedding: vi.fn(),
}))

import { rateLimitAuthRoute } from "@/auth/rate-limit"
import { generateExperienceEmbedding } from "@/services/embeddings.service"
import { __resetSearchHealthForTest } from "@/services/hybrid-search-health"
import { GET } from "./route"

const allowRateLimit = () =>
  vi.mocked(rateLimitAuthRoute).mockResolvedValue({
    allowed: true,
    source: "local",
  })

const denyRateLimit = () =>
  vi.mocked(rateLimitAuthRoute).mockResolvedValue({
    allowed: false,
    source: "local",
  })

function req(): Request {
  return new Request("http://localhost/api/search/health", { method: "GET" })
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetSearchHealthForTest()
  allowRateLimit()
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
