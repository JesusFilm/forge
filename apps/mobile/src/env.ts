import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

// Metro only reliably inlines process.env.EXPO_PUBLIC_* at module scope.
// References nested inside createEnv() arguments are not consistently
// replaced during eas update bundling. These top-level reads ensure the
// values are inlined and the error message surfaces them if validation fails.
const _inlined = {
  ios: process.env.EXPO_PUBLIC_GRAPHQL_URL_IOS,
  android: process.env.EXPO_PUBLIC_GRAPHQL_URL_ANDROID,
  token: process.env.EXPO_PUBLIC_STRAPI_TOKEN,
}
void _inlined

const createAppEnv = () =>
  createEnv({
    clientPrefix: "EXPO_PUBLIC_",
    client: {
      EXPO_PUBLIC_GRAPHQL_URL_IOS: z.string().url(),
      EXPO_PUBLIC_GRAPHQL_URL_ANDROID: z.string().url(),
      EXPO_PUBLIC_STRAPI_TOKEN: z.string().optional(),
    },
    runtimeEnvStrict: {
      EXPO_PUBLIC_GRAPHQL_URL_IOS: process.env.EXPO_PUBLIC_GRAPHQL_URL_IOS,
      EXPO_PUBLIC_GRAPHQL_URL_ANDROID:
        process.env.EXPO_PUBLIC_GRAPHQL_URL_ANDROID,
      EXPO_PUBLIC_STRAPI_TOKEN: process.env.EXPO_PUBLIC_STRAPI_TOKEN,
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
    `Env validation failed. Inlined: IOS="${_inlined.ios}" ANDROID="${_inlined.android}" TOKEN=${_inlined.token ? "set" : "MISSING"}. Original: ${e instanceof Error ? e.message : e}`,
    { cause: e },
  )
}

export { env }
