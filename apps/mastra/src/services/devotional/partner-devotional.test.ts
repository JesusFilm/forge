import { describe, expect, it, vi } from "vitest"

import {
  fetchPartnerDevotional,
  toGroundingSnippet,
  MAX_PARTNER_TEXT_LENGTH,
} from "./partner-devotional"

const CONFIG = {
  apiKey: "fc-key",
  apiUrl: "https://api.firecrawl.dev",
  timeoutMs: 60000,
  userAgent: "test",
  maxSearchResults: 5,
  maxMarkdownCharacters: 100000,
} as never
const URL =
  "https://www.cru.org/us/en/train-and-grow/spiritual-growth/devotionals/be-still.html"

function scrapeOk(
  markdown: string,
  title: string | null = "Be Still",
): Response {
  return new Response(
    JSON.stringify({
      success: true,
      data: {
        markdown,
        metadata: { title, statusCode: 200, contentType: "text/html" },
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  )
}

describe("fetchPartnerDevotional", () => {
  it("returns config_missing without a Firecrawl key", async () => {
    const r = await fetchPartnerDevotional({
      url: URL,
      config: { apiKey: undefined } as never,
    })
    expect(r).toMatchObject({
      ok: false,
      reason: "config_missing",
      retryable: false,
    })
  })

  it("scrapes the URL and returns clean structured text", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(scrapeOk("# Be Still\n\nThe Lord is near."))
    const r = await fetchPartnerDevotional({
      url: URL,
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error("expected ok")
    expect(r.devotional.url).toBe(URL)
    expect(r.devotional.title).toBe("Be Still")
    expect(r.devotional.text).toContain("The Lord is near.")
  })

  it("caps very long partner text", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(scrapeOk("x".repeat(MAX_PARTNER_TEXT_LENGTH * 2)))
    const r = await fetchPartnerDevotional({
      url: URL,
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    if (!r.ok) throw new Error("expected ok")
    expect(r.devotional.text.length).toBe(MAX_PARTNER_TEXT_LENGTH)
  })

  it("returns empty when the page yields no main content", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(scrapeOk("   "))
    const r = await fetchPartnerDevotional({
      url: URL,
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(r).toMatchObject({ ok: false, reason: "empty" })
  })

  it("maps a scrape failure to upstream_failed", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 500 }))
    const r = await fetchPartnerDevotional({
      url: URL,
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(r).toMatchObject({ ok: false, reason: "upstream_failed" })
  })

  it("adapts into a grounding snippet", () => {
    const snippet = toGroundingSnippet({
      url: URL,
      title: "Be Still",
      text: "The Lord is near.",
    })
    expect(snippet).toEqual({
      url: URL,
      title: "Be Still",
      snippet: "The Lord is near.",
    })
  })
})
