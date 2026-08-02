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

function emptyToUndefined(value: string | undefined): string | undefined {
  return value === "" ? undefined : value
}

function productionDefault(
  productionValue: string,
  localValue: string,
): string {
  return process.env.NODE_ENV === "production" ? productionValue : localValue
}

function normalizeDatadogEnv(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  if (!normalized) return undefined

  switch (normalized.toLowerCase()) {
    case "production":
    case "prod":
      return "prod"
    case "staging":
    case "stage":
      return "stage"
    case "preview":
      return "preview"
    case "development":
    case "dev":
      return "development"
    case "test":
      return "test"
    default:
      return normalized
  }
}

function datadogEnvFallback(): string | undefined {
  return normalizeDatadogEnv(
    process.env.NEXT_PUBLIC_DATADOG_ENV ??
      process.env.RAILWAY_ENVIRONMENT_NAME ??
      process.env.VERCEL_ENV ??
      process.env.NODE_ENV,
  )
}

function datadogServerEnvFallback(): string | undefined {
  return normalizeDatadogEnv(
    process.env.DD_ENV ??
      process.env.NEXT_PUBLIC_DATADOG_ENV ??
      process.env.RAILWAY_ENVIRONMENT_NAME ??
      process.env.VERCEL_ENV ??
      process.env.NODE_ENV,
  )
}

function datadogVersionFallback(): string | undefined {
  return (
    emptyToUndefined(process.env.NEXT_PUBLIC_DATADOG_VERSION) ??
    emptyToUndefined(process.env.RAILWAY_GIT_COMMIT_SHA) ??
    emptyToUndefined(process.env.VERCEL_GIT_COMMIT_SHA) ??
    emptyToUndefined(process.env.GIT_COMMIT_SHA)
  )
}

function datadogServerVersionFallback(): string | undefined {
  return emptyToUndefined(process.env.DD_VERSION) ?? datadogVersionFallback()
}

