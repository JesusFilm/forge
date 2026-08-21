import { z } from "zod"

import {
  getUserPlaylistErasureSubjectDigestKey,
  isValidUserPlaylistErasureBearer,
} from "@/auth/user-playlist-erasure-bearer"
import { prisma } from "@/db/client"
import {
  UserPlaylistErasureConfigurationError,
  UserPlaylistErasureConflictError,
  UserPlaylistErasureService,
} from "@/services/user-playlist-erasure.service"

export const dynamic = "force-dynamic"

const ERASURE_CREDENTIAL = Symbol("user-playlist-erasure")
const bodySchema = z
  .object({
    ownerSubject: z.string().min(1).max(255).regex(/^\S+$/),
    lifecycleVersion: z.string().regex(/^(0|[1-9]\d*)$/),
    idempotencyKey: z
      .string()
      .min(8)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  })
  .strict()

export async function POST(request: Request): Promise<Response> {
  if (!isValidUserPlaylistErasureBearer(request.headers.get("authorization"))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const digestKey = getUserPlaylistErasureSubjectDigestKey()
  if (!digestKey) {
    return Response.json({ error: "Unavailable" }, { status: 503 })
  }

  let parsed: z.infer<typeof bodySchema>
  try {
    const body = await request.json()
    const result = bodySchema.safeParse(body)
    if (!result.success) {
      return Response.json({ error: "Invalid request" }, { status: 400 })
    }
    parsed = result.data
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 })
  }

  try {
    const service = new UserPlaylistErasureService(prisma, {
      subjectDigestKey: digestKey,
      authorizer: {
        assertErasureAuthorized(credential: symbol) {
          if (credential !== ERASURE_CREDENTIAL) {
            throw new UserPlaylistErasureConflictError()
          }
        },
      },
    })
    const receipt = await service.erase(
      {
        ownerSubject: parsed.ownerSubject,
        lifecycleVersion: BigInt(parsed.lifecycleVersion),
        idempotencyKey: parsed.idempotencyKey,
      },
      ERASURE_CREDENTIAL,
    )
    return Response.json(
      {
        receiptId: receipt.receiptId,
        idempotencyKey: receipt.idempotencyKey,
        lifecycleVersion: receipt.lifecycleVersion.toString(),
        erasedCount: receipt.erasedCount,
        createdAt: receipt.createdAt.toISOString(),
      },
      { headers: { "cache-control": "no-store" } },
    )
  } catch (error) {
    if (error instanceof UserPlaylistErasureConflictError) {
      return Response.json({ error: "Conflict" }, { status: 409 })
    }
    if (error instanceof UserPlaylistErasureConfigurationError) {
      return Response.json({ error: "Unavailable" }, { status: 503 })
    }
    return Response.json({ error: "Unavailable" }, { status: 503 })
  }
}
