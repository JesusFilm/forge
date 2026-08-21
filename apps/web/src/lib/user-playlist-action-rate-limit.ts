import { createHash } from "node:crypto"
import { createClient } from "redis"

export type UserPlaylistIngressAction = "read" | "write" | "share" | "reveal"
export type UserPlaylistIngressDecision = "admitted" | "limited" | "unavailable"

export type UserPlaylistIngressInput = {
  action: UserPlaylistIngressAction
  subject: string
  viewerIp: string | null
  now: Date
}

export interface UserPlaylistActionLimiter {
  consume(input: UserPlaylistIngressInput): Promise<UserPlaylistIngressDecision>
}

type EvalClient = {
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>
}

type EvalClientProvider = () => Promise<EvalClient | null>

const ATOMIC_FIXED_WINDOW_LUA = `
local admitted = 1
for index = 1, #KEYS do
  local count = redis.call('INCR', KEYS[index])
  if count == 1 then redis.call('PEXPIRE', KEYS[index], ARGV[index * 2]) end
  if count > tonumber(ARGV[index * 2 - 1]) then admitted = 0 end
end
return admitted
`

const SUBJECT_LIMITS: Record<
  UserPlaylistIngressAction,
  { max: number; windowMs: number }
> = {
  read: { max: 120, windowMs: 60_000 },
  write: { max: 20, windowMs: 60_000 },
  share: { max: 20, windowMs: 60_000 },
  reveal: { max: 10, windowMs: 60_000 },
}

function opaque(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url")
}

function fixedWindowKey(prefix: string, now: Date, windowMs: number): string {
  return `${prefix}:${Math.floor(now.getTime() / windowMs)}`
}

/** Shared-storage ingress control. Missing Redis and command failures deny. */
export class RedisUserPlaylistActionLimiter implements UserPlaylistActionLimiter {
  constructor(private readonly clientProvider: EvalClientProvider) {}

  async consume(
    input: UserPlaylistIngressInput,
  ): Promise<UserPlaylistIngressDecision> {
    let client: EvalClient | null
    try {
      client = await this.clientProvider()
    } catch {
      return "unavailable"
    }
    if (!client) return "unavailable"

    const subjectLimit = SUBJECT_LIMITS[input.action]
    const dimensions = [
      {
        key: fixedWindowKey(
          `upl-action:subject:${input.action}:${opaque(input.subject)}`,
          input.now,
          subjectLimit.windowMs,
        ),
        ...subjectLimit,
      },
      ...(input.viewerIp
        ? [
            {
              key: fixedWindowKey(
                `upl-action:ip:${opaque(input.viewerIp)}`,
                input.now,
                60_000,
              ),
              max: 180,
              windowMs: 60_000,
            },
          ]
        : []),
      {
        key: fixedWindowKey("upl-action:global", input.now, 60_000),
        max: 5_000,
        windowMs: 60_000,
      },
    ]

    try {
      const result = await client.eval(ATOMIC_FIXED_WINDOW_LUA, {
        keys: dimensions.map(({ key }) => key),
        arguments: dimensions.flatMap(({ max, windowMs }) => [
          String(max),
          String(windowMs),
        ]),
      })
      return Number(result) === 1 ? "admitted" : "limited"
    } catch {
      return "unavailable"
    }
  }
}

let defaultClientPromise: Promise<EvalClient | null> | undefined

async function defaultClient(): Promise<EvalClient | null> {
  if (!process.env.REDIS_URL) return null
  if (!defaultClientPromise) {
    defaultClientPromise = (async () => {
      const client = createClient({ url: process.env.REDIS_URL })
      client.on("error", () => undefined)
      await client.connect()
      return {
        eval: (
          script: string,
          options: { keys: string[]; arguments: string[] },
        ) => client.eval(script, options),
      }
    })().catch(() => {
      defaultClientPromise = undefined
      return null
    })
  }
  return defaultClientPromise
}

const defaultLimiter = new RedisUserPlaylistActionLimiter(defaultClient)

export function getUserPlaylistActionLimiter(): UserPlaylistActionLimiter {
  return defaultLimiter
}
