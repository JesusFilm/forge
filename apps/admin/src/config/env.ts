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
  },
  client: {
    NEXT_PUBLIC_APP_NAME: z.string().min(1).default("forge-admin"),
  },
  skipValidation: !!process.env.CI,
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_SYNC: process.env.DATABASE_URL_SYNC,
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  },
})
