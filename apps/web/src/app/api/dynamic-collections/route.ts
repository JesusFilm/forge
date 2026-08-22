import type { ServerRuntime } from "next"
import { NextResponse } from "next/server"

import {
  WATCH_COLLECTION_FEED_MAX_URL_LENGTH,
  normalizeDynamicCollectionFeedInput,
  parseDynamicCollectionFeedPage,
} from "@/lib/dynamic-collection-contract"
import { getDynamicCollectionFeedPage } from "@/lib/dynamic-collection-feed"

export const runtime: ServerRuntime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate",
} as const
const ALLOWED_PARAMETERS = new Set([
  "locale",
  "languageSlug",
  "first",
  "cardsPerParent",
  "after",
  "excludedIds",
  "excludedSlugs",
])

class DynamicCollectionFeedRouteInputError extends Error {
  constructor() {
    super("Invalid collection feed route input")
    this.name = "DynamicCollectionFeedRouteInputError"
  }
}

function oneParameter(params: URLSearchParams, name: string): string {
  const values = params.getAll(name)
  if (values.length !== 1) throw new DynamicCollectionFeedRouteInputError()
  return values[0] ?? ""
}

function optionalParameter(
  params: URLSearchParams,
  name: string,
): string | null {
  const values = params.getAll(name)
  if (values.length > 1) throw new DynamicCollectionFeedRouteInputError()
  return values[0] ?? null
}

function parseRequest(request: Request) {
  const url = new URL(request.url)
  if (
    `${url.pathname}${url.search}`.length >=
    WATCH_COLLECTION_FEED_MAX_URL_LENGTH
  ) {
    throw new DynamicCollectionFeedRouteInputError()
  }
  if (
    [...url.searchParams.keys()].some((key) => !ALLOWED_PARAMETERS.has(key))
  ) {
    throw new DynamicCollectionFeedRouteInputError()
  }

  return normalizeDynamicCollectionFeedInput({
    locale: oneParameter(url.searchParams, "locale"),
    languageSlug: oneParameter(url.searchParams, "languageSlug"),
    first: Number(oneParameter(url.searchParams, "first")),
    cardsPerParent: Number(oneParameter(url.searchParams, "cardsPerParent")),
    after: optionalParameter(url.searchParams, "after"),
    excludedIds: url.searchParams.getAll("excludedIds"),
    excludedSlugs: url.searchParams.getAll("excludedSlugs"),
  })
}

function retryAfterSeconds(value: string | null): string {
  const integerSeconds = value?.match(/^\d+$/) ? Number(value) : Number.NaN
  if (Number.isFinite(integerSeconds)) {
    return String(Math.min(300, Math.max(1, integerSeconds)))
  }

  const dateMs = value ? Date.parse(value) : Number.NaN
  if (Number.isFinite(dateMs)) {
    const seconds = Math.ceil((dateMs - Date.now()) / 1000)
    return String(Math.min(300, Math.max(1, seconds)))
  }
  return "60"
}

function upstreamRateLimitRetryAfter(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null
  const candidate = error as {
    statusCode?: unknown
    response?: {
      status?: unknown
      headers?: { get?: (name: string) => string | null }
    }
  }
  const status = candidate.statusCode ?? candidate.response?.status
  if (status !== 429) return null
  return retryAfterSeconds(
    candidate.response?.headers?.get?.("retry-after") ?? null,
  )
}

export async function GET(request: Request): Promise<NextResponse> {
  let input
  try {
    input = parseRequest(request)
  } catch {
    return NextResponse.json(
      { error: "Invalid collection feed request." },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  try {
    const page = parseDynamicCollectionFeedPage(
      await getDynamicCollectionFeedPage(input),
      input,
    )
    return NextResponse.json(page, { headers: NO_STORE_HEADERS })
  } catch (error) {
    const retryAfter = upstreamRateLimitRetryAfter(error)
    if (retryAfter) {
      return NextResponse.json(
        { error: "Too many collection feed requests." },
        {
          status: 429,
          headers: { ...NO_STORE_HEADERS, "Retry-After": retryAfter },
        },
      )
    }

    console.error("[watch] event=dynamic_collection_feed.fetch.failed")
    return NextResponse.json(
      { error: "Collections are temporarily unavailable." },
      { status: 503, headers: NO_STORE_HEADERS },
    )
  }
}
