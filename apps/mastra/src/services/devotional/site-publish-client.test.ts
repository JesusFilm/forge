import { describe, expect, it, vi } from "vitest"

import { publishDevotional, _internal } from "./site-publish-client"
import type { Devotional } from "./types"

const DEVOTIONAL: Devotional = {
  date: "2026-06-22",
  hook: {
    type: "news",
    title: "A world thirsty for living water",
    summary: "Leaders meet over clean water.",
    sourceUrl: "https://news.example.org/x",
  },
  scripture: {
    reference: "John 4:14",
    text: "Whoever drinks the water I give will never thirst.",
    translation: "NIV",
    needsCanonicalSource: true,
  },
  video: {
    videoId: "video-7",
    title: "The woman at the well",
    url: "woman-at-the-well",
    thumbnailUrl: null,
  },
  videoMatch: "search",
  reflection: "The deepest thirst is met in Christ.",
  questions: [
    "What are you thirsty for?",
    "Where have you looked to satisfy it?",
  ],
  furtherReading: null,
  blockOrder: ["hook", "scripture", "video", "reflection", "questions"],
}

const CONFIG = {
  url: "https://watch.example.org/api/devotional-ingest",
  apiKey: "ingest-key",
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("publishDevotional", () => {
  it("posts the devotional payload with the date key and returns published", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { published: true }))

    const result = await publishDevotional({
      devotional: DEVOTIONAL,
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(result).toEqual({ ok: true, published: true })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit]
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer ingest-key",
    )
    const payload = JSON.parse(init.body as string)
    expect(payload.date).toBe("2026-06-22")
    expect(payload.devotional.scripture.reference).toBe("John 4:14")
    expect(payload.devotional.questions).toHaveLength(2)
    expect(payload.devotional.blockOrder).toContain("video")
  })

  it("returns config_missing without calling fetch when unconfigured", async () => {
    const fetchImpl = vi.fn()

    const result = await publishDevotional({
      devotional: DEVOTIONAL,
      config: { url: undefined, apiKey: undefined },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(result).toEqual({
      ok: false,
      reason: "config_missing",
      retryable: false,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("maps 401 to auth_failed (not retryable)", async () => {
    const result = await publishDevotional({
      devotional: DEVOTIONAL,
      config: CONFIG,
      fetchImpl: (async () =>
        jsonResponse(401, { error: "bad token" })) as unknown as typeof fetch,
    })

    expect(result).toMatchObject({
      ok: false,
      reason: "auth_failed",
      retryable: false,
      status: 401,
    })
  })

  it("maps 5xx to retryable upstream_failed", async () => {
    const result = await publishDevotional({
      devotional: DEVOTIONAL,
      config: CONFIG,
      fetchImpl: (async () =>
        jsonResponse(503, { error: "down" })) as unknown as typeof fetch,
    })

    expect(result).toMatchObject({
      ok: false,
      reason: "upstream_failed",
      retryable: true,
      status: 503,
    })
  })

  it("returns invalid_response when the body is not JSON", async () => {
    const result = await publishDevotional({
      devotional: DEVOTIONAL,
      config: CONFIG,
      fetchImpl: (async () =>
        new Response("not json", { status: 200 })) as unknown as typeof fetch,
    })

    expect(result).toMatchObject({ ok: false, reason: "invalid_response" })
  })

  it("treats a network throw as retryable upstream_failed", async () => {
    const result = await publishDevotional({
      devotional: DEVOTIONAL,
      config: CONFIG,
      fetchImpl: (async () => {
        throw new Error("ECONNRESET")
      }) as unknown as typeof fetch,
    })

    expect(result).toMatchObject({
      ok: false,
      reason: "upstream_failed",
      retryable: true,
    })
  })

  it("includes every devotional ingredient in the payload", () => {
    const payload = _internal.buildPayload(DEVOTIONAL)
    expect(Object.keys(payload.devotional).sort()).toEqual(
      [
        "blockOrder",
        "furtherReading",
        "hook",
        "questions",
        "reflection",
        "scripture",
        "video",
        "videoMatch",
      ].sort(),
    )
  })
})
