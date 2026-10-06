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
  // Owner's pick for the reflection voice from the Prodigal Son on
  // (2026-09-30), replacing female-c there.
  "female-d": "98ujrzs7rxAMEsaC4EpW",
  // Russian-locale narration voice (owner pick "JFvoice_Rus"); selected in
  // devotional-locale.ts. Good for Russian, NOT for English (owner-tested).
  // (English uses the rotation above; a fixed English voice was a local
  // experiment only — pass an explicit voice id per render if needed.)
  russian: "JfyX9t7XtuhnbIirgQA7",
  // "El Faraon - Full, Clear" from the voice library: Latin American, older
  // male, deep and clear. Owner's pick from six samples (2026-09-18).
  spanish: "8mBRP99B2Ng2QwsJMFQl",
  // "Luisa (Narrator)" from the voice library: natural, relatable, neutral
  // Latin American narrator. Owner's pick for the Spanish reflection voice
  // (2026-09-30), beside El Faraon for the notes.
  "spanish-female": "1u9q7vX1Lcx74yAcFPt7",
  // "Kate - Calm, Natural and Versatile" from the voice library: Russian
  // female narrator, warm and clear. Owner's pick from six samples for the
  // Russian reflection voice (2026-10-06), beside JFvoice_Rus on Eleven v4.
  // She is generated ~12 dB quieter than the male voice; the render's
  // per-voice levelling brings her up.
  "russian-female": "7G0NvIkWRnU0Dqjgz13p",
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
  /**
   * Pace, 0.7 to 1.2, where 1 is the voice's own. It moves the pauses as well
   * as the words, so 1.1 takes noticeably more than a tenth off a paragraph.
   * English narration only; the Russian recipe is approved at native pace.
   */
  speed?: number
}

/**
 * Reflection-body delivery. Owner's pick from a four-way audition on
 * 2026-09-25: the earlier 0.35 / 0.45 at native pace read "too slow and too
 * monotone". Stability is what flattens a read, so it comes DOWN and style goes
 * up, and the pace goes to 1.1. Calm is still the brief: livelier, never loud.
 */
export const DEFAULT_VOICE_SETTINGS: ElevenVoiceSettings = {
  stability: 0.25,
  similarity_boost: 0.85,
  style: 0.6,
  use_speaker_boost: true,
  speed: 1.1,
}

/** One spoken word with the real time ElevenLabs says it, in seconds from the
 *  start of THIS segment's audio. Derived from the API's character-level
 *  alignment (see `withTimestamps`), so captions can be revealed word by word
 *  in step with the voice instead of at a guessed pace. */
export type SpokenWord = { word: string; startSec: number; endSec: number }

export type VoiceoverAudio = {
  format: "mp3"
  bytes: Uint8Array
  /** The ElevenLabs voice id that synthesized the audio. */
  voiceId: string
  /** The ElevenLabs model id used (e.g. `eleven_multilingual_v2`). */
  model: string
  /** Number of characters of narration sent (billing-relevant). */
  characterCount: number
  /** Present only when the caller passed `withTimestamps`. */
  words?: SpokenWord[]
  /**
   * Set by stand-ins for the real ElevenLabs call (see
   * `createSilentVoiceover`). The persistent audio cache REFUSES segments
   * carrying this, because a silent preview once wrote its silence there and
   * the next real run reused it as finished narration: the reuse key is
   * (role, text, voice), all three identical, so the only symptom was a
   * devotional at -91 dB with "reused 16 cached segment(s)" in the log.
   */
  synthetic?: boolean
}

export type VoiceoverResult =
  | { ok: true; audio: VoiceoverAudio }
  | {
      ok: false
      reason:
        | "config_missing"
        | "invalid_input"
        | "auth_failed"
        | "quota_exceeded"
        | "upstream_failed"
        | "transport"
      retryable: boolean
      status?: number
      details?: string
    }

/**
 * Marks a credit/quota exhaustion response, whatever status code carried it.
 * ElevenLabs reports it as `detail.status` (`quota_exceeded`) with a message
 * like "You have 4 credits remaining, while 22 credits are required for this
 * request". Matched against the raw body so a plain-text or reshaped error
 * still trips it.
 */
const QUOTA_MARKER = /quota_exceeded|credits remaining|quota exceeded/i

/** Longest error body worth reading; these are short JSON envelopes. */
const MAX_ERROR_BODY_CHARS = 2_000

/**
 * Read an error response's body for classification. Best-effort by design:
 * a body that is unreadable, already consumed, or not JSON must never turn a
 * clean "upstream failed" into a thrown exception, so every failure path here
 * degrades to `null` and lets the caller fall back to status-based classing.
 */
