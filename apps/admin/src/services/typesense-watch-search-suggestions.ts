import type { PrismaClient } from "@prisma/client"

import type {
  TypesenseClient,
  TypesenseSearchGroup,
  TypesenseSearchRequest,
} from "./typesense-client"
import {
  createConfiguredTypesenseClient,
  watchSearchSuggestionsEnabled,
} from "./typesense-client-config"
import { watchLexicalQueryFields } from "./typesense-watch-search-locales"
import { TYPESENSE_WATCH_LEXICAL_ALIAS } from "./typesense-watch-search-schema"
import {
  typesenseWatchLanguageIdentity,
  type TypesenseWatchLexicalDocument,
} from "./typesense-watch-search-lexical"

export const MAX_WATCH_SEARCH_SUGGESTION_PREFIX_CODE_POINTS = 200
export const MAX_WATCH_SEARCH_SUGGESTION_LANGUAGE_SLUG_CODE_POINTS = 200
export const MAX_WATCH_SEARCH_SUGGESTIONS = 5
export const MAX_CONCURRENT_WATCH_SEARCH_SUGGESTIONS = 24

const TITLE_WORD_SEPARATOR = /[\s,.;:!?()[\]{}"'/\\|_-]+/u
const LANGUAGE_LOCALE_CACHE_TTL_MS = 5 * 60 * 1_000
const MAX_CACHED_LANGUAGE_LOCALES = 256
const TYPESENSE_SUGGESTION_CANDIDATE_LIMIT = 25
const SAFE_BCP47_PATTERN = /^[A-Za-z0-9-]{1,64}$/

export type WatchSearchSuggestionInput = {
  query: string
  languageSlug: string
}

export type WatchSearchSuggestion = {
  title: string
  description: string | null
  matchSource: "title" | "description"
}

type SuggestionPrisma = Pick<PrismaClient, "language">
type SuggestionTypesense = Pick<TypesenseClient, "multiSearch">
type ResolvedSuggestionLanguage = {
  locale: string
  languageIdentity: string
}
type CachedSuggestionLanguage = {
  promise: Promise<ResolvedSuggestionLanguage | null>
  expiresAt: number
}

const languageLocaleCacheByPrisma = new WeakMap<
  SuggestionPrisma,
  Map<string, CachedSuggestionLanguage>
>()

async function resolveSuggestionLanguage(
  prisma: SuggestionPrisma,
  languageSlug: string,
): Promise<ResolvedSuggestionLanguage | null> {
  let cache = languageLocaleCacheByPrisma.get(prisma)
  if (!cache) {
    cache = new Map()
    languageLocaleCacheByPrisma.set(prisma, cache)
  }

  const now = Date.now()
  const cached = cache.get(languageSlug)
  if (cached && cached.expiresAt > now) {
    cache.delete(languageSlug)
    cache.set(languageSlug, cached)
    return cached.promise
  }
  if (cached) cache.delete(languageSlug)

  const promise = prisma.language
    .findFirst({
      where: { deletedAt: null, slug: languageSlug },
      select: { bcp47: true },
    })
    .then((language) => {
      const candidateLocale = language?.bcp47?.normalize("NFC").trim() || null
      const locale =
        candidateLocale && SAFE_BCP47_PATTERN.test(candidateLocale)
          ? candidateLocale
          : null
      const languageIdentity = locale
        ? typesenseWatchLanguageIdentity({ languageSlug, locale })
        : null
      return locale && languageIdentity ? { locale, languageIdentity } : null
    })

  if (cache.size >= MAX_CACHED_LANGUAGE_LOCALES) {
    const oldestKey = cache.keys().next().value
    if (oldestKey != null) cache.delete(oldestKey)
  }
  const entry: CachedSuggestionLanguage = {
    promise,
    expiresAt: now + LANGUAGE_LOCALE_CACHE_TTL_MS,
  }
  cache.set(languageSlug, entry)
  try {
    return await promise
  } catch (error) {
    if (cache.get(languageSlug) === entry) cache.delete(languageSlug)
    throw error
  }
}

function normalizedPrefix(query: string): string {
  return Array.from(query.normalize("NFC").trim())
    .slice(0, MAX_WATCH_SEARCH_SUGGESTION_PREFIX_CODE_POINTS)
    .join("")
}

function normalizedLanguageSlug(languageSlug: string): string | null {
  const normalized = languageSlug.normalize("NFC").trim()
  return Array.from(normalized).length <=
    MAX_WATCH_SEARCH_SUGGESTION_LANGUAGE_SLUG_CODE_POINTS
    ? normalized
    : null
}

function hasEnoughMeaningfulCharacters(value: string): boolean {
  let count = 0
  for (const character of value) {
    if (/[\p{L}\p{N}]/u.test(character) && ++count >= 2) return true
  }
  return false
}

function comparableTitle(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim().toLocaleLowerCase()
}

function matchTier(title: string, prefix: string): number | null {
  const comparable = comparableTitle(title)
  if (comparable === prefix) return 0
  if (comparable.startsWith(prefix)) return 1
  if (
    comparable
      .split(TITLE_WORD_SEPARATOR)
      .filter(Boolean)
      .some((word) => word.startsWith(prefix))
  ) {
    return 2
  }
  return null
}

function matchingValue(
  document: TypesenseWatchLexicalDocument,
  fields: readonly string[],
  prefix: string,
): string | null {
  const candidates = fields.flatMap((field, fieldIndex) => {
    const value = document[field]
    const titles = Array.isArray(value) ? value : value ? [value] : []
    return titles.map((title, valueIndex) => ({
      fieldIndex,
      title,
      valueIndex,
      tier: matchTier(title, prefix),
    }))
  })
  candidates.sort(
    (a, b) =>
      (a.tier ?? Number.MAX_SAFE_INTEGER) -
        (b.tier ?? Number.MAX_SAFE_INTEGER) ||
      a.fieldIndex - b.fieldIndex ||
      a.valueIndex - b.valueIndex,
  )
  return candidates.find((candidate) => candidate.tier != null)?.title ?? null
}

function firstValue(
  document: TypesenseWatchLexicalDocument,
  fields: readonly string[],
): string | null {
  for (const field of fields) {
    const value = document[field]
    const values = Array.isArray(value) ? value : value ? [value] : []
    const first = values.find((candidate) => candidate.trim().length > 0)
    if (first) return first
  }
  return null
}

function suggestionRequest(
  query: string,
  titleFields: readonly string[],
  metadataFields: readonly string[],
  languageIdentity: string,
): TypesenseSearchRequest {
  const fields = [...titleFields, ...metadataFields]
  return {
    collection: TYPESENSE_WATCH_LEXICAL_ALIAS,
    q: query,
    query_by: fields.join(","),
    query_by_weights: [
      ...titleFields.map((_field, index) => (index === 0 ? 8 : 4)),
      ...metadataFields.map((_field, index) => (index === 0 ? 2 : 1)),
    ].join(","),
    page: 1,
    per_page: TYPESENSE_SUGGESTION_CANDIDATE_LIMIT,
    group_by: "canonicalVideoId",
    group_limit: 1,
    prefix: true,
    num_typos: fields.map(() => 0).join(","),
    text_match_type: "max_weight",
    prioritize_exact_match: true,
    drop_tokens_threshold: 0,
    filter_by: `languageIdentity:=[\`${languageIdentity}\`]`,
    include_fields: ["canonicalVideoId", ...fields].join(","),
  }
}

function groupedHits(
  groups: readonly TypesenseSearchGroup<TypesenseWatchLexicalDocument>[],
  titleFields: readonly string[],
  metadataFields: readonly string[],
  prefix: string,
): WatchSearchSuggestion[] {
  const candidates = groups.flatMap((group, groupIndex) => {
    const document = group.hits[0]?.document
    if (!document) return []
    const matchedTitle = matchingValue(document, titleFields, prefix)
    const matchedDescription = matchingValue(document, metadataFields, prefix)
    const title = matchedTitle ?? firstValue(document, titleFields)
    if (!title || (!matchedTitle && !matchedDescription)) return []
    return [
      {
        groupIndex,
        suggestion: {
          title,
          description:
            matchedDescription ?? firstValue(document, metadataFields),
          matchSource: matchedTitle ? "title" : "description",
        } satisfies WatchSearchSuggestion,
      },
    ]
  })
  candidates.sort(
    (a, b) =>
      (a.suggestion.matchSource === "title" ? 0 : 1) -
        (b.suggestion.matchSource === "title" ? 0 : 1) ||
      a.groupIndex - b.groupIndex,
  )

  const seenTitles = new Set<string>()
  const suggestions: WatchSearchSuggestion[] = []
  for (const { suggestion } of candidates) {
    const key = comparableTitle(suggestion.title)
    if (seenTitles.has(key)) continue
    seenTitles.add(key)
    suggestions.push(suggestion)
    if (suggestions.length === MAX_WATCH_SEARCH_SUGGESTIONS) break
  }
  return suggestions
}

export class TypesenseWatchSearchSuggestionsService {
  private readonly inFlight = new Map<
    string,
    Promise<WatchSearchSuggestion[]>
  >()
  private activeRequests = 0

  constructor(
    private readonly prisma: SuggestionPrisma,
    private readonly typesense: SuggestionTypesense,
    private readonly logger: Pick<Console, "warn"> = console,
  ) {}

  async suggest(
    input: WatchSearchSuggestionInput,
  ): Promise<WatchSearchSuggestion[]> {
    const query = normalizedPrefix(input.query)
    if (!hasEnoughMeaningfulCharacters(query)) return []
    const languageSlug = normalizedLanguageSlug(input.languageSlug)
    if (!languageSlug) return []

    const requestKey = `${languageSlug}\0${query}`
    const existing = this.inFlight.get(requestKey)
    if (existing) return existing
    if (this.activeRequests >= MAX_CONCURRENT_WATCH_SEARCH_SUGGESTIONS) {
      return []
    }

    this.activeRequests += 1
    const request = this.fetchSuggestions(query, languageSlug)
    this.inFlight.set(requestKey, request)
    try {
      return await request
    } finally {
      if (this.inFlight.get(requestKey) === request) {
        this.inFlight.delete(requestKey)
      }
      this.activeRequests -= 1
    }
  }

  private async fetchSuggestions(
    query: string,
    languageSlug: string,
  ): Promise<WatchSearchSuggestion[]> {
    try {
      const language = await resolveSuggestionLanguage(
        this.prisma,
        languageSlug,
      )
      if (!language) return []

      const titleFields = watchLexicalQueryFields(language.locale, "title")
      const metadataFields = watchLexicalQueryFields(
        language.locale,
        "metadata",
      )
      const [result] =
        await this.typesense.multiSearch<TypesenseWatchLexicalDocument>([
          suggestionRequest(
            query,
            titleFields,
            metadataFields,
            language.languageIdentity,
          ),
        ])
      if (!result || !("grouped_hits" in result) || !result.grouped_hits) {
        return []
      }
      return groupedHits(
        result.grouped_hits,
        titleFields,
        metadataFields,
        comparableTitle(query),
      )
    } catch {
      this.logger.warn("[watch-search-suggestions] event=typesense_unavailable")
      return []
    }
  }
}

export function createTypesenseWatchSearchSuggestionsService(
  prisma: PrismaClient,
): TypesenseWatchSearchSuggestionsService | null {
  if (!watchSearchSuggestionsEnabled()) return null
  const client = createConfiguredTypesenseClient()
  return client
    ? new TypesenseWatchSearchSuggestionsService(prisma, client)
    : null
}
