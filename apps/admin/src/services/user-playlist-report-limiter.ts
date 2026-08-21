import { createHash } from "node:crypto"
import type Redis from "ioredis"
import type {
  UserPlaylistReportLimiter,
  UserPlaylistReportLimiterInput,
} from "./user-playlist-report.service"

type RedisEval = Pick<Redis, "eval">

const ATOMIC_DIMENSION_LIMIT_LUA = `
local admitted = 1
for index = 1, #KEYS do
  local count = redis.call('INCR', KEYS[index])
  if count == 1 then redis.call('PEXPIRE', KEYS[index], ARGV[index * 2]) end
  if count > tonumber(ARGV[index * 2 - 1]) then admitted = 0 end
end
if admitted == 0 then
  for index = 1, #KEYS do redis.call('DECR', KEYS[index]) end
end
return admitted
`

function opaque(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url")
}

/**
 * All abuse dimensions are consumed in one Redis script. Redis absence or a
 * command failure denies the report write; there is no process-local fallback
 * that would multiply ceilings across replicas.
 */
export class RedisUserPlaylistReportLimiter implements UserPlaylistReportLimiter {
  constructor(private readonly redis: RedisEval | null) {}

  async consume(input: UserPlaylistReportLimiterInput): Promise<boolean> {
    if (!this.redis) return false
    const dimensions: Array<{ key: string; max: number; windowMs: number }> = [
      {
        key: `upl-report:intent:${opaque(input.intentDigest)}`,
        max: 1,
        windowMs: 10 * 60_000,
      },
      {
        key: `upl-report:playlist:${opaque(input.playlistId)}`,
        max: 10,
        windowMs: 24 * 60 * 60_000,
      },
      ...(input.ipDigest && !input.coarseIpBucket
        ? [
            {
              key: `upl-report:ip:${opaque(input.ipDigest)}`,
              max: 5,
              windowMs: 60 * 60_000,
            },
          ]
        : []),
      {
        key: `upl-report:global:${input.globalKey}`,
        max: 1_000,
        windowMs: 60_000,
      },
    ]
    try {
      const result = await this.redis.eval(
        ATOMIC_DIMENSION_LIMIT_LUA,
        dimensions.length,
        ...dimensions.map(({ key }) => key),
        ...dimensions.flatMap(({ max, windowMs }) => [max, windowMs]),
      )
      return Number(result) === 1
    } catch {
      return false
    }
  }
}
