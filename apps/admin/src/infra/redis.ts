import Redis from "ioredis"
import { env } from "@/config/env"

let redisClient: Redis | null | undefined

export function hasRedisConfig(): boolean {
  return Boolean(env.REDIS_HOST && env.REDIS_PORT)
}

export function getRedisClient(): Redis | null {
  if (!hasRedisConfig()) {
    return null
  }

  if (redisClient === undefined) {
    // Keep shared-client behavior unchanged. Admission and readiness bound their
    // own waits and outstanding operations via redis-availability.ts.
    redisClient = new Redis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    })
    redisClient.on("error", (err: Error) =>
      // Plain-string per the Railway logsV2 rule (JSON from runtime routes is
      // silenced). Never include command args / keys.
      console.warn(
        `[redis] event=redis.error message=${err.message} service=forge-admin`,
      ),
    )
  }

  return redisClient
}
