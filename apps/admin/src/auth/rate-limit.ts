import Redis from "ioredis"
import { env } from "@/config/env"

type RateLimitResult = {
  allowed: boolean
  source: "local" | "redis"
}

const localWindow = new Map<string, number[]>()
let redisClient: Redis | null | undefined

function getRedisClient(): Redis | null {
  if (
    !env.UPSTASH_REDIS_HOST ||
    !env.UPSTASH_REDIS_PORT ||
    !env.UPSTASH_REDIS_PASSWORD
  ) {
    return null
  }

  if (redisClient === undefined) {
    redisClient = new Redis({
      host: env.UPSTASH_REDIS_HOST,
      port: env.UPSTASH_REDIS_PORT,
      password: env.UPSTASH_REDIS_PASSWORD,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    })
    redisClient.on("error", () => {})
  }

  return redisClient
}

function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local"
  )
}

function localLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now()
  const windowStart = now - windowMs
  const attempts = (localWindow.get(key) ?? []).filter((at) => at > windowStart)
  if (attempts.length >= limit) {
    localWindow.set(key, attempts)
    return { allowed: false, source: "local" }
  }
  attempts.push(now)
  localWindow.set(key, attempts)
  return { allowed: true, source: "local" }
}

export async function rateLimitAuthRoute({
  limit,
  request,
  route,
  windowMs,
}: {
  limit: number
  request: Request
  route: string
  windowMs: number
}): Promise<RateLimitResult> {
  const key = `${route}:${getClientIp(request)}`
  const redis = getRedisClient()

  if (!redis) {
    return localLimit(key, limit, windowMs)
  }

  try {
    if (redis.status === "wait") {
      await redis.connect()
    }
    const count = await redis.incr(key)
    if (count === 1) {
      await redis.pexpire(key, windowMs)
    }
    return { allowed: count <= limit, source: "redis" }
  } catch {
    return localLimit(key, limit, windowMs)
  }
}

export function resetLocalRateLimitState(): void {
  localWindow.clear()
}
