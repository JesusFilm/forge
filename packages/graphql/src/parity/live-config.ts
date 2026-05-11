/**
 * Live-mode env validation, extracted from `live.ts` so the capture
 * script can use it without transitively pulling in `normalize-admin.ts`
 * (whose `BlocksSchema` cross-workspace import fails tsx's ESM
 * static-link step on raw .ts source paths).
 *
 * `live.ts` re-exports these for the in-package consumers; the capture
 * script imports them directly from this file.
 */

export class LiveModeDisabledError extends Error {
  override readonly name = "LiveModeDisabledError"
}

export class LiveModeConfigError extends Error {
  override readonly name = "LiveModeConfigError"
}

/**
 * Hosts on the rejection list — the admin auth host and any other
 * known non-GraphQL host. Add new entries here when admin's deployment
 * topology adds another non-GraphQL host.
 */
const REJECTED_HOSTS = new Set([
  "auth.jesusfilm.org",
  // Add other known non-GraphQL hosts here as they emerge.
])

/**
 * Asserts live mode is enabled and configured. Throws a typed error
 * with the missing env var name when it isn't. Exposed separately for
 * the capture script to share validation logic.
 */
export function assertLiveModeEnabled(env: NodeJS.ProcessEnv = process.env): {
  readonly strapiUrl: string
  readonly adminUrl: string
  readonly baseOrigin: string
} {
  if (env.FORGE_PARITY_LIVE !== "1") {
    throw new LiveModeDisabledError(
      "live mode is disabled — set FORGE_PARITY_LIVE=1 to enable",
    )
  }
  const strapiUrl = env.FORGE_STRAPI_URL
  const adminUrl = env.FORGE_ADMIN_URL
  const baseOrigin = env.FORGE_STRAPI_PUBLIC_ORIGIN
  if (!strapiUrl) {
    throw new LiveModeConfigError(
      "live mode requires FORGE_STRAPI_URL to be set",
    )
  }
  if (!adminUrl) {
    throw new LiveModeConfigError(
      "live mode requires FORGE_ADMIN_URL to be set",
    )
  }
  if (!baseOrigin) {
    throw new LiveModeConfigError(
      "live mode requires FORGE_STRAPI_PUBLIC_ORIGIN to be set",
    )
  }
  validateHost(adminUrl, "FORGE_ADMIN_URL")
  validateHost(strapiUrl, "FORGE_STRAPI_URL")
  return { strapiUrl, adminUrl, baseOrigin }
}

/**
 * Reject the URL if its hostname is on the rejection list.
 * Throws `LiveModeConfigError` with a clear message on rejection.
 */
export function validateHost(rawUrl: string, varName: string): void {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new LiveModeConfigError(`${varName} is not a valid URL: ${rawUrl}`)
  }
  // hostname (no port) — parsed.host includes port unless it's the
  // protocol's default, so a `:8443` variant of auth.jesusfilm.org would
  // otherwise bypass the rejection set.
  if (REJECTED_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new LiveModeConfigError(
      `${varName} points at a rejected host '${parsed.hostname}'. Admin GraphQL lives at admin.jesusfilm.org/api/graphql or localhost:3003/api/graphql, NOT auth.jesusfilm.org (per PR #909).`,
    )
  }
}
