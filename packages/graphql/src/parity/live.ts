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
import {
  LiveModeConfigError,
  LiveModeDisabledError,
  assertLiveModeEnabled,
  validateHost,
} from "./live-config"
import { normalizeAdmin } from "./normalize-admin"
import { normalizeStrapi, type StrapiExperienceInput } from "./normalize-strapi"
import type { AdminExperienceLocaleInput } from "./normalize-admin"

// Re-export the env-config surface so callers don't need to import from
// two different modules. Implementation lives in `live-config.ts` so the
// capture script can use it without transitively pulling in
// `normalize-admin.ts` (whose cross-workspace `BlocksSchema` import
// breaks tsx's ESM static-link).
export {
  LiveModeConfigError,
  LiveModeDisabledError,
  assertLiveModeEnabled,
  validateHost,
}

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
  // When the caller overrides URLs via options, re-validate them since
  // assertLiveModeEnabled only validated the env-driven values.
  const strapiUrl = options.strapiUrl ?? config.strapiUrl
  const adminUrl = options.adminUrl ?? config.adminUrl
  const baseOrigin = options.baseOrigin ?? config.baseOrigin
  if (options.strapiUrl) validateHost(strapiUrl, "FORGE_STRAPI_URL")
  if (options.adminUrl) validateHost(adminUrl, "FORGE_ADMIN_URL")

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
