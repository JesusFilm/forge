import { describe, expect, it, vi } from "vitest"

import type { ElevenLabsConfig } from "../../config/env"
import {
  DEFAULT_MUSIC_MS,
  generateMusic,
  MAX_MUSIC_MS,
  MIN_MUSIC_MS,
  MUSIC_MOODS,
} from "./elevenlabs-music"

const CONFIG: ElevenLabsConfig = {
  apiKey: "eleven-key",
  ttsModel: "eleven_multilingual_v2",
  musicModel: "music_v1",
}

function audioResponse(bytes = new Uint8Array([9, 8, 7])): Response {
  return new Response(bytes, { status: 200 })
}

describe("generateMusic", () => {
  it("returns config_missing when the api key is absent", async () => {
    const r = await generateMusic({ config: { ...CONFIG, apiKey: undefined } })
    expect(r).toMatchObject({
      ok: false,
      reason: "config_missing",
      retryable: false,
    })
  })

  it("returns invalid_input when an explicit prompt is blank", async () => {
    const r = await generateMusic({ prompt: "   ", config: CONFIG })
    expect(r).toMatchObject({ ok: false, reason: "invalid_input" })
  })

  it("defaults to the peace mood and posts a clamped length", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(audioResponse())
    const r = await generateMusic({
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error("expected ok")
    expect(r.audio.prompt).toBe(MUSIC_MOODS.peace)
    expect(r.audio.lengthMs).toBe(DEFAULT_MUSIC_MS)
    expect(r.audio.model).toBe("music_v1")

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(
      "https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128",
    )
    expect(init.headers["xi-api-key"]).toBe("eleven-key")
    const body = JSON.parse(init.body)
    expect(body.prompt).toBe(MUSIC_MOODS.peace)
    expect(body.music_length_ms).toBe(DEFAULT_MUSIC_MS)
    expect(body.force_instrumental).toBe(true)
    expect(body.model_id).toBe("music_v1")
  })

  it("uses the named mood prompt when given", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(audioResponse())
    const r = await generateMusic({
      mood: "lament",
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    if (!r.ok) throw new Error("expected ok")
    expect(r.audio.prompt).toBe(MUSIC_MOODS.lament)
  })

  it("clamps length below the minimum and above the maximum", async () => {
    // Fresh Response per call — a body can only be read once.
    const fetchImpl = vi.fn().mockImplementation(async () => audioResponse())
    const low = await generateMusic({
      lengthMs: 10,
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const high = await generateMusic({
      lengthMs: 5_000_000,
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    if (!low.ok || !high.ok) throw new Error("expected ok")
    expect(low.audio.lengthMs).toBe(MIN_MUSIC_MS)
    expect(high.audio.lengthMs).toBe(MAX_MUSIC_MS)
  })

  it("maps 401 to a non-retryable auth_failed", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("no", { status: 401 }))
    const r = await generateMusic({
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
      const r = await generateMusic({
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

  it("treats a thrown fetch as a retryable transport failure", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("aborted"))
    const r = await generateMusic({
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(r).toMatchObject({ ok: false, reason: "transport", retryable: true })
  })

  it("treats an empty 200 body as a retryable upstream_failed", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(audioResponse(new Uint8Array([])))
    const r = await generateMusic({
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
