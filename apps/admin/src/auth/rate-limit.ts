import { getRedisClient } from "@/infra/redis"

type RateLimitResult = {
  allowed: boolean
  source: "local" | "redis"
  // Optional so existing rateLimitAuthRoute mocks stay valid; the stricter
  // FixedWindowResult (incrementFixedWindow) always sets it.
  count?: number
}

// The fleet abuse ceiling relies on `count`; incrementFixedWindow guarantees it.
type FixedWindowResult = RateLimitResult & { count: number }

const localWindow = new Map<string, number[]>()

// Per-call timeout for a single Redis command. Deliberately NOT a client-wide
// ioredis `commandTimeout`: the shared client also backs the GraphQL rate-limit
// store, which re-throws in prod — a global timeout would fail every query.
const REDIS_COMMAND_TIMEOUT_MS = 250

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
): FixedWindowResult {
  const now = Date.now()
  const windowStart = now - windowMs
  const attempts = (localWindow.get(key) ?? []).filter((at) => at > windowStart)
  if (attempts.length >= limit) {
    localWindow.set(key, attempts)
    return { allowed: false, source: "local", count: attempts.length }
  }
  attempts.push(now)
  localWindow.set(key, attempts)
  if (localWindow.size > 10_000) {
    for (const [k, v] of localWindow) {
      if (v.every((at) => at <= windowStart)) localWindow.delete(k)
    }
  }
  return { allowed: true, source: "local", count: attempts.length }
}

const INCR_PEXPIRE_LUA =
  "local c = redis.call('INCR', KEYS[1]) if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end return c"

/**
 * Fixed-window counter for a fully-formed `key`. Redis-backed, with an
 * in-process per-replica fallback when Redis is absent OR a single command
 * exceeds REDIS_COMMAND_TIMEOUT_MS. `count` is the post-increment value.
 */
export async function incrementFixedWindow(
  key: string,
  limit: number,
  windowMs: number,
): Promise<FixedWindowResult> {
  const redis = getRedisClient()
  if (!redis) {
    return localLimit(key, limit, windowMs)
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const count = (await Promise.race([
      redis.eval(INCR_PEXPIRE_LUA, 1, key, windowMs),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("redis_command_timeout")),
          REDIS_COMMAND_TIMEOUT_MS,
        )
      }),
    ])) as number
    return { allowed: count <= limit, source: "redis", count }
  } catch (err) {
    // Redis-degraded: fall back to this replica's in-process bucket. Plain-string
    // per the logsV2 rule; log keyPrefix, never the id/ip.
    console.warn(
      `[ratelimit] event=rate_limit.redis_unavailable keyPrefix=${key.split(":")[0]} error=${err instanceof Error ? err.message : String(err)}`,
    )
    return localLimit(key, limit, windowMs)
  } finally {
    if (timer) clearTimeout(timer)
  }
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
  return incrementFixedWindow(
    `${route}:${getClientIp(request)}`,
    limit,
    windowMs,
  )
}

export function resetLocalRateLimitState(): void {
  localWindow.clear()
}
