import { NextResponse } from "next/server"
import {
  buildSubtitleReviewCorsHeaders,
  getSubtitleReviewConfiguration,
} from "@/lib/subtitle-review-session"
import type { SubtitleReviewFailureReason } from "@/services/subtitleReview"

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
}

export function noStoreJson(
  body: Record<string, unknown>,
  init?: ResponseInit,
): NextResponse {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...NO_STORE_HEADERS,
      ...init?.headers,
    },
  })
}

export function requireSubtitleReviewConfigurationResponse(init?: {
  cors?: Record<string, string>
}): NextResponse | null {
  const configuration = getSubtitleReviewConfiguration()
  if (configuration.ok) {
    return null
  }

  return noStoreJson(
    {
      error: "subtitle_review_not_configured",
      missing: configuration.missing,
    },
    {
      status: 503,
      headers: init?.cors,
    },
  )
}

export function requireEditorCorsHeaders(request: Request): Response | null {
  const headers = buildSubtitleReviewCorsHeaders(request.headers.get("origin"))
  const configurationError = requireSubtitleReviewConfigurationResponse({
    cors: headers ?? { Vary: "Origin" },
  })
  if (configurationError) {
    return configurationError
  }

  if (headers) {
    return null
  }

  return NextResponse.json(
    { error: "Forbidden origin" },
    {
      status: 403,
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Origin",
      },
    },
  )
}

export function corsHeaders(request: Request): Record<string, string> {
  return (
    buildSubtitleReviewCorsHeaders(request.headers.get("origin")) ?? {
      Vary: "Origin",
    }
  )
}

export function preflightResponse(request: Request): Response {
  const headers = buildSubtitleReviewCorsHeaders(request.headers.get("origin"))
  const configuration = getSubtitleReviewConfiguration()
  if (!configuration.ok) {
    return new Response(null, {
      status: 503,
      headers: {
        ...NO_STORE_HEADERS,
        ...(headers ?? { Vary: "Origin" }),
      },
    })
  }

  if (!headers) {
    return new Response(null, {
      status: 403,
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Origin",
      },
    })
  }

  return new Response(null, {
    status: 204,
    headers: {
      ...NO_STORE_HEADERS,
      ...headers,
    },
  })
}

export function failureResponse(
  reason: SubtitleReviewFailureReason,
  init?: { latestArtifactKey?: string; cors?: Record<string, string> },
): NextResponse {
  const statusByReason: Record<SubtitleReviewFailureReason, number> = {
    job_not_found: 404,
    artifact_not_found: 404,
    invalid_artifact: 400,
    invalid_launch: 401,
    invalid_token: 401,
    missing_playback: 422,
    invalid_vtt: 422,
    rate_limited: 429,
    stale_base: 409,
    persist_failed: 500,
  }

  return noStoreJson(
    {
      error: reason,
      ...(init?.latestArtifactKey
        ? { latestArtifactKey: init.latestArtifactKey }
        : {}),
    },
    {
      status: statusByReason[reason],
      headers: init?.cors,
    },
  )
}

export function readBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization")
  if (!header?.startsWith("Bearer ")) {
    return null
  }
  return header.slice("Bearer ".length)
}
