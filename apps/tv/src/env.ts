import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

// Metro only reliably inlines process.env.EXPO_PUBLIC_* at module scope; reads
// nested in createEnv() args aren't consistently replaced during eas update
// bundling. These top-level reads force inlining so validation can surface them.
const _inlined = {
  url: process.env.EXPO_PUBLIC_GRAPHQL_URL,
  token: process.env.EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN,
  ddClientToken: process.env.EXPO_PUBLIC_DATADOG_CLIENT_TOKEN,
  ddApplicationId: process.env.EXPO_PUBLIC_DATADOG_APPLICATION_ID,
  ddSite: process.env.EXPO_PUBLIC_DATADOG_SITE,
  ddEnv: process.env.EXPO_PUBLIC_DATADOG_ENV,
  ddVersion: process.env.EXPO_PUBLIC_DATADOG_VERSION,
}
void _inlined

const createAppEnv = () =>
  createEnv({
    clientPrefix: "EXPO_PUBLIC_",
    client: {
      EXPO_PUBLIC_GRAPHQL_URL: z.string().url(),
      EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN: z.string().optional(),
      // Datadog RUM — optional so an unprovisioned build still boots (telemetry
      // is skipped unless client token + app id are both set). Client token, NOT
      // an API key. Site is the mobile enum (e.g. "US1"), not web's "datadoghq.com".
      EXPO_PUBLIC_DATADOG_CLIENT_TOKEN: z.string().optional(),
      EXPO_PUBLIC_DATADOG_APPLICATION_ID: z.string().optional(),
      EXPO_PUBLIC_DATADOG_SITE: z.string().optional(),
      EXPO_PUBLIC_DATADOG_ENV: z.string().optional(),
      EXPO_PUBLIC_DATADOG_VERSION: z.string().optional(),
    },
    runtimeEnvStrict: {
      EXPO_PUBLIC_GRAPHQL_URL: process.env.EXPO_PUBLIC_GRAPHQL_URL,
      EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN:
        process.env.EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN,
      EXPO_PUBLIC_DATADOG_CLIENT_TOKEN:
        process.env.EXPO_PUBLIC_DATADOG_CLIENT_TOKEN,
      EXPO_PUBLIC_DATADOG_APPLICATION_ID:
        process.env.EXPO_PUBLIC_DATADOG_APPLICATION_ID,
      EXPO_PUBLIC_DATADOG_SITE: process.env.EXPO_PUBLIC_DATADOG_SITE,
      EXPO_PUBLIC_DATADOG_ENV: process.env.EXPO_PUBLIC_DATADOG_ENV,
      EXPO_PUBLIC_DATADOG_VERSION: process.env.EXPO_PUBLIC_DATADOG_VERSION,
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
    `Env validation failed. Inlined: URL="${_inlined.url}" TOKEN=${_inlined.token ? "set" : "MISSING"}. Original: ${e instanceof Error ? e.message : e}`,
    { cause: e },
  )
}

export { env }
