import { isValidConsumerBearer } from "@/auth/consumer-bearer"
import { prisma } from "@/db/client"
import { WatchRouteManifestStore } from "@/services/watch-route-manifest-store"

const CACHE_CONTROL = "private, max-age=0, must-revalidate"

function unauthorized(): Response {
  return Response.json(
    { error: "Authorization required" },
    {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="watch-route-manifest"' },
    },
  )
}

export async function GET(request: Request): Promise<Response> {
  if (!isValidConsumerBearer(request.headers.get("authorization")).valid) {
    return unauthorized()
  }

  const store = new WatchRouteManifestStore(prisma)

  try {
    const snapshot = await store.getLatest()
    if (!snapshot) {
      return Response.json(
        {
          error: "Watch route manifest unavailable",
          reason: "missing_snapshot",
        },
        {
          status: 503,
          headers: { "Cache-Control": "private, no-store" },
        },
      )
    }

    const etag = `"${snapshot.version}"`
    const headers = {
      "Cache-Control": CACHE_CONTROL,
      ETag: etag,
    }

    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers })
    }

    return Response.json(snapshot.payload, { status: 200, headers })
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "watch_route_manifest.read.failed",
        detail:
          error instanceof Error ? error.message.slice(0, 500) : String(error),
      }),
    )
    return Response.json(
      {
        error: "Watch route manifest read failed",
        reason: "read_failed",
      },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    )
  }
}
