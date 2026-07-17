import { describe, expect, it, vi } from "vitest"

import type { DiscoveredVideo } from "./candidate"
import { submitCandidatesToSite } from "./site-ingest-client"

function candidate(overrides: Partial<DiscoveredVideo> = {}): DiscoveredVideo {
  return {
    platform: "youtube",
    externalId: "vid123",
    url: "https://www.youtube.com/watch?v=vid123",
    caption: "AI film of Jesus",
    authorHandle: "Grace Films",
    authorName: "Grace Films",
    authorUrl: "https://www.youtube.com/channel/UC_grace",
    thumbnailUrl: "https://i.ytimg.com/t.jpg",
    matchedAi: ["ai"],
    matchedChristian: ["jesus"],
    ...overrides,
  }
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  })
}

const CONFIG = {
  url: "https://site.test/api/inspiration-candidates",
  token: "tok",
}

describe("submitCandidatesToSite", () => {
  it("posts the platform-tagged payload and returns the counts", async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      jsonResponse({ ok: true, inserted: 1, skipped: 0 }),
    )
    const result = await submitCandidatesToSite([candidate()], {
      ...CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({ ok: true, inserted: 1, skipped: 0 })

    const init = fetchImpl.mock.calls[0]![1]!
    const body = JSON.parse(String(init.body))
    expect(body.posts[0]).toMatchObject({
      platform: "youtube",
      externalId: "vid123",
      authorUrl: "https://www.youtube.com/channel/UC_grace",
    })
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe("Bearer tok")
    expect(init.redirect).toBe("error")
  })

  it("throws config_missing when url or token absent (before fetch)", async () => {
    const fetchImpl = vi.fn()
    await expect(
      submitCandidatesToSite([candidate()], {
        url: "",
        token: "tok",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "config_missing" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("rejects a non-HTTPS endpoint before it can receive the bearer", async () => {
    const fetchImpl = vi.fn()
    await expect(
      submitCandidatesToSite([candidate()], {
        ...CONFIG,
        url: "http://127.0.0.1/internal",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "config_missing" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("rejects a malformed endpoint before it can receive the bearer", async () => {
    const fetchImpl = vi.fn()
    await expect(
      submitCandidatesToSite([candidate()], {
        ...CONFIG,
        url: "not a URL",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "config_missing" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("rejects a 2xx response that does not confirm the ingest", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: false, inserted: 0, skipped: 0 }),
    )
    await expect(
      submitCandidatesToSite([candidate()], {
        ...CONFIG,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "invalid_response" })
  })

  it("rejects fractional ingest counts that cannot satisfy the workflow schema", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: true, inserted: 1.5, skipped: 0 }),
    )
    await expect(
      submitCandidatesToSite([candidate()], {
        ...CONFIG,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "invalid_response" })
  })

  it("returns zero counts and skips fetch for empty candidates", async () => {
    const fetchImpl = vi.fn()
    const result = await submitCandidatesToSite([], {
      ...CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({ ok: true, inserted: 0, skipped: 0 })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("maps 401 to auth_failed", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, { status: 401 }))
    await expect(
      submitCandidatesToSite([candidate()], {
        ...CONFIG,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "auth_failed" })
  })

  it("maps 500 to retryable upstream_failed", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, { status: 500 }))
    await expect(
      submitCandidatesToSite([candidate()], {
        ...CONFIG,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "upstream_failed", retryable: true })
  })
})
