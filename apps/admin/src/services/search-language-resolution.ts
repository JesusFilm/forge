import { Prisma, type PrismaClient } from "@prisma/client"

import {
  cachedBoundedTtlValue,
  type BoundedTtlCache,
} from "./bounded-ttl-promise-cache"

export type SearchLanguageSignalSource =
  | "explicit_target"
  | "query_named_language"
  | "query_script"
  | "current_watch"
  | "route"
  | "display"
  | "accept_language"
  | "fallback"

export type SearchLanguageResolutionInput = {
  query?: string | null
  targetLanguageSlug?: string | null
  queryLanguageSlug?: string | null
  queryNamedLanguageSlug?: string | null
  displayLanguageSlug?: string | null
  routeLanguageSlug?: string | null
  currentWatchLanguageSlug?: string | null
  acceptLanguage?: string | null
}

export type SearchLanguageResolution = {
  targetLanguageSlug: string
  targetLanguageSource: SearchLanguageSignalSource
  queryLanguageSlug: string | null
  queryNamedLanguageSlug: string | null
  displayLanguageSlug: string | null
  displayLanguageBcp47: string | null
  routeLanguageSlug: string | null
  routeLanguageBcp47: string | null
  currentWatchLanguageSlug: string | null
  acceptLanguage: string | null
  acceptLanguageSlug: string | null
}

export type SearchQueryLexicalContext = {
  tokenizerLocale: string
  languageSlugs: readonly string[]
}

export type SearchQueryScriptContext = {
  targetLanguageSlug: string
  lexicalContext: SearchQueryLexicalContext | null
}

const FALLBACK_TARGET_LANGUAGE_SLUG = "english"
const MAX_ACCEPT_LANGUAGE_CANDIDATES = 8
const LANGUAGE_IDENTITY_CACHE_TTL_MS = 5 * 60 * 1_000
const LANGUAGE_IDENTITY_CACHE_MAX_ENTRIES = 2_048
const BCP47_LANGUAGE_TAG_PATTERN = /^(?:[a-z]{2,8}|[ix])(?:-[a-z0-9]{1,8})*$/i

type CanonicalLanguageIdentity = {
  bcp47: string | null
  slug: string
}

const languageIdentityCaches = new WeakMap<
  object,
  BoundedTtlCache<CanonicalLanguageIdentity[]>
>()

const QUERY_SCRIPT_LANGUAGE_HINTS: ReadonlyArray<{
  pattern: RegExp
  targetLanguageSlug: string
  minimumCharacters: number
  lexicalContext?: SearchQueryLexicalContext
}> = Object.freeze([
  {
    pattern: /\p{Script=Cyrillic}/u,
    targetLanguageSlug: "russian",
    minimumCharacters: 2,
  },
  {
    pattern: /\p{Script=Arabic}/u,
    targetLanguageSlug: "arabic-modern-standard",
    minimumCharacters: 1,
  },
  {
    pattern: /\p{Script=Han}/u,
    targetLanguageSlug: "mandarin-china",
    minimumCharacters: 1,
    lexicalContext: {
      tokenizerLocale: "zh",
      languageSlugs: ["chinese-simplified", "chinese-traditional"],
    },
  },
  {
    pattern: /\p{Script=Hiragana}|\p{Script=Katakana}/u,
    targetLanguageSlug: "japanese",
    minimumCharacters: 1,
  },
  {
    pattern: /\p{Script=Hangul}/u,
    targetLanguageSlug: "korean",
    minimumCharacters: 1,
  },
  {
    pattern: /\p{Script=Devanagari}/u,
    targetLanguageSlug: "hindi",
    minimumCharacters: 1,
  },
])

function normalizeSlug(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? ""
  return normalized.length > 0 ? normalized : null
}

function parseAcceptLanguageCandidates(value: string | null): string[] {
  if (!value) return []

  return value
    .split(",")
    .flatMap((part) => {
      const [languageRange, ...params] = part.trim().split(";")
      const bcp47 = languageRange?.trim()
      if (!bcp47 || bcp47 === "*") return []
      const qParam = params.find((param) => param.trim().startsWith("q="))
      const q = qParam ? Number(qParam.trim().slice(2)) : 1
      return [
        {
          bcp47,
          q: Number.isFinite(q) ? q : 0,
        },
      ]
    })
    .filter((candidate) => candidate.q > 0)
    .sort((a, b) => b.q - a.q)
    .map((candidate) => candidate.bcp47)
    .slice(0, MAX_ACCEPT_LANGUAGE_CANDIDATES)
}

