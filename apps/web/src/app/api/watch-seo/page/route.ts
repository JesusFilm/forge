import { NextResponse } from "next/server"

import { env } from "@/env"
import { verifyAuthSession } from "@/lib/auth-session"
import { fetchWatchSeoAdmin } from "@/lib/watch-seo-admin-client"
import { adaptWatchSeoReadModel } from "@/lib/watch-seo-read-model-adapter"
import { parseWatchSeoMarketingData } from "@/lib/watch-seo-response"

export const dynamic = "force-dynamic"

const PRIVATE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  vary: "Cookie",
}

export async function GET(request: Request): Promise<Response> {
  const session = await verifyAuthSession(request.headers)
  if (!session.authenticated || !session.accessToken) {
    return new Response(null, { status: 404, headers: PRIVATE_HEADERS })
  }

  const url = new URL(request.url)
  const videoSlug = url.searchParams.get("videoSlug")?.trim()
  const locale = url.searchParams.get("locale")?.trim()
  const languageSlug = url.searchParams.get("languageSlug")?.trim()
  const contextualParentSlug =
    url.searchParams.get("contextualParentSlug")?.trim() || null
  if (!videoSlug || !locale || !languageSlug) {
    return new Response(null, { status: 400, headers: PRIVATE_HEADERS })
  }

  const upstreamParams = new URLSearchParams({
    slug: videoSlug,
    language: languageSlug,
  })
  if (contextualParentSlug) upstreamParams.set("parent", contextualParentSlug)
  const response = await fetchWatchSeoAdmin(
    "read-model",
    session.accessToken,
    { method: "GET" },
    upstreamParams,
  )
  if (!response?.ok) {
    return new Response(null, {
      status: response?.status === 429 ? 429 : 404,
      headers: PRIVATE_HEADERS,
    })
  }

  const upstreamBody = await response.json().catch(() => null)
  const body =
    parseWatchSeoMarketingData(upstreamBody) ??
    adaptWatchSeoReadModel(upstreamBody)
  if (!body) {
    return new Response(null, { status: 502, headers: PRIVATE_HEADERS })
  }

  const adminOrigin = new URL(env.ADMIN_GRAPHQL_URL).origin
  return NextResponse.json(
    {
      data: body,
      adminOrigin,
      adminConfirmationUrl: new URL(
        "/dashboard/seo/proposals/confirm",
        adminOrigin,
      ).toString(),
    },
    { headers: PRIVATE_HEADERS },
  )
}
