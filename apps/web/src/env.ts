import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

export const env = createEnv({
  server: {
    STRAPI_API_TOKEN: z.string().optional(),
    STRAPI_PREVIEW_SECRET: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_GRAPHQL_URL: z.url(),
  },
  runtimeEnv: {
    STRAPI_API_TOKEN: process.env.STRAPI_API_TOKEN,
    STRAPI_PREVIEW_SECRET: process.env.STRAPI_PREVIEW_SECRET,
    NEXT_PUBLIC_GRAPHQL_URL: process.env.NEXT_PUBLIC_GRAPHQL_URL,
  },
})
