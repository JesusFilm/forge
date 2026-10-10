import type { ServerRuntime } from "next"
import { NextResponse } from "next/server"

import { isWatchGlobalBetaTesterCtaEnabled } from "@/lib/feature-flags"

export const runtime: ServerRuntime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate",
} as const

export async function GET(): Promise<NextResponse> {
  try {
    const enabled = await isWatchGlobalBetaTesterCtaEnabled()
    return NextResponse.json({ enabled }, { headers: NO_STORE_HEADERS })
  } catch {
    return NextResponse.json(
      { enabled: false },
      { status: 503, headers: NO_STORE_HEADERS },
    )
  }
}
