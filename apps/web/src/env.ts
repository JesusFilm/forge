import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

/**
 * Build a warn-only host-allowlist `.refine()` callback. Always returns
 * true so misconfigured hosts don't brick boot — emits a console.warn so
 * the misconfig is visible in deploy logs. Used by both
 * `ADMIN_GRAPHQL_URL` (server) and `NEXT_PUBLIC_CANONICAL_ORIGIN`
 * (client) — same shape, different allowlists.
 */
function softHostAllowlistRefine(
  varName: string,
  exacts: readonly string[],
  suffixes: readonly string[],
): (value: string) => true {
  const allowlistDescription = [
    ...exacts,
    ...suffixes.map((s) => `*${s}`),
  ].join(" / ")
  return (value) => {
    try {
      const { hostname } = new URL(value)
      const ok =
        exacts.includes(hostname) ||
        suffixes.some((suffix) => hostname.endsWith(suffix))
      if (!ok && typeof console !== "undefined") {
        console.warn(
          `[env] ${varName} host "${hostname}" is outside the soft allowlist (${allowlistDescription}). Continuing without throwing — verify this is intentional.`,
        )
      }
    } catch {
      // The outer z.url() already validates URL shape; if URL parsing
      // fails here we let z.url()'s error surface instead.
    }
    return true
  }
}

function booleanEnv(defaultValue: boolean) {
  return z
    .preprocess((value) => {
      if (typeof value !== "string") return value

      const normalized = value.trim().toLowerCase()
      if (!normalized) return defaultValue
      if (["1", "true", "yes", "y", "on"].includes(normalized)) return true
      if (["0", "false", "no", "n", "off"].includes(normalized)) return false

      return value
    }, z.boolean())
    .default(defaultValue)
}

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
const ADMIN_GRAPHQL_URL_HOST_REJECT_SET = new Set<string>([
  "auth.jesusfilm.org",
])

export const env = createEnv({
  server: {
    // Retained for the /api/preview Next.js draft-mode handler. The data
    // layer no longer talks to Strapi; preview-flow migration to admin is
    // a separate future unit.
    STRAPI_PREVIEW_SECRET: z.string().optional(),
    REVALIDATION_SECRET: z.string(),
    // Optional: used only by the /demo-search AI experience generator.
    // Absent in most preview environments; the server action surfaces a
    // graceful "not configured" state when unset.
    OPENROUTER_API_KEY: z.string().optional(),
    // Optional LaunchDarkly server-side SDK key. When unset, feature flag
    // helpers return local defaults so preview/local environments can boot
    // before LaunchDarkly is provisioned.
    LAUNCHDARKLY_SDK_KEY: z.string().optional(),
    FORGE_WATCH_PLAYER_MIGRATION_DEFAULT: z.string().optional(),
    FORGE_WATCH_HERO_MUX_VIDEO_DEFAULT: z.string().optional(),
    FORGE_WATCH_CTA_TEXT_COPY_DEFAULT: z.string().optional(),
    // Admin GraphQL URL. Required — web's data layer reads from admin.
    ADMIN_GRAPHQL_URL: z
      .url()
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
      .refine(
        softHostAllowlistRefine(
          "ADMIN_GRAPHQL_URL",
          ADMIN_GRAPHQL_URL_HOST_ALLOWLIST_EXACTS,
          ADMIN_GRAPHQL_URL_HOST_ALLOWLIST_SUFFIXES,
        ),
        { message: "unreachable" },
      ),
    // Bearer key web's SSR sends to admin so traffic buckets as
    // `consumer:<key>` rather than `public:<railway-egress-ip>`.
    //
    // Format: single string OR comma-separated CSV mirroring admin's
    // `WEB_ADMIN_API_KEYS` Doppler value. Web reads the first entry as its
    // outbound bearer; admin recognizes any entry as a valid CONSUMER_BEARER.
    // Required — flipped from optional in U13.
    WEB_ADMIN_API_KEYS: z.string().min(1),
  },
  client: {
    // U12 — Mux watch-page player migration flag.
    // Boolean env var (true|false). Per-environment value, no per-user
    // targeting. When `true`, VideoHero/Video/CarouselVideo render via
    // `@mux/mux-video-react` wrappers from `@forge/video-player`. Default
    // `false` keeps the existing video.js path live until rollout.
    // R19 trigger: drop `video.js` from apps/web after this has been `true`
    // in production for one stable release.
    NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION: booleanEnv(false),
    // Watch-hero MuxPlayer → MuxVideo migration flag. Boolean (true|false).
    // Per-environment value, no per-user targeting. When `true`, the watch
    // page's HeroPlayer renders `@mux/mux-video-react` instead of
    // `@mux/mux-player-react`, dropping ~420 KB gzip of player chrome +
    // cast support that the existing React-rendered HeroPlayerControls
    // already replaces. Default `false` keeps the existing path live until
    // rollout. After one stable release at `true` in prod, follow-up PR
    // removes the flag-off branch from HeroPlayer.tsx.
    // See docs/plans/2026-05-26-005-refactor-watch-hero-muxplayer-to-muxvideo-beta-plan.md
    NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO: booleanEnv(false),
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
        softHostAllowlistRefine(
          "NEXT_PUBLIC_CANONICAL_ORIGIN",
          ["jesusfilm.org", "localhost", "127.0.0.1"],
          [".jesusfilm.org", ".local", ".railway.app"],
        ),
        { message: "unreachable" },
      ),
  },
  runtimeEnv: {
    STRAPI_PREVIEW_SECRET: process.env.STRAPI_PREVIEW_SECRET,
    REVALIDATION_SECRET: process.env.REVALIDATION_SECRET,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    LAUNCHDARKLY_SDK_KEY: process.env.LAUNCHDARKLY_SDK_KEY,
    FORGE_WATCH_PLAYER_MIGRATION_DEFAULT:
      process.env.FORGE_WATCH_PLAYER_MIGRATION_DEFAULT,
    FORGE_WATCH_HERO_MUX_VIDEO_DEFAULT:
      process.env.FORGE_WATCH_HERO_MUX_VIDEO_DEFAULT,
    FORGE_WATCH_CTA_TEXT_COPY_DEFAULT:
      process.env.FORGE_WATCH_CTA_TEXT_COPY_DEFAULT,
    ADMIN_GRAPHQL_URL: process.env.ADMIN_GRAPHQL_URL,
    WEB_ADMIN_API_KEYS: process.env.WEB_ADMIN_API_KEYS,
    NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION:
      process.env.NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION,
    NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO:
      process.env.NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO,
    NEXT_PUBLIC_MUX_DATA_ENV_KEY: process.env.NEXT_PUBLIC_MUX_DATA_ENV_KEY,
    NEXT_PUBLIC_CANONICAL_ORIGIN: process.env.NEXT_PUBLIC_CANONICAL_ORIGIN,
  },
})
