import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

import { normalizeDatadogEnv } from "./datadog-env"

// Doppler sends empty strings for unconfigured vars. Zod's `.optional()`
// only matches `undefined`, so `""` fails `.min(1)`. Coerce empties to
// `undefined` before validation.
const emptyToUndefined = (v: string | undefined) => (v === "" ? undefined : v)

export const DEFAULT_WEB_CANONICAL_ORIGIN = "https://www.jesusfilm.org"
export const DEFAULT_WATCH_CANONICAL_ORIGIN = "https://watch.jesusfilm.org"

const DATADOG_SITE_VALUES = [
  "datadoghq.com",
  "us3.datadoghq.com",
  "us5.datadoghq.com",
  "datadoghq.eu",
  "ddog-gov.com",
  "ap1.datadoghq.com",
  "ap2.datadoghq.com",
] as const

function datadogPublicEnvFallback(): string | undefined {
  return normalizeDatadogEnv(
    process.env.NEXT_PUBLIC_DATADOG_ENV ??
      process.env.RAILWAY_ENVIRONMENT_NAME ??
      process.env.VERCEL_ENV ??
      process.env.NODE_ENV,
  )
}

function datadogServerEnvFallback(): string | undefined {
  return normalizeDatadogEnv(
    process.env.DD_ENV ??
      process.env.NEXT_PUBLIC_DATADOG_ENV ??
      process.env.RAILWAY_ENVIRONMENT_NAME ??
      process.env.VERCEL_ENV ??
      process.env.NODE_ENV,
  )
}

function datadogVersionFallback(): string | undefined {
  return (
    emptyToUndefined(process.env.NEXT_PUBLIC_DATADOG_VERSION) ??
    emptyToUndefined(process.env.RAILWAY_GIT_COMMIT_SHA) ??
    emptyToUndefined(process.env.VERCEL_GIT_COMMIT_SHA) ??
    emptyToUndefined(process.env.GIT_COMMIT_SHA)
  )
}

const httpOriginEnvSchema = (varName: string) =>
  z
    .string()
    .url()
    .refine((value) => {
      const protocol = new URL(value).protocol
      return protocol === "http:" || protocol === "https:"
    }, `${varName} must be an HTTP(S) URL`)
    .transform((value) => new URL(value).origin)

export const webCanonicalOriginEnvSchema = httpOriginEnvSchema(
  "WEB_CANONICAL_ORIGIN",
)

export const watchCanonicalOriginEnvSchema = httpOriginEnvSchema(
  "WATCH_CANONICAL_ORIGIN",
)

/**
 * Shared schema fragment for env vars representing a positive-int
 * concurrency cap (e.g. `TRANSCRIPT_EMBEDDING_CONCURRENCY`). Exported so
 * test code and the
 * `run-embeds` CLI can parse via the same shape rather than
 * hand-rolling a parallel parser. Contract: undefined → undefined,
 * positive int (coerced from string) → number, anything else throws.
 */
export const concurrencyEnvSchema = z.coerce
  .number()
  .int()
  .positive()
  .optional()

export const searchTraceRawRetentionDaysEnvSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(29)
  .optional()
  .default(29)

export const workflowStartupTransientAttemptsEnvSchema = z.coerce
  .number()
  .int()
  .positive()
  .optional()
  .default(12)

export const workflowStartupTransientDelayMsEnvSchema = z.coerce
  .number()
  .int()
  .positive()
  .optional()
  .default(10_000)

/**
 * AI_GATEWAY_CONSTRAINED_DECODING_TRUSTED — enum-of-strings (not a
 * boolean) so a stray non-empty value can't silently flip the gate.
 * Absent → `"false"`; only the literal `"true"` marks the active chat
 * provider's schema-constrained decoding as trusted. Exported as a
 * standalone fragment so `env.test.ts` can assert the default without
 * round-tripping the CI-skipped `createEnv` boot.
 */
export const constrainedDecodingTrustedEnvSchema = z
  .enum(["true", "false"])
  .optional()
  .default("false")

/**
 * EXPERIENCE_AI_MAX_REPAIR_ATTEMPTS (U5) — the cap on the bounded
 * validate→repair-with-error-feedback loop in `runGenerateDraftAction`.
 * A COUNT, so it follows the repo's numeric-env convention
 * (`searchTraceRawRetentionDaysEnvSchema` uses `z.coerce.number()`):
 * coerced from string, integer, `0..5`, `.optional().default(2)`.
 *
 * Absent → 2 (the documented default). `0` disables repair entirely
 * (a schema_violation then fails closed on the first normalize miss).
 * `.optional().default(...)` so an unprovisioned Railway environment
 * still boots — opt-in scaffolding env vars must never be
 * required-without-default (cf.
 * docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md).
 */
export const experienceAiMaxRepairAttemptsEnvSchema = z.coerce
  .number()
  .int()
  .min(0)
  .max(5)
  .optional()
  .default(2)

export const youVersionPassageCacheTtlSecondsEnvSchema = z.coerce
  .number()
  .int()
  .positive()
  .optional()
  .default(60 * 60 * 24 * 14)

// feat-240 abuse ceiling (F1 #2): global per-fleet-key search cap/min. .min(0)
// with 0 = operator kill-switch (a well-meant `=0` can't brick boot). Tune from
// event=fleet_ceiling.near logs; catastrophic backstop above aggregate peak.
export const fleetSearchGlobalCeilingPerMinEnvSchema = z.coerce
  .number()
  .int()
  .min(0)
  .optional()
  .default(6000)

// Alert-first rollout: "false" = compute + WARN only (no 429); "true" =
// hard-block. Ship "false", calibrate, then flip. Mirrors SEARCH_AUTH_REQUIRED.
export const fleetSearchCeilingEnforceEnvSchema = z
  .enum(["true", "false"])
  .optional()
  .default("false")

