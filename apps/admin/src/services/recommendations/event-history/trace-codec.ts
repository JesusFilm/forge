import { readDeliveryDiagnostics } from "../delivery-diagnostics"
import {
  RecommendationInputError,
  RecommendationInternalStateError,
} from "../errors"
import { servedSnapshotValue } from "../served-item-payload"
import type { Prisma } from "@prisma/client"
import { recommendationHistoryEvent } from "./producers"
import type { RecommendationEventEnvelope } from "./envelope"

type RequestRow = Readonly<{
  id: string
  manifestId: string
  strategyVersion: string
  seedMediaId: string | null
  locale: string
  result: string
  state: string
  fallbackReason: string | null
  expectedItemCount: number
  retrievalLatencyMs: number | null
  responseBytes: number | null
  experimentAssignmentId: string | null
  createdAt: Date
  issuedAt: Date | null
  expiresAt: Date
  servedItemPayload?: unknown
  deliveryDiagnostics?: unknown
  contractVersion?: string
  surfaceVersion?: string
  classifierVersion?: string
  purpose?: string
}>

type ItemRow = Readonly<{
  id: string
  requestId: string
  position: number
  targetMediaId: string
  candidateGenerator: string
  presentation: unknown
  candidateProvenance: unknown
  expiresAt: Date
}>

type RunRow = Readonly<{
  id: string
  requestId: string
  createdAt: Date
  expiresAt: Date
  purpose: string
  contextVersion: string
  generatorVersion: string
  unionVersion: string
  eligibilityVersion: string
  rankerVersion: string
  composerVersion: string
  candidateEligibilityParity: string
  rankerParity: string
  nominatedCount: number
  canonicalizedCount: number
  deduplicatedCount: number
  rejectedCount: number
  scoredCount: number
  orderedCount: number
  requestedCount: number
  composedCount: number
  shortfallReason: string | null
  evidenceComplete: boolean
  fallbackReason: string | null
  tracePayload?: unknown
}>

type StageRow = Readonly<{
  id: string
  runId: string
  stage: string
  ordinal: number
  candidateKey: string
  targetMediaId?: string | null
  sourceGenerator?: string | null
  sourceRank?: number | null
  sourceScore?: number | null
  normalizedScore?: number | null
  rrfScore?: number | null
  deterministicScore?: number | null
  finalPosition?: number | null
  reasonCodes: readonly string[]
  sourceEvidence: unknown
  createdAt: Date
  expiresAt: Date
}>

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function safeScalar(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "string" && value.length <= 2048) ||
    (typeof value === "number" && Number.isFinite(value))
  )
}

function selectScalars(value: unknown, keys: readonly string[]) {
  const source = record(value)
  const selected: Record<string, string | number | boolean | null> = {}
  let redacted = !source
  if (!source) return { selected, redacted }
  for (const [key, item] of Object.entries(source)) {
    // Prisma/JSONB omits undefined object values at commit.
    if (item === undefined) continue
    if (!keys.includes(key) || !safeScalar(item)) {
      redacted = true
      continue
    }
    selected[key] = item
  }
  return { selected, redacted }
}

const sourceKeys: Record<string, readonly string[]> = {
  semantic: ["sceneIndex", "similarity"],
  curated: ["poolVersion", "poolKey", "editorialRank", "similarity"],
  "multi-interest-profile": [
    "interestOrdinal",
    "interestKind",
    "interestRank",
    "projectionVersion",
    "manifestId",
  ],
  "directional-cowatch": [
    "featureVersion",
    "generation",
    "support",
    "confidence",
    "lift",
    "recencyWeight",
    "qualityWeight",
    "contamination",
    "anchorMediaId",
    "anchorKind",
    "anchorWeight",
    "interestOrdinal",
  ],
  "live-baseline": ["livePosition", "liveManifestId"],
  "mmr-composition-inputs": [
    "version",
    "missingSource",
    "missingInterest",
    "missingTheme",
    "missingHistory",
    "candidateCount",
    "selectedCount",
    "themedSelectedCount",
  ],
}

