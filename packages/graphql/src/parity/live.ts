/**
 * Env-gated live-comparison entry point.
 *
 * Off by default. Activated only when `FORGE_PARITY_LIVE=1` is set
 * along with both endpoint URLs. Issues anonymous queries to Strapi
 * and admin, runs the normalizers, and returns the differ's report.
 *
 * Not invoked by the test suite — for ad-hoc operator use during
 * canary investigation. The capture script
 * (`scripts/capture-parity-fixture.ts`) handles fixture-capture flows.
 *
 * Host validation: rejects `auth.jesusfilm.org` (per PR #909, admin's
 * auth flows live there and `/api/*` requests return 404). Production
 * admin GraphQL is at `admin.jesusfilm.org/api/graphql`; locally,
 * `http://localhost:3003/api/graphql`. The blocklist is conservative
 * — it allows any URL that isn't on the rejection list.
 */

import { compareNormalizedRoutes, type DiffReport } from "./compare"
import { normalizeAdmin } from "./normalize-admin"
import { normalizeStrapi, type StrapiExperienceInput } from "./normalize-strapi"
import type { AdminExperienceLocaleInput } from "./normalize-admin"

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

export type LiveModeOptions = {
  readonly slug: string
  readonly urlLocale: string
  /** Optional: override the env-driven Strapi URL. */
  readonly strapiUrl?: string
  /** Optional: override the env-driven admin URL. */
  readonly adminUrl?: string
  /** Optional: override base origin for URL canonicalization. */
  readonly baseOrigin?: string
}

export type LiveModeResult = {
  readonly diff: DiffReport
  readonly strapiResponseTimeMs: number
  readonly adminResponseTimeMs: number
}

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
  if (REJECTED_HOSTS.has(parsed.host)) {
    throw new LiveModeConfigError(
      `${varName} points at a rejected host '${parsed.host}'. Admin GraphQL lives at admin.jesusfilm.org/api/graphql or localhost:3003/api/graphql, NOT auth.jesusfilm.org (per PR #909).`,
    )
  }
}

/**
 * Run a live parity comparison. Caller provides Strapi + admin
 * fetchers (decoupling transport from the harness). Returns the diff
 * report alongside per-side response timings.
 *
 * The fetcher closures abstract over Apollo/fetch/etc. — they take a
 * slug + locale and return the typed normalizer input. The harness
 * does NOT know about transport, headers, or auth at this layer.
 */
export async function runLiveComparison(
  options: LiveModeOptions,
  fetchers: {
    readonly fetchStrapi: (
      slug: string,
      locale: string,
      url: string,
    ) => Promise<StrapiExperienceInput>
    readonly fetchAdmin: (
      slug: string,
      locale: string,
      url: string,
    ) => Promise<AdminExperienceLocaleInput>
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<LiveModeResult> {
  const config = assertLiveModeEnabled(env)
  const strapiUrl = options.strapiUrl ?? config.strapiUrl
  const adminUrl = options.adminUrl ?? config.adminUrl
  const baseOrigin = options.baseOrigin ?? config.baseOrigin

  validateHost(adminUrl, "FORGE_ADMIN_URL")
  validateHost(strapiUrl, "FORGE_STRAPI_URL")

  const tStrapiStart = Date.now()
  const strapiInput = await fetchers.fetchStrapi(
    options.slug,
    options.urlLocale,
    strapiUrl,
  )
  const tStrapiEnd = Date.now()

  const tAdminStart = Date.now()
  const adminInput = await fetchers.fetchAdmin(
    options.slug,
    options.urlLocale,
    adminUrl,
  )
  const tAdminEnd = Date.now()

  const strapiNormalized = normalizeStrapi(strapiInput, {
    urlLocale: options.urlLocale,
    baseOrigin,
  })
  const adminNormalized = normalizeAdmin(adminInput, {
    urlLocale: options.urlLocale,
    baseOrigin,
  })

  const diff = compareNormalizedRoutes(strapiNormalized, adminNormalized, {
    urlLocale: options.urlLocale,
  })

  return {
    diff,
    strapiResponseTimeMs: tStrapiEnd - tStrapiStart,
    adminResponseTimeMs: tAdminEnd - tAdminStart,
  }
}
