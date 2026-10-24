import { requestOpenRouterChat } from "./openrouter"
import type { SubtitleBiblePassage } from "./bible-source"
import { cleanBibleReferences } from "./scripture-context"
import {
  TranscriptScriptureCorrectionModelOutputJsonSchema,
  TranscriptScriptureCorrectionModelOutputSchema,
  type TranscriptScriptureCorrectionFinding,
  type TranscriptScriptureCorrectionModelOutput,
  type TranscriptScriptureCorrectionResult,
} from "./transcript-correction-types"
import type { SubtitleScriptureContext, TranscriptSegment } from "./types"

export type CorrectTranscriptScriptureInput = {
  sourceLanguage: string
  segments: TranscriptSegment[]
  scriptureContext: SubtitleScriptureContext
  model: string
  apiKey?: string
  timeoutMs: number
  biblePassage?: SubtitleBiblePassage
  fetchImpl?: typeof fetch
}

const MAX_CORRECTION_TEXT_CHARS = 8_000

function compactSegments(segments: TranscriptSegment[]): string {
  let text = ""
  for (const [index, segment] of segments.entries()) {
    const next = `${text}${text ? "\n" : ""}[${index}] ${segment.start.toFixed(
      2,
    )}-${segment.end.toFixed(2)} ${segment.text.trim()}`
    if (next.length > MAX_CORRECTION_TEXT_CHARS) {
      return next.slice(0, MAX_CORRECTION_TEXT_CHARS)
    }
    text = next
  }
  return text
}

function correctionBasis(input: CorrectTranscriptScriptureInput) {
  return input.biblePassage ? "source_bible_text" : "model_knowledge"
}

function buildCorrectionMessages(input: CorrectTranscriptScriptureInput) {
  const knownReferences = cleanBibleReferences(
    input.scriptureContext.likelyBibleReferences,
  )
  const basis = correctionBasis(input)

  const system = [
    "You review source transcript segments for Christian gospel and Bible-story videos.",
    "Find obvious ASR drift in scripture phrases, proper names, and story-critical statements.",
    "Return compact JSON matching the schema.",
    "Use apply_candidate only when the segment text is very likely wrong and the corrected text is short, exact, and safe for deterministic replacement.",
    "Use flag_only for uncertain, broad, non-exact, or editorial suggestions.",
    "Do not rewrite style, do not retime segments, do not include hidden reasoning, long Bible quotations, or commentary.",
    basis === "source_bible_text"
      ? "A source-language Bible passage is supplied. Use it as the audit source, especially for direct quotes and version-specific wording."
      : "No source-language Bible passage is supplied. Use model knowledge to identify the likely Bible story/reference and obvious ASR drift, but lower confidence when exact wording cannot be audited.",
  ].join(" ")

  const user = [
    `Source language: ${input.sourceLanguage}`,
    `Detected content domain: ${input.scriptureContext.contentDomain}`,
    `Detected confidence: ${input.scriptureContext.confidence}`,
    knownReferences.length > 0
      ? `Known likely references: ${knownReferences.join(", ")}`
      : "Known likely references: none",
    input.biblePassage
      ? [
          "Source-language Bible source:",
          `Provider: ${input.biblePassage.provider.name}`,
          `Bible id: ${input.biblePassage.provider.bibleId}`,
          `Reference: ${input.biblePassage.provider.reference}`,
          "Passage text:",
          input.biblePassage.text,
        ].join("\n")
      : null,
    "Source transcript segments:",
    compactSegments(input.segments) || "(empty)",
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n\n")

  return { system, user }
}

function countFindings(
  findings: TranscriptScriptureCorrectionFinding[],
  action: TranscriptScriptureCorrectionFinding["action"],
): number {
  return findings.filter((finding) => finding.action === action).length
}

function normalizeFindings(
  result: TranscriptScriptureCorrectionModelOutput,
  basis: TranscriptScriptureCorrectionFinding["basis"],
): TranscriptScriptureCorrectionFinding[] {
  return result.findings.map((finding) => ({
    ...finding,
    basis:
      basis === "source_bible_text" && finding.basis === "source_bible_text"
        ? "source_bible_text"
        : basis,
    rationale: finding.rationale.slice(0, 240),
  }))
}

export function buildUnavailableTranscriptScriptureCorrectionResult(input: {
  scriptureContext: SubtitleScriptureContext
  unavailableReason: string
}): TranscriptScriptureCorrectionResult {
  return {
    status: "unavailable",
    basis: "unavailable",
    contentDomain: input.scriptureContext.contentDomain,
    confidence: 0,
    checkedReferenceCount: 0,
    candidateCount: 0,
    flaggedCount: 0,
    unavailableReason: input.unavailableReason.slice(0, 80),
    likelyBibleReferences: cleanBibleReferences(
      input.scriptureContext.likelyBibleReferences,
    ),
    findings: [],
  }
}

export async function correctTranscriptScripture(
  input: CorrectTranscriptScriptureInput,
): Promise<TranscriptScriptureCorrectionResult> {
  const messages = buildCorrectionMessages(input)
  const result = await requestOpenRouterChat({
    apiKey: input.apiKey,
    model: input.model,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
    messages: [
      { role: "system", content: messages.system },
      { role: "user", content: messages.user },
    ],
    responseFormat: {
      name: "transcript_scripture_correction",
      schema: TranscriptScriptureCorrectionModelOutputJsonSchema,
      validator: TranscriptScriptureCorrectionModelOutputSchema,
    },
  })

  const basis = correctionBasis(input)
  const likelyBibleReferences = cleanBibleReferences([
    ...input.scriptureContext.likelyBibleReferences,
    ...result.value.likelyBibleReferences,
  ])
  const findings = normalizeFindings(result.value, basis)

  return {
    status: "reviewed",
    basis,
    contentDomain: input.scriptureContext.contentDomain,
    confidence: result.value.confidence,
    checkedReferenceCount: input.biblePassage
      ? input.biblePassage.referenceCount
      : Math.max(likelyBibleReferences.length, 0),
    candidateCount: countFindings(findings, "apply_candidate"),
    flaggedCount: countFindings(findings, "flag_only"),
    likelyBibleReferences,
    findings,
  }
}

export const _internals = {
  compactSegments,
  buildCorrectionMessages,
  countFindings,
  normalizeFindings,
}
