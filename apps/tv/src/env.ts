import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

// Metro only reliably inlines process.env.EXPO_PUBLIC_* at module scope; reads
// nested in createEnv() args aren't consistently replaced during eas update
// bundling. These top-level reads force inlining so validation can surface them.
const _inlined = {
  url: process.env.EXPO_PUBLIC_GRAPHQL_URL,
  token: process.env.EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN,
}
void _inlined

const createAppEnv = () =>
  createEnv({
    clientPrefix: "EXPO_PUBLIC_",
    client: {
      EXPO_PUBLIC_GRAPHQL_URL: z.string().url(),
      EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN: z.string().optional(),
    },
    runtimeEnvStrict: {
      EXPO_PUBLIC_GRAPHQL_URL: process.env.EXPO_PUBLIC_GRAPHQL_URL,
      EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN:
        process.env.EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN,
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
