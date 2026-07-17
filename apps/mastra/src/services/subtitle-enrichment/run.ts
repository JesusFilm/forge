import { mapWithConcurrency } from "../concurrency"
import { chunkSegments } from "./chunker"
import { loadLanguageConfig } from "./language-config"
import { retimeChunk, type RetimeChunkResult } from "./retimer"
import {
  loadConfiguredBiblePassage,
  type SubtitleBiblePassage,
} from "./bible-source"
import {
  detectSubtitleScriptureContext,
  fallbackSubtitleScriptureContext,
  sanitizeSubtitleScriptureContext,
  type DetectSubtitleScriptureContextInput,
} from "./scripture-context"
import {
  readSubtitleArtifact,
  writeSubtitleArtifact,
  type WriteSubtitleArtifactOptions,
} from "./storage"
import {
  SubtitleProviderError,
  type Chunk,
  type LanguageConfig,
  type SubtitleScriptureContext,
  type SubtitleScriptureValidationFallbackReason,
  type SubtitleScriptureValidationResult,
  type SubtitleScriptureValidationSummary,
  type SubtitleTranslationContext,
  type SubtitleLanguageResult,
  type TranscriptSegment,
} from "./types"
import { translateChunk, type TranslateChunkResult } from "./translator"
import {
  buildUnavailableSubtitleScriptureValidationResult,
  validateSubtitleScriptureAccuracy,
  type ValidateSubtitleScriptureAccuracyInput,
} from "./scripture-validation"
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
  translationContext?: SubtitleTranslationContext
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
    scriptureContext?: SubtitleScriptureContext
  }) => Promise<TranslateChunkResult>
  retime?: (input: {
    chunk: Chunk
    translatedText: string
    targetLanguage: string
    model: string
    apiKey?: string
    timeoutMs: number
    config?: LanguageConfig
    scriptureContext?: SubtitleScriptureContext
  }) => Promise<RetimeChunkResult>
  detectScriptureContext?: (
    input: DetectSubtitleScriptureContextInput,
  ) => Promise<SubtitleScriptureContext>
  loadBiblePassage?: typeof loadConfiguredBiblePassage
  validateScripture?: (
    input: ValidateSubtitleScriptureAccuracyInput,
  ) => Promise<SubtitleScriptureValidationResult>
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

function detectorErrorDetails(error: unknown) {
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    ...(error instanceof SubtitleProviderError ? { reason: error.reason } : {}),
  }
}

function providerFallbackReason(
  error: unknown,
): SubtitleScriptureValidationFallbackReason {
  if (error instanceof SubtitleProviderError) {
    return error.reason
  }
  return "provider_failed"
}

function validationSummaryFromResult(
  result: SubtitleScriptureValidationResult,
): SubtitleScriptureValidationSummary {
  return {
    verdict: result.verdict,
    basis: result.basis,
    confidence: result.confidence,
    checkedReferenceCount: result.checkedReferenceCount,
    warningCount: result.warningCount,
    needsReviewCount: result.needsReviewCount,
    ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
    ...(result.unavailableReason
      ? { unavailableReason: result.unavailableReason }
      : {}),
  }
}

function shouldValidateScripture(
  context: SubtitleScriptureContext | undefined,
): context is SubtitleScriptureContext {
  if (!context) {
    return false
  }
  if (context.likelyBibleReferences.length > 0) {
    return true
  }
  return context.contentDomain === "bible_story" && context.confidence >= 0.5
}

