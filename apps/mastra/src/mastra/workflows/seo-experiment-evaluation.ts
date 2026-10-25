import { createHash } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import { getSeoConfig, type SeoConfig } from "../../config/seo"
import {
  claimDueSeoExperiments,
  recordSeoEvaluation,
  type SeoExperimentClaim,
} from "../../services/admin-seo-client"
import { queryGoogleAnalytics } from "../../services/google-analytics-client"
import { queryGoogleSearchConsole } from "../../services/google-search-console-client"
import { normalizeSeoPageText } from "../../services/seo-data-minimization"
import { fetchSeoUrl } from "../../services/seo-http"

export const SeoExperimentEvaluationInputSchema = z
  .object({ scheduledFor: z.string().datetime().optional() })
  .strict()
export const SeoExperimentEvaluationOutputSchema = z
  .object({
    ok: z.boolean(),
    mode: z.enum(["off", "dry_run", "live"]),
    claimed: z.number().int().nonnegative(),
    recorded: z.number().int().nonnegative(),
    awaitingActivation: z.number().int().nonnegative(),
    insufficient: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  })
  .strict()

type EvaluationEvent = {
  type:
    | "awaiting_activation"
    | "activated"
    | "interim"
    | "beneficial"
    | "neutral"
    | "harmful"
    | "inconclusive"
    | "insufficient_data"
    | "ticket_only"
  observedAt: string
  observedHash: string | null
  metrics: Record<string, unknown>
  caveats: string[]
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function totals(rows: Array<{ clicks: number; impressions: number }>): {
  clicks: number
  impressions: number
  ctr: number
} {
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0)
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0)
  return {
    clicks,
    impressions,
    ctr: impressions === 0 ? 0 : clicks / impressions,
  }
}

async function probeActivation(
  experiment: SeoExperimentClaim,
  config: SeoConfig,
  options: {
    fetchImpl?: typeof fetch
    resolveHost?: Parameters<typeof fetchSeoUrl>[1]["resolveHost"]
  } = {},
): Promise<{ hash: string | null; matched: boolean; caveat?: string }> {
  if (experiment.lane === "editorial") {
    return {
      hash: experiment.currentCanonicalActivationHash,
      matched:
        experiment.currentCanonicalActivationHash ===
        experiment.expectedActivationHash,
      ...(experiment.currentCanonicalActivationHash
        ? {}
        : { caveat: "canonical_content_unavailable" }),
    }
  }
  const probe = experiment.deploymentProbe
  if (!probe) {
    return { hash: null, matched: false, caveat: "ticket_only" }
  }
  if (probe && !["page_text_hash", "response_header"].includes(probe.type)) {
    return { hash: null, matched: false, caveat: "probe_not_supported_in_v1" }
  }
  const targetUrl = probe?.canonicalUrl ?? experiment.canonicalUrl
  const response = await fetchSeoUrl(targetUrl, {
    allowedHosts: config.allowedPageHosts,
    timeoutMs: probe?.timeoutMs ?? config.timeoutMs,
    maxBytes: config.maxResponseBytes,
    fetchImpl: options.fetchImpl,
    resolveHost: options.resolveHost,
  })
  if (!response.ok || response.status < 200 || response.status >= 300) {
    return {
      hash: null,
      matched: false,
      caveat: response.ok ? "probe_http_error" : response.reason,
    }
  }
  if (probe?.type === "response_header") {
    const value = probe.headerName
      ? response.headers.get(probe.headerName)
      : null
    const observed = value == null ? null : sha256(value)
    return {
      hash: observed,
      matched: observed === experiment.expectedActivationHash,
      ...(value == null ? { caveat: "header_missing" } : {}),
    }
  }
  const observed = sha256(
    normalizeSeoPageText(new TextDecoder().decode(response.body)),
  )
  return {
    hash: observed,
    matched: observed === experiment.expectedActivationHash,
  }
}

