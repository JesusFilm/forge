import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

// Doppler sends empty strings for unconfigured vars. Zod's `.optional()`
// only matches `undefined`, so `""` fails `.min(1)`. Coerce empties to
// `undefined` before validation.
const emptyToUndefined = (v: string | undefined) => (v === "" ? undefined : v)

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
    // Cookie domain for cross-subdomain auth. Set to `.jesusfilm.org` in
    // production so all apps on *.jesusfilm.org share the session cookie.
    // Omit in local dev to default to host-only (localhost).
    AUTH_COOKIE_DOMAIN: z.string().min(1).optional(),
    // Comma-separated origins allowed to call the auth API cross-origin.
    // e.g. "https://web.jesusfilm.org,https://manager.jesusfilm.org"
    AUTH_TRUSTED_ORIGINS: z.string().min(1).optional(),
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
    FIREBASE_MIGRATION_CUTOFF_AT: z.string().datetime().optional(),
    REDIS_HOST: z.string().min(1).optional(),
    REDIS_PORT: z.coerce.number().int().positive().optional(),
    REDIS_PASSWORD: z.string().min(1).optional(),
    GRAPHQL_INTROSPECTION_ENABLED: z.string().optional(),
    CORS_ALLOWED_ORIGINS: z.string().min(1).optional(),
    CORE_API_URL: z.string().url().optional(),
    CORE_API_TOKEN: z.string().min(1).optional(),
    CORE_API_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
    CORE_API_RETRIES: z.coerce.number().int().min(0).optional(),
    OPENROUTER_API_KEY: z.string().min(1).optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    OPENAI_BASE_URL: z.string().url().optional(),
    WORKFLOW_API_KEYS: z.string().min(1).optional(),
    WORKFLOW_HMAC_SECRET: z.string().min(1).optional(),
    WORKFLOW_TARGET_WORLD: z
      .enum(["local", "@workflow/world-postgres"])
      .optional(),
    WORKFLOW_POSTGRES_URL: z.string().url().optional(),
    WORKFLOW_POSTGRES_JOB_PREFIX: z.string().min(1).optional(),
    WORKFLOW_POSTGRES_WORKER_CONCURRENCY: z.coerce
      .number()
      .int()
      .positive()
      .optional(),
    WORKFLOW_POSTGRES_MAX_POOL_SIZE: z.coerce
      .number()
      .int()
      .positive()
      .optional(),
    RAILWAY_S3_ENDPOINT: z.string().url().optional(),
    RAILWAY_S3_REGION: z.string().min(1).optional(),
    RAILWAY_S3_BUCKET: z.string().min(1).optional(),
    RAILWAY_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    RAILWAY_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    // Manager artifacts bucket — admin reads {assetId}/scene-analysis.json
    // and {assetId}/embeddings.json from apps/manager's S3 bucket via
    // readManagerArtifact() in src/storage/s3.ts. Distinct from
    // RAILWAY_S3_*, which is admin's own write bucket (cms-storage,
    // used for admin-migrations/core-id-mapping.json etc.). Read-only
    // at the code layer: src/storage/s3.ts intentionally exposes no
    // writeManagerArtifact helper.
    MANAGER_ARTIFACTS_S3_ENDPOINT: z.string().url().optional(),
    MANAGER_ARTIFACTS_S3_REGION: z.string().min(1).optional(),
    MANAGER_ARTIFACTS_S3_BUCKET: z.string().min(1).optional(),
    MANAGER_ARTIFACTS_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    MANAGER_ARTIFACTS_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    // R3 — read-only Postgres URL for cms (Strapi v5). Optional at boot
    // so admin still starts in environments without the dump enabled.
    // The cms-pg singleton (`src/db/cms-pg.ts`) throws a clean
    // configuration error if a runtime caller invokes it without this
    // env set. Recommend a dedicated read-only PG role on cms.
    CMS_DATABASE_URL: z.string().url().optional(),
    NEXT_RUNTIME: z.enum(["nodejs", "edge"]).optional(),
    NODE_ENV: z.enum(["development", "test", "production"]).optional(),
  },
  client: {
    NEXT_PUBLIC_APP_NAME: z.string().min(1).default("forge-admin"),
  },
  skipValidation: !!process.env.CI,
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_SYNC: emptyToUndefined(process.env.DATABASE_URL_SYNC),
    BETTER_AUTH_SECRET: emptyToUndefined(process.env.BETTER_AUTH_SECRET),
    BETTER_AUTH_URL: emptyToUndefined(process.env.BETTER_AUTH_URL),
    AUTH_COOKIE_DOMAIN: emptyToUndefined(process.env.AUTH_COOKIE_DOMAIN),
    AUTH_TRUSTED_ORIGINS: emptyToUndefined(process.env.AUTH_TRUSTED_ORIGINS),
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
    FIREBASE_MIGRATION_CUTOFF_AT: emptyToUndefined(
      process.env.FIREBASE_MIGRATION_CUTOFF_AT,
    ),
    REDIS_HOST: emptyToUndefined(process.env.REDIS_HOST),
    REDIS_PORT: emptyToUndefined(process.env.REDIS_PORT),
    REDIS_PASSWORD: emptyToUndefined(process.env.REDIS_PASSWORD),
    GRAPHQL_INTROSPECTION_ENABLED: emptyToUndefined(
      process.env.GRAPHQL_INTROSPECTION_ENABLED,
    ),
    CORS_ALLOWED_ORIGINS: emptyToUndefined(process.env.CORS_ALLOWED_ORIGINS),
    CORE_API_URL: emptyToUndefined(process.env.CORE_API_URL),
    CORE_API_TOKEN: emptyToUndefined(process.env.CORE_API_TOKEN),
    CORE_API_TIMEOUT_MS: emptyToUndefined(process.env.CORE_API_TIMEOUT_MS),
    CORE_API_RETRIES: emptyToUndefined(process.env.CORE_API_RETRIES),
    OPENROUTER_API_KEY: emptyToUndefined(process.env.OPENROUTER_API_KEY),
    OPENAI_API_KEY: emptyToUndefined(process.env.OPENAI_API_KEY),
    OPENAI_BASE_URL: emptyToUndefined(process.env.OPENAI_BASE_URL),
    WORKFLOW_API_KEYS: emptyToUndefined(process.env.WORKFLOW_API_KEYS),
    WORKFLOW_HMAC_SECRET: emptyToUndefined(process.env.WORKFLOW_HMAC_SECRET),
    WORKFLOW_TARGET_WORLD: emptyToUndefined(process.env.WORKFLOW_TARGET_WORLD),
    WORKFLOW_POSTGRES_URL: emptyToUndefined(process.env.WORKFLOW_POSTGRES_URL),
    WORKFLOW_POSTGRES_JOB_PREFIX: emptyToUndefined(
      process.env.WORKFLOW_POSTGRES_JOB_PREFIX,
    ),
    WORKFLOW_POSTGRES_WORKER_CONCURRENCY: emptyToUndefined(
      process.env.WORKFLOW_POSTGRES_WORKER_CONCURRENCY,
    ),
    WORKFLOW_POSTGRES_MAX_POOL_SIZE: emptyToUndefined(
      process.env.WORKFLOW_POSTGRES_MAX_POOL_SIZE,
    ),
    RAILWAY_S3_ENDPOINT: emptyToUndefined(process.env.RAILWAY_S3_ENDPOINT),
    RAILWAY_S3_REGION: emptyToUndefined(process.env.RAILWAY_S3_REGION),
    RAILWAY_S3_BUCKET: emptyToUndefined(process.env.RAILWAY_S3_BUCKET),
    RAILWAY_S3_ACCESS_KEY_ID: emptyToUndefined(
      process.env.RAILWAY_S3_ACCESS_KEY_ID,
    ),
    RAILWAY_S3_SECRET_ACCESS_KEY: emptyToUndefined(
      process.env.RAILWAY_S3_SECRET_ACCESS_KEY,
    ),
    MANAGER_ARTIFACTS_S3_ENDPOINT: emptyToUndefined(
      process.env.MANAGER_ARTIFACTS_S3_ENDPOINT,
    ),
    MANAGER_ARTIFACTS_S3_REGION: emptyToUndefined(
      process.env.MANAGER_ARTIFACTS_S3_REGION,
    ),
    MANAGER_ARTIFACTS_S3_BUCKET: emptyToUndefined(
      process.env.MANAGER_ARTIFACTS_S3_BUCKET,
    ),
    MANAGER_ARTIFACTS_S3_ACCESS_KEY_ID: emptyToUndefined(
      process.env.MANAGER_ARTIFACTS_S3_ACCESS_KEY_ID,
    ),
    MANAGER_ARTIFACTS_S3_SECRET_ACCESS_KEY: emptyToUndefined(
      process.env.MANAGER_ARTIFACTS_S3_SECRET_ACCESS_KEY,
    ),
    CMS_DATABASE_URL: emptyToUndefined(process.env.CMS_DATABASE_URL),
    NEXT_RUNTIME: emptyToUndefined(process.env.NEXT_RUNTIME),
    NODE_ENV: emptyToUndefined(process.env.NODE_ENV),
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  },
})
