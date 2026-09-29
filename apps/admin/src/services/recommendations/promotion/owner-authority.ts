import { Prisma } from "@prisma/client"
import {
  RecommendationConflictError,
  RecommendationInternalStateError,
} from "../errors"
import { qualifyOwnerReleaseGraph } from "../cowatch/owner-qualification"
import {
  COWATCH_DURABLE_LINEAGE_VERSION,
  COWATCH_FEATURE_VERSION,
  COWATCH_PROJECTION_VERSION,
} from "../cowatch/graph"
import { COWATCH_SOURCE_WINDOW_VERSION } from "../cowatch/source-window"
import { MMR_CONFIG } from "../composition/policy"
import { MMR_SLATE_POLICY_VERSION } from "../composition/mmr"
import { profileLineageEligibleSql } from "../profiles/profile-lineage"
import { PROFILE_PROJECTION_CONTRIBUTION_LIMIT } from "../profiles/projection"
import {
  OWNER_APPROVED_COWATCH_MMR_MANIFEST,
  OWNER_APPROVED_COWATCH_MMR_MANIFEST_ID,
  OWNER_RELEASE_POLICY_VERSION,
  COWATCH_OWNER_LIVE_MODE,
  digestValue,
  isExactOwnerApprovedCowatchMmrManifest,
  recommendationManifestDigest,
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

function bindingForGraph(
  graph: {
    windowStart: Date | null
    windowEnd: Date
    evaluationAsOf: Date | null
    publishedAt: Date
  },
  ownerInfluenceFloorGeneration: number,
): OwnerReleaseBinding {
  if (!graph.windowStart || !graph.evaluationAsOf)
    throw new RecommendationConflictError("owner_release_source_window_missing")
  return {
    policyVersion: OWNER_RELEASE_POLICY_VERSION,
    mode: COWATCH_OWNER_LIVE_MODE,
    sourceWindow: {
      version: COWATCH_SOURCE_WINDOW_VERSION,
      windowStart: graph.windowStart.toISOString(),
      windowEnd: graph.windowEnd.toISOString(),
      evaluationAsOf: graph.evaluationAsOf.toISOString(),
    },
    publishedAt: graph.publishedAt.toISOString(),
    lineageVersion: COWATCH_DURABLE_LINEAGE_VERSION,
    projectionVersion: COWATCH_PROJECTION_VERSION,
    featureVersion: COWATCH_FEATURE_VERSION,
    composerVersion: MMR_SLATE_POLICY_VERSION,
    compositionConfig: MMR_CONFIG,
    compositionConfigDigest: digestValue(MMR_CONFIG),
    ownerInfluenceFloorGeneration,
    population: OWNER_APPROVED_COWATCH_MMR_MANIFEST.configuration.population,
    fallbackManifestId:
      OWNER_APPROVED_COWATCH_MMR_MANIFEST.configuration.fallbackManifestId,
  }
}

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

/** Read-only preparation. Activation repeats this inside the atomic release/pointer transaction. */
export async function prepareOwnerReleaseBinding(
  tx: Prisma.TransactionClient,
  input: { graphGenerationId: string; manifestId?: string },
  now: Date,
) {
  const startedAt = Date.now()
  const manifestId = input.manifestId ?? OWNER_APPROVED_COWATCH_MMR_MANIFEST_ID
  const manifest = await tx.recommendationStrategyManifest.findUnique({
    where: { id: manifestId },
  })
  if (!manifest || !isExactOwnerApprovedCowatchMmrManifest(manifest))
    throw new RecommendationConflictError("owner_release_manifest_invalid")
  const qualified = await qualifyOwnerReleaseGraph(
    tx,
    input.graphGenerationId,
    now,
  )
  const fields = {
    manifestId,
    manifestDigest: recommendationManifestDigest(manifest),
    graphGenerationId: input.graphGenerationId,
    binding: bindingForGraph(
      qualified.graph,
      qualified.ownerInfluenceFloorGeneration,
    ),
    validUntil: qualified.validUntil,
    dependencyExpiresAt: qualified.dependencyExpiresAt,
    rawPopulationExpiresAt: qualified.rawPopulationExpiresAt,
  }
  const qualifiedAt = new Date(
    now.getTime() + Math.max(0, Date.now() - startedAt),
  )
  if (fields.validUntil <= qualifiedAt)
    throw new RecommendationConflictError("owner_release_graph_expired")
  return {
    ...fields,
    bindingDigest: ownerReleaseBindingDigest(fields),
    qualifiedAt,
  }
}

/** Constant-sized point reads. All full lineage work is confined to qualification. */
export async function readActiveOwnerRelease(
  tx: Prisma.TransactionClient,
  now: Date,
): Promise<DirectDeliveryAuthority | null> {
  const startedAt = Date.now()
  const pointer = await tx.recommendationPromotionPointer.findUnique({
    where: { id: "recommendation-promotion-pointer" },
    include: { activeOwnerRelease: { include: { manifest: true } } },
  })
  const release = pointer?.activeOwnerRelease
  if (
    !pointer ||
    !release ||
    pointer.stage !== "OWNER_APPROVED" ||
    pointer.killSwitchEnabled ||
    pointer.activeApprovalId != null ||
    pointer.exposureCeilingBps !== 10_000 ||
    pointer.generation !== release.pointerGeneration ||
    pointer.activeManifestId !== release.manifestId ||
    release.pointerGeneration < pointer.ownerInfluenceFloorGeneration ||
    release.revokedAt ||
    release.approvedAt > now ||
    release.qualifiedAt > now ||
    release.validUntil <= now ||
    release.dependencyExpiresAt <= now ||
    release.expiresAt <= now ||
    !isExactOwnerApprovedCowatchMmrManifest(release.manifest) ||
    recommendationManifestDigest(release.manifest) !== release.manifestDigest
  )
    return null
  const graph = await tx.recommendationCowatchGeneration.findUnique({
    where: { id: release.graphGenerationId },
  })
  if (
    !graph ||
    graph.invalidatedAt ||
    graph.expiresAt <= now ||
    graph.publishedAt > now ||
    graph.lineageVersion !== COWATCH_DURABLE_LINEAGE_VERSION ||
    graph.featureVersion !== COWATCH_FEATURE_VERSION ||
    graph.projectionVersion !== COWATCH_PROJECTION_VERSION ||
    graph.sourceWindowVersion !== COWATCH_SOURCE_WINDOW_VERSION ||
    !graph.windowStart ||
    !graph.evaluationAsOf ||
    release.validUntil.getTime() > graph.publishedAt.getTime() + 86_400_000 ||
    release.validUntil > release.dependencyExpiresAt ||
    release.dependencyExpiresAt > graph.expiresAt
  )
    return null
  const binding = bindingForGraph(graph, pointer.ownerInfluenceFloorGeneration)
  if (
    digestValue(binding) !== digestValue(release.binding) ||
    ownerReleaseBindingDigest({
      manifestId: release.manifestId,
      manifestDigest: release.manifestDigest,
      graphGenerationId: release.graphGenerationId,
      binding,
      validUntil: release.validUntil,
      dependencyExpiresAt: release.dependencyExpiresAt,
      rawPopulationExpiresAt: release.rawPopulationExpiresAt,
    }) !== release.bindingDigest ||
    release.validUntil.getTime() <=
      now.getTime() + Math.max(0, Date.now() - startedAt)
  )
    return null
  return {
    releaseId: release.id,
    pointerGeneration: pointer.generation,
    manifestId: release.manifestId,
    manifestDigest: release.manifestDigest,
    graphGenerationId: release.graphGenerationId,
    bindingDigest: release.bindingDigest,
    binding,
    validUntil: release.validUntil,
    dependencyExpiresAt: release.dependencyExpiresAt,
  }
}

/** Locks only, no mutation. Call before pointer CAS, then recheck expected pointer generation. */
export async function lockOwnerReleaseForRevocation(
  tx: Prisma.TransactionClient,
  releaseId: string,
) {
  const release = await tx.recommendationOwnerRelease.findUnique({
    where: { id: releaseId },
    select: { graphGenerationId: true },
  })
  if (release)
    await tx.$queryRaw`SELECT id FROM recommendation_cowatch_generation WHERE id = ${release.graphGenerationId}::char(64) FOR UPDATE`
  await tx.$queryRaw`SELECT id FROM recommendation_owner_release WHERE id = ${releaseId}::uuid FOR UPDATE`
}

/**
 * Freeze only this projection's bounded lineage. UPDATE root locks also exclude
 * new FK children (late facts, revisions, conflicts and promotion fences).
 * NOWAIT is intentional: cleanup can already own a root and be waiting on this
 * profile/projection. Refuse this issuance instead of completing that cycle.
 */
async function lockProfileLineageForIssuance(
  tx: Prisma.TransactionClient,
  projectionId: string,
) {
  const contributions = await tx.$queryRaw<
    Array<{
      sourceOutcomeId: string | null
      sourceSelectionId: string | null
      sourceEligibilityDecisionId: string | null
    }>
  >(Prisma.sql`
    SELECT source_outcome_id AS "sourceOutcomeId",
      source_selection_id AS "sourceSelectionId",
      source_eligibility_decision_id AS "sourceEligibilityDecisionId"
    FROM recommendation_profile_projection_contribution
    WHERE generation_id = ${projectionId}
    ORDER BY id LIMIT ${PROFILE_PROJECTION_CONTRIBUTION_LIMIT + 1}
    FOR SHARE NOWAIT
  `)
  if (contributions.length > PROFILE_PROJECTION_CONTRIBUTION_LIMIT)
    throw new RecommendationInternalStateError(
      "owner_release_profile_lineage_limit",
    )
  // The schema permits four durable interests plus one session interest.
  await tx.$queryRaw`SELECT id FROM recommendation_profile_interest
    WHERE generation_id = ${projectionId} ORDER BY id FOR SHARE NOWAIT`
  const outcomeIds = contributions.flatMap((row) =>
    row.sourceOutcomeId ? [row.sourceOutcomeId] : [],
  )
  const selectionIds = contributions.flatMap((row) =>
    row.sourceSelectionId ? [row.sourceSelectionId] : [],
  )
  const decisionIds = contributions.flatMap((row) =>
    row.sourceEligibilityDecisionId ? [row.sourceEligibilityDecisionId] : [],
  )
  const roots = await tx.$queryRaw<
    Array<{
      requestIds: string[]
      episodeIds: string[]
      itemIds: string[]
    }>
  >(Prisma.sql`
    SELECT
      ARRAY(SELECT request_id FROM recommendation_outcome_revision WHERE id = ANY(${outcomeIds}::text[]) AND request_id IS NOT NULL
        UNION SELECT request_id FROM recommendation_selection WHERE id = ANY(${selectionIds}::text[])) AS "requestIds",
      ARRAY(SELECT episode_id FROM recommendation_outcome_revision WHERE id = ANY(${outcomeIds}::text[])) AS "episodeIds",
      ARRAY(SELECT item_id FROM recommendation_selection WHERE id = ANY(${selectionIds}::text[])) AS "itemIds"
  `)
  const root = roots[0]
  if (!root)
    throw new RecommendationInternalStateError("owner_release_profile_fenced")
  await tx.$queryRaw`SELECT id FROM recommendation_request WHERE id = ANY(${root.requestIds}::text[]) ORDER BY id FOR UPDATE NOWAIT`
  await tx.$queryRaw`SELECT id FROM recommendation_playback_episode WHERE id = ANY(${root.episodeIds}::text[]) ORDER BY id FOR UPDATE NOWAIT`
  await tx.$queryRaw`SELECT id FROM recommendation_outcome_revision WHERE id = ANY(${outcomeIds}::text[]) ORDER BY id FOR UPDATE NOWAIT`
  await tx.$queryRaw`SELECT id FROM recommendation_selection WHERE id = ANY(${selectionIds}::text[]) ORDER BY id FOR SHARE NOWAIT`
  await tx.$queryRaw`SELECT id FROM recommendation_eligibility_decision WHERE id = ANY(${decisionIds}::text[]) ORDER BY id FOR SHARE NOWAIT`
  await tx.$queryRaw`SELECT id FROM recommendation_served_item WHERE id = ANY(${root.itemIds}::text[]) ORDER BY id FOR SHARE NOWAIT`
  // One impression per item is enforced by the existing unique constraint.
  await tx.$queryRaw`SELECT id FROM recommendation_impression WHERE item_id = ANY(${root.itemIds}::text[]) ORDER BY id FOR SHARE NOWAIT`
  await tx.$queryRaw`SELECT id FROM recommendation_owner_release
    WHERE id IN (SELECT owner_release_id FROM recommendation_request WHERE id = ANY(${root.requestIds}::text[]))
    ORDER BY id FOR SHARE NOWAIT`
}

type OwnerProfileIssuanceInput = {
  profileTokenDigest: string
  profileProjectionId: string
  privacyGeneration: number
  consentReceiptDigest: string
  now: Date
}

async function lockOwnerProfileSources(
  tx: Prisma.TransactionClient,
  input: OwnerProfileIssuanceInput,
) {
  await tx.$queryRaw`SELECT id FROM recommendation_profile WHERE token_digest = ${input.profileTokenDigest}::char(64) FOR SHARE`
  await tx.$queryRaw`SELECT id FROM recommendation_consent_receipt WHERE token_digest = ${input.consentReceiptDigest}::char(64) FOR SHARE`
  await tx.$queryRaw`SELECT id FROM recommendation_profile_projection_generation WHERE id = ${input.profileProjectionId} FOR UPDATE NOWAIT`
  await tx.$queryRaw`SELECT scope_digest FROM recommendation_profile_projection_pointer WHERE generation_id = ${input.profileProjectionId} FOR SHARE`
  await lockProfileLineageForIssuance(tx, input.profileProjectionId)
}

async function assertLockedOwnerProfile(
  tx: Prisma.TransactionClient,
  input: OwnerProfileIssuanceInput,
  startedAt: number,
): Promise<Date> {
  const now = new Date(
    input.now.getTime() + Math.max(0, Date.now() - startedAt),
  )
  const [profile, projection, receipt] = await Promise.all([
    tx.recommendationProfile.findUnique({
      where: { tokenDigest: input.profileTokenDigest },
    }),
    tx.recommendationProfileProjectionGeneration.findUnique({
      where: { id: input.profileProjectionId },
      include: { activePointer: true },
    }),
    tx.recommendationConsentReceipt.findUnique({
      where: { tokenDigest: input.consentReceiptDigest },
    }),
  ])
  if (
    !profile ||
    profile.state !== "ACTIVE" ||
    profile.choice !== "DURABLE_ALLOWED" ||
    profile.expiresAt <= now ||
    profile.privacyGeneration !== input.privacyGeneration ||
    !projection ||
    projection.profileId !== profile.id ||
    projection.scope !== "DURABLE" ||
    projection.state !== "PUBLISHED" ||
    projection.expiresAt <= now ||
    !projection.publishedAt ||
    projection.publishedAt > now ||
    projection.privacyGeneration !== input.privacyGeneration ||
    projection.durableInterestCount < 1 ||
    !projection.activePointer ||
    projection.activePointer.profileId !== profile.id ||
    projection.activePointer.privacyGeneration !== input.privacyGeneration ||
    projection.activePointer.scope !== "DURABLE" ||
    !receipt ||
    receipt.profileId !== profile.id ||
    receipt.state !== "ACTIVE" ||
    receipt.choice !== "PERSONALIZATION" ||
    receipt.revokedAt ||
    receipt.expiresAt <= now ||
    receipt.privacyGeneration !== input.privacyGeneration
  )
    throw new RecommendationInternalStateError("owner_release_profile_fenced")
  const currentNow = new Date(
    input.now.getTime() + Math.max(0, Date.now() - startedAt),
  )
  const lineage = await tx.$queryRaw<
    Array<{ eligible: boolean; expiresAt: Date | null }>
  >(Prisma.sql`
    SELECT ${profileLineageEligibleSql(Prisma.sql`${input.profileProjectionId}`, currentNow)} AS eligible,
      (SELECT MIN(LEAST(contribution.expires_at, decision.expires_at, outcome.expires_at,
        episode.expires_at, selection.expires_at, impression.expires_at))
      FROM recommendation_profile_projection_contribution contribution
      LEFT JOIN recommendation_eligibility_decision decision ON decision.id = contribution.source_eligibility_decision_id
      LEFT JOIN recommendation_outcome_revision outcome ON outcome.id = contribution.source_outcome_id
      LEFT JOIN recommendation_playback_episode episode ON episode.id = outcome.episode_id
      LEFT JOIN recommendation_selection selection ON selection.id = contribution.source_selection_id
      LEFT JOIN recommendation_impression impression ON impression.item_id = selection.item_id
      WHERE contribution.generation_id = ${input.profileProjectionId}) AS "expiresAt"
  `)
  if (lineage[0]?.eligible !== true)
    throw new RecommendationInternalStateError(
      "owner_release_profile_lineage_fenced",
    )
  const validUntil =
    lineage[0].expiresAt &&
    new Date(
      Math.min(
        ...[
          profile.expiresAt,
          projection.expiresAt,
          receipt.expiresAt,
          lineage[0].expiresAt,
        ].map((expiresAt) => expiresAt.getTime()),
      ),
    )
  if (
    !validUntil ||
    validUntil.getTime() <=
      input.now.getTime() + Math.max(0, Date.now() - startedAt)
  )
    throw new RecommendationInternalStateError(
      "owner_release_profile_lineage_fenced",
    )
  return validUntil
}

/** A valid incumbent fallback still needs current profile influence, independent of graph availability. */
export async function lockOwnerProfileForIssuance(
  tx: Prisma.TransactionClient,
  input: OwnerProfileIssuanceInput,
): Promise<Date> {
  const startedAt = Date.now()
  await lockOwnerProfileSources(tx, input)
  await tx.$queryRaw`SELECT id FROM recommendation_promotion_pointer WHERE id = 'recommendation-promotion-pointer' FOR SHARE NOWAIT`
  return assertLockedOwnerProfile(tx, input, startedAt)
}

/** Profile/receipt/projection → bounded lineage → graph → release → pointer, held through issuance commit. */
export async function lockOwnerReleaseForIssuance(
  tx: Prisma.TransactionClient,
  input: OwnerProfileIssuanceInput & { expected: DirectDeliveryAuthority },
): Promise<DirectDeliveryAuthority> {
  const startedAt = Date.now()
  await lockOwnerProfileSources(tx, input)
  await tx.$queryRaw`SELECT id FROM recommendation_cowatch_generation WHERE id = ${input.expected.graphGenerationId}::char(64) FOR SHARE NOWAIT`
  await tx.$queryRaw`SELECT id FROM recommendation_owner_release WHERE id = ${input.expected.releaseId}::uuid FOR SHARE NOWAIT`
  await tx.$queryRaw`SELECT id FROM recommendation_promotion_pointer WHERE id = 'recommendation-promotion-pointer' FOR SHARE NOWAIT`
  const profileValidUntil = await assertLockedOwnerProfile(tx, input, startedAt)
  const authority = await readActiveOwnerRelease(
    tx,
    new Date(input.now.getTime() + Math.max(0, Date.now() - startedAt)),
  )
  if (
    !authority ||
    directDeliveryAuthorityDigest(authority) !==
      directDeliveryAuthorityDigest(input.expected)
  )
    throw new RecommendationInternalStateError("owner_release_authority_fenced")
  if (
    profileValidUntil.getTime() <=
    input.now.getTime() + Math.max(0, Date.now() - startedAt)
  )
    throw new RecommendationInternalStateError(
      "owner_release_profile_lineage_fenced",
    )
  return authority
}

/** Bounded audit expiry only. Raw sources never wait for these aggregate rows. */
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
