/**
 * POST /api/experience-chat/messages/[messageId]/rating
 * DELETE /api/experience-chat/messages/[messageId]/rating
 *
 * Records a 👍/👎 rating (with optional comment) on a single
 * workflow-generated assistant message, or clears the active user's
 * rating on it.
 *
 * Same rate-limit + auth + permission stack as
 * `apps/admin/src/app/api/experience-chat/stream/route.ts`. Service-
 * thrown typed errors map to clean HTTP status codes via
 * `mapRatingErrorToResponse` so the panel can render targeted UI.
 *
 * The service does ABAC inside (canEditExperienceLocale via the
 * message's thread). The route does a coarse `write:experiences`
 * tier gate beforehand so anonymous + viewer-tier callers are
 * rejected before reaching the DB.
 */

import { z } from "zod"

import { hasPermission } from "@/auth/permissions"
import { rateLimitAuthRoute } from "@/auth/rate-limit"
import { resolvePrincipalFromRequest } from "@/auth/session"
import { prisma } from "@/db/client"
import { getMastra } from "@/mastra"
import {
  clearRating,
  CommentTooLongError,
  ForbiddenError,
  MessageNotFoundError,
  NotRatableError,
  ScoresStoreUnavailableError,
  submitRating,
} from "@/services/chat-rating.service"
import { CHAT_RATING_COMMENT_MAX_LENGTH } from "@/services/chat-rating.constants"

const RATE_LIMIT_MAX = 60
const RATE_LIMIT_WINDOW_MS = 60_000

const BodySchema = z.object({
  score: z.union([z.literal(0), z.literal(1)]),
  comment: z.string().max(CHAT_RATING_COMMENT_MAX_LENGTH).nullable().optional(),
})

function jsonError(status: number, body: unknown): Response {
  return Response.json(body, { status })
}

function mapRatingErrorToResponse(err: unknown): Response {
  if (err instanceof MessageNotFoundError) {
    return jsonError(404, { error: err.message })
  }
  if (err instanceof NotRatableError) {
    return jsonError(422, {
      error: "Message is not ratable.",
      code: "not_ratable",
      producedBy: err.producedBy,
    })
  }
  if (err instanceof ForbiddenError) {
    return jsonError(403, { error: err.message })
  }
  if (err instanceof CommentTooLongError) {
    return jsonError(400, {
      error: `Comment exceeds ${CHAT_RATING_COMMENT_MAX_LENGTH}-char cap.`,
      code: "comment_too_long",
    })
  }
  if (err instanceof ScoresStoreUnavailableError) {
    console.error("[chat-rating] event=scores_store_unavailable", err)
    return jsonError(500, { error: "Rating storage temporarily unavailable." })
  }
  console.error("[chat-rating] event=unexpected_error", err)
  return jsonError(500, { error: "Unexpected error." })
}

type RouteContext = {
  params: { messageId: string } | Promise<{ messageId: string }>
}

async function resolveParams(
  context: RouteContext,
): Promise<{ messageId: string }> {
  const p = context.params
  return p instanceof Promise ? await p : p
}

async function gateRequest(request: Request) {
  const limit = await rateLimitAuthRoute({
    request,
    route: "experience-chat-rating",
    limit: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  })
  if (!limit.allowed) {
    return {
      ok: false as const,
      response: jsonError(429, { error: "Too many requests" }),
    }
  }
  const principal = await resolvePrincipalFromRequest(request)
  if (!principal) {
    return {
      ok: false as const,
      response: jsonError(401, { error: "Unauthorized" }),
    }
  }
  if (!hasPermission(principal, "write:experiences")) {
    return {
      ok: false as const,
      response: jsonError(403, { error: "Forbidden" }),
    }
  }
  return { ok: true as const, principal }
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const gate = await gateRequest(request)
  if (!gate.ok) return gate.response

  const { messageId } = await resolveParams(context)
  if (!messageId) {
    return jsonError(400, { error: "messageId is required" })
  }

  let body: z.infer<typeof BodySchema>
  try {
    const json = await request.json()
    body = BodySchema.parse(json)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(400, {
        error: "Invalid request body",
        issues: error.issues,
      })
    }
    return jsonError(400, { error: "Invalid request body" })
  }

  try {
    const state = await submitRating(
      {
        messageId,
        score: body.score,
        comment: body.comment ?? null,
      },
      { prisma, mastra: getMastra(), principal: gate.principal },
    )
    return Response.json({ rating: state }, { status: 200 })
  } catch (err) {
    return mapRatingErrorToResponse(err)
  }
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const gate = await gateRequest(request)
  if (!gate.ok) return gate.response

  const { messageId } = await resolveParams(context)
  if (!messageId) {
    return jsonError(400, { error: "messageId is required" })
  }

  try {
    const state = await clearRating(
      { messageId },
      { prisma, mastra: getMastra(), principal: gate.principal },
    )
    return Response.json({ rating: state }, { status: 200 })
  } catch (err) {
    return mapRatingErrorToResponse(err)
  }
}
