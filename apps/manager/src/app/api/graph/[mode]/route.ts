import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"
import { env } from "@/config/env"

const VALID_MODES = new Set([
  "hierarchy",
  "scene-similarity",
  "video-similarity",
  "tags",
])

// Forwarded query params per mode. Unknown params are dropped.
const ALLOWED_PARAMS: Record<string, ReadonlyArray<string>> = {
  hierarchy: ["originId", "limit"],
  "scene-similarity": ["videoId", "limit", "knn", "threshold"],
  "video-similarity": ["limit", "knn", "threshold"],
  tags: ["bcp47", "limit"],
}

export async function GET(
  request: Request,
  context: { params: Promise<{ mode: string }> },
) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  const { mode } = await context.params
  if (!VALID_MODES.has(mode)) {
    return NextResponse.json(
      { error: `Unknown graph mode: ${mode}` },
      { status: 404 },
    )
  }

  const incoming = new URL(request.url)
  const forwarded = new URLSearchParams()
  for (const key of ALLOWED_PARAMS[mode] ?? []) {
    const v = incoming.searchParams.get(key)
    if (v) forwarded.set(key, v)
  }
  const qs = forwarded.toString()
  const cmsUrl = `${env.STRAPI_URL}/api/graph/${mode}${qs ? `?${qs}` : ""}`

  try {
    const response = await fetch(cmsUrl, {
      headers: { Authorization: `Bearer ${env.STRAPI_API_TOKEN}` },
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) {
      const body = await response.text()
      console.error(
        `[api/graph/${mode}] CMS returned ${response.status}: ${body.slice(0, 500)}`,
      )
      return NextResponse.json(
        { error: `CMS /api/graph/${mode} returned ${response.status}` },
        { status: 502 },
      )
    }

    const payload = await response.json()
    return NextResponse.json(payload)
  } catch (err) {
    console.error(
      `[api/graph/${mode}] Failed to fetch:`,
      err instanceof Error ? err.message : err,
    )
    return NextResponse.json(
      { error: "Failed to load graph data" },
      { status: 502 },
    )
  }
}
