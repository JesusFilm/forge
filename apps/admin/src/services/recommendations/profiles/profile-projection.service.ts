import { ownerReleaseInfluenceAllowedSql } from "../promotion/owner-influence"
import { createHash } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"

import {
  ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
  activeTranscriptContentEmbeddingWhere,
} from "@/services/content-embedding-contract"

import {
  ACTIVE_WATCH_PROXY_VERSION,
  RECOMMENDATION_CONTRACTS,
} from "../contracts"

import { RECOMMENDATION_INTEGRITY_POLICY_VERSION } from "../integrity-policy"

import {
  buildMultiInterestProjection,
  PROFILE_CLUSTERING_VERSION,
  PROFILE_PROJECTION_VERSION,
  type MultiInterestProjection,
  type ProfileDeclaredSignal,
} from "./projection"

export const PROFILE_PROJECTION_ELIGIBILITY_VERSION =
  RECOMMENDATION_INTEGRITY_POLICY_VERSION
export const PROFILE_PROJECTION_OUTCOME_VERSION = ACTIVE_WATCH_PROXY_VERSION
export const DURABLE_PROFILE_PROJECTION_DAYS = 180
export const SESSION_PROFILE_PROJECTION_HOURS = 24

export type ProfileProjectionEvidence = Readonly<{
  sourceId: string
  sourceType: "outcome" | "selection"
  targetMediaId: string
  weight: number
  occurredAt: Date
  sourceExpiresAt: Date
  eligibilityPolicyVersion: string | null
  outcomeClassifierVersion: string | null
  eligibilityDecisionId?: string | null
  eligibilityRevision?: number | null
  eligibilityInputDigest?: string | null
  eligibilityDecidedAt?: Date | null
  evidenceWatermark?: Date | null
}>

export type LoadedProfileProjectionEvidence = Readonly<{
  durable: ProfileProjectionEvidence[]
  session: ProfileProjectionEvidence[]
  explicitPreferences: ProfileDeclaredSignal[]
  negativeEvidence: ProfileDeclaredSignal[]
}>

export type ProfileProjectionRequest = Readonly<{
  sessionDigest: string | null
  profileId: string | null
  privacyGeneration: number | null
  now?: Date
  expectedPointer?: Readonly<{
    generationId: string | null
    pointerGeneration: number
  }> | null
  runFence?: Readonly<{
    runId: string
    claimId: string
    generation: number
  }> | null
}>

type NormalizedProfileProjectionRequest = ProfileProjectionRequest & {
  now: Date
}

type PublishInput = Readonly<{
  scope: "durable" | "session"
  sessionDigest: string | null
  profileId: string | null
  privacyGeneration: number | null
  now: Date
  inputDigest: string
  projection: MultiInterestProjection
  durableEvidence: ProfileProjectionEvidence[]
  sessionEvidence: ProfileProjectionEvidence[]
  evidenceSnapshotDigest?: string
  sourceEvidenceEmpty?: boolean
  expectedPointer?: ProfileProjectionRequest["expectedPointer"]
  runFence?: ProfileProjectionRequest["runFence"]
}>

export type ProfileProjectionReceipt =
  | Readonly<{
      status: "published"
      generationId: string
      generation: number
      replay: boolean
    }>
  | Readonly<{ status: "empty"; replay: false }>

type ProjectionDependencies = Readonly<{
  loadEvidence: (
    input: NormalizedProfileProjectionRequest,
  ) => Promise<LoadedProfileProjectionEvidence>
  loadEmbeddings: (
    targetMediaIds: readonly string[],
  ) => Promise<ReadonlyMap<string, readonly number[]>>
  publish: (input: PublishInput) => Promise<ProfileProjectionReceipt>
}>

