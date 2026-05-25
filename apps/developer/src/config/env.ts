import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

export const env = createEnv({
  server: {
    AUTH_DATABASE_URL: z.string().min(1),
    AUTH_ISSUER_URL: z.string().url(),
    AUTH_DEVELOPER_CLIENT_ID: z.string().min(1),
    AUTH_DEVELOPER_CLIENT_SECRET: z.string().min(1).optional(),
    DEVELOPER_BASE_URL: z.string().url(),
    DEVELOPER_SESSION_SECRET: z.string().min(32),
  },
  runtimeEnv: {
    AUTH_DATABASE_URL: process.env.AUTH_DATABASE_URL,
    AUTH_ISSUER_URL: process.env.AUTH_ISSUER_URL,
    AUTH_DEVELOPER_CLIENT_ID: process.env.AUTH_DEVELOPER_CLIENT_ID,
    AUTH_DEVELOPER_CLIENT_SECRET: process.env.AUTH_DEVELOPER_CLIENT_SECRET,
    DEVELOPER_BASE_URL: process.env.DEVELOPER_BASE_URL,
    DEVELOPER_SESSION_SECRET: process.env.DEVELOPER_SESSION_SECRET,
  },
  skipValidation:
    !!process.env.CI ||
    process.env.NODE_ENV === "test" ||
    process.env.NEXT_PHASE === "phase-production-build",
  emptyStringAsUndefined: true,
})
