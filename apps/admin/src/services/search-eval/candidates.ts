import { createHash } from "node:crypto"

import {
  SearchEvalCandidatePromotionStatus as PrismaPromotionStatus,
  SearchEvalCandidateSource as PrismaCandidateSource,
  type Prisma,
  type PrismaClient,
} from "@prisma/client"

const MAX_QUERY_LENGTH = 512
const MAX_LOCALE_LENGTH = 32
const MAX_GENERATION_MODEL_LENGTH = 128
const MAX_GENERATION_PROVIDER_LENGTH = 64
const MAX_MASTRA_RUN_ID_LENGTH = 128
const MAX_JSON_BYTES = 16 * 1024
const MAX_TRACE_RETENTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const BCP47_REGEX = /^[a-zA-Z]{2,3}(-[A-Za-z0-9]{2,8})*$/

export type SearchEvalCandidateSourceLabel =
  | "catalog"
  | "locale_quality"
  | "trace"

export type StoreSearchEvalCandidateInput = {
  source: SearchEvalCandidateSourceLabel
  locale: string
  queryText: string
  expectedResultHints?: unknown
  sourceAnchors?: unknown
  labelProvenance?: unknown
  generationModel: string
  generationProvider?: string | null
  judgeSummary?: unknown
  mastraRunId?: string | null
  retentionExpiresAt?: Date | string | null
  generatedAt?: Date | string | null
}

export type StoredSearchEvalCandidate = {
  id: string
  dedupeKey: string
  status: "created" | "updated"
}

export type StoreSearchEvalCandidatesResult = {
  storedCount: number
  skippedCount: number
  candidates: StoredSearchEvalCandidate[]
  skipped: Array<{
    dedupeKey: string
    reason: "already_promoted_or_rejected"
  }>
}

export class SearchEvalCandidateStoreError extends Error {
  constructor(
    readonly code: "validation",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "SearchEvalCandidateStoreError"
  }
}

function validation(message: string, cause?: unknown): never {
  throw new SearchEvalCandidateStoreError("validation", message, cause)
}

function normalizeQuery(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length === 0) validation("candidate queryText is required")
  if (normalized.length > MAX_QUERY_LENGTH) {
    validation(`candidate queryText must be at most ${MAX_QUERY_LENGTH} chars`)
  }
  return normalized
}

function normalizeLocale(value: string): string {
  const normalized = value.trim()
  if (
    normalized.length === 0 ||
    normalized.length > MAX_LOCALE_LENGTH ||
    !BCP47_REGEX.test(normalized)
  ) {
    validation("candidate locale must be a safe BCP-47 tag")
  }
  return normalized
}

function normalizeBoundedString(
  value: string | null | undefined,
  max: number,
  name: string,
): string | null {
  if (value == null) return null
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length === 0) return null
  if (normalized.length > max)
    validation(`${name} must be at most ${max} chars`)
  return normalized
}

function parseDate(
  value: Date | string | null | undefined,
  name: string,
): Date | null {
  if (value == null) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) validation(`${name} must be a valid date`)
  return date
}

function jsonBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function toJsonValue(
  value: unknown,
  fallback: unknown,
  name: string,
): Prisma.InputJsonValue {
  const normalized = value === undefined ? fallback : value
  let text: string
  try {
    text = JSON.stringify(normalized)
  } catch (cause) {
    validation(`${name} must be JSON serializable`, cause)
  }
  if (text === undefined) validation(`${name} must be JSON serializable`)
  if (jsonBytes(text) > MAX_JSON_BYTES) {
    validation(`${name} must serialize to at most ${MAX_JSON_BYTES} bytes`)
  }
  return JSON.parse(text) as Prisma.InputJsonValue
}

function toJsonArray(
  value: unknown,
  fallback: unknown[],
  name: string,
): Prisma.InputJsonValue {
  const normalized = value === undefined ? fallback : value
  if (!Array.isArray(normalized)) validation(`${name} must be an array`)
  return toJsonValue(normalized, fallback, name)
}

function toJsonObject(
  value: unknown,
  fallback: Record<string, unknown>,
  name: string,
): Prisma.InputJsonValue {
  const normalized = value === undefined ? fallback : value
  if (
    normalized == null ||
    typeof normalized !== "object" ||
    Array.isArray(normalized)
  ) {
    validation(`${name} must be an object`)
  }
  return toJsonValue(normalized, fallback, name)
}