export function createRecommendationProfileProjectionService(
  dependencies: ProjectionDependencies,
) {
  return {
    async project(
      input: ProfileProjectionRequest,
    ): Promise<ProfileProjectionReceipt> {
      const now = input.now ?? new Date()
      if (input.sessionDigest != null) assertDigest(input.sessionDigest)
      if ((input.profileId == null) !== (input.privacyGeneration == null)) {
        throw new RangeError("Profile projection privacy scope is invalid")
      }
      if (input.profileId == null && input.sessionDigest == null) {
        throw new RangeError("Session projection requires a session digest")
      }
      const normalized = { ...input, now }
      const evidence = await dependencies.loadEvidence(normalized)
      const evidenceSnapshotDigest = profileEvidenceSnapshotDigest(evidence)
      const targetMediaIds = [
        ...new Set(
          [...evidence.durable, ...evidence.session].map(
            (row) => row.targetMediaId,
          ),
        ),
      ].sort()
      const embeddings = await dependencies.loadEmbeddings(targetMediaIds)
      const durableEvidence = evidence.durable.filter((row) =>
        embeddings.has(row.targetMediaId),
      )
      const sessionEvidence = evidence.session.filter((row) =>
        embeddings.has(row.targetMediaId),
      )
      const projection = buildMultiInterestProjection({
        durableEvidence: durableEvidence.map((row) => ({
          sourceId: stableSourceDigest(row),
          targetMediaId: row.targetMediaId,
          embedding: embeddings.get(row.targetMediaId)!,
          weight: row.weight,
          occurredAt: row.occurredAt,
        })),
        sessionSelections: sessionEvidence.map((row) => ({
          sourceId: stableSourceDigest(row),
          targetMediaId: row.targetMediaId,
          embedding: embeddings.get(row.targetMediaId)!,
          weight: row.weight,
          occurredAt: row.occurredAt,
        })),
        explicitPreferences: evidence.explicitPreferences,
        negativeEvidence: evidence.negativeEvidence,
      })
      const inputDigest = digestJson({
        projectionVersion: PROFILE_PROJECTION_VERSION,
        clusteringVersion: PROFILE_CLUSTERING_VERSION,
        scope: input.profileId ? "durable" : "session",
        durable: durableEvidence.map(toDigestEvidence),
        session: sessionEvidence.map(toDigestEvidence),
        explicit: projection.explicitPreferences,
        negative: projection.negativeEvidence,
        evidenceSnapshotDigest,
      })
      return dependencies.publish({
        scope: input.profileId ? "durable" : "session",
        sessionDigest: input.sessionDigest,
        profileId: input.profileId,
        privacyGeneration: input.privacyGeneration,
        now,
        inputDigest,
        projection,
        durableEvidence,
        sessionEvidence,
        evidenceSnapshotDigest,
        sourceEvidenceEmpty:
          evidence.durable.length === 0 &&
          evidence.session.length === 0 &&
          evidence.explicitPreferences.length === 0 &&
          evidence.negativeEvidence.length === 0,
        expectedPointer: input.expectedPointer,
        runFence: input.runFence,
      })
    },
  }
}

export function createDatabaseRecommendationProfileProjectionService(
  prisma: PrismaClient,
) {
  return createRecommendationProfileProjectionService({
    loadEvidence: (input) =>
      loadDatabaseProfileProjectionEvidence(prisma, input),
    loadEmbeddings: (targetMediaIds) =>
      loadDatabaseProfileEvidenceEmbeddings(prisma, targetMediaIds),
    publish: (input) => publishDatabaseProfileProjection(prisma, input),
  })
}

