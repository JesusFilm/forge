import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

// =============================================================================
// U5 (feat-104 consumer migration) — FORGE_CONTENT_API + ADMIN_GRAPHQL_URL
//
// Both vars are server-only. They power the dual-read parity canary that
// fans out to admin's experienceBySlug GraphQL query in parallel with
// Strapi. Retire alongside the rest of U5's scaffolding when admin
// becomes the sole consumer source. See:
//   apps/web/src/lib/content-api-mode.ts (deletion checklist)
//   docs/plans/2026-05-08-001-feat-consumer-migration-web-canary-unit-5-plan.md
// =============================================================================
const ADMIN_GRAPHQL_URL_HOST_ALLOWLIST_SUFFIXES = [
  ".jesusfilm.org",
  ".railway.app",
  ".local",
] as const
const ADMIN_GRAPHQL_URL_HOST_ALLOWLIST_EXACTS = [
  "localhost",
  "127.0.0.1",
] as const
// Explicit hard-reject set. These hosts pass the soft allowlist
// (.jesusfilm.org suffix) but are NOT the admin GraphQL surface and
// will always 404 — the auth host (PR #909) is the canonical case.
// Mirrors packages/graphql/src/parity/live-config.ts:24 REJECTED_HOSTS.
const ADMIN_GRAPHQL_URL_HOST_REJECT_SET = new Set<string>([
  "auth.jesusfilm.org",
])

