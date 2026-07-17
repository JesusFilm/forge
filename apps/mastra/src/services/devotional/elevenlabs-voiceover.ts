import {
  getDevotionalElevenVoiceId,
  getElevenLabsConfig,
} from "../../config/env"
import type { ElevenLabsConfig } from "../../config/env"
import type { Devotional } from "./types"
import { buildNarrationText, MAX_VOICEOVER_TEXT_LENGTH } from "./voiceover"

/**
 * ElevenLabs Text-to-Speech voiceover for the daily devotional.
 *
 * Turns a devotional's spoken script into narrated MP3 audio via ElevenLabs'
 * `/v1/text-to-speech/{voice_id}` endpoint. Replaces the earlier Azure Neural
 * TTS path; the result shape is identical so nothing downstream changes.
 *
 * Opt-in and best-effort, mirroring `voiceover.ts` / `site-publish-client.ts`:
 * with no `ELEVENLABS_API_KEY` it returns `config_missing` so the workflow
 * treats voiceover as skipped rather than a failed run. Typed discriminated
 * result, bounded timeout, no throwing on the success path.
 *
 * This service only GENERATES audio bytes. Persisting them and threading the
 * audio URL into the published devotional is the caller's job — kept separate
 * so generation stays pure and easy to test.
 *
 * `buildNarrationText` and the length cap are shared with the Azure module so
 * the spoken script is assembled identically regardless of the TTS provider.
 */

const API_BASE = "https://api.elevenlabs.io"
const DEFAULT_TIMEOUT_MS = 30_000
/** 44.1kHz / 128kbps MP3 — clean enough for narration, widely playable. */
const OUTPUT_FORMAT = "mp3_44100_128"

/**
 * The auditioned devotional voices (ElevenLabs Voice Library). `default` is the
 * env-configured voice; these are handy named aliases for callers and future
 * per-language / per-tone selection. Ids are stable ElevenLabs voice ids.
 */
export const DEVOTIONAL_VOICES = {
  "male-d": "HKFOb9iktHA85uKXydRT",
  "male-e": "xLeLcqgjUx3wQJFSESKj",
  "female-c": "WonySogMOJVSOnlOGFQh",
} as const

export type DevotionalVoiceName = keyof typeof DEVOTIONAL_VOICES

/**
 * Delivery settings. Lower `stability` + a touch of `style` reads as warm and
 * emotive rather than flat (the audition rejected the flat, high-stability
 * default). Tuned once here so every devotional narrates consistently.
 */
export type ElevenVoiceSettings = {
  stability: number
  similarity_boost: number
  style: number
  use_speaker_boost: boolean
}

export const DEFAULT_VOICE_SETTINGS: ElevenVoiceSettings = {
  stability: 0.35,
  similarity_boost: 0.85,
  style: 0.45,
  use_speaker_boost: true,
}

export type VoiceoverAudio = {
  format: "mp3"
  bytes: Uint8Array
  /** The ElevenLabs voice id that synthesized the audio. */
  voiceId: string
  /** The ElevenLabs model id used (e.g. `eleven_multilingual_v2`). */
  model: string
  /** Number of characters of narration sent (billing-relevant). */
  characterCount: number
}

export type VoiceoverResult =
  | { ok: true; audio: VoiceoverAudio }
  | {
      ok: false
      reason:
        | "config_missing"
        | "invalid_input"
        | "auth_failed"
        | "upstream_failed"
        | "transport"
      retryable: boolean
      status?: number
      details?: string
    }

export type GenerateVoiceoverInput = {
  /** Explicit narration text. When omitted, `devotional` is required. */
  text?: string
  /** Source devotional; its spoken script is assembled via `buildNarrationText`. */
  devotional?: Devotional
  /** Voice id OR a named alias from `DEVOTIONAL_VOICES`. Defaults to the env voice. */
  voice?: DevotionalVoiceName | string
  /** Override the tuned delivery settings. */
  voiceSettings?: ElevenVoiceSettings
  /** Injectable for tests; defaults to the resolved ElevenLabs env config. */
  config?: ElevenLabsConfig
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** Resolve a named alias (e.g. "male-d") to a voice id; pass ids through unchanged. */
export function resolveVoiceId(voice: string): string {
  return (DEVOTIONAL_VOICES as Record<string, string>)[voice] ?? voice
}

export async function generateElevenVoiceover(
  input: GenerateVoiceoverInput = {},
): Promise<VoiceoverResult> {
  const config = input.config ?? getElevenLabsConfig()
  if (!config.apiKey) {
    return {
      ok: false,
      reason: "config_missing",
      retryable: false,
      details: "ELEVENLABS_API_KEY is required",
    }
  }

  const text = (
    input.text ?? (input.devotional ? buildNarrationText(input.devotional) : "")
  )
    .trim()
    .slice(0, MAX_VOICEOVER_TEXT_LENGTH)
  if (!text) {
    return {
      ok: false,
      reason: "invalid_input",
      retryable: false,
      details: "no narration text (provide `text` or `devotional`)",
    }
  }

  const voiceId = resolveVoiceId(input.voice ?? getDevotionalElevenVoiceId())
  const fetchImpl = input.fetchImpl ?? fetch
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS

  let response: Response
  try {
    response = await fetchImpl(
      `${API_BASE}/v1/text-to-speech/${voiceId}?output_format=${OUTPUT_FORMAT}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": config.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: config.ttsModel,
          voice_settings: input.voiceSettings ?? DEFAULT_VOICE_SETTINGS,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    )
  } catch (error) {
    return {
      ok: false,
      reason: "transport",
      retryable: true,
      details: error instanceof Error ? error.message : String(error),
    }
  }

  if (!response.ok) {
    const status = response.status
    if (status === 401 || status === 403) {
      return { ok: false, reason: "auth_failed", retryable: false, status }
    }
    const retryable = status === 429 || status >= 500
    return { ok: false, reason: "upstream_failed", retryable, status }
  }

  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await response.arrayBuffer())
  } catch (error) {
    return {
      ok: false,
      reason: "transport",
      retryable: true,
      details: error instanceof Error ? error.message : String(error),
    }
  }

  if (bytes.byteLength === 0) {
    return {
      ok: false,
      reason: "upstream_failed",
      retryable: true,
      status: response.status,
      details: "empty audio response",
    }
  }

  return {
    ok: true,
    audio: {
      format: "mp3",
      bytes,
      voiceId,
      model: config.ttsModel,
      characterCount: text.length,
    },
  }
}
