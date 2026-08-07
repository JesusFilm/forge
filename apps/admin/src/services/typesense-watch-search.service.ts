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
import {
  typesenseWatchLanguageIdentity,
  type TypesenseWatchLexicalDocument,
} from "./typesense-watch-search-lexical"
import {
  displayLocale,
  displayPreviewLocale,
  hasAlignedLocaleCodes,
  type TypesenseWatchCatalogPreviewDocument,
  watchLexicalQueryFields,
} from "./typesense-watch-search-locales"
import { resolveSearchLanguageSignals } from "./search-language-resolution"
import { watchSearchQueryVariants } from "./watch-search-query-normalization"
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
const TYPESENSE_MULTI_SEARCH_CONCURRENCY = 2
const MAX_LEXICAL_CANDIDATES =
  TYPESENSE_MAX_PER_PAGE * TYPESENSE_MAX_MULTI_SEARCHES
const MAX_LEGACY_LEXICAL_CANDIDATES_WITH_SEMANTIC =
  TYPESENSE_MAX_PER_PAGE * (TYPESENSE_MAX_MULTI_SEARCHES - 1)
const MAX_SEMANTIC_CANDIDATES = 40
const MIN_FALLBACK_CANDIDATES = 100
const HYBRID_VECTOR_CANDIDATES = 80
const HYBRID_GROUP_LIMIT = 3
const RRF_RANK_CONSTANT = 60
const TITLE_LANE_WEIGHT = 0.56
const METADATA_LANE_WEIGHT = 0.14
const SEMANTIC_LANE_WEIGHT = 0.3
const MAX_CATALOG_HYDRATION_BATCH = 250
const MAX_EVIDENCE_LOCALES = 3
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
  "id,videoId,languageId,languageSlug,languageEnglishName,audio,subtitles,playbackId,durationSeconds"
const LEGACY_CATALOG_RESULT_FIELDS = `${CATALOG_RESULT_FIELDS},audioOptionsJson,subtitleOptionsJson`

type TypesenseSearchClient = Pick<TypesenseClient, "multiSearch">

type TypesenseWatchSearchDeps = {
  embedder?: WatchSearchQueryEmbedder
  embeddingTimeoutMs?: number
  logger?: Pick<Console, "warn">
}

type Candidate = {
  videoId: string
  kind: "exact" | "metadata" | "semantic"
  wholeTitleMatch: boolean
  sourceScore: number
  evidenceLanguageSlug: string | null
  snippet: string | null
  startSeconds: number | null
  fallbackOnly: boolean
}

type EvidenceLocale = {
  slug: string
  locale: string
  fallbackOnly: boolean
}

type LexicalLaneResult = {
  lane: "title" | "metadata"
  query: string
  fields: readonly string[]
  evidenceLanguageSlug: string | null
  fallbackOnly: boolean
  groups: TypesenseSearchGroup<TypesenseWatchLexicalDocument>[]
}

type CandidateRetrieval =
  | { kind: "native"; candidateGroups: Candidate[][] }
  | {
      kind: "legacy"
      candidates: Candidate[]
      lexicalHits: TypesenseSearchHit<TypesenseWatchCatalogPreviewDocument>[]
    }

type EmbeddingOutcome =
  | { status: "fulfilled"; embedding: number[]; elapsedMs: number }
  | { status: "rejected"; error: unknown; elapsedMs: number }

type RankedCandidate = {
  candidate: Candidate
  rankingRelevance: number
  watchabilityKind: IndexedWatchability["kind"]
}

type CandidateLane = "title" | "metadata" | "semantic"

type TypesenseWatchLegacyCatalogLocaleDocument = Pick<
  TypesenseWatchCatalogDocument,
  "id" | "titles" | "localesJson"
>

type TypesenseWatchCatalogWatchabilityPreviewDocument = Pick<
  TypesenseWatchCatalogDocument,
  "id" | "audioLanguageSlugs" | "subtitleLanguageSlugs"
>

type TypesenseWatchCatalogIdDocument = Pick<TypesenseWatchCatalogDocument, "id">

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

type TypesenseWatchLegacyWatchabilityDocument = Pick<
  TypesenseWatchCatalogDocument,
  "id" | "audioOptionsJson" | "subtitleOptionsJson"
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
  BoundedTtlCache<EvidenceLocale[]>
>()

export class TypesenseWatchSearchUnavailableError extends Error {
  constructor(message = "Typesense Watch Search is not configured") {
    super(message)
    this.name = "TypesenseWatchSearchUnavailableError"
  }
}

function isMissingAvailabilityAlias(error: unknown): boolean {
  return (
    error instanceof TypesenseRequestError &&
    (error.status === 404 ||
      error.message.includes(TYPESENSE_WATCH_AVAILABILITY_ALIAS))
  )
}

