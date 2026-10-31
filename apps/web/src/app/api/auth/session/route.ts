import type { ServerRuntime } from "next"
import { NextResponse } from "next/server"

import { buildAccountSessionBody } from "@/lib/account-session-response"
import { verifyAuthSession } from "@/lib/auth-session"
import {
  isWatchDownloadAccountGateEnabled,
  watchDownloadAccountGateFlagContext,
} from "@/lib/feature-flags"

export const runtime: ServerRuntime = "nodejs"
export const dynamic = "force-dynamic"

// The global AccountControl reads this state through `/watch/api/bootstrap`;
// this route stays for on-demand callers such as the download session check.
export async function GET(request: Request): Promise<NextResponse> {
  const session = await verifyAuthSession(request.headers)
  const accountGateEnabled = await isWatchDownloadAccountGateEnabled(
    watchDownloadAccountGateFlagContext,
  )

  const body = buildAccountSessionBody({
    request,
    session,
    accountGateEnabled,
  })
  if (!body) {
    return NextResponse.json(
      { error: "Invalid auth destination" },
      { status: 400 },
    )
  }

  return NextResponse.json(body)
}
