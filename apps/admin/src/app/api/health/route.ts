import { env } from "@/config/env"
import { getRedisClient } from "@/infra/redis"
import { createRedisOperationGuard } from "@/infra/redis-availability"

const PRELOAD_ENTRIES = Symbol.for("forge.next.preloadEntries")
const probeRedis = createRedisOperationGuard(500, 1)
let readinessProbe: Promise<boolean> | undefined
let graphqlReady: Promise<unknown> | undefined

function isRedisReady(): Promise<boolean> {
  if (!readinessProbe) {
    readinessProbe = probeRedis(async () => {
      const redis = getRedisClient()
      return redis != null && (await redis.ping()) === "PONG"
    })
      .catch(() => false)
      .finally(() => {
        readinessProbe = undefined
      })
  }
  return readinessProbe
}

export async function GET() {
  if (env.NODE_ENV === "production") {
    // The pinned Next patch exposes its existing background preload promise.
    // Keep background entry loading ahead of readiness; preserve preloading.
    const completion = (
      globalThis as typeof globalThis & {
        [PRELOAD_ENTRIES]?: Promise<void>
      }
    )[PRELOAD_ENTRIES]
    if (!completion) {
      return Response.json({ status: "starting" }, { status: 503 })
    }
    await completion
    // Next ignores individual preload failures. GraphQL must initialize before
    // we admit API traffic; importing it performs no operation or mutation.
    await (graphqlReady ??= import("../graphql/route"))
    if (!(await isRedisReady())) {
      return Response.json({ status: "unavailable" }, { status: 503 })
    }
  }
  return Response.json({ status: "ok" }, { status: 200 })
}
