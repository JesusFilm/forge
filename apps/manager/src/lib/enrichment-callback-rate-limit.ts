import { isIP } from "node:net"

const MAX_REQUESTS = 120
const WINDOW_MS = 60_000
const MAX_KEYS = 1024
const MAX_ADDRESS_LENGTH = 45

type Bucket = { count: number; resetAt: number }
type Admission =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number; error: string }

function readAddressKey(request: Request, trustCloudflare: boolean): string {
  // Request has no authenticated peer/proxy metadata. Only an explicitly
  // provisioned Cloudflare ingress may supply address partitions. Internal or
  // unverified ingress shares a bucket; forwarded-for/real-ip never opt it in.
  if (!trustCloudflare) return "unknown"
  const address = request.headers.get("cf-connecting-ip")
  if (
    !address ||
    address.length > MAX_ADDRESS_LENGTH ||
    address.includes("%") ||
    !isIP(address)
  ) {
    return "unknown"
  }
  // Canonicalize equivalent IPv6 spellings to avoid extra partitions.
  return isIP(address) === 6
    ? new URL(`http://[${address}]/`).hostname
    : address
}

export function createCallbackRateLimiter() {
  const buckets = new Map<string, Bucket>()
  return {
    get retainedKeyCount() {
      return buckets.size
    },
    check(
      request: Request,
      trustCloudflare: boolean,
      now = Date.now(),
    ): Admission {
      // Lazy expiry removes unused identities too. Work is bounded by MAX_KEYS,
      // and no process timer or per-request asynchronous cleanup is needed.
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key)
      }
      const key = readAddressKey(request, trustCloudflare)
      const current = buckets.get(key)
      if (current) {
        if (current.count < MAX_REQUESTS) {
          current.count += 1
          return { ok: true }
        }
        return rejected(current.resetAt, now)
      }
      if (buckets.size >= MAX_KEYS) {
        // Never evict an active bucket: churn must not reset an existing limit.
        let earliestReset = Infinity
        for (const bucket of buckets.values()) {
          earliestReset = Math.min(earliestReset, bucket.resetAt)
        }
        return rejected(earliestReset, now)
      }
      buckets.set(key, { count: 1, resetAt: now + WINDOW_MS })
      return { ok: true }
    },
  }
}

function rejected(resetAt: number, now: number): Admission {
  return {
    ok: false,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    error: "Callback rate limit exceeded",
  }
}

export const callbackRateLimiter = createCallbackRateLimiter()
