import { describe, expect, it } from "vitest"
import { ElevenStudioProvider } from "./provider"

describe("Studio provider boundary", () => {
  it("sends reviewed speech unchanged, including whitespace and explicit null pronunciation", async () => {
    const observed: unknown[] = []
    const provider = new ElevenStudioProvider({
      key: "test",
      fetch: async (_url, init) => {
        observed.push(JSON.parse(String(init?.body)))
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "request-id": "paid-request", "character-cost": "21" },
        })
      },
    })
    const result = await provider.narrate(
      {
        text: "  Take a quiet breath.\n",
        role: "settle",
        language: "en",
        provider: "elevenlabs",
        model: "eleven_multilingual_v2",
        voiceId: "selected",
        settings: { stability: 0.5 },
        pronunciation: null,
      },
      [],
    )
    expect(observed).toEqual([
      {
        text: "  Take a quiet breath.\n",
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5 },
        language_code: "en",
        apply_text_normalization: "off",
        pronunciation_dictionary_locators: [],
      },
    ])
    expect(result).toMatchObject({
      requestId: "paid-request",
      credits: 21,
      text: "  Take a quiet breath.\n",
    })
  })
  it("rejects overlength speech before transport and retains all designed voice previews", async () => {
    let calls = 0
    const provider = new ElevenStudioProvider({
      key: "test",
      fetch: async () => {
        calls++
        return Response.json({
          text: "A".repeat(120),
          previews: [1, 2, 3].map((n) => ({
            audio_base_64: "AQID",
            generated_voice_id: `design-${n}`,
            media_type: "audio/mpeg",
            duration_secs: 1,
            language: "en",
          })),
        })
      },
    })
    await expect(
      provider.narrate(
        {
          text: "A".repeat(2001),
          role: "bridge",
          language: "en",
          provider: "elevenlabs",
          model: "eleven_multilingual_v2",
          voiceId: "selected",
          settings: {},
          pronunciation: null,
        },
        [],
      ),
    ).rejects.toMatchObject({ ambiguous: false })
    expect(calls).toBe(0)
    const result = await provider.designVoice({
      prompt: "Warm calm adult English narrator",
      model: "eleven_multilingual_ttv_v2",
      text: "A".repeat(120),
      loudness: 0.5,
      guidanceScale: 5,
    })
    expect(result.candidates.map((c) => c.voiceId)).toEqual([
      "design-1",
      "design-2",
      "design-3",
    ])
  })

  it("uses an inspectable provider language code and exact pinned pronunciation dependencies", async () => {
    const observed: unknown[] = []
    const provider = new ElevenStudioProvider({
      key: "test",
      fetch: async (_url, init) => {
        observed.push(JSON.parse(String(init?.body)))
        return new Response(new Uint8Array([1, 2, 3]))
      },
    })
    const identity = {
      text: "An exact bridge.",
      role: "bridge",
      language: "english",
      provider: "elevenlabs",
      model: "eleven_multilingual_v2",
      voiceId: "selected",
      settings: { language_code: "en", stability: 0.5 },
      pronunciation: {
        assetId: "dictionary",
        versionId: "pinned-version",
        digest: "a".repeat(64),
      },
    }
    const dictionaries = [
      {
        pronunciation_dictionary_id: "provider-dictionary",
        version_id: "provider-version",
      },
    ]
    const result = await provider.narrate(identity, dictionaries)
    expect(result.identity).toEqual(identity)
    expect(observed).toEqual([
      {
        text: identity.text,
        model_id: identity.model,
        language_code: "en",
        voice_settings: { stability: 0.5 },
        apply_text_normalization: "off",
        pronunciation_dictionary_locators: dictionaries,
      },
    ])
  })
})
