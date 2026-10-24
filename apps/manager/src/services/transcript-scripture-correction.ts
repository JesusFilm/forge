import type {
  MastraTranscriptScriptureCorrection,
  MastraTranscriptScriptureCorrectionFinding,
} from "@/services/mastra-transcript-scripture-correction"
import type { TranscriptSegment } from "@/services/transcription"
import type {
  TranscriptScriptureCorrectionFinding,
  TranscriptScriptureCorrectionStepSummary,
} from "@/lib/transcript-scripture-correction"

export type TranscriptCorrectionApplicationInput = {
  text: string
  segments: TranscriptSegment[]
  correction:
    | MastraTranscriptScriptureCorrection
    | Extract<MastraTranscriptScriptureCorrection, { status: "unavailable" }>
}

export type TranscriptCorrectionApplicationResult = {
  text: string
  segments: TranscriptSegment[]
  changed: boolean
  summary: TranscriptScriptureCorrectionStepSummary
}

export const MIN_AUTO_APPLY_CONFIDENCE = 0.9

function joinSegments(segments: TranscriptSegment[]): string {
  return segments.map((segment) => segment.text).join(" ")
}

function flaggedFinding(
  finding: MastraTranscriptScriptureCorrectionFinding,
  rationaleSuffix?: string,
): TranscriptScriptureCorrectionFinding {
  return {
    action: "flagged",
    category: finding.category,
    segmentIndex: finding.segmentIndex,
    start: finding.start,
    end: finding.end,
    originalText: finding.originalText,
    ...(finding.correctedText ? { correctedText: finding.correctedText } : {}),
    ...(finding.reference ? { reference: finding.reference } : {}),
    confidence: finding.confidence,
    basis: finding.basis,
    rationale: rationaleSuffix
      ? `${finding.rationale} ${rationaleSuffix}`.slice(0, 240)
      : finding.rationale,
  }
}

function appliedFinding(
  finding: MastraTranscriptScriptureCorrectionFinding,
): TranscriptScriptureCorrectionFinding {
  return {
    action: "applied",
    category: finding.category,
    segmentIndex: finding.segmentIndex,
    start: finding.start,
    end: finding.end,
    originalText: finding.originalText,
    correctedText: finding.correctedText!,
    ...(finding.reference ? { reference: finding.reference } : {}),
    confidence: finding.confidence,
    basis: finding.basis,
    rationale: finding.rationale,
  }
}

function statusForCounts(input: {
  appliedCount: number
  flaggedCount: number
}): TranscriptScriptureCorrectionStepSummary["status"] {
  if (input.appliedCount > 0) return "applied"
  if (input.flaggedCount > 0) return "flagged"
  return "skipped"
}

function passthroughSummary(
  correction: MastraTranscriptScriptureCorrection,
): TranscriptScriptureCorrectionStepSummary {
  if (correction.status === "unavailable") {
    return {
      status: "unavailable",
      basis: "unavailable",
      contentDomain: correction.contentDomain,
      confidence: 0,
      checkedReferenceCount: correction.checkedReferenceCount,
      appliedCount: 0,
      flaggedCount: 0,
      unavailableReason:
        correction.unavailableReason ?? "correction_unavailable",
      likelyBibleReferences: correction.likelyBibleReferences,
      findings: [],
    }
  }

  return {
    status: "skipped",
    basis:
      correction.basis === "unavailable" ? "model_knowledge" : correction.basis,
    contentDomain: correction.contentDomain,
    confidence: correction.confidence,
    checkedReferenceCount: correction.checkedReferenceCount,
    appliedCount: 0,
    flaggedCount: 0,
    skippedReason: correction.skippedReason ?? "no_corrections",
    likelyBibleReferences: correction.likelyBibleReferences,
    findings: [],
  }
}

export function applyTranscriptScriptureCorrections(
  input: TranscriptCorrectionApplicationInput,
): TranscriptCorrectionApplicationResult {
  const { correction } = input
  if (correction.status !== "reviewed") {
    return {
      text: input.text,
      segments: input.segments,
      changed: false,
      summary: passthroughSummary(correction),
    }
  }

  const nextSegments = input.segments.map((segment) => ({ ...segment }))
  const findings: TranscriptScriptureCorrectionFinding[] = []

  for (const finding of correction.findings) {
    const segment = nextSegments[finding.segmentIndex]
    if (
      finding.action !== "apply_candidate" ||
      !finding.correctedText ||
      finding.confidence < MIN_AUTO_APPLY_CONFIDENCE
    ) {
      findings.push(
        flaggedFinding(
          finding,
          finding.action === "apply_candidate"
            ? "Automatic correction guard did not pass."
            : undefined,
        ),
      )
      continue
    }

    if (!segment || !segment.text.includes(finding.originalText)) {
      findings.push(
        flaggedFinding(finding, "Original text did not exact-match segment."),
      )
      continue
    }

    segment.text = segment.text.replace(
      finding.originalText,
      finding.correctedText,
    )
    findings.push(appliedFinding(finding))
  }

  const appliedCount = findings.filter(
    (finding) => finding.action === "applied",
  ).length
  const flaggedCount = findings.filter(
    (finding) => finding.action === "flagged",
  ).length
  const status = statusForCounts({ appliedCount, flaggedCount })

  return {
    text: appliedCount > 0 ? joinSegments(nextSegments) : input.text,
    segments: appliedCount > 0 ? nextSegments : input.segments,
    changed: appliedCount > 0,
    summary: {
      status,
      basis:
        correction.basis === "unavailable"
          ? "model_knowledge"
          : correction.basis,
      contentDomain: correction.contentDomain,
      confidence: correction.confidence,
      checkedReferenceCount: correction.checkedReferenceCount,
      appliedCount,
      flaggedCount,
      ...(status === "skipped" ? { skippedReason: "no_corrections" } : {}),
      likelyBibleReferences: correction.likelyBibleReferences,
      findings,
    },
  }
}

export function buildTranscriptCorrectionReport(
  summary: TranscriptScriptureCorrectionStepSummary,
) {
  return {
    kind: "transcript-scripture-correction-report",
    version: 1,
    generatedAt: new Date().toISOString(),
    summary,
    findings: summary.findings,
  }
}
