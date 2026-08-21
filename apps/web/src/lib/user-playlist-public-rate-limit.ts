import { createHash } from "node:crypto"
import { createClient } from "redis"

export type PublicUserPlaylistIngressDecision =
  | "admitted"
  | "limited"
  | "unavailable"

export type PublicUserPlaylistIngressInput = {
  action: "read" | "report"
  capabilityDigest: string
  viewerIp: string | null
  now: Date
}

type EvalClient = {
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>
}

type EvalClientProvider = () => Promise<EvalClient | null>

const FIXED_WINDOW_LUA = `
local admitted = 1
for index = 1, #KEYS do
  local count = redis.call('INCR', KEYS[index])
  if count == 1 then redis.call('PEXPIRE', KEYS[index], ARGV[index * 2]) end
  if count > tonumber(ARGV[index * 2 - 1]) then admitted = 0 end
end
return admitted
`

function opaque(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url")
}

function windowKey(prefix: string, now: Date, windowMs: number): string {
  return `${prefix}:${Math.floor(now.getTime() / windowMs)}`
}

let clientPromise: Promise<EvalClient | null> | undefined

async function client(): Promise<EvalClient | null> {
  if (!process.env.REDIS_URL) return null
  clientPromise ??= (async () => {
    const redis = createClient({ url: process.env.REDIS_URL })
    redis.on("error", () => undefined)
    await redis.connect()
    return {
      eval: (
        script: string,
        options: { keys: string[]; arguments: string[] },
      ) => redis.eval(script, options),
    }
  })().catch(() => {
    clientPromise = undefined
    return null
  })
  return clientPromise
}

/** Shared-storage ingress throttle. */
export class RedisPublicUserPlaylistIngressLimiter {
  constructor(private readonly clientProvider: EvalClientProvider) {}

  async consume(
    input: PublicUserPlaylistIngressInput,
  ): Promise<PublicUserPlaylistIngressDecision> {
    let redis: EvalClient | null
    try {
      redis = await this.clientProvider()
    } catch {
      return "unavailable"
    }
    if (!redis) return "unavailable"

    const minute = 60_000
    const dimensions = [
      {
        key: windowKey(
          `upl-public:${input.action}:cap:${input.capabilityDigest}`,
          input.now,
          minute,
        ),
        max: input.action === "read" ? 120 : 10,
        windowMs: minute,
      },
      ...(input.viewerIp
        ? [
            {
              key: windowKey(
                `upl-public:${input.action}:ip:${opaque(input.viewerIp)}`,
                input.now,
                minute,
              ),
              max: input.action === "read" ? 60 : 10,
              windowMs: minute,
            },
          ]
        : []),
      {
        key: windowKey(`upl-public:${input.action}:global`, input.now, minute),
        max: input.action === "read" ? 5_000 : 1_000,
        windowMs: minute,
      },
    ]

    try {
      const result = await redis.eval(FIXED_WINDOW_LUA, {
        keys: dimensions.map((dimension) => dimension.key),
        arguments: dimensions.flatMap((dimension) => [
          String(dimension.max),
          String(dimension.windowMs),
        ]),
      })
      return Number(result) === 1 ? "admitted" : "limited"
    } catch {
      return "unavailable"
    }
  }
}

// A successful page load deliberately uses two reads (proxy status preflight
// + RSC data resolve), which is accounted for in the 120/min capability budget.
const defaultLimiter = new RedisPublicUserPlaylistIngressLimiter(client)

export function consumePublicUserPlaylistIngress(
  input: PublicUserPlaylistIngressInput,
): Promise<PublicUserPlaylistIngressDecision> {
  return defaultLimiter.consume(input)
}
