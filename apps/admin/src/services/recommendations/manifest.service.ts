import type { PrismaClient } from "@prisma/client"
import { MAX_DELIVERY_ITEMS, RECOMMENDATION_CONTRACTS } from "./contracts"

export const BOOTSTRAP_RECOMMENDATION_MANIFEST_ID =
  RECOMMENDATION_CONTRACTS.strategy
export const CANDIDATE_PLATFORM_RECOMMENDATION_MANIFEST_ID =
  "semantic-candidate-platform-v1" as const
export const RECOMMENDATION_SERVING_CONTROL_ID =
  "recommendation-serving-control"
export const MAX_EMERGENCY_REVOKED_KIDS = 32

export type RecommendationServingBlockReason =
  | "ready"
  | "environment_disabled"
  | "keyring_unavailable"
  | "retention_overdue"
  | "control_disabled"
  | "manifest_missing"
  | "manifest_incompatible"

export type RecommendationServingState = Readonly<{
  canIssue: boolean
  reason: RecommendationServingBlockReason
  manifest: {
    id: string
    strategyVersion: string
    contractVersion: string
    surfaceVersion: string
    generator: string
    maxItems: number
    configuration?: unknown
  } | null
  lastKnownGoodManifestId: string | null
  revokedKids: string[]
}>

type ServingStateInput = Readonly<{
  prisma: PrismaClient
  environmentEnabled: boolean
  hasActiveSigner: boolean
  retentionHealthy: boolean
}>

export async function getRecommendationServingState({
  prisma,
  environmentEnabled,
  hasActiveSigner,
  retentionHealthy,
}: ServingStateInput): Promise<RecommendationServingState> {
  const control = await prisma.recommendationServingControl.findUnique({
    where: { id: RECOMMENDATION_SERVING_CONTROL_ID },
    include: { manifest: true },
  })
  const revokedKids = (control?.emergencyRevokedKids ?? []).slice(
    0,
    MAX_EMERGENCY_REVOKED_KIDS,
  )
  const manifest = control?.manifest ?? null
  const lastKnownGoodManifestId =
    manifest?.id === CANDIDATE_PLATFORM_RECOMMENDATION_MANIFEST_ID
      ? candidatePlatformFallbackManifestId(manifest.configuration)
      : manifest?.id === BOOTSTRAP_RECOMMENDATION_MANIFEST_ID
        ? BOOTSTRAP_RECOMMENDATION_MANIFEST_ID
        : null
  const base = { manifest, lastKnownGoodManifestId, revokedKids }

  if (!environmentEnabled) {
    return { ...base, canIssue: false, reason: "environment_disabled" }
  }
  if (!hasActiveSigner) {
    return { ...base, canIssue: false, reason: "keyring_unavailable" }
  }
  if (!retentionHealthy) {
    return { ...base, canIssue: false, reason: "retention_overdue" }
  }
  if (!control || !manifest) {
    return { ...base, canIssue: false, reason: "manifest_missing" }
  }
  if (!control.enabled) {
    return { ...base, canIssue: false, reason: "control_disabled" }
  }
  const commonCompatible =
    control.manifestId === manifest.id &&
    manifest.enabled &&
    manifest.contractVersion === RECOMMENDATION_CONTRACTS.delivery &&
    manifest.surfaceVersion === RECOMMENDATION_CONTRACTS.surface &&
    manifest.generator === "semantic" &&
    manifest.maxItems > 0 &&
    manifest.maxItems <= MAX_DELIVERY_ITEMS
  const bootstrapCompatible =
    manifest.id === BOOTSTRAP_RECOMMENDATION_MANIFEST_ID &&
    manifest.strategyVersion === RECOMMENDATION_CONTRACTS.strategy
  const candidatePlatformCompatible =
    manifest.id === CANDIDATE_PLATFORM_RECOMMENDATION_MANIFEST_ID &&
    manifest.strategyVersion ===
      CANDIDATE_PLATFORM_RECOMMENDATION_MANIFEST_ID &&
    isReadyCandidatePlatformConfiguration(manifest.configuration)
  const compatible =
    commonCompatible && (bootstrapCompatible || candidatePlatformCompatible)
  if (!compatible) {
    return { ...base, canIssue: false, reason: "manifest_incompatible" }
  }

  return { ...base, canIssue: true, reason: "ready" }
}

function candidatePlatformFallbackManifestId(
  configuration: unknown,
): string | null {
  if (!isRecord(configuration)) return null
  return configuration.fallbackManifestId ===
    BOOTSTRAP_RECOMMENDATION_MANIFEST_ID
    ? BOOTSTRAP_RECOMMENDATION_MANIFEST_ID
    : null
}

function isReadyCandidatePlatformConfiguration(
  configuration: unknown,
): boolean {
  if (!isRecord(configuration)) return false
  return (
    configuration.context === "recommendation-context-v1" &&
    configuration.generator === "semantic-transcript-candidate-v1" &&
    configuration.union === "canonical-video-union-v1" &&
    configuration.eligibility === "watch-playable-locale-v1" &&
    configuration.ranker === "semantic-deterministic-ranker-v1" &&
    configuration.rrfBenchmark === "rrf-k60-v1" &&
    configuration.composer === "minimal-playable-slate-v1" &&
    configuration.candidateEligibilityParity === "passed" &&
    configuration.rankerParity === "passed" &&
    configuration.fallbackManifestId === BOOTSTRAP_RECOMMENDATION_MANIFEST_ID &&
    configuration.completeServiceDeadlineMs === 1_500 &&
    configuration.learningReads === false
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value)
}

export async function readEmergencyRevokedRecommendationKids(
  prisma: PrismaClient,
): Promise<string[]> {
  const control = await prisma.recommendationServingControl.findUnique({
    where: { id: RECOMMENDATION_SERVING_CONTROL_ID },
    select: { emergencyRevokedKids: true },
  })
  if (
    !control ||
    control.emergencyRevokedKids.length > MAX_EMERGENCY_REVOKED_KIDS
  ) {
    return []
  }
  return control.emergencyRevokedKids
}