export async function loadDatabaseProfileProjectionEvidence(
  prisma: Pick<PrismaClient, "$queryRaw">,
  input: NormalizedProfileProjectionRequest,
): Promise<LoadedProfileProjectionEvidence> {
  const sessionStart = new Date(
    input.now.getTime() - SESSION_PROFILE_PROJECTION_HOURS * 3_600_000,
  )
  type SessionEvidenceRow = {
    sourceId: string
    targetMediaId: string
    weight: number
    occurredAt: Date
    sourceExpiresAt: Date
    eligibilityPolicyVersion: string
    outcomeClassifierVersion: null
    eligibilityDecisionId: string
    eligibilityRevision: number
    eligibilityInputDigest: string
    eligibilityDecidedAt: Date
    evidenceWatermark: Date | null
  }
  const session =
    input.profileId && input.sessionDigest
      ? await prisma.$queryRaw<SessionEvidenceRow[]>(Prisma.sql`
        SELECT
          selection.id AS "sourceId",
          item.target_media_id AS "targetMediaId",
          1::double precision AS weight,
          selection.occurred_at AS "occurredAt",
          LEAST(
            selection.expires_at,
            request.expires_at,
            impression.expires_at,
            link.expires_at,
            profile.expires_at
          ) AS "sourceExpiresAt"
          , decision.policy_version AS "eligibilityPolicyVersion"
          , NULL::text AS "outcomeClassifierVersion"
          , decision.id AS "eligibilityDecisionId"
          , decision.revision AS "eligibilityRevision"
          , decision.input_digest AS "eligibilityInputDigest"
          , decision.decided_at AS "eligibilityDecidedAt"
          , decision.evidence_watermark AS "evidenceWatermark"
        FROM recommendation_profile profile
        JOIN recommendation_profile_session_link link
          ON link.profile_id = profile.id
          AND link.privacy_generation = profile.privacy_generation
          AND link.session_digest = ${input.sessionDigest}
          AND link.expires_at > ${input.now}
        JOIN recommendation_request request
          ON request.session_digest = link.session_digest
        JOIN recommendation_selection selection
          ON selection.request_id = request.id
        JOIN recommendation_served_item item
          ON item.request_id = selection.request_id
          AND item.id = selection.item_id
        JOIN recommendation_impression impression
          ON impression.request_id = selection.request_id
          AND impression.item_id = selection.item_id
          AND impression.visibility_policy IN (${RECOMMENDATION_CONTRACTS.surface}, 'watch-for-you-v1')
          AND impression.expires_at > ${input.now}
          AND impression.expires_at >= selection.attribution_eligible_at
        JOIN recommendation_eligibility_decision decision
          ON decision.selection_id = selection.id
          AND decision.policy_version = ${PROFILE_PROJECTION_ELIGIBILITY_VERSION}
          AND decision.is_current = true
          AND decision.state = 'eligible'
          AND 'profile' = ANY(decision.eligible_scopes)
        WHERE profile.id = ${input.profileId}
          AND profile.privacy_generation = ${input.privacyGeneration}
          AND profile.state = 'active'
          AND profile.token_digest IS NOT NULL
          AND profile.expires_at > ${input.now}
          AND request.expires_at > ${input.now}
          AND selection.expires_at > ${input.now}
          AND decision.expires_at > ${input.now}
          AND selection.attribution_eligible_at <= ${input.now}
          AND selection.occurred_at >= GREATEST(
            ${sessionStart}, profile.created_at, link.linked_at
          )
          AND selection.occurred_at <= ${input.now}
        ORDER BY selection.occurred_at DESC, selection.id
        LIMIT 32
      `)
      : input.sessionDigest
        ? await prisma.$queryRaw<SessionEvidenceRow[]>(Prisma.sql`
        SELECT
          selection.id AS "sourceId",
          item.target_media_id AS "targetMediaId",
          1::double precision AS weight,
          selection.occurred_at AS "occurredAt",
          LEAST(
            selection.expires_at,
            request.expires_at,
            impression.expires_at
          ) AS "sourceExpiresAt"
          , decision.policy_version AS "eligibilityPolicyVersion"
          , NULL::text AS "outcomeClassifierVersion"
          , decision.id AS "eligibilityDecisionId"
          , decision.revision AS "eligibilityRevision"
          , decision.input_digest AS "eligibilityInputDigest"
          , decision.decided_at AS "eligibilityDecidedAt"
          , decision.evidence_watermark AS "evidenceWatermark"
        FROM recommendation_selection selection
        JOIN recommendation_request request ON request.id = selection.request_id
        JOIN recommendation_served_item item
          ON item.request_id = selection.request_id AND item.id = selection.item_id
        JOIN recommendation_impression impression
          ON impression.request_id = selection.request_id
          AND impression.item_id = selection.item_id
          AND impression.visibility_policy IN (${RECOMMENDATION_CONTRACTS.surface}, 'watch-for-you-v1')
          AND impression.expires_at > ${input.now}
          AND impression.expires_at >= selection.attribution_eligible_at
        JOIN recommendation_eligibility_decision decision
          ON decision.selection_id = selection.id
          AND decision.policy_version = ${PROFILE_PROJECTION_ELIGIBILITY_VERSION}
          AND decision.is_current = true
          AND decision.state = 'eligible'
          AND 'profile' = ANY(decision.eligible_scopes)
        WHERE request.session_digest = ${input.sessionDigest}
          AND request.expires_at > ${input.now}
          AND selection.expires_at > ${input.now}
          AND decision.expires_at > ${input.now}
          AND selection.attribution_eligible_at <= ${input.now}
          AND selection.occurred_at >= ${sessionStart}
          AND selection.occurred_at <= ${input.now}
        ORDER BY selection.occurred_at DESC, selection.id
        LIMIT 32
        `)
        : []
  const priorDurable = input.profileId
    ? await prisma.$queryRaw<
        Array<{
          sourceId: string
          targetMediaId: string
          weight: number
          occurredAt: Date
          sourceExpiresAt: Date
          eligibilityPolicyVersion: string | null
          outcomeClassifierVersion: string | null
          eligibilityDecisionId: string
          eligibilityRevision: number
          eligibilityInputDigest: string
          eligibilityDecidedAt: Date
          evidenceWatermark: Date | null
        }>
      >(Prisma.sql`
        SELECT
          outcome.id AS "sourceId",
          contribution.target_media_id AS "targetMediaId",
          LEAST(1, GREATEST(0, decision.contribution_weight))::double precision AS weight,
          outcome.created_at AS "occurredAt",
          LEAST(
            contribution.expires_at,
            outcome.expires_at,
            decision.expires_at
          ) AS "sourceExpiresAt",
          decision.policy_version AS "eligibilityPolicyVersion",
          outcome.classifier_version AS "outcomeClassifierVersion"
          , decision.id AS "eligibilityDecisionId"
          , decision.revision AS "eligibilityRevision"
          , decision.input_digest AS "eligibilityInputDigest"
          , decision.decided_at AS "eligibilityDecidedAt"
          , decision.evidence_watermark AS "evidenceWatermark"
        FROM recommendation_profile_projection_pointer pointer
        JOIN recommendation_profile_projection_generation generation
          ON generation.id = pointer.generation_id
        JOIN recommendation_profile_projection_contribution contribution
          ON contribution.generation_id = generation.id
        JOIN recommendation_profile profile
          ON profile.id = pointer.profile_id
          AND profile.privacy_generation = pointer.privacy_generation
        JOIN recommendation_outcome_revision outcome
          ON outcome.id = contribution.source_outcome_id
        JOIN recommendation_playback_episode episode
          ON episode.id = outcome.episode_id
          AND episode.request_id IS NOT DISTINCT FROM outcome.request_id
          AND episode.item_id IS NOT DISTINCT FROM outcome.item_id
        JOIN recommendation_eligibility_decision decision
          ON decision.outcome_id = outcome.id
          AND decision.id = contribution.source_eligibility_decision_id
          AND decision.revision = contribution.source_eligibility_revision
          AND decision.policy_version = ${PROFILE_PROJECTION_ELIGIBILITY_VERSION}
          AND decision.is_current = true
          AND decision.state = 'eligible'
          AND 'profile' = ANY(decision.eligible_scopes)
        WHERE pointer.scope = 'durable'
          AND pointer.profile_id = ${input.profileId}
          AND pointer.privacy_generation = ${input.privacyGeneration}
          AND generation.state = 'published'
          AND contribution.kind = 'qualified_outcome'
          AND profile.state = 'active'
          AND profile.token_digest IS NOT NULL
          AND profile.expires_at > ${input.now}
          AND outcome.classifier_version = ${PROFILE_PROJECTION_OUTCOME_VERSION}
          AND outcome.qualified_view = true
          AND episode.state = 'finalized'
          AND episode.finalized_at IS NOT NULL
          AND contribution.target_media_id = episode.media_id
          -- Qualified playback is independent of click attribution. The episode
          -- itself must begin after profile authorization, regardless of source.
          AND COALESCE(episode.claimed_at, episode.created_at) >= profile.created_at
          AND outcome.expires_at > ${input.now}
          AND decision.expires_at > ${input.now}
          AND contribution.expires_at > ${input.now}
          AND NOT EXISTS (
            SELECT 1 FROM recommendation_outcome_revision superseding
            WHERE superseding.supersedes_id = outcome.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM recommendation_promotion_slate_fence fence
            WHERE fence.request_id = outcome.request_id
          )
          AND ${ownerReleaseInfluenceAllowedSql(Prisma.sql`outcome.request_id`)}
        ORDER BY outcome.created_at DESC, outcome.id
        LIMIT 64
      `)
    : []
  const currentDurable = input.profileId
    ? await prisma.$queryRaw<
        Array<{
          sourceId: string
          targetMediaId: string
          weight: number
          occurredAt: Date
          sourceExpiresAt: Date
          eligibilityPolicyVersion: string
          outcomeClassifierVersion: string
          eligibilityDecisionId: string
          eligibilityRevision: number
          eligibilityInputDigest: string
          eligibilityDecidedAt: Date
          evidenceWatermark: Date | null
        }>
      >(Prisma.sql`
        SELECT
          outcome.id AS "sourceId",
          episode.media_id AS "targetMediaId",
          LEAST(1, GREATEST(0, decision.contribution_weight))::double precision AS weight,
          outcome.created_at AS "occurredAt",
          LEAST(outcome.expires_at, decision.expires_at) AS "sourceExpiresAt",
          decision.policy_version AS "eligibilityPolicyVersion",
          outcome.classifier_version AS "outcomeClassifierVersion"
          , decision.id AS "eligibilityDecisionId"
          , decision.revision AS "eligibilityRevision"
          , decision.input_digest AS "eligibilityInputDigest"
          , decision.decided_at AS "eligibilityDecidedAt"
          , decision.evidence_watermark AS "evidenceWatermark"
        FROM recommendation_profile profile
        JOIN recommendation_profile_session_link link
          ON link.profile_id = profile.id
          AND link.privacy_generation = profile.privacy_generation
          AND link.expires_at > ${input.now}
        JOIN recommendation_playback_episode episode
          ON episode.session_digest = link.session_digest
        JOIN recommendation_outcome_revision outcome
          ON outcome.episode_id = episode.id
          AND outcome.request_id IS NOT DISTINCT FROM episode.request_id
          AND outcome.item_id IS NOT DISTINCT FROM episode.item_id
        JOIN recommendation_eligibility_decision decision
          ON decision.outcome_id = outcome.id
          AND decision.is_current = true
          AND decision.policy_version = ${PROFILE_PROJECTION_ELIGIBILITY_VERSION}
          AND decision.state = 'eligible'
          AND 'profile' = ANY(decision.eligible_scopes)
        WHERE profile.id = ${input.profileId}
          AND profile.state = 'active'
          AND profile.privacy_generation = ${input.privacyGeneration}
          AND profile.token_digest IS NOT NULL
          AND profile.expires_at > ${input.now}
          AND outcome.classifier_version = ${PROFILE_PROJECTION_OUTCOME_VERSION}
          AND outcome.qualified_view = true
          AND episode.state = 'finalized'
          AND episode.finalized_at IS NOT NULL
          AND COALESCE(episode.claimed_at, episode.created_at) >= GREATEST(profile.created_at, link.linked_at)
          AND outcome.expires_at > ${input.now}
          AND decision.expires_at > ${input.now}
          AND NOT EXISTS (
            SELECT 1 FROM recommendation_outcome_revision superseding
            WHERE superseding.supersedes_id = outcome.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM recommendation_promotion_slate_fence fence
            WHERE fence.request_id = episode.request_id
          )
          AND ${ownerReleaseInfluenceAllowedSql(Prisma.sql`outcome.request_id`)}
        ORDER BY outcome.created_at DESC, outcome.id
        LIMIT 64
      `)
    : []

  const durableByDigest = new Map<string, ProfileProjectionEvidence>()
  for (const row of priorDurable) {
    durableByDigest.set(digestText(row.sourceId), {
      ...row,
      sourceType: "outcome",
    })
  }
  for (const row of currentDurable) {
    durableByDigest.set(digestText(row.sourceId), {
      ...row,
      sourceType: "outcome",
    })
  }
  return {
    durable: [...durableByDigest.values()]
      .sort(
        (left, right) =>
          right.occurredAt.getTime() - left.occurredAt.getTime() ||
          stableSourceDigest(left).localeCompare(stableSourceDigest(right)),
      )
      .slice(0, 64),
    session: session.map((row) => ({
      ...row,
      sourceType: "selection",
    })),
    // U11 is intentionally not a dependency. The channels are independent in
    // the projection contract and remain empty until explicit controls land.
    explicitPreferences: [],
    negativeEvidence: [],
  }
}

