import { createHash } from "node:crypto"
import { BOOTSTRAP_RECOMMENDATION_MANIFEST_ID } from "../manifest.service"
import {
  DELIVERY_RETRIEVAL_BUDGET_MS,
  MAX_DELIVERY_ITEMS,
  RECOMMENDATION_CONTRACTS,
} from "../contracts"
import {
  PROFILE_CLUSTERING_VERSION,
  PROFILE_PROJECTION_VERSION,
} from "../profiles/projection"
import {
  CANDIDATE_CONTEXT_VERSION,
  CANDIDATE_ELIGIBILITY_VERSION,
  CANDIDATE_UNION_VERSION,
  HYBRID_DETERMINISTIC_RANKER_VERSION,
  HYBRID_SLATE_COMPOSER_VERSION,
  SEMANTIC_CANDIDATE_GENERATOR_VERSION,
} from "../candidate"

export const MULTI_INTEREST_PROFILE_GENERATOR_VERSION =
  "multi-interest-profile-candidate-v1" as const
export const HYBRID_PERSONALIZED_MANIFEST_ID =
  "semantic-profile-hybrid-v1" as const

export const HYBRID_PERSONALIZED_MANIFEST_CONFIGURATION = {
  context: CANDIDATE_CONTEXT_VERSION,
  generators: [
    {
      generator: "semantic",
      version: SEMANTIC_CANDIDATE_GENERATOR_VERSION,
    },
    {
      generator: "multi-interest-profile",
      version: MULTI_INTEREST_PROFILE_GENERATOR_VERSION,
    },
  ],
  profileProjection: PROFILE_PROJECTION_VERSION,
  profileClustering: PROFILE_CLUSTERING_VERSION,
  union: CANDIDATE_UNION_VERSION,
  eligibility: CANDIDATE_ELIGIBILITY_VERSION,
  ranker: HYBRID_DETERMINISTIC_RANKER_VERSION,
  rankerFormula: "rrf-k60-primary-plus-5-percent-secondary-v1",
  composer: HYBRID_SLATE_COMPOSER_VERSION,
  fallbackManifestId: BOOTSTRAP_RECOMMENDATION_MANIFEST_ID,
  shadowDecisionRequired: "promote_to_experiment",
  completeServiceDeadlineMs: DELIVERY_RETRIEVAL_BUDGET_MS,
  learningReads: "published-projections-only",
} as const

export type PromotionManifest = Readonly<{
  id: string
  strategyVersion: string
  contractVersion: string
  surfaceVersion: string
  generator: string
  maxItems: number
  configuration: unknown
  enabled: boolean
}>

/**
 * Published strategy definition only. Migration 0069 does not create an
 * experiment, promotion pointer, serving-control pointer, or exposure row.
 */
export const HYBRID_PERSONALIZED_MANIFEST = {
  id: HYBRID_PERSONALIZED_MANIFEST_ID,
  strategyVersion: HYBRID_PERSONALIZED_MANIFEST_ID,
  contractVersion: RECOMMENDATION_CONTRACTS.delivery,
  surfaceVersion: RECOMMENDATION_CONTRACTS.surface,
  generator: "hybrid",
  maxItems: MAX_DELIVERY_ITEMS,
  configuration: HYBRID_PERSONALIZED_MANIFEST_CONFIGURATION,
  enabled: true,
} as const satisfies PromotionManifest

export function recommendationManifestDigest(manifest: PromotionManifest) {
  return digestValue({
    id: manifest.id,
    strategyVersion: manifest.strategyVersion,
    contractVersion: manifest.contractVersion,
    surfaceVersion: manifest.surfaceVersion,
    generator: manifest.generator,
    maxItems: manifest.maxItems,
    configuration: manifest.configuration,
    enabled: manifest.enabled,
  })
}

