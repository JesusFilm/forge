import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

export const env = createEnv({
  clientPrefix: "EXPO_PUBLIC_",
  client: {
    EXPO_PUBLIC_GRAPHQL_URL_IOS: z.string().url(),
    EXPO_PUBLIC_GRAPHQL_URL_ANDROID: z.string().url(),
    EXPO_PUBLIC_STRAPI_TOKEN: z.string().optional(),
    EXPO_PUBLIC_WEB_BASE_URL: z.string().optional(),
  },
  runtimeEnvStrict: {
    EXPO_PUBLIC_GRAPHQL_URL_IOS: process.env.EXPO_PUBLIC_GRAPHQL_URL_IOS,
    EXPO_PUBLIC_GRAPHQL_URL_ANDROID:
      process.env.EXPO_PUBLIC_GRAPHQL_URL_ANDROID,
    EXPO_PUBLIC_STRAPI_TOKEN: process.env.EXPO_PUBLIC_STRAPI_TOKEN,
    EXPO_PUBLIC_WEB_BASE_URL: process.env.EXPO_PUBLIC_WEB_BASE_URL,
  },
  isServer: false,
  emptyStringAsUndefined: true,
  skipValidation: !!process.env.CI && !process.env.EAS_BUILD,
})
