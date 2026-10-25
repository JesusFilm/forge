import { NextResponse } from "next/server"
import { env } from "@/config/env"
import {
  authenticateInteractiveManagerRequest,
  type ManagerInteractiveActor,
} from "@/lib/auth"
import { consumeSeoCsrfToken, issueSeoCsrfToken } from "@/lib/seo-csrf"

export type SeoInteractiveMutation = {
  actor: ManagerInteractiveActor
}

function expectedOrigin(request: Request): string | null {
  if (env.MANAGER_BASE_URL) return new URL(env.MANAGER_BASE_URL).origin
  if (env.NODE_ENV === "production") return null
  return new URL(request.url).origin
}

export async function guardSeoInteractiveMutation(
  request: Request,
): Promise<SeoInteractiveMutation | NextResponse> {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase()
  if (mediaType !== "application/json") {
    return NextResponse.json(
      {
        error: "JSON content type required",
        code: "content_type_required",
      },
      { status: 415 },
    )
  }

  const trustedOrigin = expectedOrigin(request)
  if (!trustedOrigin) {
    return NextResponse.json(
      {
        error: "SEO interactive actions require MANAGER_BASE_URL in production",
        code: "trusted_origin_unavailable",
      },
      { status: 503 },
    )
  }
  if (request.headers.get("origin") !== trustedOrigin) {
    return NextResponse.json(
      { error: "Trusted origin required", code: "origin_rejected" },
      { status: 403 },
    )
  }

  const actor = await authenticateInteractiveManagerRequest(request)
  if (actor instanceof NextResponse) return actor

  const token = request.headers.get("x-seo-csrf-token")
  if (!token) {
    return NextResponse.json(
      { error: "CSRF token required", code: "csrf_required" },
      { status: 403 },
    )
  }
  const csrf = consumeSeoCsrfToken(token, actor.approvedByUserId)
  if (!csrf.ok) {
    return NextResponse.json(
      {
        error: "CSRF token rejected",
        code: `csrf_${csrf.reason}`,
      },
      { status: 403 },
    )
  }

  return { actor }
}

export function seoMutationResponse(
  actor: ManagerInteractiveActor,
  body: Record<string, unknown>,
  init?: ResponseInit,
) {
  return NextResponse.json(
    {
      ...body,
      nextCsrfToken: issueSeoCsrfToken(actor.approvedByUserId),
    },
    init,
  )
}
