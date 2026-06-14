// Shared Shorts Studio config gate. The create, render, and retry routes all
// refuse to launch workflows when the shorts-worker env pair is unset — one
// definition keeps the 503 config_missing envelope identical across routes
// (it previously lived as a verbatim copy in each route).

import { NextResponse } from "next/server"
import { env } from "@/config/env"

function getMissingShortsConfig(): string[] {
  const missing: string[] = []
  if (!env.SHORTS_WORKER_BASE_URL) missing.push("SHORTS_WORKER_BASE_URL")
  if (!env.SHORTS_WORKER_API_KEY) missing.push("SHORTS_WORKER_API_KEY")
  return missing
}

// Returns the 503 config_missing response when Shorts Studio is not
// configured on this Manager deployment, or null when the route may proceed.
export function requireShortsWorkerConfig(): NextResponse | null {
  const missingConfig = getMissingShortsConfig()
  if (missingConfig.length === 0) {
    return null
  }

  return NextResponse.json(
    {
      error: "Shorts Studio is not configured on this Manager deployment",
      reason: "config_missing",
      messages: [`Missing env vars: ${missingConfig.join(", ")}`],
      retryable: false,
    },
    { status: 503 },
  )
}