function toPrismaSource(
  source: SearchEvalCandidateSourceLabel,
): PrismaCandidateSource {
  if (source === "catalog") return PrismaCandidateSource.CATALOG
  if (source === "locale_quality") {
    return PrismaCandidateSource.LOCALE_QUALITY
  }
  if (source === "trace") return PrismaCandidateSource.TRACE
  validation("candidate source is unsupported")
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`
  }
  if (value != null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function dedupeKeyFor(input: {
  source: SearchEvalCandidateSourceLabel
  locale: string
  queryText: string
  sourceAnchors: Prisma.InputJsonValue
}): string {
  return createHash("sha256")
    .update(input.source)
    .update("\0")
    .update(input.locale.toLowerCase())
    .update("\0")
    .update(input.queryText.toLowerCase())
    .update("\0")
    .update(stableJson(input.sourceAnchors))
    .digest("hex")
}

function prepareCandidate(
  input: StoreSearchEvalCandidateInput,
  now: Date,
): Prisma.SearchEvalCandidateCreateInput {
  const source = toPrismaSource(input.source)
  const locale = normalizeLocale(input.locale)
  const queryText = normalizeQuery(input.queryText)
  const generationModel =
    normalizeBoundedString(
      input.generationModel,
      MAX_GENERATION_MODEL_LENGTH,
      "generationModel",
    ) ?? validation("candidate generationModel is required")
  const generationProvider = normalizeBoundedString(
    input.generationProvider,
    MAX_GENERATION_PROVIDER_LENGTH,
    "generationProvider",
  )
  const mastraRunId = normalizeBoundedString(
    input.mastraRunId,
    MAX_MASTRA_RUN_ID_LENGTH,
    "mastraRunId",
  )
  const expectedResultHints = toJsonArray(
    input.expectedResultHints,
    [],
    "expectedResultHints",
  )
  const sourceAnchors = toJsonArray(input.sourceAnchors, [], "sourceAnchors")
  const labelProvenance = toJsonObject(
    input.labelProvenance,
    {},
    "labelProvenance",
  )
  const judgeSummary =
    input.judgeSummary == null
      ? undefined
      : toJsonObject(input.judgeSummary, {}, "judgeSummary")
  const generatedAt = parseDate(input.generatedAt, "generatedAt") ?? now
  const retentionExpiresAt = parseDate(
    input.retentionExpiresAt,
    "retentionExpiresAt",
  )

  if (source === PrismaCandidateSource.TRACE) {
    if (retentionExpiresAt == null) {
      validation("trace candidates require retentionExpiresAt")
    }
    if (retentionExpiresAt <= now) {
      validation("trace candidate retentionExpiresAt must be in the future")
    }
    if (
      retentionExpiresAt.getTime() - now.getTime() >
      MAX_TRACE_RETENTION_WINDOW_MS
    ) {
      validation("trace candidate retentionExpiresAt exceeds raw trace policy")
    }
  }

  if (source !== PrismaCandidateSource.TRACE && retentionExpiresAt != null) {
    validation("only trace candidates may set retentionExpiresAt")
  }

  const dedupeKey = dedupeKeyFor({
    source: input.source,
    locale,
    queryText,
    sourceAnchors,
  })

  return {
    source,
    locale,
    queryText,
    expectedResultHints,
    sourceAnchors,
    labelProvenance,
    generationModel,
    generationProvider,
    judgeSummary,
    promotionStatus: PrismaPromotionStatus.GENERATED,
    mastraRunId,
    dedupeKey,
    retentionExpiresAt,
    generatedAt,
  }
}

function updateDataFor(
  data: Prisma.SearchEvalCandidateCreateInput,
): Prisma.SearchEvalCandidateUpdateInput {
  return {
    expectedResultHints: data.expectedResultHints,
    sourceAnchors: data.sourceAnchors,
    labelProvenance: data.labelProvenance,
    generationModel: data.generationModel,
    generationProvider: data.generationProvider,
    judgeSummary: data.judgeSummary,
    mastraRunId: data.mastraRunId,
    retentionExpiresAt: data.retentionExpiresAt,
    generatedAt: data.generatedAt,
  }
}

export async function storeSearchEvalCandidates(
  prisma: PrismaClient,
  candidates: readonly StoreSearchEvalCandidateInput[],
  now: Date = new Date(),
): Promise<StoreSearchEvalCandidatesResult> {
  if (candidates.length === 0) {
    return { storedCount: 0, skippedCount: 0, candidates: [], skipped: [] }
  }
  if (candidates.length > 100) {
    validation("candidate batch must contain at most 100 candidates")
  }

  const stored: StoredSearchEvalCandidate[] = []
  const skipped: StoreSearchEvalCandidatesResult["skipped"] = []

  for (const input of candidates) {
    const data = prepareCandidate(input, now)
    const existing = await prisma.searchEvalCandidate.findUnique({
      where: { dedupeKey: data.dedupeKey },
      select: { id: true, promotionStatus: true },
    })

    if (
      existing &&
      existing.promotionStatus !== PrismaPromotionStatus.GENERATED
    ) {
      skipped.push({
        dedupeKey: data.dedupeKey,
        reason: "already_promoted_or_rejected",
      })
      continue
    }

    const row = await prisma.searchEvalCandidate.upsert({
      where: { dedupeKey: data.dedupeKey },
      create: data,
      update: updateDataFor(data),
      select: { id: true, dedupeKey: true },
    })
    stored.push({
      id: row.id,
      dedupeKey: row.dedupeKey,
      status: existing ? "updated" : "created",
    })
  }

  return {
    storedCount: stored.length,
    skippedCount: skipped.length,
    candidates: stored,
    skipped,
  }
}

export const _internal = {
  dedupeKeyFor,
  normalizeLocale,
  normalizeQuery,
  prepareCandidate,
}
