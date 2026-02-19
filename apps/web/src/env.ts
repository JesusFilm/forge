import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

export const env = createEnv({
  server: {
    STRAPI_API_TOKEN: z.string(),
    STRAPI_REVALIDATE_TOKEN: z.string().optional(),
    STRAPI_PREVIEW_TOKEN: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_GRAPHQL_URL: z.url(),
  },
  runtimeEnv: {
    STRAPI_API_TOKEN: process.env.STRAPI_API_TOKEN,
    STRAPI_REVALIDATE_TOKEN: process.env.STRAPI_REVALIDATE_TOKEN,
    STRAPI_PREVIEW_TOKEN: process.env.STRAPI_PREVIEW_TOKEN,
    NEXT_PUBLIC_GRAPHQL_URL: process.env.NEXT_PUBLIC_GRAPHQL_URL,
  },
})
