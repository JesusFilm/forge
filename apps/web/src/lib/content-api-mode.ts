// =============================================================================
// U5 (feat-104 consumer migration) — DELETION CHECKLIST
// =============================================================================
//
// This module is throwaway scaffolding for the Strapi → admin consumer
// migration. It reads `FORGE_CONTENT_API` once at module scope and exposes
// a typed mode discriminator that `apps/web/src/lib/content.ts` branches
// on. Retire when admin becomes the sole consumer source AND U5b's
// admin-mode rendering has held for a parity-clean window.
//
// Cross-references:
//   apps/web/src/lib/parity-bridge.ts          (U4 — bridge deletion list)
//   packages/graphql/src/parity/index.ts:1-34  (harness deletion list)
//   docs/plans/2026-05-08-001-feat-consumer-migration-web-canary-unit-5-plan.md
//
// At retirement, remove ALL of the following in one PR:
//
//   - This file: apps/web/src/lib/content-api-mode.ts
//   - The companion test: apps/web/src/lib/content-api-mode.test.ts
//   - The flag-branching helper in apps/web/src/lib/content.ts
//     (`fetchSlugExperience` — folds back into a direct Strapi call
//      OR is replaced by the U5b admin renderer, depending on what
//      ships at retirement time)
//   - The admin Apollo client: apps/web/src/lib/admin-client.ts
//   - The admin operation: apps/web/src/lib/fragments/admin-experience.ts
//     and its re-export in apps/web/src/lib/fragments/index.ts
//   - The parity bridge: apps/web/src/lib/parity-bridge.ts
//   - The regression snapshot: apps/web/src/lib/__tests__/content-mode-regression.test.ts
//   - Env vars: drop `FORGE_CONTENT_API`, `ADMIN_GRAPHQL_URL`, and
//     `FORGE_PARITY_DEBUG` from any deployed env config
//   - In apps/web/src/env.ts: remove the FORGE_CONTENT_API + ADMIN_GRAPHQL_URL
//     server schema entries, the host-allowlist constants, and their
//     `runtimeEnv` mappings
//
// What does NOT get removed:
//   - The Strapi-side `getExperienceByFilters` function in content.ts —
//     still in use by `resolveHomepage` and the legacy-homepage path
//
// =============================================================================

import { env } from "@/env"

/**
 * Closed union of accepted `FORGE_CONTENT_API` values for U5.
 *
 * U5 ships only `strapi` (default — byte-identical to `main`) and
 * `dual-read` (canary — serves Strapi, runs admin in shadow for parity).
 * Origin R7 names two additional values (`admin-with-fallback`, `admin`)
 * that ship in U5b alongside the admin → WatchExperience shape adapter.
 */
export type ContentApiMode = "strapi" | "dual-read"

const RECOGNIZED_MODES: readonly ContentApiMode[] = ["strapi", "dual-read"]

/**
 * Accept any unknown value and return a `ContentApiMode`. Unrecognized
 * values warn at the console and fall back to `"strapi"`. Defensive layer
 * that exists to prevent malformed flag values (pasted from a future U5b
 * env, e.g. `"admin-with-fallback"`) from silently activating an
 * unsupported branch.
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
  if (typeof console !== "undefined") {
    console.warn(
      `[content-api-mode] FORGE_CONTENT_API="${raw}" is not a recognized U5 value (expected: ${RECOGNIZED_MODES.join(", ")}); falling back to "strapi".`,
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
 * env.FORGE_CONTENT_API admits four values (strapi / dual-read /
 * admin-with-fallback / admin) so an operator pre-setting a U5b value
 * doesn't brick boot. `normalizeContentApiMode` is the load-bearing
 * narrower: U5b values coerce to `"strapi"` with a warn until U5b ships
 * admin-mode rendering.
 */
const cachedMode: ContentApiMode =
  typeof window === "undefined"
    ? normalizeContentApiMode(env.FORGE_CONTENT_API)
    : "strapi"

export function getContentApiMode(): ContentApiMode {
  return cachedMode
}