export async function runSubtitleEnrichment(
  input: RunSubtitleEnrichmentInput,
  deps: RunSubtitleEnrichmentDeps = {},
): Promise<SubtitleLanguageResult[]> {
  const readArtifact = deps.readArtifact ?? readSubtitleArtifact
  const writeArtifact = deps.writeArtifact ?? writeSubtitleArtifact
  const translate = deps.translate ?? translateChunk
  const retime = deps.retime ?? retimeChunk
  const detectScriptureContext =
    deps.detectScriptureContext ?? detectSubtitleScriptureContext
  const loadBiblePassage = deps.loadBiblePassage ?? loadConfiguredBiblePassage
  const validateScripture =
    deps.validateScripture ?? validateSubtitleScriptureAccuracy
  const loadConfig = deps.loadConfig ?? loadLanguageConfig

  const transcript = parseTranscriptArtifact(
    await readArtifact(input.assetId, "transcript", "json"),
  )
  const chunks = chunkSegments(transcript.segments)
  const hasProviderWork = input.targetLanguages.some(
    (targetLanguage) => targetLanguage !== input.sourceLanguage,
  )
  const scriptureContext = hasProviderWork
    ? await detectScriptureContext({
        sourceLanguage: input.sourceLanguage,
        transcriptSegments: transcript.segments,
        translationContext: input.translationContext,
        model: input.model,
        apiKey: input.apiKey,
        timeoutMs: input.timeoutMs,
      })
        .then((context) =>
          context
            ? sanitizeSubtitleScriptureContext(
                context,
                input.translationContext,
              )
            : undefined,
        )
        .catch((error) => {
          console.warn(
            JSON.stringify({
              event: "subtitle_scripture_context_detection_failed",
              assetId: input.assetId,
              ...detectorErrorDetails(error),
            }),
          )
          return fallbackSubtitleScriptureContext(input.translationContext)
        })
    : undefined

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
        scriptureContext,
        translate,
        retime,
        loadBiblePassage,
        validateScripture,
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
  scriptureContext?: SubtitleScriptureContext
  translate: NonNullable<RunSubtitleEnrichmentDeps["translate"]>
  retime: NonNullable<RunSubtitleEnrichmentDeps["retime"]>
  loadBiblePassage: NonNullable<RunSubtitleEnrichmentDeps["loadBiblePassage"]>
  validateScripture: NonNullable<RunSubtitleEnrichmentDeps["validateScripture"]>
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
        scriptureContext: input.scriptureContext,
      })
      const retimed = await input.retime({
        chunk,
        translatedText: translatedText.text,
        targetLanguage: input.targetLanguage,
        model: input.model,
        apiKey: input.apiKey,
        timeoutMs: input.timeoutMs,
        config,
        scriptureContext: input.scriptureContext,
      })
      allSegments.push(...retimed.segments)
    }

    return writeCompletedTranslationArtifacts({
      assetId: input.assetId,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      segments: allSegments,
      translated: true,
      scriptureContext: input.scriptureContext,
      model: input.model,
      apiKey: input.apiKey,
      timeoutMs: input.timeoutMs,
      loadBiblePassage: input.loadBiblePassage,
      validateScripture: input.validateScripture,
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
  scriptureContext?: SubtitleScriptureContext
  model?: string
  apiKey?: string
  timeoutMs?: number
  loadBiblePassage?: NonNullable<RunSubtitleEnrichmentDeps["loadBiblePassage"]>
  validateScripture?: NonNullable<
    RunSubtitleEnrichmentDeps["validateScripture"]
  >
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
    ...(input.translated && input.scriptureContext
      ? {
          translationContext: {
            contentDomain: input.scriptureContext.contentDomain,
            likelyBibleReferences: input.scriptureContext.likelyBibleReferences,
            confidence: input.scriptureContext.confidence,
          },
        }
      : {}),
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

  const validation = await writeScriptureValidationArtifact(input)

  return {
    lang: input.targetLanguage,
    status: "completed",
    artifactKeys: {
      vtt: vttKey,
      json: jsonKey,
      ...(validation?.artifactKey
        ? { validation: validation.artifactKey }
        : {}),
    },
    ...(validation?.summary ? { validationSummary: validation.summary } : {}),
  }
}

async function writeScriptureValidationArtifact(input: {
  assetId: string
  targetLanguage: string
  segments: TranscriptSegment[]
  translated: boolean
  scriptureContext?: SubtitleScriptureContext
  model?: string
  apiKey?: string
  timeoutMs?: number
  loadBiblePassage?: NonNullable<RunSubtitleEnrichmentDeps["loadBiblePassage"]>
  validateScripture?: NonNullable<
    RunSubtitleEnrichmentDeps["validateScripture"]
  >
  writeArtifact: (options: WriteSubtitleArtifactOptions) => Promise<string>
}): Promise<
  | { artifactKey?: string; summary: SubtitleScriptureValidationSummary }
  | undefined
> {
  if (
    !input.translated ||
    !shouldValidateScripture(input.scriptureContext) ||
    !input.model ||
    !input.timeoutMs ||
    !input.validateScripture
  ) {
    return undefined
  }

  let biblePassage: SubtitleBiblePassage | undefined
  let fallbackReason: SubtitleScriptureValidationFallbackReason | undefined
  const references = input.scriptureContext.likelyBibleReferences
  if (references.length > 0 && input.loadBiblePassage) {
    try {
      const lookup = await input.loadBiblePassage({
        targetLanguage: input.targetLanguage,
        references,
        timeoutMs: input.timeoutMs,
      })
      if (lookup.ok) {
        biblePassage = lookup.passage
      } else {
        fallbackReason = lookup.reason
      }
    } catch (error) {
      fallbackReason = providerFallbackReason(error)
    }
  }

  let result: SubtitleScriptureValidationResult
  try {
    result = await input.validateScripture({
      targetLanguage: input.targetLanguage,
      segments: input.segments,
      scriptureContext: input.scriptureContext,
      model: input.model,
      apiKey: input.apiKey,
      timeoutMs: input.timeoutMs,
      biblePassage,
      fallbackReason,
    })
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "subtitle_scripture_validation_failed",
        assetId: input.assetId,
        targetLanguage: input.targetLanguage,
        ...detectorErrorDetails(error),
      }),
    )
    result = buildUnavailableSubtitleScriptureValidationResult({
      targetLanguage: input.targetLanguage,
      scriptureContext: input.scriptureContext,
      unavailableReason:
        error instanceof SubtitleProviderError
          ? error.reason
          : "provider_failed",
    })
  }

  const summary = validationSummaryFromResult(result)
  try {
    const artifactKey = await input.writeArtifact({
      assetId: input.assetId,
      artifactType: `subtitle-validation-${input.targetLanguage}`,
      ext: "json",
      body: JSON.stringify(result, null, 2),
      contentType: "application/json",
    })
    return { artifactKey, summary }
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "subtitle_scripture_validation_artifact_write_failed",
        assetId: input.assetId,
        targetLanguage: input.targetLanguage,
        errorName: error instanceof Error ? error.name : typeof error,
      }),
    )
    return {
      summary: {
        ...summary,
        unavailableReason: "artifact_write_failed",
      },
    }
  }
}

export const _internals = {
  parseTranscriptArtifact,
  mapWithConcurrency,
  shouldValidateScripture,
  validationSummaryFromResult,
}
