import {
  getAzureSpeechConfig,
  getDevotionalVoice,
  getDevotionalVoiceStyle,
  type AzureSpeechConfig,
} from "../../config/env"
import {
  discardResponseBody,
  readResponseBytesCapped,
} from "./bounded-response"
import type { Devotional } from "./types"

/**
 * Azure Neural TTS voiceover for the daily devotional.
 *
 * Turns a devotional's spoken script into narrated MP3 audio via Azure
 * Cognitive Services Speech (the REST `cognitiveservices/v1` endpoint). The
 * multilingual neural voices (default `en-US-AndrewMultilingualNeural`) let one
 * voice carry future translated devotionals without per-language voice config.
 *
 * Opt-in and best-effort, mirroring `site-publish-client.ts`: with no
 * key/region configured it returns `config_missing` so the workflow treats
 * voiceover as skipped rather than a failed run. Typed discriminated result,
 * bounded timeout, no throwing on the success path.
 *
 * This service only GENERATES audio bytes. Persisting them as an artifact and
 * threading the audio URL into the published devotional is the caller's job —
 * kept separate so the generation stays pure and easy to test.
 */

/** Azure's per-request synthesis ceiling is generous; cap narration well under
 * it to bound billing (Azure bills per character) and request size. */
export const MAX_VOICEOVER_TEXT_LENGTH = 4000

const DEFAULT_TIMEOUT_MS = 30_000
const AZURE_REGION_PATTERN = /^[a-z0-9]+$/

/** 24kHz mono MP3 — small, widely playable, good enough for card narration. */
const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3"
const DEFAULT_USER_AGENT = "forge-mastra-devotional-voiceover/1.0"
/**
 * Bytes. The 4,000-character narration ceiling is roughly 7 minutes of speech;
 * at the requested 48 kbps that is about 2.4 MiB, plus ample delivery variance.
 */
export const AZURE_VOICEOVER_MAX_RESPONSE_BYTES = 4 * 1024 * 1024

export type VoiceoverAudio = {
  format: "mp3"
  bytes: Uint8Array
  /** The Azure voice that synthesized the audio, e.g. `en-US-AndrewMultilingualNeural`. */
  voice: string
  /** Locale used in the SSML, derived from the voice name (e.g. `en-US`). */
  locale: string
  /** Number of characters of narration sent to Azure (billing-relevant). */
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
  /** Override the configured voice (defaults to `DEVOTIONAL_VOICE`). */
  voice?: string
  /** Override the configured express-as style (defaults to `DEVOTIONAL_VOICE_STYLE`). */
  style?: string
  /** SSML prosody pitch, e.g. "-6%" to deepen the voice. */
  pitch?: string
  /** SSML prosody rate, e.g. "-5%" to slow delivery. */
  rate?: string
  /** Injectable for tests; defaults to the resolved Azure env config. */
  config?: AzureSpeechConfig
  fetchImpl?: typeof fetch
  timeoutMs?: number
  userAgent?: string
}

/**
 * Assemble the spoken script from a devotional. Pure and order-independent of
 * `blockOrder` (narration reads in a fixed, natural order regardless of the
 * per-day visual arrangement): hook → scripture → reflection. Questions are
 * left to the on-card UI, not narrated, to keep the voiceover devotional rather
 * than quiz-like. Returns the trimmed, length-capped script.
 */
export function buildNarrationText(devotional: Devotional): string {
  const parts: string[] = []
  if (devotional.hook.title.trim()) parts.push(devotional.hook.title.trim())
  if (devotional.hook.summary.trim()) parts.push(devotional.hook.summary.trim())
  const ref = devotional.scripture.reference.trim()
  const verse = devotional.scripture.text.trim()
  if (ref && verse) parts.push(`${ref}. ${verse}`)
  else if (verse) parts.push(verse)
  if (devotional.reflection.trim()) parts.push(devotional.reflection.trim())
  return parts.join("\n\n").slice(0, MAX_VOICEOVER_TEXT_LENGTH)
}

