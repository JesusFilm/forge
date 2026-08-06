import { createHash, randomUUID } from "node:crypto"

import type { PrismaClient } from "@prisma/client"
import {
  currentEmbeddingProviderIdentity,
  EmbeddingsBatchError,
  generateExperienceEmbedding,
} from "./embeddings.service"
import {
  searchByExactTitle,
  searchByKeywordWeighted,
  searchByTrigram,
  type ExactTitleResult,
  type KeywordWeightedResult,
  type TrigramResult,
} from "./hybrid-search-keyword-first-retrievers"
import { fuseRankedLists, type FusedResult } from "./hybrid-search-fusion"
import {
  searchVideoSemantic,
  type VideoSemanticResult,
} from "./hybrid-search-retrievers"
import {
  resolveSearchLanguageSignals,
  type SearchLanguageSignalSource,
} from "./search-language-resolution"
import {
  SearchWatchabilityService,
  type SearchWatchability,
} from "./search-watchability"
import { elapsedMs, nowMs } from "./hybrid-search-timing"
import { watchSearchQueryEmbeddingProcessCache } from "./watch-search-query-embedding-cache"

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const MAX_QUERY_LENGTH = 200
const WATCHABILITY_RERANK_CANDIDATE_LIMIT = 100
const SEMANTIC_CANDIDATE_LIMIT = 40
const MAX_EVIDENCE_LOCALES = 3
const MIN_METADATA_TOTAL_SCORE = 0.3
const MIN_SEMANTIC_TOTAL_SCORE = 0.35
const MIN_SEMANTIC_SOURCE_SCORE = 0.5
const DEFAULT_SEMANTIC_EMBEDDING_TIMEOUT_MS = 1_000
const QUERY_EMBEDDING_CACHE_TTL_MS = 24 * 60 * 60 * 1000
export const WATCH_SEARCH_STARTER_QUERIES = [
  "bible stories",
  "parables",
  "animated",
  "study",
  "family",
  "christmas",
] as const

export type WatchSearchResultType = "video" | "experience"
export type WatchSearchActionKind = "watch" | "open_experience"
export type WatchSearchAvailabilityKind =
  | "target_audio"
  | "target_subtitle"
  | "related_language"
  | "unavailable"
export type WatchSearchEvidenceKind =
  | "exact_title"
  | "language_availability"
  | "transcript_semantic"
  | "metadata"
export type WatchSearchFallbackKind =
  | "none"
  | "subtitle"
  | "related_language"
  | "unavailable"
export type WatchSearchLaneStatusKind = "fulfilled" | "degraded" | "skipped"
export type WatchSearchLaneDetail =
  | "cache_hit"
  | "cache_l1_hit"
  | "cache_l2_hit"
  | "cache_l2_error"
  | "cache_coalesced"
  | "cache_miss"
  | "cache_expired"
  | "cache_invalid"
  | EmbeddingsBatchError["code"]
  | `http_${number}`
export type WatchSearchLaneName =
  | "exact_title"
  | "exact_watchability"
  | "semantic_embedding"
  | "semantic_retrieval"
  | "metadata_retrieval"
  | "metadata_watchability"
  | "semantic_watchability"

export type WatchSearchInput = {
  query: string
  mode?: "default" | "modern" | null
  clientRequestId?: string | null
  targetLanguageSlug?: string | null
  queryLanguageSlug?: string | null
  queryNamedLanguageSlug?: string | null
  displayLanguageSlug?: string | null
  routeLanguageSlug?: string | null
  currentWatchLanguageSlug?: string | null
  acceptLanguage?: string | null
  limit?: number | null
  offset?: number | null
  resultTypes?: readonly WatchSearchResultType[] | null
}

export type WatchSearchLanguageInterpretation = {
  queryLanguageSlug: string | null
  queryNamedLanguageSlug: string | null
  targetLanguageSlug: string
  targetLanguageSource: SearchLanguageSignalSource
  displayLanguageSlug: string | null
  displayLanguageBcp47?: string | null
  routeLanguageSlug: string | null
  routeLanguageBcp47?: string | null
  currentWatchLanguageSlug: string | null
  acceptLanguage: string | null
  acceptLanguageSlug: string | null
}

export type WatchSearchAvailability = {
  kind: WatchSearchAvailabilityKind
  languageSlug: string | null
  languageEnglishName: string | null
  audio: boolean
  subtitles: boolean
}

export type WatchSearchEvidence = {
  kind: WatchSearchEvidenceKind
  languageSlug: string | null
  label: string | null
}

export type WatchSearchAction = {
  kind: WatchSearchActionKind
  hrefLanguageSlug: string | null
}

export type WatchSearchFallback = {
  kind: WatchSearchFallbackKind
  message: string | null
}

export type WatchSearchScoreBreakdown = {
  total: number
  sourceRelevance: number
  evidenceBoost: number
  relevance: number
  availability: number
  match: number
  sourceScore: number
}

export type WatchSearchResult = {
  type: WatchSearchResultType
  id: string
  slug: string
  title: string
  description: string | null
  snippet: string | null
  imageUrl: string | null
  imageBlurDataUrl: string | null
  muxThumbnailBlurDataUrl: string | null
  playbackId: string | null
  startSeconds: number | null
  score: number
  scoreBreakdown: WatchSearchScoreBreakdown
  label: string | null
  durationSeconds: number | null
  childCount: number | null
  languageSlug: string | null
  languageEnglishName: string | null
  availability: WatchSearchAvailability
  evidence: WatchSearchEvidence
  action: WatchSearchAction
  fallback: WatchSearchFallback
}

export type WatchSearchLaneStatus = {
  lane: WatchSearchLaneName
  status: WatchSearchLaneStatusKind
  startedOffsetMs: number
  elapsedMs: number
  resultCount: number
  reason: string | null
  detail: WatchSearchLaneDetail | null
}

export type WatchSearchResponse = {
  query: string
  results: WatchSearchResult[]
  hasMore: boolean
  nextOffset: number
  searchMode: string
  requestId: string
  degraded: boolean
  latencyMs: number
  laneStatuses: WatchSearchLaneStatus[]
  languageInterpretation: WatchSearchLanguageInterpretation
}

export class WatchSearchValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WatchSearchValidationError"
  }
}