export function safeTraceSource(value: unknown) {
  const source = record(value)
  if (!source) return { value: null, redacted: true }
  const generator = source.generator
  const allowed =
    typeof generator === "string" ? sourceKeys[generator] : undefined
  const { selected: evidence, redacted: evidenceRedacted } = selectScalars(
    source.evidence,
    allowed ?? [],
  )
  const fields = selectScalars(source, [
    "generator",
    "generatorVersion",
    "rank",
    "score",
    "sourceRank",
    "sourceScore",
    "rejectionReason",
  ])
  const selected = fields.selected
  // The nested evidence map was reviewed separately; it is not an arbitrary JSON passthrough.
  return {
    value: { ...selected, evidence },
    redacted:
      evidenceRedacted ||
      !allowed ||
      Object.keys(source).some(
        (key) =>
          source[key] !== undefined &&
          key !== "evidence" &&
          !Object.hasOwn(selected, key),
      ),
  }
}

function safeSources(value: unknown) {
  if (!Array.isArray(value)) return { values: [], redacted: true }
  const bounded = value.slice(0, 16).map(safeTraceSource)
  return {
    values: bounded.map((source) => source.value),
    redacted: value.length > 16 || bounded.some((source) => source.redacted),
  }
}

export function safeTracePresentation(input: unknown) {
  const source = record(input)
  if (!source) return { value: {}, redacted: true }
  const scalarKeys = [
    "videoSlug",
    "videoTitle",
    "imageUrl",
    "description",
    "startSeconds",
    "endSeconds",
    "durationSeconds",
    "playbackId",
    "audioLanguageSlug",
  ]
  const selected = selectScalars(source, scalarKeys)
  const value: Record<string, unknown> = { ...selected.selected }
  const arrayKeys = ["themes", "demographics", "spiritualContext"]
  let redacted =
    Object.keys(source).some(
      (key) => !scalarKeys.includes(key) && !arrayKeys.includes(key),
    ) || scalarKeys.some((key) => key in source && !safeScalar(source[key]))
  for (const key of arrayKeys) {
    const field = source[key]
    if (
      Array.isArray(field) &&
      field.length <= 32 &&
      field.every((item) => typeof item === "string" && item.length <= 512)
    )
      value[key] = field
    else if (field !== undefined) redacted = true
  }
  if (typeof value.imageUrl === "string") {
    try {
      const url = new URL(value.imageUrl)
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        [...url.searchParams.keys()].some((key) =>
          /token|secret|key|signature|auth|session|user/i.test(key),
        )
      ) {
        delete value.imageUrl
        redacted = true
      }
    } catch {
      delete value.imageUrl
      redacted = true
    }
  }
  return { value, redacted }
}

export function safeTraceProvenance(value: unknown) {
  const source = record(value)
  if (!source) return { value: {}, redacted: true }
  const scalarKeys = [
    "sceneIndex",
    "similarity",
    "normalizedSemanticScore",
    "rrfBenchmark",
    "deterministicScore",
    "deterministicRankerVersion",
    "eligibilityVersion",
    "composerVersion",
    "generationId",
    "kind",
    "rank",
    "viewingMode",
  ]
  const selected = selectScalars(source, scalarKeys)
  const sources =
    source.sources === undefined
      ? { values: [], redacted: false }
      : safeSources(source.sources)
  const redacted =
    Object.keys(source).some(
      (key) => key !== "sources" && !scalarKeys.includes(key),
    ) ||
    scalarKeys.some((key) => key in source && !safeScalar(source[key])) ||
    sources.redacted
  return {
    value: {
      ...selected.selected,
      ...(source.sources === undefined ? {} : { sources: sources.values }),
    },
    redacted,
  }
}