async function evaluateMetrics(
  experiment: SeoExperimentClaim,
  config: SeoConfig,
  deps: {
    queryGsc?: typeof queryGoogleSearchConsole
    queryGa4?: typeof queryGoogleAnalytics
  },
): Promise<EvaluationEvent> {
  if (
    !experiment.gscPropertyId ||
    !experiment.baselineWindow ||
    !experiment.treatmentWindow
  ) {
    return {
      type: "insufficient_data",
      observedAt: new Date().toISOString(),
      observedHash: null,
      metrics: {},
      caveats: [
        "A final Search Console property or comparable measurement windows were unavailable.",
      ],
    }
  }
  const gsc = deps.queryGsc ?? queryGoogleSearchConsole
  const baseline = await gsc({
    propertyId: experiment.gscPropertyId,
    ...experiment.baselineWindow,
    dimensions: ["date", "page"],
    dataState: "final",
    filters: [
      {
        dimension: "page",
        operator: "equals",
        expression: experiment.canonicalUrl,
      },
    ],
    config,
  })
  const treatment = await gsc({
    propertyId: experiment.gscPropertyId,
    ...experiment.treatmentWindow,
    dimensions: ["date", "page"],
    dataState: "final",
    filters: [
      {
        dimension: "page",
        operator: "equals",
        expression: experiment.canonicalUrl,
      },
    ],
    config,
  })
  if (!baseline.ok || !treatment.ok) {
    return {
      type: "insufficient_data",
      observedAt: new Date().toISOString(),
      observedHash: null,
      metrics: {},
      caveats: ["Comparable final Search Console windows were unavailable."],
    }
  }
  const before = totals(baseline.rows)
  const after = totals(treatment.rows)
  const metrics: Record<string, unknown> = {
    gsc: { baseline: before, treatment: after },
  }
  if (
    before.impressions < config.evaluation.minImpressions ||
    after.impressions < config.evaluation.minImpressions
  ) {
    return {
      type: "insufficient_data",
      observedAt: new Date().toISOString(),
      observedHash: null,
      metrics,
      caveats: [
        "One or both comparable GSC windows are below the configured impression threshold.",
      ],
    }
  }
  if (experiment.confounders.length > 0) {
    return {
      type: "inconclusive",
      observedAt: new Date().toISOString(),
      observedHash: null,
      metrics,
      caveats: [
        "The evaluation is confounded by an overlapping change or known anomaly.",
        ...experiment.confounders,
      ],
    }
  }
  const ctrChange =
    before.ctr === 0
      ? after.ctr > 0
        ? 1
        : 0
      : (after.ctr - before.ctr) / before.ctr
  let guardrailHarmed = false
  if (experiment.ga4PropertyId) {
    const ga4 = deps.queryGa4 ?? queryGoogleAnalytics
    const [beforeGa4, afterGa4] = await Promise.all([
      ga4({
        propertyId: experiment.ga4PropertyId,
        ...experiment.baselineWindow,
        landingPage: experiment.canonicalUrl,
        config,
      }),
      ga4({
        propertyId: experiment.ga4PropertyId,
        ...experiment.treatmentWindow,
        landingPage: experiment.canonicalUrl,
        config,
      }),
    ])
    if (beforeGa4.ok && afterGa4.ok) {
      const sum = (rows: typeof beforeGa4.rows, metric: string) =>
        rows.reduce((total, row) => total + (row.metrics[metric] ?? 0), 0)
      const beforeSessions = sum(beforeGa4.rows, "sessions")
      const afterSessions = sum(afterGa4.rows, "sessions")
      const sessionChange =
        beforeSessions === 0
          ? 0
          : (afterSessions - beforeSessions) / beforeSessions
      metrics.ga4 = {
        baselineSessions: beforeSessions,
        treatmentSessions: afterSessions,
        sessionChange,
      }
      guardrailHarmed =
        sessionChange <= -config.evaluation.guardrailChangeThreshold
    }
  }
  const searchThreshold = config.evaluation.searchChangeThreshold
  const type =
    guardrailHarmed || ctrChange <= -searchThreshold
      ? "harmful"
      : ctrChange >= searchThreshold
        ? "beneficial"
        : "neutral"
  return {
    type,
    observedAt: new Date().toISOString(),
    observedHash: null,
    metrics: { ...metrics, ctrChange },
    caveats: [
      "Search Console determines the search verdict; GA4 is used only as a landing-page guardrail.",
    ],
  }
}

