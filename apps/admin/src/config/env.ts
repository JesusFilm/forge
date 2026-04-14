import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

// Unit 1 scaffolding shipped a minimal env. Each later unit appends the
// vars it owns here and in runtimeEnv. Never read process.env directly.
export const env = createEnv({
  server: {
    // Unit 2 — Prisma / Postgres
    //
    // DATABASE_URL: main pool. Recommend `?connection_limit=10&pool_timeout=20`.
    // DATABASE_URL_SYNC: dedicated pool for Core sync workflow at
    // `?connection_limit=2` — see src/db/client.ts.
    DATABASE_URL: z.string().url(),
    DATABASE_URL_SYNC: z.string().url().optional(),
    BETTER_AUTH_SECRET: z.string().min(1).optional(),
    BETTER_AUTH_URL: z.string().url().optional(),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    APPLE_CLIENT_ID: z.string().min(1).optional(),
    APPLE_CLIENT_SECRET: z.string().min(1).optional(),
    OKTA_CLIENT_ID: z.string().min(1).optional(),
    OKTA_CLIENT_SECRET: z.string().min(1).optional(),
    OKTA_ISSUER: z.string().url().optional(),
    FIREBASE_WEB_API_KEY: z.string().min(1).optional(),
    FIREBASE_PROJECT_ID: z.string().min(1).optional(),
    FIREBASE_CLIENT_EMAIL: z.string().email().optional(),
    FIREBASE_PRIVATE_KEY: z.string().min(1).optional(),
    FIREBASE_MIGRATION_CUTOFF_AT: z.string().datetime().optional(),
    UPSTASH_REDIS_HOST: z.string().min(1).optional(),
    UPSTASH_REDIS_PORT: z.coerce.number().int().positive().optional(),
    UPSTASH_REDIS_PASSWORD: z.string().min(1).optional(),
    NODE_ENV: z.enum(["development", "test", "production"]).optional(),
  },
  client: {
    NEXT_PUBLIC_APP_NAME: z.string().min(1).default("forge-admin"),
  },
  skipValidation: !!process.env.CI,
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_SYNC: process.env.DATABASE_URL_SYNC,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    APPLE_CLIENT_ID: process.env.APPLE_CLIENT_ID,
    APPLE_CLIENT_SECRET: process.env.APPLE_CLIENT_SECRET,
    OKTA_CLIENT_ID: process.env.OKTA_CLIENT_ID,
    OKTA_CLIENT_SECRET: process.env.OKTA_CLIENT_SECRET,
    OKTA_ISSUER: process.env.OKTA_ISSUER,
    FIREBASE_WEB_API_KEY: process.env.FIREBASE_WEB_API_KEY,
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY,
    FIREBASE_MIGRATION_CUTOFF_AT: process.env.FIREBASE_MIGRATION_CUTOFF_AT,
    UPSTASH_REDIS_HOST: process.env.UPSTASH_REDIS_HOST,
    UPSTASH_REDIS_PORT: process.env.UPSTASH_REDIS_PORT,
    UPSTASH_REDIS_PASSWORD: process.env.UPSTASH_REDIS_PASSWORD,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  },
})
