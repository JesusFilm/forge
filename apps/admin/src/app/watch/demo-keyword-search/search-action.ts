"use server"

/**
 * Server-side GraphQL proxy for the keyword-search canary.
 *
 * The canary runs in an operator browser, but the search bearer must
 * stay server-side. This action calls Admin's own GraphQL endpoint
 * with a bearer sourced from WEB_ADMIN_API_KEYS, so production canary
 * searches work without copying secrets into the page.
 */

import { headers as nextHeaders } from "next/headers"
import { env } from "@/config/env"
import { executeGraphQL } from "./graphql-client"
import {
  SEARCH_OPERATION,
  type DemoSearchData,
  type SearchResponse,
} from "./search-operation"

type SearchMode = "hybrid" | "keyword-first"

type SearchVariables = {
  q: string
  locale: string
  limit: number
  mode: SearchMode
  debug: boolean
}

export async function searchAdminGraphQL(args: {
  q: string
  locale: string
  limit: number
  mode: SearchMode
}): Promise<SearchResponse> {
  const requestHeaders = await nextHeaders()
  const origin = requestOrigin(requestHeaders)
  const result = await executeGraphQL<DemoSearchData, SearchVariables>(
    SEARCH_OPERATION,
    {
      q: args.q,
      locale: args.locale,
      limit: args.limit,
      mode: args.mode,
      debug: true,
    },
    {
      endpoint: adminGraphQLEndpoint(origin),
      bearerToken: serverSearchBearer(),
      origin,
    },
  )

  if (!result.ok) {
    throw new Error(result.errors.map((e) => e.message).join("; "))
  }
  return result.data.search
}

function serverSearchBearer(): string {
  const token = firstCsvValue(env.WEB_ADMIN_API_KEYS)
  if (!token) {
    throw new Error(
      "demo_search_bearer_not_configured: set WEB_ADMIN_API_KEYS on admin",
    )
  }
  return token
}

function adminGraphQLEndpoint(requestOriginValue: string | null): string {
  const baseUrl = env.ADMIN_BASE_URL ?? requestOriginValue
  if (!baseUrl) {
    throw new Error(
      "demo_search_base_url_not_configured: set ADMIN_BASE_URL on admin",
    )
  }
  return `${baseUrl.replace(/\/+$/, "")}/api/graphql`
}

function requestOrigin(headers: Headers): string | null {
  const explicitOrigin = firstHeaderValue(headers.get("origin"))
  if (explicitOrigin) return explicitOrigin

  const host =
    firstHeaderValue(headers.get("x-forwarded-host")) ??
    firstHeaderValue(headers.get("host"))
  if (!host) return null
  const proto =
    firstHeaderValue(headers.get("x-forwarded-proto")) ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https")
  return `${proto}://${host}`
}

function firstCsvValue(value: string | undefined): string | null {
  return (
    value
      ?.split(",")
      .map((part) => part.trim())
      .find(Boolean) ?? null
  )
}

function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim()
  return first && first.length > 0 ? first : null
}
