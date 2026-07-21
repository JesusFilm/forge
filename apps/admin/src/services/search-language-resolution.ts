import { Prisma, type PrismaClient } from "@prisma/client"

export type SearchLanguageSignalSource =
  | "explicit_target"
  | "query_named_language"
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
  routeLanguageSlug: string | null
  currentWatchLanguageSlug: string | null
  acceptLanguage: string | null
  acceptLanguageSlug: string | null
}

const FALLBACK_TARGET_LANGUAGE_SLUG = "english"
const MAX_ACCEPT_LANGUAGE_CANDIDATES = 8

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

async function slugForAcceptLanguage(
  prisma: PrismaClient,
  acceptLanguage: string | null,
): Promise<string | null> {
  const candidates = parseAcceptLanguageCandidates(acceptLanguage)
  if (candidates.length === 0) return null

  const languages = await prisma.language.findMany({
    where: {
      bcp47: { in: candidates },
      deletedAt: null,
      slug: { not: null },
    },
    select: {
      bcp47: true,
      slug: true,
    },
  })

  for (const bcp47 of candidates) {
    const match = languages.find((language) => language.bcp47 === bcp47)
    if (match?.slug) return match.slug
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
  const explicitTarget = normalizeSlug(input.targetLanguageSlug)
  const providedQueryNamedLanguage = normalizeSlug(input.queryNamedLanguageSlug)
  const queryNamedLanguage =
    providedQueryNamedLanguage ??
    (explicitTarget == null
      ? await slugForQueryNamedLanguage(prisma, normalizeSlug(input.query))
      : null)
  const currentWatch = normalizeSlug(input.currentWatchLanguageSlug)
  const route = normalizeSlug(input.routeLanguageSlug)
  const display = normalizeSlug(input.displayLanguageSlug)
  const acceptLanguage = normalizeSlug(input.acceptLanguage)
  const acceptLanguageSlug = await slugForAcceptLanguage(prisma, acceptLanguage)

  const targetCandidates: Array<{
    slug: string | null
    source: SearchLanguageSignalSource
  }> = [
    { slug: explicitTarget, source: "explicit_target" },
    { slug: queryNamedLanguage, source: "query_named_language" },
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
    queryLanguageSlug: normalizeSlug(input.queryLanguageSlug),
    queryNamedLanguageSlug: queryNamedLanguage,
    displayLanguageSlug: display,
    routeLanguageSlug: route,
    currentWatchLanguageSlug: currentWatch,
    acceptLanguage,
    acceptLanguageSlug,
  }
}
