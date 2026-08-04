import { randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import {
  TypesenseClient,
  TypesenseRequestError,
  type TypesenseSearchHit,
} from "./typesense-client"
import { tokenizeForExactTitle } from "./hybrid-search-keyword-first-retrievers"
import {
  TYPESENSE_WATCH_CATALOG_ALIAS,
  TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
  type TypesenseWatchAudioOption,
  type TypesenseWatchCatalogDocument,
  type TypesenseWatchLocale,
  type TypesenseWatchSubtitleOption,
  type TypesenseWatchTranscriptDocument,
} from "./typesense-watch-search-schema"
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
const MAX_LEXICAL_CANDIDATES = 250
const MAX_SEMANTIC_CANDIDATES = 40
const MAX_CATALOG_HYDRATION_BATCH = 250
const MAX_EVIDENCE_LOCALES = 3
const DEFAULT_EMBEDDING_TIMEOUT_MS = 1_000
const MIN_SEMANTIC_SIMILARITY = 0.5

type TypesenseSearchClient = Pick<TypesenseClient, "multiSearch">

type TypesenseWatchSearchDeps = {
  embedder?: WatchSearchQueryEmbedder
  embeddingTimeoutMs?: number
  logger?: Pick<Console, "warn">
}

type Candidate = {
  videoId: string
  kind: "exact" | "metadata" | "semantic"
  sourceScore: number
  evidenceLanguageSlug: string | null
  snippet: string | null
  startSeconds: number | null
}

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

type TargetLanguageContext = {
  id: string | null
  slug: string
  englishName: string | null
  fallbackLanguageIds: string[]
}

export class TypesenseWatchSearchUnavailableError extends Error {
  constructor(message = "Typesense Watch Search is not configured") {
    super(message)
    this.name = "TypesenseWatchSearchUnavailableError"
  }
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

function displayLocale(
  document: TypesenseWatchCatalogDocument,
  preferredLocale: string,
): TypesenseWatchLocale {
  const locales = parseJsonArray<TypesenseWatchLocale>(document.localesJson)
  return (
    locales.find((locale) => locale.locale === preferredLocale) ??
    locales.find((locale) => locale.locale === preferredLocale.slice(0, 2)) ??
    locales.find((locale) => locale.locale === "en") ??
    locales[0] ?? {
      locale: preferredLocale,
      title: document.titles[0] ?? "",
      description: null,
    }
  )
}

function englishName(value: unknown): string | null {
  if (value && typeof value === "object" && "en" in value) {
    const name = (value as { en?: unknown }).en
    return typeof name === "string" && name.trim() ? name : null
  }
  return null
}

function resolveWatchability(
  document: TypesenseWatchCatalogDocument,
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

function candidateScore(
  candidate: Candidate,
  watchability: IndexedWatchability,
) {
  const sourceRelevance = candidate.sourceScore * 0.55
  const evidenceBoost =
    candidate.kind === "exact"
      ? 0.45
      : candidate.kind === "metadata"
        ? 0.14
        : 0.08
  const availability =
    watchability.kind === "target_audio"
      ? 0.25
      : watchability.kind === "target_subtitle"
        ? 0.18
        : watchability.kind === "related_language"
          ? 0.08
          : 0
  const relevance = sourceRelevance + evidenceBoost
  const round = (value: number) => Math.round(value * 1000) / 1000
  return {
    total: round(Math.min(1, relevance + availability)),
    sourceRelevance: round(sourceRelevance),
    evidenceBoost: round(evidenceBoost),
    relevance: round(relevance),
    availability: round(availability),
    match: round(evidenceBoost),
    sourceScore: round(candidate.sourceScore),
  }
}

function laneStatus(
  lane: WatchSearchLaneStatus["lane"],
  status: WatchSearchLaneStatus["status"],
  startedAt: number,
  resultCount: number,
  reason: string | null = null,
): WatchSearchLaneStatus {
  return {
    lane,
    status,
    startedOffsetMs: 0,
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
      Math.max(offset + limit + 1, limit * 2),
      MAX_LEXICAL_CANDIDATES,
    )
    const laneStatuses: WatchSearchLaneStatus[] = []

    const lexicalStartedAt = performance.now()
    const lexicalPromise = this.typesense
      .multiSearch<TypesenseWatchCatalogDocument>([
        {
          collection: TYPESENSE_WATCH_CATALOG_ALIAS,
          q: titleQuery,
          query_by: "titles,descriptions",
          query_by_weights: "4,1",
          per_page: candidateLimit,
          prefix: true,
          num_typos: "2,1",
        },
      ])
      .then(([result]) => {
        laneStatuses.push(
          laneStatus(
            "metadata_retrieval",
            "fulfilled",
            lexicalStartedAt,
            result?.hits.length ?? 0,
          ),
        )
        return result?.hits ?? []
      })

    const semanticStartedAt = performance.now()
    let semanticEmbeddingCompleted = false
    const semanticPromise = this.semanticHits(query, evidenceLocales, () => {
      semanticEmbeddingCompleted = true
    })
      .then((hits) => {
        if (semanticEmbeddingCompleted) {
          laneStatuses.push(
            laneStatus("semantic_embedding", "fulfilled", semanticStartedAt, 1),
            laneStatus(
              "semantic_retrieval",
              "fulfilled",
              semanticStartedAt,
              hits.length,
            ),
          )
        } else {
          laneStatuses.push(
            laneStatus(
              "semantic_embedding",
              "skipped",
              semanticStartedAt,
              0,
              "no_evidence_language",
            ),
            laneStatus(
              "semantic_retrieval",
              "skipped",
              semanticStartedAt,
              0,
              "no_evidence_language",
            ),
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
        laneStatuses.push(
          laneStatus(
            "semantic_embedding",
            semanticEmbeddingCompleted ? "fulfilled" : "degraded",
            semanticStartedAt,
            semanticEmbeddingCompleted ? 1 : 0,
            semanticEmbeddingCompleted ? null : reason,
          ),
          laneStatus(
            "semantic_retrieval",
            semanticEmbeddingCompleted ? "degraded" : "skipped",
            semanticStartedAt,
            0,
            semanticEmbeddingCompleted ? reason : "missing_query_embedding",
          ),
        )
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
    const catalogStartedAt = performance.now()
    const catalogById = await this.catalogDocuments(
      candidates.map((entry) => entry.videoId),
    )
    laneStatuses.push(
      laneStatus(
        "metadata_watchability",
        "fulfilled",
        catalogStartedAt,
        catalogById.size,
      ),
    )

    const ranked = candidates
      .flatMap((candidate) => {
        const document = catalogById.get(candidate.videoId)
        if (!document) return []
        const watchability = resolveWatchability(document, target)
        const locale = displayLocale(document, preferredLocale)
        const scoreBreakdown = candidateScore(candidate, watchability)
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
        return [{ result, candidate }]
      })
      .sort((left, right) => {
        const score = right.result.score - left.result.score
        if (score !== 0) return score
        return left.result.id.localeCompare(right.result.id)
      })
    const page = ranked
      .slice(offset, offset + limit)
      .map((entry) => entry.result)

    return {
      query,
      results: page,
      hasMore: ranked.length > offset + limit,
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
          filter_by: `language:=[${filterValues}]`,
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
    lexicalHits: TypesenseSearchHit<TypesenseWatchCatalogDocument>[]
    semanticHits: TypesenseSearchHit<TypesenseWatchTranscriptDocument>[]
    evidenceLocales: Array<{ slug: string; locale: string }>
  }): Candidate[] {
    const candidates = new Map<string, Candidate>()
    const exactTitleTokens = tokenizeForExactTitle(query).map(normalizedTitle)
    lexicalHits.forEach((hit, index) => {
      const locale = displayLocale(hit.document, preferredLocale)
      const title = normalizedTitle(locale.title)
      const exact =
        exactTitleTokens.length > 0 &&
        exactTitleTokens.every((token) => title.includes(token))
      candidates.set(hit.document.id, {
        videoId: hit.document.id,
        kind: exact ? "exact" : "metadata",
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

  private async catalogDocuments(
    videoIds: readonly string[],
  ): Promise<Map<string, TypesenseWatchCatalogDocument>> {
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
      })
    }
    const results =
      await this.typesense.multiSearch<TypesenseWatchCatalogDocument>(searches)
    return new Map(
      results.flatMap((result) =>
        result.hits.map((hit) => [hit.document.id, hit.document] as const),
      ),
    )
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
      }
    }
    const fallbacks = await this.prisma.languageFallback.findMany({
      where: { sourceLanguageId: language.id, deletedAt: null },
      orderBy: [{ priority: "asc" }, { fallbackLanguageId: "asc" }],
      take: 12,
      select: { fallbackLanguageId: true },
    })
    return {
      id: language.id,
      slug: language.slug,
      englishName: englishName(language.name),
      fallbackLanguageIds: fallbacks.map((row) => row.fallbackLanguageId),
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
