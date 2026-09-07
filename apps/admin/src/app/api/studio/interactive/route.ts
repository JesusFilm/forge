import { STUDIO_INTERACTIVE_HEADER } from "@forge/studio-contracts/transport"
import { prisma } from "@/db/client"
import { verifyStudioInteractive } from "@/auth/studio-interactive"
import {
  executeStudioInteractive,
  interactiveStudioPrincipal,
} from "@/services/studio-authoring/interactive"
import { ForbiddenError, NotFoundError } from "@/services/errors"
import { StudioCommandError } from "@/services/studio-authoring/errors"
import { StudioSourceError } from "@forge/studio-contracts/sources"
import { ZodError } from "zod"

export async function POST(request: Request) {
  try {
    if (!request.body) return new Response(null, { status: 400 })
    const reader = request.body.getReader()
    let length = 0
    const chunks: Uint8Array[] = []
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.length
        if (length > 524288) {
          await reader.cancel()
          return new Response(null, { status: 413 })
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
    const body = Buffer.concat(chunks).toString("utf8")
    const id = await verifyStudioInteractive(
      request.headers.get(STUDIO_INTERACTIVE_HEADER),
      body,
    )
    const user = await interactiveStudioPrincipal(prisma, id)
    const result = await executeStudioInteractive(
      prisma,
      user,
      JSON.parse(body),
    )
    return Response.json(
      { result },
      { headers: { "cache-control": "no-store" } },
    )
  } catch (error) {
    const status =
      error instanceof ForbiddenError
        ? 403
        : error instanceof NotFoundError
          ? 404
          : error instanceof StudioCommandError && error.code === "CONFLICT"
            ? 409
            : error instanceof StudioSourceError ||
                error instanceof StudioCommandError ||
                error instanceof ZodError ||
                error instanceof SyntaxError
              ? 400
              : 500
    return Response.json(
      {
        error:
          error instanceof StudioSourceError
            ? error.message
            : status === 409
              ? "CONFLICT"
              : status === 403
                ? "FORBIDDEN"
                : status === 404
                  ? "NOT_FOUND"
                  : status === 400
                    ? "INVALID"
                    : "UNAVAILABLE",
      },
      { status, headers: { "cache-control": "no-store" } },
    )
  }
}