export type WatchSearchQueryEmbeddingResult =
  | number[]
  | {
      embedding: readonly number[]
      detail?: WatchSearchLaneDetail | null
    }

export type WatchSearchQueryEmbedder = (
  text: string,
) => Promise<WatchSearchQueryEmbeddingResult>

export type WatchSearchServiceDeps = {
  embedder?: WatchSearchQueryEmbedder
  logger?: Pick<Console, "warn">
  semanticEmbeddingTimeoutMs?: number
}

function normalizeLimit(value: number | null | undefined): number {
  if (value == null) return DEFAULT_LIMIT
  if (!Number.isFinite(value)) return DEFAULT_LIMIT
  return Math.min(Math.max(Math.trunc(value), 1), MAX_LIMIT)
}

function normalizeOffset(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0
  return Math.max(Math.trunc(value), 0)
}

function normalizeClientRequestId(value: string | null | undefined): string {
  const normalized = value?.trim()
  if (!normalized || !/^[A-Za-z0-9_-]{8,80}$/.test(normalized)) {
    return randomUUID()
  }
  return normalized
}

function validateResultTypes(
  resultTypes: WatchSearchInput["resultTypes"],
): void {
  if (resultTypes == null) return
  for (const type of resultTypes) {
    if (type !== "video" && type !== "experience") {
      throw new WatchSearchValidationError(`Unsupported result type: ${type}`)
    }
  }
}

export class WatchSearchService {
  private readonly watchability: SearchWatchabilityService
  private readonly embedder: WatchSearchQueryEmbedder
  private readonly logger: Pick<Console, "warn">
  private readonly semanticEmbeddingTimeoutMs: number

  constructor(
    private readonly prisma: PrismaClient,
    deps: WatchSearchServiceDeps = {},
  ) {
    this.watchability = new SearchWatchabilityService(prisma)
    this.embedder =
      deps.embedder ?? ((text) => defaultWatchSearchEmbedder(prisma, text))
    this.logger = deps.logger ?? console
    this.semanticEmbeddingTimeoutMs =
      deps.semanticEmbeddingTimeoutMs ?? DEFAULT_SEMANTIC_EMBEDDING_TIMEOUT_MS
  }

  async search(input: WatchSearchInput): Promise<WatchSearchResponse> {
    const startedAt = performance.now()
    const query = input.query.trim().slice(0, MAX_QUERY_LENGTH)
    if (!query) {
      throw new WatchSearchValidationError("Search query is required")
    }

    const offset = normalizeOffset(input.offset)
    const limit = normalizeLimit(input.limit)
    const requestId = normalizeClientRequestId(input.clientRequestId)
    validateResultTypes(input.resultTypes)
    const languageInterpretation = await resolveSearchLanguageSignals({
      prisma: this.prisma,
      input,
    })
    const wantsVideos =
      input.resultTypes == null ||
      input.resultTypes.length === 0 ||
      input.resultTypes.includes("video")
    const videoSearch = wantsVideos
      ? await this.searchVideos({
          query,
          limit,
          offset,
          languageInterpretation,
        })
      : { results: [], hasMore: false, degraded: false, laneStatuses: [] }

    return {
      query,
      results: videoSearch.results,
      hasMore: videoSearch.hasMore,
      nextOffset: offset + limit,
      searchMode: "watch-search",
      requestId,
      degraded: videoSearch.degraded,
      latencyMs: performance.now() - startedAt,
      laneStatuses: videoSearch.laneStatuses,
      languageInterpretation,
    }
  }

