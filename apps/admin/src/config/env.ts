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
    ADMIN_SESSION_SECRET: z.string().min(32),
    // Optional admin OAuth cookie prefix. Use a unique value for local
    // worktree previews sharing localhost so branches do not overwrite each
    // other's session cookies.
    AUTH_COOKIE_PREFIX: z.string().min(1).optional(),
    AUTH_ISSUER_URL: z.string().url(),
    AUTH_ADMIN_CLIENT_ID: z.string().min(1),
    AUTH_ADMIN_CLIENT_SECRET: z.string().min(1).optional(),
    ADMIN_BASE_URL: z.string().url().optional(),
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
    OPENAI_API_KEY: z.string().min(1).optional(),
    OPENAI_BASE_URL: z.string().url().optional(),
    WORKFLOW_API_KEYS: z.string().min(1).optional(),
    // Plan 003 — consumer-app bearer allowlist (apps/web SSR).
    // CSV-parsed, matched against `Authorization: Bearer <key>` by
    // `consumer-bearer.ts`. A matched key mints a CONSUMER_BEARER
    // principal (permissions = empty set) whose sole effect is to
    // bucket consumer SSR traffic as `consumer:<key>` in admin's
    // rate-limit identifyFn — separate from anonymous-IP.
    // `.optional()` because environments without web cutover (preview,
    // local dev) don't need it. Required-without-default would brick
    // those Railway deploys — see
    // docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md.
    // Distinct from `WORKFLOW_API_KEYS` so widening one set does not
    // widen the other; the `WEB_ADMIN_API_KEYS !== WORKFLOW_API_KEYS`
    // invariant is asserted at unit-test time.
    WEB_ADMIN_API_KEYS: z.string().optional(),
    // Video DB backup download signer. Production admin uses this CSV
    // to authorize non-production callers that need a short-lived GET
    // URL for the latest reviewed video backup. Keep separate from
    // workflow and consumer bearer sets so backup download access does
    // not imply GraphQL or workflow access.
    BACKUP_DOWNLOAD_API_KEYS: z.string().min(1).optional(),
    // Plan 002 — search API bearer-key allowlist.
    // CSV-parsed, matched against `Authorization: Bearer <key>` by
    // `search-bearer.ts`. A matched key tags the request `auth=bearer`
    // in the structured log emitted by `/api/search` and `Query.search`;
    // when `SEARCH_AUTH_REQUIRED === "true"`, requests without a valid
    // bearer return 401. Distinct from the other bearer CSVs so an
    // operator pasting the same value into two CSVs hits a fail-fast
    // boot error (see `assertBearerCsvsDisjoint` below) instead of
    // silently widening a search passport into workflow-trigger access.
    // `.optional()` because environments without the rollout active
    // (preview, local dev) don't need it — required-without-default
    // would brick those Railway deploys, per
    // docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md.
    SEARCH_API_KEYS: z.string().optional(),
    // Plan 002 — search API required-auth flag. When "true", `/api/search`
    // and `Query.search` return 401 for missing/invalid bearer; when
    // "false" (the default), they accept both anonymous and bearer-auth
    // traffic (dual-accept). Enum-of-strings rather than boolean so a
    // stray non-empty value can't silently flip the gate (z.coerce.boolean
    // treats "false" as truthy). Decoded at call sites with
    // `env.SEARCH_AUTH_REQUIRED === "true"`.
    SEARCH_AUTH_REQUIRED: z.enum(["true", "false"]).optional().default("false"),
    WORKFLOW_HMAC_SECRET: z.string().min(1).optional(),
    WORKFLOW_TARGET_WORLD: z
      .enum(["local", "@workflow/world-postgres"])
      .optional(),
    WORKFLOW_RUNNER_ENABLED: z
      .enum(["true", "false"])
      .optional()
      .default("false"),
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

    // feat-119 PR2 — admin → manager outbound enrichment trigger.
    // Admin's `triggerManagerEnrichment` GraphQL mutation POSTs to
    // apps/manager's `/api/admin-trigger/{scene-analysis,transcript}`
    // endpoint. Both are optional at boot so admin keeps starting
    // when the trigger surface isn't configured; the outbound client
    // returns a typed `DISPATCH_FAILED { reason: "config_missing" }`
    // result per requested assetId in that case.
    MANAGER_API_BASE_URL: z.string().url().optional(),
    MANAGER_TRIGGER_API_KEY: z.string().min(1).optional(),

    // U21 — admin → web ISR revalidation webhook. Admin's publish
    // lifecycle (Experience publish/update) POSTs `{ model, entry: {
    // slug, locale } }` to web's `/api/revalidate` route with a bearer
    // matching the value web holds in `REVALIDATION_SECRET`. Both
    // optional at boot: admin runs in some environments without web
    // (preview, local dev). `emitRevalidateWebhook` silently no-ops
    // when either is unset. Required-without-default would brick those
    // Railway deploys — see
    // docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md.
    WEB_REVALIDATE_URL: z.string().url().optional(),
    WEB_REVALIDATE_TOKEN: z.string().min(1).optional(),
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
    // Search eval harness — local CLI only. None of these are read by
    // production code paths; see src/scripts/eval-search.ts and
    // src/services/search-eval/*.
    //
    // OPENROUTER_JUDGE_MODEL: OpenRouter model id used by the pairwise
    // relevance judge. Defaults to the `DEFAULT_JUDGE_MODEL` constant
    // declared inside the judge module so production builds without
    // this env still typecheck.
    OPENROUTER_JUDGE_MODEL: z.string().min(1).optional(),
    // EVAL_JUDGE_CONCURRENCY / EVAL_SEARCH_CONCURRENCY: parallel-call
    // caps for the judge and search clients. Defaults are baked into
    // the runner; raise them locally when iterating, lower them when
    // pointing at a shared admin instance to stay under its 30/min
    // search rate-limit.
    EVAL_JUDGE_CONCURRENCY: concurrencyEnvSchema,
    EVAL_SEARCH_CONCURRENCY: concurrencyEnvSchema,
    // The eval harness reuses ADMIN_BASE_URL as the target for `GET /api/search`.
    // It defaults to the local dev port at the call site when unset.
    // EVAL_GIT_SHA: stamped into the run JSON's metadata header so an
    // operator reviewing an old report can correlate it with a commit.
    // Optional; defaults to "unknown" at the call site. Operators set
    // this before running a baseline so the baseline carries provenance.
    EVAL_GIT_SHA: z.string().min(1).optional(),
  },
  client: {},
  skipValidation: !!process.env.CI,
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_SYNC: emptyToUndefined(process.env.DATABASE_URL_SYNC),
    ADMIN_SESSION_SECRET: emptyToUndefined(process.env.ADMIN_SESSION_SECRET),
    AUTH_COOKIE_PREFIX: emptyToUndefined(process.env.AUTH_COOKIE_PREFIX),
    AUTH_ISSUER_URL: emptyToUndefined(process.env.AUTH_ISSUER_URL),
    AUTH_ADMIN_CLIENT_ID: emptyToUndefined(process.env.AUTH_ADMIN_CLIENT_ID),
    AUTH_ADMIN_CLIENT_SECRET: emptyToUndefined(
      process.env.AUTH_ADMIN_CLIENT_SECRET,
    ),
    ADMIN_BASE_URL: emptyToUndefined(process.env.ADMIN_BASE_URL),
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
    OPENAI_API_KEY: emptyToUndefined(process.env.OPENAI_API_KEY),
    OPENAI_BASE_URL: emptyToUndefined(process.env.OPENAI_BASE_URL),
    WORKFLOW_API_KEYS: emptyToUndefined(process.env.WORKFLOW_API_KEYS),
    WEB_ADMIN_API_KEYS: emptyToUndefined(process.env.WEB_ADMIN_API_KEYS),
    BACKUP_DOWNLOAD_API_KEYS: emptyToUndefined(
      process.env.BACKUP_DOWNLOAD_API_KEYS,
    ),
    SEARCH_API_KEYS: emptyToUndefined(process.env.SEARCH_API_KEYS),
    SEARCH_AUTH_REQUIRED: emptyToUndefined(process.env.SEARCH_AUTH_REQUIRED),
    WORKFLOW_HMAC_SECRET: emptyToUndefined(process.env.WORKFLOW_HMAC_SECRET),
    WORKFLOW_TARGET_WORLD: emptyToUndefined(process.env.WORKFLOW_TARGET_WORLD),
    WORKFLOW_RUNNER_ENABLED: emptyToUndefined(
      process.env.WORKFLOW_RUNNER_ENABLED,
    ),
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
    MANAGER_API_BASE_URL: emptyToUndefined(process.env.MANAGER_API_BASE_URL),
    MANAGER_TRIGGER_API_KEY: emptyToUndefined(
      process.env.MANAGER_TRIGGER_API_KEY,
    ),
    WEB_REVALIDATE_URL: emptyToUndefined(process.env.WEB_REVALIDATE_URL),
    WEB_REVALIDATE_TOKEN: emptyToUndefined(process.env.WEB_REVALIDATE_TOKEN),
    NEXT_RUNTIME: emptyToUndefined(process.env.NEXT_RUNTIME),
    ALGOLIA_APP_ID: emptyToUndefined(process.env.ALGOLIA_APP_ID),
    ALGOLIA_SEARCH_API_KEY: emptyToUndefined(
      process.env.ALGOLIA_SEARCH_API_KEY,
    ),
    ALGOLIA_INDEX: emptyToUndefined(process.env.ALGOLIA_INDEX),
    OPENROUTER_JUDGE_MODEL: emptyToUndefined(
      process.env.OPENROUTER_JUDGE_MODEL,
    ),
    EVAL_JUDGE_CONCURRENCY: emptyToUndefined(
      process.env.EVAL_JUDGE_CONCURRENCY,
    ),
    EVAL_SEARCH_CONCURRENCY: emptyToUndefined(
      process.env.EVAL_SEARCH_CONCURRENCY,
    ),
    EVAL_GIT_SHA: emptyToUndefined(process.env.EVAL_GIT_SHA),
    NODE_ENV: emptyToUndefined(process.env.NODE_ENV),
  },
})

