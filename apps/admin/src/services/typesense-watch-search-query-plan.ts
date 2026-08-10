import type { PrismaClient } from "@prisma/client"

import {
  cachedBoundedTtlValue,
  type BoundedTtlCache,
} from "./bounded-ttl-promise-cache"
import type {
  SearchLanguageResolution,
  SearchLanguageSignalSource,
} from "./search-language-resolution"

const MAX_LANGUAGE_ROWS = 5_000
const MAX_LANGUAGE_CANDIDATES = 3
const LANGUAGE_ALIAS_CACHE_TTL_MS = 5 * 60 * 1_000
const LANGUAGE_ALIAS_CACHE_MAX_ENTRIES = 1

export type TypesenseWatchQueryLanguageCandidate = Readonly<{
  slug: string
  bcp47: string | null
  reason:
    | "named_language"
    | "explicit_target"
    | "query_language"
    | "script"
    | "context"
  confidence: number
  matchedText: string | null
}>

export type TypesenseWatchSearchQueryPlan = Readonly<{
  contentQuery: string
  namedLanguageSlug: string | null
  targetLanguageSlug: string
  targetLanguageSource: SearchLanguageSignalSource
  languageCandidates: readonly TypesenseWatchQueryLanguageCandidate[]
}>

type LanguageAliasRow = {
  slug: string | null
  bcp47: string | null
  name: unknown
  locales?: Array<{ value: string }>
}

type LanguageIdentity = {
  slug: string
  bcp47: string | null
}

type LanguageAlias = {
  normalized: string
  tokens: readonly string[]
  kind: "name" | "slug" | "bcp47"
  languages: readonly LanguageIdentity[]
}

type LanguageAliasIndex = {
  aliasesByFirstToken: ReadonlyMap<string, readonly LanguageAlias[]>
  byExplicitIdentity: ReadonlyMap<string, readonly LanguageIdentity[]>
  bySlug: ReadonlyMap<string, LanguageIdentity>
}

type QueryToken = {
  normalized: string
  start: number
  end: number
}

type MatchedSpan = {
  start: number
  end: number
  matchedText: string
  languages: readonly LanguageIdentity[]
}

const languageAliasCaches = new WeakMap<
  object,
  BoundedTtlCache<LanguageAliasIndex>
>()

function normalizedPhrase(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
}

function phraseTokens(value: string): string[] {
  const normalized = normalizedPhrase(value)
  return normalized ? normalized.split(" ") : []
}

function compatibilityNames(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  return Object.values(value).flatMap((entry) =>
    typeof entry === "string"
      ? entry
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean)
      : [],
  )
}

function addAlias(
  aliases: Map<string, Map<string, LanguageIdentity>>,
  kind: LanguageAlias["kind"],
  value: string | null,
  language: LanguageIdentity,
): void {
  if (!value) return
  const normalized = normalizedPhrase(value)
  if (!normalized) return
  const key = `${kind}:${normalized}`
  const languages = aliases.get(key) ?? new Map()
  languages.set(language.slug, language)
  aliases.set(key, languages)
}

function compareAliases(left: LanguageAlias, right: LanguageAlias): number {
  const tokenDelta = right.tokens.length - left.tokens.length
  if (tokenDelta !== 0) return tokenDelta
  const lengthDelta = right.normalized.length - left.normalized.length
  if (lengthDelta !== 0) return lengthDelta
  return left.normalized.localeCompare(right.normalized)
}

