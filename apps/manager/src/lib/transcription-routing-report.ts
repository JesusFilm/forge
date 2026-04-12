import type {
  JobArtifactManifest,
  RequestedTranscriptionProvider,
  ResolvedTranscriptionProvider,
  TranscriptionAttempt,
  TranscriptionAttemptStatus,
  TranscriptionDiarizationSegment,
  TranscriptionDiarizationSummary,
  TranscriptionRoutingReport,
} from "@/types/job"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value)
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function sanitizeSourceInputUrl(value: unknown): string | undefined {
  const url = readString(value)
  if (!url) {
    return undefined
  }

  try {
    const parsed = new URL(url)
    parsed.username = ""
    parsed.password = ""
    parsed.search = ""
    parsed.hash = ""
    return parsed.toString()
  } catch {
    return undefined
  }
}

function normalizeSourceInputHost(value: unknown): string | undefined {
  const source = readString(value)
  if (!source) {
    return undefined
  }

  try {
    const parsed = new URL(source)
    if (parsed.host) {
      return parsed.host
    }
  } catch {
    // Fall through to strict bare-host parsing below.
  }

  if (/[/?#@\s]/.test(source)) {
    return undefined
  }

  try {
    const parsed = new URL(`https://${source}`)
    return parsed.hostname ? parsed.host : undefined
  } catch {
    return undefined
  }
}

function isRequestedProvider(
  value: unknown,
): value is RequestedTranscriptionProvider {
  return value === "automatic" || value === "elevenlabs" || value === "mux"
}

function isResolvedProvider(
  value: unknown,
): value is ResolvedTranscriptionProvider {
  return value === "elevenlabs" || value === "mux"
}

function isAttemptStatus(value: unknown): value is TranscriptionAttemptStatus {
  return (
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "fallback_completed"
  )
}

function normalizeDiarizationSegment(
  value: unknown,
): TranscriptionDiarizationSegment | null {
  if (!isRecord(value)) {
    return null
  }

  const speakerId = readString(value.speakerId)
  const start = readNumber(value.start)
  const end = readNumber(value.end)
  if (!speakerId || start == null || end == null) {
    return null
  }

  const text = readString(value.text)

  return {
    speakerId,
    start,
    end,
    ...(text ? { text } : {}),
  }
}

function normalizeDiarization(
  value: unknown,
): TranscriptionDiarizationSummary | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const speakerCount = readNumber(value.speakerCount)
  const segments = Array.isArray(value.segments)
    ? value.segments
        .map(normalizeDiarizationSegment)
        .filter(
          (entry): entry is TranscriptionDiarizationSegment => entry != null,
        )
    : undefined

  if (speakerCount == null && (!segments || segments.length === 0)) {
    return undefined
  }

  return {
    ...(speakerCount != null ? { speakerCount } : {}),
    ...(segments && segments.length > 0 ? { segments } : {}),
  }
}

function normalizeAttempt(value: unknown): TranscriptionAttempt | null {
  if (!isRecord(value)) {
    return null
  }

  const attemptId = readString(value.attemptId)
  const startedAt = readString(value.startedAt)
  if (
    !attemptId ||
    !startedAt ||
    !isRequestedProvider(value.requestedProvider) ||
    !isResolvedProvider(value.resolvedProvider) ||
    !isAttemptStatus(value.status)
  ) {
    return null
  }

  const sourceLanguageCode = readString(value.sourceLanguageCode)
  const decisionReason = readString(value.decisionReason)
  const fallbackReason = readString(value.fallbackReason)
  const finishedAt = readString(value.finishedAt)

  return {
    attemptId,
    requestedProvider: value.requestedProvider,
    resolvedProvider: value.resolvedProvider,
    status: value.status,
    startedAt,
    ...(sourceLanguageCode ? { sourceLanguageCode } : {}),
    ...(decisionReason ? { decisionReason } : {}),
    ...(value.fallbackFromProvider === "elevenlabs"
      ? { fallbackFromProvider: "elevenlabs" as const }
      : {}),
    ...(fallbackReason ? { fallbackReason } : {}),
    ...(finishedAt ? { finishedAt } : {}),
  }
}

export function buildInitialTranscriptionRoutingReport(input?: {
  sourceInputUrl?: string
}): TranscriptionRoutingReport {
  const sourceInputUrl = sanitizeSourceInputUrl(input?.sourceInputUrl)
  const sourceInputHost =
    normalizeSourceInputHost(sourceInputUrl) ??
    normalizeSourceInputHost(input?.sourceInputUrl)

  return {
    ...(sourceInputUrl ? { sourceInputUrl } : {}),
    ...(sourceInputHost ? { sourceInputHost } : {}),
    attempts: [],
  }
}