  private async searchVideos({
    query,
    limit,
    offset,
    languageInterpretation,
  }: {
    query: string
    limit: number
    offset: number
    languageInterpretation: WatchSearchLanguageInterpretation
  }): Promise<{
    results: WatchSearchResult[]
    hasMore: boolean
    degraded: boolean
    laneStatuses: WatchSearchLaneStatus[]
  }> {
    const laneStatuses: WatchSearchLaneStatus[] = []
    const timelineStartedAt = nowMs()
    const displayLocale =
      localeForLanguageSlug(languageInterpretation.displayLanguageSlug) ??
      languageInterpretation.displayLanguageBcp47 ??
      localeForLanguageSlug(languageInterpretation.routeLanguageSlug) ??
      languageInterpretation.routeLanguageBcp47 ??
      "en"
    const titleQuery = queryWithoutLanguageHints(query, [
      languageInterpretation.queryNamedLanguageSlug,
      languageInterpretation.targetLanguageSlug,
    ])
    const semanticSearchPromise = this.searchSemanticVideos({
      query,
      languageInterpretation,
      timelineStartedAt,
    })
    const lexicalLimit = Math.max(
      offset + limit + 1,
      WATCHABILITY_RERANK_CANDIDATE_LIMIT,
    )
    const metadataRetrievalStartedAt = nowMs()
    const metadataRetrievalPromise = Promise.all([
      searchByKeywordWeighted(this.prisma, {
        query: titleQuery,
        locale: displayLocale,
        limit: lexicalLimit,
      }),
      searchByTrigram(this.prisma, {
        query: titleQuery,
        locale: displayLocale,
        limit: lexicalLimit,
      }),
    ])
    const exactTitleStartedAt = nowMs()
    const exactTitlePromise = searchByExactTitle(this.prisma, {
      query: titleQuery,
      locale: displayLocale,
      limit: lexicalLimit,
    })
    const exactPipelinePromise = exactTitlePromise.then(async (exactTitle) => {
      const exactTitleLaneStatus = laneStatus({
        lane: "exact_title",
        status: "fulfilled",
        startedOffsetMs: exactTitleStartedAt - timelineStartedAt,
        elapsedMs: elapsedMs(exactTitleStartedAt),
        resultCount: exactTitle.length,
      })
      const exactWatchabilityCandidates = exactTitle.map((candidate) => ({
        videoId: candidate.resultId,
      }))
      const exactWatchabilityStartedAt = nowMs()
      const exactWatchability =
        exactWatchabilityCandidates.length === 0
          ? new Map<string, SearchWatchability>()
          : await this.watchability.hydrate({
              candidates: exactWatchabilityCandidates,
              targetLanguageSlug: languageInterpretation.targetLanguageSlug,
            })

      return {
        exactTitle,
        exactWatchability,
        laneStatuses: [
          exactTitleLaneStatus,
          laneStatus({
            lane: "exact_watchability",
            status:
              exactWatchabilityCandidates.length === 0
                ? "skipped"
                : "fulfilled",
            startedOffsetMs: exactWatchabilityStartedAt - timelineStartedAt,
            elapsedMs: elapsedMs(exactWatchabilityStartedAt),
            resultCount: exactWatchability.size,
            reason:
              exactWatchabilityCandidates.length === 0
                ? "no_exact_title_candidates"
                : null,
          }),
        ],
      }
    })
    const metadataPipelinePromise = metadataRetrievalPromise.then(
      async ([keywordWeighted, trigram]) => {
        const metadataRetrievalLaneStatus = laneStatus({
          lane: "metadata_retrieval",
          status: "fulfilled",
          startedOffsetMs: metadataRetrievalStartedAt - timelineStartedAt,
          elapsedMs: elapsedMs(metadataRetrievalStartedAt),
          resultCount: keywordWeighted.length + trigram.length,
        })
        const exactTitle = await exactTitlePromise
        const exactVideoIds = new Set(
          exactTitle.map((candidate) => candidate.resultId),
        )
        const metadataCandidates = fuseMetadataCandidates({
          keywordWeighted,
          trigram,
        })
        const uniqueMetadataCandidates = metadataCandidates.filter(
          (candidate) => !exactVideoIds.has(candidate.resultId),
        )
        const metadataWatchabilityCandidates = uniqueMetadataCandidates.map(
          (candidate) => ({
            videoId: candidate.resultId,
          }),
        )
        const metadataWatchabilityStartedAt = nowMs()
        const metadataWatchability =
          metadataWatchabilityCandidates.length === 0
            ? new Map<string, SearchWatchability>()
            : await this.watchability.hydrate({
                candidates: metadataWatchabilityCandidates,
                targetLanguageSlug: languageInterpretation.targetLanguageSlug,
              })

        return {
          metadataCandidates: uniqueMetadataCandidates,
          metadataWatchability,
          laneStatuses: [
            metadataRetrievalLaneStatus,
            laneStatus({
              lane: "metadata_watchability",
              status:
                metadataWatchabilityCandidates.length === 0
                  ? "skipped"
                  : "fulfilled",
              startedOffsetMs:
                metadataWatchabilityStartedAt - timelineStartedAt,
              elapsedMs: elapsedMs(metadataWatchabilityStartedAt),
              resultCount: metadataWatchability.size,
              reason:
                metadataWatchabilityCandidates.length === 0
                  ? "no_metadata_candidates"
                  : null,
            }),
          ],
        }
      },
    )
    const semanticPipelinePromise = semanticSearchPromise.then(
      async (semanticSearch) => {
        const semanticCandidates = semanticSearch.results.filter(
          (candidate) => candidate.similarity >= MIN_SEMANTIC_SOURCE_SCORE,
        )
        const semanticWatchabilityStartedAt = nowMs()
        const semanticWatchability =
          semanticCandidates.length === 0
            ? new Map<string, SearchWatchability>()
            : await this.watchability.hydrate({
                candidates: semanticCandidates.map((candidate) => ({
                  videoId: candidate.resultId,
                })),
                targetLanguageSlug: languageInterpretation.targetLanguageSlug,
              })
        return {
          ...semanticSearch,
          semanticCandidates,
          semanticWatchability,
          semanticWatchabilityLaneStatus: laneStatus({
            lane: "semantic_watchability",
            status: semanticCandidates.length === 0 ? "skipped" : "fulfilled",
            startedOffsetMs: semanticWatchabilityStartedAt - timelineStartedAt,
            elapsedMs: elapsedMs(semanticWatchabilityStartedAt),
            resultCount: semanticWatchability.size,
            reason:
              semanticCandidates.length === 0 ? "no_semantic_candidates" : null,
          }),
        }
      },
    )
    const [exactPipeline, metadataPipeline, semanticPipeline] =
      await Promise.all([
        exactPipelinePromise,
        metadataPipelinePromise,
        semanticPipelinePromise,
      ])
    const { exactWatchability } = exactPipeline
    const { metadataWatchability } = metadataPipeline
    laneStatuses.push(
      ...metadataPipeline.laneStatuses,
      ...exactPipeline.laneStatuses,
    )
    laneStatuses.push(
      ...semanticPipeline.laneStatuses,
      semanticPipeline.semanticWatchabilityLaneStatus,
    )
    const rawCandidates = exactPipeline.exactTitle
    const exactVideoIds = new Set(
      rawCandidates.map((candidate) => candidate.resultId),
    )
    const uniqueMetadataCandidates = metadataPipeline.metadataCandidates.filter(
      (candidate) => !exactVideoIds.has(candidate.resultId),
    )
    const lexicalVideoIds = new Set([
      ...exactVideoIds,
      ...uniqueMetadataCandidates.map((candidate) => candidate.resultId),
    ])
    const uniqueSemanticCandidates = semanticPipeline.semanticCandidates.filter(
      (candidate) => !lexicalVideoIds.has(candidate.resultId),
    )
    const rankedExactCandidates = rawCandidates
      .map((candidate, index) => ({ candidate, index }))
      .sort((left, right) => {
        const availabilityDelta =
          watchabilityRank(exactWatchability.get(left.candidate.resultId)) -
          watchabilityRank(exactWatchability.get(right.candidate.resultId))
        return availabilityDelta || left.index - right.index
      })
    const mergedCandidates: Array<RankedWatchCandidate> = [
      ...rankedExactCandidates.map(({ candidate }) => ({
        kind: "exact" as const,
        candidate,
      })),
      ...uniqueMetadataCandidates.map((candidate) => ({
        kind: "metadata" as const,
        candidate,
      })),
      ...uniqueSemanticCandidates.map((candidate) => ({
        kind: "semantic" as const,
        candidate,
      })),
    ]
    const watchabilityFor = (entry: RankedWatchCandidate) => {
      if (entry.kind === "exact") {
        return exactWatchability.get(entry.candidate.resultId)
      }
      if (entry.kind === "metadata") {
        return metadataWatchability.get(entry.candidate.resultId)
      }
      return semanticPipeline.semanticWatchability.get(entry.candidate.resultId)
    }
    const rankedCandidates = mergedCandidates
      .map((entry) => {
        const watchability = watchabilityFor(entry)
        const { rankingRelevance, scoreBreakdown } = candidateScores(
          entry,
          watchability,
          titleQuery,
        )
        return {
          ...entry,
          wholeTitleMatch: isWholeTitleMatch(
            titleQuery,
            entry.candidate.videoTitle,
          ),
          watchability,
          watchabilityRank: watchabilityRank(watchability),
          rankingRelevance,
          scoreBreakdown,
        }
      })
      .filter(passesMinimumConfidence)
      .sort((left, right) => {
        const wholeTitleDelta =
          Number(right.wholeTitleMatch) - Number(left.wholeTitleMatch)
        if (wholeTitleDelta !== 0) return wholeTitleDelta

        const relevanceDelta = right.rankingRelevance - left.rankingRelevance
        if (relevanceDelta !== 0) return relevanceDelta

        const watchabilityDelta = left.watchabilityRank - right.watchabilityRank
        if (watchabilityDelta !== 0) return watchabilityDelta

        return left.candidate.resultId.localeCompare(right.candidate.resultId)
      })
    const candidates = rankedCandidates
      .slice(offset, offset + limit + 1)
      .map((entry) => entry)

    const results = candidates.slice(0, limit).map((entry) => {
      if (entry.kind === "semantic") {
        return mapSemanticCandidate({
          candidate: entry.candidate,
          scoreBreakdown: entry.scoreBreakdown,
          watchability: entry.watchability,
        })
      }
      if (entry.kind === "metadata") {
        return mapMetadataCandidate({
          candidate: entry.candidate,
          scoreBreakdown: entry.scoreBreakdown,
          watchability: entry.watchability,
        })
      }
      return mapExactTitleCandidate({
        candidate: entry.candidate,
        scoreBreakdown: entry.scoreBreakdown,
        watchability: entry.watchability,
      })
    })
    const [catalogByVideoId, imagesByVideoId] = await Promise.all([
      this.catalogFieldsForResults(results),
      this.imagesForResults(results),
    ])

    return {
      results: results.map((result) =>
        withSearchResultImage(
          withSearchResultCatalog(result, catalogByVideoId.get(result.id)),
          imagesByVideoId.get(result.id),
        ),
      ),
      hasMore: candidates.length > limit,
      degraded: semanticPipeline.degraded,
      laneStatuses,
    }
  }

