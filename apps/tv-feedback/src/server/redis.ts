import Redis from "ioredis"

import { requireConfig } from "./config"

let connection: Redis | undefined

export function redis(): Redis {
  if (!connection) {
    connection = new Redis(requireConfig("REDIS_URL").REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: true,
      lazyConnect: true,
      connectTimeout: 3000,
      commandTimeout: 3000,
    })
    connection.on("error", () => undefined)
  }
  return connection
}

export const key = (kind: string, id: string): string =>
  `tv-feedback:${kind}:${id}`

export async function rateLimit(
  scope: string,
  identity: string,
  limit: number,
  seconds: number,
): Promise<boolean> {
  const result = await redis().eval(
    `local count = redis.call('INCR', KEYS[1])
     if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
     return count <= tonumber(ARGV[2]) and 1 or 0`,
    1,
    key(`rate:${scope}`, identity),
    seconds,
    limit,
  )
  return result === 1
}