export function getTranscriptionRoutingReport(
  artifacts: JobArtifactManifest,
): TranscriptionRoutingReport | undefined {
  const artifact = artifacts.transcriptionRouting
  if (artifact?.kind !== "metadata" || !isRecord(artifact.data)) {
    return undefined
  }

  const attempts = Array.isArray(artifact.data.attempts)
    ? artifact.data.attempts
        .map(normalizeAttempt)
        .filter((entry): entry is TranscriptionAttempt => entry != null)
    : []

  const sourceInputUrl = sanitizeSourceInputUrl(artifact.data.sourceInputUrl)
  const sourceInputHost =
    normalizeSourceInputHost(artifact.data.sourceInputHost) ??
    normalizeSourceInputHost(sourceInputUrl) ??
    normalizeSourceInputHost(artifact.data.sourceInputUrl)
  const currentAttemptId = readString(artifact.data.currentAttemptId)
  const finalProvider = isResolvedProvider(artifact.data.finalProvider)
    ? artifact.data.finalProvider
    : undefined
  const finalSourceLanguageCode = readString(
    artifact.data.finalSourceLanguageCode,
  )
  const fallbackReason = readString(artifact.data.fallbackReason)
  const diarization = normalizeDiarization(artifact.data.diarization)

  if (
    attempts.length === 0 &&
    !sourceInputUrl &&
    !sourceInputHost &&
    !currentAttemptId &&
    !finalProvider &&
    !finalSourceLanguageCode &&
    !fallbackReason &&
    !diarization
  ) {
    return undefined
  }

  return {
    attempts,
    ...(sourceInputUrl ? { sourceInputUrl } : {}),
    ...(sourceInputHost ? { sourceInputHost } : {}),
    ...(currentAttemptId ? { currentAttemptId } : {}),
    ...(finalProvider ? { finalProvider } : {}),
    ...(finalSourceLanguageCode ? { finalSourceLanguageCode } : {}),
    ...(fallbackReason ? { fallbackReason } : {}),
    ...(diarization ? { diarization } : {}),
  }
}

export function setTranscriptionRoutingReport(
  artifacts: JobArtifactManifest,
  report: TranscriptionRoutingReport,
): JobArtifactManifest {
  const { sourceInputUrl, sourceInputHost, ...safeReport } = report
  const safeSourceInputUrl = sanitizeSourceInputUrl(sourceInputUrl)
  const safeSourceInputHost =
    normalizeSourceInputHost(sourceInputHost) ??
    normalizeSourceInputHost(safeSourceInputUrl) ??
    normalizeSourceInputHost(sourceInputUrl)

  return {
    ...artifacts,
    transcriptionRouting: {
      kind: "metadata",
      data: {
        ...safeReport,
        ...(safeSourceInputUrl ? { sourceInputUrl: safeSourceInputUrl } : {}),
        ...(safeSourceInputHost
          ? { sourceInputHost: safeSourceInputHost }
          : {}),
      } as unknown as Record<string, unknown>,
    },
  }
}

export function appendTranscriptionAttempt(
  report: TranscriptionRoutingReport,
  attempt: TranscriptionAttempt,
): TranscriptionRoutingReport {
  return {
    ...report,
    currentAttemptId: attempt.attemptId,
    attempts: [...report.attempts, attempt],
  }
}

export function updateTranscriptionAttempt(
  report: TranscriptionRoutingReport,
  attemptId: string,
  updater: (attempt: TranscriptionAttempt) => TranscriptionAttempt,
): TranscriptionRoutingReport {
  return {
    ...report,
    attempts: report.attempts.map((attempt) =>
      attempt.attemptId === attemptId ? updater(attempt) : attempt,
    ),
  }
}

export function hasUnresolvedElevenLabsFailure(
  report: TranscriptionRoutingReport | undefined,
): boolean {
  if (!report) {
    return false
  }

  const hasFailedElevenLabsAttempt = report.attempts.some(
    (attempt) =>
      attempt.resolvedProvider === "elevenlabs" && attempt.status === "failed",
  )
  const hasSuccessfulElevenLabsAttempt = report.attempts.some(
    (attempt) =>
      attempt.resolvedProvider === "elevenlabs" &&
      attempt.status === "completed",
  )

  return hasFailedElevenLabsAttempt && !hasSuccessfulElevenLabsAttempt
}

export function getUnresolvedElevenLabsFailureReason(
  report: TranscriptionRoutingReport | undefined,
): string | undefined {
  if (!hasUnresolvedElevenLabsFailure(report)) {
    return undefined
  }

  return (
    report?.attempts.find(
      (attempt) =>
        attempt.resolvedProvider === "elevenlabs" &&
        attempt.status === "failed" &&
        typeof attempt.fallbackReason === "string",
    )?.fallbackReason ?? report?.fallbackReason
  )
}
