import { randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import {
  TypesenseClient,
  TypesenseRequestError,
  type TypesenseSearchHit,
  type TypesenseSearchRequest,
} from "./typesense-client"
import { tokenizeForExactTitle } from "./hybrid-search-keyword-first-retrievers"
import {
  TYPESENSE_WATCH_AVAILABILITY_ALIAS,
  TYPESENSE_WATCH_CATALOG_ALIAS,
  TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
  type TypesenseWatchAudioOption,
  type TypesenseWatchAvailabilityDocument,
  type TypesenseWatchCatalogDocument,
  type TypesenseWatchSubtitleOption,
  type TypesenseWatchTranscriptDocument,
} from "./typesense-watch-search-schema"
import {
  displayLocale,
  displayPreviewLocale,
  hasAlignedLocaleCodes,
  type TypesenseWatchCatalogPreviewDocument,
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
const MAX_LEXICAL_CANDIDATES =
  TYPESENSE_MAX_PER_PAGE * TYPESENSE_MAX_MULTI_SEARCHES
const MAX_SEMANTIC_CANDIDATES = 40
const MAX_CATALOG_HYDRATION_BATCH = 250
const MAX_EVIDENCE_LOCALES = 3
const WATCHABILITY_RERANK_CANDIDATE_LIMIT = 100
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
  return (
    error instanceof TypesenseRequestError &&
    (error.status === 404 ||
      error.message.includes(TYPESENSE_WATCH_AVAILABILITY_ALIAS))
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

function lexicalSearchRequests(
  query: string,
  candidateLimit: number,
): TypesenseSearchRequest[] {
  const perPage = Math.min(candidateLimit, TYPESENSE_MAX_PER_PAGE)
  const pageCount = Math.ceil(candidateLimit / perPage)
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
  document: TypesenseWatchLegacyCatalogResultDocument,
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
    const titleQuery = queryWithoutLanguageHints(query, [
      languageInterpretation.queryNamedLanguageSlug,
      languageInterpretation.targetLanguageSlug,
    ])
    const candidateLimit = Math.min(
      Math.max(
        offset + limit + 1,
        limit * 2,
        WATCHABILITY_RERANK_CANDIDATE_LIMIT,
      ),
      MAX_LEXICAL_CANDIDATES,
    )
    const laneStatuses: WatchSearchLaneStatus[] = []

    const lexicalStartedAt = performance.now()
    const lexicalPromise = this.typesense
      .multiSearch<TypesenseWatchCatalogPreviewDocument>(
        lexicalSearchRequests(titleQuery, candidateLimit),
      )
      .then(async (results) => {
        const hits = results
          .flatMap((result) => result.hits)
          .slice(0, candidateLimit)
        const previewHits = await this.withLegacyLocaleProjection(hits)
        laneStatuses.push(
          laneStatus({
            lane: "metadata_retrieval",
            status: "fulfilled",
            timelineStartedAt: startedAt,
            startedAt: lexicalStartedAt,
            resultCount: previewHits.length,
          }),
        )
        return previewHits
      })

    const semanticStartedAt = performance.now()
    let semanticRetrievalStartedAt: number | null = null
    const semanticPromise = this.semanticHits(query, evidenceLocales, () => {
      semanticRetrievalStartedAt = performance.now()
      laneStatuses.push(
        laneStatus({
          lane: "semantic_embedding",
          status: "fulfilled",
          timelineStartedAt: startedAt,
          startedAt: semanticStartedAt,
          resultCount: 1,
        }),
      )
    })
      .then((hits) => {
        if (semanticRetrievalStartedAt != null) {
          laneStatuses.push(
            laneStatus({
              lane: "semantic_retrieval",
              status: "fulfilled",
              timelineStartedAt: startedAt,
              startedAt: semanticRetrievalStartedAt,
              resultCount: hits.length,
            }),
          )
        } else {
          laneStatuses.push(
            laneStatus({
              lane: "semantic_embedding",
              status: "skipped",
              timelineStartedAt: startedAt,
              startedAt: semanticStartedAt,
              resultCount: 0,
              reason: "no_evidence_language",
            }),
            laneStatus({
              lane: "semantic_retrieval",
              status: "skipped",
              timelineStartedAt: startedAt,
              startedAt: semanticStartedAt,
              resultCount: 0,
              reason: "no_evidence_language",
            }),
          )
        }
        return hits
      })
      .catch((error) => {
        this.logger.warn(
          `[typesense-watch-search] event=semantic_degraded error_class=${error instanceof Error ? error.constructor.name : "UnknownError"}`,
        )
        const reason =
          error instanceof Error ? error.message : "semantic_failure"
        if (semanticRetrievalStartedAt != null) {
          laneStatuses.push(
            laneStatus({
              lane: "semantic_retrieval",
              status: "degraded",
              timelineStartedAt: startedAt,
              startedAt: semanticRetrievalStartedAt,
              resultCount: 0,
              reason,
            }),
          )
        } else {
          laneStatuses.push(
            laneStatus({
              lane: "semantic_embedding",
              status: "degraded",
              timelineStartedAt: startedAt,
              startedAt: semanticStartedAt,
              resultCount: 0,
              reason,
            }),
            laneStatus({
              lane: "semantic_retrieval",
              status: "skipped",
              timelineStartedAt: startedAt,
              startedAt: performance.now(),
              resultCount: 0,
              reason: "missing_query_embedding",
            }),
          )
        }
        return []
      })

    const [lexicalHits, semanticHits] = await Promise.all([
      lexicalPromise,
      semanticPromise,
    ])
    const candidates = this.buildCandidates({
      query: titleQuery,
      preferredLocale,
      lexicalHits,
      semanticHits,
      evidenceLocales,
    })
    const watchabilityStartedAt = performance.now()
    const previewById = new Map<
      string,
      TypesenseWatchCatalogWatchabilityPreviewDocument
    >(lexicalHits.map((hit) => [hit.document.id, hit.document] as const))
    const missingPreviewIds = candidates
      .map((entry) => entry.videoId)
      .filter((videoId) => !previewById.has(videoId))
    const missingPreviews =
      await this.catalogDocuments<TypesenseWatchCatalogWatchabilityPreviewDocument>(
        missingPreviewIds,
        CATALOG_WATCHABILITY_PREVIEW_FIELDS,
      )
    for (const [videoId, document] of missingPreviews) {
      previewById.set(videoId, document)
    }

    const rankedCandidates = candidates
      .flatMap((candidate) => {
        const preview = previewById.get(candidate.videoId)
        if (!preview) return []
        const watchabilityKind = previewWatchabilityKind(preview, target)
        const rankingRelevance = candidateRelevance(candidate)
        return [{ candidate, rankingRelevance, watchabilityKind }]
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
    const pageCandidates = rankedCandidates.slice(offset, offset + limit)
    const hydratedById = await this.hydrateResultDocuments(
      pageCandidates.map((entry) => entry.candidate.videoId),
      target,
    )
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

  private async semanticHits(
    query: string,
    evidenceLocales: Array<{ slug: string; locale: string }>,
    onEmbedded: () => void,
  ): Promise<TypesenseSearchHit<TypesenseWatchTranscriptDocument>[]> {
    if (evidenceLocales.length === 0) return []
    const embedded = await withTimeout(
      this.embedder(query),
      this.embeddingTimeoutMs,
    )
    const embedding = Array.isArray(embedded)
      ? embedded
      : [...embedded.embedding]
    onEmbedded()
    const filterValues = evidenceLocales
      .map(({ locale }) => `\`${locale}\``)
      .join(",")
    const [result] =
      await this.typesense.multiSearch<TypesenseWatchTranscriptDocument>([
        {
          collection: TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
          q: "*",
          vector_query: `embedding:([${embedding.join(",")}], k:${MAX_SEMANTIC_CANDIDATES})`,
          filter_by: `language:=[${filterValues}] && publiclyVisible:=true`,
          per_page: MAX_SEMANTIC_CANDIDATES,
          exclude_fields: "embedding",
        },
      ])
    return result?.hits ?? []
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
    const normalizedQuery = normalizedTitle(query)
    const exactTitleTokens = tokenizeForExactTitle(query).map(normalizedTitle)
    lexicalHits.forEach((hit, index) => {
      const locale = displayPreviewLocale(hit.document, preferredLocale)
      const title = normalizedTitle(locale.title)
      const exact =
        exactTitleTokens.length > 0 &&
        exactTitleTokens.every((token) => title.includes(token))
      candidates.set(hit.document.id, {
        videoId: hit.document.id,
        kind: exact ? "exact" : "metadata",
        wholeTitleMatch: exact && title === normalizedQuery,
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
    videoIds: readonly string[],
    target: TargetLanguageContext,
  ): Promise<Map<string, HydratedResultDocument>> {
    const ids = [...new Set(videoIds)]
    if (ids.length === 0) return new Map()

    const languageIds = [target.id, ...target.fallbackLanguageIds].filter(
      (value, index, all): value is string =>
        value != null && all.indexOf(value) === index,
    )
    const searches: TypesenseSearchRequest[] = [
      {
        collection: TYPESENSE_WATCH_CATALOG_ALIAS,
        q: "*",
        filter_by: `id:=[${ids.map((id) => `\`${id}\``).join(",")}]`,
        per_page: ids.length,
        include_fields: CATALOG_RESULT_FIELDS,
      },
    ]
    if (languageIds.length > 0) {
      const videoBatchSize = Math.max(
        1,
        Math.floor(TYPESENSE_MAX_PER_PAGE / languageIds.length),
      )
      for (let index = 0; index < ids.length; index += videoBatchSize) {
        const batch = ids.slice(index, index + videoBatchSize)
        searches.push({
          collection: TYPESENSE_WATCH_AVAILABILITY_ALIAS,
          q: "*",
          filter_by: `videoId:=[${batch.map((id) => `\`${id}\``).join(",")}] && languageId:=[${languageIds.map((id) => `\`${id}\``).join(",")}]`,
          per_page: batch.length * languageIds.length,
          include_fields: AVAILABILITY_RESULT_FIELDS,
        })
      }
    }

    try {
      const [catalogResult, ...availabilityResults] =
        await this.typesense.multiSearch<
          | TypesenseWatchCatalogResultDocument
          | TypesenseWatchAvailabilityDocument
        >(searches)
      const availabilityByVideoId = new Map<
        string,
        TypesenseWatchAvailabilityDocument[]
      >()
      for (const hit of availabilityResults.flatMap((result) => result.hits)) {
        const document = hit.document as TypesenseWatchAvailabilityDocument
        const entries = availabilityByVideoId.get(document.videoId) ?? []
        entries.push(document)
        availabilityByVideoId.set(document.videoId, entries)
      }
      return new Map(
        (catalogResult?.hits ?? []).map((hit) => {
          const document = hit.document as TypesenseWatchCatalogResultDocument
          return [
            document.id,
            {
              document,
              watchability: resolveWatchability(
                availabilityByVideoId.get(document.id) ?? [],
                target,
              ),
            },
          ] as const
        }),
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
    const results = await this.typesense.multiSearch<TDocument>(searches)
    return new Map(
      results.flatMap((result) =>
        result.hits.map((hit) => [hit.document.id, hit.document] as const),
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
