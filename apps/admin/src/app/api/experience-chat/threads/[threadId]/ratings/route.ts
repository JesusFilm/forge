/**
 * GET /api/experience-chat/threads/[threadId]/ratings
 *
 * Returns the active user's current ratings for every ratable
 * assistant message in the thread. Called by the chat panel on mount
 * to seed `<ChatRating>` widgets with prior ratings.
 *
 * Same auth + rate-limit shape as the rating write routes; uses a
 * separate rate-limit bucket so read-side polling does not starve
 * write quota.
 */

import { rateLimitAuthRoute } from "@/auth/rate-limit"
import { resolvePrincipalFromRequest } from "@/auth/session"
import { hasPermission } from "@/auth/permissions"
import { prisma } from "@/db/client"
import { getMastra } from "@/mastra"
import {
  ForbiddenError,
  ScoresStoreUnavailableError,
  listRatingsForThread,
} from "@/services/chat-rating.service"

const RATE_LIMIT_MAX = 30
const RATE_LIMIT_WINDOW_MS = 60_000

function jsonError(status: number, body: unknown): Response {
  return Response.json(body, { status })
}

type RouteContext = {
  params: { threadId: string } | Promise<{ threadId: string }>
}

async function resolveParams(
  context: RouteContext,
): Promise<{ threadId: string }> {
  const p = context.params
  return p instanceof Promise ? await p : p
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const limit = await rateLimitAuthRoute({
    request,
    route: "experience-chat-rating-read",
    limit: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  })
  if (!limit.allowed) return jsonError(429, { error: "Too many requests" })

  const principal = await resolvePrincipalFromRequest(request)
  if (!principal) return jsonError(401, { error: "Unauthorized" })
  if (!hasPermission(principal, "write:experiences")) {
    return jsonError(403, { error: "Forbidden" })
  }

  const { threadId } = await resolveParams(context)
  if (!threadId) {
    return jsonError(400, { error: "threadId is required" })
  }

  try {
    const ratings = await listRatingsForThread(
      { threadId },
      { prisma, mastra: getMastra(), principal },
    )
    return Response.json({ ratings }, { status: 200 })
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return jsonError(403, { error: err.message })
    }
    if (err instanceof ScoresStoreUnavailableError) {
      console.error("[chat-rating] event=scores_store_unavailable", err)
      return jsonError(500, {
        error: "Rating storage temporarily unavailable.",
      })
    }
    console.error("[chat-rating] event=unexpected_error", err)
    return jsonError(500, { error: "Unexpected error." })
  }
}