  private async searchSemanticVideos({
    query,
    languageInterpretation,
    timelineStartedAt,
  }: {
    query: string
    languageInterpretation: WatchSearchLanguageInterpretation
    timelineStartedAt: number
  }): Promise<{
    results: SemanticVideoSearchResult[]
    degraded: boolean
    laneStatuses: WatchSearchLaneStatus[]
  }> {
    const laneStatuses: WatchSearchLaneStatus[] = []
    const semanticStartedAt = nowMs()
    const evidenceLocales = await this.evidenceLocales(languageInterpretation)
    if (evidenceLocales.length === 0) {
      laneStatuses.push(
        laneStatus({
          lane: "semantic_embedding",
          status: "skipped",
          startedOffsetMs: semanticStartedAt - timelineStartedAt,
          elapsedMs: 0,
          resultCount: 0,
          reason: "no_evidence_locales",
        }),
        laneStatus({
          lane: "semantic_retrieval",
          status: "skipped",
          startedOffsetMs: semanticStartedAt - timelineStartedAt,
          elapsedMs: 0,
          resultCount: 0,
          reason: "no_evidence_locales",
        }),
      )
      return { results: [], degraded: false, laneStatuses }
    }

    let queryEmbedding: string
    const embeddingStartedAt = nowMs()
    try {
      const embeddingResult = normalizeQueryEmbeddingResult(
        await withTimeout(
          this.embedder(query),
          this.semanticEmbeddingTimeoutMs,
          "query_embedding_timeout",
        ),
      )
      queryEmbedding = toPgvectorText(embeddingResult.embedding)
      laneStatuses.push(
        laneStatus({
          lane: "semantic_embedding",
          status: "fulfilled",
          startedOffsetMs: embeddingStartedAt - timelineStartedAt,
          elapsedMs: elapsedMs(embeddingStartedAt),
          resultCount: 1,
          detail: embeddingResult.detail,
        }),
      )
    } catch (error) {
      const logFields = queryEmbeddingFailureLogFields(error)
      this.logger.warn(
        `[watch-search] event=${queryEmbeddingFailureReason(error)} error_class=${error instanceof Error ? error.constructor.name : "UnknownError"}${logFields ? ` ${logFields}` : ""}`,
      )
      laneStatuses.push(
        laneStatus({
          lane: "semantic_embedding",
          status: "degraded",
          startedOffsetMs: embeddingStartedAt - timelineStartedAt,
          elapsedMs: elapsedMs(embeddingStartedAt),
          resultCount: 0,
          reason: queryEmbeddingFailureReason(error),
          detail: queryEmbeddingFailureDetail(error),
        }),
        laneStatus({
          lane: "semantic_retrieval",
          status: "skipped",
          startedOffsetMs: nowMs() - timelineStartedAt,
          elapsedMs: 0,
          resultCount: 0,
          reason: "missing_query_embedding",
        }),
      )
      return { results: [], degraded: true, laneStatuses }
    }

    const retrievalStartedAt = nowMs()
    const retrievals = await Promise.all(
      evidenceLocales.map(async ({ languageSlug, locale }) => {
        try {
          return {
            results: (
              await searchVideoSemantic(this.prisma, {
                queryEmbedding,
                locale,
                limit: SEMANTIC_CANDIDATE_LIMIT,
              })
            ).map((candidate) => ({
              ...candidate,
              evidenceLanguageSlug: languageSlug,
            })),
            degraded: false,
          }
        } catch (error) {
          this.logger.warn(
            `[watch-search] event=semantic_retrieval_failure locale=${locale} error_class=${error instanceof Error ? error.constructor.name : "UnknownError"}`,
          )
          return {
            locale,
            results: [],
            degraded: true,
          }
        }
      }),
    )
    const rawSemanticResults = dedupeSemanticResults(
      retrievals.flatMap((retrieval) => retrieval.results),
    )
    const semanticResults = rawSemanticResults.filter(
      (candidate) => candidate.similarity >= MIN_SEMANTIC_SOURCE_SCORE,
    )
    const retrievalDegraded = retrievals.some((retrieval) => retrieval.degraded)
    return {
      results: semanticResults,
      degraded: retrievalDegraded,
      laneStatuses: [
        ...laneStatuses,
        laneStatus({
          lane: "semantic_retrieval",
          status: retrievalDegraded ? "degraded" : "fulfilled",
          startedOffsetMs: retrievalStartedAt - timelineStartedAt,
          elapsedMs: elapsedMs(retrievalStartedAt),
          resultCount: semanticResults.length,
          reason: retrievalDegraded
            ? "partial_locale_failure"
            : rawSemanticResults.length > 0 && semanticResults.length === 0
              ? "below_confidence_threshold"
              : null,
        }),
      ],
    }
  }

