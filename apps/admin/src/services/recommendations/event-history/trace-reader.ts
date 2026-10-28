import {
  RecommendationClickHouseError,
  type RecommendationClickHouseClient,
} from "./clickhouse"
import type {
  RecommendationEventEnvelope,
  RecommendationEventFamily,
} from "./envelope"
import { isDeepStrictEqual } from "node:util"
import {
  safeTracePresentation,
  safeTraceProvenance,
  safeTraceSource,
} from "./trace-codec"
import { readDeliveryDiagnostics } from "../delivery-diagnostics"

const REQUEST_FIELDS = new Set([
  "requestId",
  "manifestId",
  "strategyVersion",
  "seedMediaId",
  "locale",
  "result",
  "state",
  "fallbackReason",
  "expectedItemCount",
  "issuedAt",
  "retrievalLatencyMs",
  "responseBytes",
  "experimentAssignmentId",
  "contractVersion",
  "surfaceVersion",
  "classifierVersion",
  "purpose",
  "diagnosticsCoverage",
  "deliveryDiagnostics",
])
const ITEM_FIELDS = new Set([
  "requestId",
  "itemId",
  "position",
  "targetMediaId",
  "candidateGenerator",
  "videoSlug",
  "videoTitle",
  "imageUrl",
  "description",
  "startSeconds",
  "endSeconds",
  "durationSeconds",
  "playbackId",
  "audioLanguageSlug",
  "themes",
  "demographics",
  "spiritualContext",
  "candidateProvenance",
  "presentationCoverage",
  "provenanceCoverage",
])
const PRESENTATION_FIELDS = [
  "videoSlug",
  "videoTitle",
  "imageUrl",
  "description",
  "startSeconds",
  "endSeconds",
  "durationSeconds",
  "playbackId",
  "audioLanguageSlug",
  "themes",
  "demographics",
  "spiritualContext",
] as const
const RUN_FIELDS = new Set([
  "requestId",
  "candidateRunId",
  "kind",
  "purpose",
  "contextVersion",
  "generatorVersion",
  "unionVersion",
  "eligibilityVersion",
  "rankerVersion",
  "composerVersion",
  "candidateEligibilityParity",
  "rankerParity",
  "nominatedCount",
  "canonicalizedCount",
  "deduplicatedCount",
  "rejectedCount",
  "scoredCount",
  "orderedCount",
  "requestedCount",
  "composedCount",
  "shortfallReason",
  "fallbackReason",
  "evidenceComplete",
  "traceCoverage",
])
const STAGE_FIELDS = new Set([
  "requestId",
  "candidateRunId",
  "kind",
  "stage",
  "ordinal",
  "candidateKey",
  "targetMediaId",
  "sourceGenerator",
  "sourceRank",
  "sourceScore",
  "normalizedScore",
  "rrfScore",
  "deterministicScore",
  "finalPosition",
  "reasonCodes",
  "sourceEvidence",
  "traceCoverage",
])

function validPayload(row: RecommendationEventEnvelope): boolean {
  const payload = row.payload
  const allowed =
    row.family === "request"
      ? REQUEST_FIELDS
      : row.family === "served-item"
        ? ITEM_FIELDS
        : payload.kind === "candidate-run"
          ? RUN_FIELDS
          : STAGE_FIELDS
  if (Object.keys(payload).some((key) => !allowed.has(key))) return false
  if (
    row.family === "request" &&
    payload.deliveryDiagnostics !== undefined &&
    readDeliveryDiagnostics(payload.deliveryDiagnostics) === null
  ) {
    const diagnostics = payload.deliveryDiagnostics
    const allowedLegacy = new Set([
      "version",
      "assignedStrategy",
      "actualStrategy",
      "generationId",
      "audioLanguageSlug",
      "coverageGap",
    ])
    if (
      !diagnostics ||
      typeof diagnostics !== "object" ||
      Array.isArray(diagnostics) ||
      Object.entries(diagnostics).some(
        ([key, value]) =>
          !allowedLegacy.has(key) ||
          (value !== null &&
            !["string", "number", "boolean"].includes(typeof value)),
      )
    )
      return false
  }
  if (
    row.family === "served-item" &&
    payload.candidateProvenance !== undefined
  ) {
    const checked = safeTraceProvenance(payload.candidateProvenance)
    if (!isDeepStrictEqual(checked.value, payload.candidateProvenance))
      return false
  }
  if (row.family === "served-item") {
    const presentation = Object.fromEntries(
      PRESENTATION_FIELDS.filter((key) => key in payload).map((key) => [
        key,
        payload[key],
      ]),
    )
    if (
      !isDeepStrictEqual(
        safeTracePresentation(presentation).value,
        presentation,
      )
    )
      return false
  }
  if (
    row.family === "served-item" &&
    ["themes", "demographics", "spiritualContext"].some(
      (key) =>
        payload[key] !== undefined &&
        (!Array.isArray(payload[key]) ||
          (payload[key] as unknown[]).length > 32 ||
          (payload[key] as unknown[]).some(
            (value) => typeof value !== "string" || value.length > 512,
          )),
    )
  )
    return false
  if (row.family === "evidence" && payload.kind === "candidate-stage") {
    if (
      !Array.isArray(payload.reasonCodes) ||
      payload.reasonCodes.length > 16 ||
      payload.reasonCodes.some(
        (code) => typeof code !== "string" || code.length > 64,
      )
    )
      return false
    if (
      !Array.isArray(payload.sourceEvidence) ||
      payload.sourceEvidence.length > 16
    )
      return false
    if (
      payload.sourceEvidence.some(
        (source) =>
          source !== null &&
          !isDeepStrictEqual(safeTraceSource(source).value, source),
      )
    )
      return false
  }
  return true
}

