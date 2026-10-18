import { beforeEach, describe, expect, it, vi } from "vitest"

const calls = vi.hoisted(() => ({
  auth: vi.fn(
    (value: string | null) => value === "Bearer independent-test-key",
  ),
  shared: vi.fn(async (...args: unknown[]) => {
    void args
    return { state: "incomplete" }
  }),
  legacy: vi.fn(async () => ({ state: "incomplete" })),
  durable: vi.fn(async () => ({ state: "incomplete" })),
}))
vi.mock("@/auth/mastra-ingest-bearer", () => ({
  isValidMastraRecommendationIngestBearer: calls.auth,
}))
vi.mock("@/db/client", () => ({ prisma: Object.freeze({ fixture: true }) }))
vi.mock("@/services/recommendations/precomputed/shared-reading-import", () => ({
  submitSharedReadingImport: calls.shared,
}))
vi.mock("@/services/recommendations/precomputed/durable-build", () => ({
  submitDurablePrecomputedRecommendation: calls.durable,
}))
vi.mock("@/services/recommendations/precomputed/contract", () => ({
  submitPrecomputedRecommendation: calls.legacy,
  PrecomputedRecommendationError: class extends Error {},
}))
import { GET, POST } from "./route"

function request(body: string, headers: Record<string, string> = {}) {
  return new Request(
    "http://localhost/api/internal/mastra/precomputed-recommendations",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer independent-test-key",
        ...headers,
      },
      body,
    },
  )
}
beforeEach(() => vi.clearAllMocks())
describe("independent authenticated private import dispatch", () => {
  it("rejects an unauthenticated shared import before any writer", async () => {
    expect(
      (
        await POST(
          request('{"action":"shared_reading_complete"}', {
            authorization: "Bearer wrong",
          }),
        )
      ).status,
    ).toBe(401)
    expect((await GET()).status).toBe(401)
    expect(calls.shared).not.toHaveBeenCalled()
    expect(calls.legacy).not.toHaveBeenCalled()
    expect(calls.durable).not.toHaveBeenCalled()
  })
  it.each([
    "shared_reading_start",
    "shared_reading_call",
    "shared_reading_source",
    "shared_reading_complete",
  ])("dispatches %s without the legacy writer", async (action) => {
    const payload = {
      action,
      generationId: "private-fixture",
      provenance: "preserve exact body",
    }
    expect((await POST(request(JSON.stringify(payload)))).status).toBe(200)
    expect(calls.shared).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ fixture: true }),
      payload,
      "Bearer independent-test-key",
    )
    expect(calls.legacy).not.toHaveBeenCalled()
    expect(calls.durable).not.toHaveBeenCalled()
  })
  it.each([1, 2, 3, 4])(
    "preserves ordinary protocol %i dispatch",
    async (protocolVersion) => {
      expect(
        (
          await POST(
            request(JSON.stringify({ action: "start", protocolVersion })),
          )
        ).status,
      ).toBe(200)
      expect(calls.shared).not.toHaveBeenCalled()
      expect(
        protocolVersion === 1 ? calls.legacy : calls.durable,
      ).toHaveBeenCalledOnce()
    },
  )
  it("enforces streamed byte size even when Content-Length understates it", async () => {
    const payload = JSON.stringify({
      action: "shared_reading_source",
      text: "é".repeat(1024 * 1024),
    })
    expect(
      (await POST(request(payload, { "content-length": "1" }))).status,
    ).toBe(413)
    expect(calls.shared).not.toHaveBeenCalled()
  })
  it("rejects malformed JSON and wrong media type without dispatch", async () => {
    expect((await POST(request('{"action":'))).status).toBe(400)
    expect(
      (await POST(request("{}", { "content-type": "text/plain" }))).status,
    ).toBe(415)
    expect(calls.shared).not.toHaveBeenCalled()
  })
  it("keeps shared source payloads above the legacy 64KiB stage limit intact", async () => {
    const payload = {
      action: "shared_reading_source",
      excerpt: "Exact content ".repeat(8000),
    }
    expect((await POST(request(JSON.stringify(payload)))).status).toBe(200)
    expect(calls.shared.mock.calls[0][1]).toEqual(payload)
  })
})
