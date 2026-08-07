/**
 * Admin GraphQL endpoint resolution — a dependency-free leaf.
 *
 * It imports nothing from `env.ts` or `config.ts` so the startup refusal and the
 * startup report can both sit at `env.ts` module scope without a require cycle.
 */

/** Development default. `localhost` matches `.env.ci` and the TV prior art. */
export const LOCAL_ADMIN_GRAPHQL_URL = "http://localhost:3003/api/graphql"

export const PRODUCTION_ADMIN_GRAPHQL_URL =
  "https://admin.jesusfilm.org/api/graphql"

/** Named here so the refusal message and the docs can't drift from the wiring. */
export const ALLOW_PRODUCTION_ADMIN_ENV_VAR =
  "EXPO_PUBLIC_ALLOW_PRODUCTION_ADMIN"

/** The per-machine slot: development-only, and never written by fetch-secrets. */
export const PER_MACHINE_ENV_FILE = "apps/mobile/.env.development.local"

/** The Android emulator reaches the host machine here, never via loopback. */
const ANDROID_EMULATOR_HOST = "10.0.2.2"

const REWRITABLE_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"])

// `[::1]` is what WHATWG URL reports for the IPv6 loopback; accept both forms.
const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  ANDROID_EMULATOR_HOST,
])

const PRODUCTION_HOSTS = new Set([hostOf(PRODUCTION_ADMIN_GRAPHQL_URL) ?? ""])

export type AdminHostKind = "local" | "production" | "other"

/**
 * Parsed hostname, or null when the value is not a parseable absolute URL.
 * Never throws: both callers run in release bundles, where an exception would
 * reach a beta tester as a hard failure.
 */
function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname || null
  } catch {
    return null
  }
}

/**
 * Classify by parsed hostname, never by substring — `admin.jesusfilm.org.evil`
 * and a `?to=admin.jesusfilm.org` query must not read as production, and only
 * `production` refuses. Anything unparseable is `other`, the safe answer.
 */
export function classifyAdminHost(
  url: string | null | undefined,
): AdminHostKind {
  const host = hostOf(url)
  if (host == null) return "other"
  if (PRODUCTION_HOSTS.has(host)) return "production"
  if (LOCAL_HOSTS.has(host)) return "local"
  return "other"
}

/**
 * Rewrite a loopback host to the Android emulator alias so one configured value
 * works on both simulators. Development only, and unchanged for every other
 * host — a LAN address is already reachable from the emulator.
 */
export function normalizeAdminHost(
  url: string,
  platform: string,
  isDev: boolean,
): string {
  if (!isDev || platform !== "android") return url
  const host = hostOf(url)
  if (host == null || !REWRITABLE_LOOPBACK_HOSTS.has(host)) return url
  // Replace inside the authority only, so a `?from=localhost` query is safe.
  const marker = url.indexOf("://")
  if (marker < 0) return url
  const head = url.slice(0, marker + 3)
  return head + url.slice(marker + 3).replace(host, ANDROID_EMULATOR_HOST)
}

/**
 * The single resolution path. `getGraphQLUrl()` and the startup report both call
 * it, so the reported endpoint cannot diverge from the one actually used.
 */
export function resolveAdminGraphqlUrl(
  configured: string | null | undefined,
  isDev: boolean,
  platform: string,
): string {
  const base =
    configured ??
    (isDev ? LOCAL_ADMIN_GRAPHQL_URL : PRODUCTION_ADMIN_GRAPHQL_URL)
  return normalizeAdminHost(base, platform, isDev)
}

export type AdminEndpointAccess =
  | { allowed: true }
  | { allowed: false; message: string }

/**
 * Fail closed: a development bundle may not talk to production admin without a
 * deliberate override. Only a known production host refuses — a LAN address, a
 * tunnel, or an emulator alias boots normally (KTD8).
 *
 * Called unconditionally at `env.ts` module scope in EVERY build, so the
 * non-development short-circuit is the first line: a release bundle never
 * reaches the parsing path at all.
 */
export function decideAdminEndpointAccess(
  url: string,
  isDev: boolean,
  override: string | null | undefined,
): AdminEndpointAccess {
  if (!isDev) return { allowed: true }
  if (classifyAdminHost(url) !== "production") return { allowed: true }
  // Empty string is absent, matching the env schema's emptyStringAsUndefined.
  if (override != null && override !== "") return { allowed: true }
  return {
    allowed: false,
    message: [
      `Refusing to start a development build against production admin.`,
      ``,
      `Resolved admin endpoint: ${url}`,
      ``,
      `Development sessions write to production — search events, search traces,`,
      `and query text. Point EXPO_PUBLIC_ADMIN_GRAPHQL_URL at a local admin in`,
      `${PER_MACHINE_ENV_FILE}, or remove it entirely to use the local default`,
      `${LOCAL_ADMIN_GRAPHQL_URL}.`,
      ``,
      `To use production deliberately, set ${ALLOW_PRODUCTION_ADMIN_ENV_VAR}=1 in`,
      `that same file.`,
      ``,
      `Cold-restart Metro after either change — Expo inlines EXPO_PUBLIC_* at`,
      `bundler startup, so a reload picks up nothing.`,
    ].join("\n"),
  }
}
