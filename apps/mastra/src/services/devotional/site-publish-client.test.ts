import { describe, expect, it, vi } from "vitest"

import {
  publishDevotional,
  SITE_PUBLISH_MAX_RESPONSE_BYTES,
  _internal,
} from "./site-publish-client"
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

const VIDEO_ASSETS = {
  portrait: {
    assetId: "devo_20260622",
    artifactType: "devotional-output-portrait-v1",
    ext: "mp4" as const,
  },
  wide: {
    assetId: "devo_20260622",
    artifactType: "devotional-output-wide-v1",
    ext: "mp4" as const,
  },
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
      videoAssets: VIDEO_ASSETS,
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(result).toEqual({ ok: true, published: true })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe(CONFIG.url)
    expect(init.redirect).toBe("error")
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer ingest-key",
    )
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe(
      "daily-devotional:2026-06-22",
    )
    const payload = JSON.parse(init.body as string)
    expect(payload.date).toBe("2026-06-22")
    expect(payload.devotional.scripture.reference).toBe("John 4:14")
    expect(payload.devotional.questions).toHaveLength(2)
    expect(payload.devotional.videoAssets).toEqual(VIDEO_ASSETS)
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

  it("rejects an insecure ingest URL before sending the bearer", async () => {
    const fetchImpl = vi.fn()

    const result = await publishDevotional({
      devotional: DEVOTIONAL,
      config: {
        url: "http://watch.example.org/api/devotional-ingest",
        apiKey: "ingest-key",
      },
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

  it("rejects an ambiguous 2xx object without an explicit success flag", async () => {
    const result = await publishDevotional({
      devotional: DEVOTIONAL,
      config: CONFIG,
      fetchImpl: (async () =>
        jsonResponse(200, { message: "queued" })) as unknown as typeof fetch,
    })

    expect(result).toMatchObject({ ok: false, reason: "invalid_response" })
  })

  it("preserves an explicit false acceptance result", async () => {
    const result = await publishDevotional({
      devotional: DEVOTIONAL,
      config: CONFIG,
      fetchImpl: (async () =>
        jsonResponse(200, { accepted: false })) as unknown as typeof fetch,
    })

    expect(result).toEqual({ ok: true, published: false })
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

  it("cancels an over-cap success body and maps it to invalid_response", async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(SITE_PUBLISH_MAX_RESPONSE_BYTES + 1))
      },
      cancel() {
        cancelled = true
      },
    })
    const result = await publishDevotional({
      devotional: DEVOTIONAL,
      config: CONFIG,
      fetchImpl: (async () => new Response(stream)) as unknown as typeof fetch,
    })

    expect(cancelled).toBe(true)
    expect(result).toMatchObject({
      ok: false,
      reason: "invalid_response",
      retryable: false,
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
        "prayer",
        "reflection",
        "scripture",
        "video",
        "videoMatch",
        "videoAssets",
      ].sort(),
    )
  })

  it("includes guided prayer and both rendered assets in the publish contract", () => {
    const payload = _internal.buildPayload(
      { ...DEVOTIONAL, prayer: "Lord, lead us in hope." },
      VIDEO_ASSETS,
    )
    expect(payload.devotional.prayer).toBe("Lord, lead us in hope.")
    expect(payload.devotional.videoAssets).toEqual(VIDEO_ASSETS)
  })
})