  private async evidenceLocales(
    languageInterpretation: WatchSearchLanguageInterpretation,
  ): Promise<EvidenceLocale[]> {
    const languageSlugs = uniqueNonNull([
      languageInterpretation.targetLanguageSlug,
      languageInterpretation.queryLanguageSlug,
      languageInterpretation.queryNamedLanguageSlug,
      languageInterpretation.displayLanguageSlug,
      languageInterpretation.routeLanguageSlug,
    ]).slice(0, MAX_EVIDENCE_LOCALES)
    const languageRows = await this.prisma.language.findMany({
      where: {
        slug: { in: languageSlugs },
        deletedAt: null,
        bcp47: { not: null },
      },
      select: { slug: true, bcp47: true },
    })
    const bcp47BySlug = new Map(
      languageRows.flatMap((row) =>
        row.slug && row.bcp47 ? [[row.slug, row.bcp47] as const] : [],
      ),
    )
    const seenLocales = new Set<string>()
    const evidenceLocales: EvidenceLocale[] = []
    for (const languageSlug of languageSlugs) {
      const locale =
        localeForLanguageSlug(languageSlug) ?? bcp47BySlug.get(languageSlug)
      if (!locale || seenLocales.has(locale)) continue
      seenLocales.add(locale)
      evidenceLocales.push({ languageSlug, locale })
      if (evidenceLocales.length === MAX_EVIDENCE_LOCALES) break
    }
    return evidenceLocales
  }

  private async imagesForResults(
    results: readonly WatchSearchResult[],
  ): Promise<Map<string, WatchSearchResultImage>> {
    const videoIds = uniqueNonNull(results.map((result) => result.id))
    if (videoIds.length === 0) return new Map()

    const images = await this.prisma.videoImage.findMany({
      where: {
        videoId: { in: videoIds },
        deletedAt: null,
      },
      orderBy: [{ videoId: "asc" }, { id: "asc" }],
      select: {
        videoId: true,
        url: true,
        mobileCinematicHigh: true,
        mobileCinematicLow: true,
        videoStill: true,
        thumbnail: true,
        blurDataUrl: true,
      },
    })

    const byVideoId = new Map<string, WatchSearchResultImage>()
    for (const image of images) {
      if (byVideoId.has(image.videoId)) continue
      const imageUrl = bestVideoImageUrl(image)
      if (!imageUrl) continue
      byVideoId.set(image.videoId, {
        imageUrl,
        imageBlurDataUrl: image.blurDataUrl ?? null,
      })
    }
    return byVideoId
  }

  private async catalogFieldsForResults(
    results: readonly WatchSearchResult[],
  ): Promise<Map<string, WatchSearchResultCatalog>> {
    const videoIds = uniqueNonNull(
      results
        .filter((result) => result.type === "video")
        .map((result) => result.id),
    )
    if (videoIds.length === 0) return new Map()

    const videos = await this.prisma.video.findMany({
      where: {
        id: { in: videoIds },
        deletedAt: null,
      },
      select: {
        id: true,
        label: true,
        children: {
          where: {
            child: {
              deletedAt: null,
            },
          },
          select: {
            childId: true,
          },
        },
      },
    })

    return new Map(
      videos.map((video) => [
        video.id,
        {
          label: video.label ?? null,
          childCount: video.children.length,
        },
      ]),
    )
  }
}

type ExactTitleCandidate = ExactTitleResult

type MetadataCandidate = FusedResult & {
  resultType: "video"
  resultId: string
  videoCoreId: string | null
  videoSlug: string
  videoTitle: string
  imageUrl: null
  description: string | null
}

type RankedWatchCandidate =
  | { kind: "exact"; candidate: ExactTitleCandidate }
  | { kind: "metadata"; candidate: MetadataCandidate }
  | { kind: "semantic"; candidate: SemanticVideoSearchResult }

type EvidenceLocale = {
  languageSlug: string
  locale: string
}

type SemanticVideoSearchResult = VideoSemanticResult & {
  evidenceLanguageSlug: string
}

type WatchSearchResultImage = {
  imageUrl: string
  imageBlurDataUrl: string | null
}

type WatchSearchResultCatalog = {
  label: string | null
  childCount: number
}

function laneStatus({
  lane,
  status,
  startedOffsetMs,
  elapsedMs,
  resultCount,
  reason = null,
  detail = null,
}: {
  lane: WatchSearchLaneName
  status: WatchSearchLaneStatusKind
  startedOffsetMs: number
  elapsedMs: number
  resultCount: number
  reason?: string | null
  detail?: WatchSearchLaneDetail | null
}): WatchSearchLaneStatus {
  return {
    lane,
    status,
    startedOffsetMs: Math.max(0, startedOffsetMs),
    elapsedMs,
    resultCount,
    reason,
    detail,
  }
}

function toPgvectorText(embedding: readonly number[]): string {
  return `[${embedding.join(",")}]`
}

type CachedQueryEmbedding = {
  embedding: unknown
  expiresAt: Date | string
}

type QueryEmbeddingCacheLookup =
  | {
      embedding: number[]
      detail: "cache_l2_hit" | "cache_expired"
    }
  | {
      embedding: null
      detail: "cache_miss" | "cache_invalid" | "cache_expired"
    }

type QueryEmbeddingCacheKey = {
  provider: string
  model: string
  dimensions: number
  queryHash: string
}

