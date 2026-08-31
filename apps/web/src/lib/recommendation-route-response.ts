import { NextResponse } from "next/server"
import { RecommendationRouteError } from "@/lib/recommendation-route-policy"

export const RECOMMENDATION_PRIVATE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  expires: "0",
} as const

export function recommendationJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: RECOMMENDATION_PRIVATE_HEADERS,
  })
}

export function recommendationSerializedJson(
  body: string,
  status = 200,
): NextResponse {
  return new NextResponse(body, {
    status,
    headers: {
      ...RECOMMENDATION_PRIVATE_HEADERS,
      "content-type": "application/json",
    },
  })
}

export function recommendationError(error: unknown): NextResponse {
  if (error instanceof RecommendationRouteError) {
    return recommendationJson({ error: error.code }, error.status)
  }
  return recommendationJson({ error: "recommendations_unavailable" }, 503)
}
