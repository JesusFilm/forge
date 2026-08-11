import { afterEach, describe, expect, it, vi } from "vitest"

import { executeFirecrawlPageEvidence } from "./seo-evidence"

describe("SEO Firecrawl evidence", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("requests live evidence, retains cache metadata, and revalidates the returned URL", async () => {
    vi.stubEnv("SEO_ALLOWED_PAGE_HOSTS", "watch.example")
    const scrape = vi.fn(async () => ({
      ok: true as const,
      result: {
        url: "https://watch.example/page?cached=true",
        markdown: "Page evidence",
        markdownTruncated: false,
        title: "Title",
        description: null,
        statusCode: 200,
        contentType: "text/html",
        cacheState: "miss",
        cachedAt: null,
      },
    }))
    const result = await executeFirecrawlPageEvidence(
      { canonicalUrl: "https://watch.example/page", liveFetch: true },
      {
        scrape: scrape as never,
        resolveHost: async () => [{ address: "93.184.216.34" }],
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(scrape).toHaveBeenCalledWith(
      expect.objectContaining({ liveFetch: true, onlyMainContent: true }),
    )
    expect(result.observation.data).toMatchObject({
      cacheState: "miss",
      liveFetchRequested: true,
    })
    expect(result.observation.scope.canonicalUrl).toBe(
      "https://watch.example/page",
    )
  })

  it("rejects a provider response redirected to a non-allowlisted host", async () => {
    vi.stubEnv("SEO_ALLOWED_PAGE_HOSTS", "watch.example")
    const result = await executeFirecrawlPageEvidence(
      { canonicalUrl: "https://watch.example/page" },
      {
        scrape: vi.fn(async () => ({
          ok: true,
          result: {
            url: "https://metadata.example/private",
            markdown: "private",
            markdownTruncated: false,
            title: null,
            description: null,
            statusCode: 200,
            contentType: "text/plain",
          },
        })) as never,
        resolveHost: async () => [{ address: "93.184.216.34" }],
      },
    )
    expect(result).toEqual({
      ok: false,
      reason: "not_allowed",
      retryable: false,
    })
  })
})
