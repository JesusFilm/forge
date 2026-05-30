import { getRedisClient } from "@/infra/redis"

type RateLimitResult = {
  allowed: boolean
  source: "local" | "redis"
}

const localWindow = new Map<string, number[]>()

function getClientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local"
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
  if (localWindow.size > 10_000) {
    for (const [k, v] of localWindow) {
      if (v.every((at) => at <= windowStart)) localWindow.delete(k)
    }
  }
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
    const count = (await redis.eval(
      "local c = redis.call('INCR', KEYS[1]) if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end return c",
      1,
      key,
      windowMs,
    )) as number
    return { allowed: count <= limit, source: "redis" }
  } catch (err) {
    // Redis-degraded: each admin replica falls back to its own
    // in-process bucket. Effective limit becomes (limit × replica
    // count). Emit a WARN-level structured log so operators can
    // detect the degradation in dashboards instead of guessing
    // whether a traffic spike is real or rate-limit fallback.
    // The route handler additionally emits `source: "local"` in its
    // per-request log so the fallback shows up at the request level.
    console.warn(
      JSON.stringify({
        event: "rate_limit.redis_unavailable",
        route,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    return localLimit(key, limit, windowMs)
  }
}

export function resetLocalRateLimitState(): void {
  localWindow.clear()
}
