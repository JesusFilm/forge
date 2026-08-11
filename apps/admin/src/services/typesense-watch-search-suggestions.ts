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

function matchingTitle(
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

function suggestionRequest(
  query: string,
  fields: readonly string[],
  languageIdentity: string,
): TypesenseSearchRequest {
  return {
    collection: TYPESENSE_WATCH_LEXICAL_ALIAS,
    q: query,
    query_by: fields.join(","),
    query_by_weights: fields
      .map((_field, index) => (index === 0 ? 4 : 1))
      .join(","),
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
  fields: readonly string[],
  prefix: string,
): string[] {
  const seenTitles = new Set<string>()
  const titles: string[] = []
  for (const group of groups) {
    const document = group.hits[0]?.document
    if (!document) continue
    const title = matchingTitle(document, fields, prefix)
    if (!title) continue
    const key = comparableTitle(title)
    if (seenTitles.has(key)) continue
    seenTitles.add(key)
    titles.push(title)
    if (titles.length === MAX_WATCH_SEARCH_SUGGESTIONS) break
  }
  return titles
}

export class TypesenseWatchSearchSuggestionsService {
  private readonly inFlight = new Map<string, Promise<string[]>>()
  private activeRequests = 0

  constructor(
    private readonly prisma: SuggestionPrisma,
    private readonly typesense: SuggestionTypesense,
    private readonly logger: Pick<Console, "warn"> = console,
  ) {}

  async suggest(input: WatchSearchSuggestionInput): Promise<string[]> {
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
  ): Promise<string[]> {
    try {
      const language = await resolveSuggestionLanguage(
        this.prisma,
        languageSlug,
      )
      if (!language) return []

      const fields = watchLexicalQueryFields(language.locale, "title")
      const [result] =
        await this.typesense.multiSearch<TypesenseWatchLexicalDocument>([
          suggestionRequest(query, fields, language.languageIdentity),
        ])
      if (!result || !("grouped_hits" in result) || !result.grouped_hits) {
        return []
      }
      return groupedHits(result.grouped_hits, fields, comparableTitle(query))
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
