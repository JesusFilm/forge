import { createHash, randomUUID } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import { MULTI_INTEREST_PROFILE_MANIFEST_ID } from "../candidates/profile-candidate.service"
import { RecommendationInternalStateError } from "../errors"
import { withRecommendationSerializableRetry } from "../transaction-retry"
import {
  buildMultiInterestProjection,
  PROFILE_CLUSTERING_VERSION,
  PROFILE_PROJECTION_VERSION,
  type MultiInterestProjection,
  type ProfileDeclaredSignal,
} from "./projection"

export const PROFILE_PROJECTION_ELIGIBILITY_VERSION =
  "recommendation-integrity-v1" as const
export const PROFILE_PROJECTION_OUTCOME_VERSION =
  "active-watch-proxy-v1" as const
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
}>

export type LoadedProfileProjectionEvidence = Readonly<{
  durable: ProfileProjectionEvidence[]
  session: ProfileProjectionEvidence[]
  explicitPreferences: ProfileDeclaredSignal[]
  negativeEvidence: ProfileDeclaredSignal[]
}>

export type ProfileProjectionRequest = Readonly<{
  sessionDigest: string
  profileId: string | null
  privacyGeneration: number | null
  now?: Date
}>

type PublishInput = Readonly<{
  scope: "durable" | "session"
  sessionDigest: string
  profileId: string | null
  privacyGeneration: number | null
  now: Date
  inputDigest: string
  projection: MultiInterestProjection
  durableEvidence: ProfileProjectionEvidence[]
  sessionEvidence: ProfileProjectionEvidence[]
}>

export type ProfileProjectionReceipt = Readonly<{
  status: "published"
  generationId: string
  generation: number
  replay: boolean
}>