const ADMIN_GRAPHQL_URL_HOST_ALLOWLIST_SUFFIXES = [
  ".jesusfilm.org",
  ".railway.internal",
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

const DATADOG_SITE_VALUES = [
  "datadoghq.com",
  "us3.datadoghq.com",
  "us5.datadoghq.com",
  "datadoghq.eu",
  "ddog-gov.com",
  "ap1.datadoghq.com",
  "ap2.datadoghq.com",
] as const

function optionalPositiveIntDefault(defaultValue: number) {
  return z.preprocess((value) => {
    if (value == null || value === "") return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }, z.number().int().positive().default(defaultValue))
}

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
    FORGE_WATCH_CTA_TEXT_COPY_DEFAULT: z.string().optional(),
    FORGE_WATCH_DOWNLOAD_ACCOUNT_GATE_DEFAULT: z.string().optional(),
    FORGE_WATCH_GLOBAL_BETA_TESTER_CTA_DEFAULT: z.string().optional(),
    FORGE_WATCH_HIDE_BIBLE_QUOTES_DEFAULT: z.string().optional(),
    FORGE_WATCH_QUESTION_PANEL_DEFAULT: z.string().optional(),
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
    // Optional narrower bearer for admin's watch-progress receiver. When unset,
    // local development falls back to WEB_ADMIN_API_KEYS until the dedicated
    // secret is provisioned in the target environment.
    WATCH_PROGRESS_ADMIN_API_KEYS: z.string().min(1).optional(),
    // Shared Auth host used by server routes to verify Better Auth sessions
    // over HTTP. Local development mirrors Admin and uses production Auth by
    // default; CI overrides this to the standalone auth dev port.
    WEB_AUTH_BASE_URL: z.url().default("https://auth.jesusfilm.org"),
    WEB_AUTH_ISSUER_URL: z.url().optional(),
    WEB_AUTH_CLIENT_ID: z.string().min(1).optional(),
    WEB_BASE_URL: z
      .url()
      .default(
        productionDefault("https://web.jesusfilm.org", "http://localhost:3000"),
      ),
    WEB_SESSION_SECRET: z.string().min(32).optional(),
    // Optional server-side Datadog APM/log forwarding configuration. Keep
    // NODE_OPTIONS scoped to Railway's start command; these vars only tell the
    // tracer where to report and how to tag web spans/logs.
    DD_AGENT_HOST: z.string().min(1).optional(),
    DD_TRACE_AGENT_PORT: optionalPositiveIntDefault(8126),
    DD_AGENT_SYSLOG_PORT: optionalPositiveIntDefault(514),
    DD_ENV: z.string().min(1).optional(),
    DD_SERVICE: z.string().min(1).optional(),
    DD_VERSION: z.string().min(1).optional(),
    WATCH_SEARCH_ANALYTICS_INCLUDE_QUERY_TEXT: booleanEnv(true),
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
    // Optional Datadog RUM configuration. Application id + client token gate
    // initialization; when absent, the client component no-ops so local and
    // preview environments can boot before Datadog is provisioned.
    NEXT_PUBLIC_DATADOG_APPLICATION_ID: z.string().optional(),
    NEXT_PUBLIC_DATADOG_CLIENT_TOKEN: z.string().optional(),
    NEXT_PUBLIC_DATADOG_SITE: z
      .enum(DATADOG_SITE_VALUES)
      .default("datadoghq.com"),
    NEXT_PUBLIC_DATADOG_ENV: z.string().default("development"),
    NEXT_PUBLIC_DATADOG_VERSION: z.string().optional(),
    // Optional Google Analytics 4 measurement id. When unset, the analytics
    // component renders nothing so local and preview environments stay quiet.
    NEXT_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID: z.string().optional(),
    // U5 — Mux Data env key for the watch-page Mux Player. Optional because
    // not all environments (preview / local) have Mux Data set up; when
    // unset, the player simply does not emit Mux Data beacons.
    NEXT_PUBLIC_MUX_DATA_ENV_KEY: z.string().optional(),
    // Public Admin GraphQL endpoint used by client-side Watch search reads.
    // Admin's `watchSearch` query is public; production Admin must allow the
    // Web origin in `CORS_ALLOWED_ORIGINS` before browser-direct calls work.
    NEXT_PUBLIC_ADMIN_GRAPHQL_URL: z
      .url()
      .default(
        productionDefault(
          "https://admin.jesusfilm.org/api/graphql",
          "http://localhost:3003/api/graphql",
        ),
      )
      .refine(
        softHostAllowlistRefine(
          "NEXT_PUBLIC_ADMIN_GRAPHQL_URL",
          ADMIN_GRAPHQL_URL_HOST_ALLOWLIST_EXACTS,
          ADMIN_GRAPHQL_URL_HOST_ALLOWLIST_SUFFIXES,
        ),
        { message: "unreachable" },
      ),
    // U10 — Environment-specific absolute origin used by the watch-page Share
    // modal to build sharable Copy Link / Copy Embed Code values that DO
    // include `/watch/` (the Next.js basePath). Defaults to
    // `http://localhost:3000` for safer dev / CI experience — `z.url()` would
    // otherwise hard-fail boot on environments where the value isn't set
    // explicitly. Public SEO/social metadata intentionally does not read this
    // value; it emits the indexed www host from routes.ts.
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
    FORGE_WATCH_CTA_TEXT_COPY_DEFAULT:
      process.env.FORGE_WATCH_CTA_TEXT_COPY_DEFAULT,
    FORGE_WATCH_DOWNLOAD_ACCOUNT_GATE_DEFAULT:
      process.env.FORGE_WATCH_DOWNLOAD_ACCOUNT_GATE_DEFAULT,
    FORGE_WATCH_GLOBAL_BETA_TESTER_CTA_DEFAULT:
      process.env.FORGE_WATCH_GLOBAL_BETA_TESTER_CTA_DEFAULT,
    FORGE_WATCH_HIDE_BIBLE_QUOTES_DEFAULT:
      process.env.FORGE_WATCH_HIDE_BIBLE_QUOTES_DEFAULT,
    FORGE_WATCH_QUESTION_PANEL_DEFAULT:
      process.env.FORGE_WATCH_QUESTION_PANEL_DEFAULT,
    ADMIN_GRAPHQL_URL: process.env.ADMIN_GRAPHQL_URL,
    WEB_ADMIN_API_KEYS: process.env.WEB_ADMIN_API_KEYS,
    WATCH_PROGRESS_ADMIN_API_KEYS: process.env.WATCH_PROGRESS_ADMIN_API_KEYS,
    WEB_AUTH_BASE_URL: emptyToUndefined(process.env.WEB_AUTH_BASE_URL),
    WEB_AUTH_ISSUER_URL: emptyToUndefined(process.env.WEB_AUTH_ISSUER_URL),
    WEB_AUTH_CLIENT_ID: emptyToUndefined(process.env.WEB_AUTH_CLIENT_ID),
    WEB_BASE_URL: emptyToUndefined(process.env.WEB_BASE_URL),
    WEB_SESSION_SECRET: emptyToUndefined(process.env.WEB_SESSION_SECRET),
    DD_AGENT_HOST: emptyToUndefined(process.env.DD_AGENT_HOST),
    DD_TRACE_AGENT_PORT: process.env.DD_TRACE_AGENT_PORT,
    DD_AGENT_SYSLOG_PORT: process.env.DD_AGENT_SYSLOG_PORT,
    DD_ENV: datadogServerEnvFallback(),
    DD_SERVICE: emptyToUndefined(process.env.DD_SERVICE),
    DD_VERSION: datadogServerVersionFallback(),
    WATCH_SEARCH_ANALYTICS_INCLUDE_QUERY_TEXT:
      process.env.WATCH_SEARCH_ANALYTICS_INCLUDE_QUERY_TEXT,
    NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION:
      process.env.NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION,
    NEXT_PUBLIC_DATADOG_APPLICATION_ID:
      process.env.NEXT_PUBLIC_DATADOG_APPLICATION_ID,
    NEXT_PUBLIC_DATADOG_CLIENT_TOKEN:
      process.env.NEXT_PUBLIC_DATADOG_CLIENT_TOKEN,
    NEXT_PUBLIC_DATADOG_SITE: process.env.NEXT_PUBLIC_DATADOG_SITE,
    NEXT_PUBLIC_DATADOG_ENV: datadogEnvFallback(),
    NEXT_PUBLIC_DATADOG_VERSION: datadogVersionFallback(),
    NEXT_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID: emptyToUndefined(
      process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID,
    ),
    NEXT_PUBLIC_MUX_DATA_ENV_KEY: process.env.NEXT_PUBLIC_MUX_DATA_ENV_KEY,
    NEXT_PUBLIC_ADMIN_GRAPHQL_URL: process.env.NEXT_PUBLIC_ADMIN_GRAPHQL_URL,
    NEXT_PUBLIC_CANONICAL_ORIGIN: process.env.NEXT_PUBLIC_CANONICAL_ORIGIN,
  },
})
