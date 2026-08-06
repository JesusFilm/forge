import { randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import {
  TypesenseClient,
  TypesenseRequestError,
  type TypesenseSearchGroup,
  type TypesenseSearchHit,
  type TypesenseSearchRequest,
  type TypesenseSearchResult,
} from "./typesense-client"
import { tokenizeForExactTitle } from "./hybrid-search-keyword-first-retrievers"
import {
  TYPESENSE_WATCH_AVAILABILITY_ALIAS,
  TYPESENSE_WATCH_CATALOG_ALIAS,
  TYPESENSE_WATCH_LEXICAL_ALIAS,
  TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
  type TypesenseWatchAudioOption,
  type TypesenseWatchAvailabilityDocument,
  type TypesenseWatchCatalogDocument,
  type TypesenseWatchSubtitleOption,
  type TypesenseWatchTranscriptDocument,
} from "./typesense-watch-search-schema"
import type { TypesenseWatchLexicalDocument } from "./typesense-watch-search-lexical"
import {
  displayLocale,
  displayPreviewLocale,
  hasAlignedLocaleCodes,
  type TypesenseWatchCatalogPreviewDocument,
  watchLexicalQueryFields,
} from "./typesense-watch-search-locales"
import { resolveSearchLanguageSignals } from "./search-language-resolution"
import {
  defaultWatchSearchEmbedder,
  type WatchSearchInput,
  type WatchSearchLaneStatus,
  type WatchSearchLanguageInterpretation,
  type WatchSearchQueryEmbedder,
  type WatchSearchResponse,
  type WatchSearchResult,
  WatchSearchValidationError,
} from "./watch-search.service"

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const MAX_QUERY_LENGTH = 200
const TYPESENSE_MAX_PER_PAGE = 250
const TYPESENSE_MAX_MULTI_SEARCHES = 50
const MAX_AVAILABILITY_OVERFLOW_SEARCHES = 50
const MAX_LEXICAL_CANDIDATES =
  TYPESENSE_MAX_PER_PAGE * TYPESENSE_MAX_MULTI_SEARCHES
const MAX_SEMANTIC_CANDIDATES = 40
const MIN_FALLBACK_CANDIDATES = 100
const HYBRID_VECTOR_CANDIDATES = 80
const HYBRID_GROUP_LIMIT = 3
const MAX_FUSED_CANDIDATES = TYPESENSE_MAX_PER_PAGE
const RRF_RANK_CONSTANT = 60
const TITLE_LANE_WEIGHT = 0.56
const METADATA_LANE_WEIGHT = 0.14
const SEMANTIC_LANE_WEIGHT = 0.3
const MAX_CATALOG_HYDRATION_BATCH = 250
const MAX_EVIDENCE_LOCALES = 3
const DEFAULT_EMBEDDING_TIMEOUT_MS = 1_000
const MIN_SEMANTIC_SIMILARITY = 0.5
const CATALOG_PREVIEW_EXCLUDED_FIELDS =
  "coreId,slug,descriptions,localesJson,label,childCount,imageUrl,imageBlurDataUrl,audioOptionsJson,subtitleOptionsJson"
const LEGACY_CATALOG_LOCALE_FIELDS = "id,titles,localesJson"
const CATALOG_WATCHABILITY_PREVIEW_FIELDS =
  "id,audioLanguageSlugs,subtitleLanguageSlugs"
const CATALOG_RESULT_FIELDS =
  "id,slug,titles,localesJson,label,childCount,imageUrl,imageBlurDataUrl"
const AVAILABILITY_RESULT_FIELDS =
  "id,videoId,videoEditionId,languageId,languageSlug,languageEnglishName,audio,subtitles,playbackId,durationSeconds,hrefLanguageSlug,actionVideoDubId,actionPriority"
const LEGACY_CATALOG_RESULT_FIELDS = `${CATALOG_RESULT_FIELDS},audioOptionsJson,subtitleOptionsJson`
const AVAILABILITY_ACTION_FIELDS = [
  "videoEditionId",
  "hrefLanguageSlug",
  "actionVideoDubId",
  "actionPriority",
] as const

type TypesenseSearchClient = Pick<TypesenseClient, "multiSearch">

type TypesenseWatchSearchDeps = {
  embedder?: WatchSearchQueryEmbedder
  embeddingTimeoutMs?: number
  logger?: Pick<Console, "warn">
}

type Candidate = {
  videoId: string
  videoEditionId: string | null
  kind: "exact" | "metadata" | "semantic"
  wholeTitleMatch: boolean
  sourceScore: number
  evidenceLanguageSlug: string | null
  snippet: string | null
  startSeconds: number | null
}

type CandidateHydrationScope = Pick<
  Candidate,
  "videoId" | "videoEditionId" | "kind"
>

type CandidateRetrieval = {
  candidates: Candidate[]
  nativeCandidateGroups: Candidate[][] | null
  nativeOffset: number
  lexicalHits: TypesenseSearchHit<TypesenseWatchCatalogPreviewDocument>[]
  nativeRanking: boolean
}

type EmbeddingOutcome =
  | { status: "fulfilled"; embedding: number[] }
  | { status: "rejected"; error: unknown }

type RankedCandidate = {
  candidate: Candidate
  rankingRelevance: number
  watchabilityKind: IndexedWatchability["kind"]
}

type TypesenseWatchLegacyCatalogLocaleDocument = Pick<
  TypesenseWatchCatalogDocument,
  "id" | "titles" | "localesJson"
>

type TypesenseWatchCatalogWatchabilityPreviewDocument = Pick<
  TypesenseWatchCatalogDocument,
  "id" | "audioLanguageSlugs" | "subtitleLanguageSlugs"
>

type TypesenseWatchCatalogResultDocument = Pick<
  TypesenseWatchCatalogDocument,
  | "id"
  | "slug"
  | "titles"
  | "localesJson"
  | "label"
  | "childCount"
  | "imageUrl"
  | "imageBlurDataUrl"
>

type TypesenseWatchLegacyCatalogResultDocument =
  TypesenseWatchCatalogResultDocument &
    Pick<
      TypesenseWatchCatalogDocument,
      "audioOptionsJson" | "subtitleOptionsJson"
    >

type IndexedWatchability = {
  kind: "target_audio" | "target_subtitle" | "related_language" | "unavailable"
  languageSlug: string | null
  languageEnglishName: string | null
  audio: boolean
  subtitles: boolean
  playbackId: string | null
  durationSeconds: number | null
  hrefLanguageSlug: string | null
}

type HydratedResultDocument = {
  document: TypesenseWatchCatalogResultDocument
  watchability: IndexedWatchability
}

type TargetLanguageContext = {
  id: string | null
  slug: string
  englishName: string | null
  fallbackLanguageIds: string[]
  fallbackLanguageSlugs: string[]
}

export class TypesenseWatchSearchUnavailableError extends Error {
  constructor(message = "Typesense Watch Search is not configured") {
    super(message)
    this.name = "TypesenseWatchSearchUnavailableError"
  }
}

function isMissingAvailabilityAlias(error: unknown): boolean {
  return error instanceof TypesenseRequestError && error.status === 404
}

class AvailabilityOverflowError extends Error {
  constructor() {
    super("Typesense availability hydration exceeded its overflow page budget")
    this.name = "AvailabilityOverflowError"
  }
}

function isLegacyAvailabilityProjection(error: unknown): boolean {
  if (!(error instanceof TypesenseRequestError) || error.status !== 400) {
    return false
  }
  const fieldFailure =
    /(?:could not find|unknown|not found|does not exist)[^\n]*field|field[^\n]*(?:not found|unknown|does not exist)/i.test(
      error.message,
    )
  return (
    fieldFailure &&
    AVAILABILITY_ACTION_FIELDS.some((field) => error.message.includes(field))
  )
}

function isMissingLexicalProjection(error: unknown): boolean {
  return (
    error instanceof TypesenseRequestError &&
    (error.status === 400 || error.status === 404) &&
    new RegExp(
      `${TYPESENSE_WATCH_LEXICAL_ALIAS}|title_[a-z]|metadata_[a-z]|canonicalVideoId|videoEditionId`,
    ).test(error.message)
  )
}

function normalizeLimit(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_LIMIT
  return Math.min(Math.max(Math.trunc(value), 1), MAX_LIMIT)
}

function normalizeOffset(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0
  return Math.max(Math.trunc(value), 0)
}

function normalizeRequestId(value: string | null | undefined): string {
  const normalized = value?.trim()
  return normalized && /^[A-Za-z0-9_-]{8,80}$/.test(normalized)
    ? normalized
    : randomUUID()
}

function localeForLanguageSlug(slug: string | null): string | null {
  if (!slug) return null
  if (/^[a-z]{2}(-[A-Z]{2})?$/.test(slug)) return slug.slice(0, 2)
  if (slug === "english") return "en"
  if (slug === "spanish-castilian") return "es"
  if (slug === "french") return "fr"
  if (slug === "portuguese-brazil") return "pt"
  return null
}

function queryWithoutLanguageHints(
  query: string,
  languageSlugs: ReadonlyArray<string | null>,
): string {
  let stripped = query
  for (const slug of languageSlugs) {
    for (const word of slug?.split(/[-_\s]+/).filter(Boolean) ?? []) {
      stripped = stripped.replace(
        new RegExp(
          `\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
          "gi",
        ),
        " ",
      )
    }
  }
  return stripped.replace(/\s+/g, " ").trim() || query
}

function parseJsonArray<T>(value: string): T[] {
  const parsed: unknown = JSON.parse(value)
  return Array.isArray(parsed) ? (parsed as T[]) : []
}

function normalizedTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase()
}

function createTitleMatchClassifier(query: string) {
  const normalizedQuery = normalizedTitle(query)
  const exactTitleTokens = tokenizeForExactTitle(query)
  return (titles: readonly string[]) => {
    const normalizedTitles = titles.map(normalizedTitle)
    const exact =
      exactTitleTokens.length > 0 &&
      normalizedTitles.some((title) =>
        exactTitleTokens.every((token) => title.includes(token)),
      )
    return {
      exact,
      wholeTitleMatch:
        exact && normalizedTitles.some((title) => title === normalizedQuery),
    }
  }
}

function lexicalSearchRequests(
  query: string,
  candidateLimit: number,
  maxRequests = TYPESENSE_MAX_MULTI_SEARCHES,
): TypesenseSearchRequest[] {
  const perPage = Math.min(candidateLimit, TYPESENSE_MAX_PER_PAGE)
  const pageCount = Math.min(Math.ceil(candidateLimit / perPage), maxRequests)
  return Array.from({ length: pageCount }, (_value, index) => ({
    collection: TYPESENSE_WATCH_CATALOG_ALIAS,
    q: query,
    query_by: "titles,descriptions",
    query_by_weights: "4,1",
    page: index + 1,
    per_page: perPage,
    prefix: true,
    num_typos: "2,1",
    exclude_fields: CATALOG_PREVIEW_EXCLUDED_FIELDS,
  }))
}

function lexicalLaneRequest(
  query: string,
  fields: readonly string[],
  candidateLimit: number,
  offset: number,
): TypesenseSearchRequest {
  const perPage = Math.min(candidateLimit, MAX_FUSED_CANDIDATES)
  return {
    collection: TYPESENSE_WATCH_LEXICAL_ALIAS,
    q: query,
    query_by: fields.join(","),
    query_by_weights: fields
      .map((_field, index) => (index === 0 ? 4 : 1))
      .join(","),
    page: Math.floor(offset / perPage) + 1,
    per_page: perPage,
    group_by: "canonicalVideoId",
    group_limit: HYBRID_GROUP_LIMIT,
    prefix: true,
    num_typos: fields.map((_field, index) => (index === 0 ? 2 : 1)).join(","),
    split_join_tokens: "always",
    text_match_type: "max_weight",
    prioritize_exact_match: true,
    drop_tokens_threshold: 1,
    include_fields: [
      "id",
      "videoId",
      "canonicalVideoId",
      "localeCodes",
      ...fields,
    ].join(","),
  }
}

function semanticLaneRequest(
  embedding: readonly number[],
  evidenceLocales: Array<{ slug: string; locale: string }>,
  candidateLimit: number,
  offset: number,
): TypesenseSearchRequest {
  const vectorCandidateLimit = HYBRID_VECTOR_CANDIDATES
  const perPage = Math.min(candidateLimit, MAX_FUSED_CANDIDATES)
  const filterValues = evidenceLocales
    .map(({ locale }) => `\`${locale}\``)
    .join(",")
  return {
    collection: TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
    q: "*",
    vector_query: `embedding:([${embedding.join(",")}], k:${vectorCandidateLimit}, distance_threshold:${1 - MIN_SEMANTIC_SIMILARITY})`,
    filter_by: `documentKind:=transcript && publiclyVisible:=true && language:=[${filterValues}]`,
    group_by: "canonicalVideoId",
    group_limit: HYBRID_GROUP_LIMIT,
    page: Math.floor(offset / perPage) + 1,
    per_page: perPage,
    include_fields:
      "id,documentKind,videoId,videoEditionId,canonicalVideoId,language,text,startSeconds",
  }
}

function previewWatchabilityKind(
  document: TypesenseWatchCatalogWatchabilityPreviewDocument,
  target: TargetLanguageContext,
): IndexedWatchability["kind"] {
  if (document.audioLanguageSlugs.includes(target.slug)) return "target_audio"
  if (document.subtitleLanguageSlugs.includes(target.slug)) {
    return "target_subtitle"
  }
  if (
    target.fallbackLanguageSlugs.some((slug) =>
      document.audioLanguageSlugs.includes(slug),
    )
  ) {
    return "related_language"
  }
  return "unavailable"
}

function englishName(value: unknown): string | null {
  if (value && typeof value === "object" && "en" in value) {
    const name = (value as { en?: unknown }).en
    return typeof name === "string" && name.trim() ? name : null
  }
  return null
}

type SubtitleActionSortFields = Pick<
  TypesenseWatchAvailabilityDocument,
  | "actionPriority"
  | "durationSeconds"
  | "hrefLanguageSlug"
  | "actionVideoDubId"
  | "videoEditionId"
  | "id"
>

function compareSubtitleActions(
  left: SubtitleActionSortFields,
  right: SubtitleActionSortFields,
): number {
  const priorityDelta =
    (left.actionPriority ?? Number.MAX_SAFE_INTEGER) -
    (right.actionPriority ?? Number.MAX_SAFE_INTEGER)
  if (priorityDelta !== 0) return priorityDelta
  const durationDelta =
    (right.durationSeconds ?? -1) - (left.durationSeconds ?? -1)
  if (durationDelta !== 0) return durationDelta
  const slugDelta = (left.hrefLanguageSlug ?? "").localeCompare(
    right.hrefLanguageSlug ?? "",
  )
  if (slugDelta !== 0) return slugDelta
  const dubDelta = (left.actionVideoDubId ?? "").localeCompare(
    right.actionVideoDubId ?? "",
  )
  if (dubDelta !== 0) return dubDelta
  const editionDelta = (left.videoEditionId ?? "").localeCompare(
    right.videoEditionId ?? "",
  )
  return editionDelta !== 0 ? editionDelta : left.id.localeCompare(right.id)
}

function legacySubtitleAvailability(
  documentId: string,
  option: TypesenseWatchSubtitleOption,
): TypesenseWatchAvailabilityDocument {
  return {
    id: `${documentId}:${option.videoEditionId ?? "unscoped"}:${option.languageId}`,
    videoId: documentId,
    videoEditionId: option.videoEditionId ?? null,
    languageId: option.languageId,
    languageSlug: option.languageSlug,
    languageEnglishName: option.languageEnglishName ?? null,
    audio: false,
    subtitles: true,
    playbackId: option.playbackId ?? null,
    durationSeconds: option.durationSeconds ?? null,
    hrefLanguageSlug: option.hrefLanguageSlug ?? null,
    actionVideoDubId: option.actionVideoDubId ?? null,
    actionPriority: option.actionPriority ?? null,
  }
}

function resolveLegacyWatchability(
  document: TypesenseWatchLegacyCatalogResultDocument,
  target: TargetLanguageContext,
  candidateVideoEditionId: string | null,
  requireVideoEditionIdForSubtitle: boolean,
): IndexedWatchability {
  const audioOptions = parseJsonArray<TypesenseWatchAudioOption>(
    document.audioOptionsJson,
  )
  const subtitleOptions = parseJsonArray<TypesenseWatchSubtitleOption>(
    document.subtitleOptionsJson,
  )
  const targetAudio = audioOptions.find(
    (option) => option.languageSlug === target.slug,
  )
  if (targetAudio) {
    return {
      kind: "target_audio",
      languageSlug: targetAudio.languageSlug,
      languageEnglishName: targetAudio.languageEnglishName,
      audio: true,
      subtitles: false,
      playbackId: targetAudio.playbackId,
      durationSeconds: targetAudio.durationSeconds,
      hrefLanguageSlug: targetAudio.languageSlug,
    }
  }
  const targetSubtitle = subtitleOptions
    .filter(
      (option) =>
        option.languageSlug === target.slug &&
        (candidateVideoEditionId != null
          ? option.videoEditionId === candidateVideoEditionId
          : !requireVideoEditionIdForSubtitle),
    )
    .map((option) => legacySubtitleAvailability(document.id, option))
    .sort(compareSubtitleActions)[0]
  if (targetSubtitle) {
    return {
      kind: "target_subtitle",
      languageSlug: targetSubtitle.languageSlug,
      languageEnglishName:
        targetSubtitle.languageEnglishName ?? target.englishName,
      audio: false,
      subtitles: true,
      playbackId: targetSubtitle.playbackId,
      durationSeconds: targetSubtitle.durationSeconds,
      hrefLanguageSlug: targetSubtitle.hrefLanguageSlug ?? null,
    }
  }
  for (const languageId of target.fallbackLanguageIds) {
    const fallback = audioOptions.find(
      (option) => option.languageId === languageId,
    )
    if (fallback) {
      return {
        kind: "related_language",
        languageSlug: fallback.languageSlug,
        languageEnglishName: fallback.languageEnglishName,
        audio: true,
        subtitles: false,
        playbackId: fallback.playbackId,
        durationSeconds: fallback.durationSeconds,
        hrefLanguageSlug: fallback.languageSlug,
      }
    }
  }
  return {
    kind: "unavailable",
    languageSlug: null,
    languageEnglishName: null,
    audio: false,
    subtitles: false,
    playbackId: null,
    durationSeconds: null,
    hrefLanguageSlug: null,
  }
}

function resolveWatchability(
  availability: readonly TypesenseWatchAvailabilityDocument[],
  target: TargetLanguageContext,
  candidateVideoEditionId: string | null,
  requireVideoEditionIdForSubtitle: boolean,
): IndexedWatchability {
  const targetAudio = availability.find(
    (option) => option.languageSlug === target.slug && option.audio,
  )
  if (targetAudio) {
    return {
      kind: "target_audio",
      languageSlug: targetAudio.languageSlug,
      languageEnglishName: targetAudio.languageEnglishName,
      audio: true,
      subtitles: false,
      playbackId: targetAudio.playbackId,
      durationSeconds: targetAudio.durationSeconds,
      hrefLanguageSlug:
        targetAudio.hrefLanguageSlug ?? targetAudio.languageSlug,
    }
  }
  const targetSubtitle = availability
    .filter(
      (option) =>
        option.languageSlug === target.slug &&
        option.subtitles &&
        !option.audio &&
        (candidateVideoEditionId != null
          ? option.videoEditionId === candidateVideoEditionId
          : !requireVideoEditionIdForSubtitle),
    )
    .sort(compareSubtitleActions)[0]
  if (targetSubtitle) {
    return {
      kind: "target_subtitle",
      languageSlug: targetSubtitle.languageSlug,
      languageEnglishName:
        targetSubtitle.languageEnglishName ?? target.englishName,
      audio: false,
      subtitles: true,
      playbackId: targetSubtitle.playbackId,
      durationSeconds: targetSubtitle.durationSeconds,
      hrefLanguageSlug: targetSubtitle.hrefLanguageSlug ?? null,
    }
  }
  for (const languageId of target.fallbackLanguageIds) {
    const fallback = availability.find(
      (option) => option.languageId === languageId && option.audio,
    )
    if (fallback) {
      return {
        kind: "related_language",
        languageSlug: fallback.languageSlug,
        languageEnglishName: fallback.languageEnglishName,
        audio: true,
        subtitles: false,
        playbackId: fallback.playbackId,
        durationSeconds: fallback.durationSeconds,
        hrefLanguageSlug: fallback.hrefLanguageSlug ?? fallback.languageSlug,
      }
    }
  }
  return {
    kind: "unavailable",
    languageSlug: null,
    languageEnglishName: null,
    audio: false,
    subtitles: false,
    playbackId: null,
    durationSeconds: null,
    hrefLanguageSlug: null,
  }
}

function fallbackForWatchability(watchability: IndexedWatchability) {
  if (watchability.kind === "target_subtitle") {
    return {
      kind: "subtitle" as const,
      message: "Target-language subtitles are available.",
    }
  }
  if (watchability.kind === "related_language") {
    return {
      kind: "related_language" as const,
      message: "Playable in a related language.",
    }
  }
  if (watchability.kind === "unavailable") {
    return {
      kind: "unavailable" as const,
      message: "No playable target-language option is available.",
    }
  }
  return { kind: "none" as const, message: null }
}

function candidateRelevance(candidate: Candidate): number {
  const sourceRelevance = candidate.sourceScore * 0.55
  const evidenceBoost =
    candidate.kind === "exact"
      ? candidate.wholeTitleMatch
        ? 0.45
        : 0.2
      : candidate.kind === "metadata"
        ? 0.14
        : 0.08
  return sourceRelevance + evidenceBoost
}

function candidateScore(
  candidate: Candidate,
  watchability: IndexedWatchability,
) {
  const sourceRelevance = candidate.sourceScore * 0.55
  const relevance = candidateRelevance(candidate)
  const evidenceBoost = relevance - sourceRelevance
  const availability =
    watchability.kind === "target_audio"
      ? 0.25
      : watchability.kind === "target_subtitle"
        ? 0.18
        : watchability.kind === "related_language"
          ? 0.08
          : 0
  const round = (value: number) => Math.round(value * 1000) / 1000
  return {
    rankingRelevance: relevance,
    scoreBreakdown: {
      total: round(Math.min(1, relevance + availability)),
      sourceRelevance: round(sourceRelevance),
      evidenceBoost: round(evidenceBoost),
      relevance: round(relevance),
      availability: round(availability),
      match: round(evidenceBoost),
      sourceScore: round(candidate.sourceScore),
    },
  }
}

function watchabilityRank(kind: IndexedWatchability["kind"]): number {
  if (kind === "target_audio") return 0
  if (kind === "target_subtitle") return 1
  if (kind === "related_language") return 2
  return 3
}

function laneStatus({
  lane,
  status,
  timelineStartedAt,
  startedAt,
  resultCount,
  reason = null,
}: {
  lane: WatchSearchLaneStatus["lane"]
  status: WatchSearchLaneStatus["status"]
  timelineStartedAt: number
  startedAt: number
  resultCount: number
  reason?: string | null
}): WatchSearchLaneStatus {
  return {
    lane,
    status,
    startedOffsetMs: Math.max(0, startedAt - timelineStartedAt),
    elapsedMs: performance.now() - startedAt,
    resultCount,
    reason,
    detail: null,
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("query_embedding_timeout")),
          timeoutMs,
        )
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export class TypesenseWatchSearchService {
  private readonly embedder: WatchSearchQueryEmbedder
  private readonly embeddingTimeoutMs: number
  private readonly logger: Pick<Console, "warn">

  constructor(
    private readonly prisma: PrismaClient,
    private readonly typesense: TypesenseSearchClient,
    deps: TypesenseWatchSearchDeps = {},
  ) {
    this.embedder =
      deps.embedder ?? ((text) => defaultWatchSearchEmbedder(prisma, text))
    this.embeddingTimeoutMs =
      deps.embeddingTimeoutMs ?? DEFAULT_EMBEDDING_TIMEOUT_MS
    this.logger = deps.logger ?? console
  }

  async search(input: WatchSearchInput): Promise<WatchSearchResponse> {
    const startedAt = performance.now()
    const query = input.query.trim().slice(0, MAX_QUERY_LENGTH)
    if (!query) throw new WatchSearchValidationError("Search query is required")
    if (input.resultTypes?.length && !input.resultTypes.includes("video")) {
      return this.emptyResponse(input, query, startedAt)
    }

    const limit = normalizeLimit(input.limit)
    const offset = normalizeOffset(input.offset)
    const embeddingStartedAt = performance.now()
    const embeddingPromise: Promise<EmbeddingOutcome> = withTimeout(
      Promise.resolve().then(() => this.embedder(query)),
      this.embeddingTimeoutMs,
    ).then(
      (embedded) => ({
        status: "fulfilled",
        embedding: Array.isArray(embedded) ? embedded : [...embedded.embedding],
      }),
      (error: unknown) => ({ status: "rejected", error }),
    )
    const languageInterpretation = await resolveSearchLanguageSignals({
      prisma: this.prisma,
      input,
    })
    const [target, evidenceLocales] = await Promise.all([
      this.targetLanguageContext(languageInterpretation.targetLanguageSlug),
      this.evidenceLocales(languageInterpretation),
    ])
    const preferredLocale =
      localeForLanguageSlug(languageInterpretation.displayLanguageSlug) ??
      languageInterpretation.displayLanguageBcp47 ??
      localeForLanguageSlug(languageInterpretation.routeLanguageSlug) ??
      languageInterpretation.routeLanguageBcp47 ??
      "en"
    const queryLocale =
      evidenceLocales.find(
        ({ slug }) => slug === languageInterpretation.queryLanguageSlug,
      )?.locale ?? preferredLocale
    const titleQuery = queryWithoutLanguageHints(query, [
      languageInterpretation.queryNamedLanguageSlug,
      languageInterpretation.targetLanguageSlug,
    ])
    const candidateLimit = Math.min(
      Math.max(offset + limit + 1, MIN_FALLBACK_CANDIDATES),
      MAX_LEXICAL_CANDIDATES,
    )
    const laneStatuses: WatchSearchLaneStatus[] = []
    const {
      candidates,
      nativeCandidateGroups,
      nativeOffset,
      lexicalHits,
      nativeRanking,
    } = await this.retrieveCandidates({
      titleQuery,
      preferredLocale,
      queryLocale,
      evidenceLocales,
      candidateLimit,
      offset,
      embeddingStartedAt,
      embeddingPromise,
      timelineStartedAt: startedAt,
      laneStatuses,
    })
    const watchabilityStartedAt = performance.now()
    let rankedCandidates: RankedCandidate[]
    let hydratedById: Map<string, HydratedResultDocument>
    if (nativeRanking) {
      const candidateGroups = (nativeCandidateGroups ?? []).slice(
        0,
        nativeOffset + limit + 1,
      )
      hydratedById = await this.hydrateResultDocuments(
        candidateGroups.flat(),
        target,
      )
      rankedCandidates = candidateGroups.flatMap((group) => {
        const watchableMembers = group.flatMap((candidate) => {
          const hydrated = hydratedById.get(candidate.videoId)
          return hydrated
            ? [
                {
                  candidate,
                  rankingRelevance: candidateRelevance(candidate),
                  watchabilityKind: hydrated.watchability.kind,
                },
              ]
            : []
        })
        watchableMembers.sort((left, right) => {
          const watchabilityDelta =
            watchabilityRank(left.watchabilityKind) -
            watchabilityRank(right.watchabilityKind)
          if (watchabilityDelta !== 0) return watchabilityDelta
          return right.rankingRelevance - left.rankingRelevance
        })
        return watchableMembers.slice(0, 1)
      })
    } else {
      const previewById = new Map<
        string,
        TypesenseWatchCatalogWatchabilityPreviewDocument
      >(lexicalHits.map((hit) => [hit.document.id, hit.document] as const))
      const missingPreviewIds = candidates
        .map((candidate) => candidate.videoId)
        .filter((videoId) => !previewById.has(videoId))
      const missingPreviews =
        await this.catalogDocuments<TypesenseWatchCatalogWatchabilityPreviewDocument>(
          missingPreviewIds,
          CATALOG_WATCHABILITY_PREVIEW_FIELDS,
        )
      for (const [videoId, document] of missingPreviews) {
        previewById.set(videoId, document)
      }
      rankedCandidates = candidates
        .flatMap((candidate) => {
          const preview = previewById.get(candidate.videoId)
          if (!preview) return []
          return [
            {
              candidate,
              rankingRelevance: candidateRelevance(candidate),
              watchabilityKind: previewWatchabilityKind(preview, target),
            },
          ]
        })
        .sort((left, right) => {
          const wholeTitleDelta =
            Number(right.candidate.wholeTitleMatch) -
            Number(left.candidate.wholeTitleMatch)
          if (wholeTitleDelta !== 0) return wholeTitleDelta

          const relevanceDelta = right.rankingRelevance - left.rankingRelevance
          if (relevanceDelta !== 0) return relevanceDelta

          const watchabilityDelta =
            watchabilityRank(left.watchabilityKind) -
            watchabilityRank(right.watchabilityKind)
          if (watchabilityDelta !== 0) return watchabilityDelta

          return left.candidate.videoId.localeCompare(right.candidate.videoId)
        })
      const fallbackPage = rankedCandidates.slice(offset, offset + limit)
      hydratedById = await this.hydrateResultDocuments(
        fallbackPage.map((entry) => entry.candidate),
        target,
      )
    }
    const pageCandidates = nativeRanking
      ? rankedCandidates.slice(nativeOffset, nativeOffset + limit)
      : rankedCandidates.slice(offset, offset + limit)
    laneStatuses.push(
      laneStatus({
        lane: "metadata_watchability",
        status: "fulfilled",
        timelineStartedAt: startedAt,
        startedAt: watchabilityStartedAt,
        resultCount: hydratedById.size,
      }),
    )

    const page = pageCandidates.flatMap(({ candidate }) => {
      const hydrated = hydratedById.get(candidate.videoId)
      if (!hydrated) return []
      const { document, watchability } = hydrated
      const locale = displayLocale(document, preferredLocale)
      const { scoreBreakdown } = candidateScore(candidate, watchability)
      const result: WatchSearchResult = {
        type: "video",
        id: document.id,
        slug: document.slug,
        title: locale.title,
        description: locale.description,
        snippet: candidate.snippet ?? locale.description,
        imageUrl: document.imageUrl,
        imageBlurDataUrl: document.imageBlurDataUrl,
        muxThumbnailBlurDataUrl: null,
        playbackId: watchability.playbackId,
        startSeconds: candidate.startSeconds,
        score: scoreBreakdown.total,
        scoreBreakdown,
        label: document.label,
        durationSeconds: watchability.durationSeconds,
        childCount: document.childCount,
        languageSlug: watchability.languageSlug,
        languageEnglishName: watchability.languageEnglishName,
        availability: {
          kind: watchability.kind,
          languageSlug: watchability.languageSlug,
          languageEnglishName: watchability.languageEnglishName,
          audio: watchability.audio,
          subtitles: watchability.subtitles,
        },
        evidence: {
          kind:
            candidate.kind === "exact"
              ? "exact_title"
              : candidate.kind === "semantic"
                ? "transcript_semantic"
                : "metadata",
          languageSlug: candidate.evidenceLanguageSlug,
          label:
            candidate.kind === "exact"
              ? "Title match"
              : candidate.kind === "semantic"
                ? "Transcript match"
                : "Metadata match",
        },
        action: {
          kind: "watch",
          hrefLanguageSlug: watchability.hrefLanguageSlug,
        },
        fallback: fallbackForWatchability(watchability),
      }
      return [result]
    })

    return {
      query,
      results: page,
      hasMore: nativeRanking
        ? rankedCandidates.length > nativeOffset + limit
        : rankedCandidates.length > offset + limit,
      nextOffset: offset + limit,
      searchMode: "watch-search-typesense",
      requestId: normalizeRequestId(input.clientRequestId),
      degraded: laneStatuses.some((lane) => lane.status === "degraded"),
      latencyMs: performance.now() - startedAt,
      laneStatuses,
      languageInterpretation,
    }
  }

  private async retrieveCandidates({
    titleQuery,
    preferredLocale,
    queryLocale,
    evidenceLocales,
    candidateLimit,
    offset,
    embeddingStartedAt,
    embeddingPromise,
    timelineStartedAt,
    laneStatuses,
  }: {
    titleQuery: string
    preferredLocale: string
    queryLocale: string
    evidenceLocales: Array<{ slug: string; locale: string }>
    candidateLimit: number
    offset: number
    embeddingStartedAt: number
    embeddingPromise: Promise<EmbeddingOutcome>
    timelineStartedAt: number
    laneStatuses: WatchSearchLaneStatus[]
  }): Promise<CandidateRetrieval> {
    if (evidenceLocales.length === 0) {
      laneStatuses.push(
        laneStatus({
          lane: "semantic_embedding",
          status: "skipped",
          timelineStartedAt,
          startedAt: embeddingStartedAt,
          resultCount: 0,
          reason: "no_evidence_language",
        }),
      )
    }

    const embeddingOutcome =
      evidenceLocales.length > 0 ? await embeddingPromise : null
    const embedding =
      embeddingOutcome?.status === "fulfilled"
        ? embeddingOutcome.embedding
        : null
    if (embedding) {
      laneStatuses.push(
        laneStatus({
          lane: "semantic_embedding",
          status: "fulfilled",
          timelineStartedAt,
          startedAt: embeddingStartedAt,
          resultCount: 1,
        }),
      )
    } else if (embeddingOutcome?.status === "rejected") {
      const { error } = embeddingOutcome
      const reason = error instanceof Error ? error.message : "semantic_failure"
      this.logger.warn(
        `[typesense-watch-search] event=semantic_degraded error_class=${error instanceof Error ? error.constructor.name : "UnknownError"}`,
      )
      laneStatuses.push(
        laneStatus({
          lane: "semantic_embedding",
          status: "degraded",
          timelineStartedAt,
          startedAt: embeddingStartedAt,
          resultCount: 0,
          reason,
        }),
      )
    }

    const retrievalStartedAt = performance.now()
    const titleFields = watchLexicalQueryFields(queryLocale, "title")
    const metadataFields = watchLexicalQueryFields(queryLocale, "metadata")
    const searches = [
      lexicalLaneRequest(titleQuery, titleFields, candidateLimit, offset),
      lexicalLaneRequest(titleQuery, metadataFields, candidateLimit, offset),
      ...(embedding && evidenceLocales.length > 0
        ? [
            semanticLaneRequest(
              embedding,
              evidenceLocales,
              candidateLimit,
              offset,
            ),
          ]
        : []),
    ]
    try {
      const results = await this.typesense.multiSearch<
        TypesenseWatchLexicalDocument | TypesenseWatchTranscriptDocument
      >(searches)
      const titleGroups = (results[0]?.grouped_hits ??
        []) as TypesenseSearchGroup<TypesenseWatchLexicalDocument>[]
      const metadataGroups = (results[1]?.grouped_hits ??
        []) as TypesenseSearchGroup<TypesenseWatchLexicalDocument>[]
      const semanticGroups = (results[2]?.grouped_hits ??
        []) as TypesenseSearchGroup<TypesenseWatchTranscriptDocument>[]
      const candidateGroups = this.buildFusedCandidateGroups({
        query: titleQuery,
        titleFields,
        metadataFields,
        titleGroups,
        metadataGroups,
        semanticGroups,
        evidenceLocales,
      })
      const lexicalGroupIds = new Set(
        [...titleGroups, ...metadataGroups].map((group) => group.group_key[0]),
      )
      laneStatuses.push(
        laneStatus({
          lane: "metadata_retrieval",
          status: "fulfilled",
          timelineStartedAt,
          startedAt: retrievalStartedAt,
          resultCount: lexicalGroupIds.size,
        }),
        laneStatus({
          lane: "semantic_retrieval",
          status: embedding ? "fulfilled" : "skipped",
          timelineStartedAt,
          startedAt: retrievalStartedAt,
          resultCount: semanticGroups.length,
          reason: embedding ? undefined : "missing_query_embedding",
        }),
      )
      return {
        candidates: candidateGroups.flat(),
        nativeCandidateGroups: candidateGroups,
        nativeOffset: offset % Math.min(candidateLimit, MAX_FUSED_CANDIDATES),
        lexicalHits: [],
        nativeRanking: true,
      }
    } catch (error) {
      if (!isMissingLexicalProjection(error)) throw error
      const reason =
        error instanceof Error ? error.message : "lexical_projection_failure"
      this.logger.warn(
        `[typesense-watch-search] event=lexical_projection_fallback error_class=${error instanceof Error ? error.constructor.name : "UnknownError"}`,
      )
      const fallbackStartedAt = performance.now()
      const lexicalRequests = lexicalSearchRequests(
        titleQuery,
        candidateLimit,
        embedding
          ? TYPESENSE_MAX_MULTI_SEARCHES - 1
          : TYPESENSE_MAX_MULTI_SEARCHES,
      )
      const filterValues = evidenceLocales
        .map(({ locale }) => `\`${locale}\``)
        .join(",")
      const results = await this.typesense.multiSearch<
        TypesenseWatchCatalogPreviewDocument | TypesenseWatchTranscriptDocument
      >([
        ...lexicalRequests,
        ...(embedding
          ? [
              {
                collection: TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
                q: "*",
                vector_query: `embedding:([${embedding.join(",")}], k:${MAX_SEMANTIC_CANDIDATES})`,
                filter_by: `language:=[${filterValues}] && publiclyVisible:=true`,
                per_page: MAX_SEMANTIC_CANDIDATES,
                exclude_fields: "embedding",
              },
            ]
          : []),
      ])
      const lexicalHits = await this.withLegacyLocaleProjection(
        results
          .slice(0, lexicalRequests.length)
          .flatMap((result) => result.hits ?? [])
          .slice(
            0,
            candidateLimit,
          ) as TypesenseSearchHit<TypesenseWatchCatalogPreviewDocument>[],
      )
      const semanticHits = embedding
        ? ((results.at(-1)?.hits ??
            []) as TypesenseSearchHit<TypesenseWatchTranscriptDocument>[])
        : []
      laneStatuses.push(
        laneStatus({
          lane: "metadata_retrieval",
          status: "fulfilled",
          timelineStartedAt,
          startedAt: fallbackStartedAt,
          resultCount: lexicalHits.length,
        }),
        laneStatus({
          lane: "semantic_retrieval",
          status: embedding ? "degraded" : "skipped",
          timelineStartedAt,
          startedAt: fallbackStartedAt,
          resultCount: semanticHits.length,
          reason: embedding
            ? `lexical_projection_fallback:${reason}`
            : "missing_query_embedding",
        }),
      )
      return {
        candidates: this.buildCandidates({
          query: titleQuery,
          preferredLocale,
          lexicalHits,
          semanticHits,
          evidenceLocales,
        }),
        nativeCandidateGroups: null,
        nativeOffset: 0,
        lexicalHits,
        nativeRanking: false,
      }
    }
  }

  private buildFusedCandidateGroups({
    query,
    titleFields,
    metadataFields,
    titleGroups,
    metadataGroups,
    semanticGroups,
    evidenceLocales,
  }: {
    query: string
    titleFields: readonly string[]
    metadataFields: readonly string[]
    titleGroups: TypesenseSearchGroup<TypesenseWatchLexicalDocument>[]
    metadataGroups: TypesenseSearchGroup<TypesenseWatchLexicalDocument>[]
    semanticGroups: TypesenseSearchGroup<TypesenseWatchTranscriptDocument>[]
    evidenceLocales: Array<{ slug: string; locale: string }>
  }): Candidate[][] {
    const classifyTitleMatch = createTitleMatchClassifier(query)
    type GroupState = {
      canonicalVideoId: string
      fusedScore: number
      wholeTitleMatch: boolean
      members: Map<string, Candidate>
    }
    const groups = new Map<string, GroupState>()
    const maxCandidateScore =
      (TITLE_LANE_WEIGHT + METADATA_LANE_WEIGHT + SEMANTIC_LANE_WEIGHT) /
      (RRF_RANK_CONSTANT + 1)

    const lexicalValues = (
      document: TypesenseWatchLexicalDocument,
      fields: readonly string[],
    ): string[] =>
      fields.flatMap((field) => {
        const value = document[field]
        return Array.isArray(value)
          ? value
          : typeof value === "string"
            ? [value]
            : []
      })

    const addCandidate = (
      state: GroupState,
      candidate: Candidate,
      contribution: number,
    ) => {
      const existing = state.members.get(candidate.videoId)
      if (!existing) {
        state.members.set(candidate.videoId, {
          ...candidate,
          sourceScore: contribution,
        })
        return
      }
      const kindRank = { exact: 3, semantic: 2, metadata: 1 } as const
      const preferred =
        kindRank[candidate.kind] > kindRank[existing.kind]
          ? candidate
          : existing
      const semanticEvidence =
        existing.kind === "semantic"
          ? existing
          : candidate.kind === "semantic"
            ? candidate
            : null
      state.members.set(candidate.videoId, {
        ...preferred,
        wholeTitleMatch: existing.wholeTitleMatch || candidate.wholeTitleMatch,
        sourceScore: existing.sourceScore + contribution,
        ...(semanticEvidence
          ? {
              videoEditionId: semanticEvidence.videoEditionId,
              snippet: semanticEvidence.snippet,
              startSeconds: semanticEvidence.startSeconds,
              evidenceLanguageSlug: semanticEvidence.evidenceLanguageSlug,
            }
          : {
              snippet: candidate.snippet ?? existing.snippet,
              startSeconds: candidate.startSeconds ?? existing.startSeconds,
              evidenceLanguageSlug:
                candidate.evidenceLanguageSlug ?? existing.evidenceLanguageSlug,
            }),
      })
    }

    const addLexicalLane = (
      laneGroups: TypesenseSearchGroup<TypesenseWatchLexicalDocument>[],
      fields: readonly string[],
      weight: number,
      lane: "title" | "metadata",
    ) => {
      laneGroups.forEach((group, rank) => {
        const canonicalVideoId = group.group_key[0]
        if (!canonicalVideoId) return
        const contribution = weight / (RRF_RANK_CONSTANT + rank + 1)
        const state = groups.get(canonicalVideoId) ?? {
          canonicalVideoId,
          fusedScore: 0,
          wholeTitleMatch: false,
          members: new Map<string, Candidate>(),
        }
        state.fusedScore += contribution
        for (const hit of group.hits) {
          const values = lexicalValues(hit.document, fields)
          const { exact, wholeTitleMatch } =
            lane === "title"
              ? classifyTitleMatch(values)
              : { exact: false, wholeTitleMatch: false }
          state.wholeTitleMatch ||= wholeTitleMatch
          addCandidate(
            state,
            {
              videoId: hit.document.videoId,
              videoEditionId: null,
              kind: exact ? "exact" : "metadata",
              wholeTitleMatch,
              sourceScore: 0,
              evidenceLanguageSlug: null,
              snippet: lane === "metadata" ? (values[0] ?? null) : null,
              startSeconds: null,
            },
            contribution,
          )
        }
        groups.set(canonicalVideoId, state)
      })
    }

    addLexicalLane(titleGroups, titleFields, TITLE_LANE_WEIGHT, "title")
    addLexicalLane(
      metadataGroups,
      metadataFields,
      METADATA_LANE_WEIGHT,
      "metadata",
    )
    semanticGroups.forEach((group, rank) => {
      const canonicalVideoId = group.group_key[0]
      if (!canonicalVideoId) return
      const relevantHits = group.hits.filter(
        (hit) =>
          hit.vector_distance != null &&
          1 - hit.vector_distance >= MIN_SEMANTIC_SIMILARITY,
      )
      if (relevantHits.length === 0) return
      const contribution = SEMANTIC_LANE_WEIGHT / (RRF_RANK_CONSTANT + rank + 1)
      const state = groups.get(canonicalVideoId) ?? {
        canonicalVideoId,
        fusedScore: 0,
        wholeTitleMatch: false,
        members: new Map<string, Candidate>(),
      }
      state.fusedScore += contribution
      const winningHitByVideoId = new Map<
        string,
        TypesenseSearchHit<TypesenseWatchTranscriptDocument>
      >()
      for (const hit of relevantHits) {
        const existing = winningHitByVideoId.get(hit.document.videoId)
        if (
          !existing ||
          (hit.vector_distance ?? 1) < (existing.vector_distance ?? 1)
        ) {
          winningHitByVideoId.set(hit.document.videoId, hit)
        }
      }
      for (const hit of winningHitByVideoId.values()) {
        addCandidate(
          state,
          {
            videoId: hit.document.videoId,
            videoEditionId: hit.document.videoEditionId ?? null,
            kind: "semantic",
            wholeTitleMatch: false,
            sourceScore: 0,
            evidenceLanguageSlug:
              evidenceLocales.find(
                ({ locale }) => locale === hit.document.language,
              )?.slug ?? null,
            snippet: hit.document.text,
            startSeconds:
              hit.document.startSeconds == null
                ? null
                : Math.max(0, Math.floor(hit.document.startSeconds)),
          },
          contribution,
        )
      }
      groups.set(canonicalVideoId, state)
    })

    return [...groups.values()]
      .sort((left, right) => {
        const wholeTitleDelta =
          Number(right.wholeTitleMatch) - Number(left.wholeTitleMatch)
        if (wholeTitleDelta !== 0) return wholeTitleDelta
        const scoreDelta = right.fusedScore - left.fusedScore
        if (scoreDelta !== 0) return scoreDelta
        return left.canonicalVideoId.localeCompare(right.canonicalVideoId)
      })
      .map((group) =>
        [...group.members.values()]
          .map((candidate) => ({
            ...candidate,
            sourceScore: Math.min(1, candidate.sourceScore / maxCandidateScore),
          }))
          .sort((left, right) => {
            const wholeTitleDelta =
              Number(right.wholeTitleMatch) - Number(left.wholeTitleMatch)
            if (wholeTitleDelta !== 0) return wholeTitleDelta
            const scoreDelta = right.sourceScore - left.sourceScore
            if (scoreDelta !== 0) return scoreDelta
            return left.videoId.localeCompare(right.videoId)
          }),
      )
  }

  private buildCandidates({
    query,
    preferredLocale,
    lexicalHits,
    semanticHits,
    evidenceLocales,
  }: {
    query: string
    preferredLocale: string
    lexicalHits: TypesenseSearchHit<TypesenseWatchCatalogPreviewDocument>[]
    semanticHits: TypesenseSearchHit<TypesenseWatchTranscriptDocument>[]
    evidenceLocales: Array<{ slug: string; locale: string }>
  }): Candidate[] {
    const candidates = new Map<string, Candidate>()
    const classifyTitleMatch = createTitleMatchClassifier(query)
    lexicalHits.forEach((hit, index) => {
      const locale = displayPreviewLocale(hit.document, preferredLocale)
      const { exact, wholeTitleMatch } = classifyTitleMatch([locale.title])
      candidates.set(hit.document.id, {
        videoId: hit.document.id,
        videoEditionId: null,
        kind: exact ? "exact" : "metadata",
        wholeTitleMatch,
        sourceScore: exact
          ? 1
          : Math.max(0.3, 1 - index / Math.max(lexicalHits.length, 1) / 2),
        evidenceLanguageSlug: null,
        snippet: locale.description,
        startSeconds: null,
      })
    })
    for (const hit of semanticHits) {
      const similarity = 1 - (hit.vector_distance ?? 1)
      if (similarity < MIN_SEMANTIC_SIMILARITY) continue
      const existing = candidates.get(hit.document.videoId)
      if (existing && existing.kind !== "semantic") continue
      if (existing && existing.sourceScore >= similarity) continue
      candidates.set(hit.document.videoId, {
        videoId: hit.document.videoId,
        videoEditionId: hit.document.videoEditionId ?? null,
        kind: "semantic",
        wholeTitleMatch: false,
        sourceScore: Math.max(0, Math.min(1, similarity)),
        evidenceLanguageSlug:
          evidenceLocales.find(({ locale }) => locale === hit.document.language)
            ?.slug ?? null,
        snippet: hit.document.text,
        startSeconds:
          hit.document.startSeconds == null
            ? null
            : Math.max(0, Math.floor(hit.document.startSeconds)),
      })
    }
    return [...candidates.values()]
  }

  private async hydrateResultDocuments(
    candidates: readonly CandidateHydrationScope[],
    target: TargetLanguageContext,
  ): Promise<Map<string, HydratedResultDocument>> {
    const candidateScopeByVideoId = new Map<string, CandidateHydrationScope>()
    for (const candidate of candidates) {
      if (!candidateScopeByVideoId.has(candidate.videoId)) {
        candidateScopeByVideoId.set(candidate.videoId, candidate)
      }
    }
    const ids = [...candidateScopeByVideoId.keys()]
    if (ids.length === 0) return new Map()

    const catalogSearches: TypesenseSearchRequest[] = []
    for (let index = 0; index < ids.length; index += TYPESENSE_MAX_PER_PAGE) {
      const batch = ids.slice(index, index + TYPESENSE_MAX_PER_PAGE)
      catalogSearches.push({
        collection: TYPESENSE_WATCH_CATALOG_ALIAS,
        q: "*",
        filter_by: `id:=[${batch.map((id) => `\`${id}\``).join(",")}]`,
        per_page: batch.length,
        include_fields: CATALOG_RESULT_FIELDS,
      })
    }
    const availabilitySearches: TypesenseSearchRequest[] = []
    const addAvailabilitySearches = (
      languageIds: readonly string[],
      audioOnly: boolean,
    ) => {
      if (languageIds.length === 0) return
      const videoBatchSize = Math.max(
        1,
        Math.floor(TYPESENSE_MAX_PER_PAGE / languageIds.length),
      )
      for (let index = 0; index < ids.length; index += videoBatchSize) {
        const batch = ids.slice(index, index + videoBatchSize)
        availabilitySearches.push({
          collection: TYPESENSE_WATCH_AVAILABILITY_ALIAS,
          q: "*",
          filter_by: `videoId:=[${batch.map((id) => `\`${id}\``).join(",")}] && languageId:=[${languageIds.map((id) => `\`${id}\``).join(",")}]${audioOnly ? " && audio:=true" : ""}`,
          per_page: TYPESENSE_MAX_PER_PAGE,
          include_fields: AVAILABILITY_RESULT_FIELDS,
        })
      }
    }
    if (target.id) addAvailabilitySearches([target.id], false)
    addAvailabilitySearches(
      target.fallbackLanguageIds.filter((id) => id !== target.id),
      true,
    )

    try {
      const initialResults = await this.multiSearchInBatches<
        TypesenseWatchCatalogResultDocument | TypesenseWatchAvailabilityDocument
      >([...catalogSearches, ...availabilitySearches])
      const catalogResults = initialResults.slice(0, catalogSearches.length)
      const availabilityResults = initialResults.slice(catalogSearches.length)
      const overflowSearches: TypesenseSearchRequest[] = []
      for (const [index, result] of availabilityResults.entries()) {
        const request = availabilitySearches[index]
        if (!request) continue
        const overflowPages = Math.max(
          0,
          Math.ceil(result.found / TYPESENSE_MAX_PER_PAGE) - 1,
        )
        if (
          overflowSearches.length + overflowPages >
          MAX_AVAILABILITY_OVERFLOW_SEARCHES
        ) {
          throw new AvailabilityOverflowError()
        }
        for (let page = 0; page < overflowPages; page += 1) {
          overflowSearches.push({ ...request, page: page + 2 })
        }
      }
      const overflowResults =
        await this.multiSearchInBatches<TypesenseWatchAvailabilityDocument>(
          overflowSearches,
        )
      const availabilityByVideoId = new Map<
        string,
        TypesenseWatchAvailabilityDocument[]
      >()
      for (const hit of [...availabilityResults, ...overflowResults].flatMap(
        (result) => result.hits ?? [],
      )) {
        const document = hit.document as TypesenseWatchAvailabilityDocument
        const entries = availabilityByVideoId.get(document.videoId) ?? []
        entries.push(document)
        availabilityByVideoId.set(document.videoId, entries)
      }
      return new Map(
        catalogResults
          .flatMap((result) => result.hits ?? [])
          .map((hit) => {
            const document = hit.document as TypesenseWatchCatalogResultDocument
            const candidateScope = candidateScopeByVideoId.get(document.id)
            return [
              document.id,
              {
                document,
                watchability: resolveWatchability(
                  availabilityByVideoId.get(document.id) ?? [],
                  target,
                  candidateScope?.videoEditionId ?? null,
                  candidateScope?.kind === "semantic",
                ),
              },
            ] as const
          }),
      )
    } catch (error) {
      const legacyProjection = isLegacyAvailabilityProjection(error)
      const missingAlias =
        !legacyProjection && isMissingAvailabilityAlias(error)
      const overflow = error instanceof AvailabilityOverflowError
      if (!missingAlias && !legacyProjection && !overflow) throw error
      this.logger.warn(
        `[typesense-watch-search] event=${missingAlias ? "availability_alias_fallback" : overflow ? "availability_overflow_fallback" : "availability_projection_fallback"}`,
      )
      const legacyById =
        await this.catalogDocuments<TypesenseWatchLegacyCatalogResultDocument>(
          ids,
          LEGACY_CATALOG_RESULT_FIELDS,
        )
      return new Map(
        [...legacyById].map(([id, document]) => [
          id,
          {
            document,
            watchability: resolveLegacyWatchability(
              document,
              target,
              candidateScopeByVideoId.get(id)?.videoEditionId ?? null,
              candidateScopeByVideoId.get(id)?.kind === "semantic",
            ),
          },
        ]),
      )
    }
  }

  private async multiSearchInBatches<TDocument>(
    searches: readonly TypesenseSearchRequest[],
  ): Promise<TypesenseSearchResult<TDocument>[]> {
    const results: TypesenseSearchResult<TDocument>[] = []
    for (
      let index = 0;
      index < searches.length;
      index += TYPESENSE_MAX_MULTI_SEARCHES
    ) {
      results.push(
        ...(await this.typesense.multiSearch<TDocument>(
          searches.slice(index, index + TYPESENSE_MAX_MULTI_SEARCHES),
        )),
      )
    }
    return results
  }

  private async catalogDocuments<
    TDocument extends { id: string } = TypesenseWatchCatalogDocument,
  >(
    videoIds: readonly string[],
    includeFields?: string,
  ): Promise<Map<string, TDocument>> {
    const ids = [...new Set(videoIds)]
    if (ids.length === 0) return new Map()
    const searches = []
    for (
      let index = 0;
      index < ids.length;
      index += MAX_CATALOG_HYDRATION_BATCH
    ) {
      const batch = ids.slice(index, index + MAX_CATALOG_HYDRATION_BATCH)
      searches.push({
        collection: TYPESENSE_WATCH_CATALOG_ALIAS,
        q: "*",
        filter_by: `id:=[${batch.map((id) => `\`${id}\``).join(",")}]`,
        per_page: batch.length,
        include_fields: includeFields,
      })
    }
    const results = await this.typesense.multiSearch<TDocument>(searches)
    return new Map(
      results.flatMap((result) =>
        (result.hits ?? []).map(
          (hit) => [hit.document.id, hit.document] as const,
        ),
      ),
    )
  }

  private async withLegacyLocaleProjection(
    hits: TypesenseSearchHit<TypesenseWatchCatalogPreviewDocument>[],
  ): Promise<TypesenseSearchHit<TypesenseWatchCatalogPreviewDocument>[]> {
    const legacyIds = hits
      .filter((hit) => !hasAlignedLocaleCodes(hit.document))
      .map((hit) => hit.document.id)
    if (legacyIds.length === 0) return hits

    const legacyById =
      await this.catalogDocuments<TypesenseWatchLegacyCatalogLocaleDocument>(
        legacyIds,
        LEGACY_CATALOG_LOCALE_FIELDS,
      )
    return hits.map((hit) => {
      const legacy = legacyById.get(hit.document.id)
      return legacy
        ? {
            ...hit,
            document: {
              ...hit.document,
              localesJson: legacy.localesJson,
            },
          }
        : hit
    })
  }

  private async targetLanguageContext(
    targetLanguageSlug: string,
  ): Promise<TargetLanguageContext> {
    const language = await this.prisma.language.findFirst({
      where: { slug: targetLanguageSlug, deletedAt: null },
      select: { id: true, slug: true, name: true },
    })
    if (!language?.slug) {
      return {
        id: null,
        slug: targetLanguageSlug,
        englishName: null,
        fallbackLanguageIds: [],
        fallbackLanguageSlugs: [],
      }
    }
    const fallbacks = await this.prisma.languageFallback.findMany({
      where: { sourceLanguageId: language.id, deletedAt: null },
      orderBy: [{ priority: "asc" }, { fallbackLanguageId: "asc" }],
      take: 12,
      select: {
        fallbackLanguageId: true,
        fallbackLanguage: { select: { slug: true } },
      },
    })
    return {
      id: language.id,
      slug: language.slug,
      englishName: englishName(language.name),
      fallbackLanguageIds: fallbacks.map((row) => row.fallbackLanguageId),
      fallbackLanguageSlugs: fallbacks.flatMap((row) =>
        row.fallbackLanguage.slug ? [row.fallbackLanguage.slug] : [],
      ),
    }
  }

  private async evidenceLocales(
    interpretation: WatchSearchLanguageInterpretation,
  ): Promise<Array<{ slug: string; locale: string }>> {
    const slugs = [
      interpretation.targetLanguageSlug,
      interpretation.queryLanguageSlug,
      interpretation.queryNamedLanguageSlug,
      interpretation.displayLanguageSlug,
      interpretation.routeLanguageSlug,
    ]
      .filter((value): value is string => Boolean(value))
      .filter((value, index, all) => all.indexOf(value) === index)
      .slice(0, MAX_EVIDENCE_LOCALES)
    const rows = await this.prisma.language.findMany({
      where: { slug: { in: slugs }, deletedAt: null },
      select: { slug: true, bcp47: true },
    })
    const bcp47BySlug = new Map(
      rows.flatMap((row) =>
        row.slug && row.bcp47 ? [[row.slug, row.bcp47] as const] : [],
      ),
    )
    return slugs.flatMap((slug) => {
      const locale = localeForLanguageSlug(slug) ?? bcp47BySlug.get(slug)
      return locale ? [{ slug, locale }] : []
    })
  }

  private async emptyResponse(
    input: WatchSearchInput,
    query: string,
    startedAt: number,
  ): Promise<WatchSearchResponse> {
    const languageInterpretation = await resolveSearchLanguageSignals({
      prisma: this.prisma,
      input,
    })
    return {
      query,
      results: [],
      hasMore: false,
      nextOffset: normalizeOffset(input.offset) + normalizeLimit(input.limit),
      searchMode: "watch-search-typesense",
      requestId: normalizeRequestId(input.clientRequestId),
      degraded: false,
      latencyMs: performance.now() - startedAt,
      laneStatuses: [],
      languageInterpretation,
    }
  }
}

export function createTypesenseWatchSearchService(
  prisma: PrismaClient,
): TypesenseWatchSearchService | null {
  const host = process.env.TYPESENSE_HOST
  const apiKey = process.env.TYPESENSE_API_KEY
  if (!host || !apiKey) return null
  return new TypesenseWatchSearchService(
    prisma,
    new TypesenseClient({ host, apiKey, timeoutMs: 2_000 }),
  )
}

export function isTypesenseUnavailable(error: unknown): boolean {
  return (
    error instanceof TypesenseRequestError ||
    error instanceof TypesenseWatchSearchUnavailableError
  )
}