type ProjectionDependencies = Readonly<{
  loadEvidence: (
    input: Required<ProfileProjectionRequest>,
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
      assertDigest(input.sessionDigest)
      if ((input.profileId == null) !== (input.privacyGeneration == null)) {
        throw new RangeError("Profile projection privacy scope is invalid")
      }
      const normalized = { ...input, now } as Required<ProfileProjectionRequest>
      const evidence = await dependencies.loadEvidence(normalized)
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
  input: Required<ProfileProjectionRequest>,
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
  }
  const session = input.profileId
    ? await prisma.$queryRaw<SessionEvidenceRow[]>(Prisma.sql`
        SELECT
          selection.id AS "sourceId",
          item.target_media_id AS "targetMediaId",
          1::double precision AS weight,
          selection.occurred_at AS "occurredAt",
          LEAST(
            selection.expires_at,
            request.expires_at,
            link.expires_at,
            profile.expires_at
          ) AS "sourceExpiresAt"
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
        WHERE profile.id = ${input.profileId}
          AND profile.privacy_generation = ${input.privacyGeneration}
          AND profile.state = 'active'
          AND profile.token_digest IS NOT NULL
          AND profile.expires_at > ${input.now}
          AND request.expires_at > ${input.now}
          AND selection.expires_at > ${input.now}
          AND selection.occurred_at >= GREATEST(
            ${sessionStart}, profile.created_at, link.linked_at
          )
          AND selection.occurred_at <= ${input.now}
        ORDER BY selection.occurred_at DESC, selection.id
        LIMIT 32
      `)
    : await prisma.$queryRaw<SessionEvidenceRow[]>(Prisma.sql`
        SELECT
          selection.id AS "sourceId",
          item.target_media_id AS "targetMediaId",
          1::double precision AS weight,
          selection.occurred_at AS "occurredAt",
          LEAST(selection.expires_at, request.expires_at) AS "sourceExpiresAt"
        FROM recommendation_selection selection
        JOIN recommendation_request request ON request.id = selection.request_id
        JOIN recommendation_served_item item
          ON item.request_id = selection.request_id AND item.id = selection.item_id
        WHERE request.session_digest = ${input.sessionDigest}
          AND request.expires_at > ${input.now}
          AND selection.expires_at > ${input.now}
          AND selection.occurred_at >= ${sessionStart}
          AND selection.occurred_at <= ${input.now}
        ORDER BY selection.occurred_at DESC, selection.id
        LIMIT 32
      `)
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
          ON episode.request_id = outcome.request_id
          AND episode.item_id = outcome.item_id
          AND episode.id = outcome.episode_id
        JOIN recommendation_selection selection
          ON selection.request_id = episode.request_id
          AND selection.item_id = episode.item_id
          AND selection.id = episode.selection_id
        JOIN recommendation_request request
          ON request.id = outcome.request_id
        JOIN recommendation_eligibility_decision decision
          ON decision.outcome_id = outcome.id
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
          AND request.created_at >= profile.created_at
          AND selection.occurred_at >= profile.created_at
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
        }>
      >(Prisma.sql`
        SELECT
          outcome.id AS "sourceId",
          item.target_media_id AS "targetMediaId",
          LEAST(1, GREATEST(0, decision.contribution_weight))::double precision AS weight,
          outcome.created_at AS "occurredAt",
          LEAST(outcome.expires_at, decision.expires_at) AS "sourceExpiresAt",
          decision.policy_version AS "eligibilityPolicyVersion",
          outcome.classifier_version AS "outcomeClassifierVersion"
        FROM recommendation_profile profile
        JOIN recommendation_profile_session_link link
          ON link.profile_id = profile.id
          AND link.privacy_generation = profile.privacy_generation
          AND link.expires_at > ${input.now}
        JOIN recommendation_request request
          ON request.session_digest = link.session_digest
          AND request.expires_at > ${input.now}
        JOIN recommendation_outcome_revision outcome
          ON outcome.request_id = request.id
        JOIN recommendation_playback_episode episode
          ON episode.request_id = outcome.request_id
          AND episode.item_id = outcome.item_id
          AND episode.id = outcome.episode_id
        JOIN recommendation_selection selection
          ON selection.request_id = episode.request_id
          AND selection.item_id = episode.item_id
          AND selection.id = episode.selection_id
        JOIN recommendation_served_item item
          ON item.request_id = outcome.request_id AND item.id = outcome.item_id
        JOIN recommendation_eligibility_decision decision
          ON decision.outcome_id = outcome.id
          AND decision.is_current = true
          AND decision.policy_version = ${PROFILE_PROJECTION_ELIGIBILITY_VERSION}
          AND decision.state = 'eligible'
          AND 'profile' = ANY(decision.eligible_scopes)
        WHERE profile.id = ${input.profileId}
          AND profile.state = 'active'
          AND profile.privacy_generation = ${input.privacyGeneration}
          AND profile.expires_at > ${input.now}
          AND outcome.classifier_version = ${PROFILE_PROJECTION_OUTCOME_VERSION}
          AND outcome.qualified_view = true
          AND request.created_at >= GREATEST(profile.created_at, link.linked_at)
          AND selection.occurred_at >= GREATEST(profile.created_at, link.linked_at)
          AND COALESCE(episode.claimed_at, episode.created_at) >= GREATEST(profile.created_at, link.linked_at)
          AND outcome.expires_at > ${input.now}
          AND decision.expires_at > ${input.now}
          AND NOT EXISTS (
            SELECT 1 FROM recommendation_outcome_revision superseding
            WHERE superseding.supersedes_id = outcome.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM recommendation_promotion_slate_fence fence
            WHERE fence.request_id = outcome.request_id
          )
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
      eligibilityPolicyVersion: null,
      outcomeClassifierVersion: null,
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
      AND transcript.embedding_provider = 'jesus-film-ai-gateway'
      AND transcript.model = 'embeddings'
      AND transcript.dimensions = 1536
      AND transcript.embedding_native_dimensions = 1536
      AND transcript.embedding_transform_version IS NULL
      AND chunk.embedding IS NOT NULL
      AND chunk.model = 'embeddings'
      AND chunk.dimensions = 1536
    GROUP BY transcript.video_id
    ORDER BY transcript.video_id
  `)
  return new Map(
    rows.flatMap((row) => {
      const vector = parsePgVector(row.embeddingText)
      return vector.length === 1_536
        ? [[row.targetMediaId, vector] as const]
        : []
    }),
  )
}