// ---------------------------------------------------------------------------
// Runtime bearer-CSV disjointness invariant.
//
// `permissions.test.ts` source-greps each bearer module to assert each
// reads only its own env var (CONSUMER != WORKFLOW), but nothing prevents
// an operator from pasting the same KEY VALUE into both CSVs during
// rotation. The auth chain in `context.ts` is `workflow → consumer →
// public`, so a duplicated key silently mints the higher-tier principal
// — permission widening without an audit trail.
//
// `assertBearerCsvsDisjoint` parses the two CSVs into Sets and throws
// if they intersect. Called at module load below so any boot path that
// imports `env` enforces the invariant. The error message MUST NOT
// include the offending key value.
// ---------------------------------------------------------------------------

function parseBearerCsvSet(csv: string | undefined): ReadonlySet<string> {
  if (!csv || csv.trim() === "") return new Set()
  return new Set(
    csv
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  )
}

export type BearerCsvSnapshot = {
  readonly WORKFLOW_API_KEYS?: string
  readonly WEB_ADMIN_API_KEYS?: string
  readonly BACKUP_DOWNLOAD_API_KEYS?: string
  readonly SEARCH_API_KEYS?: string
}

export function assertBearerCsvsDisjoint(snapshot: BearerCsvSnapshot): void {
  const sets = [
    ["WORKFLOW_API_KEYS", parseBearerCsvSet(snapshot.WORKFLOW_API_KEYS)],
    ["WEB_ADMIN_API_KEYS", parseBearerCsvSet(snapshot.WEB_ADMIN_API_KEYS)],
    [
      "BACKUP_DOWNLOAD_API_KEYS",
      parseBearerCsvSet(snapshot.BACKUP_DOWNLOAD_API_KEYS),
    ],
    ["SEARCH_API_KEYS", parseBearerCsvSet(snapshot.SEARCH_API_KEYS)],
  ] as const

  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      const [leftName, left] = sets[i]
      const [rightName, right] = sets[j]
      for (const key of left) {
        if (right.has(key)) {
          // NEVER include the key value — error stays grep-friendly for
          // logs but doesn't echo the leaked credential.
          throw new Error(
            `Bearer API key value appears in multiple CSVs: ${leftName} and ` +
              `${rightName} must be disjoint (admin auth chains must not share ` +
              `bearer credentials). Check the offending Doppler entries — key ` +
              `value redacted.`,
          )
        }
      }
    }
  }
}

// Boot-time invariant — fires on every import of `env`. Skipping this
// during build-phase would let the disjointness contract bypass CI;
// build phase passes empty/undefined for unset vars, which trivially
// satisfies the check.
assertBearerCsvsDisjoint({
  WORKFLOW_API_KEYS: env.WORKFLOW_API_KEYS,
  WEB_ADMIN_API_KEYS: env.WEB_ADMIN_API_KEYS,
  BACKUP_DOWNLOAD_API_KEYS: env.BACKUP_DOWNLOAD_API_KEYS,
  SEARCH_API_KEYS: env.SEARCH_API_KEYS,
})
