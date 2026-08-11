import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

// Metro only reliably inlines process.env.EXPO_PUBLIC_* at module scope.
const _inlined = {
  adminGraphqlUrl: process.env.EXPO_PUBLIC_ADMIN_GRAPHQL_URL,
  adminGraphqlToken: process.env.EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN,
  cachePersist: process.env.EXPO_PUBLIC_FORGE_CACHE_PERSIST,
  datadogClientToken: process.env.EXPO_PUBLIC_DATADOG_CLIENT_TOKEN,
  datadogApplicationId: process.env.EXPO_PUBLIC_DATADOG_APPLICATION_ID,
  datadogSite: process.env.EXPO_PUBLIC_DATADOG_SITE,
  datadogEnv: process.env.EXPO_PUBLIC_DATADOG_ENV,
  datadogVersion: process.env.EXPO_PUBLIC_DATADOG_VERSION,
  datadogSessionSampleRate: process.env.EXPO_PUBLIC_DATADOG_SESSION_SAMPLE_RATE,
  datadogReplaySampleRate: process.env.EXPO_PUBLIC_DATADOG_REPLAY_SAMPLE_RATE,
  authBaseUrl: process.env.EXPO_PUBLIC_AUTH_BASE_URL,
}
void _inlined

const DEFAULT_ADMIN_GRAPHQL_URL = "https://admin.jesusfilm.org/api/graphql"

const createAppEnv = () =>
  createEnv({
    clientPrefix: "EXPO_PUBLIC_",
    client: {
      EXPO_PUBLIC_ADMIN_GRAPHQL_URL: z.string().url().optional(),
      // Consumer bearer for admin's search auth (WEB_ADMIN_API_KEYS class).
      // Optional so builds without a provisioned key keep booting; search
      // then runs anonymous and fails only where admin requires auth.
      EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN: z.string().optional(),
      // Opt-in cache persistence (default off). Optional so default builds need
      // no new env var; the consumer falls back to "disabled".
      EXPO_PUBLIC_FORGE_CACHE_PERSIST: z.string().optional(),
      // Datadog RUM/Logs — all optional so an unprovisioned build still boots
      // (datadog.ts null-gates telemetry when creds are absent). Client token is
      // public (in-bundle); the API key is a build-time EAS secret, never here.
      EXPO_PUBLIC_DATADOG_CLIENT_TOKEN: z.string().optional(),
      EXPO_PUBLIC_DATADOG_APPLICATION_ID: z.string().optional(),
      EXPO_PUBLIC_DATADOG_SITE: z.string().optional(),
      EXPO_PUBLIC_DATADOG_ENV: z.string().optional(),
      EXPO_PUBLIC_DATADOG_VERSION: z.string().optional(),
      // Per-environment sample rates (R5) — production dials toward web's 50%
      // without a code change. Strings (Metro inlines env as strings); parsed
      // by datadog.ts's parseSampleRate.
      EXPO_PUBLIC_DATADOG_SESSION_SAMPLE_RATE: z.string().optional(),
      EXPO_PUBLIC_DATADOG_REPLAY_SAMPLE_RATE: z.string().optional(),
      // Auth service base URL — optional; unset falls back to production
      // auth so store builds need no new env var.
      EXPO_PUBLIC_AUTH_BASE_URL: z.string().url().optional(),
    },
    runtimeEnvStrict: {
      EXPO_PUBLIC_ADMIN_GRAPHQL_URL: process.env.EXPO_PUBLIC_ADMIN_GRAPHQL_URL,
      EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN:
        process.env.EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN,
      EXPO_PUBLIC_FORGE_CACHE_PERSIST:
        process.env.EXPO_PUBLIC_FORGE_CACHE_PERSIST,
      EXPO_PUBLIC_DATADOG_CLIENT_TOKEN:
        process.env.EXPO_PUBLIC_DATADOG_CLIENT_TOKEN,
      EXPO_PUBLIC_DATADOG_APPLICATION_ID:
        process.env.EXPO_PUBLIC_DATADOG_APPLICATION_ID,
      EXPO_PUBLIC_DATADOG_SITE: process.env.EXPO_PUBLIC_DATADOG_SITE,
      EXPO_PUBLIC_DATADOG_ENV: process.env.EXPO_PUBLIC_DATADOG_ENV,
      EXPO_PUBLIC_DATADOG_VERSION: process.env.EXPO_PUBLIC_DATADOG_VERSION,
      EXPO_PUBLIC_DATADOG_SESSION_SAMPLE_RATE:
        process.env.EXPO_PUBLIC_DATADOG_SESSION_SAMPLE_RATE,
      EXPO_PUBLIC_DATADOG_REPLAY_SAMPLE_RATE:
        process.env.EXPO_PUBLIC_DATADOG_REPLAY_SAMPLE_RATE,
      EXPO_PUBLIC_AUTH_BASE_URL: process.env.EXPO_PUBLIC_AUTH_BASE_URL,
    },
    isServer: false,
    emptyStringAsUndefined: true,
    skipValidation: !!process.env.CI && !process.env.EAS_BUILD,
  })

let env: ReturnType<typeof createAppEnv>
try {
  env = createAppEnv()
} catch (e) {
  throw new Error(
    `Env validation failed. Inlined: ADMIN_GRAPHQL_URL="${_inlined.adminGraphqlUrl}". Original: ${e instanceof Error ? e.message : e}`,
    { cause: e },
  )
}

export { env, DEFAULT_ADMIN_GRAPHQL_URL }
