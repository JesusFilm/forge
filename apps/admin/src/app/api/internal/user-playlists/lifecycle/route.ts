import {
  ConsumerLifecycleSignatureError,
  verifyConsumerLifecycleRequest,
} from "@/auth/consumer-lifecycle-signature"
import {
  digestErasedUserPlaylistSubject,
  getUserPlaylistErasureSubjectDigestKey,
} from "@/auth/user-playlist-erasure-bearer"
import { env } from "@/config/env"
import { prisma } from "@/db/client"
import { ConsumerLifecycleIngestionService } from "@/services/consumer-lifecycle-ingestion.service"
import {
  ConsumerLifecycleEventConflictError,
  ConsumerLifecycleService,
  ConsumerLifecycleUnavailableError,
} from "@/services/consumer-lifecycle.service"

export const dynamic = "force-dynamic"

const SIGNED_LIFECYCLE_REQUEST = Symbol("signed-lifecycle-request")

export async function POST(request: Request): Promise<Response> {
  const secret = env.USER_PLAYLIST_LIFECYCLE_HMAC_SECRET
  const digestKey = getUserPlaylistErasureSubjectDigestKey()
  if (!secret || !digestKey) {
    return Response.json({ error: "Unavailable" }, { status: 503 })
  }

  try {
    const event = await verifyConsumerLifecycleRequest(request, { secret })
    const ingestion = new ConsumerLifecycleIngestionService(
      new ConsumerLifecycleService(prisma, {
        erasedSubjectDigest: (ownerSubject) =>
          digestErasedUserPlaylistSubject(ownerSubject, digestKey),
      }),
      {
        assertLifecycleAuthorized(credential: symbol) {
          if (credential !== SIGNED_LIFECYCLE_REQUEST) {
            throw new ConsumerLifecycleSignatureError()
          }
        },
      },
    )
    const result = await ingestion.ingest(event, SIGNED_LIFECYCLE_REQUEST)
    return Response.json(result, {
      status: result.applied ? 201 : 200,
      headers: { "cache-control": "no-store" },
    })
  } catch (error) {
    if (error instanceof ConsumerLifecycleSignatureError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (error instanceof ConsumerLifecycleEventConflictError) {
      return Response.json({ error: "Conflict" }, { status: 409 })
    }
    if (error instanceof ConsumerLifecycleUnavailableError) {
      return Response.json({ error: "Unavailable" }, { status: 409 })
    }
    return Response.json({ error: "Unavailable" }, { status: 503 })
  }
}
