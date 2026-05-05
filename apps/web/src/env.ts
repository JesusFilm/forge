import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

export const env = createEnv({
  server: {
    INTERNAL_GRAPHQL_URL: z.url(),
    STRAPI_API_TOKEN: z.string(),
    STRAPI_PREVIEW_SECRET: z.string(),
    REVALIDATION_SECRET: z.string(),
    FORGE_CONTENT_API: z.enum(["strapi", "admin"]).optional(),
    ADMIN_GRAPHQL_URL: z.url().optional(),
    // Optional: used only by the /demo-search AI experience generator.
    // Absent in most preview environments; the server action surfaces a
    // graceful "not configured" state when unset.
    OPENROUTER_API_KEY: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_GRAPHQL_URL: z.url(),
  },
  runtimeEnv: {
    INTERNAL_GRAPHQL_URL: process.env.INTERNAL_GRAPHQL_URL,
    STRAPI_API_TOKEN: process.env.STRAPI_API_TOKEN,
    STRAPI_PREVIEW_SECRET: process.env.STRAPI_PREVIEW_SECRET,
    REVALIDATION_SECRET: process.env.REVALIDATION_SECRET,
    FORGE_CONTENT_API: process.env.FORGE_CONTENT_API as
      | "strapi"
      | "admin"
      | undefined,
    ADMIN_GRAPHQL_URL: process.env.ADMIN_GRAPHQL_URL,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    NEXT_PUBLIC_GRAPHQL_URL: process.env.NEXT_PUBLIC_GRAPHQL_URL,
  },
})