function isMissingLexicalProjection(error: unknown): boolean {
  return (
    error instanceof TypesenseRequestError &&
    (error.status === 400 || error.status === 404) &&
    new RegExp(
      `${TYPESENSE_WATCH_LEXICAL_ALIAS}|title_[a-z]|metadata_[a-z]|canonicalVideoId|languageIdentity`,
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

function lexicalLaneRequests(
  query: string,
  fields: readonly string[],
  languageIdentities: readonly string[],
  candidateLimit: number,
): TypesenseSearchRequest[] {
  const perPage = Math.min(candidateLimit, TYPESENSE_MAX_PER_PAGE)
  const pageCount = Math.ceil(candidateLimit / perPage)
  return Array.from({ length: pageCount }, (_value, index) => ({
    collection: TYPESENSE_WATCH_LEXICAL_ALIAS,
    q: query,
    query_by: fields.join(","),
    query_by_weights: fields
      .map((_field, index) => (index === 0 ? 4 : 1))
      .join(","),
    page: index + 1,
    per_page: perPage,
    group_by: "canonicalVideoId",
    group_limit: HYBRID_GROUP_LIMIT,
    filter_by: `languageIdentity:=[${languageIdentities.map((identity) => `\`${identity}\``).join(",")}]`,
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
      "languageIdentity",
      "localeCodes",
      ...fields,
    ].join(","),
  }))
}

function semanticLaneRequest(
  embedding: readonly number[],
  evidenceLocales: EvidenceLocale[],
  candidateLimit: number,
): TypesenseSearchRequest {
  const vectorCandidateLimit = HYBRID_VECTOR_CANDIDATES
  const perPage = Math.min(candidateLimit, vectorCandidateLimit)
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
    page: 1,
    per_page: perPage,
    include_fields:
      "id,documentKind,videoId,canonicalVideoId,language,text,startSeconds",
  }
}

async function multiSearchInBatches<TDocument>(
  typesense: TypesenseSearchClient,
  searches: readonly TypesenseSearchRequest[],
): Promise<TypesenseSearchResult<TDocument>[]> {
  const batches = Array.from(
    { length: Math.ceil(searches.length / TYPESENSE_MAX_MULTI_SEARCHES) },
    (_value, index) =>
      searches.slice(
        index * TYPESENSE_MAX_MULTI_SEARCHES,
        (index + 1) * TYPESENSE_MAX_MULTI_SEARCHES,
      ),
  )
  const results: TypesenseSearchResult<TDocument>[] = []
  for (
    let index = 0;
    index < batches.length;
    index += TYPESENSE_MULTI_SEARCH_CONCURRENCY
  ) {
    const wave = await Promise.all(
      batches
        .slice(index, index + TYPESENSE_MULTI_SEARCH_CONCURRENCY)
        .map((batch) => typesense.multiSearch<TDocument>(batch)),
    )
    results.push(...wave.flat())
  }
  return results
}

function isEligibleFallbackCandidate(
  candidate: Candidate,
  watchabilityKind: IndexedWatchability["kind"],
): boolean {
  return (
    !candidate.fallbackOnly ||
    watchabilityKind === "target_audio" ||
    watchabilityKind === "target_subtitle"
  )
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

function resolveLegacyWatchability(
  document: TypesenseWatchLegacyWatchabilityDocument,
  target: TargetLanguageContext,
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
  const targetSubtitle = subtitleOptions.find(
    (option) => option.languageSlug === target.slug,
  )
  if (targetSubtitle) {
    return {
      kind: "target_subtitle",
      languageSlug: targetSubtitle.languageSlug,
      languageEnglishName: target.englishName,
      audio: false,
      subtitles: true,
      playbackId: null,
      durationSeconds: null,
      hrefLanguageSlug: targetSubtitle.languageSlug,
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
): IndexedWatchability {
  const targetOption = availability.find(
    (option) => option.languageSlug === target.slug,
  )
  if (targetOption?.audio) {
    return {
      kind: "target_audio",
      languageSlug: targetOption.languageSlug,
      languageEnglishName: targetOption.languageEnglishName,
      audio: true,
      subtitles: false,
      playbackId: targetOption.playbackId,
      durationSeconds: targetOption.durationSeconds,
      hrefLanguageSlug: targetOption.languageSlug,
    }
  }
  if (targetOption?.subtitles) {
    return {
      kind: "target_subtitle",
      languageSlug: targetOption.languageSlug,
      languageEnglishName: target.englishName,
      audio: false,
      subtitles: true,
      playbackId: null,
      durationSeconds: null,
      hrefLanguageSlug: targetOption.languageSlug,
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

function bestRankedCandidate(
  group: readonly Candidate[],
  watchabilityById: ReadonlyMap<string, IndexedWatchability>,
): RankedCandidate | null {
  const candidates = group.flatMap((candidate) => {
    const watchability = watchabilityById.get(candidate.videoId)
    if (
      !watchability ||
      !isEligibleFallbackCandidate(candidate, watchability.kind)
    ) {
      return []
    }
    return [
      {
        candidate,
        rankingRelevance: candidateRelevance(candidate),
        watchabilityKind: watchability.kind,
      },
    ]
  })
  candidates.sort((left, right) => {
    const watchabilityDelta =
      watchabilityRank(left.watchabilityKind) -
      watchabilityRank(right.watchabilityKind)
    if (watchabilityDelta !== 0) return watchabilityDelta
    return right.rankingRelevance - left.rankingRelevance
  })
  return candidates[0] ?? null
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
    if (offset + limit + 1 > MAX_LEXICAL_CANDIDATES) {
      throw new WatchSearchValidationError(
        `Pagination exceeds the supported ${MAX_LEXICAL_CANDIDATES}-candidate window`,
      )
    }
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
    const languageInterpretation = await resolveSearchLanguageSignals({
      prisma: this.prisma,
      input,
    })
    const [target, evidenceLocales] = await Promise.all([
      this.targetLanguageContext(languageInterpretation.targetLanguageSlug),
      this.evidenceLocales(languageInterpretation),
    ])
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
    const queryLocale =
      evidenceLocales.find(
        ({ slug }) => slug === languageInterpretation.queryLanguageSlug,
      )?.locale ?? preferredLocale
    const lexicalLanguageSlug =
      languageInterpretation.queryLanguageSlug ??
      languageInterpretation.queryNamedLanguageSlug ??
      languageInterpretation.displayLanguageSlug ??
      languageInterpretation.targetLanguageSlug ??
      languageInterpretation.routeLanguageSlug
    const titleQuery = queryWithoutLanguageHints(query, [
      languageInterpretation.queryNamedLanguageSlug,
      languageInterpretation.targetLanguageSlug,
    ])
    const candidateLimit = Math.max(offset + limit + 1, MIN_FALLBACK_CANDIDATES)
    const retrieval = await this.retrieveCandidates({
      titleQuery,
      preferredLocale,
      queryLocale,
      lexicalLanguageSlug,
      targetLanguageSlug: languageInterpretation.targetLanguageSlug,
      evidenceLocales,
      candidateLimit,
      embeddingStartedAt,
      embeddingPromise,
      timelineStartedAt: startedAt,
      laneStatuses,
    })
    const watchabilityStartedAt = performance.now()
    let rankedCandidates: RankedCandidate[]
    let hydratedById: Map<string, HydratedResultDocument>
    if (retrieval.kind === "native") {
      const allCandidateGroups = retrieval.candidateGroups
      const requiresFallbackEligibility = allCandidateGroups.some((group) =>
        group.some(({ fallbackOnly }) => fallbackOnly),
      )
      if (requiresFallbackEligibility) {
        const desiredCount = offset + limit + 1
        const rankedWatchabilityById = new Map<string, IndexedWatchability>()
        const watchabilityById = await this.hydrateCandidateWatchability(
          allCandidateGroups.flatMap((group) =>
            group.map((candidate) => candidate.videoId),
          ),
          target,
        )
        rankedCandidates = []
        for (const group of allCandidateGroups) {
          const ranked = bestRankedCandidate(group, watchabilityById)
          if (ranked) {
            rankedCandidates.push(ranked)
            const watchability = watchabilityById.get(ranked.candidate.videoId)
            if (watchability) {
              rankedWatchabilityById.set(ranked.candidate.videoId, watchability)
            }
          }
          if (rankedCandidates.length >= desiredCount) break
        }
        const candidatePage = rankedCandidates.slice(offset, offset + limit)
        const catalogById =
          await this.catalogDocuments<TypesenseWatchCatalogResultDocument>(
            candidatePage.map(({ candidate }) => candidate.videoId),
            CATALOG_RESULT_FIELDS,
          )
        hydratedById = new Map(
          candidatePage.flatMap(({ candidate }) => {
            const document = catalogById.get(candidate.videoId)
            const watchability = rankedWatchabilityById.get(candidate.videoId)
            return document && watchability
              ? [[candidate.videoId, { document, watchability }] as const]
              : []
          }),
        )
      } else {
        const candidateGroups = allCandidateGroups.slice(0, offset + limit + 1)
        hydratedById = await this.hydrateResultDocuments(
          candidateGroups.flatMap((group) =>
            group.map((candidate) => candidate.videoId),
          ),
          target,
        )
        const watchabilityById = new Map(
          [...hydratedById].map(([id, hydrated]) => [
            id,
            hydrated.watchability,
          ]),
        )
        rankedCandidates = candidateGroups.flatMap((group) => {
          const ranked = bestRankedCandidate(group, watchabilityById)
          return ranked ? [ranked] : []
        })
      }
    } else {
      const { candidates, lexicalHits } = retrieval
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
          const watchabilityKind = previewWatchabilityKind(preview, target)
          if (!isEligibleFallbackCandidate(candidate, watchabilityKind))
            return []
          return [
            {
              candidate,
              rankingRelevance: candidateRelevance(candidate),
              watchabilityKind,
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
        fallbackPage.map((entry) => entry.candidate.videoId),
        target,
      )
    }
    const pageCandidates = rankedCandidates.slice(offset, offset + limit)
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
      hasMore: rankedCandidates.length > offset + limit,
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
    lexicalLanguageSlug,
    targetLanguageSlug,
    evidenceLocales,
    candidateLimit,
    embeddingStartedAt,
    embeddingPromise,
    timelineStartedAt,
    laneStatuses,
  }: {
    titleQuery: string
    preferredLocale: string
    queryLocale: string
    lexicalLanguageSlug: string | null
    targetLanguageSlug: string
    evidenceLocales: EvidenceLocale[]
    candidateLimit: number
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
          elapsedMs: 0,
        }),
      )
    }

    const embeddingOutcome =
      evidenceLocales.length > 0 ? await embeddingPromise : null
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
    const titleFields = watchLexicalQueryFields(queryLocale, "title")
    const metadataFields = watchLexicalQueryFields(queryLocale, "metadata")
    const languageIdentities = (languageSlug: string | null, locale: string) =>
      [
        typesenseWatchLanguageIdentity({ languageSlug, locale }),
        typesenseWatchLanguageIdentity({ languageSlug: null, locale }),
      ].filter(
        (identity, index, all): identity is string =>
          Boolean(identity) && all.indexOf(identity) === index,
      )
    type LexicalSearch = Omit<LexicalLaneResult, "groups"> & {
      requests: TypesenseSearchRequest[]
    }
    const lexicalSearches: LexicalSearch[] = []
    const lexicalSearchKeys = new Set<string>()
    const addLexicalSearch = ({
      lane,
      query,
      fields,
      languageSlug,
      locale,
      fallbackOnly,
    }: {
      lane: "title" | "metadata"
      query: string
      fields: readonly string[]
      languageSlug: string | null
      locale: string
      fallbackOnly: boolean
    }) => {
      const identities = languageIdentities(languageSlug, locale)
      const key = [
        lane,
        query,
        fields.join(","),
        identities.join(","),
        Number(fallbackOnly),
      ].join("\u0000")
      if (lexicalSearchKeys.has(key)) return
      lexicalSearchKeys.add(key)
      lexicalSearches.push({
        lane,
        query,
        fields,
        evidenceLanguageSlug: fallbackOnly ? languageSlug : null,
        fallbackOnly,
        requests: lexicalLaneRequests(
          query,
          fields,
          identities,
          candidateLimit,
        ),
      })
    }
    const lexicalEvidence = evidenceLocales.find(
      ({ slug, locale }) =>
        slug === lexicalLanguageSlug || locale === queryLocale,
    )
    const lexicalFallbackOnly = lexicalEvidence?.fallbackOnly ?? false
    addLexicalSearch({
      lane: "title",
      query: titleQuery,
      fields: titleFields,
      languageSlug: lexicalLanguageSlug,
      locale: queryLocale,
      fallbackOnly: lexicalFallbackOnly,
    })
    addLexicalSearch({
      lane: "metadata",
      query: titleQuery,
      fields: metadataFields,
      languageSlug: lexicalLanguageSlug,
      locale: queryLocale,
      fallbackOnly: lexicalFallbackOnly,
    })
    const fallbackEvidence = evidenceLocales.find(
      ({ slug, fallbackOnly }) => slug === "english" && fallbackOnly,
    )
    if (fallbackEvidence) {
      const fallbackTitleFields = watchLexicalQueryFields(
        fallbackEvidence.locale,
        "title",
      )
      for (const query of watchSearchQueryVariants(
        titleQuery,
        targetLanguageSlug,
      )) {
        addLexicalSearch({
          lane: "title",
          query,
          fields: fallbackTitleFields,
          languageSlug: fallbackEvidence.slug,
          locale: fallbackEvidence.locale,
          fallbackOnly: true,
        })
      }
      addLexicalSearch({
        lane: "metadata",
        query: titleQuery,
        fields: watchLexicalQueryFields(fallbackEvidence.locale, "metadata"),
        languageSlug: fallbackEvidence.slug,
        locale: fallbackEvidence.locale,
        fallbackOnly: true,
      })
    }
    type NativeSearch =
      | {
          kind: "lexical"
          lexicalSearchIndex: number
          request: TypesenseSearchRequest
        }
      | {
          kind: "semantic"
          fallbackOnly: boolean
          request: TypesenseSearchRequest
        }
    const nativeSearches: NativeSearch[] = lexicalSearches.flatMap(
      ({ requests }, lexicalSearchIndex) =>
        requests.map((request) => ({
          kind: "lexical" as const,
          lexicalSearchIndex,
          request,
        })),
    )
    if (embedding) {
      for (const fallbackOnly of [false, true]) {
        const semanticEvidenceLocales = evidenceLocales.filter(
          (evidence) => evidence.fallbackOnly === fallbackOnly,
        )
        if (semanticEvidenceLocales.length === 0) continue
        nativeSearches.push({
          kind: "semantic",
          fallbackOnly,
          request: semanticLaneRequest(
            embedding,
            semanticEvidenceLocales,
            candidateLimit,
          ),
        })
      }
    }
    try {
      const results = await multiSearchInBatches<
        TypesenseWatchLexicalDocument | TypesenseWatchTranscriptDocument
      >(
        this.typesense,
        nativeSearches.map(({ request }) => request),
      )
      const lexicalGroups = lexicalSearches.map(
        () => [] as TypesenseSearchGroup<TypesenseWatchLexicalDocument>[],
      )
      const semanticLanes: Array<{
        fallbackOnly: boolean
        groups: TypesenseSearchGroup<TypesenseWatchTranscriptDocument>[]
      }> = []
      nativeSearches.forEach((search, index) => {
        const result = results[index]
        if (search.kind === "semantic") {
          semanticLanes.push({
            fallbackOnly: search.fallbackOnly,
            groups: (result?.grouped_hits ??
              []) as TypesenseSearchGroup<TypesenseWatchTranscriptDocument>[],
          })
          return
        }
        lexicalGroups[search.lexicalSearchIndex]?.push(
          ...((result?.grouped_hits ??
            []) as TypesenseSearchGroup<TypesenseWatchLexicalDocument>[]),
        )
      })
      const lexicalLanes = lexicalSearches.map(
        ({ requests: _requests, ...search }, index): LexicalLaneResult => ({
          ...search,
          groups: (lexicalGroups[index] ?? []).slice(0, candidateLimit),
        }),
      )
      const candidateGroups = this.buildFusedCandidateGroups({
        lexicalLanes,
        semanticLanes,
        evidenceLocales,
      })
      const lexicalGroupIds = new Set(
        lexicalLanes.flatMap(({ groups }) =>
          groups.map((group) => group.group_key[0]),
        ),
      )
      const semanticGroupIds = new Set(
        semanticLanes.flatMap(({ groups }) =>
          groups.flatMap((group) => group.group_key),
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
          resultCount: semanticGroupIds.size,
          reason: embedding ? undefined : "missing_query_embedding",
        }),
      )
      return {
        kind: "native",
        candidateGroups,
      }
    } catch (error) {
      if (!isMissingLexicalProjection(error)) throw error
      const reason =
        error instanceof Error ? error.message : "lexical_projection_failure"
      this.logger.warn(
        `[typesense-watch-search] event=lexical_projection_fallback error_class=${error instanceof Error ? error.constructor.name : "UnknownError"}`,
      )
      const fallbackStartedAt = performance.now()
      const legacyCandidateLimit = embedding
        ? MAX_LEGACY_LEXICAL_CANDIDATES_WITH_SEMANTIC
        : MAX_LEXICAL_CANDIDATES
      if (candidateLimit > legacyCandidateLimit) {
        throw new WatchSearchValidationError(
          `Degraded legacy pagination exceeds the supported ${legacyCandidateLimit}-candidate window`,
        )
      }
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
        kind: "legacy",
        candidates: this.buildCandidates({
          query: titleQuery,
          preferredLocale,
          lexicalHits,
          semanticHits,
          evidenceLocales,
          fallbackLexicalOnly: evidenceLocales.some(
            ({ fallbackOnly }) => fallbackOnly,
          ),
        }),
        lexicalHits,
      }
    }
  }

  private buildFusedCandidateGroups({
    lexicalLanes,
    semanticLanes,
    evidenceLocales,
  }: {
    lexicalLanes: LexicalLaneResult[]
    semanticLanes: Array<{
      fallbackOnly: boolean
      groups: TypesenseSearchGroup<TypesenseWatchTranscriptDocument>[]
    }>
    evidenceLocales: EvidenceLocale[]
  }): Candidate[][] {
    type GroupState = {
      canonicalVideoId: string
      wholeTitleMatch: boolean
      members: Map<string, Candidate>
      laneContributions: Partial<Record<CandidateLane, number>>
      memberLaneContributions: Map<
        string,
        Partial<Record<CandidateLane, number>>
      >
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

    const addGroupContribution = (
      state: GroupState,
      lane: CandidateLane,
      contribution: number,
    ) => {
      const previous = state.laneContributions[lane] ?? 0
      if (contribution <= previous) return
      state.laneContributions[lane] = contribution
    }

    const addCandidate = (
      state: GroupState,
      candidate: Candidate,
      lane: CandidateLane,
      contribution: number,
    ) => {
      const existing = state.members.get(candidate.videoId)
      const laneContributions =
        state.memberLaneContributions.get(candidate.videoId) ?? {}
      const previousContribution = laneContributions[lane] ?? 0
      if (contribution > previousContribution) {
        laneContributions[lane] = contribution
        state.memberLaneContributions.set(candidate.videoId, laneContributions)
      }
      if (!existing) {
        state.members.set(candidate.videoId, {
          ...candidate,
          sourceScore: 0,
        })
        return
      }
      const kindRank = { exact: 3, semantic: 2, metadata: 1 } as const
      const sameEvidenceRole = candidate.fallbackOnly === existing.fallbackOnly
      const preferred = !sameEvidenceRole
        ? existing.fallbackOnly
          ? candidate
          : existing
        : kindRank[candidate.kind] > kindRank[existing.kind]
          ? candidate
          : existing
      const mergedEvidence = sameEvidenceRole
        ? {
            snippet: candidate.snippet ?? existing.snippet,
            startSeconds: candidate.startSeconds ?? existing.startSeconds,
            evidenceLanguageSlug:
              candidate.evidenceLanguageSlug ?? existing.evidenceLanguageSlug,
          }
        : {}
      state.members.set(candidate.videoId, {
        ...preferred,
        ...mergedEvidence,
        wholeTitleMatch: existing.wholeTitleMatch || candidate.wholeTitleMatch,
        sourceScore: 0,
      })
    }

    const addLexicalLane = (laneResult: LexicalLaneResult) => {
      const { groups: laneGroups, fields, lane } = laneResult
      const weight = lane === "title" ? TITLE_LANE_WEIGHT : METADATA_LANE_WEIGHT
      const classifyTitleMatch = createTitleMatchClassifier(laneResult.query)
      laneGroups.forEach((group, rank) => {
        const canonicalVideoId = group.group_key[0]
        if (!canonicalVideoId) return
        const contribution = weight / (RRF_RANK_CONSTANT + rank + 1)
        const state = groups.get(canonicalVideoId) ?? {
          canonicalVideoId,
          wholeTitleMatch: false,
          members: new Map<string, Candidate>(),
          laneContributions: {},
          memberLaneContributions: new Map(),
        }
        addGroupContribution(state, lane, contribution)
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
              kind: exact ? "exact" : "metadata",
              wholeTitleMatch,
              sourceScore: 0,
              evidenceLanguageSlug: laneResult.evidenceLanguageSlug,
              snippet: lane === "metadata" ? (values[0] ?? null) : null,
              startSeconds: null,
              fallbackOnly: laneResult.fallbackOnly,
            },
            lane,
            contribution,
          )
        }
        groups.set(canonicalVideoId, state)
      })
    }

    lexicalLanes.forEach(addLexicalLane)
    semanticLanes.forEach(({ fallbackOnly, groups: semanticGroups }) => {
      semanticGroups.forEach((group, rank) => {
        const canonicalVideoId = group.group_key[0]
        if (!canonicalVideoId) return
        const relevantHits = group.hits.filter(
          (hit) =>
            hit.vector_distance != null &&
            1 - hit.vector_distance >= MIN_SEMANTIC_SIMILARITY,
        )
        if (relevantHits.length === 0) return
        const contribution =
          SEMANTIC_LANE_WEIGHT / (RRF_RANK_CONSTANT + rank + 1)
        const state = groups.get(canonicalVideoId) ?? {
          canonicalVideoId,
          wholeTitleMatch: false,
          members: new Map<string, Candidate>(),
          laneContributions: {},
          memberLaneContributions: new Map(),
        }
        addGroupContribution(state, "semantic", contribution)
        for (const hit of relevantHits) {
          const evidenceLocale = evidenceLocales.find(
            ({ locale }) => locale === hit.document.language,
          )
          addCandidate(
            state,
            {
              videoId: hit.document.videoId,
              kind: "semantic",
              wholeTitleMatch: false,
              sourceScore: 0,
              evidenceLanguageSlug: evidenceLocale?.slug ?? null,
              snippet: hit.document.text,
              startSeconds:
                hit.document.startSeconds == null
                  ? null
                  : Math.max(0, Math.floor(hit.document.startSeconds)),
              fallbackOnly,
            },
            "semantic",
            contribution,
          )
        }
        groups.set(canonicalVideoId, state)
      })
    })

    const totalContribution = (
      contributions: Partial<Record<CandidateLane, number>>,
    ) =>
      Object.values(contributions).reduce(
        (total, contribution) => total + (contribution ?? 0),
        0,
      )

    return [...groups.values()]
      .map((group) => ({
        group,
        fusedScore: totalContribution(group.laneContributions),
      }))
      .sort((left, right) => {
        const wholeTitleDelta =
          Number(right.group.wholeTitleMatch) -
          Number(left.group.wholeTitleMatch)
        if (wholeTitleDelta !== 0) return wholeTitleDelta
        const scoreDelta = right.fusedScore - left.fusedScore
        if (scoreDelta !== 0) return scoreDelta
        return left.group.canonicalVideoId.localeCompare(
          right.group.canonicalVideoId,
        )
      })
      .map(({ group }) =>
        [...group.members.values()]
          .map((candidate) => ({
            ...candidate,
            sourceScore: Math.min(
              1,
              totalContribution(
                group.memberLaneContributions.get(candidate.videoId) ?? {},
              ) / maxCandidateScore,
            ),
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
    fallbackLexicalOnly,
  }: {
    query: string
    preferredLocale: string
    lexicalHits: TypesenseSearchHit<TypesenseWatchCatalogPreviewDocument>[]
    semanticHits: TypesenseSearchHit<TypesenseWatchTranscriptDocument>[]
    evidenceLocales: EvidenceLocale[]
    fallbackLexicalOnly: boolean
  }): Candidate[] {
    const candidates = new Map<string, Candidate>()
    const classifyTitleMatch = createTitleMatchClassifier(query)
    lexicalHits.forEach((hit, index) => {
      const locale = displayPreviewLocale(hit.document, preferredLocale)
      const evidenceLocale = evidenceLocales.find(
        (evidence) => evidence.locale === locale.locale,
      )
      const { exact, wholeTitleMatch } = classifyTitleMatch([locale.title])
      candidates.set(hit.document.id, {
        videoId: hit.document.id,
        kind: exact ? "exact" : "metadata",
        wholeTitleMatch,
        sourceScore: exact
          ? 1
          : Math.max(0.3, 1 - index / Math.max(lexicalHits.length, 1) / 2),
        evidenceLanguageSlug: null,
        snippet: locale.description,
        startSeconds: null,
        fallbackOnly:
          fallbackLexicalOnly || (evidenceLocale?.fallbackOnly ?? false),
      })
    })
    for (const hit of semanticHits) {
      const similarity = 1 - (hit.vector_distance ?? 1)
      if (similarity < MIN_SEMANTIC_SIMILARITY) continue
      const evidenceLocale = evidenceLocales.find(
        ({ locale }) => locale === hit.document.language,
      )
      const candidate: Candidate = {
        videoId: hit.document.videoId,
        kind: "semantic",
        wholeTitleMatch: false,
        sourceScore: Math.max(0, Math.min(1, similarity)),
        evidenceLanguageSlug: evidenceLocale?.slug ?? null,
        snippet: hit.document.text,
        startSeconds:
          hit.document.startSeconds == null
            ? null
            : Math.max(0, Math.floor(hit.document.startSeconds)),
        fallbackOnly: evidenceLocale?.fallbackOnly ?? false,
      }
      const existing = candidates.get(hit.document.videoId)
      if (existing) {
        if (existing.fallbackOnly !== candidate.fallbackOnly) {
          if (!existing.fallbackOnly) continue
        } else {
          if (existing.kind !== "semantic") continue
          if (existing.sourceScore >= candidate.sourceScore) continue
        }
      }
      candidates.set(hit.document.videoId, candidate)
    }
    return [...candidates.values()]
  }

  private async hydrateCandidateWatchability(
    videoIds: readonly string[],
    target: TargetLanguageContext,
  ): Promise<Map<string, IndexedWatchability>> {
    const ids = [...new Set(videoIds)]
    if (ids.length === 0) return new Map()

    const languageIds = [target.id, ...target.fallbackLanguageIds].filter(
      (value, index, all): value is string =>
        value != null && all.indexOf(value) === index,
    )
    type WatchabilitySearch = {
      kind: "catalog" | "availability"
      request: TypesenseSearchRequest
    }
    const searches: WatchabilitySearch[] = []
    for (
      let index = 0;
      index < ids.length;
      index += MAX_CATALOG_HYDRATION_BATCH
    ) {
      const batch = ids.slice(index, index + MAX_CATALOG_HYDRATION_BATCH)
      searches.push({
        kind: "catalog",
        request: {
          collection: TYPESENSE_WATCH_CATALOG_ALIAS,
          q: "*",
          filter_by: `id:=[${batch.map((id) => `\`${id}\``).join(",")}]`,
          per_page: batch.length,
          include_fields: "id",
        },
      })
    }
    if (languageIds.length > 0) {
      const videoBatchSize = Math.max(
        1,
        Math.floor(TYPESENSE_MAX_PER_PAGE / languageIds.length),
      )
      for (let index = 0; index < ids.length; index += videoBatchSize) {
        const batch = ids.slice(index, index + videoBatchSize)
        searches.push({
          kind: "availability",
          request: {
            collection: TYPESENSE_WATCH_AVAILABILITY_ALIAS,
            q: "*",
            filter_by: `videoId:=[${batch.map((id) => `\`${id}\``).join(",")}] && languageId:=[${languageIds.map((id) => `\`${id}\``).join(",")}]`,
            per_page: batch.length * languageIds.length,
            include_fields: AVAILABILITY_RESULT_FIELDS,
          },
        })
      }
    }

    try {
      const results = await multiSearchInBatches<
        TypesenseWatchCatalogIdDocument | TypesenseWatchAvailabilityDocument
      >(
        this.typesense,
        searches.map(({ request }) => request),
      )
      const catalogIds = new Set<string>()
      const availabilityByVideoId = new Map<
        string,
        TypesenseWatchAvailabilityDocument[]
      >()
      searches.forEach((search, index) => {
        for (const hit of results[index]?.hits ?? []) {
          if (search.kind === "catalog") {
            catalogIds.add((hit.document as TypesenseWatchCatalogIdDocument).id)
            continue
          }
          const document = hit.document as TypesenseWatchAvailabilityDocument
          const entries = availabilityByVideoId.get(document.videoId) ?? []
          entries.push(document)
          availabilityByVideoId.set(document.videoId, entries)
        }
      })
      return new Map(
        [...catalogIds].map((id) => [
          id,
          resolveWatchability(availabilityByVideoId.get(id) ?? [], target),
        ]),
      )
    } catch (error) {
      if (!isMissingAvailabilityAlias(error)) throw error
      this.logger.warn(
        "[typesense-watch-search] event=availability_alias_fallback",
      )
      const legacyById =
        await this.catalogDocuments<TypesenseWatchLegacyWatchabilityDocument>(
          ids,
          "id,audioOptionsJson,subtitleOptionsJson",
        )
      return new Map(
        [...legacyById].map(([id, document]) => [
          id,
          resolveLegacyWatchability(document, target),
        ]),
      )
    }
  }

  private async hydrateResultDocuments(
    videoIds: readonly string[],
    target: TargetLanguageContext,
  ): Promise<Map<string, HydratedResultDocument>> {
    const ids = [...new Set(videoIds)]
    if (ids.length === 0) return new Map()

    const languageIds = [target.id, ...target.fallbackLanguageIds].filter(
      (value, index, all): value is string =>
        value != null && all.indexOf(value) === index,
    )
    type HydrationSearch = {
      kind: "catalog" | "availability"
      request: TypesenseSearchRequest
    }
    const searches: HydrationSearch[] = []
    for (
      let index = 0;
      index < ids.length;
      index += MAX_CATALOG_HYDRATION_BATCH
    ) {
      const batch = ids.slice(index, index + MAX_CATALOG_HYDRATION_BATCH)
      searches.push({
        kind: "catalog",
        request: {
          collection: TYPESENSE_WATCH_CATALOG_ALIAS,
          q: "*",
          filter_by: `id:=[${batch.map((id) => `\`${id}\``).join(",")}]`,
          per_page: batch.length,
          include_fields: CATALOG_RESULT_FIELDS,
        },
      })
    }
    if (languageIds.length > 0) {
      const videoBatchSize = Math.max(
        1,
        Math.floor(TYPESENSE_MAX_PER_PAGE / languageIds.length),
      )
      for (let index = 0; index < ids.length; index += videoBatchSize) {
        const batch = ids.slice(index, index + videoBatchSize)
        searches.push({
          kind: "availability",
          request: {
            collection: TYPESENSE_WATCH_AVAILABILITY_ALIAS,
            q: "*",
            filter_by: `videoId:=[${batch.map((id) => `\`${id}\``).join(",")}] && languageId:=[${languageIds.map((id) => `\`${id}\``).join(",")}]`,
            per_page: batch.length * languageIds.length,
            include_fields: AVAILABILITY_RESULT_FIELDS,
          },
        })
      }
    }

    try {
      const results = await multiSearchInBatches<
        TypesenseWatchCatalogResultDocument | TypesenseWatchAvailabilityDocument
      >(
        this.typesense,
        searches.map(({ request }) => request),
      )
      const catalogById = new Map<string, TypesenseWatchCatalogResultDocument>()
      const availabilityByVideoId = new Map<
        string,
        TypesenseWatchAvailabilityDocument[]
      >()
      searches.forEach((search, index) => {
        for (const hit of results[index]?.hits ?? []) {
          if (search.kind === "catalog") {
            const document = hit.document as TypesenseWatchCatalogResultDocument
            catalogById.set(document.id, document)
            continue
          }
          const document = hit.document as TypesenseWatchAvailabilityDocument
          const entries = availabilityByVideoId.get(document.videoId) ?? []
          entries.push(document)
          availabilityByVideoId.set(document.videoId, entries)
        }
      })
      return new Map(
        [...catalogById].map(([id, document]) => [
          id,
          {
            document,
            watchability: resolveWatchability(
              availabilityByVideoId.get(id) ?? [],
              target,
            ),
          },
        ]),
      )
    } catch (error) {
      if (!isMissingAvailabilityAlias(error)) throw error
      this.logger.warn(
        "[typesense-watch-search] event=availability_alias_fallback",
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
            watchability: resolveLegacyWatchability(document, target),
          },
        ]),
      )
    }
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
    const results = await multiSearchInBatches<TDocument>(
      this.typesense,
      searches,
    )
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
  ): Promise<EvidenceLocale[]> {
    const requestedSlugs = [
      interpretation.targetLanguageSlug,
      interpretation.queryLanguageSlug,
      interpretation.queryNamedLanguageSlug,
      interpretation.displayLanguageSlug,
      interpretation.routeLanguageSlug,
    ]
      .filter((value): value is string => Boolean(value))
      .filter((value, index, all) => all.indexOf(value) === index)
    const usesEnglishFallback = interpretation.targetLanguageSlug !== "english"
    const addEnglishEvidence =
      usesEnglishFallback && !requestedSlugs.includes("english")
    const evidenceRequests = [
      ...requestedSlugs
        .slice(0, MAX_EVIDENCE_LOCALES - Number(addEnglishEvidence))
        .map((slug) => ({
          slug,
          fallbackOnly: usesEnglishFallback && slug === "english",
        })),
      ...(addEnglishEvidence ? [{ slug: "english", fallbackOnly: true }] : []),
    ]
    const slugs = evidenceRequests.map(({ slug }) => slug)
    return cachedBoundedTtlValue({
      cacheByOwner: evidenceLocaleCaches,
      owner: this.prisma,
      key: evidenceRequests
        .map(({ slug, fallbackOnly }) => `${slug}:${Number(fallbackOnly)}`)
        .join("\u0000"),
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
        return evidenceRequests.flatMap(({ slug, fallbackOnly }) => {
          const locale = localeForLanguageSlug(slug) ?? bcp47BySlug.get(slug)
          return locale ? [{ slug, locale, fallbackOnly }] : []
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
