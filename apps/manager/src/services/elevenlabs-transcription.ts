import { env } from "@/config/env"
import { isTrustedElevenLabsSourceUrl } from "@/lib/video-sources"
import type { TranscriptionDiarizationSummary } from "@/types/job"
import type { TranscriptSegment } from "@/lib/vtt"

const ELEVENLABS_API_BASE_URL = "https://api.elevenlabs.io/v1"
const ELEVENLABS_MODEL_ID = "scribe_v2"
const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60_000
const DEFAULT_SOURCE_DOWNLOAD_TIMEOUT_MS = 2 * 60_000
const SEGMENT_GAP_BREAK_SECONDS = 1.5
const SEGMENT_MAX_TEXT_LENGTH = 120

type ElevenLabsWord = {
  text?: string
  start?: number
  end?: number
  type?: "word" | "spacing" | "audio_event"
  speaker_id?: string | null
}

type ElevenLabsResponse = {
  language_code?: string | null
  text?: string | null
  words?: ElevenLabsWord[] | null
}

export type ElevenLabsTranscriptionResult = {
  text: string
  segments: TranscriptSegment[]
  language: string
  diarization?: TranscriptionDiarizationSummary
}

const ISO3_TO_ELEVENLABS_ROOT: Record<string, string> = {
  afr: "af",
  amh: "am",
  ara: "ar",
  asm: "as",
  aze: "az",
  bel: "be",
  ben: "bn",
  bos: "bs",
  bul: "bg",
  ces: "cs",
  cym: "cy",
  dan: "da",
  deu: "de",
  ell: "el",
  eng: "en",
  est: "et",
  fas: "fa",
  fin: "fi",
  fra: "fr",
  ful: "ff",
  glg: "gl",
  guj: "gu",
  hau: "ha",
  heb: "he",
  hin: "hi",
  hrv: "hr",
  hun: "hu",
  hye: "hy",
  ibo: "ig",
  ind: "id",
  isl: "is",
  ita: "it",
  jpn: "ja",
  kan: "kn",
  kat: "ka",
  kaz: "kk",
  khm: "km",
  kir: "ky",
  kor: "ko",
  kur: "ku",
  lao: "lo",
  lav: "lv",
  lit: "lt",
  lin: "ln",
  lug: "lg",
  mal: "ml",
  mar: "mr",
  mkd: "mk",
  mlt: "mt",
  mon: "mn",
  mri: "mi",
  msa: "ms",
  mya: "my",
  nep: "ne",
  nld: "nl",
  nor: "no",
  nso: "nso",
  oci: "oc",
  ori: "or",
  pan: "pa",
  pol: "pl",
  por: "pt",
  pus: "ps",
  ron: "ro",
  rus: "ru",
  slk: "sk",
  slv: "sl",
  sna: "sn",
  snd: "sd",
  som: "so",
  srp: "sr",
  swa: "sw",
  swe: "sv",
  tam: "ta",
  tel: "te",
  tgk: "tg",
  tha: "th",
  tur: "tr",
  ukr: "uk",
  umb: "umb",
  urd: "ur",
  uzb: "uz",
  vie: "vi",
  wol: "wo",
  xho: "xh",
  yor: "yo",
  yue: "yue",
  zho: "zh",
  zul: "zu",
}

const SUPPORTED_ELEVENLABS_LANGUAGE_CODES = new Set<string>([
  "af",
  "am",
  "ar",
  "as",
  "ast",
  "az",
  "be",
  "bg",
  "bn",
  "bs",
  "ca",
  "ceb",
  "cs",
  "cy",
  "da",
  "de",
  "el",
  "en",
  "et",
  "fa",
  "ff",
  "fil",
  "fi",
  "fr",
  "ga",
  "gl",
  "gu",
  "ha",
  "he",
  "hi",
  "hr",
  "hu",
  "hy",
  "id",
  "ig",
  "is",
  "it",
  "ja",
  "jav",
  "ka",
  "kea",
  "kk",
  "km",
  "kn",
  "ko",
  "ku",
  "ky",
  "lg",
  "ln",
  "lo",
  "lt",
  "ltz",
  "luo",
  "lv",
  "mi",
  "mk",
  "ml",
  "mn",
  "mr",
  "ms",
  "mt",
  "my",
  "ne",
  "nl",
  "no",
  "nso",
  "ny",
  "oc",
  "or",
  "pa",
  "pl",
  "ps",
  "pt",
  "ro",
  "ru",
  "sd",
  "sk",
  "sl",
  "sn",
  "so",
  "sr",
  "sw",
  "sv",
  "ta",
  "te",
  "tg",
  "th",
  "tr",
  "uk",
  "umb",
  "ur",
  "uz",
  "vi",
  "wo",
  "xh",
  "yo",
  "yue",
  "zh",
  "zu",
])

