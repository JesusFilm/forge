import { z } from "zod"

export const SeoAutomationModeSchema = z.enum(["off", "dry_run", "live"])
export type SeoAutomationMode = z.infer<typeof SeoAutomationModeSchema>

const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
)

const seoEnvironmentSchema = z.object({
  SEO_AUTOMATION_MODE: SeoAutomationModeSchema.default("off"),
  SEO_GSC_PROPERTY_IDS: optionalString,
  SEO_GA4_PROPERTY_IDS: optionalString,
  SEO_GOOGLE_ACCESS_TOKEN: optionalString,
  SEO_OPENAI_API_KEY: optionalString,
  SEO_OPENAI_MODEL: z.string().min(1).default("gpt-5.4-mini"),
  SEO_ALLOWED_PAGE_HOSTS: optionalString,
  SEO_ADMIN_BASE_URL: optionalString,
  SEO_ADMIN_ALLOWED_HOSTS: optionalString,
  SEO_ASSERTION_ENVIRONMENT: z
    .enum(["local", "preview", "staging", "production"])
    .default("local"),
  SEO_WORKLOAD_KEY_ID: optionalString,
  SEO_WORKLOAD_PRIVATE_KEY: optionalString,
  SEO_LINEAR_API_KEY: optionalString,
  SEO_LINEAR_TEAM_ID: optionalString,
  SEO_LINEAR_PROJECT_ID: optionalString,
  SEO_LINEAR_LABEL_IDS: optionalString,
  SEO_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(60_000)
    .default(15_000),
  SEO_MAX_RESPONSE_BYTES: z.coerce
    .number()
    .int()
    .min(16_384)
    .max(8_388_608)
    .default(2_097_152),
  SEO_MAX_PROVIDER_ATTEMPTS: z.coerce.number().int().min(1).max(4).default(3),
  SEO_MAX_GSC_ROWS: z.coerce.number().int().min(1).max(100_000).default(25_000),
  SEO_MAX_GA4_ROWS: z.coerce.number().int().min(1).max(100_000).default(25_000),
  SEO_MAX_PROPOSALS: z.coerce.number().int().min(1).max(50).default(12),
  SEO_MAX_GROUNDED_OBSERVATIONS: z.coerce
    .number()
    .int()
    .min(0)
    .max(20)
    .default(6),
  SEO_EVALUATION_MIN_IMPRESSIONS: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000_000)
    .default(200),
  SEO_SEARCH_CHANGE_THRESHOLD: z.coerce.number().min(0.01).max(1).default(0.1),
  SEO_GUARDRAIL_CHANGE_THRESHOLD: z.coerce
    .number()
    .min(0.01)
    .max(1)
    .default(0.15),
})

function csv(value: string | undefined): string[] {
  return [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ]
}

export type SeoConfig = {
  automationMode: SeoAutomationMode
  gscPropertyIds: string[]
  ga4PropertyIds: string[]
  googleAccessToken?: string
  openAiApiKey?: string
  openAiModel: string
  allowedPageHosts: string[]
  admin: {
    baseUrl?: string
    allowedHosts: string[]
    environment: string
    keyId?: string
    privateKey?: string
  }
  linear: {
    apiKey?: string
    teamId?: string
    projectId?: string
    labelIds: string[]
  }
  timeoutMs: number
  maxResponseBytes: number
  maxProviderAttempts: number
  maxGscRows: number
  maxGa4Rows: number
  maxProposals: number
  maxGroundedObservations: number
  evaluation: {
    minImpressions: number
    searchChangeThreshold: number
    guardrailChangeThreshold: number
  }
}

export function getSeoConfig(
  source: NodeJS.ProcessEnv = process.env,
): SeoConfig {
  const parsed = seoEnvironmentSchema.parse(source)
  if (
    source.NODE_ENV === "production" &&
    parsed.SEO_ASSERTION_ENVIRONMENT === "local" &&
    (parsed.SEO_WORKLOAD_KEY_ID || parsed.SEO_WORKLOAD_PRIVATE_KEY)
  ) {
    throw new Error(
      "SEO_ASSERTION_ENVIRONMENT must be explicit outside local development.",
    )
  }
  return {
    automationMode: parsed.SEO_AUTOMATION_MODE,
    gscPropertyIds: csv(parsed.SEO_GSC_PROPERTY_IDS),
    ga4PropertyIds: csv(parsed.SEO_GA4_PROPERTY_IDS),
    googleAccessToken: parsed.SEO_GOOGLE_ACCESS_TOKEN,
    openAiApiKey: parsed.SEO_OPENAI_API_KEY,
    openAiModel: parsed.SEO_OPENAI_MODEL,
    allowedPageHosts: csv(parsed.SEO_ALLOWED_PAGE_HOSTS).map((host) =>
      host.toLowerCase(),
    ),
    admin: {
      baseUrl: parsed.SEO_ADMIN_BASE_URL,
      allowedHosts: csv(parsed.SEO_ADMIN_ALLOWED_HOSTS).map((host) =>
        host.toLowerCase(),
      ),
      environment: parsed.SEO_ASSERTION_ENVIRONMENT,
      keyId: parsed.SEO_WORKLOAD_KEY_ID,
      privateKey: parsed.SEO_WORKLOAD_PRIVATE_KEY?.replaceAll("\\n", "\n"),
    },
    linear: {
      apiKey: parsed.SEO_LINEAR_API_KEY,
      teamId: parsed.SEO_LINEAR_TEAM_ID,
      projectId: parsed.SEO_LINEAR_PROJECT_ID,
      labelIds: csv(parsed.SEO_LINEAR_LABEL_IDS),
    },
    timeoutMs: parsed.SEO_TIMEOUT_MS,
    maxResponseBytes: parsed.SEO_MAX_RESPONSE_BYTES,
    maxProviderAttempts: parsed.SEO_MAX_PROVIDER_ATTEMPTS,
    maxGscRows: parsed.SEO_MAX_GSC_ROWS,
    maxGa4Rows: parsed.SEO_MAX_GA4_ROWS,
    maxProposals: parsed.SEO_MAX_PROPOSALS,
    maxGroundedObservations: parsed.SEO_MAX_GROUNDED_OBSERVATIONS,
    evaluation: {
      minImpressions: parsed.SEO_EVALUATION_MIN_IMPRESSIONS,
      searchChangeThreshold: parsed.SEO_SEARCH_CHANGE_THRESHOLD,
      guardrailChangeThreshold: parsed.SEO_GUARDRAIL_CHANGE_THRESHOLD,
    },
  }
}

export type SeoCapabilities = {
  gsc: boolean
  ga4: boolean
  firecrawl: boolean
  groundedSearch: boolean
  adminLedger: boolean
  linearDispatch: boolean
}

export function getSeoCapabilities(
  config: SeoConfig = getSeoConfig(),
  firecrawlConfigured = Boolean(process.env.FIRECRAWL_API_KEY),
): SeoCapabilities {
  const googleConfigured =
    Boolean(config.googleAccessToken) ||
    Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS) ||
    Boolean(process.env.GOOGLE_CLOUD_PROJECT)
  return {
    gsc: googleConfigured && config.gscPropertyIds.length > 0,
    ga4: googleConfigured && config.ga4PropertyIds.length > 0,
    firecrawl: firecrawlConfigured,
    groundedSearch: Boolean(config.openAiApiKey),
    adminLedger: Boolean(
      config.admin.baseUrl &&
      config.admin.keyId &&
      config.admin.privateKey &&
      config.admin.allowedHosts.length > 0,
    ),
    linearDispatch: Boolean(config.linear.apiKey && config.linear.teamId),
  }
}