export async function publishDatabaseProfileProjection(
  prisma: PrismaClient,
  input: PublishInput,
): Promise<ProfileProjectionReceipt> {
  const scopeDigest = digestText(
    input.scope === "durable"
      ? `durable:${input.profileId}:${input.privacyGeneration}`
      : `session:${input.sessionDigest}`,
  )
  return withRecommendationSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`profile-projection:${scopeDigest}`}, 386)
        )
      `)
        let profileExpiresAt: Date | null = null
        if (input.scope === "durable") {
          const profiles = await tx.$queryRaw<Array<{ expiresAt: Date }>>(
            Prisma.sql`
            SELECT expires_at AS "expiresAt"
            FROM recommendation_profile
            WHERE id = ${input.profileId}
              AND privacy_generation = ${input.privacyGeneration}
              AND state = 'active'
              AND token_digest IS NOT NULL
              AND expires_at > ${input.now}
            FOR UPDATE
          `,
          )
          profileExpiresAt = profiles[0]?.expiresAt ?? null
          if (!profileExpiresAt) {
            throw new RecommendationInternalStateError(
              "profile_projection_generation_revoked",
            )
          }
        }
        const existing = await tx.$queryRaw<
          Array<{ id: string; generation: number }>
        >(Prisma.sql`
        SELECT id, generation
        FROM recommendation_profile_projection_generation
        WHERE input_digest = ${input.inputDigest}
          AND (
            (${input.scope}::text = 'durable' AND scope = 'durable'
              AND profile_id = ${input.profileId}
              AND privacy_generation = ${input.privacyGeneration})
            OR (${input.scope}::text = 'session' AND scope = 'session'
              AND session_digest = ${input.sessionDigest})
          )
        LIMIT 1
      `)
        if (existing[0]) {
          return {
            status: "published" as const,
            generationId: existing[0].id,
            generation: existing[0].generation,
            replay: true,
          }
        }
        const allEvidence = [...input.durableEvidence, ...input.sessionEvidence]
        const watermark = latestDate(allEvidence.map((row) => row.occurredAt))
        const current = await tx.$queryRaw<
          Array<{
            id: string
            generation: number
            inputWatermark: Date | null
            contributionCount: number
          }>
        >(Prisma.sql`
          SELECT
            generation.id,
            generation.generation,
            generation.input_watermark AS "inputWatermark",
            generation.contribution_count AS "contributionCount"
          FROM recommendation_profile_projection_pointer pointer
          JOIN recommendation_profile_projection_generation generation
            ON generation.id = pointer.generation_id
          WHERE pointer.scope_digest = ${scopeDigest}
            AND generation.state = 'published'
            AND generation.expires_at > ${input.now}
          FOR UPDATE OF pointer
        `)
        if (
          current[0] &&
          publishedProjectionIsNewer(
            current[0],
            watermark,
            input.projection.contributionCount,
          )
        ) {
          return {
            status: "published" as const,
            generationId: current[0].id,
            generation: current[0].generation,
            replay: true,
          }
        }
        const next = await tx.$queryRaw<Array<{ generation: number }>>(
          Prisma.sql`
          SELECT COALESCE(MAX(generation), 0)::int + 1 AS generation
          FROM recommendation_profile_projection_generation
          WHERE (
            (${input.scope}::text = 'durable' AND scope = 'durable'
              AND profile_id = ${input.profileId}
              AND privacy_generation = ${input.privacyGeneration})
            OR (${input.scope}::text = 'session' AND scope = 'session'
              AND session_digest = ${input.sessionDigest})
          )
        `,
        )
        const generation = next[0]?.generation ?? 1
        const generationId = randomUUID()
        const generationExpiresAt =
          input.scope === "durable"
            ? earliestDate([
                profileExpiresAt!,
                daysAfter(input.now, DURABLE_PROFILE_PROJECTION_DAYS),
                ...input.durableEvidence.map((row) => row.sourceExpiresAt),
              ])
            : hoursAfter(input.now, SESSION_PROFILE_PROJECTION_HOURS)
        const sessionExpiresAt = earliest(
          generationExpiresAt,
          hoursAfter(input.now, SESSION_PROFILE_PROJECTION_HOURS),
        )
        const stability = average(
          input.projection.durableInterests.map(
            (interest) => interest.stability,
          ),
        )
        const coverage = Math.min(
          1,
          input.projection.contributionCount /
            Math.max(
              1,
              input.durableEvidence.length + input.sessionEvidence.length,
            ),
        )
        await tx.$executeRaw(Prisma.sql`
        INSERT INTO recommendation_profile_projection_generation (
          id, manifest_id, scope, profile_id, privacy_generation,
          session_digest, generation, state, projection_version,
          clustering_version, eligibility_policy_version,
          outcome_classifier_version, input_window_start, input_window_end,
          input_watermark, input_digest, contribution_count,
          durable_interest_count, session_intent_present,
          explicit_preference_count, negative_evidence_count, coverage,
          stability, cohort_quality, retention_days, expires_at
        ) VALUES (
          ${generationId}, ${MULTI_INTEREST_PROFILE_MANIFEST_ID},
          ${input.scope}::"RecommendationProfileProjectionScope",
          ${input.scope === "durable" ? input.profileId : null},
          ${input.scope === "durable" ? input.privacyGeneration : null},
          ${input.scope === "session" ? input.sessionDigest : null},
          ${generation}, 'building', ${PROFILE_PROJECTION_VERSION},
          ${PROFILE_CLUSTERING_VERSION},
          ${PROFILE_PROJECTION_ELIGIBILITY_VERSION},
          ${PROFILE_PROJECTION_OUTCOME_VERSION},
          ${daysBefore(input.now, DURABLE_PROFILE_PROJECTION_DAYS)},
          ${input.now}, ${watermark}, ${input.inputDigest},
          ${input.projection.contributionCount},
          ${input.projection.durableInterests.length},
          ${input.projection.sessionIntent != null},
          ${input.projection.explicitPreferences.length},
          ${input.projection.negativeEvidence.length},
          ${coverage}, ${stability}, ${input.projection.cohortQuality},
          ${input.scope === "durable" ? 180 : 1}, ${generationExpiresAt}
        )
      `)
        for (const interest of input.projection.durableInterests) {
          await insertInterest(tx, {
            generationId,
            kind: "durable",
            ordinal: interest.ordinal,
            medoidMediaId: interest.medoidMediaId,
            medoidSourceId: interest.medoidSourceId,
            vector: interest.vector,
            weight: interest.weight,
            supportCount: interest.supportCount,
            stability: interest.stability,
            expiresAt: generationExpiresAt,
          })
        }
        if (input.projection.sessionIntent) {
          const interest = input.projection.sessionIntent
          await insertInterest(tx, {
            generationId,
            kind: "session",
            ordinal: 0,
            medoidMediaId: interest.medoidMediaId,
            medoidSourceId: interest.medoidSourceId,
            vector: interest.vector,
            weight: interest.weight,
            supportCount: interest.supportCount,
            stability: interest.stability,
            expiresAt: sessionExpiresAt,
          })
        }
        const interestBySource = new Map(
          input.projection.durableInterests.flatMap((interest) =>
            interest.sourceIds.map(
              (sourceId) => [sourceId, interest.ordinal] as const,
            ),
          ),
        )
        const contributions: ContributionInput[] = input.durableEvidence.map(
          (row) => ({
            generationId,
            kind: "qualified_outcome" as const,
            row,
            sourceIdDigest: stableSourceDigest(row),
            interestOrdinal:
              interestBySource.get(stableSourceDigest(row)) ?? null,
            privacyGeneration: input.privacyGeneration,
            expiresAt: earliest(generationExpiresAt, row.sourceExpiresAt),
          }),
        )
        contributions.push(
          ...input.sessionEvidence.map((row) => ({
            generationId,
            kind: "session_selection" as const,
            row,
            sourceIdDigest: stableSourceDigest(row),
            interestOrdinal: null,
            privacyGeneration: null,
            expiresAt: earliest(sessionExpiresAt, row.sourceExpiresAt),
          })),
        )
        await insertContributions(tx, contributions)
        await tx.$executeRaw(Prisma.sql`
        UPDATE recommendation_profile_projection_generation
        SET state = 'published', published_at = ${input.now}
        WHERE id = ${generationId} AND state = 'building'
      `)
        await tx.$executeRaw(Prisma.sql`
        INSERT INTO recommendation_profile_projection_pointer (
          scope_digest, scope, profile_id, privacy_generation, session_digest,
          generation_id, pointer_generation, updated_at
        ) VALUES (
          ${scopeDigest}, ${input.scope}::"RecommendationProfileProjectionScope",
          ${input.scope === "durable" ? input.profileId : null},
          ${input.scope === "durable" ? input.privacyGeneration : null},
          ${input.scope === "session" ? input.sessionDigest : null},
          ${generationId}, ${generation}, ${input.now}
        )
        ON CONFLICT (scope_digest) DO UPDATE SET
          generation_id = EXCLUDED.generation_id,
          pointer_generation = EXCLUDED.pointer_generation,
          updated_at = EXCLUDED.updated_at
      `)
        return {
          status: "published" as const,
          generationId,
          generation,
          replay: false,
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  )
}

async function insertInterest(
  tx: Prisma.TransactionClient,
  input: {
    generationId: string
    kind: "durable" | "session"
    ordinal: number
    medoidMediaId: string
    medoidSourceId: string
    vector: readonly number[]
    weight: number
    supportCount: number
    stability: number
    expiresAt: Date
  },
): Promise<void> {
  if (input.vector.length !== 1_536) {
    throw new RecommendationInternalStateError(
      "profile_projection_embedding_dimension_invalid",
    )
  }
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO recommendation_profile_interest (
      id, generation_id, kind, interest_ordinal, medoid_media_id,
      medoid_source_digest, embedding, weight, support_count, stability,
      expires_at
    ) VALUES (
      ${randomUUID()}, ${input.generationId},
      ${input.kind}::"RecommendationProfileInterestKind", ${input.ordinal},
      ${input.medoidMediaId.slice(0, 191)}, ${digestText(input.medoidSourceId)},
      ${toPgVector(input.vector)}::public.vector(1536), ${input.weight},
      ${input.supportCount}, ${input.stability}, ${input.expiresAt}
    )
  `)
}

