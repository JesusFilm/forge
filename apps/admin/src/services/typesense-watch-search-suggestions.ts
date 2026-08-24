import type { PrismaClient } from "@prisma/client"

import type {
  TypesenseClient,
  TypesenseSearchGroup,
  TypesenseSearchRequest,
} from "./typesense-client"
import {
  cachedBoundedTtlBatchValues,
  type BoundedTtlCache,
} from "./bounded-ttl-promise-cache"
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
export const MAX_WATCH_SEARCH_QUERY_SUGGESTIONS = 6
export const MAX_WATCH_SEARCH_CONTENT_MATCHES = 6
export const MAX_CONCURRENT_WATCH_SEARCH_SUGGESTIONS = 24
const WATCH_SEARCH_PHRASE_VALIDATION_TIMEOUT_MS = 750

const TITLE_WORD_SEPARATOR = /[\s,.;:!?()[\]{}"'/\\|_-]+/u
const LANGUAGE_LOCALE_CACHE_TTL_MS = 5 * 60 * 1_000
const MAX_CACHED_LANGUAGE_LOCALES = 256
const PHRASE_VALIDATION_CACHE_TTL_MS = 60 * 1_000
const MAX_CACHED_PHRASE_VALIDATIONS = 512
const PHRASE_VALIDATION_CONTRACT_VERSION = "v1"
const TYPESENSE_SUGGESTION_CANDIDATE_LIMIT = 25
// Short queries stay strict so generic terms cannot get noisy.
const MULTI_TOKEN_DROP_MIN_QUERY_TOKENS = 3
// Bounds fallback anchor scanning per text value so a long metadata blob
// cannot expand into an unbounded phrase-window search.
const MAX_FALLBACK_PHRASE_ANCHORS = 8
const SAFE_BCP47_PATTERN = /^[A-Za-z0-9-]{1,64}$/
const PHRASE_WORD = /[\p{L}\p{N}]+(?:['’’-][\p{L}\p{N}]+)*/gu
const PHRASE_EDGE_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "can",
  "could",
  "did",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "his",
  "in",
  "is",
  "of",
  "on",
  "the",
  "to",
  "was",
  "were",
  "what",
  "who",
  "why",
  "with",
])

export type WatchSearchSuggestionInput = {
  query: string
  languageSlug: string
}

export type WatchSearchSuggestion = {
  kind: "query" | "content"
  title: string
  description: string | null
  matchSource: "title" | "description"
  id: string | null
  slug: string | null
  label: string | null
  childCount: number | null
}

type SuggestionPrisma = Pick<PrismaClient, "language" | "video">
type SuggestionTypesense = Pick<TypesenseClient, "multiSearch">
type ResolvedSuggestionLanguage = {
  locale: string
  languageIdentity: string
}
type CachedSuggestionLanguage = {
  promise: Promise<ResolvedSuggestionLanguage | null>
  expiresAt: number
}
type SuggestionRequestState = {
  activeRequests: number
  inFlight: Map<string, Promise<WatchSearchSuggestion[]>>
}

const languageLocaleCacheByPrisma = new WeakMap<
  SuggestionPrisma,
  Map<string, CachedSuggestionLanguage>
>()
const phraseValidationCaches = new WeakMap<object, BoundedTtlCache<boolean>>()
const suggestionRequestStateByPrisma = new WeakMap<
  SuggestionPrisma,
  SuggestionRequestState
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

function uniqueComparableQueryTokens(query: string): string[] {
  return [
    ...new Set(
      [...query.normalize("NFC").matchAll(PHRASE_WORD)].map((match) =>
        match[0].toLocaleLowerCase(),
      ),
    ),
  ]
}

// Multi-token coverage mirrors the bounded Typesense recall relaxation: every
// query token must prefix-match a word, except that queries with three or more
// tokens may drop exactly one. At least one MATCHED token must be meaningful
// (not an edge stop word) so an overlap like "the … of" can never qualify.
function matchesQueryTokens(
  comparableWords: readonly string[],
  queryTokens: readonly string[],
): boolean {
  if (queryTokens.length < 2) return false
  const matched = queryTokens.filter((token) =>
    comparableWords.some((word) => word.startsWith(token)),
  )
  const allowedDrops =
    queryTokens.length >= MULTI_TOKEN_DROP_MIN_QUERY_TOKENS ? 1 : 0
  return (
    queryTokens.length - matched.length <= allowedDrops &&
    matched.some((token) => !PHRASE_EDGE_STOP_WORDS.has(token))
  )
}

function matchTier(
  title: string,
  prefix: string,
  relaxedQueryTokens?: readonly string[],
): number | null {
  const comparable = comparableTitle(title)
  if (comparable === prefix) return 0
  if (comparable.startsWith(prefix)) return 1
  const strictPrefixWords = comparable
    .split(TITLE_WORD_SEPARATOR)
    .filter(Boolean)
  if (strictPrefixWords.some((word) => word.startsWith(prefix))) return 2
  // Token coverage stays below exact and prefix evidence.
  const relaxedWords = [...comparable.matchAll(PHRASE_WORD)].map(
    (match) => match[0],
  )
  if (
    relaxedQueryTokens &&
    matchesQueryTokens(relaxedWords, relaxedQueryTokens)
  ) {
    return 3
  }
  return null
}

type MatchedValue = {
  value: string
  tier: number
}

function matchingValue(
  document: TypesenseWatchLexicalDocument,
  fields: readonly string[],
  prefix: string,
  relaxedQueryTokens?: readonly string[],
): MatchedValue | null {
  const candidates = fields.flatMap((field, fieldIndex) => {
    const value = document[field]
    const titles = Array.isArray(value) ? value : value ? [value] : []
    return titles.map((title, valueIndex) => ({
      fieldIndex,
      title,
      valueIndex,
      tier: matchTier(title, prefix, relaxedQueryTokens),
    }))
  })
  candidates.sort(
    (a, b) =>
      (a.tier ?? Number.MAX_SAFE_INTEGER) -
        (b.tier ?? Number.MAX_SAFE_INTEGER) ||
      a.fieldIndex - b.fieldIndex ||
      a.valueIndex - b.valueIndex,
  )
  const candidate = candidates.find((entry) => entry.tier != null)
  return candidate?.tier == null
    ? null
    : { value: candidate.title, tier: candidate.tier }
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

function allValues(
  document: TypesenseWatchLexicalDocument,
  fields: readonly string[],
): string[] {
  return fields.flatMap((field) => {
    const value = document[field]
    return Array.isArray(value) ? value : value ? [value] : []
  })
}

type PhraseCandidate = {
  phrase: string
  matchSource: "title" | "description"
  score: number
  firstSeen: number
}

function comparablePhrase(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim().toLocaleLowerCase()
}

function phraseWindowsFromAnchors(
  words: readonly string[],
  anchors: readonly number[],
  minimumMultiwordLength: number,
  requiredQueryTokens: readonly string[] | null,
): string[] {
  const phrases = new Set<string>()
  for (const matchIndex of anchors) {
    for (
      let start = Math.max(0, matchIndex - 3);
      start <= matchIndex;
      start++
    ) {
      for (
        let end = matchIndex;
        end <= Math.min(words.length - 1, matchIndex + 3);
        end++
      ) {
        const length = end - start + 1
        if (length > 4) continue
        if (length > 1 && length < minimumMultiwordLength) continue
        const first = words[start]?.toLocaleLowerCase()
        const last = words[end]?.toLocaleLowerCase()
        if (!first || !last) continue
        if (length > 1 && PHRASE_EDGE_STOP_WORDS.has(first)) continue
        if (length > 1 && PHRASE_EDGE_STOP_WORDS.has(last)) continue
        if (
          requiredQueryTokens &&
          !matchesQueryTokens(
            words.slice(start, end + 1).map((word) => word.toLocaleLowerCase()),
            requiredQueryTokens,
          )
        ) {
          continue
        }
        phrases.add(words.slice(start, end + 1).join(" "))
      }
    }
  }
  return [...phrases]
}

function phraseWindows(
  value: string,
  query: string,
  queryTokens: readonly string[],
  minimumMultiwordLength: number,
): string[] {
  const words = [...value.normalize("NFC").matchAll(PHRASE_WORD)].map(
    (match) => match[0],
  )
  if (words.length === 0) return []
  const comparableQuery = comparablePhrase(query)
  const matches = words.flatMap((word, index) => {
    const suffix = words
      .slice(index, Math.min(words.length, index + 5))
      .join(" ")
      .toLocaleLowerCase()
    return suffix.startsWith(comparableQuery) ||
      word.toLocaleLowerCase().startsWith(comparableQuery)
      ? [index]
      : []
  })
  if (matches.length > 0) {
    return phraseWindowsFromAnchors(
      words,
      matches,
      minimumMultiwordLength,
      null,
    )
  }

  // Dropped-token candidates must still cover the query under the bounded
  // client-side rule before they can become displayed phrases.
  if (queryTokens.length < 2) return []
  const meaningfulTokens = queryTokens.filter(
    (token) => !PHRASE_EDGE_STOP_WORDS.has(token),
  )
  if (meaningfulTokens.length === 0) return []
  const anchors: number[] = []
  for (const [index, word] of words.entries()) {
    const comparableWord = word.toLocaleLowerCase()
    if (meaningfulTokens.some((token) => comparableWord.startsWith(token))) {
      anchors.push(index)
      if (anchors.length >= MAX_FALLBACK_PHRASE_ANCHORS) break
    }
  }
  return phraseWindowsFromAnchors(
    words,
    anchors,
    minimumMultiwordLength,
    queryTokens,
  )
}

function extractedQuerySuggestions(
  groups: readonly TypesenseSearchGroup<TypesenseWatchLexicalDocument>[],
  titleFields: readonly string[],
  metadataFields: readonly string[],
  query: string,
  queryTokens: readonly string[],
  excludedTitles: ReadonlySet<string>,
): WatchSearchSuggestion[] {
  const byPhrase = new Map<string, PhraseCandidate>()
  let firstSeen = 0
  const addText = (
    value: string,
    matchSource: PhraseCandidate["matchSource"],
    sourceWeight: number,
    minimumMultiwordLength: number,
  ) => {
    for (const phrase of phraseWindows(
      value,
      query,
      queryTokens,
      minimumMultiwordLength,
    )) {
      const key = comparablePhrase(phrase)
      const wordCount = phrase.match(PHRASE_WORD)?.length ?? 0
      if (!key || (wordCount > 1 && excludedTitles.has(key))) continue
      const score = sourceWeight + (wordCount === 1 ? 12 : 8 - wordCount)
      const existing = byPhrase.get(key)
      if (existing) {
        existing.score += score
        if (matchSource === "title") existing.matchSource = "title"
      } else {
        byPhrase.set(key, {
          phrase,
          matchSource,
          score,
          firstSeen: firstSeen++,
        })
      }
    }
  }

  for (const group of groups) {
    const document = group.hits[0]?.document
    if (!document) continue
    for (const value of allValues(document, titleFields)) {
      addText(value, "title", 8, 3)
    }
    for (const value of allValues(document, metadataFields)) {
      addText(value, "description", 3, 3)
    }
  }

  return [...byPhrase.values()]
    .sort((a, b) => b.score - a.score || a.firstSeen - b.firstSeen)
    .slice(0, MAX_WATCH_SEARCH_QUERY_SUGGESTIONS)
    .map(({ phrase, matchSource }) => ({
      kind: "query",
      title: phrase,
      description: null,
      matchSource,
      id: null,
      slug: null,
      label: null,
      childCount: null,
    }))
}

function suggestionRequest(
  query: string,
  queryTokens: readonly string[],
  titleFields: readonly string[],
  metadataFields: readonly string[],
  languageIdentity: string,
): TypesenseSearchRequest {
  const fields = [...titleFields, ...metadataFields]
  return {
    ...lexicalSuggestionRequestBase(
      query,
      titleFields,
      metadataFields,
      languageIdentity,
    ),
    page: 1,
    per_page: TYPESENSE_SUGGESTION_CANDIDATE_LIMIT,
    group_by: "canonicalVideoId",
    group_limit: 1,
    prefix: true,
    // Typesense may return broader candidates; displayed results still pass
    // bounded client-side coverage and strict phrase validation.
    drop_tokens_threshold:
      queryTokens.length >= MULTI_TOKEN_DROP_MIN_QUERY_TOKENS ? 1 : 0,
    include_fields: ["videoId", "canonicalVideoId", ...fields].join(","),
  }
}

function lexicalSuggestionRequestBase(
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
    num_typos: fields.map(() => 0).join(","),
    text_match_type: "max_weight",
    prioritize_exact_match: true,
    drop_tokens_threshold: 0,
    filter_by: `languageIdentity:=[\`${languageIdentity}\`]`,
  }
}

function phraseValidationRequest(
  phrase: string,
  titleFields: readonly string[],
  metadataFields: readonly string[],
  languageIdentity: string,
): TypesenseSearchRequest {
  return {
    ...lexicalSuggestionRequestBase(
      phrase,
      titleFields,
      metadataFields,
      languageIdentity,
    ),
    page: 1,
    per_page: 1,
    prefix: false,
    include_fields: "id",
  }
}

function phraseValidationCacheKey(
  suggestion: WatchSearchSuggestion,
  languageIdentity: string,
  fields: readonly string[],
): string {
  return [
    PHRASE_VALIDATION_CONTRACT_VERSION,
    languageIdentity,
    fields.join(","),
    comparablePhrase(suggestion.title),
  ].join("\0")
}

async function validateQuerySuggestions(
  prisma: SuggestionPrisma,
  typesense: SuggestionTypesense,
  suggestions: readonly WatchSearchSuggestion[],
  titleFields: readonly string[],
  metadataFields: readonly string[],
  languageIdentity: string,
): Promise<WatchSearchSuggestion[]> {
  if (suggestions.length === 0) return []

  const fields = [...titleFields, ...metadataFields]
  const keys = suggestions.map((suggestion) =>
    phraseValidationCacheKey(suggestion, languageIdentity, fields),
  )
  const suggestionByKey = new Map(
    suggestions.map((suggestion, index) => [keys[index], suggestion]),
  )
  const values = await cachedBoundedTtlBatchValues({
    cacheByOwner: phraseValidationCaches,
    owner: prisma,
    keys,
    ttlMs: PHRASE_VALIDATION_CACHE_TTL_MS,
    maxEntries: MAX_CACHED_PHRASE_VALIDATIONS,
    loader: async (missingKeys) => {
      const results = await typesense.multiSearch(
        missingKeys.map((key) => {
          const suggestion = suggestionByKey.get(key)
          if (!suggestion) {
            throw new Error("Missing phrase validation suggestion")
          }
          return phraseValidationRequest(
            suggestion.title,
            titleFields,
            metadataFields,
            languageIdentity,
          )
        }),
        { timeoutMs: WATCH_SEARCH_PHRASE_VALIDATION_TIMEOUT_MS },
      )
      if (results.length !== missingKeys.length) {
        throw new Error("Typesense phrase validation result count mismatch")
      }
      return results.map((result) => {
        if (!result || !Number.isFinite(result.found) || result.found < 0) {
          throw new Error("Typesense phrase validation result is malformed")
        }
        return result.found > 0
      })
    },
  })
  return suggestions.filter((_suggestion, index) => values[index])
}

function suggestionRequestState(prisma: SuggestionPrisma) {
  let state = suggestionRequestStateByPrisma.get(prisma)
  if (!state) {
    state = { activeRequests: 0, inFlight: new Map() }
    suggestionRequestStateByPrisma.set(prisma, state)
  }
  return state
}

type DirectMatchCandidate = {
  videoId: string
  title: string
  description: string | null
  matchSource: "title" | "description"
}

function directMatchCandidates(
  groups: readonly TypesenseSearchGroup<TypesenseWatchLexicalDocument>[],
  titleFields: readonly string[],
  metadataFields: readonly string[],
  prefix: string,
  queryTokens: readonly string[],
): DirectMatchCandidate[] {
  const candidates = groups.flatMap((group, groupIndex) => {
    const document = group.hits[0]?.document
    if (!document) return []
    const matchedTitle = matchingValue(
      document,
      titleFields,
      prefix,
      queryTokens,
    )
    const matchedDescription = matchingValue(document, metadataFields, prefix)
    const title = matchedTitle?.value ?? firstValue(document, titleFields)
    if (!title || (!matchedTitle && !matchedDescription)) return []
    return [
      {
        groupIndex,
        suggestion: {
          videoId: typeof document.videoId === "string" ? document.videoId : "",
          title,
          description:
            matchedDescription?.value ?? firstValue(document, metadataFields),
          matchSource: matchedTitle ? "title" : "description",
        } satisfies DirectMatchCandidate,
        tier: matchedTitle?.tier ?? matchedDescription?.tier ?? 0,
      },
    ]
  })
  candidates.sort(
    (a, b) =>
      (a.suggestion.matchSource === "title" ? 0 : 1) -
        (b.suggestion.matchSource === "title" ? 0 : 1) ||
      (a.suggestion.matchSource === "title" &&
      b.suggestion.matchSource === "title"
        ? a.tier - b.tier
        : 0) ||
      a.groupIndex - b.groupIndex,
  )

  const seenTitles = new Set<string>()
  const suggestions: DirectMatchCandidate[] = []
  for (const { suggestion } of candidates) {
    if (!suggestion.videoId) continue
    const key = comparableTitle(suggestion.title)
    if (seenTitles.has(key)) continue
    seenTitles.add(key)
    suggestions.push(suggestion)
    if (suggestions.length === MAX_WATCH_SEARCH_CONTENT_MATCHES) break
  }
  return suggestions
}

async function hydrateDirectMatches(
  prisma: SuggestionPrisma,
  candidates: readonly DirectMatchCandidate[],
): Promise<WatchSearchSuggestion[]> {
  const videos = await prisma.video.findMany({
    where: {
      id: { in: candidates.map((candidate) => candidate.videoId) },
      deletedAt: null,
      noIndex: false,
    },
    select: {
      id: true,
      slug: true,
      label: true,
      _count: {
        select: {
          children: { where: { child: { deletedAt: null } } },
        },
      },
    },
  })
  const byId = new Map(videos.map((video) => [video.id, video]))
  return candidates.flatMap((candidate) => {
    const video = byId.get(candidate.videoId)
    if (!video) return []
    return [
      {
        kind: "content",
        title: candidate.title,
        description: candidate.description,
        matchSource: candidate.matchSource,
        id: video.id,
        slug: video.slug,
        label: video.label,
        childCount: video._count.children,
      } satisfies WatchSearchSuggestion,
    ]
  })
}

export class TypesenseWatchSearchSuggestionsService {
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

    const requestState = suggestionRequestState(this.prisma)
    const requestKey = `${languageSlug}\0${query}`
    const existing = requestState.inFlight.get(requestKey)
    if (existing) return existing
    if (
      requestState.activeRequests >= MAX_CONCURRENT_WATCH_SEARCH_SUGGESTIONS
    ) {
      return []
    }

    requestState.activeRequests += 1
    const request = this.fetchSuggestions(query, languageSlug)
    requestState.inFlight.set(requestKey, request)
    try {
      return await request
    } finally {
      if (requestState.inFlight.get(requestKey) === request) {
        requestState.inFlight.delete(requestKey)
      }
      requestState.activeRequests -= 1
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

      const queryTokens = uniqueComparableQueryTokens(query)
      const titleFields = watchLexicalQueryFields(language.locale, "title")
      const metadataFields = watchLexicalQueryFields(
        language.locale,
        "metadata",
      )
      const [result] =
        await this.typesense.multiSearch<TypesenseWatchLexicalDocument>([
          suggestionRequest(
            query,
            queryTokens,
            titleFields,
            metadataFields,
            language.languageIdentity,
          ),
        ])
      if (!result || !("grouped_hits" in result) || !result.grouped_hits) {
        return []
      }
      const candidates = directMatchCandidates(
        result.grouped_hits,
        titleFields,
        metadataFields,
        comparableTitle(query),
        queryTokens,
      )
      const directMatches = await hydrateDirectMatches(this.prisma, candidates)
      const directTitles = new Set(
        directMatches.map((match) => comparablePhrase(match.title)),
      )
      const extractedSuggestions = extractedQuerySuggestions(
        result.grouped_hits,
        titleFields,
        metadataFields,
        query,
        queryTokens,
        directTitles,
      )
      let querySuggestions: WatchSearchSuggestion[] = []
      try {
        querySuggestions = await validateQuerySuggestions(
          this.prisma,
          this.typesense,
          extractedSuggestions,
          titleFields,
          metadataFields,
          language.languageIdentity,
        )
      } catch {
        this.logger.warn(
          "[watch-search-suggestions] event=phrase_validation_unavailable",
        )
      }
      return [...querySuggestions, ...directMatches]
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
