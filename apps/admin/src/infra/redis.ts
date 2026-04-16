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
    redisClient = new Redis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    })
    redisClient.on("error", (err: Error) =>
      console.warn(
        JSON.stringify({
          event: "redis.error",
          message: err.message,
          service: "forge-admin",
        }),
      ),
    )
  }

  return redisClient
}