function getRequestTimeoutMs(): number {
  return env.ELEVENLABS_REQUEST_TIMEOUT_MS ?? DEFAULT_REQUEST_TIMEOUT_MS
}

function getSourceDownloadTimeoutMs(): number {
  return (
    env.ELEVENLABS_SOURCE_DOWNLOAD_TIMEOUT_MS ??
    DEFAULT_SOURCE_DOWNLOAD_TIMEOUT_MS
  )
}

function ensureApiKey(): string {
  if (!env.ELEVENLABS_API_KEY) {
    throw new Error(
      "ElevenLabs transcription requires ELEVENLABS_API_KEY to be configured.",
    )
  }

  return env.ELEVENLABS_API_KEY
}

function normalizeLanguageCode(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null
  }

  const normalized = value.trim().toLowerCase().split(/[-_]/)[0] ?? null
  if (!normalized || normalized === "auto") {
    return null
  }

  return ISO3_TO_ELEVENLABS_ROOT[normalized] ?? normalized
}

export function isSupportedElevenLabsLanguage(
  value: string | null | undefined,
): boolean {
  const normalized = normalizeLanguageCode(value)
  return (
    normalized != null && SUPPORTED_ELEVENLABS_LANGUAGE_CODES.has(normalized)
  )
}

function guessFileName(url: string, fallback: string): string {
  try {
    const pathname = new URL(url).pathname
    const leaf = pathname.split("/").pop()
    if (leaf && leaf.includes(".")) {
      return leaf
    }
  } catch {
    return fallback
  }

  return fallback
}

function extensionFromContentType(contentType: string | null): string {
  if (!contentType) return "bin"
  if (contentType.includes("mpeg") || contentType.includes("mp3")) return "mp3"
  if (contentType.includes("wav")) return "wav"
  if (contentType.includes("ogg")) return "ogg"
  if (contentType.includes("mp4")) return "mp4"
  if (contentType.includes("webm")) return "webm"
  return "bin"
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text()
    return text.slice(0, 500)
  } catch {
    return ""
  }
}

function normalizeWordText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function buildSegments(
  words: ElevenLabsWord[],
  fallbackText: string,
): TranscriptSegment[] {
  const spokenWords = words.filter(
    (
      word,
    ): word is Required<Pick<ElevenLabsWord, "text" | "start" | "end">> &
      ElevenLabsWord =>
      typeof word.text === "string" &&
      typeof word.start === "number" &&
      typeof word.end === "number" &&
      (word.type === "word" || word.type === "spacing"),
  )

  if (spokenWords.length === 0) {
    const trimmedText = normalizeWordText(fallbackText)
    return trimmedText ? [{ start: 0, end: 0, text: trimmedText }] : []
  }

  const segments: TranscriptSegment[] = []
  let start = spokenWords[0].start
  let end = spokenWords[0].end
  let currentSpeaker = spokenWords[0].speaker_id ?? "speaker_0"
  let buffer = ""

  for (const word of spokenWords) {
    if (!buffer) {
      start = word.start
    }

    const speaker = word.speaker_id ?? "speaker_0"
    const gap = word.start - end
    const nextBuffer = buffer + word.text
    const normalizedBuffer = normalizeWordText(nextBuffer)
    const shouldFlushBeforeWord =
      buffer.trim().length > 0 &&
      (speaker !== currentSpeaker || gap >= SEGMENT_GAP_BREAK_SECONDS)

    if (shouldFlushBeforeWord) {
      segments.push({
        start,
        end,
        text: normalizeWordText(buffer),
      })
      buffer = ""
      start = word.start
    }

    buffer += word.text
    end = word.end
    currentSpeaker = speaker

    const shouldFlushAfterWord =
      word.type === "word" &&
      (/[.!?。！？]$/.test(word.text.trim()) ||
        normalizedBuffer.length >= SEGMENT_MAX_TEXT_LENGTH)

    if (shouldFlushAfterWord && normalizeWordText(buffer)) {
      segments.push({
        start,
        end,
        text: normalizeWordText(buffer),
      })
      buffer = ""
    }
  }

  if (normalizeWordText(buffer)) {
    segments.push({
      start,
      end,
      text: normalizeWordText(buffer),
    })
  }

  return segments
}

