import "server-only"

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify"
export const WATCH_RECOMMENDATION_TURNSTILE_ACTION = "watch_recommendations"
export const WATCH_RECOMMENDATION_TURNSTILE_FIXTURE_HOSTNAME =
  "turnstile-test-fixture.local"
export const WATCH_RECOMMENDATION_TURNSTILE_TEST_SITE_KEY =
  "1x00000000000000000000AA"
export const WATCH_RECOMMENDATION_TURNSTILE_TEST_SECRET_KEY =
  "1x0000000000000000000000000000000AA"
const SITEVERIFY_TIMEOUT_MS = 1_200

const TEST_SITE_KEYS = new Set([
  WATCH_RECOMMENDATION_TURNSTILE_TEST_SITE_KEY,
  "2x00000000000000000000AB",
  "1x00000000000000000000BB",
  "2x00000000000000000000BB",
  "3x00000000000000000000FF",
])
const TEST_SECRET_KEYS = new Set([
  WATCH_RECOMMENDATION_TURNSTILE_TEST_SECRET_KEY,
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
])

export function isWatchTurnstileTestCredential(
  siteKey: string | undefined,
  secret: string | undefined,
): boolean {
  return TEST_SITE_KEYS.has(siteKey ?? "") || TEST_SECRET_KEYS.has(secret ?? "")
}

export function isLoopbackWatchHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  )
}

export type WatchTurnstileVerification =
  | { status: "verified"; hostname: string }
  | { status: "fixture_verified"; hostname: string }
  | { status: "rejected" }
  | { status: "unavailable" }

/** A browser token is untrusted until Cloudflare validates it for this action
 * and one of this deployment's exact Watch hostnames. */
export async function verifyWatchRecommendationTurnstile(
  token: string | null,
  config: {
    secret: string | undefined
    hostnames: readonly string[]
    siteKey?: string
    allowLocalFixture?: boolean
    requestHostname?: string
  },
  siteverify: typeof fetch = fetch,
): Promise<WatchTurnstileVerification> {
  if (!config.secret || config.hostnames.length === 0) {
    return { status: "unavailable" }
  }
  const testCredential = isWatchTurnstileTestCredential(
    config.siteKey,
    config.secret,
  )
  const allowedFixture =
    process.env.NODE_ENV !== "production" &&
    config.allowLocalFixture === true &&
    config.siteKey === WATCH_RECOMMENDATION_TURNSTILE_TEST_SITE_KEY &&
    config.secret === WATCH_RECOMMENDATION_TURNSTILE_TEST_SECRET_KEY &&
    isLoopbackWatchHost(config.requestHostname ?? "") &&
    config.hostnames.includes(WATCH_RECOMMENDATION_TURNSTILE_FIXTURE_HOSTNAME)
  if (testCredential && !allowedFixture) return { status: "unavailable" }
  if (!token || token.length > 2_048) return { status: "rejected" }

  try {
    const response = await siteverify(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: config.secret, response: token }),
      cache: "no-store",
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    })
    if (!response.ok) return { status: "unavailable" }
    const result: unknown = await response.json()
    if (!result || typeof result !== "object") return { status: "rejected" }
    const fields = result as Record<string, unknown>
    if (testCredential) {
      const metadata = fields.metadata
      return fields.success === true &&
        metadata &&
        typeof metadata === "object" &&
        "result_with_testing_key" in metadata &&
        metadata.result_with_testing_key === true
        ? {
            status: "fixture_verified",
            hostname: WATCH_RECOMMENDATION_TURNSTILE_FIXTURE_HOSTNAME,
          }
        : { status: "rejected" }
    }
    return fields.success === true &&
      fields.action === WATCH_RECOMMENDATION_TURNSTILE_ACTION &&
      typeof fields.hostname === "string" &&
      config.hostnames.includes(fields.hostname)
      ? { status: "verified", hostname: fields.hostname }
      : { status: "rejected" }
  } catch {
    return { status: "unavailable" }
  }
}