export const env = createEnv({
  server: {
    INTERNAL_GRAPHQL_URL: z.url(),
    STRAPI_API_TOKEN: z.string(),
    STRAPI_PREVIEW_SECRET: z.string(),
    REVALIDATION_SECRET: z.string(),
    // Optional: used only by the /demo-search AI experience generator.
    // Absent in most preview environments; the server action surfaces a
    // graceful "not configured" state when unset.
    OPENROUTER_API_KEY: z.string().optional(),
    // U5 — dual-read parity canary mode. U5 ships only `strapi` (default,
    // byte-identical to current behavior) and `dual-read` (canary). Origin
    // R7 names two additional values (`admin-with-fallback`, `admin`) which
    // ship in U5b alongside the admin → WatchExperience shape adapter.
    FORGE_CONTENT_API: z.enum(["strapi", "dual-read"]).default("strapi"),
    // U5 — admin GraphQL URL for the dual-read shadow fetch. Required (boot
    // fails fast if absent). Host allowlist is warn-only — emits a visible
    // boot warning on misconfigured hosts but does NOT brick boot, so
    // legitimate-but-unknown deployment topologies (custom domains, branch
    // URLs) can still stand up. Mirrors NEXT_PUBLIC_CANONICAL_ORIGIN's
    // allowlist shape.
    ADMIN_GRAPHQL_URL: z
      .url()
      // Hard-reject known non-GraphQL hosts (auth.jesusfilm.org, etc.) —
      // these pass the soft allowlist's suffix match but always 404 on
      // /api/graphql due to admin's auth-host proxy gating (PR #909).
      // Throwing at boot is preferable to a silent run-time canary that
      // emits forge.parity.harness_error events on every request.
      .refine(
        (value) => {
          try {
            const { hostname } = new URL(value)
            return !ADMIN_GRAPHQL_URL_HOST_REJECT_SET.has(
              hostname.toLowerCase(),
            )
          } catch {
            return true
          }
        },
        {
          message:
            "ADMIN_GRAPHQL_URL points at a known non-GraphQL host (e.g. auth.jesusfilm.org). Admin GraphQL lives at admin.jesusfilm.org/api/graphql, not the auth host (PR #909).",
        },
      )
      // Warn-only soft allowlist for everything else: legitimate-but-
      // unknown deployment topologies (custom domains, branch URLs)
      // shouldn't brick boot, but a misconfigured value should still be
      // visible in deploy logs.
      .refine(
        (value) => {
          try {
            const { hostname } = new URL(value)
            const ok =
              ADMIN_GRAPHQL_URL_HOST_ALLOWLIST_EXACTS.includes(
                hostname as (typeof ADMIN_GRAPHQL_URL_HOST_ALLOWLIST_EXACTS)[number],
              ) ||
              ADMIN_GRAPHQL_URL_HOST_ALLOWLIST_SUFFIXES.some((suffix) =>
                hostname.endsWith(suffix),
              )
            if (!ok && typeof console !== "undefined") {
              console.warn(
                `[env] ADMIN_GRAPHQL_URL host "${hostname}" is outside the soft allowlist (jesusfilm.org / *.jesusfilm.org / *.railway.app / *.local / localhost / 127.0.0.1). Continuing without throwing — verify this is intentional.`,
              )
            }
          } catch {
            // The outer z.url() already validates URL shape; if URL parsing
            // fails here we let z.url()'s error surface instead.
          }
          // Warn-only: always pass refinement so misconfigured hosts don't
          // brick boot in legitimate-but-unknown deployment topologies.
          return true
        },
        { message: "unreachable" },
      ),
  },
  client: {
    NEXT_PUBLIC_GRAPHQL_URL: z.url(),
    // U12 — Mux watch-page player migration flag.
    // Boolean env var (true|false). Per-environment value, no per-user
    // targeting. When `true`, VideoHero/Video/CarouselVideo render via
    // `@mux/mux-video-react` wrappers from `@forge/video-player`. Default
    // `false` keeps the existing video.js path live until rollout.
    // R19 trigger: drop `video.js` from apps/web after this has been `true`
    // in production for one stable release.
    NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION: z.coerce.boolean().default(false),
    // U5 — Mux Data env key for the watch-page Mux Player. Optional because
    // not all environments (preview / local) have Mux Data set up; when
    // unset, the player simply does not emit Mux Data beacons.
    NEXT_PUBLIC_MUX_DATA_ENV_KEY: z.string().optional(),
    // U10 — Canonical absolute origin used by the watch-page Share modal to
    // build sharable Copy Link / Copy Embed Code values that DO include
    // `/watch/` (the Next.js basePath). Defaults to `http://localhost:3000`
    // for safer dev / CI experience — `z.url()` would otherwise hard-fail
    // boot on environments where the value isn't set explicitly. Production
    // and preview must override to `https://jesusfilm.org` (or equivalent).
    //
    // F21: refine with a soft allowlist of known-good host shapes. When a
    // value falls outside the allowlist we WARN at module-import time
    // (visible in the deploy logs) but do NOT throw — staging, preview, and
    // partner-co-deployed instances may legitimately use other hosts (custom
    // domains, branch URLs, etc.) and we don't want a config drift in those
    // environments to brick the entire app boot. The warning makes a
    // misconfigured / leaked env value visible to whoever reads logs while
    // still letting unrelated deployments stand up cleanly.
    NEXT_PUBLIC_CANONICAL_ORIGIN: z
      .url()
      .default("http://localhost:3000")
      .refine(
        (value) => {
          try {
            const { hostname } = new URL(value)
            const allowlistedSuffixes = [
              ".jesusfilm.org",
              ".local",
              ".railway.app",
            ]
            const allowlistedExacts = [
              "jesusfilm.org",
              "localhost",
              "127.0.0.1",
            ]
            const ok =
              allowlistedExacts.includes(hostname) ||
              allowlistedSuffixes.some((suffix) => hostname.endsWith(suffix))
            if (!ok && typeof console !== "undefined") {
              console.warn(
                `[env] NEXT_PUBLIC_CANONICAL_ORIGIN host "${hostname}" is outside the soft allowlist (jesusfilm.org / *.jesusfilm.org / *.local / *.railway.app / localhost / 127.0.0.1). Continuing without throwing — verify this is intentional.`,
              )
            }
          } catch {
            // The outer z.url() already validates the URL shape; if URL
            // parsing fails here we let z.url()'s error surface instead.
          }
          // Warn-only: always pass refinement so misconfigured hosts don't
          // brick boot in legitimate-but-unknown deployment topologies.
          return true
        },
        { message: "unreachable" },
      ),
  },
  runtimeEnv: {
    INTERNAL_GRAPHQL_URL: process.env.INTERNAL_GRAPHQL_URL,
    STRAPI_API_TOKEN: process.env.STRAPI_API_TOKEN,
    STRAPI_PREVIEW_SECRET: process.env.STRAPI_PREVIEW_SECRET,
    REVALIDATION_SECRET: process.env.REVALIDATION_SECRET,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    FORGE_CONTENT_API: process.env.FORGE_CONTENT_API,
    ADMIN_GRAPHQL_URL: process.env.ADMIN_GRAPHQL_URL,
    NEXT_PUBLIC_GRAPHQL_URL: process.env.NEXT_PUBLIC_GRAPHQL_URL,
    NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION:
      process.env.NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION,
    NEXT_PUBLIC_MUX_DATA_ENV_KEY: process.env.NEXT_PUBLIC_MUX_DATA_ENV_KEY,
    NEXT_PUBLIC_CANONICAL_ORIGIN: process.env.NEXT_PUBLIC_CANONICAL_ORIGIN,
  },
})
