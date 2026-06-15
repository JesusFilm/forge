import { chunkSegments } from "./chunker"
import { loadLanguageConfig } from "./language-config"
import { retimeChunk, type RetimeChunkResult } from "./retimer"
import {
  readSubtitleArtifact,
  writeSubtitleArtifact,
  type WriteSubtitleArtifactOptions,
} from "./storage"
import {
  SubtitleProviderError,
  type Chunk,
  type LanguageConfig,
  type SubtitleLanguageResult,
  type TranscriptSegment,
} from "./types"
import { translateChunk, type TranslateChunkResult } from "./translator"
import { segmentsToVtt } from "./vtt"

const DEFAULT_CONCURRENCY_LIMIT = 10

export type RunSubtitleEnrichmentInput = {
  assetId: string
  sourceLanguage: string
  targetLanguages: string[]
  model: string
  apiKey?: string
  timeoutMs: number
  concurrency?: number
}

export type RunSubtitleEnrichmentDeps = {
  readArtifact?: typeof readSubtitleArtifact
  writeArtifact?: typeof writeSubtitleArtifact
  translate?: (input: {
    chunk: Chunk
    targetLanguage: string
    model: string
    apiKey?: string
    timeoutMs: number
    config?: LanguageConfig
  }) => Promise<TranslateChunkResult>
  retime?: (input: {
    chunk: Chunk
    translatedText: string
    targetLanguage: string
    model: string
    apiKey?: string
    timeoutMs: number
    config?: LanguageConfig
  }) => Promise<RetimeChunkResult>
  loadConfig?: typeof loadLanguageConfig
}

type TranscriptArtifact = {
  segments: TranscriptSegment[]
}

function parseTranscriptArtifact(bytes: Uint8Array): TranscriptArtifact {
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown
  if (
    typeof parsed !== "object" ||
    parsed == null ||
    !("segments" in parsed) ||
    !Array.isArray((parsed as { segments?: unknown }).segments)
  ) {
    throw new Error("Transcript artifact is missing segments")
  }

  const segments = (parsed as { segments: unknown[] }).segments.map(
    (segment, index): TranscriptSegment => {
      if (
        typeof segment !== "object" ||
        segment == null ||
        typeof (segment as { start?: unknown }).start !== "number" ||
        typeof (segment as { end?: unknown }).end !== "number" ||
        typeof (segment as { text?: unknown }).text !== "string"
      ) {
        throw new Error(`Transcript segment ${index} is invalid`)
      }

      return {
        start: (segment as { start: number }).start,
        end: (segment as { end: number }).end,
        text: (segment as { text: string }).text,
      }
    },
  )

  return { segments }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const workerCount = Math.max(1, Math.min(concurrency, items.length))

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex++
        results[currentIndex] = await fn(items[currentIndex]!)
      }
    }),
  )

  return results
}

export async function runSubtitleEnrichment(
  input: RunSubtitleEnrichmentInput,
  deps: RunSubtitleEnrichmentDeps = {},
): Promise<SubtitleLanguageResult[]> {
  const readArtifact = deps.readArtifact ?? readSubtitleArtifact
  const writeArtifact = deps.writeArtifact ?? writeSubtitleArtifact
  const translate = deps.translate ?? translateChunk
  const retime = deps.retime ?? retimeChunk
  const loadConfig = deps.loadConfig ?? loadLanguageConfig

  const transcript = parseTranscriptArtifact(
    await readArtifact(input.assetId, "transcript", "json"),
  )
  const chunks = chunkSegments(transcript.segments)

  return mapWithConcurrency(
    input.targetLanguages,
    input.concurrency ?? DEFAULT_CONCURRENCY_LIMIT,
    (targetLanguage) =>
      translateLanguage({
        assetId: input.assetId,
        sourceLanguage: input.sourceLanguage,
        targetLanguage,
        chunks,
        transcriptSegments: transcript.segments,
        model: input.model,
        apiKey: input.apiKey,
        timeoutMs: input.timeoutMs,
        translate,
        retime,
        writeArtifact,
        loadConfig,
      }),
  )
}

