"use server"

import { headers } from "next/headers"

import { isWatchAlgoliaSearchEnabled } from "./feature-flags"
import { searchAlgoliaVideos } from "./algolia-search"
import { transformAlgoliaVideoHits } from "./algolia-video-transform"
import { isPublicWatchLanguageSlug } from "./locale"
import {
  searchVideos,
  type SearchContentType,
  type SearchActionResult,
  type SearchError,
  type SearchResult,
} from "./search"
import {
  findSearchLanguageOptionByEnglishName,
  normalizeSearchLanguageEnglishNames,
  resolveSearchLanguage,
  type SearchLanguageOption,
} from "./search-language"

// Server-action wrapper around `searchVideos` for client-component callers
// (search overlay, load-more button). The browser cannot reach admin
// directly — admin requires a server-side bearer set via WEB_ADMIN_API_KEYS
// — so client-side searches dispatch through this action which runs on the
// Next.js server. It also owns the LaunchDarkly fork for the Algolia-backed
// Watch video search so the modal stays canonical on the client.
//
// The "use server" directive limits this file to exporting async functions
// only; the type for the action shape itself lives in search.ts.

const DEFAULT_SEARCH_MODE = "hybrid"

export async function runSearch(input: {
  query: string
  limit?: number
  offset?: number
  type?: SearchContentType
  languageEnglishNames?: string[]
  languageOptions?: SearchLanguageOption[]
  languageSlug?: string | null
  routeLanguageSlug?: string | null
}): Promise<SearchActionResult> {
  const {
    query,
    limit,
    offset,
    type,
    languageEnglishNames = [],
    languageOptions = [],
    languageSlug,
    routeLanguageSlug,
  } = input

  const truncatedQuery = query.slice(0, 200)
  const selectedLanguageEnglishNames =
    normalizeSearchLanguageEnglishNames(languageEnglishNames)
  const [flagEnabled, acceptLanguage] = await Promise.all([
    isWatchAlgoliaSearchEnabled({
      custom: { surface: "floating-search-modal" },
    }),
    readAcceptLanguageHeader(),
  ])

  const resolvedLanguage = resolveSearchLanguage({
    selectedEnglishNames: selectedLanguageEnglishNames,
    explicitSlug: languageSlug,
    routeLanguageSlug,
    acceptLanguage,
    languageOptions,
  })

  if (!flagEnabled || type != null) {
    try {
      const response = await searchVideos(
        truncatedQuery,
        limit,
        offset,
        type,
        resolvedLanguage.locale,
      )
      return {
        ...response,
        results: withResolvedLanguageSlug(response.results, resolvedLanguage),
        ok: true,
        resultSource: "semantic",
        resolvedLanguage,
      }
    } catch (error) {
      return {
        ok: false,
        results: [],
        hasMore: false,
        query: truncatedQuery,
        searchMode: DEFAULT_SEARCH_MODE,
        latencyMs: 0,
        resultSource: "semantic",
        resolvedLanguage,
        error: normalizeSearchError(error),
      }
    }
  }

  const algolia = await searchAlgoliaVideos({
    query: truncatedQuery,
    limit,
    offset,
    languageEnglishNames: selectedLanguageEnglishNames,
  })

  if (!algolia.ok) {
    return {
      ok: false,
      results: [],
      hasMore: false,
      query: algolia.query,
      searchMode: DEFAULT_SEARCH_MODE,
      latencyMs: algolia.latencyMs,
      resultSource: "algolia",
      resolvedLanguage,
      error: algolia.error,
    }
  }

  const preferredLanguage = preferredSearchLanguage({
    languageEnglishNames: selectedLanguageEnglishNames,
    languageOptions,
    resolvedLanguage,
  })
  const results: SearchResult[] = transformAlgoliaVideoHits({
    hits: algolia.hits,
    preferredLanguage,
    languageOptions,
  })

  return {
    ok: true,
    results,
    hasMore: algolia.hasMore,
    query: algolia.query,
    searchMode: DEFAULT_SEARCH_MODE,
    latencyMs: algolia.latencyMs,
    nextOffset: algolia.nextOffset,
    resultSource: "algolia",
    resolvedLanguage,
    languageFacets: algolia.facets.languageEnglishName,
  }
}

function withResolvedLanguageSlug(
  results: readonly SearchResult[],
  resolvedLanguage: { publicSlug: string },
): SearchResult[] {
  if (!isPublicWatchLanguageSlug(resolvedLanguage.publicSlug)) {
    return [...results]
  }
  return results.map((result) =>
    result.type === "video"
      ? {
          ...result,
          languageSlug: result.languageSlug ?? resolvedLanguage.publicSlug,
        }
      : result,
  )
}

async function readAcceptLanguageHeader(): Promise<string | null> {
  try {
    const requestHeaders = await headers()
    return requestHeaders.get("accept-language")
  } catch {
    return null
  }
}

function preferredSearchLanguage({
  languageEnglishNames,
  languageOptions,
  resolvedLanguage,
}: {
  languageEnglishNames: readonly string[]
  languageOptions: readonly SearchLanguageOption[]
  resolvedLanguage: { publicSlug: string; englishName: string | null }
}): SearchLanguageOption | null {
  const selectedLanguage = languageEnglishNames[0]
    ? findSearchLanguageOptionByEnglishName(
        languageEnglishNames[0],
        languageOptions,
      )
    : null
  if (selectedLanguage) return selectedLanguage

  const resolvedOption = languageOptions.find(
    (option) => option.publicSlug === resolvedLanguage.publicSlug,
  )
  if (resolvedOption) return resolvedOption

  if (!resolvedLanguage.englishName) {
    return {
      coreId: null,
      englishName: "English",
      nativeName: null,
      bcp47: "en",
      publicSlug: resolvedLanguage.publicSlug,
      regionNames: [],
    }
  }

  return {
    coreId: null,
    englishName: resolvedLanguage.englishName,
    nativeName: null,
    bcp47: null,
    publicSlug: resolvedLanguage.publicSlug,
    regionNames: [],
  }
}

function normalizeSearchError(error: unknown): SearchError {
  if (error != null) {
    console.error(
      `[watch-search][semantic] ${sanitizeErrorMessage(errorMessage(error))}`,
    )
  }

  const retryAfterSeconds =
    error && typeof error === "object" && "retryAfterSeconds" in error
      ? (error as Partial<SearchError>).retryAfterSeconds
      : undefined
  const safeRetryAfterSeconds =
    typeof retryAfterSeconds === "number" &&
    Number.isFinite(retryAfterSeconds) &&
    retryAfterSeconds >= 0
      ? Math.floor(retryAfterSeconds)
      : undefined

  const safeError: SearchError = {
    code: "SEARCH_ERROR",
    message: "Search request failed",
  }
  if (safeRetryAfterSeconds != null) {
    safeError.retryAfterSeconds = safeRetryAfterSeconds
  }
  return safeError
}

function sanitizeErrorMessage(message: string): string {
  const stripped = message.replace(/[\r\n\t]/g, " ")
  return stripped.length > 200 ? `${stripped.slice(0, 200)}...` : stripped
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  try {
    return JSON.stringify(error)
  } catch {
    return "unknown error"
  }
}
