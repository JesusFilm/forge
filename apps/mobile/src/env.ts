import { createEnv } from "@t3-oss/env-core"
import { Platform } from "react-native"
import { z } from "zod"
import {
  decideAdminEndpointAccess,
  reportAdminEndpoint,
  resolveAdminGraphqlUrl,
} from "./lib/adminEndpoint"

// Metro only reliably inlines process.env.EXPO_PUBLIC_* at module scope.
const _inlined = {
  adminGraphqlUrl: process.env.EXPO_PUBLIC_ADMIN_GRAPHQL_URL,
  allowProductionAdmin: process.env.EXPO_PUBLIC_ALLOW_PRODUCTION_ADMIN,
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
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
}
void _inlined

const createAppEnv = () =>
  createEnv({
    clientPrefix: "EXPO_PUBLIC_",
    client: {
      EXPO_PUBLIC_ADMIN_GRAPHQL_URL: z.string().url().optional(),
      // Escape hatch for the development-build refusal below. Optional, never
      // required: a required var would pass CI and crash on a device instead.
      EXPO_PUBLIC_ALLOW_PRODUCTION_ADMIN: z.string().optional(),
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
      // Google OAuth client ids for native sign-in (webClientId mints the
      // idToken audience auth verifies; iOS id configures the sheet).
      // Optional so unprovisioned builds boot with Google sign-in hidden.
      EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: z.string().optional(),
      EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: z.string().optional(),
    },
    runtimeEnvStrict: {
      EXPO_PUBLIC_ADMIN_GRAPHQL_URL: process.env.EXPO_PUBLIC_ADMIN_GRAPHQL_URL,
      EXPO_PUBLIC_ALLOW_PRODUCTION_ADMIN:
        process.env.EXPO_PUBLIC_ALLOW_PRODUCTION_ADMIN,
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
      EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID:
        process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
      EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID:
        process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
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

// Module scope is the earliest app-owned code and the only seam guaranteed to
// run before all three getGraphQLUrl() callers. The throw surfaces on the RN
// dev overlay, NOT _layout.tsx's Startup Error panel (see the KTD1 correction).
const resolvedAdminGraphqlUrl = resolveAdminGraphqlUrl(
  env.EXPO_PUBLIC_ADMIN_GRAPHQL_URL,
  __DEV__,
  Platform.OS,
)

const adminEndpointAccess = decideAdminEndpointAccess(
  resolvedAdminGraphqlUrl,
  __DEV__,
  env.EXPO_PUBLIC_ALLOW_PRODUCTION_ADMIN,
)
if (!adminEndpointAccess.allowed) {
  throw new Error(adminEndpointAccess.message)
}

// Once per Metro start — not inside getGraphQLUrl(), which the Datadog provider
// re-invokes on every render.
reportAdminEndpoint(resolvedAdminGraphqlUrl, __DEV__)

export { env }