export type OperatorRecommendationTraceHistory = Readonly<{
  status: "complete" | "incomplete"
  missing: string[]
  request: RecommendationEventEnvelope | null
  servedItems: RecommendationEventEnvelope[]
  candidateRun: RecommendationEventEnvelope | null
  stages: RecommendationEventEnvelope[]
}>

type Identity = Readonly<{
  requestId: string
  itemIds: readonly string[]
  runId: string | null
  stageIds: readonly string[]
  stageIdentitiesComplete?: boolean
  asOf: Date
}>

/** Reads only identities obtained from an authorized, unexpired operational root. */
export async function readOperatorRecommendationTrace(
  client: Pick<RecommendationClickHouseClient, "read">,
  input: Identity,
): Promise<OperatorRecommendationTraceHistory> {
  if (
    input.itemIds.length > 16 ||
    input.stageIds.length > 448 ||
    (input.runId === null && input.stageIds.length > 0)
  )
    throw new RecommendationClickHouseError("invalid_input")

  let responseBytes = 0
  // The adapter caps each call separately. A stage manifest can require five
  // evidence batches, so cap the whole operator read as well. The adapter's
  // own 3s abort bounds the single request still in flight after this fires.
  const deadlineAt = Date.now() + 3_500
  const read = async (
    family: RecommendationEventFamily,
    ids: readonly string[],
  ) => {
    const found = new Map<string, RecommendationEventEnvelope>()
    for (let offset = 0; offset < ids.length; offset += 100) {
      const batch = ids.slice(offset, offset + 100)
      const remainingMs = deadlineAt - Date.now()
      if (remainingMs <= 0) throw new RecommendationClickHouseError("timeout")
      let timer: ReturnType<typeof setTimeout> | undefined
      const rows = await Promise.race([
        client.read({ family, logicalIds: batch, asOf: input.asOf }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new RecommendationClickHouseError("timeout")),
            remainingMs,
          )
        }),
      ]).finally(() => clearTimeout(timer))
      for (const row of rows) {
        responseBytes += Buffer.byteLength(JSON.stringify(row))
        if (responseBytes > 8_388_608)
          throw new RecommendationClickHouseError("response")
        if (
          !batch.includes(row.logicalId) ||
          row.family !== family ||
          !validPayload(row) ||
          row.payload.requestId !== input.requestId ||
          (family === "served-item" && row.payload.itemId !== row.logicalId) ||
          (family === "evidence" &&
            (row.payload.kind === "candidate-run"
              ? row.payload.candidateRunId !== row.logicalId
              : row.payload.candidateRunId !== input.runId)) ||
          found.has(row.logicalId)
        )
          throw new RecommendationClickHouseError("response")
        found.set(row.logicalId, row)
      }
    }
    return found
  }

  const request = await read("request", [input.requestId])
  const served = await read("served-item", input.itemIds)
  const evidenceIds = input.runId ? [input.runId, ...input.stageIds] : []
  const evidence = await read("evidence", evidenceIds)
  if (
    input.runId &&
    evidence.get(input.runId)?.payload.kind !== "candidate-run"
  )
    if (evidence.has(input.runId))
      throw new RecommendationClickHouseError("response")
  for (const id of input.stageIds)
    if (
      evidence.get(id) &&
      evidence.get(id)?.payload.kind !== "candidate-stage"
    )
      throw new RecommendationClickHouseError("response")

  const missing = [
    ...(input.stageIdentitiesComplete === false
      ? ["evidence:stage-identities-unavailable"]
      : []),
    ...(!request.has(input.requestId) ? [`request:${input.requestId}`] : []),
    ...input.itemIds
      .filter((id) => !served.has(id))
      .map((id) => `served-item:${id}`),
    ...evidenceIds
      .filter((id) => !evidence.has(id))
      .map((id) => `evidence:${id}`),
  ]
  return {
    status: missing.length ? "incomplete" : "complete",
    missing,
    request: request.get(input.requestId) ?? null,
    servedItems: input.itemIds.flatMap((id) => served.get(id) ?? []),
    candidateRun: input.runId ? (evidence.get(input.runId) ?? null) : null,
    stages: input.stageIds.flatMap((id) => evidence.get(id) ?? []),
  }
}
