import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

export const env = createEnv({
  server: {
    INTERNAL_GRAPHQL_URL: z.url(),
    STRAPI_API_TOKEN: z.string(),
    STRAPI_PREVIEW_SECRET: z.string(),
    REVALIDATION_SECRET: z.string(),
  },
  client: {
    NEXT_PUBLIC_GRAPHQL_URL: z.url(),
  },
  runtimeEnv: {
    INTERNAL_GRAPHQL_URL: process.env.INTERNAL_GRAPHQL_URL,
    STRAPI_API_TOKEN: process.env.STRAPI_API_TOKEN,
    STRAPI_PREVIEW_SECRET: process.env.STRAPI_PREVIEW_SECRET,
    REVALIDATION_SECRET: process.env.REVALIDATION_SECRET,
    NEXT_PUBLIC_GRAPHQL_URL: process.env.NEXT_PUBLIC_GRAPHQL_URL,
  },
})