export async function loadDatabaseProfileEvidenceEmbeddings(
  prisma: Pick<PrismaClient, "$queryRaw">,
  targetMediaIds: readonly string[],
): Promise<ReadonlyMap<string, readonly number[]>> {
  const bounded = [...new Set(targetMediaIds)].sort().slice(0, 64)
  if (bounded.length === 0) return new Map()
  const rows = await prisma.$queryRaw<
    Array<{ targetMediaId: string; embeddingText: string }>
  >(Prisma.sql`
    SELECT
      transcript.video_id AS "targetMediaId",
      public.avg(chunk.embedding)::text AS "embeddingText"
    FROM video_transcript transcript
    JOIN video_transcript_chunk chunk ON chunk.transcript_id = transcript.id
    WHERE transcript.video_id IN (${Prisma.join(bounded)})
      AND transcript.language = 'en'
      AND chunk.embedding IS NOT NULL
      ${activeTranscriptContentEmbeddingWhere({
        transcriptAlias: "transcript",
        chunkAlias: "chunk",
      })}
    GROUP BY transcript.video_id
    ORDER BY transcript.video_id
  `)
  return new Map(
    rows.flatMap((row) => {
      const vector = parsePgVector(row.embeddingText)
      return vector.length === ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS
        ? [[row.targetMediaId, vector] as const]
        : []
    }),
  )
}

