import { Prisma } from "@prisma/client"
import { RecommendationConflictError } from "../errors"
import {
  COWATCH_DURABLE_LINEAGE_VERSION,
  COWATCH_FEATURE_VERSION,
  COWATCH_PROJECTION_VERSION,
} from "../cowatch/graph"
import { COWATCH_SOURCE_WINDOW_VERSION } from "../cowatch/source-window"
import { MMR_CONFIG } from "../composition/policy"
import { MMR_SLATE_POLICY_VERSION } from "../composition/mmr"
import {
  OWNER_APPROVED_COWATCH_MMR_MANIFEST,
  OWNER_RELEASE_POLICY_VERSION,
  COWATCH_OWNER_LIVE_MODE,
  digestValue,
} from "./manifest"

export type OwnerReleaseBinding = Readonly<{
  policyVersion: typeof OWNER_RELEASE_POLICY_VERSION
  mode: typeof COWATCH_OWNER_LIVE_MODE
  sourceWindow: {
    version: typeof COWATCH_SOURCE_WINDOW_VERSION
    windowStart: string
    windowEnd: string
    evaluationAsOf: string
  }
  publishedAt: string
  lineageVersion: typeof COWATCH_DURABLE_LINEAGE_VERSION
  projectionVersion: typeof COWATCH_PROJECTION_VERSION
  featureVersion: typeof COWATCH_FEATURE_VERSION
  composerVersion: typeof MMR_SLATE_POLICY_VERSION
  compositionConfig: typeof MMR_CONFIG
  compositionConfigDigest: string
  ownerInfluenceFloorGeneration: number
  population: typeof OWNER_APPROVED_COWATCH_MMR_MANIFEST.configuration.population
  fallbackManifestId: string
}>

export type DirectDeliveryAuthority = Readonly<{
  releaseId: string
  pointerGeneration: number
  manifestId: string
  manifestDigest: string
  graphGenerationId: string
  bindingDigest: string
  binding: OwnerReleaseBinding
  validUntil: Date
  dependencyExpiresAt: Date
}>

export const directDeliveryAuthorityDigest = (
  authority: DirectDeliveryAuthority,
) => digestValue(JSON.parse(JSON.stringify(authority)))

export function ownerReleaseBindingDigest(input: {
  manifestId: string
  manifestDigest: string
  graphGenerationId: string
  binding: OwnerReleaseBinding
  validUntil: Date
  dependencyExpiresAt: Date
  rawPopulationExpiresAt: Date
}) {
  return digestValue(JSON.parse(JSON.stringify(input)))
}

type PreparedOwnerRelease = Readonly<{
  manifestId: string
  manifestDigest: string
  graphGenerationId: string
  binding: OwnerReleaseBinding
  validUntil: Date
  dependencyExpiresAt: Date
  rawPopulationExpiresAt: Date
  bindingDigest: string
  qualifiedAt: Date
}>

type OwnerProfileIssuanceInput = {
  profileTokenDigest: string
  profileProjectionId: string
  privacyGeneration: number
  consentReceiptDigest: string
  now: Date
}

/** Retain the historical authority types while refusing new graph bindings. */
export async function prepareOwnerReleaseBinding(
  _tx: Prisma.TransactionClient,
  _input: { graphGenerationId: string; manifestId?: string },
  _now: Date,
): Promise<PreparedOwnerRelease> {
  throw new RecommendationConflictError("behavioral_recommendations_retired")
}

export async function readActiveOwnerRelease(
  _tx: Prisma.TransactionClient,
  _now: Date,
): Promise<DirectDeliveryAuthority | null> {
  return null
}

/** Historical release rows remain lockable for rollback and expiry. */
export async function lockOwnerReleaseForRevocation(
  tx: Prisma.TransactionClient,
  releaseId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM recommendation_owner_release WHERE id = ${releaseId}::uuid FOR UPDATE`
}

export async function lockOwnerProfileForIssuance(
  _tx: Prisma.TransactionClient,
  _input: OwnerProfileIssuanceInput,
): Promise<Date> {
  throw new RecommendationConflictError("behavioral_recommendations_retired")
}

export async function lockOwnerReleaseForIssuance(
  _tx: Prisma.TransactionClient,
  _input: OwnerProfileIssuanceInput & { expected: DirectDeliveryAuthority },
): Promise<DirectDeliveryAuthority> {
  throw new RecommendationConflictError("behavioral_recommendations_retired")
}

/** Retained owner-release history expires under its existing guarded bound. */
export async function purgeExpiredOwnerReleases(
  tx: Prisma.TransactionClient,
  now: Date,
) {
  return tx.$executeRaw`DELETE FROM recommendation_owner_release WHERE id IN (
    SELECT release.id FROM recommendation_owner_release release
    WHERE release.expires_at <= ${now} AND release.raw_population_expires_at <= ${now}
      AND NOT EXISTS (SELECT 1 FROM recommendation_promotion_pointer pointer WHERE pointer.active_owner_release_id = release.id)
    ORDER BY release.expires_at, release.id LIMIT 500 FOR UPDATE SKIP LOCKED
  )`
}