function normalizeEmbeddingCacheText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function queryEmbeddingCacheKey(text: string): QueryEmbeddingCacheKey {
  const identity = currentEmbeddingProviderIdentity()
  const cacheIdentity = JSON.stringify({
    provider: identity.provider,
    model: identity.model,
    dimensions: identity.dimensions,
    text: normalizeEmbeddingCacheText(text),
  })

  return {
    provider: identity.provider,
    model: identity.model,
    dimensions: identity.dimensions,
    queryHash: createHash("sha256").update(cacheIdentity).digest("hex"),
  }
}

function cloneEmbedding(embedding: readonly number[]): number[] {
  return [...embedding]
}

function queryEmbeddingFailureReason(error: unknown): string {
  if (error instanceof WatchSearchTimeoutError) return error.event
  if (error instanceof EmbeddingsBatchError) {
    return `query_embedding_${error.code}`
  }
  return "query_embedding_failure"
}

function queryEmbeddingFailureDetail(
  error: unknown,
): WatchSearchLaneDetail | null {
  if (!(error instanceof EmbeddingsBatchError)) return null
  return error.status == null ? error.code : `http_${error.status}`
}

function queryEmbeddingFailureLogFields(error: unknown): string {
  if (!(error instanceof EmbeddingsBatchError)) return ""
  return [
    `error_code=${error.code}`,
    error.status == null ? null : `status=${error.status}`,
  ]
    .filter((field): field is string => field != null)
    .join(" ")
}

function normalizeQueryEmbeddingResult(
  result: WatchSearchQueryEmbeddingResult,
): { embedding: number[]; detail: WatchSearchLaneDetail | null } {
  if (Array.isArray(result)) {
    return { embedding: cloneEmbedding(result), detail: null }
  }

  return {
    embedding: cloneEmbedding(result.embedding),
    detail: result.detail ?? null,
  }
}

function parseCachedEmbedding(
  value: unknown,
  expectedDimensions: number,
): number[] | null {
  if (!Array.isArray(value)) return null
  if (
    value.length !== expectedDimensions ||
    !value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  ) {
    return null
  }
  return cloneEmbedding(value)
}