function buildDiarization(
  words: ElevenLabsWord[],
): TranscriptionDiarizationSummary | undefined {
  const spokenWords = words.filter(
    (
      word,
    ): word is Required<Pick<ElevenLabsWord, "text" | "start" | "end">> &
      ElevenLabsWord =>
      typeof word.text === "string" &&
      typeof word.start === "number" &&
      typeof word.end === "number" &&
      word.type !== "audio_event",
  )

  const speakerIds = Array.from(
    new Set(
      spokenWords
        .map((word) => word.speaker_id ?? "speaker_0")
        .filter((speakerId) => speakerId.trim().length > 0),
    ),
  )

  if (speakerIds.length === 0) {
    return undefined
  }

  const segments: TranscriptionDiarizationSummary["segments"] = []
  let activeSpeaker = spokenWords[0]?.speaker_id ?? "speaker_0"
  let start = spokenWords[0]?.start ?? 0
  let end = spokenWords[0]?.end ?? 0
  let buffer = ""

  for (const word of spokenWords) {
    if (!buffer) {
      start = word.start
    }

    const speaker = word.speaker_id ?? "speaker_0"
    if (speaker !== activeSpeaker && buffer.trim().length > 0) {
      segments.push({
        speakerId: activeSpeaker,
        start,
        end,
        text: normalizeWordText(buffer),
      })
      activeSpeaker = speaker
      start = word.start
      buffer = ""
    }

    buffer += word.text
    end = word.end
  }

  if (buffer.trim().length > 0) {
    segments.push({
      speakerId: activeSpeaker,
      start,
      end,
      text: normalizeWordText(buffer),
    })
  }

  return {
    speakerCount: speakerIds.length,
    ...(segments && segments.length > 0 ? { segments } : {}),
  }
}

async function downloadSourceMedia(sourceUrl: string): Promise<Blob> {
  if (!isTrustedElevenLabsSourceUrl(sourceUrl)) {
    throw new Error(
      "ElevenLabs source media must come from a trusted downloadable MP4 URL.",
    )
  }

  const response = await fetch(sourceUrl, {
    signal: AbortSignal.timeout(getSourceDownloadTimeoutMs()),
  })

  if (!response.ok) {
    throw new Error(
      `Failed to download source media: ${response.status} ${response.statusText}`,
    )
  }

  return response.blob()
}

async function isolateAudio(
  input: Blob,
  sourceUrl: string,
  apiKey: string,
): Promise<Blob> {
  const body = new FormData()
  body.append("audio", input, guessFileName(sourceUrl, "source-media.bin"))

  const response = await fetch(`${ELEVENLABS_API_BASE_URL}/audio-isolation`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
    },
    body,
    signal: AbortSignal.timeout(getRequestTimeoutMs()),
  })

  if (!response.ok) {
    const details = await readErrorBody(response)
    throw new Error(
      `ElevenLabs audio isolation failed: ${response.status}${details ? ` ${details}` : ""}`,
    )
  }

  return response.blob()
}

async function createTranscript(params: {
  isolatedAudio: Blob
  languageCode?: string
  keyterms?: string[]
  apiKey: string
}): Promise<ElevenLabsResponse> {
  const body = new FormData()
  body.append(
    "file",
    params.isolatedAudio,
    `isolated-audio.${extensionFromContentType(params.isolatedAudio.type)}`,
  )
  body.append("model_id", ELEVENLABS_MODEL_ID)
  body.append("diarize", "true")
  body.append("timestamps_granularity", "word")

  const normalizedLanguageCode = normalizeLanguageCode(params.languageCode)
  if (normalizedLanguageCode) {
    body.append("language_code", normalizedLanguageCode)
  }

  for (const keyterm of params.keyterms ?? []) {
    if (keyterm.trim().length > 0) {
      body.append("keyterms", keyterm)
    }
  }

  const response = await fetch(`${ELEVENLABS_API_BASE_URL}/speech-to-text`, {
    method: "POST",
    headers: {
      "xi-api-key": params.apiKey,
    },
    body,
    signal: AbortSignal.timeout(getRequestTimeoutMs()),
  })

  if (!response.ok) {
    const details = await readErrorBody(response)
    throw new Error(
      `ElevenLabs speech-to-text failed: ${response.status}${details ? ` ${details}` : ""}`,
    )
  }

  return (await response.json()) as ElevenLabsResponse
}

export async function transcribeViaElevenLabs(input: {
  sourceUrl?: string
  isolatedAudio?: Blob
  languageCode?: string
  keyterms?: string[]
}): Promise<ElevenLabsTranscriptionResult> {
  const apiKey = ensureApiKey()
  const isolatedAudio =
    input.isolatedAudio ??
    (input.sourceUrl
      ? await isolateAudio(
          await downloadSourceMedia(input.sourceUrl),
          input.sourceUrl,
          apiKey,
        )
      : undefined)
  if (!isolatedAudio) {
    throw new Error(
      "ElevenLabs transcription requires a source URL or isolated audio input.",
    )
  }
  const response = await createTranscript({
    isolatedAudio,
    languageCode: input.languageCode,
    keyterms: input.keyterms,
    apiKey,
  })

  const text = normalizeWordText(response.text ?? "")
  const words = response.words ?? []
  const segments = buildSegments(words, text)
  const diarization = buildDiarization(words)

  return {
    text,
    segments,
    language:
      normalizeLanguageCode(response.language_code) ??
      input.languageCode ??
      "auto",
    ...(diarization ? { diarization } : {}),
  }
}