export async function publishDatabaseProfileProjection(
  _prisma: PrismaClient,
  _input: PublishInput,
): Promise<ProfileProjectionReceipt> {
  throw new Error("Behavioral recommendations have been retired")
}

function toDigestEvidence(row: ProfileProjectionEvidence) {
  return {
    source: stableSourceDigest(row),
    target: row.targetMediaId,
    weight: row.weight,
    occurredAt: row.occurredAt.toISOString(),
    sourceExpiresAt: row.sourceExpiresAt.toISOString(),
    eligibility: row.eligibilityPolicyVersion,
    classifier: row.outcomeClassifierVersion,
    eligibilityDecision: row.eligibilityDecisionId ?? null,
    eligibilityRevision: row.eligibilityRevision ?? null,
    eligibilityInput: row.eligibilityInputDigest ?? null,
    eligibilityDecidedAt: row.eligibilityDecidedAt?.toISOString() ?? null,
    evidenceWatermark: row.evidenceWatermark?.toISOString() ?? null,
  }
}

function profileEvidenceSnapshotDigest(
  evidence: LoadedProfileProjectionEvidence,
): string {
  return digestJson({
    durable: [...evidence.durable]
      .map(toDigestEvidence)
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      ),
    session: [...evidence.session]
      .map(toDigestEvidence)
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      ),
    explicit: evidence.explicitPreferences,
    negative: evidence.negativeEvidence,
  })
}

function stableSourceDigest(row: ProfileProjectionEvidence): string {
  return digestText(row.sourceId)
}

function parsePgVector(value: string): number[] {
  if (!value.startsWith("[") || !value.endsWith("]")) return []
  return value.slice(1, -1).split(",").map(Number).filter(Number.isFinite)
}

function assertDigest(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new RangeError("Recommendation projection session digest is invalid")
  }
}

function digestText(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function digestJson(value: unknown): string {
  return digestText(JSON.stringify(value))
}
