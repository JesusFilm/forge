import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"
import { MOBILE_APP_SCHEME } from "@/auth/mobile-session"
import { createOAuthResourceCatalog } from "@/domain/oauth-resources"

const emptyToUndefined = (value: string | undefined) =>
  value === "" ? undefined : value

const productionDefault = (productionValue: string, localValue: string) =>
  process.env.NODE_ENV === "production" ? productionValue : localValue

export const env = createEnv({
  server: {
    AUTH_BASE_URL: z.string().url().optional(),
    BETTER_AUTH_SECRET: z.string().min(1).optional(),
    AUTH_COOKIE_DOMAIN: z.string().min(1).optional(),
    AUTH_WEB_TRUSTED_ORIGINS: z.string().min(1).optional(),
    DATABASE_URL: z.string().url().optional(),
    FACEBOOK_CLIENT_ID: z.string().min(1).optional(),
    FACEBOOK_CLIENT_SECRET: z.string().min(1).optional(),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    APPLE_CLIENT_ID: z.string().min(1).optional(),
    APPLE_CLIENT_SECRET: z.string().min(1).optional(),
    APPLE_APP_BUNDLE_ID: z.string().min(1).optional(),
    APPLE_NATIVE_CLIENT_SECRET: z.string().min(1).optional(),
    ADMIN_WATCH_PROGRESS_BASE_URL: z.string().url().optional(),
    ADMIN_WATCH_PROGRESS_API_KEY: z.string().min(1).optional(),
    OKTA_CLIENT_ID: z.string().min(1).optional(),
    OKTA_CLIENT_SECRET: z.string().min(1).optional(),
    OKTA_ISSUER: z.string().url().optional(),
    AUTH_VALID_AUDIENCES: z.string().min(1).optional(),
    AUTH_CHANGELOG_PRODUCTION_ENABLED: z
      .enum(["true", "false"])
      .default("false"),
    FIREBASE_WEB_API_KEY: z.string().min(1).optional(),
    FIREBASE_PROJECT_ID: z.string().min(1).optional(),
    FIREBASE_CLIENT_EMAIL: z.string().email().optional(),
    FIREBASE_PRIVATE_KEY: z.string().min(1).optional(),
    AGENT_LOGIN_MINTING_KEY: z.string().min(1).optional(),
    REDIS_HOST: z.string().min(1).optional(),
    REDIS_PORT: z.coerce.number().int().positive().optional(),
    REDIS_PASSWORD: z.string().min(1).optional(),
  },
  runtimeEnv: {
    AUTH_BASE_URL: emptyToUndefined(process.env.AUTH_BASE_URL),
    BETTER_AUTH_SECRET: emptyToUndefined(process.env.BETTER_AUTH_SECRET),
    AUTH_COOKIE_DOMAIN: emptyToUndefined(process.env.AUTH_COOKIE_DOMAIN),
    AUTH_WEB_TRUSTED_ORIGINS: emptyToUndefined(
      process.env.AUTH_WEB_TRUSTED_ORIGINS,
    ),
    DATABASE_URL: emptyToUndefined(process.env.DATABASE_URL),
    FACEBOOK_CLIENT_ID: emptyToUndefined(process.env.FACEBOOK_CLIENT_ID),
    FACEBOOK_CLIENT_SECRET: emptyToUndefined(
      process.env.FACEBOOK_CLIENT_SECRET,
    ),
    GOOGLE_CLIENT_ID: emptyToUndefined(process.env.GOOGLE_CLIENT_ID),
    GOOGLE_CLIENT_SECRET: emptyToUndefined(process.env.GOOGLE_CLIENT_SECRET),
    APPLE_CLIENT_ID: emptyToUndefined(process.env.APPLE_CLIENT_ID),
    APPLE_CLIENT_SECRET: emptyToUndefined(process.env.APPLE_CLIENT_SECRET),
    APPLE_APP_BUNDLE_ID: emptyToUndefined(process.env.APPLE_APP_BUNDLE_ID),
    APPLE_NATIVE_CLIENT_SECRET: emptyToUndefined(
      process.env.APPLE_NATIVE_CLIENT_SECRET,
    ),
    ADMIN_WATCH_PROGRESS_BASE_URL: emptyToUndefined(
      process.env.ADMIN_WATCH_PROGRESS_BASE_URL,
    ),
    ADMIN_WATCH_PROGRESS_API_KEY: emptyToUndefined(
      process.env.ADMIN_WATCH_PROGRESS_API_KEY,
    ),
    OKTA_CLIENT_ID: emptyToUndefined(process.env.OKTA_CLIENT_ID),
    OKTA_CLIENT_SECRET: emptyToUndefined(process.env.OKTA_CLIENT_SECRET),
    OKTA_ISSUER: emptyToUndefined(process.env.OKTA_ISSUER),
    AUTH_VALID_AUDIENCES: emptyToUndefined(process.env.AUTH_VALID_AUDIENCES),
    AUTH_CHANGELOG_PRODUCTION_ENABLED: emptyToUndefined(
      process.env.AUTH_CHANGELOG_PRODUCTION_ENABLED,
    ),
    FIREBASE_WEB_API_KEY: emptyToUndefined(process.env.FIREBASE_WEB_API_KEY),
    FIREBASE_PROJECT_ID: emptyToUndefined(process.env.FIREBASE_PROJECT_ID),
    FIREBASE_CLIENT_EMAIL: emptyToUndefined(process.env.FIREBASE_CLIENT_EMAIL),
    FIREBASE_PRIVATE_KEY: emptyToUndefined(process.env.FIREBASE_PRIVATE_KEY),
    AGENT_LOGIN_MINTING_KEY: emptyToUndefined(
      process.env.AGENT_LOGIN_MINTING_KEY,
    ),
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

function parseOriginList(value: string | undefined): string[] {
  if (!value) return []

  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
    .map((origin) => new URL(origin).origin)
}

// The mobile app's deep-link scheme (apps/mobile app.json). Trusted so the
// Better Auth Expo plugin can hand session cookies back on scheme redirects.
// Derived, so the trusted origin and the mobile session stamp share a source.
export const MOBILE_APP_SCHEME_ORIGIN = `${MOBILE_APP_SCHEME}://`

export function getAuthTrustedOrigins(): string[] {
  const productionWebOrigins = [
    "https://jesusfilm.org",
    "https://www.jesusfilm.org",
    "https://watch.jesusfilm.org",
  ]
  const localWebOrigins =
    process.env.NODE_ENV === "production"
      ? []
      : [
          "http://localhost:3000",
          "http://127.0.0.1:3000",
          "http://localhost:3020",
          "http://127.0.0.1:3020",
          "http://localhost:3030",
          "http://127.0.0.1:3030",
          "http://localhost:3102",
          "http://127.0.0.1:3102",
        ]

  return Array.from(
    new Set([
      getAuthBaseUrl(),
      MOBILE_APP_SCHEME_ORIGIN,
      ...productionWebOrigins,
      ...localWebOrigins,
      ...parseOriginList(env.AUTH_WEB_TRUSTED_ORIGINS),
    ]),
  )
}

export function getAppleNativeClientConfig(): {
  bundleId: string
  clientSecret: string
} | null {
  if (!env.APPLE_APP_BUNDLE_ID || !env.APPLE_NATIVE_CLIENT_SECRET) return null
  return {
    bundleId: env.APPLE_APP_BUNDLE_ID,
    clientSecret: env.APPLE_NATIVE_CLIENT_SECRET,
  }
}

export function getAdminWatchProgressErasureConfig(): {
  baseUrl: string
  apiKey: string
} | null {
  if (!env.ADMIN_WATCH_PROGRESS_BASE_URL || !env.ADMIN_WATCH_PROGRESS_API_KEY) {
    return null
  }
  return {
    baseUrl: env.ADMIN_WATCH_PROGRESS_BASE_URL,
    apiKey: env.ADMIN_WATCH_PROGRESS_API_KEY,
  }
}

export function getAuthCustomAudiences(): string[] {
  return (env.AUTH_VALID_AUDIENCES ?? "")
    .split(",")
    .map((audience) => audience.trim())
    .filter((audience) => audience.length > 0)
}

export function getAuthValidAudiences(): string[] {
  return createOAuthResourceCatalog({
    authIssuer: getAuthBaseUrl(),
    customAudiences: getAuthCustomAudiences(),
  }).map(({ identifier }) => identifier)
}

export function isChangelogProductionEnabled(): boolean {
  return env.AUTH_CHANGELOG_PRODUCTION_ENABLED === "true"
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
