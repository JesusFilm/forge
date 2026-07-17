import { describe, expect, it, vi } from "vitest"

import {
  buildNarrationText,
  buildSsml,
  generateVoiceover,
  localeFromVoice,
  MAX_VOICEOVER_TEXT_LENGTH,
} from "./voiceover"
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
  questions: ["What are you thirsty for?"],
  furtherReading: null,
  blockOrder: ["hook", "scripture", "video", "reflection", "questions"],
}

const CONFIG = { key: "azure-key", region: "eastus" }

function audioResponse(bytes = new Uint8Array([1, 2, 3])): Response {
  return new Response(bytes, { status: 200 })
}

describe("buildNarrationText", () => {
  it("assembles hook, scripture, and reflection in a fixed spoken order", () => {
    const text = buildNarrationText(DEVOTIONAL)
    expect(text).toBe(
      "A world thirsty for living water\n\n" +
        "Leaders meet over clean water.\n\n" +
        "John 4:14. Whoever drinks the water I give will never thirst.\n\n" +
        "The deepest thirst is met in Christ.",
    )
  })

  it("does not narrate the on-card questions", () => {
    expect(buildNarrationText(DEVOTIONAL)).not.toContain(
      "What are you thirsty for?",
    )
  })

  it("caps narration at the max length", () => {
    const long: Devotional = {
      ...DEVOTIONAL,
      reflection: "x".repeat(MAX_VOICEOVER_TEXT_LENGTH * 2),
    }
    expect(buildNarrationText(long).length).toBe(MAX_VOICEOVER_TEXT_LENGTH)
  })
})

describe("localeFromVoice", () => {
  it("derives the locale prefix from a neural voice name", () => {
    expect(localeFromVoice("en-US-AndrewMultilingualNeural")).toBe("en-US")
    expect(localeFromVoice("es-MX-DaliaNeural")).toBe("es-MX")
  })

  it("falls back to en-US for an unrecognized voice", () => {
    expect(localeFromVoice("weirdvoice")).toBe("en-US")
  })
})

describe("buildSsml", () => {
  it("escapes XML special characters in the narration", () => {
    const ssml = buildSsml({
      text: 'Faith & "hope" <love>',
      voice: "en-US-AndrewNeural",
    })
    expect(ssml).toContain("Faith &amp; &quot;hope&quot; &lt;love&gt;")
    expect(ssml).not.toContain("<love>")
  })

  it("wraps in express-as only when a style is given", () => {
    const plain = buildSsml({ text: "Hi", voice: "en-US-AndrewNeural" })
    expect(plain).not.toContain("mstts:express-as")
    const styled = buildSsml({
      text: "Hi",
      voice: "en-US-AndrewNeural",
      style: "hopeful",
    })
    expect(styled).toContain('<mstts:express-as style="hopeful">')
  })

  it("uses the voice-derived locale on speak and the voice name", () => {
    const ssml = buildSsml({ text: "Hi", voice: "es-MX-DaliaNeural" })
    expect(ssml).toContain('xml:lang="es-MX"')
    expect(ssml).toContain('<voice name="es-MX-DaliaNeural">')
  })
})

describe("generateVoiceover", () => {
  it("returns config_missing when key or region is absent", async () => {
    const r = await generateVoiceover({
      text: "Hi",
      config: { region: "eastus" },
    })
    expect(r).toMatchObject({
      ok: false,
      reason: "config_missing",
      retryable: false,
    })
  })

  it("returns invalid_input when there is no narration text", async () => {
    const r = await generateVoiceover({ text: "   ", config: CONFIG })
    expect(r).toMatchObject({ ok: false, reason: "invalid_input" })
  })

  it("posts SSML to the regional endpoint and returns audio bytes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(audioResponse())
    const r = await generateVoiceover({
      devotional: DEVOTIONAL,
      config: CONFIG,
      style: "hopeful",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error("expected ok")
    expect(r.audio.format).toBe("mp3")
    expect(r.audio.voice).toBe("en-US-AndrewMultilingualNeural")
    expect(r.audio.locale).toBe("en-US")
    expect(r.audio.bytes.byteLength).toBe(3)

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(
      "https://eastus.tts.speech.microsoft.com/cognitiveservices/v1",
    )
    expect(init.headers["Ocp-Apim-Subscription-Key"]).toBe("azure-key")
    expect(init.headers["Content-Type"]).toBe("application/ssml+xml")
    expect(init.headers["X-Microsoft-OutputFormat"]).toContain("mp3")
    expect(init.body).toContain('<mstts:express-as style="hopeful">')
  })

  it("maps 401 to a non-retryable auth_failed", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("no", { status: 401 }))
    const r = await generateVoiceover({
      text: "Hi",
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(r).toMatchObject({
      ok: false,
      reason: "auth_failed",
      retryable: false,
      status: 401,
    })
  })

  it("maps 429 and 5xx to a retryable upstream_failed", async () => {
    for (const status of [429, 500, 503]) {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(new Response("err", { status }))
      const r = await generateVoiceover({
        text: "Hi",
        config: CONFIG,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
      expect(r).toMatchObject({
        ok: false,
        reason: "upstream_failed",
        retryable: true,
        status,
      })
    }
  })

  it("maps other 4xx to a non-retryable upstream_failed", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("bad", { status: 400 }))
    const r = await generateVoiceover({
      text: "Hi",
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(r).toMatchObject({
      ok: false,
      reason: "upstream_failed",
      retryable: false,
      status: 400,
    })
  })

  it("treats a thrown fetch (timeout/network) as a retryable transport failure", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("aborted"))
    const r = await generateVoiceover({
      text: "Hi",
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(r).toMatchObject({ ok: false, reason: "transport", retryable: true })
  })

  it("treats an empty 200 body as a retryable upstream_failed", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(audioResponse(new Uint8Array([])))
    const r = await generateVoiceover({
      text: "Hi",
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(r).toMatchObject({
      ok: false,
      reason: "upstream_failed",
      retryable: true,
    })
  })
})
