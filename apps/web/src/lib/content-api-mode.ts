// Throwaway scaffolding for the Strapi → admin consumer migration. Reads
// FORGE_CONTENT_API once at module scope; retire when admin is sole consumer
// source via the fast-follow deletion PR.
//
// Cross-references for the deletion PR:
//   apps/web/src/lib/parity-bridge.ts          (deletion list)
//   packages/graphql/src/parity/index.ts:1-34  (harness deletion list)
//
// Deletion checklist (remove together in one PR):
//   - This file + content-api-mode.test.ts
//   - fetchSlugExperience's mode branch in content.ts (folds to direct admin call)
//   - admin-client.ts (renamed; no longer a canary)
//   - fragments/admin-experience.ts + re-export
//   - parity-bridge.ts + parity-bridge.test.ts
//   - __tests__/content-mode-regression.test.ts
//   - Env: FORGE_CONTENT_API, FORGE_PARITY_DEBUG (ADMIN_GRAPHQL_URL +
//     WEB_ADMIN_API_KEYS STAY and become required)
//   - In env.ts: FORGE_CONTENT_API server schema entry, host-allowlist
//     constants, runtimeEnv mapping
//
// DO NOT remove: Strapi-side `getExperienceByFilters` in content.ts —
// resolveHomepage and the legacy-homepage path still use it.

import { env } from "@/env"

export type ContentApiMode = "strapi" | "admin"

const RECOGNIZED_MODES: readonly ContentApiMode[] = ["strapi", "admin"]

/** Legacy values accepted at the env schema but coerced to `"strapi"` with a warn. */
const LEGACY_SOFT_REMOVED_MODES: readonly string[] = [
  "dual-read",
  "admin-with-fallback",
]

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

// Read once at module scope — using headers()/cookies() per-request would
// silently disable Next's Full Route Cache. See
// docs/solutions/web/nextjs-headers-defeats-route-cache.md.
// `typeof window` guard lets client components import transitively;
// env.FORGE_CONTENT_API is server-only via t3-oss/env-nextjs's Proxy.
const cachedMode: ContentApiMode =
  typeof window === "undefined"
    ? normalizeContentApiMode(env.FORGE_CONTENT_API)
    : "strapi"

export function getContentApiMode(): ContentApiMode {
  return cachedMode
}
