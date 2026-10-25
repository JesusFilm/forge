import { studioPronunciationLocatorsSchema } from "@forge/studio-contracts/production"
import { z } from "zod"
import {
  studioNarrationIdentitySchema,
  type StudioNarrationIdentity,
} from "@forge/studio-contracts/assets"

export class StudioProviderError extends Error {
  constructor(
    message: string,
    public readonly ambiguous = false,
    public readonly status?: number,
  ) {
    super(message)
  }
}
export type DictionaryLocator = z.infer<
  typeof studioPronunciationLocatorsSchema
>[number]
export const STUDIO_TTS_MAX_CHARACTERS = 2000
/** External provider boundary. No implicit retry, normalization, segmentation or fallback. */
export class ElevenStudioProvider {
  constructor(private readonly config: { key: string; fetch?: typeof fetch }) {}
  private async request(path: string, payload: unknown, signal?: AbortSignal) {
    if (!this.config.key)
      throw new StudioProviderError("ElevenLabs is not configured")
    try {
      const response = await (this.config.fetch ?? fetch)(
        `https://api.elevenlabs.io${path}`,
        {
          method: "POST",
          redirect: "error",
          headers: {
            "xi-api-key": this.config.key,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(90000)])
            : AbortSignal.timeout(90000),
        },
      )
      if (!response.ok) {
        await response.body?.cancel()
        throw new StudioProviderError(
          `Provider returned ${response.status}; inspect before retry`,
          response.status >= 500 || response.status === 429,
          response.status,
        )
      }
      return response
    } catch (error) {
      if (error instanceof StudioProviderError) throw error
      throw new StudioProviderError(
        "Provider result is ambiguous; do not automatically replay",
        true,
      )
    }
  }
  private async bytes(response: Response) {
    const reader = response.body?.getReader()
    if (!reader) throw new StudioProviderError("Missing provider output", true)
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > 24 * 1024 * 1024)
          throw new StudioProviderError("Provider output exceeded bound", true)
        chunks.push(value)
      }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    if (!size) throw new StudioProviderError("Empty provider output", true)
    return Buffer.concat(chunks)
  }
  async narrate(
    raw: StudioNarrationIdentity,
    rawDictionaries: DictionaryLocator[],
    signal?: AbortSignal,
  ) {
    const identity = studioNarrationIdentitySchema.parse(raw)
    const dictionaries =
      studioPronunciationLocatorsSchema.parse(rawDictionaries)
    if (
      identity.provider !== "elevenlabs" ||
      identity.text.length > STUDIO_TTS_MAX_CHARACTERS ||
      !identity.text.trim() ||
      Boolean(identity.pronunciation) !== Boolean(dictionaries.length)
    )
      throw new StudioProviderError(
        "Preflight failed: review explicit segmentation/dictionary before narration",
      )
    const { language_code: selectedLanguage, ...voiceSettings } =
      identity.settings
    const languageCode = selectedLanguage ?? identity.language
    if (
      typeof languageCode !== "string" ||
      !/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(languageCode)
    )
      throw new StudioProviderError(
        "An explicit provider language code is required before review",
      )
    const response = await this.request(
      `/v1/text-to-speech/${encodeURIComponent(identity.voiceId)}?output_format=mp3_44100_128`,
      {
        text: identity.text,
        model_id: identity.model,
        voice_settings: voiceSettings,
        language_code: languageCode,
        apply_text_normalization: "off",
        pronunciation_dictionary_locators: dictionaries,
      },
      signal,
    )
    const requestId = response.headers.get("request-id"),
      creditHeader = response.headers.get("character-cost")
    const credits =
      creditHeader && /^\d+$/.test(creditHeader) ? Number(creditHeader) : null
    return {
      bytes: await this.bytes(response),
      requestId,
      credits,
      text: identity.text,
      identity,
    }
  }
  async music(
    input: {
      prompt: string
      model: string
      lengthMs: number
      instrumental: boolean
    },
    signal?: AbortSignal,
  ) {
    z.object({
      prompt: z.string().min(1).max(4100),
      model: z.enum(["music_v1", "music_v2"]),
      lengthMs: z.number().int().min(3000).max(600000),
      instrumental: z.boolean(),
    })
      .strict()
      .parse(input)
    const response = await this.request(
      "/v1/music?output_format=mp3_44100_128",
      {
        prompt: input.prompt,
        model_id: input.model,
        music_length_ms: input.lengthMs,
        force_instrumental: input.instrumental,
      },
      signal,
    )
    return {
      bytes: await this.bytes(response),
      requestId: response.headers.get("request-id"),
      songId: response.headers.get("song-id"),
      credits: null,
    }
  }
  async designVoice(
    input: {
      prompt: string
      model: string
      text: string
      loudness: number
      guidanceScale: number
    },
    signal?: AbortSignal,
  ) {
    z.object({
      prompt: z.string().min(20).max(1000),
      model: z.enum(["eleven_multilingual_ttv_v2", "eleven_ttv_v3"]),
      text: z.string().min(100).max(1000),
      loudness: z.number().min(-1).max(1),
      guidanceScale: z.number().min(0).max(100),
    })
      .strict()
      .parse(input)
    const response = await this.request(
      "/v1/text-to-voice/design",
      {
        voice_description: input.prompt,
        model_id: input.model,
        text: input.text,
        auto_generate_text: false,
        loudness: input.loudness,
        guidance_scale: input.guidanceScale,
        should_enhance: false,
      },
      signal,
    )
    const data = z
      .object({
        text: z.string().max(2000),
        previews: z
          .array(
            z.object({
              audio_base_64: z.string(),
              generated_voice_id: z.string().max(128),
              media_type: z.string(),
              duration_secs: z.number().positive(),
              language: z.string(),
            }),
          )
          .min(1)
          .max(16),
      })
      .parse(JSON.parse((await this.bytes(response)).toString()))
    return {
      requestId: response.headers.get("request-id"),
      text: data.text,
      candidates: data.previews.map((p) => ({
        bytes: Buffer.from(p.audio_base_64, "base64"),
        voiceId: p.generated_voice_id,
        durationMs: Math.ceil(p.duration_secs * 1000),
        language: p.language,
      })),
      credits: null,
    }
  }
  async registerVoice(
    input: { voiceId: string; name: string; description: string },
    signal?: AbortSignal,
  ) {
    z.object({
      voiceId: z.string().min(1).max(128),
      name: z.string().min(1).max(100),
      description: z.string().max(1000),
    })
      .strict()
      .parse(input)
    const response = await this.request(
      "/v1/text-to-voice",
      {
        generated_voice_id: input.voiceId,
        voice_name: input.name,
        voice_description: input.description,
      },
      signal,
    )
    const result = z
      .object({ voice_id: z.string().min(1).max(128) })
      .parse(JSON.parse((await this.bytes(response)).toString()))
    return {
      ...result,
      requestId: response.headers.get("request-id"),
      credits: null,
      actualCostMicros: null,
    }
  }
}