async function languageAliasIndex(
  prisma: PrismaClient,
): Promise<LanguageAliasIndex> {
  return cachedBoundedTtlValue({
    cacheByOwner: languageAliasCaches,
    owner: prisma,
    key: "active-language-aliases-v1",
    ttlMs: LANGUAGE_ALIAS_CACHE_TTL_MS,
    maxEntries: LANGUAGE_ALIAS_CACHE_MAX_ENTRIES,
    loader: async () => {
      const rows = (await prisma.language.findMany({
        where: { deletedAt: null, slug: { not: null } },
        select: {
          slug: true,
          bcp47: true,
          name: true,
          locales: {
            where: { deletedAt: null },
            select: { value: true },
          },
        },
        orderBy: { slug: "asc" },
        take: MAX_LANGUAGE_ROWS,
      })) as LanguageAliasRow[]
      const aliases = new Map<string, Map<string, LanguageIdentity>>()
      const byExplicitIdentity = new Map<
        string,
        Map<string, LanguageIdentity>
      >()
      const bySlug = new Map<string, LanguageIdentity>()

      for (const row of rows) {
        const slug = row.slug?.trim()
        if (!slug) continue
        const language = { slug, bcp47: row.bcp47?.trim() || null }
        bySlug.set(slug, language)
        for (const name of [
          ...compatibilityNames(row.name),
          ...(row.locales ?? []).map(({ value }) => value),
        ]) {
          addAlias(aliases, "name", name, language)
        }
        addAlias(aliases, "slug", slug, language)
        addAlias(aliases, "bcp47", row.bcp47, language)
        for (const identity of [slug, row.bcp47].filter(
          (value): value is string => Boolean(value),
        )) {
          const key = normalizedPhrase(identity)
          const matches = byExplicitIdentity.get(key) ?? new Map()
          matches.set(slug, language)
          byExplicitIdentity.set(key, matches)
        }
      }

      const sortedAliases = [...aliases.entries()]
        .map(([key, languages]) => {
          const separator = key.indexOf(":")
          const kind = key.slice(0, separator) as LanguageAlias["kind"]
          const normalized = key.slice(separator + 1)
          return {
            kind,
            normalized,
            tokens: phraseTokens(normalized),
            languages: [...languages.values()].sort((left, right) =>
              left.slug.localeCompare(right.slug),
            ),
          }
        })
        .sort(compareAliases)
      const aliasesByFirstToken = new Map<string, LanguageAlias[]>()
      for (const alias of sortedAliases) {
        const firstToken = alias.tokens[0]
        if (!firstToken) continue
        const matches = aliasesByFirstToken.get(firstToken) ?? []
        matches.push(alias)
        aliasesByFirstToken.set(firstToken, matches)
      }

      return {
        aliasesByFirstToken,
        byExplicitIdentity: new Map(
          [...byExplicitIdentity].map(([key, languages]) => [
            key,
            [...languages.values()].sort((left, right) =>
              left.slug.localeCompare(right.slug),
            ),
          ]),
        ),
        bySlug,
      }
    },
  })
}

function queryTokens(query: string): QueryToken[] {
  return [...query.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => ({
    normalized: normalizedPhrase(match[0]),
    start: match.index,
    end: match.index + match[0].length,
  }))
}

function overlaps(left: MatchedSpan, right: MatchedSpan): boolean {
  return left.start < right.end && right.start < left.end
}

function naturalAliasSpans(
  query: string,
  index: LanguageAliasIndex,
  occupied: readonly MatchedSpan[],
): MatchedSpan[] {
  const tokens = queryTokens(query)
  const fullQuery = normalizedPhrase(query)
  const startIndexesByToken = new Map<string, number[]>()
  for (const [index, token] of tokens.entries()) {
    const indexes = startIndexesByToken.get(token.normalized) ?? []
    indexes.push(index)
    startIndexesByToken.set(token.normalized, indexes)
  }
  const aliases = [...startIndexesByToken.keys()]
    .flatMap((token) => index.aliasesByFirstToken.get(token) ?? [])
    .sort(compareAliases)
  const spans: MatchedSpan[] = []
  for (const alias of aliases) {
    const bareSlugAllowed =
      alias.kind === "slug" && alias.normalized.replace(/\s/g, "").length >= 4
    const fullQueryAlias = fullQuery === alias.normalized
    if (alias.kind !== "name" && !bareSlugAllowed && !fullQueryAlias) continue
    for (const startIndex of startIndexesByToken.get(alias.tokens[0]!) ?? []) {
      if (startIndex > tokens.length - alias.tokens.length) continue
      const candidateTokens = tokens.slice(
        startIndex,
        startIndex + alias.tokens.length,
      )
      if (
        candidateTokens.some(
          (token, index) => token.normalized !== alias.tokens[index],
        )
      ) {
        continue
      }
      const first = candidateTokens[0]
      const last = candidateTokens.at(-1)
      if (!first || !last) continue
      const span = {
        start: first.start,
        end: last.end,
        matchedText: query.slice(first.start, last.end),
        languages: alias.languages,
      }
      if ([...occupied, ...spans].some((other) => overlaps(span, other))) {
        continue
      }
      spans.push(span)
    }
  }
  return spans
}