function bcp47LookupLevels(value: string): string[] {
  if (!BCP47_LANGUAGE_TAG_PATTERN.test(value)) return []

  const levels: string[] = []
  const subtags = value.toLowerCase().split("-")
  while (subtags.length > 0) {
    levels.push(subtags.join("-"))
    subtags.pop()

    // RFC 4647 lookup removes a trailing extension singleton with its value.
    if (subtags.at(-1)?.length === 1) subtags.pop()
  }
  return levels
}

function uniqueMatchedSlugs(
  languages: CanonicalLanguageIdentity[],
  predicate: (language: CanonicalLanguageIdentity) => boolean,
): string[] {
  return [...new Set(languages.filter(predicate).map(({ slug }) => slug))]
}

function canonicalLanguageSlug(
  value: string | null,
  languages: CanonicalLanguageIdentity[],
): string | null {
  if (!value) return null

  const lowerValue = value.toLowerCase()
  const exactSlugMatches = uniqueMatchedSlugs(
    languages,
    ({ slug }) => slug.toLowerCase() === lowerValue,
  )
  if (exactSlugMatches.length > 0) {
    return exactSlugMatches.length === 1 ? exactSlugMatches[0] : null
  }

  for (const level of bcp47LookupLevels(value)) {
    const bcp47Matches = uniqueMatchedSlugs(
      languages,
      ({ bcp47 }) => bcp47?.toLowerCase() === level,
    )
    if (bcp47Matches.length === 1) return bcp47Matches[0]
    if (bcp47Matches.length > 1) return null
  }
  return null
}

function bcp47ForCanonicalSlug(
  slug: string | null,
  languages: CanonicalLanguageIdentity[],
): string | null {
  if (!slug) return null

  const matches = [
    ...new Set(
      languages.flatMap((language) =>
        language.slug.toLowerCase() === slug.toLowerCase() && language.bcp47
          ? [language.bcp47]
          : [],
      ),
    ),
  ]
  return matches.length === 1 ? matches[0] : null
}

async function languagesForIdentitySignals(
  prisma: PrismaClient,
  values: Array<string | null>,
): Promise<CanonicalLanguageIdentity[]> {
  const identities = [
    ...new Set(values.flatMap((value) => (value ? [value] : []))),
  ]
  if (identities.length === 0) return []

  const bcp47Levels = [
    ...new Set(identities.flatMap((value) => bcp47LookupLevels(value))),
  ]
  const cacheKey = JSON.stringify(
    identities.map((value) => value.toLocaleLowerCase()).sort(),
  )
  return cachedBoundedTtlValue({
    cacheByOwner: languageIdentityCaches,
    owner: prisma,
    key: cacheKey,
    ttlMs: LANGUAGE_IDENTITY_CACHE_TTL_MS,
    maxEntries: LANGUAGE_IDENTITY_CACHE_MAX_ENTRIES,
    loader: async () => {
      const languages = await prisma.language.findMany({
        where: {
          deletedAt: null,
          slug: { not: null },
          OR: [
            { slug: { in: identities, mode: "insensitive" } },
            ...(bcp47Levels.length > 0
              ? [
                  {
                    bcp47: { in: bcp47Levels, mode: "insensitive" as const },
                  },
                ]
              : []),
          ],
        },
        select: {
          bcp47: true,
          slug: true,
        },
      })

      return languages.flatMap(({ bcp47, slug }) =>
        slug ? [{ bcp47, slug }] : [],
      )
    },
  })
}

