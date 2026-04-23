import type { WriteArtifactOptions } from "@/services/storage"

const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1"
const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"
const DEFAULT_MODEL_ID = "eleven_multilingual_v2"
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128"
const DEFAULT_MAX_CHUNK_CHARS = 4_000
const CONTINUITY_HINT_CHARS = 240

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

type WriteArtifactLike = (options: WriteArtifactOptions) => Promise<string>

export type GenerateVoiceoverOptions = {
  assetId: string
  text: string
  language: string
}

export type VoiceoverMetadata = {
  provider: "elevenlabs"
  modelId: string
  voiceId: string
  outputFormat: string
  chunkCount: number
  totalCharacters: number
}

export type VoiceoverResult = {
  artifactKey: string
  language: string
  metadata: VoiceoverMetadata
}

export class VoiceoverConfigError extends Error {
  readonly code = "voiceover_config_error"

  constructor(message: string) {
    super(message)
    this.name = "VoiceoverConfigError"
  }
}

export class VoiceoverRuntimeError extends Error {
  readonly code = "voiceover_runtime_error"

  constructor(message: string) {
    super(message)
    this.name = "VoiceoverRuntimeError"
  }
}

export class VoiceoverProviderError extends Error {
  readonly code = "voiceover_provider_error"
  readonly provider = "elevenlabs"
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = "VoiceoverProviderError"
    this.status = status
  }
}

type VoiceoverDependencies = {
  apiKey?: string
  voiceId?: string
  fetchImpl?: FetchLike
  writeArtifactImpl?: WriteArtifactLike
  maxChunkChars?: number
}

type ElevenLabsRequestBody = {
  text: string
  model_id: string
  language_code: string
  previous_text?: string
  next_text?: string
}

export async function generateVoiceover(
  options: GenerateVoiceoverOptions,
  deps: VoiceoverDependencies = {},
): Promise<VoiceoverResult> {
  const apiKey = deps.apiKey ?? process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    throw new VoiceoverConfigError(
      "ELEVENLABS_API_KEY is required to generate voiceover audio.",
    )
  }

  const normalizedText = normalizeVoiceoverText(options.text)
  if (!normalizedText) {
    throw new VoiceoverRuntimeError(
      "Voiceover generation requires non-empty text.",
    )
  }

  const fetchImpl = deps.fetchImpl ?? fetch
  const voiceId =
    deps.voiceId ?? process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID
  const languageCode = normalizeLanguageCode(options.language)
  const maxChunkChars = deps.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS
  const chunks = chunkVoiceoverText(
    normalizedText,
    options.language,
    maxChunkChars,
  )

  const audioChunks: Uint8Array[] = []

  for (let index = 0; index < chunks.length; index++) {
    const body: ElevenLabsRequestBody = {
      text: chunks[index] ?? "",
      model_id: DEFAULT_MODEL_ID,
      language_code: languageCode,
    }

    const previousText = buildPreviousHint(chunks, index)
    if (previousText) {
      body.previous_text = previousText
    }

    const nextText = buildNextHint(chunks, index)
    if (nextText) {
      body.next_text = nextText
    }

    const audio = await synthesizeChunk({
      apiKey,
      voiceId,
      body,
      fetchImpl,
    })

    audioChunks.push(index === 0 ? audio : stripLeadingId3Tag(audio))
  }

  const combinedAudio = concatenateAudioChunks(audioChunks)
  const writeArtifactImpl = deps.writeArtifactImpl ?? (await getWriteArtifact())
  const artifactKey = await writeArtifactImpl({
    assetId: options.assetId,
    artifactType: `voiceover-${options.language}`,
    ext: "mp3",
    body: combinedAudio,
    contentType: "audio/mpeg",
  })

  return {
    artifactKey,
    language: options.language,
    metadata: {
      provider: "elevenlabs",
      modelId: DEFAULT_MODEL_ID,
      voiceId,
      outputFormat: DEFAULT_OUTPUT_FORMAT,
      chunkCount: chunks.length,
      totalCharacters: normalizedText.length,
    },
  }
}

async function synthesizeChunk(args: {
  apiKey: string
  voiceId: string
  body: ElevenLabsRequestBody
  fetchImpl: FetchLike
}): Promise<Uint8Array> {
  const url = new URL(
    `text-to-speech/${encodeURIComponent(args.voiceId)}`,
    `${ELEVENLABS_BASE_URL}/`,
  )
  url.searchParams.set("output_format", DEFAULT_OUTPUT_FORMAT)

  let response: Response
  try {
    response = await args.fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "xi-api-key": args.apiKey,
      },
      body: JSON.stringify(args.body),
    })
  } catch {
    throw new VoiceoverProviderError(
      "ElevenLabs voiceover request failed before audio was returned.",
    )
  }

  if (!response.ok) {
    throw await createProviderError(response)
  }

  const audio = new Uint8Array(await response.arrayBuffer())
  if (audio.length === 0) {
    throw new VoiceoverProviderError(
      "ElevenLabs returned an empty audio response.",
      response.status || undefined,
    )
  }

  return audio
}

