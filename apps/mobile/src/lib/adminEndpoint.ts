// A dependency-free leaf: importing nothing from `env.ts` or `config.ts` is what
// lets the refusal and the report sit at env module scope without a cycle.

/** Development default. `localhost` matches `.env.ci` and the TV prior art. */
export const LOCAL_ADMIN_GRAPHQL_URL = "http://localhost:3003/api/graphql"

// A literal, not parsed from the URL below: a broken `URL` would silently empty
// the production set and the refusal would fail OPEN.
const PRODUCTION_ADMIN_HOST = "admin.jesusfilm.org"

export const PRODUCTION_ADMIN_GRAPHQL_URL = `https://${PRODUCTION_ADMIN_HOST}/api/graphql`

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

const PRODUCTION_HOSTS = new Set([PRODUCTION_ADMIN_HOST])

export type AdminHostKind = "local" | "production" | "other"

/** Never throws — both callers run in release bundles. Null when unparseable. */
function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname || null
  } catch {
    return null
  }
}

// Parsed hostname, never a substring: `admin.jesusfilm.org.evil` and a
// `?to=admin.jesusfilm.org` query must not read as production. Unparseable is
// `other`, the safe answer, because only `production` refuses.
export function classifyAdminHost(
  url: string | null | undefined,
): AdminHostKind {
  const host = hostOf(url)
  if (host == null) return "other"
  if (PRODUCTION_HOSTS.has(host)) return "production"
  if (LOCAL_HOSTS.has(host)) return "local"
  return "other"
}

// Loopback -> emulator alias, so one configured value works on both simulators.
// Every other host is left alone; a LAN address already reaches the emulator.
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

// The single resolution path, so the reported endpoint cannot diverge from the
// one actually used.
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

// Called at env module scope in EVERY build, so the non-dev short-circuit is the
// first line — a release bundle never reaches the parsing path. Only a known
// production host refuses; a LAN address or tunnel boots normally (KTD8).
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

// A console line and nothing else (KTD4): datadog.ts imports env.ts, so
// telemetering from env module scope would close a cycle.
export function formatAdminEndpointReport(url: string): string {
  return `[admin-endpoint] admin_endpoint.url=${url} admin_endpoint.kind=${classifyAdminHost(url)}`
}

/** Fires once at env module evaluation, not per query. Development only. */
export function reportAdminEndpoint(url: string, isDev: boolean): void {
  if (!isDev) return

  console.info(formatAdminEndpointReport(url))
}

// The link chain lives outside React, so the signal rides a module-scope store.
// The Startup Error panel cannot be reused — its `moduleError` has no setter, so
// nothing can raise it after boot (KTD9).
let unreachableEndpoint: string | null = null
const unreachableListeners = new Set<() => void>()

export function formatAdminEndpointUnreachable(url: string): string {
  return `[admin-endpoint] admin_endpoint.unreachable=true admin_endpoint.url=${url} — nothing answered. Start local admin (pnpm --filter @forge/admin dev) or point the endpoint elsewhere in ${PER_MACHINE_ENV_FILE} and cold-restart Metro. Home is showing its frozen fallback, not loaded content.`
}

/** One-shot per launch: a failing screen retries, and one notice is the point. */
export function noteAdminEndpointUnreachable(url: string): void {
  if (unreachableEndpoint != null) return
  unreachableEndpoint = url

  console.error(formatAdminEndpointUnreachable(url))
  for (const listener of unreachableListeners) listener()
}

export function getUnreachableAdminEndpoint(): string | null {
  return unreachableEndpoint
}

export function subscribeAdminEndpointUnreachable(
  listener: () => void,
): () => void {
  unreachableListeners.add(listener)
  return () => {
    unreachableListeners.delete(listener)
  }
}