function queryLanguageTerms(value: string | null): string[] {
  if (!value) return []
  return [
    ...new Set(
      value
        .normalize("NFKD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean),
    ),
  ].slice(0, 16)
}

async function slugForQueryNamedLanguage(
  prisma: PrismaClient,
  query: string | null,
): Promise<string | null> {
  const terms = queryLanguageTerms(query)
  if (terms.length === 0) return null

  const rows = await prisma.$queryRaw<Array<{ slug: string }>>(Prisma.sql`
    SELECT slug
    FROM language
    WHERE deleted_at IS NULL
      AND slug IS NOT NULL
      AND (
        lower(slug) IN (${Prisma.join(terms)})
        OR lower(split_part(name->>'en', ',', 1)) IN (${Prisma.join(terms)})
      )
    ORDER BY
      CASE
        WHEN lower(slug) IN (${Prisma.join(terms)}) THEN 0
        ELSE 1
      END,
      length(slug) ASC,
      slug ASC
    LIMIT 1
  `)

  return rows[0]?.slug ?? null
}

function scriptCharacterCount(
  value: string,
  hint: (typeof QUERY_SCRIPT_LANGUAGE_HINTS)[number],
): number {
  let count = 0
  for (const character of value) {
    if (hint.pattern.test(character)) count += 1
  }
  return count
}

export function resolveSearchQueryScriptContext(
  query: string | null,
): SearchQueryScriptContext | null {
  if (!query) return null
  for (const hint of QUERY_SCRIPT_LANGUAGE_HINTS) {
    if (scriptCharacterCount(query, hint) >= hint.minimumCharacters) {
      return {
        targetLanguageSlug: hint.targetLanguageSlug,
        lexicalContext: hint.lexicalContext ?? null,
      }
    }
  }
  return null
}
export async function resolveSearchLanguageSignals({
  prisma,
  input,
}: {
  prisma: PrismaClient
  input: SearchLanguageResolutionInput
}): Promise<SearchLanguageResolution> {
  const suppliedExplicitTarget = normalizeSlug(input.targetLanguageSlug)
  const suppliedQueryLanguage = normalizeSlug(input.queryLanguageSlug)
  const suppliedQueryNamedLanguage = normalizeSlug(input.queryNamedLanguageSlug)
  const suppliedCurrentWatch = normalizeSlug(input.currentWatchLanguageSlug)
  const suppliedRoute = normalizeSlug(input.routeLanguageSlug)
  const suppliedDisplay = normalizeSlug(input.displayLanguageSlug)
  const acceptLanguage = normalizeSlug(input.acceptLanguage)
  const acceptLanguageCandidates = parseAcceptLanguageCandidates(acceptLanguage)
  const languages = await languagesForIdentitySignals(prisma, [
    suppliedExplicitTarget,
    suppliedQueryLanguage,
    suppliedQueryNamedLanguage,
    suppliedCurrentWatch,
    suppliedRoute,
    suppliedDisplay,
    ...acceptLanguageCandidates,
  ])

  const explicitTarget = canonicalLanguageSlug(
    suppliedExplicitTarget,
    languages,
  )
  const queryLanguage = canonicalLanguageSlug(suppliedQueryLanguage, languages)
  const providedQueryNamedLanguage = canonicalLanguageSlug(
    suppliedQueryNamedLanguage,
    languages,
  )
  const queryNamedLanguage =
    providedQueryNamedLanguage ??
    (explicitTarget == null
      ? await slugForQueryNamedLanguage(prisma, normalizeSlug(input.query))
      : null)
  const queryScriptLanguage =
    explicitTarget == null && queryNamedLanguage == null
      ? (resolveSearchQueryScriptContext(normalizeSlug(input.query))
          ?.targetLanguageSlug ?? null)
      : null
  const currentWatch = canonicalLanguageSlug(suppliedCurrentWatch, languages)
  const route = canonicalLanguageSlug(suppliedRoute, languages)
  const display = canonicalLanguageSlug(suppliedDisplay, languages)
  const acceptLanguageSlug =
    acceptLanguageCandidates
      .map((candidate) => canonicalLanguageSlug(candidate, languages))
      .find((slug) => slug != null) ?? null

  const targetCandidates: Array<{
    slug: string | null
    source: SearchLanguageSignalSource
  }> = [
    { slug: explicitTarget, source: "explicit_target" },
    { slug: queryNamedLanguage, source: "query_named_language" },
    { slug: queryScriptLanguage, source: "query_script" },
    { slug: currentWatch, source: "current_watch" },
    { slug: route, source: "route" },
    { slug: display, source: "display" },
    { slug: acceptLanguageSlug, source: "accept_language" },
    { slug: FALLBACK_TARGET_LANGUAGE_SLUG, source: "fallback" },
  ]
  const target = targetCandidates.find((candidate) => candidate.slug != null)!

  return {
    targetLanguageSlug: target.slug!,
    targetLanguageSource: target.source,
    queryLanguageSlug: queryLanguage,
    queryNamedLanguageSlug: queryNamedLanguage,
    displayLanguageSlug: display,
    displayLanguageBcp47: bcp47ForCanonicalSlug(display, languages),
    routeLanguageSlug: route,
    routeLanguageBcp47: bcp47ForCanonicalSlug(route, languages),
    currentWatchLanguageSlug: currentWatch,
    acceptLanguage,
    acceptLanguageSlug,
  }
}
