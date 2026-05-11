import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

export const env = createEnv({
  server: {
    INTERNAL_ADMIN_GRAPHQL_URL: z.url(),
    STRAPI_PREVIEW_SECRET: z.string(),
    REVALIDATION_SECRET: z.string(),
    // Optional: used only by the /demo-search AI experience generator.
    // Absent in most preview environments; the server action surfaces a
    // graceful "not configured" state when unset.
    OPENROUTER_API_KEY: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_ADMIN_GRAPHQL_URL: z.url(),
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
    INTERNAL_ADMIN_GRAPHQL_URL: process.env.INTERNAL_ADMIN_GRAPHQL_URL,
    STRAPI_PREVIEW_SECRET: process.env.STRAPI_PREVIEW_SECRET,
    REVALIDATION_SECRET: process.env.REVALIDATION_SECRET,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    NEXT_PUBLIC_ADMIN_GRAPHQL_URL: process.env.NEXT_PUBLIC_ADMIN_GRAPHQL_URL,
    NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION:
      process.env.NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION,
    NEXT_PUBLIC_MUX_DATA_ENV_KEY: process.env.NEXT_PUBLIC_MUX_DATA_ENV_KEY,
    NEXT_PUBLIC_CANONICAL_ORIGIN: process.env.NEXT_PUBLIC_CANONICAL_ORIGIN,
  },
})
