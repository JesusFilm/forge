import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

const emptyToUndefined = (value: string | undefined) =>
  value === "" ? undefined : value

const productionDefault = (productionValue: string, localValue: string) =>
  process.env.NODE_ENV === "production" ? productionValue : localValue

export const env = createEnv({
  server: {
    AUTH_BASE_URL: z.string().url().optional(),
    BETTER_AUTH_SECRET: z.string().min(1).optional(),
    DATABASE_URL: z.string().url().optional(),
    FACEBOOK_CLIENT_ID: z.string().min(1).optional(),
    FACEBOOK_CLIENT_SECRET: z.string().min(1).optional(),
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
    REDIS_HOST: z.string().min(1).optional(),
    REDIS_PORT: z.coerce.number().int().positive().optional(),
    REDIS_PASSWORD: z.string().min(1).optional(),
  },
  runtimeEnv: {
    AUTH_BASE_URL: emptyToUndefined(process.env.AUTH_BASE_URL),
    BETTER_AUTH_SECRET: emptyToUndefined(process.env.BETTER_AUTH_SECRET),
    DATABASE_URL: emptyToUndefined(process.env.DATABASE_URL),
    FACEBOOK_CLIENT_ID: emptyToUndefined(process.env.FACEBOOK_CLIENT_ID),
    FACEBOOK_CLIENT_SECRET: emptyToUndefined(
      process.env.FACEBOOK_CLIENT_SECRET,
    ),
    GOOGLE_CLIENT_ID: emptyToUndefined(process.env.GOOGLE_CLIENT_ID),
    GOOGLE_CLIENT_SECRET: emptyToUndefined(process.env.GOOGLE_CLIENT_SECRET),
    APPLE_CLIENT_ID: emptyToUndefined(process.env.APPLE_CLIENT_ID),
    APPLE_CLIENT_SECRET: emptyToUndefined(process.env.APPLE_CLIENT_SECRET),
    OKTA_CLIENT_ID: emptyToUndefined(process.env.OKTA_CLIENT_ID),
    OKTA_CLIENT_SECRET: emptyToUndefined(process.env.OKTA_CLIENT_SECRET),
    OKTA_ISSUER: emptyToUndefined(process.env.OKTA_ISSUER),
    FIREBASE_WEB_API_KEY: emptyToUndefined(process.env.FIREBASE_WEB_API_KEY),
    FIREBASE_PROJECT_ID: emptyToUndefined(process.env.FIREBASE_PROJECT_ID),
    FIREBASE_CLIENT_EMAIL: emptyToUndefined(process.env.FIREBASE_CLIENT_EMAIL),
    FIREBASE_PRIVATE_KEY: emptyToUndefined(process.env.FIREBASE_PRIVATE_KEY),
    REDIS_HOST: emptyToUndefined(process.env.REDIS_HOST),
    REDIS_PORT: emptyToUndefined(process.env.REDIS_PORT),
    REDIS_PASSWORD: emptyToUndefined(process.env.REDIS_PASSWORD),
  },
  skipValidation: !!process.env.CI,
})

export function getAuthBaseUrl(): string {
  return (
    env.AUTH_BASE_URL ??
    productionDefault("https://auth.jesusfilm.org", "http://localhost:3004")
  )
}

export function assertProductionAuthSecrets(): void {
  const isNextBuild = process.env.NEXT_PHASE === "phase-production-build"
  if (
    process.env.NODE_ENV === "production" &&
    !isNextBuild &&
    (!env.BETTER_AUTH_SECRET || !env.DATABASE_URL)
  ) {
    throw new Error(
      "BETTER_AUTH_SECRET and DATABASE_URL are required in production.",
    )
  }
}
