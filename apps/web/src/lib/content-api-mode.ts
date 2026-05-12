// =============================================================================
// PR-B (plan-003 direct cutover) — DELETION CHECKLIST
// =============================================================================
//
// This module is throwaway scaffolding for the Strapi → admin consumer
// migration. It reads `FORGE_CONTENT_API` once at module scope and exposes
// a typed mode discriminator that `apps/web/src/lib/content.ts` branches
// on. Retire when admin becomes the sole consumer source AND the cutover
// has held for a parity-clean window — sequenced as a fast-follow U5
// deletion PR after PR-B (plan-003) merges.
//
// Cross-references:
//   apps/web/src/lib/parity-bridge.ts          (deletion list)
//   packages/graphql/src/parity/index.ts:1-34  (harness deletion list)
//   docs/plans/2026-05-11-003-feat-web-admin-direct-cutover-plan.md (current)
//   docs/plans/2026-05-08-001-feat-consumer-migration-web-canary-unit-5-plan.md (U5 origin)
//
// At retirement, remove ALL of the following in one PR:
//
//   - This file: apps/web/src/lib/content-api-mode.ts
//   - The companion test: apps/web/src/lib/content-api-mode.test.ts
//   - The flag-branching helper in apps/web/src/lib/content.ts
//     (`fetchSlugExperience` — folds back into a direct admin call
//      once Strapi is gone)
//   - The Strapi adapter: apps/web/src/lib/admin-client.ts (renamed to
//     just admin-client, no longer a "canary" client)
//   - The admin operation: apps/web/src/lib/fragments/admin-experience.ts
//     and its re-export in apps/web/src/lib/fragments/index.ts
//   - The parity bridge: apps/web/src/lib/parity-bridge.ts
//   - The regression snapshot: apps/web/src/lib/__tests__/content-mode-regression.test.ts
//   - Env vars: drop `FORGE_CONTENT_API`, `FORGE_PARITY_DEBUG` from any
//     deployed env config (`ADMIN_GRAPHQL_URL` and `WEB_ADMIN_API_KEYS`
//     STAY — admin is the sole source post-Strapi-removal)
//   - In apps/web/src/env.ts: remove the FORGE_CONTENT_API server schema
//     entry, the host-allowlist constants, and the `runtimeEnv` mapping.
//     Keep ADMIN_GRAPHQL_URL + WEB_ADMIN_API_KEYS — those become required.
//
// What does NOT get removed:
//   - The Strapi-side `getExperienceByFilters` function in content.ts —
//     stays for resolveHomepage and the legacy-homepage path until that
//     surface migrates separately.
//
// =============================================================================

import { env } from "@/env"

/**
 * Closed union of ACTIVE `FORGE_CONTENT_API` values.
 *
 * PR-B (plan-003) collapses the active set to two values: `strapi`
 * (default — byte-identical to current main) and `admin` (direct cutover
 * — fetches from admin via the bearer-aware Apollo client).
 *
 * Two legacy values are still accepted at the env schema level for
 * soft-removal compat: `dual-read` (the U5 canary mode) and
 * `admin-with-fallback` (a forward-looking R7 mode that was specced but
 * never shipped). Both coerce to `"strapi"` with a console.warn so
 * operators with stale runbook values don't see a behavior change
 * without a visible signal in the logs.
 */
export type ContentApiMode = "strapi" | "admin"

const RECOGNIZED_MODES: readonly ContentApiMode[] = ["strapi", "admin"]

/**
 * Legacy values still accepted at the env-schema level (so a stale
 * Doppler config doesn't brick boot) but soft-removed at the narrower —
 * coerced to `"strapi"` with a visible warn.
 */
const LEGACY_SOFT_REMOVED_MODES: readonly string[] = [
  "dual-read",
  "admin-with-fallback",
]

/**
 * Accept any unknown value and return a `ContentApiMode`. Unrecognized
 * values warn at the console and fall back to `"strapi"`. Two layers of
 * fall-back exist:
 *
 *  1. Legacy values (`dual-read`, `admin-with-fallback`) → `"strapi"`
 *     with a "soft-removed; update your Doppler config" warn. Existed
 *     in U5 / the R7 spec; no longer active modes.
 *  2. Unknown garbage (typos, future-unknowns) → `"strapi"` with a
 *     generic "not a recognized value" warn.
 *
 * Non-string inputs (number / object / etc.) also fall back with a
 * type-specific warn.
 */
export function normalizeContentApiMode(raw: unknown): ContentApiMode {
  if (raw == null) return "strapi"
  if (typeof raw !== "string") {
    if (typeof console !== "undefined") {
      console.warn(
        `[content-api-mode] FORGE_CONTENT_API received a non-string value (${typeof raw}); falling back to "strapi".`,
      )
    }
    return "strapi"
  }
  if ((RECOGNIZED_MODES as readonly string[]).includes(raw)) {
    return raw as ContentApiMode
  }
  if (LEGACY_SOFT_REMOVED_MODES.includes(raw)) {
    if (typeof console !== "undefined") {
      console.warn(
        `[content-api-mode] FORGE_CONTENT_API="${raw}" is a soft-removed legacy value; falling back to "strapi". Update your Doppler config to "strapi" or "admin".`,
      )
    }
    return "strapi"
  }
  if (typeof console !== "undefined") {
    console.warn(
      `[content-api-mode] FORGE_CONTENT_API="${raw}" is not a recognized value (expected: ${RECOGNIZED_MODES.join(", ")}); falling back to "strapi".`,
    )
  }
  return "strapi"
}

/**
 * Module-cached mode value, read once at module import. Reading at module
 * scope is intentional and load-bearing for ISR — using `headers()` or
 * `cookies()` to make the flag per-request silently disables Next.js's
 * Full Route Cache (see docs/solutions/web/nextjs-headers-defeats-route-cache.md).
 *
 * `env.FORGE_CONTENT_API` is server-only; reading it from a client bundle
 * throws via t3-oss/env-nextjs's Proxy. The `typeof window` guard mirrors
 * apps/web/src/lib/client.ts so this module can be imported transitively
 * by client components without throwing at module load. On the client the
 * mode is always `"strapi"` because the canary's dual-fetch only runs
 * server-side anyway.
 *
 * env.FORGE_CONTENT_API admits four values at the schema level (strapi /
 * dual-read / admin-with-fallback / admin) for soft-removal compat;
 * `normalizeContentApiMode` is the load-bearing narrower that closes the
 * active set to `"strapi" | "admin"`.
 */
const cachedMode: ContentApiMode =
  typeof window === "undefined"
    ? normalizeContentApiMode(env.FORGE_CONTENT_API)
    : "strapi"

export function getContentApiMode(): ContentApiMode {
  return cachedMode
}