// Unit 1 scaffolding shipped a minimal env. Each later unit appends the
// vars it owns here and in runtimeEnv. Never read process.env directly.
export const env = createEnv({
  server: {
    // Unit 2 — Prisma / Postgres
    //
    // DATABASE_URL: main pool. Recommend `?connection_limit=10&pool_timeout=20`.
    // DATABASE_URL_SYNC: dedicated pool for Core sync workflow. Production
    // should start around `?connection_limit=5&pool_timeout=60`, then tune
    // against total Postgres capacity — see src/db/client.ts.
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
    AUTH_ADMIN_MCP_AUDIENCE: z.string().min(1).optional(),
    AUTH_ADMIN_MCP_CLIENT_IDS: z.string().min(1).optional(),
    AUTH_ADMIN_MCP_TOKEN_ENVIRONMENT: z
      .enum(["local", "preview", "staging", "production"])
      .optional(),
    AUTH_MANAGER_SERVICE_CLIENT_ID: z.string().min(1).optional(),
    AUTH_MANAGER_SERVICE_CLIENT_SECRET: z.string().min(1).optional(),
    AUTH_MANAGER_SERVICE_AUDIENCE: z.string().url().optional(),
    AUTH_MANAGER_SERVICE_ENVIRONMENT: z
      .enum(["local", "preview", "staging", "production"])
      .optional(),
    AUTH_WEB_USER_INTROSPECTION_CLIENT_ID: z.string().min(1).optional(),
    AUTH_WEB_USER_INTROSPECTION_CLIENT_SECRET: z.string().min(1).optional(),
    AUTH_WEB_USER_CLIENT_IDS: z.string().min(1).optional(),
    AUTH_WEB_USER_TOKEN_ENVIRONMENT: z
      .enum(["local", "preview", "staging", "production"])
      .optional(),
    ADMIN_BASE_URL: z.string().url().optional(),
    // Public web origin used only for outbound visitor-facing watch links
    // from admin. Optional so local/admin-only deployments do not need a new
    // env var; production defaults to the indexed www host.
    WEB_CANONICAL_ORIGIN: webCanonicalOriginEnvSchema
      .optional()
      .default(DEFAULT_WEB_CANONICAL_ORIGIN),
    // Forge watch-app origin for experience preview links. Experiences only
    // render on the forge watch site, so this defaults to the watch host —
    // distinct from the indexed www host WEB_CANONICAL_ORIGIN targets.
    WATCH_CANONICAL_ORIGIN: watchCanonicalOriginEnvSchema
      .optional()
      .default(DEFAULT_WATCH_CANONICAL_ORIGIN),
    MANAGER_ADMIN_API_KEY: z.string().min(1).optional(),
    // SEO delegated/workload assertions use per-environment Ed25519 keyrings.
    // Keyrings are JSON objects mapping `kid` to SPKI PEM. They are optional at
    // boot: an unprovisioned environment keeps serving unrelated Admin routes,
    // while the assertion verifier fails closed on the SEO surface.
    SEO_ASSERTION_ENVIRONMENT: z
      .enum(["local", "preview", "staging", "production"])
      .optional()
      .default("local"),
    SEO_APPROVAL_PUBLIC_KEYS: z.string().min(1).optional(),
    SEO_WORKLOAD_PUBLIC_KEYS: z.string().min(1).optional(),
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
    OPENROUTER_API_PAID_KEY: z.string().min(1).optional(),
    OPENROUTER_API_KEY: z.string().min(1).optional(),
    OPENROUTER_IMAGE_TEXT_MODEL: z.string().min(1).optional(),
    OPENROUTER_IMAGE_TEXT_MODELS: z.string().min(1).optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    OPENAI_BASE_URL: z.string().url().optional(),
    // AI experience-exemplar selection. Cosine-distance ceiling for
    // treating a relevance-matched published experience as "good enough"
    // to use as a draft-generation exemplar; above it, the Easter
    // fallback applies. Both `.optional()` with runtime defaults so a
    // default-mode deploy needs no new env var (a required var with no
    // default would brick Railway deploys — see
    // docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md).
    EXPERIENCE_EXEMPLAR_MAX_DISTANCE: z.coerce.number().min(0).optional(),
    // Slug of the fallback exemplar experience (the Easter page).
    EXPERIENCE_EXEMPLAR_FALLBACK_SLUG: z.string().min(1).optional(),
    WORKFLOW_API_KEYS: z.string().min(1).optional(),
    // Narrow receiver-side CSV for yt-video-mapper -> Admin catalog sync.
    // The mapper service reads ADMIN_SERVICE_BEARER_TOKEN; production Admin
    // accepts the matching value here without widening WORKFLOW_API_KEYS.
    VIDEO_MAPPER_ADMIN_API_KEYS: z.string().min(1).optional(),
    // Opt-in read-only integration test gate for the mapper catalog SQL.
    // Test-only; production code does not branch on this value.
    VIDEO_MAPPER_CATALOG_DB_TEST: z.enum(["1"]).optional(),
    // Narrow receiver-side CSV for Mastra -> Admin transcript vector ingest.
    // This is deliberately separate from WORKFLOW_API_KEYS: workflow launchers
    // must not automatically gain direct vector-write capability.
    MASTRA_TRANSCRIPT_INGEST_API_KEYS: z.string().min(1).optional(),
    // Narrow receiver-side CSV for Mastra -> Admin experience vector ingest.
    // Kept separate from transcript ingest and workflow launch credentials.
    MASTRA_EXPERIENCE_INGEST_API_KEYS: z.string().min(1).optional(),
    // Narrow receiver-side CSV for the standalone Mastra chat agent's tool
    // callbacks (consolidation U7): search-videos / lookup-bible-verse /
    // fetch-video-image. A DIFFERENT capability than vector ingest or workflow
    // launch (read-only catalog reads), so it gets its own CSV and joins the
    // disjointness invariant below. Optional so an unprovisioned env still boots.
    ADMIN_AGENT_TOOLS_API_KEYS: z.string().min(1).optional(),
    // Plan 003 — consumer-app bearer allowlist (apps/web SSR).
    // CSV-parsed, matched against `Authorization: Bearer <key>` by
    // `consumer-bearer.ts`. A matched key mints a CONSUMER_BEARER
    // principal (permissions = empty set) whose sole effect is to
    // identify trusted Web SSR traffic in admin's rate-limit identifyFn —
    // separate from anonymous-IP and request-scoped so RSC traffic does not
    // accumulate into one shared field-limit bucket.
    // `.optional()` because environments without web cutover (preview,
    // local dev) don't need it. Required-without-default would brick
    // those Railway deploys — see
    // docs/solutions/runtime-errors/required-env-var-without-default-broke-railway-deploy-20260511.md.
    // Distinct from `WORKFLOW_API_KEYS` so widening one set does not
    // widen the other; the `WEB_ADMIN_API_KEYS !== WORKFLOW_API_KEYS`
    // invariant is asserted at unit-test time.
    WEB_ADMIN_API_KEYS: z.string().optional(),
    // Fleet consumer-bearer allowlist (apps/tv + apps/mobile). Mints the same
    // CONSUMER_BEARER principal as WEB_ADMIN_API_KEYS but flagged `fleet`, so
    // identifyForRateLimit buckets per-IP (consumer:<key>:<ip>), not per-key.
    FLEET_ADMIN_API_KEYS: z.string().optional(),
    // Dedicated receiver-side CSV for consumer watch-progress persistence.
    // This endpoint accepts caller-supplied consumer user ids, so it must stay
    // narrower than the general web SSR consumer bearer.
    WATCH_PROGRESS_ADMIN_API_KEYS: z.string().min(1).optional(),
    // Admin-owned YouVersion integration for Watch Bible passages. Web
    // reads cached passage data through GraphQL and never receives this key.
    YOUVERSION_APP_KEY: z.string().min(1).optional(),
    YOUVERSION_PASSAGE_CACHE_TTL_SECONDS:
      youVersionPassageCacheTtlSecondsEnvSchema,
    // Video DB backup download signer. Production admin uses this CSV
    // to authorize non-production callers that need a short-lived GET
    // URL for the latest reviewed video backup. Keep separate from
    // workflow and consumer bearer sets so backup download access does
    // not imply GraphQL or workflow access.
    BACKUP_DOWNLOAD_API_KEYS: z.string().min(1).optional(),
    FLEET_SEARCH_GLOBAL_CEILING_PER_MIN:
      fleetSearchGlobalCeilingPerMinEnvSchema,
    FLEET_SEARCH_CEILING_ENFORCE: fleetSearchCeilingEnforceEnvSchema,
    // Admin-owned production search trace sampling. Future Mastra eval jobs
    // call the internal Admin sampling route with a dedicated bearer from
    // this CSV; it must stay disjoint from public search, workflow launch,
    // backup download, and vector-ingest credentials.
    SEARCH_TRACE_SAMPLING_API_KEYS: z.string().min(1).optional(),
    // Raw search traces expire before the 30-day hard ceiling so the daily
    // purge has a real safety margin. Aggregates survive without query text.
    SEARCH_TRACE_RAW_RETENTION_DAYS: searchTraceRawRetentionDaysEnvSchema,
    WORKFLOW_HMAC_SECRET: z.string().min(1).optional(),
    WORKFLOW_TARGET_WORLD: z
      .enum(["local", "@workflow/world-postgres"])
      .optional(),
    WORKFLOW_RUNNER_ENABLED: z
      .enum(["true", "false"])
      .optional()
      .default("false"),
    WORKFLOW_STARTUP_TRANSIENT_ATTEMPTS:
      workflowStartupTransientAttemptsEnvSchema,
    WORKFLOW_STARTUP_TRANSIENT_DELAY_MS:
      workflowStartupTransientDelayMsEnvSchema,
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
    // Per-target concurrency cap for transcript embed backfills. The workflow
    // uses `p-limit(N) + Promise.allSettled` to fan out the per-target loop;
    // one rejection never aborts siblings (cf.
    // docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md).
    // Default at the call site is 10. Tune up locally (20+); tune down in prod
    // (start at 5, ramp after observation).
    TRANSCRIPT_EMBEDDING_CONCURRENCY: concurrencyEnvSchema,
    RAILWAY_S3_ENDPOINT: z.string().url().optional(),
    RAILWAY_S3_REGION: z.string().min(1).optional(),
    RAILWAY_S3_BUCKET: z.string().min(1).optional(),
    RAILWAY_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    RAILWAY_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    // Manager artifacts bucket — admin reads manager-produced artifacts such as
    // {assetId}/transcript.json from apps/manager's S3 bucket via
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

    // Admin -> Mastra workflow launches. Transcript backfills send
    // transcript source data to Mastra; Mastra returns product-level
    // ingest outcomes after writing through Admin's internal ingest.
    MASTRA_BASE_URL: z.string().url().optional(),
    MASTRA_SERVICE_API_KEY: z.string().min(1).optional(),
    MASTRA_GATEWAY_BASE_URL: z.string().url().optional(),
    MASTRA_GATEWAY_ADMIN_API_KEY: z.string().min(1).optional(),
    MASTRA_TRANSCRIPT_EMBEDDING_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(120_000),
    MASTRA_EXPERIENCE_EMBEDDING_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(120_000),

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
    NODE_ENV: z.enum(["development", "test", "production"]).optional(),
    // Optional OpenRouter model override used by the production search trace
    // query classifier. Defaults to the classifier module's pinned model.
    OPENROUTER_QUERY_CLASSIFIER_MODEL: z.string().min(1).optional(),
    // -----------------------------------------------------------------
    // Experience-AI chat runtime (in-admin Mastra agents) — additive
    // block. AI_GATEWAY_* names follow apps/mastra's convention for the
    // same self-hosted OpenAI-compatible gateway; CHAT_* keys are
    // model-scoped separately from EMBEDDINGS_* (the gateway issues
    // per-model keys — the chat key cannot embed and vice versa).
    // AI_GATEWAY_CHAT_ENABLED gates routing the structured chat agents
    // through the gateway (only the literal "true" enables it).
    // -----------------------------------------------------------------
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
    AI_GATEWAY_CHAT_BASE_URL: z.string().url().optional(),
    AI_GATEWAY_CHAT_API_KEY: z.string().min(1).optional(),
    AI_GATEWAY_CHAT_MODEL: z.string().min(1).optional(),
    AI_GATEWAY_CHAT_ENABLED: z.string().optional(),
    // Marks the active chat provider's schema-constrained decoding
    // (`structuredOutput` / vLLM guided_json) as TRUSTED — only flipped
    // to "true" after the U6 BlocksSchema smoke gate is green for that
    // provider. When unset/"false", every phase takes the free-text +
    // coercion + repair + validator path (R5: the final guarantee never
    // depends on constrained decoding). `.optional().default("false")`
    // so an unprovisioned Railway environment still boots (R: opt-in
    // scaffolding env vars must never be required-without-default).
    AI_GATEWAY_CONSTRAINED_DECODING_TRUSTED:
      constrainedDecodingTrustedEnvSchema,
    // Cap on the U5 validate→repair loop (default 2). See
    // experienceAiMaxRepairAttemptsEnvSchema above.
    EXPERIENCE_AI_MAX_REPAIR_ATTEMPTS: experienceAiMaxRepairAttemptsEnvSchema,
    // Flag-gated one-shot draft cutover (consolidation U6). When "true",
    // `runGenerateDraftAction` runs the draft via the standalone
    // `/forge-experience-draft` route (reusing MASTRA_BASE_URL +
    // MASTRA_SERVICE_API_KEY) instead of the in-process workflow; the
    // in-process path stays the fallback (unset/"false", or when those caller
    // vars are unset → the client returns config_missing → in-process).
    // Enum-of-strings + `.optional().default("false")` so an unprovisioned
    // Railway env still boots (opt-in scaffolding env var).
    EXPERIENCE_AI_REMOTE_DRAFT: z
      .enum(["true", "false"])
      .optional()
      .default("false"),
    // Outbound HTTP budget for the remote draft call. MUST stay strictly
    // LARGER than mastra's internal multi-step-workflow budget (180s) so the
    // mastra-side timeout wins the race and returns a clean { reason:"timeout" }
    // envelope rather than admin's fetch aborting as a generic network_error
    // and triggering a retry storm (cf.
    // docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md).
    MASTRA_DRAFT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(200_000),
    // Flag-gated video-anchored section cutover. When "true",
    // `runGenerateSectionAction` calls the standalone
    // `/forge-experience-section` route (reusing MASTRA_BASE_URL +
    // MASTRA_SERVICE_API_KEY); there is NO admin in-process fallback for the
    // section path (it is remote-first by design, to avoid expanding the
    // consolidation's U10 deletion scope). Opt-in scaffolding: optional +
    // defaulted so an unprovisioned env still boots.
    EXPERIENCE_AI_REMOTE_SECTION: z
      .enum(["true", "false"])
      .optional()
      .default("false"),
    // Outbound HTTP budget for the remote section call. MUST stay strictly
    // LARGER than mastra's internal section budget (TIME_BUDGET_MS.section,
    // 60s) so the mastra-side timeout wins the race (same invariant as
    // MASTRA_DRAFT_TIMEOUT_MS).
    MASTRA_SECTION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(75_000),
    // Persona-aware variant generation (persona-variants v1). When "true", the
    // operator script calls the standalone `/forge-experience-variant` route
    // (reusing MASTRA_BASE_URL + MASTRA_SERVICE_API_KEY) to generate one tailored
    // experience per persona. Remote-only, like the section path. Opt-in
    // scaffolding: optional + defaulted so an unprovisioned env still boots.
    EXPERIENCE_AI_REMOTE_VARIANTS: z
      .enum(["true", "false"])
      .optional()
      .default("false"),
    // Outbound HTTP budget per persona-variant call. MUST stay strictly LARGER
    // than mastra's internal multi-step budget (TIME_BUDGET_MS.multiStepWorkflow,
    // 180s) so the mastra-side timeout wins the race (same invariant as
    // MASTRA_DRAFT_TIMEOUT_MS).
    MASTRA_VARIANTS_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(200_000),
    // Outbound HTTP budget for the MCP experience.generate call. DELIBERATELY
    // strictly BELOW Cloudflare's ~100s proxy window fronting admin — the
    // inverse of the sibling timeouts above — because mastra pins the SAME
    // 180s internal budget on quick and multi draft modes (no quickDraft
    // budget key exists), so "admin waits out mastra's budget" cannot fit the
    // transport ceiling. Admin's abort is the binding ceiling here: the MCP
    // caller gets a clean typed retryable failure instead of a severed 524
    // connection, and nothing is persisted (the create happens only after a
    // successful mastra response). See feat-320 (R7).
    MASTRA_GENERATE_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(90_000),
    // Flag-gated streaming chat cutover (consolidation U9). When "true",
    // `runMastraChat` relays the token stream from the standalone
    // `/forge-experience-chat` route instead of running the agent in-process;
    // the in-process path stays the fallback. All optional so an unprovisioned
    // env still boots.
    EXPERIENCE_AI_REMOTE_CHAT: z
      .enum(["true", "false"])
      .optional()
      .default("false"),
    MASTRA_CHAT_BASE_URL: z.string().url().optional(),
    MASTRA_CHAT_API_KEY: z.string().min(1).optional(),
    // SSRF allowlist for the chat base URL host. When set, the base URL host
    // MUST be listed (else the relay is rejected before fetch). Unset → the
    // operator-configured base host is implicitly trusted (redirect:"error"
    // still blocks off-host hops).
    MASTRA_CHAT_ALLOWED_HOSTS: z.string().min(1).optional(),
    // Outbound budget for the chat relay. Strictly LARGER than mastra's
    // internal chatTurn budget (90s) so the mastra-side timeout wins; under the
    // ~100s Cloudflare 524 ceiling fronting admin.
    MASTRA_CHAT_TIMEOUT_MS: z.coerce.number().int().positive().default(95_000),
    AI_GATEWAY_EMBEDDINGS_BASE_URL: z.string().url().optional(),
    AI_GATEWAY_EMBEDDINGS_API_KEY: z.string().min(1).optional(),
    AI_GATEWAY_EMBEDDINGS_MODEL: z.string().min(1).optional(),
    MASTRA_STORAGE_URL: z.string().url().optional(),
    MASTRA_DEFAULT_PROVIDER: z
      .enum([
        "openrouter",
        "ollama",
        "openai",
        "anthropic",
        "google",
        "jesusfilm",
      ])
      .optional(),
    OLLAMA_BASE_URL: z.string().url().optional(),
    OLLAMA_EMBEDDING_MODEL: z.string().min(1).optional(),
    OLLAMA_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().optional(),
    DD_AGENT_HOST: z.string().min(1).optional(),
    DD_AGENT_SYSLOG_PORT: z.coerce.number().int().positive().optional(),
    DD_ENV: z.string().min(1).optional(),
    DD_SERVICE: z.string().min(1).optional(),
    DD_VERSION: z.string().min(1).optional(),
  },
  client: {
    // Optional Datadog RUM configuration. Application id + client token gate
    // initialization; when absent, the client component no-ops so local and
    // preview environments can boot before Datadog is provisioned.
    NEXT_PUBLIC_DATADOG_APPLICATION_ID: z.string().optional(),
    NEXT_PUBLIC_DATADOG_CLIENT_TOKEN: z.string().optional(),
    NEXT_PUBLIC_DATADOG_SITE: z
      .enum(DATADOG_SITE_VALUES)
      .default("datadoghq.com"),
    NEXT_PUBLIC_DATADOG_ENV: z.string().default("development"),
    NEXT_PUBLIC_DATADOG_VERSION: z.string().optional(),
  },
  skipValidation: !!process.env.CI,
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    NEXT_PUBLIC_DATADOG_APPLICATION_ID: emptyToUndefined(
      process.env.NEXT_PUBLIC_DATADOG_APPLICATION_ID,
    ),
    NEXT_PUBLIC_DATADOG_CLIENT_TOKEN: emptyToUndefined(
      process.env.NEXT_PUBLIC_DATADOG_CLIENT_TOKEN,
    ),
    NEXT_PUBLIC_DATADOG_SITE: emptyToUndefined(
      process.env.NEXT_PUBLIC_DATADOG_SITE,
    ),
    NEXT_PUBLIC_DATADOG_ENV: datadogPublicEnvFallback(),
    NEXT_PUBLIC_DATADOG_VERSION: datadogVersionFallback(),
    DD_AGENT_HOST: emptyToUndefined(process.env.DD_AGENT_HOST),
    DD_AGENT_SYSLOG_PORT: emptyToUndefined(process.env.DD_AGENT_SYSLOG_PORT),
    DD_ENV: datadogServerEnvFallback(),
    DD_SERVICE: emptyToUndefined(process.env.DD_SERVICE),
    DD_VERSION: datadogVersionFallback(),
    DATABASE_URL_SYNC: emptyToUndefined(process.env.DATABASE_URL_SYNC),
    ADMIN_SESSION_SECRET: emptyToUndefined(process.env.ADMIN_SESSION_SECRET),
    AUTH_COOKIE_PREFIX: emptyToUndefined(process.env.AUTH_COOKIE_PREFIX),
    AUTH_ISSUER_URL: emptyToUndefined(process.env.AUTH_ISSUER_URL),
    AUTH_ADMIN_CLIENT_ID: emptyToUndefined(process.env.AUTH_ADMIN_CLIENT_ID),
    AUTH_ADMIN_CLIENT_SECRET: emptyToUndefined(
      process.env.AUTH_ADMIN_CLIENT_SECRET,
    ),
    AUTH_ADMIN_MCP_AUDIENCE: emptyToUndefined(
      process.env.AUTH_ADMIN_MCP_AUDIENCE,
    ),
    AUTH_ADMIN_MCP_CLIENT_IDS: emptyToUndefined(
      process.env.AUTH_ADMIN_MCP_CLIENT_IDS,
    ),
    AUTH_ADMIN_MCP_TOKEN_ENVIRONMENT: emptyToUndefined(
      process.env.AUTH_ADMIN_MCP_TOKEN_ENVIRONMENT,
    ),
    AUTH_MANAGER_SERVICE_CLIENT_ID: emptyToUndefined(
      process.env.AUTH_MANAGER_SERVICE_CLIENT_ID,
    ),
    AUTH_MANAGER_SERVICE_CLIENT_SECRET: emptyToUndefined(
      process.env.AUTH_MANAGER_SERVICE_CLIENT_SECRET,
    ),
    AUTH_MANAGER_SERVICE_AUDIENCE: emptyToUndefined(
      process.env.AUTH_MANAGER_SERVICE_AUDIENCE,
    ),
    AUTH_MANAGER_SERVICE_ENVIRONMENT: emptyToUndefined(
      process.env.AUTH_MANAGER_SERVICE_ENVIRONMENT,
    ),
    AUTH_WEB_USER_INTROSPECTION_CLIENT_ID: emptyToUndefined(
      process.env.AUTH_WEB_USER_INTROSPECTION_CLIENT_ID,
    ),
    AUTH_WEB_USER_INTROSPECTION_CLIENT_SECRET: emptyToUndefined(
      process.env.AUTH_WEB_USER_INTROSPECTION_CLIENT_SECRET,
    ),
    AUTH_WEB_USER_CLIENT_IDS: emptyToUndefined(
      process.env.AUTH_WEB_USER_CLIENT_IDS,
    ),
    AUTH_WEB_USER_TOKEN_ENVIRONMENT: emptyToUndefined(
      process.env.AUTH_WEB_USER_TOKEN_ENVIRONMENT,
    ),
    ADMIN_BASE_URL: emptyToUndefined(process.env.ADMIN_BASE_URL),
    WEB_CANONICAL_ORIGIN:
      emptyToUndefined(process.env.WEB_CANONICAL_ORIGIN) ??
      DEFAULT_WEB_CANONICAL_ORIGIN,
    WATCH_CANONICAL_ORIGIN:
      emptyToUndefined(process.env.WATCH_CANONICAL_ORIGIN) ??
      DEFAULT_WATCH_CANONICAL_ORIGIN,
    MANAGER_ADMIN_API_KEY: emptyToUndefined(process.env.MANAGER_ADMIN_API_KEY),
    SEO_ASSERTION_ENVIRONMENT: emptyToUndefined(
      process.env.SEO_ASSERTION_ENVIRONMENT,
    ),
    SEO_APPROVAL_PUBLIC_KEYS: emptyToUndefined(
      process.env.SEO_APPROVAL_PUBLIC_KEYS,
    ),
    SEO_WORKLOAD_PUBLIC_KEYS: emptyToUndefined(
      process.env.SEO_WORKLOAD_PUBLIC_KEYS,
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
    OPENROUTER_API_PAID_KEY: emptyToUndefined(
      process.env.OPENROUTER_API_PAID_KEY,
    ),
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
    VIDEO_MAPPER_ADMIN_API_KEYS: emptyToUndefined(
      process.env.VIDEO_MAPPER_ADMIN_API_KEYS,
    ),
    VIDEO_MAPPER_CATALOG_DB_TEST: emptyToUndefined(
      process.env.VIDEO_MAPPER_CATALOG_DB_TEST,
    ),
    MASTRA_TRANSCRIPT_INGEST_API_KEYS: emptyToUndefined(
      process.env.MASTRA_TRANSCRIPT_INGEST_API_KEYS,
    ),
    MASTRA_EXPERIENCE_INGEST_API_KEYS: emptyToUndefined(
      process.env.MASTRA_EXPERIENCE_INGEST_API_KEYS,
    ),
    ADMIN_AGENT_TOOLS_API_KEYS: emptyToUndefined(
      process.env.ADMIN_AGENT_TOOLS_API_KEYS,
    ),
    EXPERIENCE_EXEMPLAR_MAX_DISTANCE: emptyToUndefined(
      process.env.EXPERIENCE_EXEMPLAR_MAX_DISTANCE,
    ),
    EXPERIENCE_EXEMPLAR_FALLBACK_SLUG: emptyToUndefined(
      process.env.EXPERIENCE_EXEMPLAR_FALLBACK_SLUG,
    ),
    WEB_ADMIN_API_KEYS: emptyToUndefined(process.env.WEB_ADMIN_API_KEYS),
    FLEET_ADMIN_API_KEYS: emptyToUndefined(process.env.FLEET_ADMIN_API_KEYS),
    WATCH_PROGRESS_ADMIN_API_KEYS: emptyToUndefined(
      process.env.WATCH_PROGRESS_ADMIN_API_KEYS,
    ),
    YOUVERSION_APP_KEY: emptyToUndefined(process.env.YOUVERSION_APP_KEY),
    YOUVERSION_PASSAGE_CACHE_TTL_SECONDS: emptyToUndefined(
      process.env.YOUVERSION_PASSAGE_CACHE_TTL_SECONDS,
    ),
    BACKUP_DOWNLOAD_API_KEYS: emptyToUndefined(
      process.env.BACKUP_DOWNLOAD_API_KEYS,
    ),
    FLEET_SEARCH_GLOBAL_CEILING_PER_MIN: emptyToUndefined(
      process.env.FLEET_SEARCH_GLOBAL_CEILING_PER_MIN,
    ),
    FLEET_SEARCH_CEILING_ENFORCE: emptyToUndefined(
      process.env.FLEET_SEARCH_CEILING_ENFORCE,
    ),
    SEARCH_TRACE_SAMPLING_API_KEYS: emptyToUndefined(
      process.env.SEARCH_TRACE_SAMPLING_API_KEYS,
    ),
    SEARCH_TRACE_RAW_RETENTION_DAYS: emptyToUndefined(
      process.env.SEARCH_TRACE_RAW_RETENTION_DAYS,
    ),
    WORKFLOW_HMAC_SECRET: emptyToUndefined(process.env.WORKFLOW_HMAC_SECRET),
    WORKFLOW_TARGET_WORLD: emptyToUndefined(process.env.WORKFLOW_TARGET_WORLD),
    WORKFLOW_RUNNER_ENABLED: emptyToUndefined(
      process.env.WORKFLOW_RUNNER_ENABLED,
    ),
    WORKFLOW_STARTUP_TRANSIENT_ATTEMPTS: emptyToUndefined(
      process.env.WORKFLOW_STARTUP_TRANSIENT_ATTEMPTS,
    ),
    WORKFLOW_STARTUP_TRANSIENT_DELAY_MS: emptyToUndefined(
      process.env.WORKFLOW_STARTUP_TRANSIENT_DELAY_MS,
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
    MASTRA_BASE_URL: emptyToUndefined(process.env.MASTRA_BASE_URL),
    MASTRA_SERVICE_API_KEY: emptyToUndefined(
      process.env.MASTRA_SERVICE_API_KEY,
    ),
    MASTRA_GATEWAY_BASE_URL: emptyToUndefined(
      process.env.MASTRA_GATEWAY_BASE_URL,
    ),
    MASTRA_GATEWAY_ADMIN_API_KEY: emptyToUndefined(
      process.env.MASTRA_GATEWAY_ADMIN_API_KEY,
    ),
    MASTRA_TRANSCRIPT_EMBEDDING_TIMEOUT_MS: emptyToUndefined(
      process.env.MASTRA_TRANSCRIPT_EMBEDDING_TIMEOUT_MS,
    ),
    MASTRA_EXPERIENCE_EMBEDDING_TIMEOUT_MS: emptyToUndefined(
      process.env.MASTRA_EXPERIENCE_EMBEDDING_TIMEOUT_MS,
    ),
    WEB_REVALIDATE_URL: emptyToUndefined(process.env.WEB_REVALIDATE_URL),
    WEB_REVALIDATE_TOKEN: emptyToUndefined(process.env.WEB_REVALIDATE_TOKEN),
    NEXT_RUNTIME: emptyToUndefined(process.env.NEXT_RUNTIME),
    OPENROUTER_QUERY_CLASSIFIER_MODEL: emptyToUndefined(
      process.env.OPENROUTER_QUERY_CLASSIFIER_MODEL,
    ),
    // Experience-AI chat runtime — additive block (see server section).
    GOOGLE_GENERATIVE_AI_API_KEY: emptyToUndefined(
      process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    ),
    AI_GATEWAY_CHAT_BASE_URL: emptyToUndefined(
      process.env.AI_GATEWAY_CHAT_BASE_URL,
    ),
    AI_GATEWAY_CHAT_API_KEY: emptyToUndefined(
      process.env.AI_GATEWAY_CHAT_API_KEY,
    ),
    AI_GATEWAY_CHAT_MODEL: emptyToUndefined(process.env.AI_GATEWAY_CHAT_MODEL),
    AI_GATEWAY_CHAT_ENABLED: emptyToUndefined(
      process.env.AI_GATEWAY_CHAT_ENABLED,
    ),
    AI_GATEWAY_CONSTRAINED_DECODING_TRUSTED: emptyToUndefined(
      process.env.AI_GATEWAY_CONSTRAINED_DECODING_TRUSTED,
    ),
    EXPERIENCE_AI_MAX_REPAIR_ATTEMPTS: emptyToUndefined(
      process.env.EXPERIENCE_AI_MAX_REPAIR_ATTEMPTS,
    ),
    EXPERIENCE_AI_REMOTE_DRAFT: emptyToUndefined(
      process.env.EXPERIENCE_AI_REMOTE_DRAFT,
    ),
    MASTRA_DRAFT_TIMEOUT_MS: emptyToUndefined(
      process.env.MASTRA_DRAFT_TIMEOUT_MS,
    ),
    EXPERIENCE_AI_REMOTE_SECTION: emptyToUndefined(
      process.env.EXPERIENCE_AI_REMOTE_SECTION,
    ),
    MASTRA_SECTION_TIMEOUT_MS: emptyToUndefined(
      process.env.MASTRA_SECTION_TIMEOUT_MS,
    ),
    EXPERIENCE_AI_REMOTE_VARIANTS: emptyToUndefined(
      process.env.EXPERIENCE_AI_REMOTE_VARIANTS,
    ),
    MASTRA_VARIANTS_TIMEOUT_MS: emptyToUndefined(
      process.env.MASTRA_VARIANTS_TIMEOUT_MS,
    ),
    MASTRA_GENERATE_TIMEOUT_MS: emptyToUndefined(
      process.env.MASTRA_GENERATE_TIMEOUT_MS,
    ),
    EXPERIENCE_AI_REMOTE_CHAT: emptyToUndefined(
      process.env.EXPERIENCE_AI_REMOTE_CHAT,
    ),
    MASTRA_CHAT_BASE_URL: emptyToUndefined(process.env.MASTRA_CHAT_BASE_URL),
    MASTRA_CHAT_API_KEY: emptyToUndefined(process.env.MASTRA_CHAT_API_KEY),
    MASTRA_CHAT_ALLOWED_HOSTS: emptyToUndefined(
      process.env.MASTRA_CHAT_ALLOWED_HOSTS,
    ),
    MASTRA_CHAT_TIMEOUT_MS: emptyToUndefined(
      process.env.MASTRA_CHAT_TIMEOUT_MS,
    ),
    AI_GATEWAY_EMBEDDINGS_BASE_URL: emptyToUndefined(
      process.env.AI_GATEWAY_EMBEDDINGS_BASE_URL,
    ),
    AI_GATEWAY_EMBEDDINGS_API_KEY: emptyToUndefined(
      process.env.AI_GATEWAY_EMBEDDINGS_API_KEY,
    ),
    AI_GATEWAY_EMBEDDINGS_MODEL: emptyToUndefined(
      process.env.AI_GATEWAY_EMBEDDINGS_MODEL,
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

// `BEARER_CSV_KEYS` drives both the snapshot type AND the
// `assertBearerCsvsDisjoint` iteration. The `satisfies` clause makes the
// compiler enforce alignment: adding a new bearer CSV requires updating
// the constant AND the type in lockstep, or the build breaks.
const BEARER_CSV_KEYS = [
  "WORKFLOW_API_KEYS",
  "VIDEO_MAPPER_ADMIN_API_KEYS",
  "MASTRA_TRANSCRIPT_INGEST_API_KEYS",
  "MASTRA_EXPERIENCE_INGEST_API_KEYS",
  "ADMIN_AGENT_TOOLS_API_KEYS",
  "MANAGER_ADMIN_API_KEY",
  "WEB_ADMIN_API_KEYS",
  "FLEET_ADMIN_API_KEYS",
  "WATCH_PROGRESS_ADMIN_API_KEYS",
  "BACKUP_DOWNLOAD_API_KEYS",
  "SEARCH_TRACE_SAMPLING_API_KEYS",
] as const

type BearerCsvKey = (typeof BEARER_CSV_KEYS)[number]

export type BearerCsvSnapshot = {
  readonly [K in BearerCsvKey]?: string
}

// Compile-time guard: every key in BearerCsvSnapshot MUST be a member
// of BEARER_CSV_KEYS (and vice versa via the mapped type). A future
// addition that names a key in one place but not the other won't
// compile.
const _bearerCsvKeysCheck: ReadonlyArray<keyof BearerCsvSnapshot> =
  BEARER_CSV_KEYS satisfies ReadonlyArray<keyof BearerCsvSnapshot>
void _bearerCsvKeysCheck

export function assertBearerCsvsDisjoint(snapshot: BearerCsvSnapshot): void {
  const sets = BEARER_CSV_KEYS.map(
    (name) => [name, parseBearerCsvSet(snapshot[name])] as const,
  )

  // Collect ALL overlapping pairs into one error rather than throwing
  // on the first match. An operator hitting this fail-fast at deploy
  // time gets the complete list of CSV pairs to clean up instead of
  // N redeploys to discover each overlap one at a time. The key
  // values themselves are NEVER included in the error — only the
  // CSV names and the count of overlapping values per pair.
  const overlaps: Array<{
    left: BearerCsvKey
    right: BearerCsvKey
    count: number
  }> = []
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      const [leftName, left] = sets[i]
      const [rightName, right] = sets[j]
      let count = 0
      for (const key of left) {
        if (right.has(key)) count += 1
      }
      if (count > 0) {
        overlaps.push({ left: leftName, right: rightName, count })
      }
    }
  }

  if (overlaps.length === 0) return

  const summary = overlaps
    .map(
      ({ left, right, count }) =>
        `${left} and ${right} (${count} key${count === 1 ? "" : "s"})`,
    )
    .join("; ")
  throw new Error(
    `Bearer API key values appear in multiple CSVs. Offending pairs: ` +
      `${summary}. The bearer CSVs must be disjoint (admin auth chains must ` +
      `not share bearer credentials). Check the offending Doppler entries — ` +
      `key values redacted. See apps/admin/CLAUDE.md > "Search API ` +
      `authentication" for the receiver-first rotation procedure.`,
  )
}

// Boot-time invariant — fires on every import of `env`. Skipping this
// during build-phase would let the disjointness contract bypass CI;
// build phase passes empty/undefined for unset vars, which trivially
// satisfies the check.
assertBearerCsvsDisjoint({
  WORKFLOW_API_KEYS: env.WORKFLOW_API_KEYS,
  VIDEO_MAPPER_ADMIN_API_KEYS: env.VIDEO_MAPPER_ADMIN_API_KEYS,
  MASTRA_TRANSCRIPT_INGEST_API_KEYS: env.MASTRA_TRANSCRIPT_INGEST_API_KEYS,
  MASTRA_EXPERIENCE_INGEST_API_KEYS: env.MASTRA_EXPERIENCE_INGEST_API_KEYS,
  ADMIN_AGENT_TOOLS_API_KEYS: env.ADMIN_AGENT_TOOLS_API_KEYS,
  MANAGER_ADMIN_API_KEY: env.MANAGER_ADMIN_API_KEY,
  WEB_ADMIN_API_KEYS: env.WEB_ADMIN_API_KEYS,
  FLEET_ADMIN_API_KEYS: env.FLEET_ADMIN_API_KEYS,
  WATCH_PROGRESS_ADMIN_API_KEYS: env.WATCH_PROGRESS_ADMIN_API_KEYS,
  BACKUP_DOWNLOAD_API_KEYS: env.BACKUP_DOWNLOAD_API_KEYS,
  SEARCH_TRACE_SAMPLING_API_KEYS: env.SEARCH_TRACE_SAMPLING_API_KEYS,
})

// Plan 003 retired the SEARCH_API_KEYS env-CSV partner branch — external
// partner credentials now live in admin's `PartnerApiKey` Postgres table
// and are issued via `pnpm --filter @forge/admin partner-keys create`.
// If a Doppler env still has the retired value set, code no longer reads
// it, but operator confusion is real — flag once at boot so the stale
// value is visible in Railway logs.
// Plain-string format per `railway-logsv2-silences-nextjs-stdout-runtime-20260518`.
if (process.env.SEARCH_API_KEYS && process.env.SEARCH_API_KEYS.length > 0) {
  console.warn(
    `[search] event=search_api_keys_env_var_retired note=migrate_to_partner_keys`,
  )
}
