import { randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"

import {
  cachedBoundedTtlValue,
  type BoundedTtlCache,
} from "./bounded-ttl-promise-cache"
import {
  TypesenseClient,
  TypesenseRequestError,
  type TypesenseSearchGroup,
  type TypesenseSearchHit,
  type TypesenseSearchRequest,
  type TypesenseSearchResult,
} from "./typesense-client"
import { resolveTypesenseWatchSearchApiKey } from "./typesense-client-config"
import { tokenizeForExactTitle } from "./hybrid-search-keyword-first-retrievers"
import {
  type TypesenseWatchAudioOption,
  type TypesenseWatchAvailabilityDocument,
  type TypesenseWatchCatalogDocument,
  type TypesenseWatchSubtitleOption,
  type TypesenseWatchTranscriptDocument,
} from "./typesense-watch-search-schema"
import {
  TYPESENSE_WATCH_EXACT_TITLE_KEYS_FIELD,
  typesenseWatchExactTitleKey,
} from "./typesense-watch-search-exact-title"
import {
  typesenseWatchLanguageIdentity,
  type TypesenseWatchLexicalDocument,
} from "./typesense-watch-search-lexical"
import {
  displayLocale,
  displayPreviewLocale,
  hasAlignedLocaleCodes,
  type TypesenseWatchCatalogPreviewDocument,
  watchLexicalOrderedManifestQueryFields,
  watchLexicalQueryFields,
} from "./typesense-watch-search-locales"
import {
  createCurrentWatchSearchProfile,
  type TypesenseWatchSearchCollectionBinding,
  type TypesenseWatchSearchProfile,
} from "./typesense-watch-search-profile"
import {
  resolveSearchLanguageSignals,
  resolveSearchQueryScriptContext,
  type SearchLanguageSignalSource,
} from "./search-language-resolution"
import {
  buildTypesenseWatchSearchQueryPlan,
  type TypesenseWatchQueryLanguageCandidate,
} from "./typesense-watch-search-query-plan"
import {
  compareSemanticRankingGroups,
  normalizeWatchSearchTitle,
  rankWatchSearchGroups,
  WATCH_SEARCH_LEGACY_RANKING_IMPLEMENTATION,
  WATCH_SEARCH_TITLE_AND_BRAND_RANKING_IMPLEMENTATION,
  type WatchSearchRankingImplementation,
  type WatchSearchRankingAnchor,
  type WatchSearchRankingEvidenceTier,
  type WatchSearchRankingGroup,
  type WatchSearchRankingMode,
} from "./typesense-watch-search-ranking"
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
const TYPESENSE_MATCHED_TOKEN_CAP = 15
const DROPPED_TOKEN_QUALITY_FACTOR = 0.2
const TYPO_PREFIX_QUALITY_COST = 0.25
const MAX_CATALOG_HYDRATION_BATCH = 250
const MAX_EVIDENCE_LOCALES = 3
const MAX_RANKING_TRACE_ENTRIES = 250
const DEFAULT_EMBEDDING_TIMEOUT_MS = 1_000
const LANGUAGE_CONTEXT_CACHE_TTL_MS = 5 * 60 * 1_000
const LANGUAGE_CONTEXT_CACHE_MAX_ENTRIES = 4_096
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

function nonNegativeInteger(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0
}

export function typesenseLexicalMatchQuality(
  matchInfo: TypesenseSearchHit<unknown>["text_match_info"],
): number {
  const tokensMatched = nonNegativeInteger(matchInfo?.tokens_matched)
  const reportedDrops = nonNegativeInteger(matchInfo?.num_tokens_dropped)
  const typoPrefixScore = nonNegativeInteger(matchInfo?.typo_prefix_score)
  const effectiveDrops =
    tokensMatched === TYPESENSE_MATCHED_TOKEN_CAP && reportedDrops > 0
      ? 0
      : reportedDrops
  const droppedTokenQuality = DROPPED_TOKEN_QUALITY_FACTOR ** effectiveDrops
  const typoPrefixQuality = 1 / (1 + TYPO_PREFIX_QUALITY_COST * typoPrefixScore)
  return droppedTokenQuality * typoPrefixQuality
}

type TypesenseWatchSearchDeps = {
  embedder?: WatchSearchQueryEmbedder
  embeddingTimeoutMs?: number
  logger?: Pick<Console, "warn">
  profile?: TypesenseWatchSearchProfile
}

export type TypesenseWatchSearchDiagnostics = {
  profile: TypesenseWatchSearchProfile["kind"]
  generationId: string | null
  applicationRevision: string | null
  transcriptProjectionRevision: bigint | null
  binding: TypesenseWatchSearchCollectionBinding
  retrievalCalls: number
  logicalSubsearches: number
  queryFieldCount: number
  queryByBytes: number
  requestBytes: number
  parsedResponseBytes: number
  typesenseSearchTimeMs: number
  typesenseWallTimeMs: number
  retryCount: number
  groupedHits: number
  candidates: number
  hydratedRecords: number
  rankingImplementation: WatchSearchRankingImplementation
  rankingMode: WatchSearchRankingMode
  rankingAnchor: WatchSearchRankingAnchor | null
  rankingTrace: TypesenseWatchSearchRankingTrace[]
  rankingTraceTotal?: number
  rankingTraceTruncated?: boolean
}

export type TypesenseWatchSearchRankingTrace = {
  canonicalVideoId: string
  retrievalSources: TypesenseWatchSearchRetrievalSource[]
  evidenceTier: WatchSearchRankingEvidenceTier
  fusedScore: number
  wholeTitleMatch: boolean
  titleRank: number | null
  titleContribution: number
  metadataRank: number | null
  metadataContribution: number
  semanticRank: number | null
  semanticContribution: number
  selectedVideoId: string | null
  watchabilityOutcome: IndexedWatchability["kind"] | null
  finalRank: number | null
}

export type TypesenseWatchSearchRetrievalSource =
  | "global_exact_title"
  | "localized_title"
  | "metadata"
  | "semantic"

const WATCH_SEARCH_RETRIEVAL_SOURCE_ORDER = [
  "global_exact_title",
  "localized_title",
  "metadata",
  "semantic",
] as const satisfies readonly TypesenseWatchSearchRetrievalSource[]

function orderedRetrievalSources(
  sources: Iterable<TypesenseWatchSearchRetrievalSource>,
): TypesenseWatchSearchRetrievalSource[] {
  const sourceSet = new Set(sources)
  return WATCH_SEARCH_RETRIEVAL_SOURCE_ORDER.filter((source) =>
    sourceSet.has(source),
  )
}

function mergeRetrievalSources(
  left?: TypesenseWatchSearchRetrievalSource[],
  right?: TypesenseWatchSearchRetrievalSource[],
): TypesenseWatchSearchRetrievalSource[] | undefined {
  if (left == null && right == null) return undefined
  return orderedRetrievalSources([...(left ?? []), ...(right ?? [])])
}

type MutableSearchDiagnostics = Omit<
  TypesenseWatchSearchDiagnostics,
  "queryFieldCount"
> & {
  queryFields: Set<string>
}

type Candidate = {
  videoId: string
  videoEditionId: string | null
  kind: "exact" | "metadata" | "semantic"
  retrievalSources?: TypesenseWatchSearchRetrievalSource[]
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
  groups: RankedCandidateGroup[]
  rankingMode: WatchSearchRankingMode
  rankingAnchor: WatchSearchRankingAnchor | null
} & (
  | {
      kind: "native"
      nativeOffset: number
      lexicalHits: []
    }
  | {
      kind: "compatibility"
      nativeOffset: 0
      lexicalHits: TypesenseSearchHit<TypesenseWatchCatalogPreviewDocument>[]
    }
)

type RankedCandidateGroup = WatchSearchRankingGroup & {
  evidenceTier: WatchSearchRankingEvidenceTier
  members: Candidate[]
}

type EmbeddingOutcome =
  | { status: "fulfilled"; embedding: number[]; elapsedMs: number }
  | { status: "rejected"; error: unknown; elapsedMs: number }

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

const targetLanguageContextCaches = new WeakMap<
  object,
  BoundedTtlCache<TargetLanguageContext>
>()
const evidenceLocaleCaches = new WeakMap<
  object,
  BoundedTtlCache<Array<{ slug: string; locale: string }>>
>()

export class TypesenseWatchSearchUnavailableError extends Error {
  constructor(message = "Typesense Watch Search is not configured") {
    super(message)
    this.name = "TypesenseWatchSearchUnavailableError"
  }
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

function isMissingAvailabilityProjection(
  error: unknown,
  _collection: string,
): boolean {
  return error instanceof TypesenseRequestError && error.status === 404
}

function isMissingLexicalProjection(
  error: unknown,
  collection: string,
): boolean {
  return (
    error instanceof TypesenseRequestError &&
    (error.status === 400 || error.status === 404) &&
    new RegExp(
      `${collection.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|title_[a-z]|metadata_[a-z]|canonicalVideoId|videoEditionId|languageIdentity`,
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

function lexicalEvidenceLanguageSlug(identity: string): string | null {
  const match = /^slug:(.+)$/.exec(identity)
  return match?.[1] ?? null
}

function signalSourceForCandidate(
  candidate: TypesenseWatchQueryLanguageCandidate,
): SearchLanguageSignalSource {
  if (candidate.reason === "explicit_target") return "explicit_target"
  if (candidate.reason === "script") return "query_script"
  if (candidate.reason === "context") return "current_watch"
  return "query_named_language"
}

function normalizedLegacyTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase()
}

function createLegacyTitleMatchClassifier(query: string) {
  const normalizedQuery = normalizedLegacyTitle(query)
  const exactTitleTokens = tokenizeForExactTitle(query)
  return (titles: readonly string[]) => {
    const normalizedTitles = titles.map(normalizedLegacyTitle)
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

function createCandidateTitleMatchClassifier(query: string, locale: string) {
  const normalizedQuery = normalizeWatchSearchTitle(query, locale)
  const exactTitleTokens = tokenizeForExactTitle(normalizedQuery.core)
  return (titles: readonly string[]) => {
    const normalizedTitles = titles.map((title) =>
      normalizeWatchSearchTitle(title, locale),
    )
    const exact = normalizedTitles.some((title) => {
      const wholeOrCoreMatch =
        title.normalized === normalizedQuery.normalized ||
        title.compact === normalizedQuery.compact ||
        (normalizedQuery.coreTokens.length > 1 &&
          title.coreTokens.length > 1 &&
          title.compactCore === normalizedQuery.compactCore)
      return (
        wholeOrCoreMatch ||
        (exactTitleTokens.length > 0 &&
          exactTitleTokens.every((token) => title.coreTokens.includes(token)))
      )
    })
    return {
      exact,
      wholeTitleMatch:
        exact &&
        normalizedTitles.some(
          (title) =>
            title.normalized === normalizedQuery.normalized ||
            (title.compact === normalizedQuery.compact &&
              title.compactCore === normalizedQuery.compactCore),
        ),
    }
  }
}

function lexicalSearchRequests(
  collection: string,
  query: string,
  candidateLimit: number,
  maxRequests = TYPESENSE_MAX_MULTI_SEARCHES,
): TypesenseSearchRequest[] {
  const perPage = Math.min(candidateLimit, TYPESENSE_MAX_PER_PAGE)
  const pageCount = Math.min(Math.ceil(candidateLimit / perPage), maxRequests)
  return Array.from({ length: pageCount }, (_value, index) => ({
    collection,
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
  collection: string,
  query: string,
  fields: readonly string[],
  languageIdentities: readonly string[] | null,
  candidateLimit: number,
  offset: number,
): TypesenseSearchRequest {
  const perPage = Math.min(candidateLimit, MAX_FUSED_CANDIDATES)
  const isFallbackField = (field: string) => field.endsWith("_fallback")
  return {
    collection,
    q: query,
    query_by: fields.join(","),
    query_by_weights: fields
      .map((field) => (isFallbackField(field) ? 1 : 4))
      .join(","),
    page: Math.floor(offset / perPage) + 1,
    per_page: perPage,
    group_by: "canonicalVideoId",
    group_limit: HYBRID_GROUP_LIMIT,
    filter_by: languageIdentities
      ? `languageIdentity:=[${languageIdentities.map((identity) => `\`${identity}\``).join(",")}]`
      : undefined,
    prefix: true,
    num_typos: fields
      .map((field) => (isFallbackField(field) ? 1 : 2))
      .join(","),
    split_join_tokens: "always",
    text_match_type: "max_weight",
    prioritize_exact_match: true,
    drop_tokens_threshold: 1,
    include_fields: [
      "id",
      "videoId",
      "canonicalVideoId",
      "languageIdentity",
      "localeCodes",
      ...fields,
    ].join(","),
  }
}

function exactTitleLaneRequest(
  collection: string,
  query: string,
  titleFields: readonly string[],
  candidateLimit: number,
  offset: number,
): TypesenseSearchRequest {
  const perPage = Math.min(candidateLimit, MAX_FUSED_CANDIDATES)
  return {
    collection,
    q: typesenseWatchExactTitleKey(query) ?? "__no_exact_title__",
    query_by: TYPESENSE_WATCH_EXACT_TITLE_KEYS_FIELD,
    page: Math.floor(offset / perPage) + 1,
    per_page: perPage,
    group_by: "canonicalVideoId",
    group_limit: HYBRID_GROUP_LIMIT,
    prefix: false,
    num_typos: 0,
    drop_tokens_threshold: 0,
    include_fields: [
      "id",
      "videoId",
      "canonicalVideoId",
      "languageIdentity",
      "localeCodes",
      TYPESENSE_WATCH_EXACT_TITLE_KEYS_FIELD,
      ...titleFields,
    ].join(","),
  }
}

function semanticLaneRequest(
  collection: string,
  embedding: readonly number[],
  evidenceLocales: Array<{ slug: string; locale: string }>,
  candidateLimit: number,
  offset: number,
  globalRecall = false,
): TypesenseSearchRequest {
  const vectorCandidateLimit = HYBRID_VECTOR_CANDIDATES
  const perPage = Math.min(candidateLimit, MAX_FUSED_CANDIDATES)
  const filterValues = evidenceLocales
    .map(({ locale }) => `\`${locale}\``)
    .join(",")
  return {
    collection,
    q: "*",
    vector_query: `embedding:([${embedding.join(",")}], k:${vectorCandidateLimit}, distance_threshold:${1 - MIN_SEMANTIC_SIMILARITY})`,
    filter_by: globalRecall
      ? "documentKind:=transcript && publiclyVisible:=true"
      : `documentKind:=transcript && publiclyVisible:=true && language:=[${filterValues}]`,
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
  elapsedMs,
}: {
  lane: WatchSearchLaneStatus["lane"]
  status: WatchSearchLaneStatus["status"]
  timelineStartedAt: number
  startedAt: number
  resultCount: number
  reason?: string | null
  elapsedMs?: number
}): WatchSearchLaneStatus {
  return {
    lane,
    status,
    startedOffsetMs: Math.max(0, startedAt - timelineStartedAt),
    elapsedMs: elapsedMs ?? performance.now() - startedAt,
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
  private readonly profile: TypesenseWatchSearchProfile
  private readonly rankingImplementation: WatchSearchRankingImplementation

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
    this.profile = deps.profile ?? createCurrentWatchSearchProfile()
    this.rankingImplementation =
      this.profile.kind === "CANDIDATE"
        ? WATCH_SEARCH_TITLE_AND_BRAND_RANKING_IMPLEMENTATION
        : WATCH_SEARCH_LEGACY_RANKING_IMPLEMENTATION
  }

  async searchWithDiagnostics(input: WatchSearchInput): Promise<{
    response: WatchSearchResponse
    diagnostics: TypesenseWatchSearchDiagnostics
  }> {
    const diagnostics: MutableSearchDiagnostics = {
      profile: this.profile.kind,
      generationId: this.profile.generationId,
      applicationRevision: this.profile.applicationRevision,
      transcriptProjectionRevision: this.profile.transcriptProjectionRevision,
      binding: this.profile.binding,
      retrievalCalls: 0,
      logicalSubsearches: 0,
      queryFields: new Set(),
      queryByBytes: 0,
      requestBytes: 0,
      parsedResponseBytes: 0,
      typesenseSearchTimeMs: 0,
      typesenseWallTimeMs: 0,
      retryCount: 0,
      groupedHits: 0,
      candidates: 0,
      hydratedRecords: 0,
      rankingImplementation: this.rankingImplementation,
      rankingMode: "SEMANTIC",
      rankingAnchor: null,
      rankingTrace: [],
      rankingTraceTotal: 0,
      rankingTraceTruncated: false,
    }
    const response = await this.executeSearch(input, diagnostics)
    const { queryFields, ...publicDiagnostics } = diagnostics
    return {
      response,
      diagnostics: {
        ...publicDiagnostics,
        queryFieldCount: queryFields.size,
      },
    }
  }

  private async multiSearch<T>(
    searches: readonly TypesenseSearchRequest[],
    diagnostics?: MutableSearchDiagnostics,
  ): Promise<TypesenseSearchResult<T>[]> {
    if (diagnostics) {
      diagnostics.retrievalCalls += 1
      diagnostics.logicalSubsearches += searches.length
      diagnostics.requestBytes += Buffer.byteLength(
        JSON.stringify({ searches }),
      )
      for (const search of searches) {
        const queryBy = String(search.query_by ?? "")
        diagnostics.queryByBytes += Buffer.byteLength(queryBy)
        for (const field of queryBy.split(",").filter(Boolean)) {
          diagnostics.queryFields.add(field)
        }
      }
    }
    const startedAt = diagnostics ? performance.now() : 0
    const results = await this.typesense.multiSearch<T>(searches)
    if (diagnostics) {
      diagnostics.typesenseWallTimeMs += performance.now() - startedAt
      diagnostics.parsedResponseBytes += Buffer.byteLength(
        JSON.stringify(results),
      )
      diagnostics.typesenseSearchTimeMs += results.reduce(
        (total, result) => total + result.search_time_ms,
        0,
      )
      diagnostics.groupedHits += results.reduce(
        (total, result) => total + (result.grouped_hits?.length ?? 0),
        0,
      )
    }
    return results
  }

  async search(input: WatchSearchInput): Promise<WatchSearchResponse> {
    return this.executeSearch(input)
  }

  private async executeSearch(
    input: WatchSearchInput,
    diagnostics?: MutableSearchDiagnostics,
  ): Promise<WatchSearchResponse> {
    const startedAt = performance.now()
    const query = input.query.trim().slice(0, MAX_QUERY_LENGTH)
    if (!query) throw new WatchSearchValidationError("Search query is required")
    if (input.resultTypes?.length && !input.resultTypes.includes("video")) {
      return this.emptyResponse(input, query, startedAt)
    }

    const limit = normalizeLimit(input.limit)
    const offset = normalizeOffset(input.offset)
    const laneStatuses: WatchSearchLaneStatus[] = []
    const embeddingStartedAt = performance.now()
    const embeddingPromise: Promise<EmbeddingOutcome> = withTimeout(
      Promise.resolve().then(() => this.embedder(query)),
      this.embeddingTimeoutMs,
    ).then(
      (embedded) => ({
        status: "fulfilled",
        embedding: Array.isArray(embedded) ? embedded : [...embedded.embedding],
        elapsedMs: performance.now() - embeddingStartedAt,
      }),
      (error: unknown) => ({
        status: "rejected",
        error,
        elapsedMs: performance.now() - embeddingStartedAt,
      }),
    )
    const languageStartedAt = performance.now()
    const baseLanguageInterpretation = await resolveSearchLanguageSignals({
      prisma: this.prisma,
      input,
    })
    const candidateQueryPlan =
      this.profile.kind === "CANDIDATE"
        ? await buildTypesenseWatchSearchQueryPlan({
            prisma: this.prisma,
            query,
            baseResolution: baseLanguageInterpretation,
          })
        : null
    let languageInterpretation = candidateQueryPlan
      ? {
          ...baseLanguageInterpretation,
          targetLanguageSlug: candidateQueryPlan.targetLanguageSlug,
          targetLanguageSource: candidateQueryPlan.targetLanguageSource,
          queryNamedLanguageSlug:
            candidateQueryPlan.namedLanguageSlug ??
            baseLanguageInterpretation.queryNamedLanguageSlug,
        }
      : baseLanguageInterpretation
    const provisionalTargetLanguageSlug =
      languageInterpretation.targetLanguageSlug
    const [provisionalTarget, evidenceLocales] = await Promise.all([
      this.targetLanguageContext(provisionalTargetLanguageSlug),
      this.evidenceLocales(languageInterpretation),
    ])
    let target = provisionalTarget
    laneStatuses.push(
      laneStatus({
        lane: "language_resolution",
        status: "fulfilled",
        timelineStartedAt: startedAt,
        startedAt: languageStartedAt,
        resultCount: evidenceLocales.length,
      }),
    )
    const preferredLocale =
      localeForLanguageSlug(languageInterpretation.displayLanguageSlug) ??
      languageInterpretation.displayLanguageBcp47 ??
      localeForLanguageSlug(languageInterpretation.routeLanguageSlug) ??
      languageInterpretation.routeLanguageBcp47 ??
      "en"
    const queryScriptContext =
      this.profile.kind === "CURRENT" &&
      languageInterpretation.queryLanguageSlug == null &&
      languageInterpretation.queryNamedLanguageSlug == null
        ? resolveSearchQueryScriptContext(query)
        : null
    const queryScriptLexicalContext =
      queryScriptContext?.targetLanguageSlug ===
      languageInterpretation.targetLanguageSlug
        ? queryScriptContext.lexicalContext
        : null
    const queryLocale =
      queryScriptLexicalContext?.tokenizerLocale ??
      evidenceLocales.find(
        ({ slug }) => slug === languageInterpretation.queryLanguageSlug,
      )?.locale ??
      preferredLocale
    const lexicalLanguageIdentities = (
      queryScriptLexicalContext
        ? queryScriptLexicalContext.languageSlugs.map((languageSlug) =>
            typesenseWatchLanguageIdentity({
              languageSlug,
              locale: queryLocale,
            }),
          )
        : [
            typesenseWatchLanguageIdentity({
              languageSlug:
                languageInterpretation.queryLanguageSlug ??
                languageInterpretation.queryNamedLanguageSlug ??
                languageInterpretation.displayLanguageSlug ??
                languageInterpretation.targetLanguageSlug ??
                languageInterpretation.routeLanguageSlug,
              locale: queryLocale,
            }),
            typesenseWatchLanguageIdentity({
              languageSlug: null,
              locale: queryLocale,
            }),
          ]
    ).filter(
      (identity, index, all): identity is string =>
        Boolean(identity) && all.indexOf(identity) === index,
    )
    const titleQuery =
      candidateQueryPlan?.contentQuery ??
      queryWithoutLanguageHints(query, [
        languageInterpretation.queryNamedLanguageSlug,
        languageInterpretation.targetLanguageSlug,
      ])
    const candidateLimit = Math.min(
      Math.max(offset + limit + 1, MIN_FALLBACK_CANDIDATES),
      MAX_LEXICAL_CANDIDATES,
    )
    const retrieval = await this.retrieveCandidates({
      titleQuery,
      preferredLocale,
      queryLocale,
      lexicalLanguageIdentities,
      candidateLexicalLocales: candidateQueryPlan?.lexicalLocales ?? [],
      evidenceLocales,
      candidateLimit,
      offset,
      embeddingStartedAt,
      embeddingPromise,
      timelineStartedAt: startedAt,
      laneStatuses,
      diagnostics,
    })
    const rankingGroups = retrieval.groups
    const candidates = rankingGroups.flatMap((group) => group.members)
    const nativeRanking = retrieval.kind === "native"
    const nativeCandidateGroups = nativeRanking ? rankingGroups : null
    const { nativeOffset, lexicalHits, rankingMode, rankingAnchor } = retrieval
    if (candidateQueryPlan) {
      const evidenceLanguageSlugs = new Set(
        candidates.flatMap(({ evidenceLanguageSlug }) =>
          evidenceLanguageSlug ? [evidenceLanguageSlug] : [],
        ),
      )
      const targetIsAuthoritative =
        baseLanguageInterpretation.targetLanguageSource === "explicit_target" ||
        candidateQueryPlan.namedLanguageSlug != null
      const supportedCandidate = targetIsAuthoritative
        ? null
        : (candidateQueryPlan.languageCandidates.find(({ slug }) =>
            evidenceLanguageSlugs.has(slug),
          ) ?? null)
      if (supportedCandidate) {
        languageInterpretation = {
          ...languageInterpretation,
          targetLanguageSlug: supportedCandidate.slug,
          targetLanguageSource: signalSourceForCandidate(supportedCandidate),
        }
      }
      if (
        languageInterpretation.targetLanguageSlug !==
        provisionalTargetLanguageSlug
      ) {
        target = await this.targetLanguageContext(
          languageInterpretation.targetLanguageSlug,
        )
      }
    }
    if (diagnostics) {
      diagnostics.candidates = new Set(
        candidates.map((candidate) => candidate.videoId),
      ).size
      diagnostics.rankingMode = rankingMode
      diagnostics.rankingAnchor = rankingAnchor
    }
    const watchabilityStartedAt = performance.now()
    let rankedCandidates: RankedCandidate[]
    let hydratedById: Map<string, HydratedResultDocument>
    if (nativeRanking) {
      const candidateGroups = (nativeCandidateGroups ?? []).slice(
        0,
        nativeOffset + limit + 1,
      )
      hydratedById = await this.hydrateResultDocuments(
        candidateGroups.flatMap((group) => group.members),
        target,
        diagnostics,
      )
      rankedCandidates = candidateGroups.flatMap((group) => {
        const watchableMembers = group.members.flatMap((candidate) => {
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
          diagnostics,
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
        diagnostics,
      )
    }
    if (diagnostics) diagnostics.hydratedRecords = hydratedById.size
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

    if (diagnostics) {
      const rankedCandidateVideoIds = new Set(
        rankedCandidates.map((entry) => entry.candidate.videoId),
      )
      const finalRankByVideoId = new Map(
        page.map((result, index) => [result.id, offset + index + 1]),
      )
      const rankingTrace = rankingGroups
        .map((group) => {
          const selected = group.members.find((candidate) =>
            rankedCandidateVideoIds.has(candidate.videoId),
          )
          const hydrated = selected
            ? hydratedById.get(selected.videoId)
            : undefined
          return {
            canonicalVideoId: group.canonicalVideoId,
            retrievalSources: orderedRetrievalSources(
              group.members.flatMap(
                (candidate) => candidate.retrievalSources ?? [],
              ),
            ),
            evidenceTier: group.evidenceTier,
            fusedScore: group.fusedScore,
            wholeTitleMatch: group.wholeTitleMatch,
            titleRank: group.laneEvidence.title?.rank ?? null,
            titleContribution: group.laneEvidence.title?.contribution ?? 0,
            metadataRank: group.laneEvidence.metadata?.rank ?? null,
            metadataContribution:
              group.laneEvidence.metadata?.contribution ?? 0,
            semanticRank: group.laneEvidence.semantic?.rank ?? null,
            semanticContribution:
              group.laneEvidence.semantic?.contribution ?? 0,
            selectedVideoId: selected?.videoId ?? null,
            watchabilityOutcome: hydrated?.watchability.kind ?? null,
            finalRank: selected
              ? (finalRankByVideoId.get(selected.videoId) ?? null)
              : null,
          }
        })
        .sort((left, right) => {
          if (left.finalRank != null && right.finalRank != null) {
            return left.finalRank - right.finalRank
          }
          if (left.finalRank != null) return -1
          if (right.finalRank != null) return 1
          return left.canonicalVideoId.localeCompare(right.canonicalVideoId)
        })
      diagnostics.rankingTraceTotal = rankingTrace.length
      diagnostics.rankingTraceTruncated =
        rankingTrace.length > MAX_RANKING_TRACE_ENTRIES
      diagnostics.rankingTrace = rankingTrace.slice(
        0,
        MAX_RANKING_TRACE_ENTRIES,
      )
    }

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
    lexicalLanguageIdentities,
    candidateLexicalLocales,
    evidenceLocales,
    candidateLimit,
    offset,
    embeddingStartedAt,
    embeddingPromise,
    timelineStartedAt,
    laneStatuses,
    diagnostics,
  }: {
    titleQuery: string
    preferredLocale: string
    queryLocale: string
    lexicalLanguageIdentities: string[]
    candidateLexicalLocales: readonly string[]
    evidenceLocales: Array<{ slug: string; locale: string }>
    candidateLimit: number
    offset: number
    embeddingStartedAt: number
    embeddingPromise: Promise<EmbeddingOutcome>
    timelineStartedAt: number
    laneStatuses: WatchSearchLaneStatus[]
    diagnostics?: MutableSearchDiagnostics
  }): Promise<CandidateRetrieval> {
    const globalCandidateRecall = this.profile.kind === "CANDIDATE"
    const semanticEligible = globalCandidateRecall || evidenceLocales.length > 0
    if (!semanticEligible) {
      laneStatuses.push(
        laneStatus({
          lane: "semantic_embedding",
          status: "skipped",
          timelineStartedAt,
          startedAt: embeddingStartedAt,
          resultCount: 0,
          reason: "no_evidence_language",
          elapsedMs: 0,
        }),
      )
    }

    const embeddingOutcome = semanticEligible ? await embeddingPromise : null
    let embedding: number[] | null = null
    if (embeddingOutcome?.status === "fulfilled") {
      embedding = embeddingOutcome.embedding
      laneStatuses.push(
        laneStatus({
          lane: "semantic_embedding",
          status: "fulfilled",
          timelineStartedAt,
          startedAt: embeddingStartedAt,
          resultCount: 1,
          elapsedMs: embeddingOutcome.elapsedMs,
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
          elapsedMs: embeddingOutcome.elapsedMs,
        }),
      )
    }

    const retrievalStartedAt = performance.now()
    const lexicalManifest = this.profile.fieldManifests?.lexical ?? []
    const titleFields = globalCandidateRecall
      ? watchLexicalOrderedManifestQueryFields(
          lexicalManifest,
          "title",
          candidateLexicalLocales,
        )
      : watchLexicalQueryFields(queryLocale, "title")
    const metadataFields = globalCandidateRecall
      ? watchLexicalOrderedManifestQueryFields(
          lexicalManifest,
          "metadata",
          candidateLexicalLocales,
        )
      : watchLexicalQueryFields(queryLocale, "metadata")
    const retrievalLanes: Array<{
      kind: "exact" | "title" | "metadata" | "semantic"
      request: TypesenseSearchRequest
    }> = [
      ...(globalCandidateRecall
        ? [
            {
              kind: "exact" as const,
              request: exactTitleLaneRequest(
                this.profile.binding.lexical,
                titleQuery,
                titleFields,
                candidateLimit,
                offset,
              ),
            },
          ]
        : []),
      {
        kind: "title",
        request: lexicalLaneRequest(
          this.profile.binding.lexical,
          titleQuery,
          titleFields,
          globalCandidateRecall ? null : lexicalLanguageIdentities,
          candidateLimit,
          offset,
        ),
      },
      {
        kind: "metadata",
        request: lexicalLaneRequest(
          this.profile.binding.lexical,
          titleQuery,
          metadataFields,
          globalCandidateRecall ? null : lexicalLanguageIdentities,
          candidateLimit,
          offset,
        ),
      },
      ...(embedding
        ? [
            {
              kind: "semantic" as const,
              request: semanticLaneRequest(
                this.profile.binding.transcript,
                embedding,
                evidenceLocales,
                candidateLimit,
                offset,
                globalCandidateRecall,
              ),
            },
          ]
        : []),
    ]
    try {
      const results = await this.multiSearch<
        TypesenseWatchLexicalDocument | TypesenseWatchTranscriptDocument
      >(
        retrievalLanes.map(({ request }) => request),
        diagnostics,
      )
      const resultByLane = new Map(
        retrievalLanes.map(({ kind }, index) => [kind, results[index]]),
      )
      const exactGroups = (resultByLane.get("exact")?.grouped_hits ??
        []) as TypesenseSearchGroup<TypesenseWatchLexicalDocument>[]
      const titleGroups = (resultByLane.get("title")?.grouped_hits ??
        []) as TypesenseSearchGroup<TypesenseWatchLexicalDocument>[]
      const metadataGroups = (resultByLane.get("metadata")?.grouped_hits ??
        []) as TypesenseSearchGroup<TypesenseWatchLexicalDocument>[]
      const semanticGroups = (resultByLane.get("semantic")?.grouped_hits ??
        []) as TypesenseSearchGroup<TypesenseWatchTranscriptDocument>[]
      const nativeRanking = this.buildFusedCandidateGroups({
        query: titleQuery,
        queryLocale,
        collectDiagnostics: diagnostics != null,
        titleFields,
        metadataFields,
        exactGroups,
        titleGroups,
        metadataGroups,
        semanticGroups,
        evidenceLocales,
      })
      const candidateGroups = nativeRanking.groups
      const lexicalGroupIds = new Set(
        [...exactGroups, ...titleGroups, ...metadataGroups].map(
          (group) => group.group_key[0],
        ),
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
        kind: "native",
        groups: candidateGroups,
        nativeOffset: offset % Math.min(candidateLimit, MAX_FUSED_CANDIDATES),
        lexicalHits: [],
        rankingMode: nativeRanking.mode,
        rankingAnchor: nativeRanking.anchor,
      }
    } catch (error) {
      if (
        !this.profile.allowCompatibilityFallback ||
        !isMissingLexicalProjection(error, this.profile.binding.lexical)
      ) {
        throw error
      }
      const reason =
        error instanceof Error ? error.message : "lexical_projection_failure"
      this.logger.warn(
        `[typesense-watch-search] event=lexical_projection_fallback error_class=${error instanceof Error ? error.constructor.name : "UnknownError"}`,
      )
      const fallbackStartedAt = performance.now()
      const lexicalRequests = lexicalSearchRequests(
        this.profile.binding.catalog,
        titleQuery,
        candidateLimit,
        embedding
          ? TYPESENSE_MAX_MULTI_SEARCHES - 1
          : TYPESENSE_MAX_MULTI_SEARCHES,
      )
      const filterValues = evidenceLocales
        .map(({ locale }) => `\`${locale}\``)
        .join(",")
      const results = await this.multiSearch<
        TypesenseWatchCatalogPreviewDocument | TypesenseWatchTranscriptDocument
      >(
        [
          ...lexicalRequests,
          ...(embedding
            ? [
                {
                  collection: this.profile.binding.transcript,
                  q: "*",
                  vector_query: `embedding:([${embedding.join(",")}], k:${MAX_SEMANTIC_CANDIDATES})`,
                  filter_by: `language:=[${filterValues}] && publiclyVisible:=true`,
                  per_page: MAX_SEMANTIC_CANDIDATES,
                  exclude_fields: "embedding",
                },
              ]
            : []),
        ],
        diagnostics,
      )
      const lexicalHits = await this.withLegacyLocaleProjection(
        results
          .slice(0, lexicalRequests.length)
          .flatMap((result) => result.hits ?? [])
          .slice(
            0,
            candidateLimit,
          ) as TypesenseSearchHit<TypesenseWatchCatalogPreviewDocument>[],
        diagnostics,
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
      const compatibilityRanking = this.buildCandidates({
        query: titleQuery,
        collectDiagnostics: diagnostics != null,
        preferredLocale,
        lexicalHits,
        semanticHits,
        evidenceLocales,
      })
      return {
        kind: "compatibility",
        groups: compatibilityRanking.groups,
        nativeOffset: 0,
        lexicalHits,
        rankingMode: compatibilityRanking.mode,
        rankingAnchor: compatibilityRanking.anchor,
      }
    }
  }

  private buildFusedCandidateGroups({
    query,
    queryLocale,
    collectDiagnostics,
    titleFields,
    metadataFields,
    exactGroups,
    titleGroups,
    metadataGroups,
    semanticGroups,
    evidenceLocales,
  }: {
    query: string
    queryLocale: string
    collectDiagnostics: boolean
    titleFields: readonly string[]
    metadataFields: readonly string[]
    exactGroups: TypesenseSearchGroup<TypesenseWatchLexicalDocument>[]
    titleGroups: TypesenseSearchGroup<TypesenseWatchLexicalDocument>[]
    metadataGroups: TypesenseSearchGroup<TypesenseWatchLexicalDocument>[]
    semanticGroups: TypesenseSearchGroup<TypesenseWatchTranscriptDocument>[]
    evidenceLocales: Array<{ slug: string; locale: string }>
  }): {
    groups: RankedCandidateGroup[]
    mode: WatchSearchRankingMode
    anchor: WatchSearchRankingAnchor | null
  } {
    const titleAndBrandRanking =
      this.rankingImplementation ===
      WATCH_SEARCH_TITLE_AND_BRAND_RANKING_IMPLEMENTATION
    const collectRankingEvidence = titleAndBrandRanking || collectDiagnostics
    const classifyTitleMatch = titleAndBrandRanking
      ? createCandidateTitleMatchClassifier(query, queryLocale)
      : createLegacyTitleMatchClassifier(query)
    const titleClassifierByLocale = new Map([[queryLocale, classifyTitleMatch]])
    type GroupState = Omit<
      WatchSearchRankingGroup,
      "titleValues" | "metadataValues"
    > & {
      titleValues: string[]
      metadataValues: string[]
      titleValueSet: Set<string>
      metadataValueSet: Set<string>
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

    const exactKey = typesenseWatchExactTitleKey(query)
    const verifiedExactGroups = exactGroups.flatMap((group) => {
      const hits = group.hits.filter((hit) => {
        const values = lexicalValues(hit.document, titleFields)
        const locales =
          hit.document.localeCodes.length > 0
            ? hit.document.localeCodes
            : [queryLocale]
        const wholeTitleMatch = locales.some((locale) => {
          let classifier = titleClassifierByLocale.get(locale)
          if (!classifier) {
            classifier = createCandidateTitleMatchClassifier(query, locale)
            titleClassifierByLocale.set(locale, classifier)
          }
          return classifier(values).wholeTitleMatch
        })
        return (
          exactKey != null &&
          wholeTitleMatch &&
          values.some(
            (title) => typesenseWatchExactTitleKey(title) === exactKey,
          )
        )
      })
      return hits.length > 0 ? [{ ...group, found: hits.length, hits }] : []
    })
    const candidateMemberKey = (canonicalVideoId: string, videoId: string) =>
      `${canonicalVideoId}\u0000${videoId}`
    const verifiedExactMembers = new Set(
      verifiedExactGroups.flatMap((group) =>
        group.hits.map((hit) =>
          candidateMemberKey(group.group_key[0] ?? "", hit.document.videoId),
        ),
      ),
    )
    const localizedTitleMembers = collectDiagnostics
      ? new Set(
          titleGroups.flatMap((group) =>
            group.hits.map((hit) =>
              candidateMemberKey(
                group.group_key[0] ?? "",
                hit.document.videoId,
              ),
            ),
          ),
        )
      : null
    const partialTitleGroupsById = new Map(
      titleGroups.map((group) => [group.group_key[0], group]),
    )
    const exactTitleGroupIds = new Set(
      verifiedExactGroups.map((group) => group.group_key[0]),
    )
    const mergedTitleGroups = [
      ...verifiedExactGroups.map((group) => {
        const partial = partialTitleGroupsById.get(group.group_key[0])
        const hits = [...group.hits, ...(partial?.hits ?? [])]
        return { ...group, found: hits.length, hits }
      }),
      ...titleGroups.filter(
        (group) => !exactTitleGroupIds.has(group.group_key[0]),
      ),
    ]

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
        retrievalSources: mergeRetrievalSources(
          existing.retrievalSources,
          candidate.retrievalSources,
        ),
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
        const effectiveRank =
          lane === "title" && exactTitleGroupIds.has(canonicalVideoId)
            ? 0
            : rank
        const baseContribution =
          weight / (RRF_RANK_CONSTANT + effectiveRank + 1)
        const state = groups.get(canonicalVideoId) ?? {
          canonicalVideoId,
          fusedScore: 0,
          wholeTitleMatch: false,
          titleValues: [],
          metadataValues: [],
          titleValueSet: new Set<string>(),
          metadataValueSet: new Set<string>(),
          laneEvidence: {
            title: null,
            metadata: null,
            semantic: null,
          },
          members: new Map<string, Candidate>(),
        }
        const winningHitByVideoId = new Map<
          string,
          { candidate: Candidate; quality: number }
        >()
        let bestGroupQuality = 0
        for (const hit of group.hits) {
          const quality = typesenseLexicalMatchQuality(hit.text_match_info)
          bestGroupQuality = Math.max(bestGroupQuality, quality)
          const values = lexicalValues(hit.document, fields)
          const evidenceValues =
            lane === "title" ? state.titleValues : state.metadataValues
          const evidenceValueSet =
            lane === "title" ? state.titleValueSet : state.metadataValueSet
          if (collectRankingEvidence) {
            for (const value of values) {
              if (evidenceValueSet.has(value)) continue
              evidenceValueSet.add(value)
              evidenceValues.push(value)
            }
          }
          const { exact, wholeTitleMatch } =
            lane === "title"
              ? classifyTitleMatch(values)
              : { exact: false, wholeTitleMatch: false }
          const memberKey = candidateMemberKey(
            canonicalVideoId,
            hit.document.videoId,
          )
          const verifiedExact =
            lane === "title" && verifiedExactMembers.has(memberKey)
          const retrievalSources = collectDiagnostics
            ? lane === "metadata"
              ? (["metadata"] satisfies TypesenseWatchSearchRetrievalSource[])
              : orderedRetrievalSources([
                  ...(verifiedExact ? (["global_exact_title"] as const) : []),
                  ...(localizedTitleMembers?.has(memberKey)
                    ? (["localized_title"] as const)
                    : []),
                ])
            : undefined
          state.wholeTitleMatch ||= wholeTitleMatch || verifiedExact
          const candidate: Candidate = {
            videoId: hit.document.videoId,
            videoEditionId: null,
            kind: exact || verifiedExact ? "exact" : "metadata",
            retrievalSources,
            wholeTitleMatch: wholeTitleMatch || verifiedExact,
            sourceScore: 0,
            evidenceLanguageSlug: lexicalEvidenceLanguageSlug(
              hit.document.languageIdentity,
            ),
            snippet: lane === "metadata" ? (values[0] ?? null) : null,
            startSeconds: null,
          }
          const existing = winningHitByVideoId.get(candidate.videoId)
          if (!existing) {
            winningHitByVideoId.set(candidate.videoId, { candidate, quality })
            continue
          }
          const winner =
            quality > existing.quality ? { candidate, quality } : existing
          winningHitByVideoId.set(candidate.videoId, {
            ...winner,
            candidate: {
              ...winner.candidate,
              kind:
                existing.candidate.kind === "exact" ||
                candidate.kind === "exact"
                  ? "exact"
                  : "metadata",
              wholeTitleMatch:
                existing.candidate.wholeTitleMatch || candidate.wholeTitleMatch,
              retrievalSources: mergeRetrievalSources(
                existing.candidate.retrievalSources,
                candidate.retrievalSources,
              ),
            },
          })
        }
        if (winningHitByVideoId.size === 0) return
        const contribution = baseContribution * bestGroupQuality
        state.fusedScore += contribution
        if (collectRankingEvidence) {
          state.laneEvidence[lane] = {
            rank: effectiveRank + 1,
            contribution,
          }
        }
        for (const { candidate, quality } of winningHitByVideoId.values()) {
          addCandidate(state, candidate, baseContribution * quality)
        }
        groups.set(canonicalVideoId, state)
      })
    }

    addLexicalLane(mergedTitleGroups, titleFields, TITLE_LANE_WEIGHT, "title")
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
        titleValues: [],
        metadataValues: [],
        titleValueSet: new Set<string>(),
        metadataValueSet: new Set<string>(),
        laneEvidence: {
          title: null,
          metadata: null,
          semantic: null,
        },
        members: new Map<string, Candidate>(),
      }
      state.fusedScore += contribution
      if (collectRankingEvidence) {
        state.laneEvidence.semantic = {
          rank: rank + 1,
          contribution,
        }
      }
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
            ...(collectDiagnostics
              ? { retrievalSources: ["semantic"] as const }
              : {}),
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

    const ranked = titleAndBrandRanking
      ? rankWatchSearchGroups(query, [...groups.values()], queryLocale)
      : {
          mode: "SEMANTIC" as const,
          anchor: null,
          groups: [...groups.values()]
            .sort(compareSemanticRankingGroups)
            .map((group) => ({
              group,
              evidenceTier: "SEMANTIC_FILL" as const,
            })),
        }
    return {
      mode: ranked.mode,
      anchor: ranked.anchor,
      groups: ranked.groups.map(({ group, evidenceTier }) => ({
        ...group,
        evidenceTier,
        members: [...group.members.values()]
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
      })),
    }
  }

  private buildCandidates({
    query,
    collectDiagnostics,
    preferredLocale,
    lexicalHits,
    semanticHits,
    evidenceLocales,
  }: {
    query: string
    collectDiagnostics: boolean
    preferredLocale: string
    lexicalHits: TypesenseSearchHit<TypesenseWatchCatalogPreviewDocument>[]
    semanticHits: TypesenseSearchHit<TypesenseWatchTranscriptDocument>[]
    evidenceLocales: Array<{ slug: string; locale: string }>
  }): {
    groups: RankedCandidateGroup[]
    mode: WatchSearchRankingMode
    anchor: WatchSearchRankingAnchor | null
  } {
    const candidates = new Map<string, Candidate>()
    const titleValuesByVideoId = new Map<string, string[]>()
    const lexicalRankByVideoId = new Map<string, number>()
    const semanticRankByVideoId = new Map<string, number>()
    const classifyTitleMatch = createLegacyTitleMatchClassifier(query)
    lexicalHits.forEach((hit, index) => {
      const locale = displayPreviewLocale(hit.document, preferredLocale)
      const { exact, wholeTitleMatch } = classifyTitleMatch([locale.title])
      if (collectDiagnostics) {
        titleValuesByVideoId.set(hit.document.id, hit.document.titles)
        lexicalRankByVideoId.set(hit.document.id, index + 1)
      }
      candidates.set(hit.document.id, {
        videoId: hit.document.id,
        videoEditionId: null,
        kind: exact ? "exact" : "metadata",
        ...(collectDiagnostics ? { retrievalSources: [] } : {}),
        wholeTitleMatch,
        sourceScore: exact
          ? 1
          : Math.max(0.3, 1 - index / Math.max(lexicalHits.length, 1) / 2),
        evidenceLanguageSlug: null,
        snippet: locale.description,
        startSeconds: null,
      })
    })
    semanticHits.forEach((hit, index) => {
      const similarity = 1 - (hit.vector_distance ?? 1)
      if (similarity < MIN_SEMANTIC_SIMILARITY) return
      const existing = candidates.get(hit.document.videoId)
      if (existing && existing.kind !== "semantic") {
        if (collectDiagnostics) {
          candidates.set(hit.document.videoId, {
            ...existing,
            retrievalSources: mergeRetrievalSources(existing.retrievalSources, [
              "semantic",
            ]),
          })
        }
        return
      }
      if (existing && existing.sourceScore >= similarity) return
      if (collectDiagnostics) {
        semanticRankByVideoId.set(hit.document.videoId, index + 1)
      }
      candidates.set(hit.document.videoId, {
        videoId: hit.document.videoId,
        videoEditionId: hit.document.videoEditionId ?? null,
        kind: "semantic",
        ...(collectDiagnostics
          ? { retrievalSources: ["semantic"] as const }
          : {}),
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
    })
    const rankingInputs = [...candidates.values()].map((candidate) => {
      const relevance = candidateRelevance(candidate)
      return {
        canonicalVideoId: candidate.videoId,
        fusedScore: relevance,
        wholeTitleMatch: candidate.wholeTitleMatch,
        titleValues: titleValuesByVideoId.get(candidate.videoId) ?? [],
        metadataValues: [],
        laneEvidence: {
          title:
            collectDiagnostics && candidate.kind !== "semantic"
              ? {
                  rank: lexicalRankByVideoId.get(candidate.videoId) ?? 1,
                  contribution: relevance,
                }
              : null,
          metadata: null,
          semantic:
            collectDiagnostics && candidate.kind === "semantic"
              ? {
                  rank: semanticRankByVideoId.get(candidate.videoId) ?? 1,
                  contribution: relevance,
                }
              : null,
        },
        members: [candidate],
      }
    })
    const ranked = {
      mode: "SEMANTIC" as const,
      anchor: null,
      groups: rankingInputs.map((group) => ({
        group,
        evidenceTier: "SEMANTIC_FILL" as const,
      })),
    }
    const groups = ranked.groups.map(({ group, evidenceTier }) => ({
      ...group,
      evidenceTier,
    }))
    return {
      groups,
      mode: ranked.mode,
      anchor: ranked.anchor,
    }
  }

  private async hydrateResultDocuments(
    candidates: readonly CandidateHydrationScope[],
    target: TargetLanguageContext,
    diagnostics?: MutableSearchDiagnostics,
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
        collection: this.profile.binding.catalog,
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
          collection: this.profile.binding.availability,
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
      >([...catalogSearches, ...availabilitySearches], diagnostics)
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
          diagnostics,
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
      const missingProjection =
        !legacyProjection &&
        isMissingAvailabilityProjection(
          error,
          this.profile.binding.availability,
        )
      const overflow = error instanceof AvailabilityOverflowError
      if (
        !this.profile.allowCompatibilityFallback ||
        (!missingProjection && !legacyProjection && !overflow)
      ) {
        throw error
      }
      this.logger.warn(
        `[typesense-watch-search] event=${missingProjection ? "availability_alias_fallback" : overflow ? "availability_overflow_fallback" : "availability_projection_fallback"}`,
      )
      const legacyById =
        await this.catalogDocuments<TypesenseWatchLegacyCatalogResultDocument>(
          ids,
          LEGACY_CATALOG_RESULT_FIELDS,
          diagnostics,
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
    diagnostics?: MutableSearchDiagnostics,
  ): Promise<TypesenseSearchResult<TDocument>[]> {
    const results: TypesenseSearchResult<TDocument>[] = []
    for (
      let index = 0;
      index < searches.length;
      index += TYPESENSE_MAX_MULTI_SEARCHES
    ) {
      results.push(
        ...(await this.multiSearch<TDocument>(
          searches.slice(index, index + TYPESENSE_MAX_MULTI_SEARCHES),
          diagnostics,
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
    diagnostics?: MutableSearchDiagnostics,
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
        collection: this.profile.binding.catalog,
        q: "*",
        filter_by: `id:=[${batch.map((id) => `\`${id}\``).join(",")}]`,
        per_page: batch.length,
        include_fields: includeFields,
      })
    }
    const results = await this.multiSearch<TDocument>(searches, diagnostics)
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
    diagnostics?: MutableSearchDiagnostics,
  ): Promise<TypesenseSearchHit<TypesenseWatchCatalogPreviewDocument>[]> {
    const legacyIds = hits
      .filter((hit) => !hasAlignedLocaleCodes(hit.document))
      .map((hit) => hit.document.id)
    if (legacyIds.length === 0) return hits

    const legacyById =
      await this.catalogDocuments<TypesenseWatchLegacyCatalogLocaleDocument>(
        legacyIds,
        LEGACY_CATALOG_LOCALE_FIELDS,
        diagnostics,
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
    return cachedBoundedTtlValue({
      cacheByOwner: targetLanguageContextCaches,
      owner: this.prisma,
      key: targetLanguageSlug,
      ttlMs: LANGUAGE_CONTEXT_CACHE_TTL_MS,
      maxEntries: LANGUAGE_CONTEXT_CACHE_MAX_ENTRIES,
      loader: async () => {
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
      },
    })
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
    return cachedBoundedTtlValue({
      cacheByOwner: evidenceLocaleCaches,
      owner: this.prisma,
      key: slugs.join("\u0000"),
      ttlMs: LANGUAGE_CONTEXT_CACHE_TTL_MS,
      maxEntries: LANGUAGE_CONTEXT_CACHE_MAX_ENTRIES,
      loader: async () => {
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
      },
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
  profile: TypesenseWatchSearchProfile = createCurrentWatchSearchProfile(),
): TypesenseWatchSearchService | null {
  const host = process.env.TYPESENSE_HOST
  const apiKey = resolveTypesenseWatchSearchApiKey({
    searchApiKey: process.env.TYPESENSE_SEARCH_API_KEY,
    legacyApiKey: process.env.TYPESENSE_API_KEY,
    allowLegacyFallback: profile.kind === "CURRENT",
  })
  if (!host || !apiKey) return null
  return new TypesenseWatchSearchService(
    prisma,
    new TypesenseClient({ host, apiKey, timeoutMs: 2_000 }),
    { profile },
  )
}

export function isTypesenseUnavailable(error: unknown): boolean {
  return (
    error instanceof TypesenseRequestError ||
    error instanceof TypesenseWatchSearchUnavailableError
  )
}
