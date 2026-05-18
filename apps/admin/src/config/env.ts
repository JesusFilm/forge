import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

// Doppler sends empty strings for unconfigured vars. Zod's `.optional()`
// only matches `undefined`, so `""` fails `.min(1)`. Coerce empties to
// `undefined` before validation.
const emptyToUndefined = (v: string | undefined) => (v === "" ? undefined : v)

/**
 * Shared schema fragment for env vars representing a positive-int
 * concurrency cap (e.g. `SCENE_EMBEDDING_CONCURRENCY`,
 * `TRANSCRIPT_EMBEDDING_CONCURRENCY`). Exported so test code and the
 * `run-embeds` CLI can parse via the same shape rather than
 * hand-rolling a parallel parser. Contract: undefined → undefined,
 * positive int (coerced from string) → number, anything else throws.
 */
export const concurrencyEnvSchema = z.coerce
  .number()
  .int()
  .positive()
  .optional()

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
    // Optional Better Auth cookie prefix. Use a unique value for local
    // worktree previews sharing localhost so branches do not overwrite each
    // other's session cookies.
    AUTH_COOKIE_PREFIX: z.string().min(1).optional(),
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
    CORE_SYNC_CRON_SECRET: z.string().min(1).optional(),
    OPENROUTER_API_KEY: z.string().min(1).optional(),
    OPENROUTER_IMAGE_TEXT_MODEL: z.string().min(1).optional(),
    OPENROUTER_IMAGE_TEXT_MODELS: z.string().min(1).optional(),
    OPENROUTER_EXPERIENCE_CHAT_MODEL: z.string().min(1).optional(),
    OPENROUTER_EXPERIENCE_CHAT_MODELS: z.string().min(1).optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    OPENAI_BASE_URL: z.string().url().optional(),
    // Optional admin -> web ISR hook. When configured, Experience locale
    // saves/publishes notify apps/web so published previews reflect edits
    // immediately instead of waiting for the 60s ISR safety window.
    WATCH_REVALIDATION_URL: z.string().url().optional(),
    WATCH_REVALIDATION_SECRET: z.string().min(1).optional(),
    // Legacy codex-CLI gate retained for the (dead-at-call-boundary)
    // `experience-ai.service.ts` draft-generation flow. The CHAT surface
    // is Mastra-only and does not read this var. Removal is a follow-up
    // once the legacy draft service + generate-draft-action are deleted.
    EXPERIENCE_AI_ALLOW_CODEX_FALLBACK: z.coerce.boolean().optional(),
    // Mastra runtime — Postgres-backed memory for the Experience AI chat
    // surface. When unset, memory falls back to admin's DATABASE_URL.
    MASTRA_STORAGE_URL: z.string().url().optional(),
    MASTRA_DEFAULT_PROVIDER: z
      .enum(["openrouter", "ollama", "openai", "anthropic"])
      .optional(),
    // Ollama embedding pipeline (separate from chat — kept for the
    // embedding services that still consume them).
    OLLAMA_BASE_URL: z.string().url().optional(),
    OLLAMA_EMBEDDING_MODEL: z.string().min(1).optional(),
    OLLAMA_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().optional(),
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
    // Per-target concurrency caps for the R1 / R2 embed-backfill
    // workflows (sceneEmbeddingBackfill / transcriptEmbeddingBackfill).
    // Each workflow uses `p-limit(N) + Promise.allSettled` to fan out
    // the per-target loop; one rejection never aborts siblings (cf.
    // docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md).
    // Default at the call site is 10. Tune up locally (20+); tune down
    // in prod (start at 5, ramp after observation).
    SCENE_EMBEDDING_CONCURRENCY: concurrencyEnvSchema,
    TRANSCRIPT_EMBEDDING_CONCURRENCY: concurrencyEnvSchema,
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

    // feat-119 PR2 — admin → manager outbound enrichment trigger.
    // Admin's `triggerManagerEnrichment` GraphQL mutation POSTs to
    // apps/manager's `/api/admin-trigger/{scene-analysis,transcript}`
    // endpoint. Both are optional at boot so admin keeps starting
    // when the trigger surface isn't configured; the outbound client
    // returns a typed `DISPATCH_FAILED { reason: "config_missing" }`
    // result per requested assetId in that case.
    MANAGER_API_BASE_URL: z.string().url().optional(),
    MANAGER_TRIGGER_API_KEY: z.string().min(1).optional(),
    NEXT_RUNTIME: z.enum(["nodejs", "edge"]).optional(),
    // Algolia (watch-project parity demo column on /watch/demo-keyword-search).
    // Server-side only — the demo route's `searchAlgolia` server action
    // (`apps/admin/src/app/watch/demo-keyword-search/algolia-action.ts`)
    // proxies queries using ALGOLIA_SEARCH_API_KEY (the watch project's
    // ALGOLIA_SERVER_API_KEY value, which is unrestricted; the public
    // NEXT_PUBLIC_ALGOLIA_API_KEY is referer-locked to the watch domain
    // and cannot be used from admin.jesusfilm.org). All three optional —
    // the action throws `algolia_not_configured` when any is absent and
    // the demo client renders a muted "Algolia disabled" banner.
    // Throwaway: removed at R8 cutover when admin replaces Algolia.
    ALGOLIA_APP_ID: z.string().min(1).optional(),
    ALGOLIA_SEARCH_API_KEY: z.string().min(1).optional(),
    ALGOLIA_INDEX: z.string().min(1).optional(),
    NODE_ENV: z.enum(["development", "test", "production"]).optional(),
  },
  client: {
    NEXT_PUBLIC_APP_NAME: z.string().min(1).default("forge-admin"),
    NEXT_PUBLIC_WATCH_URL: z.string().url().optional(),
  },
  skipValidation: !!process.env.CI,
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_SYNC: emptyToUndefined(process.env.DATABASE_URL_SYNC),
    BETTER_AUTH_SECRET: emptyToUndefined(process.env.BETTER_AUTH_SECRET),
    BETTER_AUTH_URL: emptyToUndefined(process.env.BETTER_AUTH_URL),
    AUTH_COOKIE_DOMAIN: emptyToUndefined(process.env.AUTH_COOKIE_DOMAIN),
    AUTH_COOKIE_PREFIX: emptyToUndefined(process.env.AUTH_COOKIE_PREFIX),
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
    CORE_SYNC_CRON_SECRET: emptyToUndefined(process.env.CORE_SYNC_CRON_SECRET),
    OPENROUTER_API_KEY: emptyToUndefined(process.env.OPENROUTER_API_KEY),
    OPENROUTER_IMAGE_TEXT_MODEL: emptyToUndefined(
      process.env.OPENROUTER_IMAGE_TEXT_MODEL,
    ),
    OPENROUTER_IMAGE_TEXT_MODELS: emptyToUndefined(
      process.env.OPENROUTER_IMAGE_TEXT_MODELS,
    ),
    OPENROUTER_EXPERIENCE_CHAT_MODEL: emptyToUndefined(
      process.env.OPENROUTER_EXPERIENCE_CHAT_MODEL,
    ),
    OPENROUTER_EXPERIENCE_CHAT_MODELS: emptyToUndefined(
      process.env.OPENROUTER_EXPERIENCE_CHAT_MODELS,
    ),
    OPENAI_API_KEY: emptyToUndefined(process.env.OPENAI_API_KEY),
    OPENAI_BASE_URL: emptyToUndefined(process.env.OPENAI_BASE_URL),
    WATCH_REVALIDATION_URL: emptyToUndefined(
      process.env.WATCH_REVALIDATION_URL,
    ),
    WATCH_REVALIDATION_SECRET: emptyToUndefined(
      process.env.WATCH_REVALIDATION_SECRET,
    ),
    EXPERIENCE_AI_ALLOW_CODEX_FALLBACK: emptyToUndefined(
      process.env.EXPERIENCE_AI_ALLOW_CODEX_FALLBACK,
    ),
    MASTRA_STORAGE_URL: emptyToUndefined(process.env.MASTRA_STORAGE_URL),
    MASTRA_DEFAULT_PROVIDER: emptyToUndefined(
      process.env.MASTRA_DEFAULT_PROVIDER,
    ),
    OLLAMA_BASE_URL: emptyToUndefined(process.env.OLLAMA_BASE_URL),
    OLLAMA_EMBEDDING_MODEL: emptyToUndefined(
      process.env.OLLAMA_EMBEDDING_MODEL,
    ),
    OLLAMA_EMBEDDING_DIMENSIONS: emptyToUndefined(
      process.env.OLLAMA_EMBEDDING_DIMENSIONS,
    ),
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
    SCENE_EMBEDDING_CONCURRENCY: emptyToUndefined(
      process.env.SCENE_EMBEDDING_CONCURRENCY,
    ),
    TRANSCRIPT_EMBEDDING_CONCURRENCY: emptyToUndefined(
      process.env.TRANSCRIPT_EMBEDDING_CONCURRENCY,
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
    MANAGER_API_BASE_URL: emptyToUndefined(process.env.MANAGER_API_BASE_URL),
    MANAGER_TRIGGER_API_KEY: emptyToUndefined(
      process.env.MANAGER_TRIGGER_API_KEY,
    ),
    NEXT_RUNTIME: emptyToUndefined(process.env.NEXT_RUNTIME),
    ALGOLIA_APP_ID: emptyToUndefined(process.env.ALGOLIA_APP_ID),
    ALGOLIA_SEARCH_API_KEY: emptyToUndefined(
      process.env.ALGOLIA_SEARCH_API_KEY,
    ),
    ALGOLIA_INDEX: emptyToUndefined(process.env.ALGOLIA_INDEX),
    NODE_ENV: emptyToUndefined(process.env.NODE_ENV),
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
    NEXT_PUBLIC_WATCH_URL: emptyToUndefined(process.env.NEXT_PUBLIC_WATCH_URL),
  },
})
