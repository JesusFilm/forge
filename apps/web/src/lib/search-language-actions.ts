"use server"

import { headers } from "next/headers"
import { adminGraphql } from "@forge/admin-graphql"

import client from "@/lib/admin-client"

import { isWatchAlgoliaSearchEnabled } from "./feature-flags"
import {
  parseAcceptLanguage,
  publicWatchAudioLanguageSlugForLocale,
} from "./locale"
import {
  buildSearchLanguageOptions,
  type SearchLanguageCountrySuggestion,
  type SearchLanguageMetadataCountry,
  type SearchLanguageMetadataLanguage,
  type SearchLanguageOption,
} from "./search-language"

const SEARCH_LANGUAGE_METADATA_QUERY = adminGraphql(`
  query SearchLanguageMetadata(
    $languageLimit: Int
    $languageOffset: Int
    $countryLimit: Int
    $countryOffset: Int
  ) {
    languages(limit: $languageLimit, offset: $languageOffset) {
      id
      coreId
      name
      bcp47
      slug
    }
    countries(limit: $countryLimit, offset: $countryOffset) {
      id
      coreId
      name
      flagPngSrc
      continent {
        id
        name
      }
      countryLanguages {
        id
        speakers
        primary
        suggested
        order
        language {
          id
          coreId
          name
          bcp47
          slug
        }
      }
    }
  }
`)

type SearchLanguageMetadata = {
  languages: SearchLanguageMetadataLanguage[]
  countries: SearchLanguageMetadataCountry[]
}

const PAGE_SIZE = 500
const MAX_LANGUAGE_PAGES = 10
const SEARCH_LANGUAGE_METADATA_CACHE_TTL_SECONDS = 5 * 60

let cachedSearchLanguageMetadata: {
  expiresAt: number
  metadata: SearchLanguageMetadata
} | null = null
let pendingSearchLanguageMetadata: Promise<SearchLanguageMetadata> | null = null

export async function getSearchLanguageOptions(
  input: {
    availableLanguageFacets?: Record<string, number>
  } = {},
): Promise<
  | {
      ok: true
      algoliaEnabled: boolean
      options: SearchLanguageOption[]
      countrySuggestion: SearchLanguageCountrySuggestion | null
      recommendedLanguage: SearchLanguageOption | null
      countryCode: string | null
      countryName: string | null
    }
  | {
      ok: false
      algoliaEnabled: boolean
      options: []
      countrySuggestion: null
      recommendedLanguage: null
      countryCode: string | null
      countryName: string | null
      error: {
        code: "SEARCH_LANGUAGE_METADATA_ERROR"
        message: string
      }
    }
> {
  const [algoliaEnabled, requestHeaders] = await Promise.all([
    isWatchAlgoliaSearchEnabled({
      custom: { surface: "floating-search-modal" },
    }),
    readRequestHeaders(),
  ])
  const countryCode = readCountryCode(requestHeaders)
  const acceptLanguage = requestHeaders?.get("accept-language") ?? null
  const countryName = countryCode ? countryNameFromCode(countryCode) : null

  try {
    const metadata = await fetchCachedSearchLanguageMetadata()
    const result = buildSearchLanguageOptions({
      languages: metadata.languages,
      countries: metadata.countries,
      availableLanguageFacets: input.availableLanguageFacets,
      countryCode,
      countryName,
    })

    return {
      ok: true,
      algoliaEnabled,
      options: result.options,
      countrySuggestion: result.countrySuggestion,
      recommendedLanguage: recommendedLanguageOption({
        options: result.options,
        acceptLanguage,
      }),
      countryCode,
      countryName,
    }
  } catch (error) {
    console.error(
      `[watch-search][language-metadata] ${sanitizeErrorMessage(error)}`,
    )
    return {
      ok: false,
      algoliaEnabled,
      options: [],
      countrySuggestion: null,
      recommendedLanguage: null,
      countryCode,
      countryName,
      error: {
        code: "SEARCH_LANGUAGE_METADATA_ERROR",
        message: "Language options are temporarily unavailable.",
      },
    }
  }
}

async function fetchSearchLanguageMetadataUncached(): Promise<SearchLanguageMetadata> {
  const languages: SearchLanguageMetadataLanguage[] = []
  let countries: SearchLanguageMetadataCountry[] = []

  for (let page = 0; page < MAX_LANGUAGE_PAGES; page += 1) {
    const result = await client.query({
      query: SEARCH_LANGUAGE_METADATA_QUERY,
      variables: {
        languageLimit: PAGE_SIZE,
        languageOffset: page * PAGE_SIZE,
        countryLimit: page === 0 ? PAGE_SIZE : 0,
        countryOffset: 0,
      },
      fetchPolicy: "no-cache",
    })

    if (result.error) {
      throw result.error
    }

    const pageLanguages = compact(result.data?.languages)
    languages.push(...pageLanguages)

    if (page === 0) {
      countries = compact(result.data?.countries)
    }

    if (pageLanguages.length < PAGE_SIZE) break
  }

  return {
    languages,
    countries,
  }
}

async function fetchCachedSearchLanguageMetadata(): Promise<SearchLanguageMetadata> {
  if (process.env.NODE_ENV === "test") {
    return fetchSearchLanguageMetadataUncached()
  }

  const now = Date.now()
  if (
    cachedSearchLanguageMetadata &&
    cachedSearchLanguageMetadata.expiresAt > now
  ) {
    return cachedSearchLanguageMetadata.metadata
  }

  if (!pendingSearchLanguageMetadata) {
    pendingSearchLanguageMetadata = fetchSearchLanguageMetadataUncached()
      .then((metadata) => {
        cachedSearchLanguageMetadata = {
          expiresAt:
            Date.now() + SEARCH_LANGUAGE_METADATA_CACHE_TTL_SECONDS * 1000,
          metadata,
        }
        return metadata
      })
      .finally(() => {
        pendingSearchLanguageMetadata = null
      })
  }

  return pendingSearchLanguageMetadata
}

function compact<T>(
  values: readonly (T | null | undefined)[] | null | undefined,
): T[] {
  if (!Array.isArray(values)) return []
  return values.filter((value): value is T => value != null)
}

async function readRequestHeaders(): Promise<Headers | null> {
  try {
    return await headers()
  } catch {
    return null
  }
}

function readCountryCode(requestHeaders: Headers | null): string | null {
  return normalizeCountryCode(
    requestHeaders?.get("x-vercel-ip-country") ??
      requestHeaders?.get("cf-ipcountry") ??
      requestHeaders?.get("x-country-code") ??
      null,
  )
}

function recommendedLanguageOption({
  options,
  acceptLanguage,
}: {
  options: readonly SearchLanguageOption[]
  acceptLanguage: string | null
}): SearchLanguageOption | null {
  const locale = parseAcceptLanguage(acceptLanguage)
  const publicSlug = locale
    ? publicWatchAudioLanguageSlugForLocale(locale)
    : "english"
  return (
    options.find((option) => option.publicSlug === publicSlug) ??
    options.find((option) => option.publicSlug === "english") ??
    null
  )
}

function normalizeCountryCode(value: string | null): string | null {
  const normalized = value?.trim().toUpperCase()
  return normalized && /^[A-Z]{2}$/.test(normalized) ? normalized : null
}

function countryNameFromCode(countryCode: string): string | null {
  try {
    return (
      new Intl.DisplayNames(["en"], { type: "region" }).of(countryCode) ?? null
    )
  } catch {
    return null
  }
}

function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown error"
  const stripped = message.replace(/[\r\n\t]/g, " ")
  return stripped.length > 200 ? `${stripped.slice(0, 200)}...` : stripped
}