/** Derive the SSML locale from a neural voice name (`en-US-Andrew...` → `en-US`). */
export function localeFromVoice(voice: string): string {
  const match = /^([a-z]{2,3}-[A-Za-z0-9]+)/.exec(voice)
  return match ? match[1] : "en-US"
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

/**
 * Build the SSML document Azure synthesizes. When a `style` is given it wraps
 * the text in `<mstts:express-as>` (requires the mstts namespace on `<speak>`).
 * The text is XML-escaped; the `mstts` namespace is always declared so the same
 * document is valid with or without an express-as style.
 */
export function buildSsml(input: {
  text: string
  voice: string
  style?: string
  locale?: string
  /** e.g. "-6%" to deepen the voice. */
  pitch?: string
  /** e.g. "-5%" to slow delivery. */
  rate?: string
}): string {
  const locale = input.locale ?? localeFromVoice(input.voice)
  // `[[break:NNN]]` tokens become SSML pauses. Brackets survive XML-escaping,
  // so authors can insert contemplative pauses in plain narration text.
  const escaped = escapeXml(input.text).replace(
    /\[\[break:(\d{1,5})\]\]/g,
    (_m, ms) => `<break time="${ms}ms"/>`,
  )
  const styled = input.style
    ? `<mstts:express-as style="${escapeXml(input.style)}">${escaped}</mstts:express-as>`
    : escaped
  const inner =
    input.pitch || input.rate
      ? `<prosody${input.pitch ? ` pitch="${escapeXml(input.pitch)}"` : ""}${input.rate ? ` rate="${escapeXml(input.rate)}"` : ""}>${styled}</prosody>`
      : styled
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
    `xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${escapeXml(locale)}">` +
    `<voice name="${escapeXml(input.voice)}">${inner}</voice>` +
    `</speak>`
  )
}

/** Azure regional TTS host. Region is an Azure region id, e.g. `eastus`. */
function ttsEndpoint(region: string): string {
  return `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`
}

export async function generateVoiceover(
  input: GenerateVoiceoverInput = {},
): Promise<VoiceoverResult> {
  const config = input.config ?? getAzureSpeechConfig()
  if (!config.key || !config.region) {
    return {
      ok: false,
      reason: "config_missing",
      retryable: false,
      details: "AZURE_SPEECH_KEY and AZURE_SPEECH_REGION are required",
    }
  }
  if (!AZURE_REGION_PATTERN.test(config.region)) {
    return {
      ok: false,
      reason: "config_missing",
      retryable: false,
      details: "AZURE_SPEECH_REGION must be an Azure region id",
    }
  }

  const text = (
    input.text ?? (input.devotional ? buildNarrationText(input.devotional) : "")
  ).trim()
  if (!text) {
    return {
      ok: false,
      reason: "invalid_input",
      retryable: false,
      details: "no narration text (provide `text` or `devotional`)",
    }
  }

  const voice = input.voice ?? getDevotionalVoice()
  const style = input.style ?? getDevotionalVoiceStyle()
  const locale = localeFromVoice(voice)
  const ssml = buildSsml({
    text,
    voice,
    style,
    locale,
    pitch: input.pitch,
    rate: input.rate,
  })

  const fetchImpl = input.fetchImpl ?? fetch
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS

  let response: Response
  try {
    response = await fetchImpl(ttsEndpoint(config.region), {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": config.key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": OUTPUT_FORMAT,
        "User-Agent": input.userAgent ?? DEFAULT_USER_AGENT,
      },
      body: ssml,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    // Timeout/network — retryable transport failure, never a crash.
    return {
      ok: false,
      reason: "transport",
      retryable: true,
      details: error instanceof Error ? error.message : String(error),
    }
  }

  if (!response.ok) {
    // 401/403 → bad/expired key (not retryable). 429/5xx → retryable. Other
    // 4xx (e.g. malformed SSML, unknown voice) → not retryable.
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
    AZURE_VOICEOVER_MAX_RESPONSE_BYTES,
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
      voice,
      locale,
      characterCount: text.length,
    },
  }
}