async function createProviderError(
  response: Response,
): Promise<VoiceoverProviderError> {
  const detail = await parseProviderErrorDetail(response)
  const statusLabel = `${response.status} ${response.statusText}`.trim()
  const normalizedDetail = detail.replace(/\.+$/, "")
  const suffix = normalizedDetail ? `: ${normalizedDetail}` : ""

  return new VoiceoverProviderError(
    `ElevenLabs request failed (${statusLabel})${suffix}.`,
    response.status || undefined,
  )
}

async function parseProviderErrorDetail(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? ""

  try {
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as {
        detail?: string | { message?: string }
        message?: string
      }

      if (typeof payload.detail === "string") {
        return payload.detail.trim()
      }

      if (
        payload.detail &&
        typeof payload.detail === "object" &&
        typeof payload.detail.message === "string"
      ) {
        return payload.detail.message.trim()
      }

      if (typeof payload.message === "string") {
        return payload.message.trim()
      }
    }

    const text = (await response.text()).trim()
    if (text) {
      return text
    }
  } catch {
    return ""
  }

  return ""
}

function normalizeVoiceoverText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function normalizeLanguageCode(language: string): string {
  return language.trim().split("-")[0]?.toLowerCase() ?? "en"
}

function chunkVoiceoverText(
  text: string,
  language: string,
  maxChunkChars: number,
): string[] {
  const sentenceSegmenter = new Intl.Segmenter(
    normalizeLanguageCode(language),
    {
      granularity: "sentence",
    },
  )

  const sentences = Array.from(sentenceSegmenter.segment(text), (segment) =>
    segment.segment.trim(),
  ).filter(Boolean)

  if (sentences.length === 0) {
    throw new VoiceoverRuntimeError(
      "Voiceover sentence chunking produced no usable text.",
    )
  }

  const chunks: string[] = []
  let currentChunk = ""

  for (const sentence of sentences) {
    const parts = splitOversizedSentence(sentence, maxChunkChars)

    for (const part of parts) {
      if (!currentChunk) {
        currentChunk = part
        continue
      }

      const nextChunk = `${currentChunk} ${part}`
      if (nextChunk.length <= maxChunkChars) {
        currentChunk = nextChunk
        continue
      }

      chunks.push(currentChunk)
      currentChunk = part
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk)
  }

  if (chunks.length === 0) {
    throw new VoiceoverRuntimeError(
      "Voiceover chunking did not produce any request payloads.",
    )
  }

  return chunks
}

function splitOversizedSentence(
  sentence: string,
  maxChunkChars: number,
): string[] {
  if (sentence.length <= maxChunkChars) {
    return [sentence]
  }

  const words = sentence.split(/\s+/).filter(Boolean)
  const parts: string[] = []
  let currentPart = ""

  for (const word of words) {
    if (word.length > maxChunkChars) {
      if (currentPart) {
        parts.push(currentPart)
        currentPart = ""
      }

      for (let start = 0; start < word.length; start += maxChunkChars) {
        parts.push(word.slice(start, start + maxChunkChars))
      }

      continue
    }

    const nextPart = currentPart ? `${currentPart} ${word}` : word
    if (nextPart.length <= maxChunkChars) {
      currentPart = nextPart
      continue
    }

    parts.push(currentPart)
    currentPart = word
  }

  if (currentPart) {
    parts.push(currentPart)
  }

  return parts
}

function buildPreviousHint(
  chunks: string[],
  index: number,
): string | undefined {
  if (index === 0) {
    return undefined
  }

  const previousChunk = chunks[index - 1]?.trim()
  if (!previousChunk) {
    return undefined
  }

  return previousChunk.slice(-CONTINUITY_HINT_CHARS)
}

function buildNextHint(chunks: string[], index: number): string | undefined {
  if (index >= chunks.length - 1) {
    return undefined
  }

  const nextChunk = chunks[index + 1]?.trim()
  if (!nextChunk) {
    return undefined
  }

  return nextChunk.slice(0, CONTINUITY_HINT_CHARS)
}

function concatenateAudioChunks(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const combined = new Uint8Array(totalLength)
  let offset = 0

  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.length
  }

  return combined
}

function stripLeadingId3Tag(audio: Uint8Array): Uint8Array {
  if (audio.length < 10) {
    return audio
  }

  if (audio[0] !== 0x49 || audio[1] !== 0x44 || audio[2] !== 0x33) {
    return audio
  }

  const flags = audio[5] ?? 0
  const tagSize =
    ((audio[6] ?? 0) << 21) |
    ((audio[7] ?? 0) << 14) |
    ((audio[8] ?? 0) << 7) |
    (audio[9] ?? 0)
  const footerSize = flags & 0x10 ? 10 : 0
  const headerLength = 10 + tagSize + footerSize

  return audio.slice(Math.min(headerLength, audio.length))
}

async function getWriteArtifact(): Promise<WriteArtifactLike> {
  const { writeArtifact } = await import("@/services/storage")
  return writeArtifact
}
