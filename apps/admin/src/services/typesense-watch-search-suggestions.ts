import type { PrismaClient } from "@prisma/client"

import type {
  TypesenseClient,
  TypesenseSearchGroup,
  TypesenseSearchHit,
  TypesenseSearchRequest,
  TypesenseSettledSearchResult,
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
  typesenseWatchTokenizerLocale,
  type TypesenseWatchLexicalDocument,
} from "./typesense-watch-search-lexical"
import { TYPESENSE_WATCH_SEARCH_CANDIDATE_APPLICATION_REVISION } from "./typesense-watch-search-candidate-identity"

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
const TYPESENSE_SUGGESTION_CANDIDATE_LIMIT = 25
const MAX_BASELINE_QUERY_FIELDS = 4
const MAX_EXPANSION_QUERY_FIELDS = 5
const MAX_RETRIEVAL_QUERY_BY_BYTES = 4_096
const MAX_RETRIEVAL_REQUEST_BYTES = 32_768
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
type SuggestionTypesense = Pick<
  TypesenseClient,
  "multiSearch" | "multiSearchSettled"
>
type ResolvedSuggestionLanguage = {
  locale: string
  languageIdentity: string
}
type LexicalSuggestionFieldFamily = {
  title: readonly string[]
  metadata: readonly string[]
  taxonomy: readonly string[]
}
type LexicalSuggestionFields = {
  exact: LexicalSuggestionFieldFamily
  stem: LexicalSuggestionFieldFamily
}
type TypesenseWatchSearchSuggestionsServiceOptions = {
  logger?: Pick<Console, "warn">
  applicationRevision?: string
  lexicalCollection?: string
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

function phraseWindows(
  value: string,
  query: string,
  minimumMultiwordLength: number,
  tokenizerLocale: string | null,
): string[] {
  const words = [...value.normalize("NFC").matchAll(PHRASE_WORD)].map(
    (match) => match[0],
  )
  if (words.length === 0) return []
  const comparableQuery = comparablePhrase(query)
  const matches = words.flatMap((word, index) => {
    const suffix = words
      .slice(index, Math.min(words.length, index + 5))
      .map((candidate) => candidate)
      .join(" ")
      .toLocaleLowerCase()
    return suffix.startsWith(comparableQuery) ||
      word.toLocaleLowerCase().startsWith(comparableQuery)
      ? [index]
      : []
  })

  const phrases = new Set<string>()
  for (const matchIndex of matches) {
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
        if (
          tokenizerLocale === "en" &&
          length > 1 &&
          (PHRASE_EDGE_STOP_WORDS.has(first) ||
            PHRASE_EDGE_STOP_WORDS.has(last))
        ) {
          continue
        }
        phrases.add(words.slice(start, end + 1).join(" "))
      }
    }
  }
  return [...phrases]
}

