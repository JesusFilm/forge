// ElevenLabs TTS adapter + provider dispatch.
// Follows the singleton-function-export pattern from openrouter.ts.

import { env } from "@/config/env"
import type {
  BCP47,
  TTSAdapter,
  VoiceoverProviderName,
  VoiceoverSynthesizeInput,
  VoiceoverSynthesizeResult,
} from "./types"
import { VoiceoverError } from "./types"

// ---------------------------------------------------------------------------
// ElevenLabs adapter
// ---------------------------------------------------------------------------

const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1"
const ELEVENLABS_MODEL = "eleven_flash_v2_5"
const ELEVENLABS_DEFAULT_VOICE = "aria"
const ELEVENLABS_MAX_CHARS = 40_000

function createElevenLabsAdapter(apiKey: string): TTSAdapter {
  return {
    name: "elevenlabs",

    async synthesize(
      input: VoiceoverSynthesizeInput,
    ): Promise<VoiceoverSynthesizeResult> {
      const voiceId = input.voiceId ?? ELEVENLABS_DEFAULT_VOICE

      const body: Record<string, unknown> = {
        text: input.text,
        model_id: ELEVENLABS_MODEL,
        output_format: "mp3_44100_128",
        language_code: input.language,
      }
      if (input.previousText) body.previous_text = input.previousText
      if (input.nextText) body.next_text = input.nextText

      const response = await fetch(
        `${ELEVENLABS_BASE_URL}/text-to-speech/${encodeURIComponent(voiceId)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": apiKey,
          },
          body: JSON.stringify(body),
        },
      )

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error")

        if (response.status === 429) {
          const retryAfter = response.headers.get("retry-after")
          throw new VoiceoverError(
            "RATE_LIMITED",
            "elevenlabs",
            `Rate limited: ${errorText}`,
            true,
            retryAfter ? Number(retryAfter) * 1000 : 60_000,
          )
        }

        if (response.status === 401 || response.status === 403) {
          throw new VoiceoverError(
            "QUOTA_EXCEEDED",
            "elevenlabs",
            `Auth/quota error (${response.status}): ${errorText}`,
          )
        }

        throw new VoiceoverError(
          "SYNTHESIS_FAILED",
          "elevenlabs",
          `HTTP ${response.status}: ${errorText}`,
          response.status >= 500,
        )
      }

      const arrayBuffer = await response.arrayBuffer()
      const requestId = response.headers.get("request-id") ?? undefined

      return {
        contentType: "audio/mpeg",
        ext: "mp3",
        audio: new Uint8Array(arrayBuffer),
        metadata: {
          provider: "elevenlabs",
          model: ELEVENLABS_MODEL,
          voiceId,
          voiceName: voiceId,
          requestId,
        },
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Provider defaults — maps BCP 47 base language to preferred provider + voice
// ---------------------------------------------------------------------------

const PROVIDER_DEFAULTS = {
  en: { provider: "elevenlabs", voiceId: "aria" },
  es: { provider: "elevenlabs" },
  fr: { provider: "elevenlabs" },
  pt: { provider: "elevenlabs" },
  de: { provider: "elevenlabs" },
  zh: { provider: "elevenlabs" },
  ar: { provider: "elevenlabs" },
  hi: { provider: "elevenlabs" },
  ja: { provider: "elevenlabs" },
  ko: { provider: "elevenlabs" },
} as const satisfies Record<
  string,
  { provider: VoiceoverProviderName; voiceId?: string }
>

// ---------------------------------------------------------------------------
// Provider character limits (per-request)
// ---------------------------------------------------------------------------

export const PROVIDER_CHAR_LIMITS: Record<VoiceoverProviderName, number> = {
  elevenlabs: ELEVENLABS_MAX_CHARS,
  "google-tts": 5_000,
  "amazon-polly": 3_000,
}

// ---------------------------------------------------------------------------
// Singleton adapter instances (follows getOpenrouter() pattern)
// ---------------------------------------------------------------------------

let _elevenlabs: TTSAdapter | undefined

function getElevenLabs(): TTSAdapter {
  if (!_elevenlabs) {
    if (!env.ELEVENLABS_API_KEY) {
      throw new VoiceoverError(
        "PROVIDER_UNAVAILABLE",
        "elevenlabs",
        "ELEVENLABS_API_KEY is not configured",
      )
    }
    _elevenlabs = createElevenLabsAdapter(env.ELEVENLABS_API_KEY)
  }
  return _elevenlabs
}

export function getTTSAdapter(provider?: VoiceoverProviderName): TTSAdapter {
  const name = provider ?? "elevenlabs"
  switch (name) {
    case "elevenlabs":
      return getElevenLabs()
    // case "google-tts": return getGoogleTTS()
    // case "amazon-polly": return getAmazonPolly()
    default:
      throw new VoiceoverError(
        "PROVIDER_UNAVAILABLE",
        name,
        `Unknown provider: ${name}`,
      )
  }
}

// ---------------------------------------------------------------------------
// Language → provider selection
// ---------------------------------------------------------------------------

export function selectProviderForLanguage(language: BCP47): {
  adapter: TTSAdapter
  voiceId?: string
} {
  const langKey = language.split("-")[0] as keyof typeof PROVIDER_DEFAULTS
  const config = PROVIDER_DEFAULTS[langKey]
  const providerName = config?.provider ?? "elevenlabs"
  const voiceId = config && "voiceId" in config ? config.voiceId : undefined
  return { adapter: getTTSAdapter(providerName), voiceId }
}

// ---------------------------------------------------------------------------
// Text chunking — Intl.Segmenter for multilingual sentence splitting
// ---------------------------------------------------------------------------

export function splitIntoSentences(
  text: string,
  locale: string = "en",
): string[] {
  const segmenter = new Intl.Segmenter(locale, { granularity: "sentence" })
  return Array.from(segmenter.segment(text), (s) => s.segment)
}

export function batchSentences(
  sentences: string[],
  maxChars: number,
): string[] {
  const batches: string[] = []
  let current = ""

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      // Flush current batch
      if (current) {
        batches.push(current.trim())
        current = ""
      }
      // Fall back to word-level splitting for oversized sentences
      const wordSegmenter = new Intl.Segmenter("en", { granularity: "word" })
      let wordBatch = ""
      for (const seg of wordSegmenter.segment(sentence)) {
        if ((wordBatch + seg.segment).length > maxChars) {
          if (wordBatch) batches.push(wordBatch.trim())
          wordBatch = ""
        }
        wordBatch += seg.segment
      }
      if (wordBatch.trim()) batches.push(wordBatch.trim())
      continue
    }

    if ((current + sentence).length > maxChars) {
      batches.push(current.trim())
      current = ""
    }
    current += sentence
  }

  if (current.trim()) batches.push(current.trim())
  return batches
}

// ---------------------------------------------------------------------------
// MP3 helpers — strip ID3v2 headers for clean CBR concatenation
// ---------------------------------------------------------------------------

export function stripId3Header(buffer: Uint8Array): Uint8Array {
  // ID3v2 header: "ID3" magic bytes
  if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
    const size =
      ((buffer[6] & 0x7f) << 21) |
      ((buffer[7] & 0x7f) << 14) |
      ((buffer[8] & 0x7f) << 7) |
      (buffer[9] & 0x7f)
    return buffer.subarray(10 + size)
  }
  return buffer
}
