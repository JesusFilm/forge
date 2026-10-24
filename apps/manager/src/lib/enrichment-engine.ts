import "server-only"

import {
  createFeatureFlagClient,
  featureFlags,
  type FeatureFlagContext,
} from "@forge/feature-flags"

import { env } from "@/config/env"
import type { EnrichmentEngine } from "@/types/job"

type ResolveEngineInput = {
  key?: string
  custom?: FeatureFlagContext["custom"]
}

let runtimeOverride: EnrichmentEngine | undefined

const enrichmentFlagClient = createFeatureFlagClient({
  sdkKey: env.LAUNCHDARKLY_SDK_KEY,
  localEnv: {
    FORGE_ENRICHMENT_ENGINE_DEFAULT: env.FORGE_ENRICHMENT_ENGINE_DEFAULT,
  },
  defaultValues: {
    "forge.enrichment.engine": false,
  },
  timeoutSeconds: 0.25,
  logger: console,
})

export function setRuntimeEnrichmentEngineOverride(
  engine: EnrichmentEngine | undefined,
) {
  runtimeOverride = engine
}

export function getRuntimeEnrichmentEngineOverride() {
  return runtimeOverride
}

export function isMastraEnrichmentRampEnabled() {
  return env.FORGE_ENRICHMENT_MASTRA_RAMP_ENABLED === "true"
}

function createManagerEnrichmentFlagContext(
  input: ResolveEngineInput = {},
): FeatureFlagContext {
  return {
    kind: "service",
    key: input.key ?? "forge-manager-enrichment",
    name: "Forge Manager Enrichment",
    custom: {
      app: "manager",
      surface: "enrichment",
      ...input.custom,
    },
  }
}

export async function resolveEnrichmentEngine(
  input: ResolveEngineInput = {},
): Promise<EnrichmentEngine> {
  const mastraRampEnabled = isMastraEnrichmentRampEnabled()

  if (runtimeOverride) {
    if (runtimeOverride === "mastra" && !mastraRampEnabled) {
      return "workflow"
    }
    return runtimeOverride
  }

  const useMastra = await enrichmentFlagClient.booleanVariation(
    featureFlags.managerEnrichmentEngine,
    createManagerEnrichmentFlagContext(input),
  )

  return useMastra && mastraRampEnabled ? "mastra" : "workflow"
}