export function requestHistoryEvent(
  row: RequestRow,
): RecommendationEventEnvelope {
  let diagnostics: Record<string, unknown> | null =
    row.deliveryDiagnostics == null
      ? null
      : readDeliveryDiagnostics(row.deliveryDiagnostics)
  if (
    !diagnostics &&
    record(row.deliveryDiagnostics)?.assignedStrategy !== undefined
  ) {
    const allowed = [
      "version",
      "assignedStrategy",
      "actualStrategy",
      "generationId",
      "audioLanguageSlug",
      "coverageGap",
    ]
    const selected = selectScalars(row.deliveryDiagnostics, allowed)
    if (!selected.redacted) diagnostics = selected.selected
  }
  return recommendationHistoryEvent({
    family: "request",
    logicalId: row.id,
    revision: 1,
    occurredAt: row.createdAt,
    acceptedAt: row.createdAt,
    expiresAt: row.expiresAt,
    payload: {
      requestId: row.id,
      manifestId: row.manifestId,
      strategyVersion: row.strategyVersion,
      seedMediaId: row.seedMediaId,
      locale: row.locale,
      result: row.result,
      state: row.state,
      fallbackReason: row.fallbackReason,
      expectedItemCount: row.expectedItemCount,
      issuedAt: row.issuedAt?.toISOString() ?? null,
      retrievalLatencyMs: row.retrievalLatencyMs,
      responseBytes: row.responseBytes,
      experimentAssignmentId: row.experimentAssignmentId,
      ...(row.contractVersion === undefined
        ? {}
        : { contractVersion: row.contractVersion }),
      ...(row.surfaceVersion === undefined
        ? {}
        : { surfaceVersion: row.surfaceVersion }),
      ...(row.classifierVersion === undefined
        ? {}
        : { classifierVersion: row.classifierVersion }),
      ...(row.purpose === undefined ? {} : { purpose: row.purpose }),
      diagnosticsCoverage:
        row.deliveryDiagnostics == null
          ? "absent"
          : diagnostics
            ? "complete"
            : "redacted",
      ...(diagnostics ? { deliveryDiagnostics: diagnostics } : {}),
    },
  })
}

export function servedItemHistoryEvent(
  request: RequestRow,
  item: ItemRow,
): RecommendationEventEnvelope {
  const hydrated = servedSnapshotValue(
    (request.servedItemPayload ?? null) as Prisma.JsonValue | null,
    item as ItemRow & {
      presentation: Prisma.JsonValue
      candidateProvenance: Prisma.JsonValue
    },
  )
  const presentation = safeTracePresentation(hydrated.presentation)
  const provenance = safeTraceProvenance(hydrated.candidateProvenance)
  return recommendationHistoryEvent({
    family: "served-item",
    logicalId: item.id,
    revision: 1,
    occurredAt: request.createdAt,
    acceptedAt: request.createdAt,
    expiresAt: item.expiresAt,
    payload: {
      requestId: item.requestId,
      itemId: item.id,
      position: item.position,
      targetMediaId: item.targetMediaId,
      candidateGenerator: item.candidateGenerator,
      ...presentation.value,
      candidateProvenance: provenance.value,
      presentationCoverage: presentation.redacted ? "redacted" : "complete",
      provenanceCoverage: provenance.redacted ? "redacted" : "complete",
    },
  })
}