async function readErrorDetail(response: Response): Promise<string | null> {
  try {
    const raw = (await response.text()).slice(0, MAX_ERROR_BODY_CHARS)
    return raw.trim() || null
  } catch {
    return null
  }
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
  /** Model for this call only (e.g. "eleven_v4" for the opening); defaults
   *  to the configured TTS model. */
  model?: string
  /** Injectable for tests; defaults to the resolved ElevenLabs env config. */
  config?: ElevenLabsConfig
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** Ask ElevenLabs for character-level alignment alongside the audio (the
   *  `/with-timestamps` endpoint) and return per-word times in
   *  `audio.words`. Off by default: the response is JSON with base64 audio
   *  rather than raw bytes, so only callers that need caption timing pay the
   *  extra parse. */
  withTimestamps?: boolean
}

/** Group ElevenLabs' character-level alignment into per-word times. */
export function wordsFromAlignment(alignment: {
  characters: string[]
  character_start_times_seconds: number[]
  character_end_times_seconds: number[]
}): SpokenWord[] {
  const words: SpokenWord[] = []
  let word = ""
  let startSec = 0
  let prevEnd = 0
  const { characters, character_start_times_seconds: starts } = alignment
  const ends = alignment.character_end_times_seconds
  // Eleven v4 audio tags ("[thoughtful]") direct the delivery and are never
  // spoken or shown: their characters are dropped, so a tagged read yields
  // the same words as the plain text.
  let inTag = false
  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i]
    if (ch === "[") inTag = true
    if (inTag) {
      if (ch === "]") inTag = false
      continue
    }
    if (ch.trim() === "") {
      if (word) words.push({ word, startSec, endSec: prevEnd })
      word = ""
      continue
    }
    if (word === "") startSec = starts[i]
    word += ch
    prevEnd = ends[i]
  }
  if (word) words.push({ word, startSec, endSec: prevEnd })
  return words
}

/** Resolve a named alias (e.g. "male-d") to a voice id; pass ids through unchanged. */
export function resolveVoiceId(voice: string): string {
  return (DEVOTIONAL_VOICES as Record<string, string>)[voice] ?? voice
}

/** The registry name for a voice id, or undefined for a voice we do not know
 *  (an experiment's raw id). The inverse of `resolveVoiceId`. */
export function voiceNameForId(
  voiceId: string,
): DevotionalVoiceName | undefined {
  for (const [name, id] of Object.entries(DEVOTIONAL_VOICES)) {
    if (id === voiceId) return name as DevotionalVoiceName
  }
  return undefined
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

  // The timestamps variant returns JSON (base64 audio + alignment) instead of
  // raw audio bytes, so the response is read differently below.
  const wantWords = input.withTimestamps === true
  const endpoint = wantWords
    ? `${API_BASE}/v1/text-to-speech/${voiceId}/with-timestamps?output_format=${OUTPUT_FORMAT}`
    : `${API_BASE}/v1/text-to-speech/${voiceId}?output_format=${OUTPUT_FORMAT}`

  let response: Response
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "xi-api-key": config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: input.model ?? config.ttsModel,
        voice_settings: input.voiceSettings ?? DEFAULT_VOICE_SETTINGS,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
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
    // Classify by the PARSED REASON first, status second. ElevenLabs overloads
    // its status codes across causes with opposite retry policies: credit
    // exhaustion arrives as 401 on some plans and 429 on others, and a plain
    // rate limit is also 429. Branching on status alone therefore retries a
    // permanently-exhausted account — three attempts per segment across ~21
    // segments, burning whatever credits are left on requests that cannot
    // succeed until the account is topped up. (Same lesson as the S3
    // NoSuchKey classification: match the typed reason, not the status.)
    const detail = await readErrorDetail(response)
    if (detail && QUOTA_MARKER.test(detail)) {
      return {
        ok: false,
        reason: "quota_exceeded",
        retryable: false,
        status,
        details: detail,
      }
    }
    if (status === 401 || status === 403) {
      return {
        ok: false,
        reason: "auth_failed",
        retryable: false,
        status,
        ...(detail ? { details: detail } : {}),
      }
    }
    const retryable = status === 429 || status >= 500
    return {
      ok: false,
      reason: "upstream_failed",
      retryable,
      status,
      ...(detail ? { details: detail } : {}),
    }
  }

  let bytes: Uint8Array
  let words: SpokenWord[] | undefined
  try {
    if (wantWords) {
      const json = (await response.json()) as {
        audio_base64?: string
        alignment?: {
          characters: string[]
          character_start_times_seconds: number[]
          character_end_times_seconds: number[]
        }
      }
      bytes = json.audio_base64
        ? new Uint8Array(Buffer.from(json.audio_base64, "base64"))
        : new Uint8Array()
      // Alignment is a bonus, not a contract: a response that carries audio
      // but no alignment still yields usable narration, just without caption
      // timing, so the caller falls back to its pace-based reveal.
      words = json.alignment ? wordsFromAlignment(json.alignment) : undefined
    } else {
      bytes = new Uint8Array(await response.arrayBuffer())
    }
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
      model: input.model ?? config.ttsModel,
      characterCount: text.length,
      ...(words && words.length > 0 ? { words } : {}),
    },
  }
}
