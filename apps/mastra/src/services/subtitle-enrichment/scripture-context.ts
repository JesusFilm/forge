import { requestOpenRouterChat } from "./openrouter"
import {
  SubtitleScriptureContextJsonSchema,
  SubtitleScriptureContextSchema,
  type SubtitleScriptureContext,
  type SubtitleTranslationContext,
  type TranscriptSegment,
} from "./types"

const MAX_TRANSCRIPT_EXCERPT_CHARS = 4_000
const MAX_BIBLE_REFERENCE_CHARS = 80
const MAX_DETECTED_BIBLE_REFERENCES = 10
const BIBLE_REFERENCE_PATTERN =
  /^(?:[1-3]\s*)?[A-Za-z][A-Za-z .'-]{1,40}\s+\d{1,3}(?::\d{1,3}(?:[-–]\d{1,3})?)?(?:\s*[-–]\s*\d{1,3}(?::\d{1,3}(?:[-–]\d{1,3})?)?)?$/

export type DetectSubtitleScriptureContextInput = {
  sourceLanguage: string
  transcriptSegments: TranscriptSegment[]
  translationContext?: SubtitleTranslationContext
  model: string
  apiKey?: string
  timeoutMs: number
  fetchImpl?: typeof fetch
}

function clean(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function cleanRationale(value: string | null | undefined): string | undefined {
  const trimmed = clean(value)
  return trimmed ? trimmed.slice(0, 240) : undefined
}

export function cleanBibleReferences(
  references: string[] | undefined,
  maxItems = MAX_DETECTED_BIBLE_REFERENCES,
): string[] {
  return Array.from(
    new Set(
      (references ?? [])
        .map((reference) => reference.trim().replace(/\s+/g, " "))
        .filter(
          (reference) =>
            reference.length > 0 &&
            reference.length <= MAX_BIBLE_REFERENCE_CHARS &&
            BIBLE_REFERENCE_PATTERN.test(reference),
        ),
    ),
  ).slice(0, maxItems)
}

export function fallbackSubtitleScriptureContext(
  translationContext?: SubtitleTranslationContext,
): SubtitleScriptureContext {
  const likelyBibleReferences = cleanBibleReferences(
    translationContext?.bibleReferences,
  )
  if (likelyBibleReferences.length > 0) {
    return {
      contentDomain: "bible_story",
      likelyBibleReferences,
      confidence: 0.65,
      rationale: "Manager supplied Bible references.",
    }
  }

  if (
    clean(translationContext?.videoTitle) ||
    clean(translationContext?.videoLabel)
  ) {
    return {
      contentDomain: "christian_general",
      likelyBibleReferences: [],
      confidence: 0.35,
      rationale: "Manager supplied gospel video metadata.",
    }
  }

  return {
    contentDomain: "christian_general",
    likelyBibleReferences: [],
    confidence: 0.25,
    rationale: "Default Forge subtitle translation posture.",
  }
}

function transcriptExcerpt(segments: TranscriptSegment[]): string {
  let excerpt = ""
  for (const segment of segments) {
    const line = segment.text.trim()
    if (!line) continue
    const next = excerpt ? `${excerpt} ${line}` : line
    if (next.length > MAX_TRANSCRIPT_EXCERPT_CHARS) {
      return next.slice(0, MAX_TRANSCRIPT_EXCERPT_CHARS)
    }
    excerpt = next
  }
  return excerpt
}

function buildDetectorMessages(input: DetectSubtitleScriptureContextInput) {
  const bibleReferences = cleanBibleReferences(
    input.translationContext?.bibleReferences,
  )
  const metadataLines = [
    clean(input.translationContext?.videoTitle)
      ? `Video title: ${clean(input.translationContext?.videoTitle)}`
      : null,
    clean(input.translationContext?.videoLabel)
      ? `Video label: ${clean(input.translationContext?.videoLabel)}`
      : null,
    bibleReferences.length > 0
      ? `Known Bible references: ${bibleReferences.join(", ")}`
      : null,
  ].filter(Boolean)

  return {
    system: [
      "You identify scripture context for subtitle translation.",
      "Forge often translates Christian gospel videos, including Bible-story videos.",
      "Classify the source as one of: bible_story, gospel_teaching, christian_general, other.",
      "Use known Bible references when supplied. Only infer references when strongly supported by title or transcript.",
      "Keep likelyBibleReferences empty when uncertain. Do not include commentary or hidden reasoning.",
      "Return compact JSON matching the schema.",
    ].join(" "),
    user: [
      `Source language: ${input.sourceLanguage}`,
      metadataLines.length > 0
        ? metadataLines.join("\n")
        : "No video metadata supplied.",
      "Transcript excerpt:",
      transcriptExcerpt(input.transcriptSegments) || "(empty)",
    ].join("\n\n"),
  }
}

function normalizeScriptureContext(
  value: SubtitleScriptureContext,
  fallback: SubtitleScriptureContext,
): SubtitleScriptureContext {
  const providerReferences = cleanBibleReferences(value.likelyBibleReferences)
  const fallbackReferences = cleanBibleReferences(
    fallback.likelyBibleReferences,
  )
  const shouldUseFallbackReferences =
    fallbackReferences.length > 0 &&
    (providerReferences.length === 0 || value.confidence < 0.35)
  const likelyBibleReferences = shouldUseFallbackReferences
    ? fallbackReferences
    : providerReferences
  const contentDomain =
    shouldUseFallbackReferences ||
    (value.confidence < 0.35 && likelyBibleReferences.length === 0)
      ? fallback.contentDomain
      : value.contentDomain

  return {
    contentDomain,
    likelyBibleReferences,
    confidence: Math.max(0, Math.min(1, value.confidence)),
    ...(cleanRationale(value.rationale)
      ? { rationale: cleanRationale(value.rationale) }
      : {}),
  }
}

export function sanitizeSubtitleScriptureContext(
  value: SubtitleScriptureContext,
  translationContext?: SubtitleTranslationContext,
): SubtitleScriptureContext {
  return normalizeScriptureContext(
    value,
    fallbackSubtitleScriptureContext(translationContext),
  )
}

export async function detectSubtitleScriptureContext(
  input: DetectSubtitleScriptureContextInput,
): Promise<SubtitleScriptureContext> {
  const fallback = fallbackSubtitleScriptureContext(input.translationContext)
  const prompt = buildDetectorMessages(input)

  const result = await requestOpenRouterChat({
    apiKey: input.apiKey,
    model: input.model,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    responseFormat: {
      name: "subtitle_scripture_context",
      schema: SubtitleScriptureContextJsonSchema,
      validator: SubtitleScriptureContextSchema,
    },
  })

  return normalizeScriptureContext(result.value, fallback)
}

export const _internals = {
  buildDetectorMessages,
  transcriptExcerpt,
  normalizeScriptureContext,
}
