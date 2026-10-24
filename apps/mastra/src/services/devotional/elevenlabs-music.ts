import { getElevenLabsConfig } from "../../config/env"
import type { MusicMoodId } from "./authored-data"
import type { ElevenLabsConfig } from "../../config/env"
import {
  discardResponseBody,
  readResponseBytesCapped,
} from "./bounded-response"

/**
 * ElevenLabs Music bed for the daily devotional.
 *
 * Generates a soft instrumental track via ElevenLabs' `/v1/music` endpoint,
 * replacing the earlier placeholder downloaded tracks. Approved direction:
 * ambient, calm, simple — no melody line, no drums, no vocals. The render loops
 * the bed to cover the whole devotional, so a short track is fine (and cheaper).
 *
 * Same best-effort contract as `elevenlabs-voiceover.ts`: no `ELEVENLABS_API_KEY`
 * => `config_missing` (skipped, not failed); typed discriminated result; bounded
 * timeout; never throws on the success path. Generation only — persisting the
 * bytes is the caller's job.
 */

const API_BASE = "https://api.elevenlabs.io"
const DEFAULT_TIMEOUT_MS = 60_000
const OUTPUT_FORMAT = "mp3_44100_128"
/**
 * Bytes. The provider contract allows 600 seconds at 128 kbps (9,600,000
 * encoded bytes); 12 MiB leaves about 31% for MP3 metadata/encoder variance.
 */
export const ELEVENLABS_MUSIC_MAX_RESPONSE_BYTES = 12 * 1024 * 1024

/** ElevenLabs music length bounds (ms). */
export const MIN_MUSIC_MS = 3_000
export const MAX_MUSIC_MS = 600_000
/** Default bed length; the render loops it to cover the full devotional.
 *  Owner rule (2026-07-14): at least ONE MINUTE — a 30s pattern looped 5–6×
 *  over a ~3min devotional repeats too noticeably. */

/**
 * Named mood beds. All follow the approved ambient/calm/simple direction — the
 * mood only shifts the emotional color, never the complexity. A devotional's
 * tone picks one; the caller can also pass a free-form `prompt`.
 */
// Family: warm ambient electric-guitar swells with reverb over a soft pad
// (the owner-approved style). Mood only shifts the emotional color, always
// background-friendly — no drums, no vocals.
export type MusicMood = MusicMoodId

export type MusicAudio = {
  format: "mp3"
  bytes: Uint8Array
  /** The prompt the track was generated from. */
  prompt: string
  /** Requested length in milliseconds (clamped to ElevenLabs bounds). */
  lengthMs: number
  model: string
}

export type MusicResult =
  | { ok: true; audio: MusicAudio }
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

export type GenerateMusicInput = {
  /** Free-form prompt. When omitted, `mood` (default "peace") supplies it. */
  prompt?: string
  /** Named mood preset; ignored when an explicit `prompt` is given. */
  mood?: MusicMood
  moodPrompts?: Readonly<Record<MusicMood, string>>
  defaultLengthMs?: number
  /** Requested length in ms; clamped to [MIN_MUSIC_MS, MAX_MUSIC_MS]. */
  lengthMs?: number
  /** Injectable for tests; defaults to the resolved ElevenLabs env config. */
  config?: ElevenLabsConfig
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

function clampLength(ms: number, defaultLengthMs: number): number {
  if (!Number.isFinite(ms)) return defaultLengthMs
  return Math.min(MAX_MUSIC_MS, Math.max(MIN_MUSIC_MS, Math.round(ms)))
}

export async function generateMusic(
  input: GenerateMusicInput = {},
): Promise<MusicResult> {
  const config = input.config ?? getElevenLabsConfig()
  if (!config.apiKey) {
    return {
      ok: false,
      reason: "config_missing",
      retryable: false,
      details: "ELEVENLABS_API_KEY is required",
    }
  }

  const prompt = (
    input.prompt ??
    input.moodPrompts?.[input.mood ?? "peace"] ??
    ""
  ).trim()
  if (!prompt) {
    return {
      ok: false,
      reason: "invalid_input",
      retryable: false,
      details:
        "/inputs/music/profiles.json: no music prompt (provide prompt or configured mood)",
    }
  }

  if (input.defaultLengthMs == null) {
    return {
      ok: false,
      reason: "invalid_input",
      retryable: false,
      details:
        "/inputs/music/profiles.json: defaultLengthMs configuration is required",
    }
  }

  const lengthMs = clampLength(
    input.lengthMs ?? input.defaultLengthMs,
    input.defaultLengthMs,
  )
  const fetchImpl = input.fetchImpl ?? fetch
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS

  let response: Response
  try {
    response = await fetchImpl(
      `${API_BASE}/v1/music?output_format=${OUTPUT_FORMAT}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": config.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          music_length_ms: lengthMs,
          force_instrumental: true,
          model_id: config.musicModel,
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
    await discardResponseBody(response)
    if (status === 401 || status === 403) {
      return { ok: false, reason: "auth_failed", retryable: false, status }
    }
    const retryable = status === 429 || status >= 500
    return { ok: false, reason: "upstream_failed", retryable, status }
  }

  const bytes = await readResponseBytesCapped(
    response,
    ELEVENLABS_MUSIC_MAX_RESPONSE_BYTES,
  )
  if (bytes === undefined) {
    return {
      ok: false,
      reason: "transport",
      retryable: true,
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
      prompt,
      lengthMs,
      model: config.musicModel,
    },
  }
}