export async function runSeoExperimentEvaluation(
  rawInput: z.input<typeof SeoExperimentEvaluationInputSchema>,
  deps: {
    config?: SeoConfig
    claim?: typeof claimDueSeoExperiments
    record?: typeof recordSeoEvaluation
    queryGsc?: typeof queryGoogleSearchConsole
    queryGa4?: typeof queryGoogleAnalytics
    fetchImpl?: typeof fetch
    resolveHost?: Parameters<typeof fetchSeoUrl>[1]["resolveHost"]
  } = {},
) {
  const input = SeoExperimentEvaluationInputSchema.parse(rawInput)
  const config = deps.config ?? getSeoConfig()
  if (config.automationMode !== "live") {
    return SeoExperimentEvaluationOutputSchema.parse({
      ok: true,
      mode: config.automationMode,
      claimed: 0,
      recorded: 0,
      awaitingActivation: 0,
      insufficient: 0,
      failed: 0,
    })
  }
  const scheduledFor = input.scheduledFor ?? new Date().toISOString()
  const claimed = await (deps.claim ?? claimDueSeoExperiments)({
    action: "claim_due",
    claimId: `seo-evaluation:${scheduledFor.slice(0, 10)}`,
    limit: 25,
  })
  if (!claimed.ok) {
    return SeoExperimentEvaluationOutputSchema.parse({
      ok: false,
      mode: config.automationMode,
      claimed: 0,
      recorded: 0,
      awaitingActivation: 0,
      insufficient: 0,
      failed: 1,
    })
  }
  let recorded = 0
  let awaitingActivation = 0
  let insufficient = 0
  let failed = 0
  for (const experiment of claimed.result.experiments) {
    try {
      let event: EvaluationEvent
      if (experiment.stage === "activation") {
        const probe = await probeActivation(experiment, config, {
          fetchImpl: deps.fetchImpl,
          resolveHost: deps.resolveHost,
        })
        event = {
          type:
            probe.caveat === "ticket_only"
              ? "ticket_only"
              : probe.matched
                ? "activated"
                : "awaiting_activation",
          observedAt: new Date().toISOString(),
          observedHash: probe.hash,
          metrics: {},
          caveats: probe.caveat ? [probe.caveat] : [],
        }
        if (!probe.matched) awaitingActivation += 1
      } else {
        event = await evaluateMetrics(experiment, config, deps)
        if (
          experiment.stage === "interim" &&
          !["insufficient_data", "inconclusive"].includes(event.type)
        ) {
          event = { ...event, type: "interim" }
        }
        if (event.type === "insufficient_data") insufficient += 1
      }
      const result = await (deps.record ?? recordSeoEvaluation)({
        action: "record_result",
        experimentId: experiment.id,
        claimGeneration: experiment.claimGeneration,
        claimToken: experiment.claimToken,
        kind: experiment.stage,
        outcome: event.type,
        metrics: event.metrics,
        evidenceDigest: sha256(JSON.stringify(event)),
        confounders: experiment.confounders,
        observedAt: event.observedAt,
        observedActivationHash:
          experiment.stage === "activation" && event.type === "activated"
            ? event.observedHash
            : null,
        activatedAt:
          experiment.stage === "activation" && event.type === "activated"
            ? event.observedAt
            : null,
      })
      if (result.ok) recorded += 1
      else failed += 1
    } catch {
      failed += 1
    }
  }
  return SeoExperimentEvaluationOutputSchema.parse({
    ok: failed === 0,
    mode: config.automationMode,
    claimed: claimed.result.experiments.length,
    recorded,
    awaitingActivation,
    insufficient,
    failed,
  })
}

const evaluateStep = createStep({
  id: "evaluate-seo-experiments",
  inputSchema: SeoExperimentEvaluationInputSchema,
  outputSchema: SeoExperimentEvaluationOutputSchema,
  execute: async ({ inputData }) => runSeoExperimentEvaluation(inputData),
})

export const seoExperimentEvaluationWorkflow = createWorkflow({
  id: "seo-experiment-evaluation",
  description:
    "Default-off objective activation and matched-window SEO experiment evaluation sweep.",
  inputSchema: SeoExperimentEvaluationInputSchema,
  outputSchema: SeoExperimentEvaluationOutputSchema,
  schedule: { cron: "30 2 * * *", timezone: "UTC" },
})
  .then(evaluateStep)
  .commit()
