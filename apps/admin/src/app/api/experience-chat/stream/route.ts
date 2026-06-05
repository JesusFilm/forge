/**
 * POST /api/experience-chat/stream — server-sent-events endpoint that
 * streams a single chat turn's `token_delta` / `brief_update` /
 * `mutation_proposal` / `mutation_applied` / `error` / `done` events
 * to the experience-editor chat panel.
 *
 * Wire format (matches the U4 client expectation): each event becomes
 * a frame of the form
 *
 *   event: <type>\n
 *   data: <JSON of full event object minus the type>\n
 *   \n
 *
 * The `event:` field is the discriminator the client switches on; the
 * `data:` payload is the rest of the event object (so the client never
 * has to re-derive the discriminator from the body).
 */

import { z } from "zod"

import { rateLimitAuthRoute } from "@/auth/rate-limit"
import { resolvePrincipalFromRequest } from "@/auth/session"
import { hasPermission } from "@/auth/permissions"
import { prisma } from "@/db/client"
import {
  streamChatTurn,
  type ChatStreamEvent,
} from "@/services/experience-ai/experience-ai-chat.service"

const RATE_LIMIT_MAX = 30
const RATE_LIMIT_WINDOW_MS = 60_000

const Body = z.object({
  threadId: z.string().min(1),
  prompt: z.string().min(1).max(10_000),
  confirmedAcrossLocales: z.boolean().optional(),
  confirmedBrief: z.boolean().optional(),
})

function jsonError(status: number, body: unknown): Response {
  return Response.json(body, { status })
}

function encodeSseFrame(event: ChatStreamEvent): string {
  const { type, ...rest } = event
  return `event: ${type}\ndata: ${JSON.stringify(rest)}\n\n`
}

export async function POST(request: Request): Promise<Response> {
  const limit = await rateLimitAuthRoute({
    request,
    route: "experience-chat",
    limit: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  })
  if (!limit.allowed) {
    return jsonError(429, { error: "Too many requests" })
  }

  const principal = await resolvePrincipalFromRequest(request)
  if (!principal) {
    return jsonError(401, { error: "Unauthorized" })
  }

  // Coarse tier gate. Per-locale ABAC happens inside `streamChatTurn`.
  if (!hasPermission(principal, "write:experiences")) {
    return jsonError(403, { error: "Forbidden" })
  }

  let parsedBody
  try {
    const json = await request.json()
    parsedBody = Body.parse(json)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(400, {
        error: "Invalid request body",
        issues: error.issues,
      })
    }
    return jsonError(400, { error: "Invalid request body" })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const iter = streamChatTurn(
        {
          threadId: parsedBody.threadId,
          prompt: parsedBody.prompt,
          confirmedAcrossLocales: parsedBody.confirmedAcrossLocales,
          confirmedBrief: parsedBody.confirmedBrief,
        },
        {
          prisma,
          user: principal,
          abortSignal: request.signal,
        },
      )

      try {
        for await (const event of iter) {
          if (request.signal.aborted) break
          controller.enqueue(encoder.encode(encodeSseFrame(event)))
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "stream error"
        controller.enqueue(
          encoder.encode(
            encodeSseFrame({
              type: "error",
              code: "unknown",
              message,
            }),
          ),
        )
      } finally {
        controller.close()
      }
    },
    cancel() {
      // The ReadableStream cancel hook fires when the consumer aborts.
      // The service's abortSignal is wired to request.signal already, so
      // SIGTERM-to-codex propagates through that path; nothing extra
      // needs doing here.
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  })
}
