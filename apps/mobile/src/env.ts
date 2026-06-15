import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

// Metro only reliably inlines process.env.EXPO_PUBLIC_* at module scope.
const _inlined = {
  adminGraphqlUrl: process.env.EXPO_PUBLIC_ADMIN_GRAPHQL_URL,
  adminGraphqlToken: process.env.EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN,
  cachePersist: process.env.EXPO_PUBLIC_FORGE_CACHE_PERSIST,
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
    },
    runtimeEnvStrict: {
      EXPO_PUBLIC_ADMIN_GRAPHQL_URL: process.env.EXPO_PUBLIC_ADMIN_GRAPHQL_URL,
      EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN:
        process.env.EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN,
      EXPO_PUBLIC_FORGE_CACHE_PERSIST:
        process.env.EXPO_PUBLIC_FORGE_CACHE_PERSIST,
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