export function isEquivalentSemanticChallenger(manifest: PromotionManifest) {
  const config = isRecord(manifest.configuration)
    ? manifest.configuration
    : null
  return (
    manifest.id !== BOOTSTRAP_RECOMMENDATION_MANIFEST_ID &&
    manifest.enabled &&
    manifest.generator === "semantic" &&
    manifest.contractVersion === RECOMMENDATION_CONTRACTS.delivery &&
    manifest.surfaceVersion === RECOMMENDATION_CONTRACTS.surface &&
    manifest.maxItems === MAX_DELIVERY_ITEMS &&
    config?.behaviorallyEquivalentTo === BOOTSTRAP_RECOMMENDATION_MANIFEST_ID &&
    config.completeServiceDeadlineMs === DELIVERY_RETRIEVAL_BUDGET_MS &&
    config.learningReads === false
  )
}

/**
 * Exact gate for the mature semantic + consented-profile execution strategy.
 * Old profile-only challenger evidence cannot authorize this distinct rollout
 * unit, even when individual generator versions happen to overlap.
 */
export function isExactHybridPersonalizedManifest(manifest: PromotionManifest) {
  const config = isRecord(manifest.configuration)
    ? manifest.configuration
    : null
  const generators = Array.isArray(config?.generators) ? config.generators : []
  return (
    manifest.id === HYBRID_PERSONALIZED_MANIFEST_ID &&
    manifest.strategyVersion === HYBRID_PERSONALIZED_MANIFEST_ID &&
    manifest.enabled &&
    manifest.generator === "hybrid" &&
    manifest.contractVersion === RECOMMENDATION_CONTRACTS.delivery &&
    manifest.surfaceVersion === RECOMMENDATION_CONTRACTS.surface &&
    manifest.maxItems === MAX_DELIVERY_ITEMS &&
    config?.context === HYBRID_PERSONALIZED_MANIFEST_CONFIGURATION.context &&
    generators.length === 2 &&
    matchesGenerator(
      generators[0],
      "semantic",
      SEMANTIC_CANDIDATE_GENERATOR_VERSION,
    ) &&
    matchesGenerator(
      generators[1],
      "multi-interest-profile",
      MULTI_INTEREST_PROFILE_GENERATOR_VERSION,
    ) &&
    config.profileProjection ===
      HYBRID_PERSONALIZED_MANIFEST_CONFIGURATION.profileProjection &&
    config.profileClustering ===
      HYBRID_PERSONALIZED_MANIFEST_CONFIGURATION.profileClustering &&
    config.union === HYBRID_PERSONALIZED_MANIFEST_CONFIGURATION.union &&
    config.eligibility ===
      HYBRID_PERSONALIZED_MANIFEST_CONFIGURATION.eligibility &&
    config.ranker === HYBRID_PERSONALIZED_MANIFEST_CONFIGURATION.ranker &&
    config.rankerFormula ===
      HYBRID_PERSONALIZED_MANIFEST_CONFIGURATION.rankerFormula &&
    config.composer === HYBRID_PERSONALIZED_MANIFEST_CONFIGURATION.composer &&
    config.fallbackManifestId ===
      HYBRID_PERSONALIZED_MANIFEST_CONFIGURATION.fallbackManifestId &&
    config.shadowDecisionRequired ===
      HYBRID_PERSONALIZED_MANIFEST_CONFIGURATION.shadowDecisionRequired &&
    config.completeServiceDeadlineMs ===
      HYBRID_PERSONALIZED_MANIFEST_CONFIGURATION.completeServiceDeadlineMs &&
    config.learningReads ===
      HYBRID_PERSONALIZED_MANIFEST_CONFIGURATION.learningReads
  )
}

export function digestValue(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex")
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value)
}

function matchesGenerator(
  value: unknown,
  generator: string,
  version: string,
): boolean {
  return (
    isRecord(value) &&
    value.generator === generator &&
    value.version === version &&
    Object.keys(value).length === 2
  )
}