function explicitAliasSpans(
  query: string,
  index: LanguageAliasIndex,
): MatchedSpan[] {
  const spans: MatchedSpan[] = []
  for (const match of query.matchAll(/\b(?:lang|language)\s*:\s*([\w-]+)/giu)) {
    const identity = normalizedPhrase(match[1] ?? "")
    const languages = index.byExplicitIdentity.get(identity)
    if (!languages || match.index == null) continue
    spans.push({
      start: match.index,
      end: match.index + match[0].length,
      matchedText: match[0],
      languages,
    })
  }
  return spans
}

function strippedContentQuery(query: string, spans: readonly MatchedSpan[]) {
  let content = query
  for (const span of [...spans].sort(
    (left, right) => right.start - left.start,
  )) {
    content = `${content.slice(0, span.start)} ${content.slice(span.end)}`
  }
  const normalized = content.replace(/\s+/g, " ").trim()
  return normalized || query.trim()
}

function addCandidate(
  candidates: TypesenseWatchQueryLanguageCandidate[],
  language: LanguageIdentity | undefined,
  reason: TypesenseWatchQueryLanguageCandidate["reason"],
  confidence: number,
  matchedText: string | null,
): void {
  if (!language || candidates.some(({ slug }) => slug === language.slug)) return
  candidates.push(
    Object.freeze({
      ...language,
      reason,
      confidence,
      matchedText,
    }),
  )
}

export async function buildTypesenseWatchSearchQueryPlan({
  prisma,
  query,
  baseResolution,
}: {
  prisma: PrismaClient
  query: string
  baseResolution: SearchLanguageResolution
}): Promise<TypesenseWatchSearchQueryPlan> {
  const index = await languageAliasIndex(prisma)
  const explicitSpans = explicitAliasSpans(query, index)
  const namedSpans = naturalAliasSpans(query, index, explicitSpans)
  const spans = [...explicitSpans, ...namedSpans]
  const namedLanguages = new Map<string, LanguageIdentity>()
  for (const span of spans) {
    for (const language of span.languages) {
      namedLanguages.set(language.slug, language)
    }
  }
  const orderedNamedLanguages = [...namedLanguages.values()].sort(
    (left, right) => left.slug.localeCompare(right.slug),
  )
  const namedLanguageSlug =
    orderedNamedLanguages.length === 1 ? orderedNamedLanguages[0]!.slug : null
  const explicitTarget =
    baseResolution.targetLanguageSource === "explicit_target"
      ? index.bySlug.get(baseResolution.targetLanguageSlug)
      : undefined
  const candidates: TypesenseWatchQueryLanguageCandidate[] = []
  for (const language of orderedNamedLanguages) {
    const matchedText =
      spans.find((span) =>
        span.languages.some(({ slug }) => slug === language.slug),
      )?.matchedText ?? null
    addCandidate(candidates, language, "named_language", 1, matchedText)
    if (candidates.length === MAX_LANGUAGE_CANDIDATES) break
  }
  if (candidates.length < MAX_LANGUAGE_CANDIDATES) {
    addCandidate(candidates, explicitTarget, "explicit_target", 1, null)
  }
  for (const [slug, reason, confidence] of [
    [baseResolution.queryLanguageSlug, "query_language", 0.85],
    [
      baseResolution.targetLanguageSource === "query_script"
        ? baseResolution.targetLanguageSlug
        : null,
      "script",
      0.7,
    ],
    [baseResolution.currentWatchLanguageSlug, "context", 0.6],
    [baseResolution.routeLanguageSlug, "context", 0.5],
    [baseResolution.displayLanguageSlug, "context", 0.45],
  ] as const) {
    if (candidates.length === MAX_LANGUAGE_CANDIDATES) break
    addCandidate(
      candidates,
      slug ? index.bySlug.get(slug) : undefined,
      reason,
      confidence,
      null,
    )
  }

  const namedTarget =
    baseResolution.targetLanguageSource !== "explicit_target" &&
    namedLanguageSlug
      ? namedLanguageSlug
      : null
  return Object.freeze({
    contentQuery: strippedContentQuery(query, spans),
    namedLanguageSlug,
    targetLanguageSlug: namedTarget ?? baseResolution.targetLanguageSlug,
    targetLanguageSource: namedTarget
      ? "query_named_language"
      : baseResolution.targetLanguageSource,
    languageCandidates: Object.freeze(candidates),
  })
}
