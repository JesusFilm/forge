import { NextResponse } from "next/server"
import { graphql } from "@forge/graphql"
import { authenticateRequest } from "@/lib/auth"
import getClient from "@/cms/client"
import {
  type PageInfo,
  DEFAULT_PAGE_INFO,
  fetchAllPages,
} from "@/lib/strapi-pagination"

// ---------------------------------------------------------------------------
// Typed queries
// ---------------------------------------------------------------------------

const GET_CONTINENTS = graphql(`
  query GetContinentsApi {
    continents {
      documentId
      coreId
      name
    }
  }
`)

const GET_COUNTRIES_CONNECTION = graphql(`
  query GetCountriesApi($pagination: PaginationArg) {
    countries_connection(pagination: $pagination) {
      nodes {
        documentId
        coreId
        name
        continent {
          coreId
        }
      }
      pageInfo {
        page
        pageCount
        pageSize
        total
      }
    }
  }
`)

const GET_LANGUAGES_CONNECTION = graphql(`
  query GetLanguagesApi($pagination: PaginationArg) {
    languages_connection(pagination: $pagination) {
      nodes {
        documentId
        coreId
        name
      }
      pageInfo {
        page
        pageCount
        pageSize
        total
      }
    }
  }
`)

const GET_COUNTRY_LANGUAGES_CONNECTION = graphql(`
  query GetCountryLanguagesApi($pagination: PaginationArg) {
    countryLanguages_connection(pagination: $pagination) {
      nodes {
        documentId
        coreId
        speakers
        language {
          coreId
        }
        country {
          coreId
          continent {
            coreId
          }
        }
      }
      pageInfo {
        page
        pageCount
        pageSize
        total
      }
    }
  }
`)

// ---------------------------------------------------------------------------
// In-memory cache (geo data changes only on core sync)
// ---------------------------------------------------------------------------

let cachedPayload: string | null = null
let cachedAt = 0
let refreshPromise: Promise<void> | null = null
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

async function doRefreshCache(): Promise<void> {
  try {
    const client = getClient()

    const [
      continentsResult,
      countryNodes,
      languageNodes,
      countryLanguageNodes,
    ] = await Promise.all([
      client.query({ query: GET_CONTINENTS, fetchPolicy: "no-cache" }),
      fetchAllPages(async (page) => {
        const result = await client.query({
          query: GET_COUNTRIES_CONNECTION,
          variables: { pagination: { page, pageSize: 5000 } },
          fetchPolicy: "no-cache",
        })
        const conn = result.data?.countries_connection
        return {
          nodes: conn?.nodes ?? [],
          pageInfo: (conn?.pageInfo ?? DEFAULT_PAGE_INFO) as PageInfo,
        }
      }),
      fetchAllPages(async (page) => {
        const result = await client.query({
          query: GET_LANGUAGES_CONNECTION,
          variables: { pagination: { page, pageSize: 5000 } },
          fetchPolicy: "no-cache",
        })
        const conn = result.data?.languages_connection
        return {
          nodes: conn?.nodes ?? [],
          pageInfo: (conn?.pageInfo ?? DEFAULT_PAGE_INFO) as PageInfo,
        }
      }),
      fetchAllPages(async (page) => {
        const result = await client.query({
          query: GET_COUNTRY_LANGUAGES_CONNECTION,
          variables: { pagination: { page, pageSize: 5000 } },
          fetchPolicy: "no-cache",
        })
        const conn = result.data?.countryLanguages_connection
        return {
          nodes: conn?.nodes ?? [],
          pageInfo: (conn?.pageInfo ?? DEFAULT_PAGE_INFO) as PageInfo,
        }
      }),
    ])

    const continents = (continentsResult.data?.continents ?? [])
      .filter((c): c is NonNullable<typeof c> => c != null)
      .map((c) => ({
        id: String(c.coreId ?? c.documentId),
        name: String(c.name ?? ""),
      }))

    const countries = countryNodes.map((c) => ({
      id: String(c.coreId ?? c.documentId),
      name: String(c.name ?? ""),
      continentId: String(c.continent?.coreId ?? ""),
    }))

    const langCountryIds = new Map<string, Set<string>>()
    const langContinentIds = new Map<string, Set<string>>()
    const langCountrySpeakers = new Map<string, Record<string, number>>()

    for (const cl of countryLanguageNodes) {
      const langId = String(cl.language?.coreId ?? "")
      const countryId = String(cl.country?.coreId ?? "")
      const continentId = String(cl.country?.continent?.coreId ?? "")
      const speakers = cl.speakers ?? 0

      if (!langId) continue

      if (!langCountryIds.has(langId)) langCountryIds.set(langId, new Set())
      if (countryId) langCountryIds.get(langId)!.add(countryId)

      if (!langContinentIds.has(langId)) langContinentIds.set(langId, new Set())
      if (continentId) langContinentIds.get(langId)!.add(continentId)

      if (!langCountrySpeakers.has(langId)) langCountrySpeakers.set(langId, {})
      if (countryId && speakers > 0) {
        const existing = langCountrySpeakers.get(langId)!
        existing[countryId] = (existing[countryId] ?? 0) + speakers
      }
    }

    const languages = languageNodes.map((l) => {
      const id = String(l.coreId ?? l.documentId)
      return {
        id,
        englishLabel: String(l.name ?? id),
        nativeLabel: String(l.name ?? id),
        countryIds: Array.from(langCountryIds.get(id) ?? []),
        continentIds: Array.from(langContinentIds.get(id) ?? []),
        countrySpeakers: langCountrySpeakers.get(id) ?? {},
      }
    })

    cachedPayload = JSON.stringify({ continents, countries, languages })
    cachedAt = Date.now()
  } catch (error) {
    console.error("[api/languages] Background refresh failed:", error)
  }
}

async function refreshCache(): Promise<void> {
  if (refreshPromise) return refreshPromise
  refreshPromise = doRefreshCache().finally(() => {
    refreshPromise = null
  })
  return refreshPromise
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const isStale = !cachedPayload || Date.now() - cachedAt >= CACHE_TTL_MS

  // Return cached response immediately, refresh in background if stale
  if (cachedPayload) {
    if (isStale) void refreshCache()
    return new Response(cachedPayload, {
      headers: { "Content-Type": "application/json" },
    })
  }

  // No cache yet — must wait for first fetch
  await refreshCache()

  if (!cachedPayload) {
    return NextResponse.json(
      { error: "Failed to fetch language data" },
      { status: 502 },
    )
  }

  return new Response(cachedPayload, {
    headers: { "Content-Type": "application/json" },
  })
}
