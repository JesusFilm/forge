const MAX_AGGREGATE_GROUPS = 50
const MAX_METRICS_PER_GROUP = 100
const MAX_PROVIDER_CALLS = 200

type PresentedMetricGroup = {
  key: string
  sampleCount: number
  metrics: Array<{ label: string; value: string }>
}

type PresentedProviderCall = {
  caseId: string
  targetLanguageId: string
  leaseGeneration: number
  callSequence: number
  operation: string
  operationAttempt: number
  status: string
  requestDigest: string
  providerRequestId: string | null
  providerResponseId: string | null
  requestedModel: string
  resolvedModel: string | null
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function boundedText(value: unknown, maximum = 191): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum
    ? value
    : null
}

function nonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null
}

function metricLabel(metric: string): string {
  return metric
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\bIo U\b/g, "IoU")
    .replace(/\bIou\b/gi, "IoU")
}

export function presentAggregateMetrics(
  value: unknown,
): PresentedMetricGroup[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_AGGREGATE_GROUPS).flatMap((candidate) => {
    const group = record(candidate)
    const key = boundedText(group?.key)
    const sampleCount = nonnegativeInteger(group?.sampleCount)
    if (!group || !key || sampleCount == null || sampleCount < 1) return []
    const rawMetrics = Array.isArray(group.metrics) ? group.metrics : []
    const metrics = rawMetrics
      .slice(0, MAX_METRICS_PER_GROUP)
      .flatMap((rawMetric) => {
        const metric = record(rawMetric)
        const name = boundedText(metric?.metric)
        const mean = metric?.mean
        if (!name || typeof mean !== "number" || !Number.isFinite(mean)) {
          return []
        }
        return [{ label: metricLabel(name), value: mean.toFixed(3) }]
      })
    return [{ key, sampleCount, metrics }]
  })
}

export function presentProviderEvidence(value: unknown): {
  requestedProvider: string
  requestedModel: string
  calls: PresentedProviderCall[]
  omittedCallCount: number
} {
  const root = record(value)
  const requestedProvider =
    boundedText(root?.requestedProvider) ?? "Not recorded"
  const requestedModel = boundedText(root?.requestedModel) ?? "Not recorded"
  const cells = Array.isArray(root?.cells) ? root.cells.slice(0, 20) : []
  const calls: PresentedProviderCall[] = []
  let totalCallCount = 0

  for (const rawCell of cells) {
    const cell = record(rawCell)
    const caseId = boundedText(cell?.caseId)
    const targetLanguageId = boundedText(cell?.targetLanguageId)
    const rawCalls = Array.isArray(cell?.calls) ? cell.calls : []
    totalCallCount += rawCalls.length
    if (!caseId || !targetLanguageId) continue
    for (const rawCall of rawCalls) {
      if (calls.length >= MAX_PROVIDER_CALLS) break
      const call = record(rawCall)
      const leaseGeneration = nonnegativeInteger(call?.leaseGeneration)
      const callSequence = nonnegativeInteger(call?.callSequence)
      const operationAttempt = nonnegativeInteger(call?.operationAttempt)
      const operation = boundedText(call?.operation)
      const status = boundedText(call?.status)
      const requestDigest = boundedText(call?.requestDigest)
      const callRequestedModel = boundedText(call?.requestedModel)
      if (
        !call ||
        leaseGeneration == null ||
        callSequence == null ||
        operationAttempt == null ||
        !operation ||
        !status ||
        !requestDigest ||
        !callRequestedModel
      ) {
        continue
      }
      calls.push({
        caseId,
        targetLanguageId,
        leaseGeneration,
        callSequence,
        operation,
        operationAttempt,
        status,
        requestDigest,
        providerRequestId: boundedText(call.providerRequestId),
        providerResponseId: boundedText(call.providerResponseId),
        requestedModel: callRequestedModel,
        resolvedModel: boundedText(call.resolvedModel),
      })
    }
  }

  return {
    requestedProvider,
    requestedModel,
    calls,
    omittedCallCount: Math.max(0, totalCallCount - calls.length),
  }
}

function boundedArrayCount(value: unknown): number {
  return Array.isArray(value) ? Math.min(value.length, 10_000) : 0
}

export function comparisonEvidenceWarnings(input: {
  coverageLabel: string
  matchedCellCount: number
  matchedCollectionCount: number
  unmatchedCells: unknown
  identityDifferences: unknown
}): string[] {
  const warnings: string[] = []
  if (
    input.coverageLabel === "INSUFFICIENT_EVIDENCE" ||
    input.matchedCellCount < 5 ||
    input.matchedCollectionCount < 3
  ) {
    warnings.push(
      "Insufficient evidence: fewer than 5 matched cells or 3 collections.",
    )
  }
  const unmatchedCount = boundedArrayCount(input.unmatchedCells)
  if (unmatchedCount > 0) {
    warnings.push(
      `${unmatchedCount} unmatched cell${unmatchedCount === 1 ? " is" : "s are"} excluded from every aggregate delta.`,
    )
  }
  if (boundedArrayCount(input.identityDifferences) > 0) {
    warnings.push(
      "Other run identities differ; this pair cannot isolate the declared axis.",
    )
  }
  warnings.push(
    "Deltas are descriptive and do not establish causality or generalize beyond this corpus.",
  )
  return warnings
}

export function formatSubtitleLabDate(value: string | null): string {
  if (!value) return "Not completed"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Invalid date"
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}
