import { describe, expect, it, vi } from "vitest"

import type { ElevenLabsConfig } from "../../config/env"
import {
  DEFAULT_VOICE_SETTINGS,
  DEVOTIONAL_VOICES,
  generateElevenVoiceover,
  resolveVoiceId,
} from "./elevenlabs-voiceover"
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

const CONFIG: ElevenLabsConfig = {
  apiKey: "eleven-key",
  ttsModel: "eleven_multilingual_v2",
  musicModel: "music_v1",
}

function audioResponse(bytes = new Uint8Array([1, 2, 3])): Response {
  return new Response(bytes, { status: 200 })
}

describe("resolveVoiceId", () => {
  it("maps a named alias to its voice id", () => {
    expect(resolveVoiceId("male-d")).toBe(DEVOTIONAL_VOICES["male-d"])
    expect(resolveVoiceId("female-c")).toBe(DEVOTIONAL_VOICES["female-c"])
  })

  it("passes a raw voice id through unchanged", () => {
    expect(resolveVoiceId("abc123raw")).toBe("abc123raw")
  })
})

describe("generateElevenVoiceover", () => {
  it("returns config_missing when the api key is absent", async () => {
    const r = await generateElevenVoiceover({
      text: "Hi",
      config: { ...CONFIG, apiKey: undefined },
    })
    expect(r).toMatchObject({
      ok: false,
      reason: "config_missing",
      retryable: false,
    })
  })

  it("returns invalid_input when there is no narration text", async () => {
    const r = await generateElevenVoiceover({ text: "   ", config: CONFIG })
    expect(r).toMatchObject({ ok: false, reason: "invalid_input" })
  })

  it("posts to the voice endpoint and returns audio bytes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(audioResponse())
    const r = await generateElevenVoiceover({
      devotional: DEVOTIONAL,
      voice: "male-d",
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error("expected ok")
    expect(r.audio.format).toBe("mp3")
    expect(r.audio.voiceId).toBe(DEVOTIONAL_VOICES["male-d"])
    expect(r.audio.model).toBe("eleven_multilingual_v2")
    expect(r.audio.bytes.byteLength).toBe(3)

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(
      `https://api.elevenlabs.io/v1/text-to-speech/${DEVOTIONAL_VOICES["male-d"]}?output_format=mp3_44100_128`,
    )
    expect(init.headers["xi-api-key"]).toBe("eleven-key")
    expect(init.headers["Content-Type"]).toBe("application/json")
    const body = JSON.parse(init.body)
    expect(body.model_id).toBe("eleven_multilingual_v2")
    expect(body.voice_settings).toEqual(DEFAULT_VOICE_SETTINGS)
    expect(body.text).toContain("A world thirsty for living water")
  })

  it("maps 401 to a non-retryable auth_failed", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("no", { status: 401 }))
    const r = await generateElevenVoiceover({
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
      const r = await generateElevenVoiceover({
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
      .mockResolvedValue(new Response("bad", { status: 422 }))
    const r = await generateElevenVoiceover({
      text: "Hi",
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(r).toMatchObject({
      ok: false,
      reason: "upstream_failed",
      retryable: false,
      status: 422,
    })
  })

  it("treats a thrown fetch (timeout/network) as a retryable transport failure", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("aborted"))
    const r = await generateElevenVoiceover({
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
    const r = await generateElevenVoiceover({
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
