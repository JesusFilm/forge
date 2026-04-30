import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

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
    NEXT_PUBLIC_CANONICAL_ORIGIN: z.url().default("http://localhost:3000"),
  },
  runtimeEnv: {
    INTERNAL_GRAPHQL_URL: process.env.INTERNAL_GRAPHQL_URL,
    STRAPI_API_TOKEN: process.env.STRAPI_API_TOKEN,
    STRAPI_PREVIEW_SECRET: process.env.STRAPI_PREVIEW_SECRET,
    REVALIDATION_SECRET: process.env.REVALIDATION_SECRET,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    NEXT_PUBLIC_GRAPHQL_URL: process.env.NEXT_PUBLIC_GRAPHQL_URL,
    NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION:
      process.env.NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION,
    NEXT_PUBLIC_MUX_DATA_ENV_KEY: process.env.NEXT_PUBLIC_MUX_DATA_ENV_KEY,
    NEXT_PUBLIC_CANONICAL_ORIGIN: process.env.NEXT_PUBLIC_CANONICAL_ORIGIN,
  },
})
