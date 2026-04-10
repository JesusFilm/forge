import { env } from "@/config/env"

export type EnrichmentMaterializationTarget = "clone" | "direct"

export function resolveEnrichmentMaterializationTarget(
  forceStageClone: boolean | string | undefined,
): EnrichmentMaterializationTarget {
  return forceStageClone === true || forceStageClone === "true"
    ? "clone"
    : "direct"
}

export function getEnrichmentMaterializationTarget(): EnrichmentMaterializationTarget {
  return resolveEnrichmentMaterializationTarget(
    env.MUX_ENRICHMENT_FORCE_STAGE_CLONE,
  )
}
