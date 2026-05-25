import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

// Metro only reliably inlines process.env.EXPO_PUBLIC_* at module scope.
const _inlined = {
  adminGraphqlUrl: process.env.EXPO_PUBLIC_ADMIN_GRAPHQL_URL,
}
void _inlined

const DEFAULT_ADMIN_GRAPHQL_URL = "https://admin.jesusfilm.org/api/graphql"

const createAppEnv = () =>
  createEnv({
    clientPrefix: "EXPO_PUBLIC_",
    client: {
      EXPO_PUBLIC_ADMIN_GRAPHQL_URL: z.string().url().optional(),
    },
    runtimeEnvStrict: {
      EXPO_PUBLIC_ADMIN_GRAPHQL_URL: process.env.EXPO_PUBLIC_ADMIN_GRAPHQL_URL,
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