async function translateLanguage(input: {
  assetId: string
  sourceLanguage: string
  targetLanguage: string
  chunks: Chunk[]
  transcriptSegments: TranscriptSegment[]
  model: string
  apiKey?: string
  timeoutMs: number
  translate: NonNullable<RunSubtitleEnrichmentDeps["translate"]>
  retime: NonNullable<RunSubtitleEnrichmentDeps["retime"]>
  writeArtifact: (options: WriteSubtitleArtifactOptions) => Promise<string>
  loadConfig: typeof loadLanguageConfig
}): Promise<SubtitleLanguageResult> {
  if (input.sourceLanguage === input.targetLanguage) {
    return writeNoOpTranslationArtifacts(input)
  }

  try {
    const config = await input.loadConfig(input.targetLanguage)
    const allSegments: TranscriptSegment[] = []

    for (const chunk of input.chunks) {
      const translatedText = await input.translate({
        chunk,
        targetLanguage: input.targetLanguage,
        model: input.model,
        apiKey: input.apiKey,
        timeoutMs: input.timeoutMs,
        config,
      })
      const retimed = await input.retime({
        chunk,
        translatedText: translatedText.text,
        targetLanguage: input.targetLanguage,
        model: input.model,
        apiKey: input.apiKey,
        timeoutMs: input.timeoutMs,
        config,
      })
      allSegments.push(...retimed.segments)
    }

    return writeCompletedTranslationArtifacts({
      assetId: input.assetId,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      segments: allSegments,
      translated: true,
      writeArtifact: input.writeArtifact,
    })
  } catch (error) {
    const message =
      error instanceof SubtitleProviderError || error instanceof Error
        ? error.message
        : "Unknown subtitle enrichment error"
    return {
      lang: input.targetLanguage,
      status: "failed",
      error: message,
    }
  }
}

async function writeNoOpTranslationArtifacts(input: {
  assetId: string
  sourceLanguage: string
  targetLanguage: string
  transcriptSegments: TranscriptSegment[]
  writeArtifact: (options: WriteSubtitleArtifactOptions) => Promise<string>
}): Promise<SubtitleLanguageResult> {
  return writeCompletedTranslationArtifacts({
    assetId: input.assetId,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    segments: input.transcriptSegments,
    translated: false,
    writeArtifact: input.writeArtifact,
  })
}

async function writeCompletedTranslationArtifacts(input: {
  assetId: string
  sourceLanguage: string
  targetLanguage: string
  segments: TranscriptSegment[]
  translated: boolean
  writeArtifact: (options: WriteSubtitleArtifactOptions) => Promise<string>
}): Promise<SubtitleLanguageResult> {
  const vttContent = segmentsToVtt(input.segments, {
    language: input.targetLanguage,
    assetId: input.assetId,
  })
  const vttKey = await input.writeArtifact({
    assetId: input.assetId,
    artifactType: `subtitles-${input.targetLanguage}`,
    ext: "vtt",
    body: vttContent,
    contentType: "text/vtt",
  })

  const fullText = input.segments.map((segment) => segment.text).join(" ")
  const translationResult = {
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    text: fullText,
    ...(input.translated
      ? {}
      : {
          mode: "source_equals_target",
          translated: false,
        }),
  }
  const jsonKey = await input.writeArtifact({
    assetId: input.assetId,
    artifactType: `translation-${input.targetLanguage}`,
    ext: "json",
    body: JSON.stringify(translationResult, null, 2),
    contentType: "application/json",
  })

  return {
    lang: input.targetLanguage,
    status: "completed",
    artifactKeys: { vtt: vttKey, json: jsonKey },
  }
}

export const _internals = {
  parseTranscriptArtifact,
  mapWithConcurrency,
}
