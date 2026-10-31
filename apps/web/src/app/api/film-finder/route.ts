import type { ServerRuntime } from "next"
import { NextResponse } from "next/server"

import { isWatchAudienceEnabled } from "@/lib/feature-flags"
import {
  admitWatchFilmFinderClient,
  getWatchFilmFinder,
  parseWatchFilmFinderParams,
  WatchFilmFinderInputError,
} from "@/lib/watch-film-finder"

export const runtime: ServerRuntime = "nodejs"
export const dynamic = "force-dynamic"

// Every response is private,no-store: the rollout gate must be evaluated per
// request, and no edge purge is tied to this route. Only the Admin read below
// is shared (unstable_cache in the adapter).
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const
/** Default-off: an unreadable flag is off, so the surface stays dark. */
async function isFinderEnabled(): Promise<boolean> {
  try {
    return await isWatchAudienceEnabled()
  } catch {
    return false
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!(await isFinderEnabled())) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: NO_STORE_HEADERS },
    )
  }
  // Before validation, so malformed requests spend the same budget; after the
  // flag, so a dark surface costs nothing and a rollback needs no limiter state.
  const refused = admitWatchFilmFinderClient(request.headers)
  if (refused) {
    return NextResponse.json(
      { error: "Too many requests. Please try again shortly." },
      {
        status: 429,
        headers: {
          ...NO_STORE_HEADERS,
          "Retry-After": String(refused.retryAfterSeconds),
        },
      },
    )
  }
  try {
    const input = parseWatchFilmFinderParams(new URL(request.url).searchParams)
    const page = await getWatchFilmFinder(input, request.signal)
    return NextResponse.json(page, { headers: NO_STORE_HEADERS })
  } catch (error) {
    if (error instanceof WatchFilmFinderInputError) {
      return NextResponse.json(
        { error: "Invalid film finder filters." },
        { status: 400, headers: NO_STORE_HEADERS },
      )
    }
    console.error("[watch] event=film_finder.fetch.failed")
    return NextResponse.json(
      { error: "Films are temporarily unavailable. Please try again." },
      { status: 503, headers: NO_STORE_HEADERS },
    )
  }
}