async function deleteCachedQueryEmbedding(
  prisma: PrismaClient,
  key: QueryEmbeddingCacheKey,
): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM query_embedding_cache
    WHERE provider = ${key.provider}
      AND model = ${key.model}
      AND dimensions = ${key.dimensions}
      AND query_hash = ${key.queryHash}
  `
}

async function readCachedQueryEmbedding(
  prisma: PrismaClient,
  key: QueryEmbeddingCacheKey,
): Promise<QueryEmbeddingCacheLookup> {
  const rows = await prisma.$queryRaw<CachedQueryEmbedding[]>`
    UPDATE query_embedding_cache
    SET last_used_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE provider = ${key.provider}
      AND model = ${key.model}
      AND dimensions = ${key.dimensions}
      AND query_hash = ${key.queryHash}
    RETURNING embedding, expires_at AS "expiresAt"
  `
  const cached = rows[0]
  if (cached == null) return { embedding: null, detail: "cache_miss" }

  const expiresAt =
    cached.expiresAt instanceof Date
      ? cached.expiresAt
      : new Date(cached.expiresAt)
  if (!Number.isFinite(expiresAt.getTime())) {
    await deleteCachedQueryEmbedding(prisma, key)
    return { embedding: null, detail: "cache_invalid" }
  }

  const embedding = parseCachedEmbedding(cached.embedding, key.dimensions)
  if (embedding == null) {
    await deleteCachedQueryEmbedding(prisma, key)
    return { embedding: null, detail: "cache_invalid" }
  }

  if (expiresAt <= new Date()) {
    await deleteCachedQueryEmbedding(prisma, key)
    return { embedding: null, detail: "cache_expired" }
  }

  return { embedding, detail: "cache_l2_hit" }
}

async function rememberQueryEmbedding(
  prisma: PrismaClient,
  key: QueryEmbeddingCacheKey,
  embedding: readonly number[],
): Promise<void> {
  const embeddingJson = JSON.stringify(embedding)
  await prisma.$executeRaw`
    INSERT INTO query_embedding_cache (
      id,
      provider,
      model,
      dimensions,
      query_hash,
      embedding,
      expires_at,
      last_used_at,
      created_at,
      updated_at
    )
    VALUES (
      ${randomUUID()},
      ${key.provider},
      ${key.model},
      ${key.dimensions},
      ${key.queryHash},
      ${embeddingJson}::jsonb,
      CURRENT_TIMESTAMP + (${QUERY_EMBEDDING_CACHE_TTL_MS} * INTERVAL '1 millisecond'),
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (provider, model, dimensions, query_hash)
    DO UPDATE SET
      embedding = EXCLUDED.embedding,
      expires_at = EXCLUDED.expires_at,
      last_used_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `
}

export async function defaultWatchSearchEmbedder(
  prisma: PrismaClient,
  text: string,
): Promise<WatchSearchQueryEmbeddingResult> {
  const key = queryEmbeddingCacheKey(text)
  const processCached = watchSearchQueryEmbeddingProcessCache.get(key)
  if (processCached != null) {
    return { embedding: processCached, detail: "cache_l1_hit" }
  }

  const flight = watchSearchQueryEmbeddingProcessCache.coalesce(
    key,
    async (): Promise<{
      embedding: number[]
      detail: WatchSearchLaneDetail
    }> => {
      let cached: QueryEmbeddingCacheLookup
      let durableCacheFailed = false
      try {
        cached = await readCachedQueryEmbedding(prisma, key)
      } catch {
        durableCacheFailed = true
        cached = { embedding: null, detail: "cache_miss" }
      }
      if (cached.embedding != null) {
        watchSearchQueryEmbeddingProcessCache.set(key, cached.embedding)
        return { embedding: cached.embedding, detail: cached.detail }
      }

      const result = await generateExperienceEmbedding(text)
      const embedding = parseCachedEmbedding(result.embedding, key.dimensions)
      if (embedding == null) {
        throw new Error(
          `Query embedding must contain ${key.dimensions} finite dimensions`,
        )
      }

      watchSearchQueryEmbeddingProcessCache.set(key, embedding)
      try {
        await rememberQueryEmbedding(prisma, key, embedding)
      } catch {
        // PostgreSQL is the cross-process cache, not a semantic-search dependency.
        durableCacheFailed = true
      }
      return {
        embedding,
        detail: durableCacheFailed ? "cache_l2_error" : cached.detail,
      }
    },
  )
  const result = await flight.promise
  return {
    embedding: cloneEmbedding(result.embedding),
    detail: flight.coalesced ? "cache_coalesced" : result.detail,
  }
}

export async function prewarmWatchSearchQueryEmbeddings({
  prisma,
  logger = console,
}: {
  prisma: PrismaClient
  logger?: Pick<Console, "warn">
}): Promise<void> {
  const results = await Promise.allSettled(
    WATCH_SEARCH_STARTER_QUERIES.map((query) =>
      defaultWatchSearchEmbedder(prisma, query),
    ),
  )
  const failures = results.filter((result) => result.status === "rejected")
  if (failures.length === 0) return

  logger.warn(
    `[watch-search] event=query_embedding_prewarm_failure failed=${failures.length} total=${WATCH_SEARCH_STARTER_QUERIES.length}`,
  )
}

class WatchSearchTimeoutError extends Error {
  constructor(readonly event: string) {
    super(event)
    this.name = "WatchSearchTimeoutError"
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  event: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new WatchSearchTimeoutError(event)),
          timeoutMs,
        )
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function uniqueNonNull(values: ReadonlyArray<string | null | undefined>) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = value?.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

function dedupeSemanticResults(
  results: readonly SemanticVideoSearchResult[],
): SemanticVideoSearchResult[] {
  const byVideoId = new Map<string, SemanticVideoSearchResult>()
  for (const result of results) {
    const existing = byVideoId.get(result.resultId)
    if (!existing || result.similarity > existing.similarity) {
      byVideoId.set(result.resultId, result)
    }
  }
  return [...byVideoId.values()].sort((a, b) => {
    const scoreDelta = b.similarity - a.similarity
    if (scoreDelta !== 0) return scoreDelta
    return a.resultId.localeCompare(b.resultId)
  })
}

function bestVideoImageUrl(image: {
  url: string | null
  mobileCinematicHigh: string | null
  mobileCinematicLow: string | null
  videoStill: string | null
  thumbnail: string | null
}): string | null {
  return (
    image.mobileCinematicHigh ??
    image.mobileCinematicLow ??
    image.videoStill ??
    image.thumbnail ??
    image.url ??
    null
  )
}

function withSearchResultImage(
  result: WatchSearchResult,
  image: WatchSearchResultImage | undefined,
): WatchSearchResult {
  if (!image || result.imageUrl) return result
  return {
    ...result,
    imageUrl: image.imageUrl,
    imageBlurDataUrl: image.imageBlurDataUrl,
  }
}

function withSearchResultCatalog(
  result: WatchSearchResult,
  catalog: WatchSearchResultCatalog | undefined,
): WatchSearchResult {
  if (!catalog || result.type !== "video") return result
  return {
    ...result,
    label: result.label ?? catalog.label,
    childCount: result.childCount ?? catalog.childCount,
  }
}

function fuseMetadataCandidates({
  keywordWeighted,
  trigram,
}: {
  keywordWeighted: KeywordWeightedResult[]
  trigram: TrigramResult[]
}): MetadataCandidate[] {
  return fuseRankedLists([keywordWeighted, trigram]).map((candidate) => ({
    resultType: "video",
    resultId: candidate.resultId,
    videoCoreId: candidate.videoCoreId ?? null,
    videoSlug: String(candidate.videoSlug ?? ""),
    videoTitle: String(candidate.videoTitle ?? ""),
    imageUrl: null,
    description:
      typeof candidate.description === "string" ? candidate.description : null,
    score: candidate.score,
  }))
}

function resultCandidateScore(entry: RankedWatchCandidate): number {
  if (entry.kind === "semantic") return entry.candidate.similarity
  if (entry.kind === "metadata") return entry.candidate.score
  return 1
}

function availabilityScore(
  watchability: SearchWatchability | undefined,
): number {
  if (watchability?.kind === "target_audio") return 0.25
  if (watchability?.kind === "target_subtitle") return 0.18
  if (watchability?.kind === "related_language") return 0.08
  return 0
}

function matchScore(entry: RankedWatchCandidate, query: string): number {
  if (entry.kind === "exact") {
    return isWholeTitleMatch(query, entry.candidate.videoTitle) ? 0.45 : 0.2
  }
  if (entry.kind === "metadata") return 0.14
  return 0.08
}

function normalizeWholeTitleMatchText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function isWholeTitleMatch(query: string, title: string): boolean {
  const normalizedQuery = normalizeWholeTitleMatchText(query)
  if (normalizedQuery.length === 0) return false
  return normalizedQuery === normalizeWholeTitleMatchText(title)
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000
}

function candidateScores(
  entry: RankedWatchCandidate,
  watchability: SearchWatchability | undefined,
  query: string,
): {
  rankingRelevance: number
  scoreBreakdown: WatchSearchScoreBreakdown
} {
  const sourceScore = Math.max(0, Math.min(1, resultCandidateScore(entry)))
  const sourceRelevance = sourceScore * 0.55
  const evidenceBoost = matchScore(entry, query)
  const relevance = sourceRelevance + evidenceBoost
  const availability = availabilityScore(watchability)
  const total = Math.min(1, relevance + availability)

  return {
    rankingRelevance: relevance,
    scoreBreakdown: {
      total: roundScore(total),
      sourceRelevance: roundScore(sourceRelevance),
      evidenceBoost: roundScore(evidenceBoost),
      relevance: roundScore(relevance),
      availability: roundScore(availability),
      match: roundScore(evidenceBoost),
      sourceScore: roundScore(sourceScore),
    },
  }
}

function passesMinimumConfidence(
  entry: RankedWatchCandidate & { scoreBreakdown: WatchSearchScoreBreakdown },
) {
  if (entry.kind === "exact") return true
  if (entry.kind === "metadata") {
    return entry.scoreBreakdown.total >= MIN_METADATA_TOTAL_SCORE
  }
  return entry.scoreBreakdown.total >= MIN_SEMANTIC_TOTAL_SCORE
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
    if (!slug) continue
    const words = slug.split(/[-_\s]+/).filter(Boolean)
    for (const word of words) {
      stripped = stripped.replace(
        new RegExp(`\\b${escapeRegExp(word)}\\b`, "gi"),
        " ",
      )
    }
  }
  const normalized = stripped.replace(/\s+/g, " ").trim()
  return normalized.length > 0 ? normalized : query
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function toWholeStartSeconds(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.max(0, Math.floor(value))
}

function watchabilityRank(
  watchability: SearchWatchability | undefined,
): number {
  if (watchability?.kind === "target_audio") return 0
  if (watchability?.kind === "target_subtitle") return 1
  if (watchability?.kind === "related_language") return 2
  return 3
}

function fallbackKindForWatchability(
  watchability: SearchWatchability | undefined,
): WatchSearchFallbackKind {
  if (!watchability || watchability.kind === "unavailable") return "unavailable"
  if (watchability.kind === "target_subtitle") return "subtitle"
  if (watchability.kind === "related_language") return "related_language"
  return "none"
}

function fallbackMessageForWatchability(
  watchability: SearchWatchability | undefined,
): string | null {
  if (!watchability || watchability.kind === "unavailable") {
    return "No playable target-language option is available."
  }
  if (watchability.kind === "target_subtitle") {
    return "Target-language subtitles are available."
  }
  if (watchability.kind === "related_language") {
    return "Playable in a related language."
  }
  return null
}

function mapExactTitleCandidate({
  candidate,
  scoreBreakdown,
  watchability,
}: {
  candidate: ExactTitleCandidate
  scoreBreakdown: WatchSearchScoreBreakdown
  watchability: SearchWatchability | undefined
}): WatchSearchResult {
  const availabilityKind = watchability?.kind ?? "unavailable"
  return {
    type: "video",
    id: candidate.resultId,
    slug: candidate.videoSlug,
    title: candidate.videoTitle,
    description: candidate.description,
    snippet: candidate.description,
    imageUrl: candidate.imageUrl,
    imageBlurDataUrl: null,
    muxThumbnailBlurDataUrl: null,
    playbackId: watchability?.playbackId ?? null,
    startSeconds: null,
    score: scoreBreakdown.total,
    scoreBreakdown,
    label: null,
    durationSeconds: watchability?.durationSeconds ?? null,
    childCount: null,
    languageSlug: watchability?.languageSlug ?? null,
    languageEnglishName: watchability?.languageEnglishName ?? null,
    availability: {
      kind: availabilityKind,
      languageSlug: watchability?.languageSlug ?? null,
      languageEnglishName: watchability?.languageEnglishName ?? null,
      audio: watchability?.audio ?? false,
      subtitles: watchability?.subtitles ?? false,
    },
    evidence: {
      kind: "exact_title",
      languageSlug: null,
      label: "Title match",
    },
    action: {
      kind: "watch",
      hrefLanguageSlug: watchability?.hrefLanguageSlug ?? null,
    },
    fallback: {
      kind: fallbackKindForWatchability(watchability),
      message: fallbackMessageForWatchability(watchability),
    },
  }
}

function mapSemanticCandidate({
  candidate,
  scoreBreakdown,
  watchability,
}: {
  candidate: SemanticVideoSearchResult
  scoreBreakdown: WatchSearchScoreBreakdown
  watchability: SearchWatchability | undefined
}): WatchSearchResult {
  const availabilityKind = watchability?.kind ?? "unavailable"
  return {
    type: "video",
    id: candidate.resultId,
    slug: candidate.videoSlug,
    title: candidate.videoTitle,
    description: null,
    snippet: candidate.sceneDescription,
    imageUrl: candidate.imageUrl,
    imageBlurDataUrl: null,
    muxThumbnailBlurDataUrl: null,
    playbackId: watchability?.playbackId ?? null,
    startSeconds: toWholeStartSeconds(candidate.startSeconds),
    score: scoreBreakdown.total,
    scoreBreakdown,
    label: null,
    durationSeconds: watchability?.durationSeconds ?? null,
    childCount: null,
    languageSlug: watchability?.languageSlug ?? null,
    languageEnglishName: watchability?.languageEnglishName ?? null,
    availability: {
      kind: availabilityKind,
      languageSlug: watchability?.languageSlug ?? null,
      languageEnglishName: watchability?.languageEnglishName ?? null,
      audio: watchability?.audio ?? false,
      subtitles: watchability?.subtitles ?? false,
    },
    evidence: {
      kind: "transcript_semantic",
      languageSlug: candidate.evidenceLanguageSlug,
      label: "Transcript match",
    },
    action: {
      kind: "watch",
      hrefLanguageSlug: watchability?.hrefLanguageSlug ?? null,
    },
    fallback: {
      kind: fallbackKindForWatchability(watchability),
      message: fallbackMessageForWatchability(watchability),
    },
  }
}

function mapMetadataCandidate({
  candidate,
  scoreBreakdown,
  watchability,
}: {
  candidate: MetadataCandidate
  scoreBreakdown: WatchSearchScoreBreakdown
  watchability: SearchWatchability | undefined
}): WatchSearchResult {
  const availabilityKind = watchability?.kind ?? "unavailable"
  return {
    type: "video",
    id: candidate.resultId,
    slug: candidate.videoSlug,
    title: candidate.videoTitle,
    description: candidate.description,
    snippet: candidate.description,
    imageUrl: candidate.imageUrl,
    imageBlurDataUrl: null,
    muxThumbnailBlurDataUrl: null,
    playbackId: watchability?.playbackId ?? null,
    startSeconds: null,
    score: scoreBreakdown.total,
    scoreBreakdown,
    label: null,
    durationSeconds: watchability?.durationSeconds ?? null,
    childCount: null,
    languageSlug: watchability?.languageSlug ?? null,
    languageEnglishName: watchability?.languageEnglishName ?? null,
    availability: {
      kind: availabilityKind,
      languageSlug: watchability?.languageSlug ?? null,
      languageEnglishName: watchability?.languageEnglishName ?? null,
      audio: watchability?.audio ?? false,
      subtitles: watchability?.subtitles ?? false,
    },
    evidence: {
      kind: "metadata",
      languageSlug: null,
      label: "Metadata match",
    },
    action: {
      kind: "watch",
      hrefLanguageSlug: watchability?.hrefLanguageSlug ?? null,
    },
    fallback: {
      kind: fallbackKindForWatchability(watchability),
      message: fallbackMessageForWatchability(watchability),
    },
  }
}