export function servedItemHistoryEvents(
  request: RequestRow,
  items: readonly ItemRow[],
): RecommendationEventEnvelope[] {
  return [...items]
    .sort(
      (a, b) =>
        a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .map((item) => servedItemHistoryEvent(request, item))
}

export function candidateRunHistoryEvent(
  run: RunRow,
): RecommendationEventEnvelope {
  return recommendationHistoryEvent({
    family: "evidence",
    logicalId: run.id,
    revision: 1,
    occurredAt: run.createdAt,
    acceptedAt: run.createdAt,
    expiresAt: run.expiresAt,
    payload: {
      requestId: run.requestId,
      candidateRunId: run.id,
      kind: "candidate-run",
      purpose: run.purpose,
      contextVersion: run.contextVersion,
      generatorVersion: run.generatorVersion,
      unionVersion: run.unionVersion,
      eligibilityVersion: run.eligibilityVersion,
      rankerVersion: run.rankerVersion,
      composerVersion: run.composerVersion,
      candidateEligibilityParity: run.candidateEligibilityParity,
      rankerParity: run.rankerParity,
      nominatedCount: run.nominatedCount,
      canonicalizedCount: run.canonicalizedCount,
      deduplicatedCount: run.deduplicatedCount,
      rejectedCount: run.rejectedCount,
      scoredCount: run.scoredCount,
      orderedCount: run.orderedCount,
      requestedCount: run.requestedCount,
      composedCount: run.composedCount,
      shortfallReason: run.shortfallReason,
      fallbackReason: run.fallbackReason,
      evidenceComplete: run.evidenceComplete,
      traceCoverage: "redacted",
    },
  })
}

export function stageHistoryEvent(
  requestId: string,
  row: StageRow,
): RecommendationEventEnvelope {
  const sources = safeSources(row.sourceEvidence)
  const safeKey =
    (row.candidateKey === row.targetMediaId &&
      row.candidateKey.length <= 191) ||
    /^(?:semantic|curated|multi-interest|cowatch|cowatch-live|live-baseline|candidate-platform|mmr)[A-Za-z0-9:_./-]{0,190}$/.test(
      row.candidateKey,
    )
  return recommendationHistoryEvent({
    family: "evidence",
    logicalId: row.id,
    revision: 1,
    occurredAt: row.createdAt,
    acceptedAt: row.createdAt,
    expiresAt: row.expiresAt,
    payload: {
      requestId,
      candidateRunId: row.runId,
      kind: "candidate-stage",
      stage: row.stage,
      ordinal: row.ordinal,
      candidateKey: safeKey ? row.candidateKey : null,
      targetMediaId: row.targetMediaId ?? null,
      sourceGenerator: row.sourceGenerator ?? null,
      sourceRank: row.sourceRank ?? null,
      sourceScore: row.sourceScore ?? null,
      normalizedScore: row.normalizedScore ?? null,
      rrfScore: row.rrfScore ?? null,
      deterministicScore: row.deterministicScore ?? null,
      finalPosition: row.finalPosition ?? null,
      reasonCodes: row.reasonCodes.slice(0, 16),
      sourceEvidence: sources.values,
      traceCoverage:
        sources.redacted || !safeKey || row.reasonCodes.length > 16
          ? "redacted"
          : "complete",
    },
  })
}

export function storedCandidateStageRows(
  run: RunRow,
  legacyRows: readonly StageRow[],
): StageRow[] {
  if (run.tracePayload == null) {
    if (legacyRows.length > 448)
      throw new RecommendationInternalStateError("history_stage_limit")
    return [...legacyRows]
  }
  const payload = record(run.tracePayload)
  if (!payload || !Array.isArray(payload.stages) || payload.stages.length > 448)
    throw new RecommendationInternalStateError("history_packed_trace_invalid")
  return payload.stages.map((value) => {
    const stage = record(value)
    if (!stage || typeof stage.createdAt !== "string")
      throw new RecommendationInternalStateError("history_packed_stage_invalid")
    const createdAt = new Date(stage.createdAt)
    if (Number.isNaN(createdAt.getTime()))
      throw new RecommendationInternalStateError(
        "history_packed_stage_time_invalid",
      )
    return {
      ...stage,
      runId: run.id,
      createdAt,
      expiresAt: run.expiresAt,
    } as StageRow
  })
}

type PageRecord = Readonly<{
  request: RequestRow
  items: readonly ItemRow[]
  run: RunRow | null
  stages: readonly StageRow[]
}>

/** Pure bounded page encoder; migration owns checkpointing and transport. */
export function encodeRecommendationHistoryPage(
  records: readonly PageRecord[],
): RecommendationEventEnvelope[] {
  if (records.length > 256)
    throw new RecommendationInputError(
      "Recommendation history page exceeds limit",
    )
  const events: RecommendationEventEnvelope[] = []
  let bytes = 0
  const append = (event: RecommendationEventEnvelope) => {
    events.push(event)
    bytes += Buffer.byteLength(JSON.stringify(event))
    if (events.length > 256 || bytes > 1_048_576)
      throw new RecommendationInputError(
        "Recommendation history page exceeds limit",
      )
  }
  for (const record of records) {
    append(requestHistoryEvent(record.request))
    for (const item of servedItemHistoryEvents(record.request, record.items))
      append(item)
    if (record.run) append(candidateRunHistoryEvent(record.run))
    for (const stage of record.stages)
      append(stageHistoryEvent(record.request.id, stage))
  }
  return events
}
