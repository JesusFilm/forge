import { requestOpenRouterChat } from "./openrouter"
import { cleanBibleReferences } from "./scripture-context"
import type { SubtitleBiblePassage } from "./bible-source"
import {
  SubtitleScriptureValidationModelOutputJsonSchema,
  SubtitleScriptureValidationModelOutputSchema,
  type SubtitleScriptureContext,
  type SubtitleScriptureValidationFallbackReason,
  type SubtitleScriptureValidationFinding,
  type SubtitleScriptureValidationModelOutput,
  type SubtitleScriptureValidationResult,
  type TranscriptSegment,
} from "./types"

export type ValidateSubtitleScriptureAccuracyInput = {
  targetLanguage: string
  segments: TranscriptSegment[]
  scriptureContext: SubtitleScriptureContext
  model: string
  apiKey?: string
  timeoutMs: number
  biblePassage?: SubtitleBiblePassage
  fallbackReason?: SubtitleScriptureValidationFallbackReason
  fetchImpl?: typeof fetch
}

const MAX_VALIDATION_TEXT_CHARS = 8_000

function compactSegments(segments: TranscriptSegment[]): string {
  let text = ""
  for (const [index, segment] of segments.entries()) {
    const next = `${text}${text ? "\n" : ""}[${index}] ${segment.start.toFixed(
      2,
    )}-${segment.end.toFixed(2)} ${segment.text.trim()}`
    if (next.length > MAX_VALIDATION_TEXT_CHARS) {
      return next.slice(0, MAX_VALIDATION_TEXT_CHARS)
    }
    text = next
  }
  return text
}

function validationBasis(input: ValidateSubtitleScriptureAccuracyInput) {
  return input.biblePassage ? "target_bible_text" : "model_knowledge"
}

function buildValidationMessages(
  input: ValidateSubtitleScriptureAccuracyInput,
) {
  const knownReferences = cleanBibleReferences(
    input.scriptureContext.likelyBibleReferences,
  )
  const basis = validationBasis(input)

  const system = [
    "You validate translated subtitles for Christian gospel and Bible-story videos.",
    "Return compact JSON matching the schema.",
    "Do not include hidden reasoning, long Bible quotations, or commentary.",
    "Flag risky scripture drift: changed meaning, omitted key details, invented details, changed names, shifted theological terms, or unsupported story details.",
    "Treat faithful natural-language adaptation as acceptable when meaning is preserved.",
    basis === "target_bible_text"
      ? "A target-language Bible passage is supplied. Use it as the audit source, especially for direct quotes and version-specific phrasing."
      : "No target-language Bible passage is supplied. Use model knowledge to identify the likely Bible story/reference and obvious drift, but lower confidence when exact wording or version-specific phrasing cannot be audited.",
  ].join(" ")

  const user = [
    `Target language: ${input.targetLanguage}`,
    `Detected content domain: ${input.scriptureContext.contentDomain}`,
    `Detected confidence: ${input.scriptureContext.confidence}`,
    knownReferences.length > 0
      ? `Known likely references: ${knownReferences.join(", ")}`
      : "Known likely references: none",
    input.fallbackReason
      ? `External Bible text fallback reason: ${input.fallbackReason}`
      : null,
    input.biblePassage
      ? [
          "Target-language Bible source:",
          `Provider: ${input.biblePassage.provider.name}`,
          `Bible id: ${input.biblePassage.provider.bibleId}`,
          `Reference: ${input.biblePassage.provider.reference}`,
          "Passage text:",
          input.biblePassage.text,
        ].join("\n")
      : null,
    "Translated subtitle segments:",
    compactSegments(input.segments) || "(empty)",
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n\n")

  return { system, user }
}

function countFindings(
  findings: SubtitleScriptureValidationResult["findings"],
  severity: "warning" | "needs_review",
): number {
  return findings.filter((finding) => finding.severity === severity).length
}

function verdictFromFindings(
  requestedVerdict: SubtitleScriptureValidationModelOutput["verdict"],
  findings: SubtitleScriptureValidationFinding[],
): SubtitleScriptureValidationModelOutput["verdict"] {
  if (findings.some((finding) => finding.severity === "needs_review")) {
    return "needs_review"
  }
  if (findings.some((finding) => finding.severity === "warning")) {
    return "warning"
  }
  return requestedVerdict
}

function findingsWithVerdictAnchor(
  result: SubtitleScriptureValidationModelOutput,
  references: string[],
): SubtitleScriptureValidationFinding[] {
  if (result.verdict === "pass" || result.findings.length > 0) {
    return result.findings
  }

  const severity =
    result.verdict === "needs_review" ? "needs_review" : "warning"
  return [
    {
      severity,
      category: "uncertain_reference",
      message: `Model returned ${result.verdict} without a specific finding; manual scripture review is recommended.`,
      ...(references[0] ? { reference: references[0] } : {}),
    },
  ]
}

export function buildUnavailableSubtitleScriptureValidationResult(input: {
  targetLanguage: string
  scriptureContext: SubtitleScriptureContext
  unavailableReason: string
}): SubtitleScriptureValidationResult {
  return {
    targetLanguage: input.targetLanguage,
    contentDomain: input.scriptureContext.contentDomain,
    likelyBibleReferences: cleanBibleReferences(
      input.scriptureContext.likelyBibleReferences,
    ),
    verdict: "unavailable",
    basis: "unavailable",
    confidence: 0,
    checkedReferenceCount: 0,
    warningCount: 0,
    needsReviewCount: 0,
    unavailableReason: input.unavailableReason.slice(0, 80),
    findings: [],
  }
}

export async function validateSubtitleScriptureAccuracy(
  input: ValidateSubtitleScriptureAccuracyInput,
): Promise<SubtitleScriptureValidationResult> {
  const messages = buildValidationMessages(input)
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
      name: "subtitle_scripture_validation",
      schema: SubtitleScriptureValidationModelOutputJsonSchema,
      validator: SubtitleScriptureValidationModelOutputSchema,
    },
  })

  const likelyBibleReferences = cleanBibleReferences([
    ...input.scriptureContext.likelyBibleReferences,
    ...result.value.likelyBibleReferences,
  ])
  const findings = findingsWithVerdictAnchor(
    result.value,
    likelyBibleReferences,
  )
  const verdict = verdictFromFindings(result.value.verdict, findings)
  const basis = validationBasis(input)

  return {
    targetLanguage: input.targetLanguage,
    contentDomain: input.scriptureContext.contentDomain,
    likelyBibleReferences,
    verdict,
    basis,
    confidence: result.value.confidence,
    checkedReferenceCount: input.biblePassage
      ? input.biblePassage.referenceCount
      : Math.max(likelyBibleReferences.length, 0),
    warningCount: countFindings(findings, "warning"),
    needsReviewCount: countFindings(findings, "needs_review"),
    ...(input.fallbackReason ? { fallbackReason: input.fallbackReason } : {}),
    ...(input.biblePassage ? { provider: input.biblePassage.provider } : {}),
    findings,
  }
}

export const _internals = {
  compactSegments,
  buildValidationMessages,
  countFindings,
  verdictFromFindings,
  findingsWithVerdictAnchor,
}