function extractedQuerySuggestions(
  groups: readonly TypesenseSearchGroup<TypesenseWatchLexicalDocument>[],
  titleFields: readonly string[],
  metadataFields: readonly string[],
  query: string,
  excludedTitles: ReadonlySet<string>,
  tokenizerLocale: string | null,
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
      minimumMultiwordLength,
      tokenizerLocale,
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

function lexicalSearchRequestBase(
  query: string,
  fields: readonly string[],
  weights: readonly number[],
  languageIdentity: string,
  lexicalCollection: string,
): TypesenseSearchRequest {
  return {
    collection: lexicalCollection,
    q: query,
    query_by: fields.join(","),
    query_by_weights: weights.join(","),
    num_typos: fields.map(() => 0).join(","),
    text_match_type: "max_weight",
    prioritize_exact_match: true,
    drop_tokens_threshold: 0,
    filter_by: `languageIdentity:=[\`${languageIdentity}\`]`,
  }
}

function baselineSuggestionRequest(
  query: string,
  titleFields: readonly string[],
  metadataFields: readonly string[],
  languageIdentity: string,
  lexicalCollection: string,
): TypesenseSearchRequest {
  const fields = [...titleFields, ...metadataFields]
  return {
    ...lexicalSearchRequestBase(
      query,
      fields,
      [
        ...titleFields.map((_field, index) => (index === 0 ? 8 : 4)),
        ...metadataFields.map((_field, index) => (index === 0 ? 2 : 1)),
      ],
      languageIdentity,
      lexicalCollection,
    ),
    page: 1,
    per_page: TYPESENSE_SUGGESTION_CANDIDATE_LIMIT,
    group_by: "canonicalVideoId",
    group_limit: 1,
    prefix: true,
    include_fields: [
      "videoId",
      "canonicalVideoId",
      "languageIdentity",
      ...fields,
    ].join(","),
    highlight_fields: fields.join(","),
  }
}

function lexicalSuggestionRequestBase(
  query: string,
  titleFields: readonly string[],
  metadataFields: readonly string[],
  languageIdentity: string,
  lexicalCollection: string,
): TypesenseSearchRequest {
  const fields = [...titleFields, ...metadataFields]
  return lexicalSearchRequestBase(
    query,
    fields,
    [
      ...titleFields.map((_field, index) => (index === 0 ? 8 : 4)),
      ...metadataFields.map((_field, index) => (index === 0 ? 2 : 1)),
    ],
    languageIdentity,
    lexicalCollection,
  )
}

function expansionSuggestionRequest(
  query: string,
  fields: LexicalSuggestionFields,
  languageIdentity: string,
  lexicalCollection: string,
): TypesenseSearchRequest {
  const queryFields = [
    ...fields.exact.taxonomy,
    ...fields.stem.title,
    ...fields.stem.metadata,
    ...fields.stem.taxonomy,
  ]
  const includeFields = [
    ...new Set([
      "videoId",
      "canonicalVideoId",
      "languageIdentity",
      ...fields.exact.title,
      ...fields.exact.metadata,
      ...queryFields,
    ]),
  ]
  return {
    ...lexicalSearchRequestBase(
      query,
      queryFields,
      [
        ...fields.exact.taxonomy.map((_field, index) => (index === 0 ? 6 : 3)),
        ...fields.stem.title.map(() => 5),
        ...fields.stem.metadata.map(() => 1),
        ...fields.stem.taxonomy.map(() => 2),
      ],
      languageIdentity,
      lexicalCollection,
    ),
    page: 1,
    per_page: TYPESENSE_SUGGESTION_CANDIDATE_LIMIT,
    group_by: "canonicalVideoId",
    group_limit: 1,
    prefix: true,
    include_fields: includeFields.join(","),
    highlight_fields: queryFields.join(","),
  }
}

function boundedSuggestionRetrievalRequests(
  baseline: TypesenseSearchRequest,
  expansion: TypesenseSearchRequest,
): readonly [TypesenseSearchRequest, TypesenseSearchRequest] | null {
  const baselineFields = String(baseline.query_by).split(",").filter(Boolean)
  const expansionFields = String(expansion.query_by).split(",").filter(Boolean)
  if (
    baselineFields.length > MAX_BASELINE_QUERY_FIELDS ||
    expansionFields.length > MAX_EXPANSION_QUERY_FIELDS
  ) {
    return null
  }
  const searches = [baseline, expansion] as const
  const queryByBytes = searches.reduce(
    (bytes, search) =>
      bytes + new TextEncoder().encode(String(search.query_by)).byteLength,
    0,
  )
  if (queryByBytes > MAX_RETRIEVAL_QUERY_BY_BYTES) return null
  const requestBytes = new TextEncoder().encode(
    JSON.stringify({ searches }),
  ).byteLength
  return requestBytes <= MAX_RETRIEVAL_REQUEST_BYTES ? searches : null
}

function phraseValidationRequest(
  phrase: string,
  titleFields: readonly string[],
  metadataFields: readonly string[],
  languageIdentity: string,
  lexicalCollection: string,
): TypesenseSearchRequest {
  return {
    ...lexicalSuggestionRequestBase(
      phrase,
      titleFields,
      metadataFields,
      languageIdentity,
      lexicalCollection,
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
  applicationRevision: string,
): string {
  return [
    applicationRevision,
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
  applicationRevision: string,
  lexicalCollection: string,
): Promise<WatchSearchSuggestion[]> {
  if (suggestions.length === 0) return []

  const fields = [...titleFields, ...metadataFields]
  const keys = suggestions.map((suggestion) =>
    phraseValidationCacheKey(
      suggestion,
      languageIdentity,
      fields,
      applicationRevision,
    ),
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
            lexicalCollection,
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

const DIRECT_MATCH_CLASS_RANK = {
  exactTitlePrefix: 0,
  exactTaxonomy: 1,
  stemTitle: 2,
  exactMetadata: 3,
  stemTaxonomy: 4,
  stemMetadata: 5,
} as const

type DirectMatchClass = keyof typeof DIRECT_MATCH_CLASS_RANK

type DirectMatchCandidate = {
  canonicalVideoId: string
  videoId: string
  title: string
  description: string | null
  matchSource: "title" | "description"
  matchClass: DirectMatchClass
  rawTextScore: bigint
  groupOrder: number
}

function languageScopedGroups(
  groups: readonly TypesenseSearchGroup<TypesenseWatchLexicalDocument>[],
  languageIdentity: string,
): TypesenseSearchGroup<TypesenseWatchLexicalDocument>[] {
  return groups
    .slice(0, TYPESENSE_SUGGESTION_CANDIDATE_LIMIT)
    .flatMap((group) => {
      const hits = group.hits
        .slice(0, 1)
        .filter((hit) => hit.document.languageIdentity === languageIdentity)
      return hits.length > 0 ? [{ ...group, hits }] : []
    })
}

function matchedFieldNames(
  hit: TypesenseSearchHit<TypesenseWatchLexicalDocument>,
): Set<string> {
  return new Set(
    (hit.highlights ?? []).flatMap((highlight) =>
      Array.isArray(highlight.matched_tokens) &&
      highlight.matched_tokens.length > 0
        ? [highlight.field]
        : [],
    ),
  )
}

function rawTextScore(
  hit: TypesenseSearchHit<TypesenseWatchLexicalDocument>,
): bigint {
  const exactScore = hit.text_match_info?.score
  if (exactScore && /^\d+$/.test(exactScore)) {
    try {
      return BigInt(exactScore)
    } catch {
      return 0n
    }
  }
  return Number.isFinite(hit.text_match)
    ? BigInt(Math.max(0, Math.trunc(hit.text_match ?? 0)))
    : 0n
}

function hitIdentity(
  hit: TypesenseSearchHit<TypesenseWatchLexicalDocument>,
): { canonicalVideoId: string; videoId: string } | null {
  const { canonicalVideoId, videoId } = hit.document
  return typeof canonicalVideoId === "string" &&
    canonicalVideoId.length > 0 &&
    typeof videoId === "string" &&
    videoId.length > 0
    ? { canonicalVideoId, videoId }
    : null
}

function baselineDirectMatchCandidates(
  groups: readonly TypesenseSearchGroup<TypesenseWatchLexicalDocument>[],
  titleFields: readonly string[],
  metadataFields: readonly string[],
  prefix: string,
): DirectMatchCandidate[] {
  return groups.flatMap((group, groupIndex) => {
    for (const hit of group.hits) {
      const identity = hitIdentity(hit)
      if (!identity) continue
      const evidenceFields = matchedFieldNames(hit)
      const evidencedTitleFields =
        evidenceFields.size > 0
          ? titleFields.filter((field) => evidenceFields.has(field))
          : titleFields
      const evidencedMetadataFields =
        evidenceFields.size > 0
          ? metadataFields.filter((field) => evidenceFields.has(field))
          : metadataFields
      const matchedTitle = matchingValue(
        hit.document,
        evidencedTitleFields,
        prefix,
      )
      const matchedDescription = matchingValue(
        hit.document,
        evidencedMetadataFields,
        prefix,
      )
      const title = matchedTitle ?? firstValue(hit.document, titleFields)
      if (!title || (!matchedTitle && !matchedDescription)) continue
      return [
        {
          ...identity,
          title,
          description:
            matchedDescription ?? firstValue(hit.document, metadataFields),
          matchSource: matchedTitle ? "title" : "description",
          matchClass: matchedTitle ? "exactTitlePrefix" : "exactMetadata",
          rawTextScore: rawTextScore(hit),
          groupOrder: groupIndex,
        } satisfies DirectMatchCandidate,
      ]
    }
    return []
  })
}

function expansionDirectMatchCandidates(
  groups: readonly TypesenseSearchGroup<TypesenseWatchLexicalDocument>[],
  fields: LexicalSuggestionFields,
): DirectMatchCandidate[] {
  const matchClassByField = new Map<string, DirectMatchClass>([
    ...fields.exact.taxonomy.map((field) => [field, "exactTaxonomy"] as const),
    ...fields.stem.title.map((field) => [field, "stemTitle"] as const),
    ...fields.stem.taxonomy.map((field) => [field, "stemTaxonomy"] as const),
    ...fields.stem.metadata.map((field) => [field, "stemMetadata"] as const),
  ])
  return groups.flatMap((group, groupIndex) => {
    for (const hit of group.hits) {
      const identity = hitIdentity(hit)
      if (!identity) continue
      const matchClasses = [...matchedFieldNames(hit)].flatMap((field) => {
        const matchClass = matchClassByField.get(field)
        return matchClass == null ? [] : [matchClass]
      })
      if (matchClasses.length === 0) continue
      matchClasses.sort(
        (left, right) =>
          DIRECT_MATCH_CLASS_RANK[left] - DIRECT_MATCH_CLASS_RANK[right],
      )
      const matchClass = matchClasses[0]
      const title =
        firstValue(hit.document, fields.exact.title) ??
        firstValue(hit.document, fields.stem.title)
      if (!title) continue
      return [
        {
          ...identity,
          title,
          description:
            firstValue(hit.document, fields.exact.metadata) ??
            firstValue(hit.document, fields.stem.metadata),
          matchSource: matchClass === "stemMetadata" ? "description" : "title",
          matchClass,
          rawTextScore: rawTextScore(hit),
          groupOrder: TYPESENSE_SUGGESTION_CANDIDATE_LIMIT + groupIndex,
        } satisfies DirectMatchCandidate,
      ]
    }
    return []
  })
}

function mergedDirectMatchCandidates(
  candidates: readonly DirectMatchCandidate[],
): DirectMatchCandidate[] {
  const sorted = [...candidates].sort(
    (left, right) =>
      DIRECT_MATCH_CLASS_RANK[left.matchClass] -
        DIRECT_MATCH_CLASS_RANK[right.matchClass] ||
      (left.rawTextScore > right.rawTextScore
        ? -1
        : left.rawTextScore < right.rawTextScore
          ? 1
          : 0) ||
      left.groupOrder - right.groupOrder ||
      left.canonicalVideoId.localeCompare(right.canonicalVideoId),
  )

  const seenCanonicalIds = new Set<string>()
  const suggestions: DirectMatchCandidate[] = []
  for (const suggestion of sorted) {
    if (seenCanonicalIds.has(suggestion.canonicalVideoId)) continue
    seenCanonicalIds.add(suggestion.canonicalVideoId)
    suggestions.push(suggestion)
    if (suggestions.length === MAX_WATCH_SEARCH_CONTENT_MATCHES) break
  }
  return suggestions
}

async function hydrateDirectMatches(
  prisma: SuggestionPrisma,
  candidates: readonly DirectMatchCandidate[],
): Promise<WatchSearchSuggestion[]> {
  if (candidates.length === 0) return []
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

type SuggestionRetrievalLane = {
  available: boolean
  groups: TypesenseSearchGroup<TypesenseWatchLexicalDocument>[]
}

function suggestionRetrievalLane(
  result:
    | TypesenseSettledSearchResult<TypesenseWatchLexicalDocument>
    | undefined,
): SuggestionRetrievalLane {
  if (result?.status !== "fulfilled") {
    return { available: false, groups: [] }
  }
  const value = result.value
  if (
    !Number.isFinite(value.found) ||
    value.found < 0 ||
    !("grouped_hits" in value) ||
    !Array.isArray(value.grouped_hits)
  ) {
    return { available: false, groups: [] }
  }
  return { available: true, groups: value.grouped_hits }
}

function retrievalLaneEvent(
  logger: Pick<Console, "warn">,
  lane: "baseline" | "expansion" | "total",
  outcome:
    | "baseline_empty"
    | "baseline_unavailable"
    | "expansion_empty"
    | "expansion_unavailable"
    | "total_unavailable",
  analyzer: string,
  reason?: "malformed_results" | "request_error" | "request_invariant",
): void {
  logger.warn(
    `[watch-search-suggestions] event=${lane === "total" ? "typesense_unavailable" : "lane_outcome"} lane=${lane} outcome=${outcome} revision=${TYPESENSE_WATCH_SEARCH_CANDIDATE_APPLICATION_REVISION} analyzer=${analyzer}${reason ? ` reason=${reason}` : ""}`,
  )
}

export class TypesenseWatchSearchSuggestionsService {
  private readonly logger: Pick<Console, "warn">
  private readonly applicationRevision: string
  private readonly lexicalCollection: string

  constructor(
    private readonly prisma: SuggestionPrisma,
    private readonly typesense: SuggestionTypesense,
    options: TypesenseWatchSearchSuggestionsServiceOptions = {},
  ) {
    this.logger = options.logger ?? console
    this.applicationRevision =
      options.applicationRevision ??
      TYPESENSE_WATCH_SEARCH_CANDIDATE_APPLICATION_REVISION
    this.lexicalCollection =
      options.lexicalCollection ?? TYPESENSE_WATCH_LEXICAL_ALIAS
  }

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
    let analyzer = "unknown"
    try {
      const language = await resolveSuggestionLanguage(
        this.prisma,
        languageSlug,
      )
      if (!language) return []

      const tokenizerLocale = typesenseWatchTokenizerLocale(language.locale)
      analyzer = tokenizerLocale ?? "fallback"
      const fields: LexicalSuggestionFields = {
        exact: {
          title: watchLexicalQueryFields(language.locale, "title", "exact"),
          metadata: watchLexicalQueryFields(
            language.locale,
            "metadata",
            "exact",
          ),
          taxonomy: watchLexicalQueryFields(
            language.locale,
            "taxonomy",
            "exact",
          ),
        },
        stem: {
          title: watchLexicalQueryFields(language.locale, "title", "stem"),
          metadata: watchLexicalQueryFields(
            language.locale,
            "metadata",
            "stem",
          ),
          taxonomy: watchLexicalQueryFields(
            language.locale,
            "taxonomy",
            "stem",
          ),
        },
      }
      const searches = boundedSuggestionRetrievalRequests(
        baselineSuggestionRequest(
          query,
          fields.exact.title,
          fields.exact.metadata,
          language.languageIdentity,
          this.lexicalCollection,
        ),
        expansionSuggestionRequest(
          query,
          fields,
          language.languageIdentity,
          this.lexicalCollection,
        ),
      )
      if (!searches) {
        retrievalLaneEvent(
          this.logger,
          "total",
          "total_unavailable",
          analyzer,
          "request_invariant",
        )
        return []
      }
      const results =
        await this.typesense.multiSearchSettled<TypesenseWatchLexicalDocument>(
          searches,
        )
      if (results.length !== 2) {
        retrievalLaneEvent(
          this.logger,
          "total",
          "total_unavailable",
          analyzer,
          "malformed_results",
        )
        return []
      }
      const baseline = suggestionRetrievalLane(results[0])
      const expansion = suggestionRetrievalLane(results[1])
      if (!baseline.available) {
        retrievalLaneEvent(
          this.logger,
          "baseline",
          "baseline_unavailable",
          analyzer,
        )
      }
      if (!expansion.available) {
        retrievalLaneEvent(
          this.logger,
          "expansion",
          "expansion_unavailable",
          analyzer,
        )
      }
      if (!baseline.available && !expansion.available) {
        retrievalLaneEvent(
          this.logger,
          "total",
          "total_unavailable",
          analyzer,
          "malformed_results",
        )
        return []
      }

      const baselineGroups = baseline.available
        ? languageScopedGroups(baseline.groups, language.languageIdentity)
        : []
      const expansionGroups = expansion.available
        ? languageScopedGroups(expansion.groups, language.languageIdentity)
        : []
      if (baseline.available && baselineGroups.length === 0) {
        retrievalLaneEvent(this.logger, "baseline", "baseline_empty", analyzer)
      }
      if (expansion.available && expansionGroups.length === 0) {
        retrievalLaneEvent(
          this.logger,
          "expansion",
          "expansion_empty",
          analyzer,
        )
      }

      const candidates = mergedDirectMatchCandidates([
        ...baselineDirectMatchCandidates(
          baselineGroups,
          fields.exact.title,
          fields.exact.metadata,
          comparableTitle(query),
        ),
        ...expansionDirectMatchCandidates(expansionGroups, fields),
      ])
      const directMatches = await hydrateDirectMatches(this.prisma, candidates)
      if (!baseline.available) return directMatches

      const directTitles = new Set(
        directMatches.map((match) => comparablePhrase(match.title)),
      )
      const extractedSuggestions = extractedQuerySuggestions(
        baselineGroups,
        fields.exact.title,
        fields.exact.metadata,
        query,
        directTitles,
        tokenizerLocale,
      )
      let querySuggestions: WatchSearchSuggestion[] = []
      try {
        querySuggestions = await validateQuerySuggestions(
          this.prisma,
          this.typesense,
          extractedSuggestions,
          fields.exact.title,
          fields.exact.metadata,
          language.languageIdentity,
          this.applicationRevision,
          this.lexicalCollection,
        )
      } catch {
        this.logger.warn(
          "[watch-search-suggestions] event=phrase_validation_unavailable",
        )
      }
      return [...querySuggestions, ...directMatches]
    } catch {
      retrievalLaneEvent(
        this.logger,
        "total",
        "total_unavailable",
        analyzer,
        "request_error",
      )
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
