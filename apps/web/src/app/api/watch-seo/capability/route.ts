import { NextResponse } from "next/server"

import { verifyAuthSession } from "@/lib/auth-session"
import { fetchWatchSeoAdmin } from "@/lib/watch-seo-admin-client"

export const dynamic = "force-dynamic"

const PRIVATE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  vary: "Cookie",
}

export async function GET(request: Request): Promise<NextResponse> {
  const session = await verifyAuthSession(request.headers)
  if (!session.authenticated || !session.accessToken) {
    return NextResponse.json(
      { canViewWatchSeo: false },
      { headers: PRIVATE_HEADERS },
    )
  }

  const response = await fetchWatchSeoAdmin("capability", session.accessToken, {
    method: "GET",
  })
  if (response?.status === 429) {
    return NextResponse.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: {
          ...PRIVATE_HEADERS,
          "retry-after": response.headers.get("retry-after") ?? "60",
        },
      },
    )
  }
  if (!response?.ok) {
    return NextResponse.json(
      { canViewWatchSeo: false },
      { headers: PRIVATE_HEADERS },
    )
  }

  const body = (await response.json().catch(() => null)) as {
    canViewWatchSeo?: unknown
  } | null
  return NextResponse.json(
    { canViewWatchSeo: body?.canViewWatchSeo === true },
    { headers: PRIVATE_HEADERS },
  )
}
