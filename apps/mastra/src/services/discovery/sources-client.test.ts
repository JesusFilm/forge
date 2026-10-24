import { describe, expect, it, vi } from "vitest"

import { fetchSavedSources } from "./sources-client"

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  })
}

const CONFIG = {
  url: "https://site.test/api/discovery-sources",
  token: "tok",
}

describe("fetchSavedSources", () => {
  it("returns parsed sources for a platform and scopes the query", async () => {
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      jsonResponse({
        sources: [
          { value: "PLqbible", label: "QBIBLE" },
          { value: "@grace", label: "Grace" },
        ],
      }),
    )
    const sources = await fetchSavedSources("youtube", {
      ...CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(sources).toEqual([
      { value: "PLqbible", label: "QBIBLE" },
      { value: "@grace", label: "Grace" },
    ])
    const calledUrl = new URL(String(fetchImpl.mock.calls[0]![0]))
    expect(calledUrl.searchParams.get("platform")).toBe("youtube")
    const init = fetchImpl.mock.calls[0]![1]!
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer tok",
    )
    expect(init.redirect).toBe("error")
  })

  it("returns an empty list when the site has no sources", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ sources: [] }))
    const sources = await fetchSavedSources("pinterest", {
      ...CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(sources).toEqual([])
  })

  it("drops malformed entries and trims values", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        sources: [
          { value: "  good  ", label: "ok" },
          { label: "no value" },
          { value: "" },
          "garbage",
        ],
      }),
    )
    const sources = await fetchSavedSources("instagram", {
      ...CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(sources).toEqual([{ value: "good", label: "ok" }])
  })

  it("throws config_missing before fetch when url or token absent", async () => {
    const fetchImpl = vi.fn()
    await expect(
      fetchSavedSources("youtube", {
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
      fetchSavedSources("youtube", {
        ...CONFIG,
        url: "http://127.0.0.1/internal",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "config_missing" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("maps 401 to auth_failed", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, { status: 401 }))
    await expect(
      fetchSavedSources("youtube", {
        ...CONFIG,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "auth_failed" })
  })

  it("maps 500 to retryable upstream_failed", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, { status: 500 }))
    await expect(
      fetchSavedSources("youtube", {
        ...CONFIG,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "upstream_failed", retryable: true })
  })

  it("maps a non-array body to invalid_response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ sources: "nope" }))
    await expect(
      fetchSavedSources("youtube", {
        ...CONFIG,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "invalid_response" })
  })
})
