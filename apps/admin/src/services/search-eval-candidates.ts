import { createHash } from "node:crypto"

import {
  SearchEvalCandidateSanitizationStatus as PrismaSanitizationStatus,
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
const MAX_REVIEWER_IDENTITY_LENGTH = 256
const MAX_REVIEW_NOTES_LENGTH = 2048
const MAX_JSON_BYTES = 16 * 1024
const MAX_TRACE_RETENTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const BCP47_REGEX = /^[a-zA-Z]{2,3}(-[A-Za-z0-9]{2,8})*$/

export type SearchEvalCandidateSourceLabel =
  | "catalog"
  | "locale_quality"
  | "trace"
  | "seed"
  | "user_submitted"

export type SearchEvalCandidatePromotionStatusLabel =
  | "generated"
  | "rejected"
  | "promoted"
  | "archived"

export type SearchEvalCandidateSanitizationStatusLabel =
  | "pending"
  | "sanitized"
  | "unsafe"

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

export type ListSearchEvalCandidatesFilters = {
  sources?: SearchEvalCandidateSourceLabel[]
  statuses?: SearchEvalCandidatePromotionStatusLabel[]
  locales?: string[]
  mastraRunId?: string | null
  limit?: number
  now?: Date
}

export type ListedSearchEvalCandidate = {
  id: string
  source: SearchEvalCandidateSourceLabel
  promotionStatus: SearchEvalCandidatePromotionStatusLabel
  locale: string
  queryText: string | null
  expectedResultHints: unknown
  sourceAnchors: unknown
  labelProvenance: unknown
  generationModel: string
  generationProvider: string | null
  judgeSummary: unknown | null
  sanitizedQueryText: string | null
  sanitizedExpectedResultNotes: string | null
  sanitizedSourceAnchors: unknown
  sanitizationStatus: SearchEvalCandidateSanitizationStatusLabel
  reviewerIdentity: string | null
  reviewedAt: string | null
  reviewNotes: string | null
  promotedAt: string | null
  promotionRunContext: unknown
  mastraRunId: string | null
  retentionExpiresAt: string | null
  generatedAt: string
  createdAt: string
}

export type UpdateSearchEvalCandidateReviewInput = {
  reviewerIdentity?: string | null
  sanitizedQueryText?: string | null
  sanitizedExpectedResultNotes?: string | null
  sanitizedSourceAnchors?: unknown
  sanitizationStatus?: SearchEvalCandidateSanitizationStatusLabel
  reviewNotes?: string | null
  promotionRunContext?: unknown
}

export type SearchEvalCandidateDecisionInput = {
  reviewerIdentity: string
  reviewNotes?: string | null
  promotionRunContext?: unknown
}

export type PromoteSearchEvalCandidateInput =
  SearchEvalCandidateDecisionInput & {
    sanitizedQueryText?: string | null
    sanitizedExpectedResultNotes?: string | null
    sanitizedSourceAnchors?: unknown
    sanitizationStatus?: SearchEvalCandidateSanitizationStatusLabel
  }

const REDACTED_TRACE_LABEL_PROVENANCE = {
  source: "trace",
  redacted: true,
} as const

export class SearchEvalCandidateStoreError extends Error {
  constructor(
    readonly code: "validation" | "not_found" | "invalid_state",
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

function notFound(id: string): never {
  throw new SearchEvalCandidateStoreError(
    "not_found",
    `search eval candidate ${id} was not found`,
  )
}

function invalidState(message: string): never {
  throw new SearchEvalCandidateStoreError("invalid_state", message)
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

function normalizeRequiredBoundedString(
  value: string | null | undefined,
  max: number,
  name: string,
): string {
  return (
    normalizeBoundedString(value, max, name) ??
    validation(`${name} is required`)
  )
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
  if (source === "seed") return PrismaCandidateSource.SEED
  if (source === "user_submitted") return PrismaCandidateSource.USER_SUBMITTED
  validation("candidate source is unsupported")
}

function toPrismaStatus(
  status: SearchEvalCandidatePromotionStatusLabel,
): PrismaPromotionStatus {
  if (status === "generated") return PrismaPromotionStatus.GENERATED
  if (status === "rejected") return PrismaPromotionStatus.REJECTED
  if (status === "promoted") return PrismaPromotionStatus.PROMOTED
  if (status === "archived") return PrismaPromotionStatus.ARCHIVED
  validation("candidate status is unsupported")
}

function toPrismaSanitizationStatus(
  status: SearchEvalCandidateSanitizationStatusLabel,
): PrismaSanitizationStatus {
  if (status === "pending") return PrismaSanitizationStatus.PENDING
  if (status === "sanitized") return PrismaSanitizationStatus.SANITIZED
  if (status === "unsafe") return PrismaSanitizationStatus.UNSAFE
  validation("candidate sanitizationStatus is unsupported")
}

function hasTraceMarker(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasTraceMarker)
  if (value == null || typeof value !== "object") return false
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (
      (key === "type" || key === "source") &&
      typeof entry === "string" &&
      /^(trace|trace-sample|admin_trace_labels)$/i.test(entry)
    ) {
      return true
    }
    if (
      key === "queryLabelSource" ||
      key === "queryQualityLabel" ||
      key === "sensitiveQueryLabel" ||
      key === "abuseLabel" ||
      key === "queryLabeledAt" ||
      key === "llmLabelSource" ||
      key === "llmLabelVersion" ||
      key === "llmLabeledAt"
    ) {
      return true
    }
    if (hasTraceMarker(entry)) return true
  }
  return false
}

function isTraceDerivedCandidate(
  input: StoreSearchEvalCandidateInput,
): boolean {
  return (
    input.source === "trace" ||
    /(^|[-_:])trace($|[-_:])|admin[-_:]trace/i.test(input.generationModel) ||
    hasTraceMarker(input.sourceAnchors) ||
    hasTraceMarker(input.labelProvenance)
  )
}

function fromPrismaSource(
  source: PrismaCandidateSource,
): SearchEvalCandidateSourceLabel {
  if (source === PrismaCandidateSource.CATALOG) return "catalog"
  if (source === PrismaCandidateSource.LOCALE_QUALITY) return "locale_quality"
  if (source === PrismaCandidateSource.TRACE) return "trace"
  if (source === PrismaCandidateSource.SEED) return "seed"
  return "user_submitted"
}

function fromPrismaStatus(
  status: PrismaPromotionStatus,
): SearchEvalCandidatePromotionStatusLabel {
  if (status === PrismaPromotionStatus.GENERATED) return "generated"
  if (status === PrismaPromotionStatus.REJECTED) return "rejected"
  if (status === PrismaPromotionStatus.PROMOTED) return "promoted"
  return "archived"
}

function fromPrismaSanitizationStatus(
  status: PrismaSanitizationStatus,
): SearchEvalCandidateSanitizationStatusLabel {
  if (status === PrismaSanitizationStatus.SANITIZED) return "sanitized"
  if (status === PrismaSanitizationStatus.UNSAFE) return "unsafe"
  return "pending"
}

function shouldRedactCandidateRow(row: {
  source: PrismaCandidateSource
  generationModel: string
  sourceAnchors: unknown
  labelProvenance: unknown
}): boolean {
  return (
    row.source === PrismaCandidateSource.TRACE ||
    /(^|[-_:])trace($|[-_:])|admin[-_:]trace/i.test(row.generationModel) ||
    hasTraceMarker(row.sourceAnchors) ||
    hasTraceMarker(row.labelProvenance)
  )
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

  if (
    source !== PrismaCandidateSource.TRACE &&
    isTraceDerivedCandidate(input)
  ) {
    validation("trace-derived candidates must use source trace")
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
): Prisma.SearchEvalCandidateUpdateManyMutationInput {
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

    if (existing) {
      const updated = await prisma.searchEvalCandidate.updateMany({
        where: {
          id: existing.id,
          promotionStatus: PrismaPromotionStatus.GENERATED,
        },
        data: updateDataFor(data),
      })
      if (updated.count === 0) {
        skipped.push({
          dedupeKey: data.dedupeKey,
          reason: "already_promoted_or_rejected",
        })
        continue
      }
      stored.push({
        id: existing.id,
        dedupeKey: data.dedupeKey,
        status: "updated",
      })
      continue
    }

    const row = await prisma.searchEvalCandidate.create({
      data,
      select: { id: true, dedupeKey: true },
    })
    stored.push({
      id: row.id,
      dedupeKey: row.dedupeKey,
      status: "created",
    })
  }

  return {
    storedCount: stored.length,
    skippedCount: skipped.length,
    candidates: stored,
    skipped,
  }
}

export async function listSearchEvalCandidates(
  prisma: PrismaClient,
  filters: ListSearchEvalCandidatesFilters = {},
): Promise<ListedSearchEvalCandidate[]> {
  const limit = filters.limit ?? 50
  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    validation("candidate list limit must be between 1 and 100")
  }

  const sources =
    filters.sources == null
      ? undefined
      : filters.sources.map((source) => toPrismaSource(source))
  const statuses =
    filters.statuses == null
      ? [PrismaPromotionStatus.GENERATED]
      : filters.statuses.map((status) => toPrismaStatus(status))
  const locales = filters.locales?.map((locale) => normalizeLocale(locale))
  const mastraRunId = normalizeBoundedString(
    filters.mastraRunId,
    MAX_MASTRA_RUN_ID_LENGTH,
    "mastraRunId",
  )
  const now = filters.now ?? new Date()

  const rows = await prisma.searchEvalCandidate.findMany({
    where: {
      promotionStatus: { in: statuses },
      ...(sources ? { source: { in: sources } } : {}),
      ...(locales ? { locale: { in: locales } } : {}),
      ...(mastraRunId ? { mastraRunId } : {}),
      OR: reviewVisibleCandidateWhere(now),
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: limit,
    select: CANDIDATE_REVIEW_SELECT,
  })

  return serializeReviewCandidateRows(prisma, rows)
}

const CANDIDATE_REVIEW_SELECT = {
  id: true,
  source: true,
  promotionStatus: true,
  locale: true,
  expectedResultHints: true,
  sourceAnchors: true,
  labelProvenance: true,
  generationModel: true,
  generationProvider: true,
  judgeSummary: true,
  sanitizedQueryText: true,
  sanitizedExpectedResultNotes: true,
  sanitizedSourceAnchors: true,
  sanitizationStatus: true,
  reviewerIdentity: true,
  reviewedAt: true,
  reviewNotes: true,
  promotedAt: true,
  promotionRunContext: true,
  mastraRunId: true,
  retentionExpiresAt: true,
  generatedAt: true,
  createdAt: true,
} satisfies Prisma.SearchEvalCandidateSelect

type ReviewCandidateRow = Prisma.SearchEvalCandidateGetPayload<{
  select: typeof CANDIDATE_REVIEW_SELECT
}>

function reviewVisibleCandidateWhere(
  now: Date,
): Prisma.SearchEvalCandidateWhereInput[] {
  return [
    { promotionStatus: PrismaPromotionStatus.PROMOTED },
    { source: { not: PrismaCandidateSource.TRACE } },
    { retentionExpiresAt: { gt: now } },
  ]
}

function shouldRedactReviewRow(row: ReviewCandidateRow): boolean {
  return (
    row.promotionStatus !== PrismaPromotionStatus.PROMOTED &&
    shouldRedactCandidateRow(row)
  )
}

async function serializeReviewCandidateRows(
  prisma: PrismaClient,
  rows: ReviewCandidateRow[],
): Promise<ListedSearchEvalCandidate[]> {
  const redactedIds = new Set(
    rows.filter(shouldRedactReviewRow).map((row) => row.id),
  )
  const pendingReadableIds = rows
    .filter(
      (row) =>
        row.promotionStatus !== PrismaPromotionStatus.PROMOTED &&
        !redactedIds.has(row.id),
    )
    .map((row) => row.id)

  const queryRows =
    pendingReadableIds.length === 0
      ? []
      : await prisma.searchEvalCandidate.findMany({
          where: {
            id: { in: pendingReadableIds },
            source: { not: PrismaCandidateSource.TRACE },
          },
          select: { id: true, queryText: true },
        })
  const queryTextById = new Map(
    queryRows.map((row) => [row.id, row.queryText] as const),
  )

  return rows.map((row) => {
    const promotionStatus =
      row.promotionStatus ?? PrismaPromotionStatus.GENERATED
    const sanitizationStatus =
      row.sanitizationStatus ?? PrismaSanitizationStatus.PENDING
    const redactsOperationalFields =
      redactedIds.has(row.id) ||
      (promotionStatus === PrismaPromotionStatus.PROMOTED &&
        shouldRedactCandidateRow(row))
    return {
      id: row.id,
      source: redactedIds.has(row.id) ? "trace" : fromPrismaSource(row.source),
      promotionStatus: fromPrismaStatus(promotionStatus),
      locale: row.locale,
      queryText:
        promotionStatus === PrismaPromotionStatus.PROMOTED
          ? row.sanitizedQueryText
          : redactedIds.has(row.id)
            ? null
            : (queryTextById.get(row.id) ?? ""),
      expectedResultHints:
        promotionStatus === PrismaPromotionStatus.PROMOTED ||
        redactedIds.has(row.id)
          ? []
          : row.expectedResultHints,
      sourceAnchors:
        promotionStatus === PrismaPromotionStatus.PROMOTED
          ? row.sanitizedSourceAnchors
          : redactedIds.has(row.id)
            ? []
            : row.sourceAnchors,
      labelProvenance:
        promotionStatus === PrismaPromotionStatus.PROMOTED
          ? {
              source: fromPrismaSource(row.source),
              promoted: true,
              sanitized: true,
            }
          : redactedIds.has(row.id)
            ? REDACTED_TRACE_LABEL_PROVENANCE
            : row.labelProvenance,
      generationModel: redactsOperationalFields
        ? "trace:redacted"
        : row.generationModel,
      generationProvider: redactsOperationalFields
        ? null
        : row.generationProvider,
      judgeSummary:
        redactsOperationalFields ||
        promotionStatus === PrismaPromotionStatus.PROMOTED
          ? null
          : row.judgeSummary,
      sanitizedQueryText: row.sanitizedQueryText ?? null,
      sanitizedExpectedResultNotes: row.sanitizedExpectedResultNotes ?? null,
      sanitizedSourceAnchors: row.sanitizedSourceAnchors ?? [],
      sanitizationStatus: fromPrismaSanitizationStatus(sanitizationStatus),
      reviewerIdentity: row.reviewerIdentity ?? null,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewNotes: row.reviewNotes ?? null,
      promotedAt: row.promotedAt?.toISOString() ?? null,
      promotionRunContext: row.promotionRunContext ?? {},
      mastraRunId: redactsOperationalFields ? null : row.mastraRunId,
      retentionExpiresAt: row.retentionExpiresAt?.toISOString() ?? null,
      generatedAt: row.generatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }
  })
}

export async function getSearchEvalCandidateForReview(
  prisma: PrismaClient,
  id: string,
  now: Date = new Date(),
): Promise<ListedSearchEvalCandidate> {
  const rows = await prisma.searchEvalCandidate.findMany({
    where: {
      id,
      OR: reviewVisibleCandidateWhere(now),
    },
    take: 1,
    select: CANDIDATE_REVIEW_SELECT,
  })
  if (rows.length === 0) notFound(id)
  return (await serializeReviewCandidateRows(prisma, rows))[0] ?? notFound(id)
}

function reviewUpdateDataFor(
  input: UpdateSearchEvalCandidateReviewInput,
  now: Date,
): Prisma.SearchEvalCandidateUpdateManyMutationInput {
  const data: Prisma.SearchEvalCandidateUpdateManyMutationInput = {}

  if ("sanitizedQueryText" in input) {
    data.sanitizedQueryText =
      input.sanitizedQueryText == null
        ? null
        : normalizeQuery(input.sanitizedQueryText)
  }
  if ("sanitizedExpectedResultNotes" in input) {
    data.sanitizedExpectedResultNotes = normalizeBoundedString(
      input.sanitizedExpectedResultNotes,
      MAX_REVIEW_NOTES_LENGTH,
      "sanitizedExpectedResultNotes",
    )
  }
  if ("sanitizedSourceAnchors" in input) {
    data.sanitizedSourceAnchors = toJsonArray(
      input.sanitizedSourceAnchors,
      [],
      "sanitizedSourceAnchors",
    )
  }
  if (input.sanitizationStatus != null) {
    data.sanitizationStatus = toPrismaSanitizationStatus(
      input.sanitizationStatus,
    )
  }
  if ("reviewNotes" in input) {
    data.reviewNotes = normalizeBoundedString(
      input.reviewNotes,
      MAX_REVIEW_NOTES_LENGTH,
      "reviewNotes",
    )
  }
  if ("promotionRunContext" in input) {
    data.promotionRunContext = toJsonObject(
      input.promotionRunContext,
      {},
      "promotionRunContext",
    )
  }
  if ("reviewerIdentity" in input) {
    data.reviewerIdentity = normalizeBoundedString(
      input.reviewerIdentity,
      MAX_REVIEWER_IDENTITY_LENGTH,
      "reviewerIdentity",
    )
    if (data.reviewerIdentity != null) data.reviewedAt = now
  }

  return data
}

export async function updateSearchEvalCandidateReviewFields(
  prisma: PrismaClient,
  id: string,
  input: UpdateSearchEvalCandidateReviewInput,
  now: Date = new Date(),
): Promise<ListedSearchEvalCandidate> {
  const updated = await prisma.searchEvalCandidate.updateMany({
    where: {
      id,
      promotionStatus: PrismaPromotionStatus.GENERATED,
      OR: reviewVisibleCandidateWhere(now),
    },
    data: reviewUpdateDataFor(input, now),
  })
  if (updated.count === 0) {
    await getSearchEvalCandidateForReview(prisma, id, now).catch(() =>
      notFound(id),
    )
    invalidState("only pending candidates can be edited")
  }
  return getSearchEvalCandidateForReview(prisma, id, now)
}

async function transitionSearchEvalCandidate(
  prisma: PrismaClient,
  id: string,
  status: (typeof PrismaPromotionStatus)[keyof typeof PrismaPromotionStatus],
  input: SearchEvalCandidateDecisionInput,
  now: Date,
): Promise<ListedSearchEvalCandidate> {
  const reviewerIdentity = normalizeRequiredBoundedString(
    input.reviewerIdentity,
    MAX_REVIEWER_IDENTITY_LENGTH,
    "reviewerIdentity",
  )
  const updated = await prisma.searchEvalCandidate.updateMany({
    where: {
      id,
      promotionStatus: PrismaPromotionStatus.GENERATED,
      OR: reviewVisibleCandidateWhere(now),
    },
    data: {
      promotionStatus: status,
      sanitizationStatus: PrismaSanitizationStatus.UNSAFE,
      reviewerIdentity,
      reviewedAt: now,
      reviewNotes: normalizeBoundedString(
        input.reviewNotes,
        MAX_REVIEW_NOTES_LENGTH,
        "reviewNotes",
      ),
      promotionRunContext: toJsonObject(
        input.promotionRunContext,
        {},
        "promotionRunContext",
      ),
    },
  })
  if (updated.count === 0) {
    await getSearchEvalCandidateForReview(prisma, id, now).catch(() =>
      notFound(id),
    )
    invalidState("only pending candidates can change review state")
  }
  return getSearchEvalCandidateForReview(prisma, id, now)
}

export function rejectSearchEvalCandidate(
  prisma: PrismaClient,
  id: string,
  input: SearchEvalCandidateDecisionInput,
  now: Date = new Date(),
): Promise<ListedSearchEvalCandidate> {
  return transitionSearchEvalCandidate(
    prisma,
    id,
    PrismaPromotionStatus.REJECTED,
    input,
    now,
  )
}

export function archiveSearchEvalCandidate(
  prisma: PrismaClient,
  id: string,
  input: SearchEvalCandidateDecisionInput,
  now: Date = new Date(),
): Promise<ListedSearchEvalCandidate> {
  return transitionSearchEvalCandidate(
    prisma,
    id,
    PrismaPromotionStatus.ARCHIVED,
    input,
    now,
  )
}

export async function promoteSearchEvalCandidate(
  prisma: PrismaClient,
  id: string,
  input: PromoteSearchEvalCandidateInput,
  now: Date = new Date(),
): Promise<ListedSearchEvalCandidate> {
  const existing = await getSearchEvalCandidateForReview(prisma, id, now)
  if (existing.promotionStatus !== "generated") {
    invalidState("only pending candidates can be promoted")
  }

  const reviewerIdentity = normalizeRequiredBoundedString(
    input.reviewerIdentity,
    MAX_REVIEWER_IDENTITY_LENGTH,
    "reviewerIdentity",
  )
  const sanitizedQueryText =
    normalizeBoundedString(
      input.sanitizedQueryText,
      MAX_QUERY_LENGTH,
      "sanitizedQueryText",
    ) ??
    existing.sanitizedQueryText ??
    validation("sanitizedQueryText is required for promotion")
  const sanitizedExpectedResultNotes =
    "sanitizedExpectedResultNotes" in input
      ? normalizeBoundedString(
          input.sanitizedExpectedResultNotes,
          MAX_REVIEW_NOTES_LENGTH,
          "sanitizedExpectedResultNotes",
        )
      : existing.sanitizedExpectedResultNotes
  const sanitizedSourceAnchors =
    "sanitizedSourceAnchors" in input
      ? toJsonArray(input.sanitizedSourceAnchors, [], "sanitizedSourceAnchors")
      : toJsonArray(
          existing.sanitizedSourceAnchors,
          [],
          "sanitizedSourceAnchors",
        )

  if (
    input.sanitizationStatus != null &&
    input.sanitizationStatus !== "sanitized"
  ) {
    validation("promotion requires sanitizationStatus sanitized")
  }

  const updated = await prisma.searchEvalCandidate.updateMany({
    where: {
      id,
      promotionStatus: PrismaPromotionStatus.GENERATED,
      OR: reviewVisibleCandidateWhere(now),
    },
    data: {
      promotionStatus: PrismaPromotionStatus.PROMOTED,
      queryText: sanitizedQueryText,
      sanitizedQueryText,
      sanitizedExpectedResultNotes,
      sanitizedSourceAnchors,
      sanitizationStatus: PrismaSanitizationStatus.SANITIZED,
      reviewerIdentity,
      reviewedAt: now,
      promotedAt: now,
      reviewNotes: normalizeBoundedString(
        input.reviewNotes,
        MAX_REVIEW_NOTES_LENGTH,
        "reviewNotes",
      ),
      promotionRunContext: toJsonObject(
        input.promotionRunContext,
        {},
        "promotionRunContext",
      ),
    },
  })
  if (updated.count === 0) invalidState("candidate promotion state changed")
  return getSearchEvalCandidateForReview(prisma, id, now)
}

export const _internal = {
  dedupeKeyFor,
  fromPrismaSource,
  fromPrismaStatus,
  hasTraceMarker,
  normalizeLocale,
  normalizeQuery,
  prepareCandidate,
}