type ContributionInput = Readonly<{
  generationId: string
  kind: "qualified_outcome" | "session_selection"
  row: ProfileProjectionEvidence
  sourceIdDigest: string
  interestOrdinal: number | null
  privacyGeneration: number | null
  expiresAt: Date
}>

async function insertContributions(
  tx: Prisma.TransactionClient,
  inputs: readonly ContributionInput[],
): Promise<void> {
  if (inputs.length === 0) return
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO recommendation_profile_projection_contribution (
      id, generation_id, kind, source_id_digest, source_outcome_id,
      source_selection_id, target_media_id, interest_ordinal, weight,
      eligibility_policy_version, outcome_classifier_version,
      privacy_generation, occurred_at, expires_at
    ) VALUES ${Prisma.join(
      inputs.map(
        (input) => Prisma.sql`(
          ${randomUUID()}, ${input.generationId},
          ${input.kind}::"RecommendationProfileContributionKind",
          ${input.sourceIdDigest},
          ${input.kind === "qualified_outcome" ? input.row.sourceId : null},
          ${input.kind === "session_selection" ? input.row.sourceId : null},
          ${input.row.targetMediaId.slice(0, 191)}, ${input.interestOrdinal},
          ${Math.max(-1, Math.min(1, input.row.weight))},
          ${input.row.eligibilityPolicyVersion},
          ${input.row.outcomeClassifierVersion}, ${input.privacyGeneration},
          ${input.row.occurredAt}, ${input.expiresAt}
        )`,
      ),
    )}
  `)
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
  }
}

function stableSourceDigest(row: ProfileProjectionEvidence): string {
  return digestText(row.sourceId)
}

function parsePgVector(value: string): number[] {
  if (!value.startsWith("[") || !value.endsWith("]")) return []
  return value.slice(1, -1).split(",").map(Number).filter(Number.isFinite)
}

function toPgVector(value: readonly number[]): string {
  return `[${value.map((entry) => (Number.isFinite(entry) ? entry : 0)).join(",")}]`
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

function hoursAfter(value: Date, hours: number): Date {
  return new Date(value.getTime() + hours * 3_600_000)
}

function daysAfter(value: Date, days: number): Date {
  return hoursAfter(value, days * 24)
}

function daysBefore(value: Date, days: number): Date {
  return new Date(value.getTime() - days * 86_400_000)
}

function earliest(left: Date, right: Date): Date {
  return left <= right ? left : right
}

function earliestDate(values: readonly Date[]): Date {
  return new Date(Math.min(...values.map((value) => value.getTime())))
}

function latestDate(values: readonly Date[]): Date | null {
  return values.length === 0
    ? null
    : new Date(Math.max(...values.map((value) => value.getTime())))
}

function publishedProjectionIsNewer(
  current: { inputWatermark: Date | null; contributionCount: number },
  candidateWatermark: Date | null,
  candidateContributionCount: number,
): boolean {
  if (current.inputWatermark == null) return false
  if (candidateWatermark == null) return true
  const watermarkDifference =
    current.inputWatermark.getTime() - candidateWatermark.getTime()
  return (
    watermarkDifference > 0 ||
    (watermarkDifference === 0 &&
      current.contributionCount > candidateContributionCount)
  )
}

function average(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length
}
