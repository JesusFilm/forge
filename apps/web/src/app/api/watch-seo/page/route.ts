import { NextResponse } from "next/server"

import { env } from "@/env"
import { verifyAuthSession } from "@/lib/auth-session"
import { fetchWatchSeoAdmin } from "@/lib/watch-seo-admin-client"
import { watchSeoAdminOrigin } from "@/lib/watch-seo-admin-origin"
import { adaptWatchSeoReadModel } from "@/lib/watch-seo-read-model-adapter"

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
  // Accept only the retained Admin contract. A presentation DTO would bypass
  // query-free opportunity projection and source-semantic checks.
  const body = adaptWatchSeoReadModel(upstreamBody)
  if (!body) {
    return new Response(null, { status: 502, headers: PRIVATE_HEADERS })
  }

  const adminOrigin = watchSeoAdminOrigin(
    env.NEXT_PUBLIC_ADMIN_GRAPHQL_URL,
    process.env.NODE_ENV === "production",
  )
  if (!adminOrigin) {
    return new Response(null, { status: 502, headers: PRIVATE_HEADERS })
  }
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
