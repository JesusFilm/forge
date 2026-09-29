import { ownerReleaseInfluenceAllowedSql } from "../promotion/owner-influence"
import { createHash, randomUUID } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"
import {
  RecommendationConflictError,
  RecommendationInputError,
} from "../errors"
import {
  RECOMMENDATION_INTEGRITY_POLICY_VERSION,
  RECOMMENDATION_REPLAY_QUARANTINE_THRESHOLD,
} from "../integrity-policy"
import {
  buildCowatchGraph,
  COWATCH_FEATURE_VERSION,
  COWATCH_DURABLE_LINEAGE_VERSION,
  COWATCH_LEGACY_LINEAGE_VERSION,
  COWATCH_PROJECTION_VERSION,
  CowatchWorkOverflowError,
  type CowatchOutcome,
} from "./graph"
import {
  assertCowatchSourceWindow,
  COWATCH_LEGACY_SOURCE_WINDOW_VERSION,
  COWATCH_SOURCE_WINDOW_VERSION,
  type CowatchSourceWindow,
} from "./source-window"

const MAX_SOURCE_ROWS = 50_000
const SOURCE_WINDOW_DAYS = 180
const GENERATION_RETENTION_DAYS = 29
const CLASSIFIER_VERSION = "active-watch-proxy-v1"
export const COWATCH_PUBLICATION_LOCK_ID = 387_000_001

const admissionCount = (maximum: number) =>
  z.number().int().nonnegative().max(maximum)
const admissionWidth = z
  .object({
    maximum: admissionCount(Number.MAX_SAFE_INTEGER),
    total: admissionCount(Number.MAX_SAFE_INTEGER),
  })
  .strict()
  .refine((value) => value.maximum <= value.total)
const admissionTimestamp = z.iso
  .datetime()
  .refine((value) => new Date(value).toISOString() === value)
const publicationAdmissionSchema = z
  .object({
    version: z.literal("cowatch-publication-admission-v1"),
    expectedGeneration: z.string().regex(/^[a-f0-9]{64}$/),
    sourceWindow: z
      .object({
        version: z.literal(COWATCH_SOURCE_WINDOW_VERSION),
        windowStart: admissionTimestamp,
        windowEnd: admissionTimestamp,
        evaluationAsOf: admissionTimestamp,
      })
      .strict(),
    limits: z
      .object({
        rawSourceCount: admissionCount(MAX_SOURCE_ROWS),
        sourceCount: admissionCount(MAX_SOURCE_ROWS),
        attemptedPairCount: admissionCount(250_000),
        contributionCount: admissionCount(250_000),
        edgeCount: admissionCount(250_000),
        publicationRowCount: admissionCount(550_001).min(1),
        graphRowJsonBytes: z
          .object({
            sources: admissionWidth,
            contributions: admissionWidth,
            edges: admissionWidth,
          })
          .strict(),
      })
      .strict(),
  })
  .strict()

/** A reviewed capacity ceiling, not permission to publish or a database byte estimate. */
export type CowatchPublicationAdmission = z.infer<
  typeof publicationAdmissionSchema
>

/** Validate before opening a database connection; never include file contents in errors. */
export function parseCowatchPublicationAdmission(
  input: unknown,
  now: Date,
  sourceWindow?: CowatchSourceWindow,
): CowatchPublicationAdmission {
  const parsed = publicationAdmissionSchema.safeParse(input)
  if (!parsed.success || !sourceWindow)
    throw new RecommendationInputError("Invalid co-watch publication admission")
  assertCowatchSourceWindow(sourceWindow, now)
  const expected = parsed.data.sourceWindow
  if (
    expected.version !== sourceWindow.version ||
    expected.windowStart !== sourceWindow.windowStart.toISOString() ||
    expected.windowEnd !== sourceWindow.windowEnd.toISOString() ||
    expected.evaluationAsOf !== sourceWindow.evaluationAsOf.toISOString()
  )
    throw new RecommendationInputError(
      "Co-watch publication admission source scope differs",
    )
  return parsed.data
}

type SourceRow = Readonly<{
  outcomeId: string
  episodeId: string
  revision: number
  mediaId: string
  sessionDigest: string
  profileId: string | null
  privacyGeneration: number | null
  occurredAt: Date
  qualityWeight: number | null
  qualified: boolean
  finalized: boolean
  integrityEligible: boolean
  eligibilityDecisionId: string | null
  eligibilityRevision: number | null
  eligibilityPolicyVersion: string | null
  expiresAt: Date
}>

/**
 * Bounded snapshot from canonical finalized outcomes. The latest classifier
 * revision is selected before eligibility, so a correction replaces rather
 * than adds to an older contribution. Suppressed outcomes never reappear after
 * a profile deletion. Aggregate scope keeps sparse anonymous identities out.
 */
export async function loadCowatchSourceRows(
  db: Pick<PrismaClient, "$queryRaw">,
  now: Date,
  sourceWindow?: CowatchSourceWindow,
): Promise<SourceRow[]> {
  if (sourceWindow) assertCowatchSourceWindow(sourceWindow, now)
  return db.$queryRaw<SourceRow[]>(Prisma.sql`
    WITH latest AS MATERIALIZED (
      SELECT DISTINCT ON (episode.id)
        outcome.id AS "outcomeId",
        episode.id AS "episodeId",
        outcome.revision,
        episode.media_id AS "mediaId",
        episode.session_digest AS "sessionDigest",
        COALESCE(episode.claimed_at, episode.created_at) AS "occurredAt",
        outcome.view_quality_weight AS "qualityWeight",
        outcome.fact_watermark AS "factWatermark",
        episode.next_fact_sequence AS "nextFactSequence",
        episode.conflict_count AS "conflictCount",
        episode.replay_count AS "replayCount",
        outcome.request_id AS "requestId",
        outcome.qualified_view AS qualified,
        (episode.state = 'finalized' AND episode.finalized_at IS NOT NULL) AS finalized,
        outcome.expires_at AS "expiresAt",
        episode.expires_at AS "episodeExpiresAt"
      FROM recommendation_outcome_revision outcome
      JOIN recommendation_playback_episode episode ON episode.id = outcome.episode_id
      WHERE outcome.classifier_version = ${CLASSIFIER_VERSION}
        AND ${
          sourceWindow
            ? Prisma.sql`COALESCE(episode.claimed_at, episode.created_at) >= ${sourceWindow.windowStart}
            AND COALESCE(episode.claimed_at, episode.created_at) < ${sourceWindow.windowEnd}`
            : Prisma.sql`outcome.created_at >= ${new Date(now.getTime() - SOURCE_WINDOW_DAYS * 86_400_000)}`
        }
        AND outcome.created_at <= ${sourceWindow?.evaluationAsOf ?? now}
      ORDER BY episode.id, outcome.revision DESC, outcome.id DESC
    )
    SELECT latest.*,
      profile.id AS "profileId",
      profile.privacy_generation AS "privacyGeneration",
      decision.id AS "eligibilityDecisionId",
      decision.revision AS "eligibilityRevision",
      decision.policy_version AS "eligibilityPolicyVersion",
      (
        decision.id IS NOT NULL
        AND suppression.episode_id IS NULL
        AND (${sourceWindow == null} OR (
          ownership.invalid IS NOT TRUE
          AND (profile.id IS NOT NULL OR ownership.known = false)
        ))
        AND latest."factWatermark" = latest."nextFactSequence" - 1
        AND latest."episodeExpiresAt" > ${now}
        AND latest."conflictCount" = 0
        AND latest."replayCount" < ${RECOMMENDATION_REPLAY_QUARANTINE_THRESHOLD}
        AND NOT EXISTS (SELECT 1 FROM recommendation_playback_fact fact
          WHERE fact.episode_id = latest."episodeId" AND fact.late = true)
        AND NOT EXISTS (SELECT 1 FROM recommendation_outcome_revision newer
          WHERE newer.supersedes_id = latest."outcomeId"
            OR (newer.episode_id = latest."episodeId" AND newer.classifier_version = ${CLASSIFIER_VERSION} AND newer.revision > latest.revision))
        AND NOT EXISTS (SELECT 1 FROM recommendation_promotion_slate_fence fence
          WHERE fence.request_id = latest."requestId")
        AND ${ownerReleaseInfluenceAllowedSql(Prisma.sql`latest."requestId"`)}
      ) AS "integrityEligible"
    FROM latest
    LEFT JOIN LATERAL (
      SELECT identity.id, identity.privacy_generation
      FROM (
      SELECT linked_profile.id, linked_profile.privacy_generation, 0 AS priority, link.linked_at AS identified_at, link.id AS identity_id
      FROM recommendation_profile_session_link link
      JOIN recommendation_profile linked_profile
        ON linked_profile.id = link.profile_id
        AND linked_profile.privacy_generation = link.privacy_generation
        AND linked_profile.state = 'active'
        AND linked_profile.expires_at > ${now}
      WHERE link.session_digest = latest."sessionDigest"
        AND link.expires_at > ${now}
      UNION ALL
      SELECT retained.profile_id, retained.privacy_generation,
        CASE WHEN retained.episode_id = latest."episodeId" THEN 1 ELSE 2 END AS priority,
        retained.occurred_at AS identified_at, retained.id AS identity_id
      FROM (${retainedCowatchOwnersSql()}) retained
      WHERE ${sourceWindow != null}
        AND retained.lineage_version = ${COWATCH_DURABLE_LINEAGE_VERSION}
        AND retained.generation_expires_at > ${now} AND retained.source_expires_at > ${now}
        AND retained.state = 'active' AND retained.profile_expires_at > ${now}
        AND retained.privacy_generation = retained.captured_generation
      ) identity
      ORDER BY identity.priority, identity.identified_at DESC, identity.identity_id DESC
      LIMIT 1
    ) profile ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) > 0 AS known,
        BOOL_OR(retained.state IS DISTINCT FROM 'active' OR retained.profile_expires_at <= ${now}
          OR (retained.lineage_version = ${COWATCH_DURABLE_LINEAGE_VERSION}
            AND retained.captured_generation IS DISTINCT FROM retained.privacy_generation)) AS invalid
      FROM (${retainedCowatchOwnersSql()}) retained
      WHERE ${sourceWindow != null}
    ) ownership ON true
    LEFT JOIN LATERAL (
      SELECT eligible.id, eligible.revision, eligible.policy_version
      FROM recommendation_eligibility_decision eligible
      WHERE eligible.outcome_id = latest."outcomeId"
        AND eligible.policy_version = ${RECOMMENDATION_INTEGRITY_POLICY_VERSION}
        AND eligible.is_current = true
        AND eligible.state = 'eligible'
        AND 'aggregate' = ANY(eligible.eligible_scopes)
        AND eligible.expires_at > ${now}
        AND eligible.source_type = 'playback_outcome'
      ORDER BY eligible.revision DESC
      LIMIT 1
    ) decision ON true
    LEFT JOIN recommendation_cowatch_suppression suppression
      ON suppression.episode_id = latest."episodeId"
    ORDER BY latest."occurredAt", latest."episodeId"
    LIMIT ${MAX_SOURCE_ROWS + 1}
  `)
}

/** Two indexed reverse lookups retain ownership across revisions and an
 * existing episode becoming eligible later in the same private session.
 * UNION ALL duplicates are harmless; recovery prefers the exact episode.
 * Invalid/expired known ownership may never fall through to anonymous.
 */
function retainedCowatchOwnersSql(): Prisma.Sql {
  return Prisma.sql`
    SELECT source.id, source.viewer_profile_id AS profile_id,
      source.viewer_privacy_generation AS captured_generation, source.occurred_at,
      source.expires_at AS source_expires_at, generation.lineage_version,
      generation.expires_at AS generation_expires_at, outcome.episode_id,
      profile.privacy_generation, profile.state, profile.expires_at AS profile_expires_at
    FROM recommendation_cowatch_source_contribution source
    JOIN recommendation_outcome_revision outcome ON outcome.id = source.outcome_id
    JOIN recommendation_cowatch_generation generation ON generation.id = source.generation_id
    LEFT JOIN recommendation_profile profile ON profile.id = source.viewer_profile_id
    WHERE source.session_digest = latest."sessionDigest" AND source.viewer_profile_id IS NOT NULL
    UNION ALL
    SELECT source.id, source.viewer_profile_id AS profile_id,
      source.viewer_privacy_generation AS captured_generation, source.occurred_at,
      source.expires_at AS source_expires_at, generation.lineage_version,
      generation.expires_at AS generation_expires_at, outcome.episode_id,
      profile.privacy_generation, profile.state, profile.expires_at AS profile_expires_at
    FROM recommendation_outcome_revision outcome
    JOIN recommendation_cowatch_source_contribution source ON source.outcome_id = outcome.id
    JOIN recommendation_cowatch_generation generation ON generation.id = source.generation_id
    LEFT JOIN recommendation_profile profile ON profile.id = source.viewer_profile_id
    WHERE outcome.episode_id = latest."episodeId" AND source.viewer_profile_id IS NOT NULL
  `
}

export type CowatchPublication = Readonly<{
  status:
    | "published"
    | "unchanged"
    | "source_overflow"
    | "work_overflow"
    | "admission_refused"
  generation: string | null
  rawSourceCount: number
  /** Raw overflow observes only a lower bound, never the complete population. */
  rawSourceCountIsLowerBound: boolean
  sourceCount: number | null
  attemptedPairCount: number | null
  contributionCount: number | null
  edgeCount: number | null
  publicationRowCount: number | null
  publishedAt: Date | null
  sourceWindow: ReturnType<typeof describeSourceWindow>
  terminalDecision: "no_promotion"
  decisionReason: string
}>

type Prepared = Awaited<ReturnType<typeof prepareCowatchGeneration>>

/**
 * Same selection and work bounds as publication, in a read-only snapshot.
 * Preflights can overlap a publisher; they hold no publication lock and write
 * no graph rows. Operators must budget their read/heap/temp work separately.
 */
export async function preflightCowatchShadowGeneration(
  prisma: PrismaClient,
  now: Date,
  sourceWindow: CowatchSourceWindow,
) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`
      await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`
      await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`
      const prepared = await prepareCowatchGeneration(tx, now, sourceWindow)
      return {
        ...populationReceipt(prepared, now, sourceWindow),
        status: prepared.status,
        supportedEdgeCount:
          prepared.status === "ready"
            ? prepared.graph.edges.filter((edge) => edge.eligible).length
            : null,
        // Aggregate input widths only, not an estimate of PostgreSQL heap,
        // indexes, WAL or temp. Serialize one bounded row at a time.
        graphRowJsonBytes:
          prepared.status === "ready"
            ? graphRowJsonWidths(prepared.graph)
            : null,
      }
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 30_000,
    },
  )
}

function rowJsonWidths(rows: readonly unknown[]) {
  let total = 0
  let maximum = 0
  for (const row of rows) {
    const bytes = Buffer.byteLength(JSON.stringify(row), "utf8")
    total += bytes
    maximum = Math.max(maximum, bytes)
  }
  return { total, maximum }
}

function graphRowJsonWidths(graph: ReturnType<typeof buildCowatchGraph>) {
  return {
    sources: rowJsonWidths(graph.sources),
    contributions: rowJsonWidths(graph.contributions),
    edges: rowJsonWidths(graph.edges),
  }
}

function publicationAdmissionRefusal(
  prepared: Prepared,
  admission: CowatchPublicationAdmission,
): string | null {
  if (prepared.status !== "ready")
    return "publication_admission_population_unavailable"
  if (prepared.graph.generation !== admission.expectedGeneration)
    return "publication_admission_generation_changed"
  const { graph } = prepared
  const actual = {
    rawSourceCount: prepared.rawSourceCount,
    sourceCount: graph.sources.length,
    attemptedPairCount: graph.attemptedPairCount,
    contributionCount: graph.contributions.length,
    edgeCount: graph.edges.length,
    publicationRowCount:
      1 +
      graph.sources.length +
      graph.contributions.length +
      graph.edges.length,
  }
  for (const key of Object.keys(actual) as Array<keyof typeof actual>)
    if (actual[key] > admission.limits[key])
      return "publication_admission_count_exceeded"
  const widths = graphRowJsonWidths(graph)
  for (const key of ["sources", "contributions", "edges"] as const) {
    const limit = admission.limits.graphRowJsonBytes[key]
    if (widths[key].maximum > limit.maximum || widths[key].total > limit.total)
      return "publication_admission_width_exceeded"
  }
  return null
}

/** Atomically publishes only a complete immutable generation, always shadow. */
export async function publishCowatchShadowGeneration(
  prisma: PrismaClient,
  now: Date = new Date(),
  sourceWindow?: CowatchSourceWindow,
  admission?: CowatchPublicationAdmission,
): Promise<CowatchPublication> {
  const validatedAdmission =
    admission === undefined
      ? undefined
      : parseCowatchPublicationAdmission(admission, now, sourceWindow)
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = '5000ms'`)
      await tx.$executeRaw(Prisma.sql`SET LOCAL lock_timeout = '1000ms'`)
      // One publisher across all scopes bounds concurrent write amplification.
      // Refuse before source work rather than queueing behind another rebuild.
      const [lock] = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(${COWATCH_PUBLICATION_LOCK_ID}::bigint) AS locked
      `
      if (!lock?.locked) {
        throw new RecommendationConflictError(
          "A co-watch publication is already running; retry the same source scope after it completes",
        )
      }
      const prepared = await prepareCowatchGeneration(tx, now, sourceWindow)
      const receipt = populationReceipt(prepared, now, sourceWindow)
      // Same repeatable-read snapshot and global publication lock as the writes.
      // A separate preflight cannot freeze current eligibility or privacy state.
      if (validatedAdmission) {
        const refusal = publicationAdmissionRefusal(
          prepared,
          validatedAdmission,
        )
        if (refusal)
          return {
            ...receipt,
            status: "admission_refused",
            decisionReason: refusal,
          }
      }
      if (prepared.status !== "ready")
        return { ...receipt, status: prepared.status }
      const { source, graph } = prepared
      const profileByOutcome = new Map(
        source.map((row) => [row.outcomeId, row]),
      )
      const safeEdges = graph.edges.filter((edge) => edge.eligible)
      const decisionReason =
        graph.qualifiedOutcomes === 0
          ? "no_eligible_finalized_outcomes"
          : safeEdges.length === 0
            ? "insufficient_supported_edges"
            : "controlled_evaluation_required_feat_505"
      const existing = await tx.recommendationCowatchGeneration.findUnique({
        where: { id: graph.generation },
        select: { id: true, publishedAt: true },
      })
      if (existing) {
        return {
          ...receipt,
          status: "unchanged",
          publishedAt: existing.publishedAt,
          decisionReason,
        }
      }
      const publishedAt = new Date()
      const expiresAt = new Date(
        publishedAt.getTime() + GENERATION_RETENTION_DAYS * 86_400_000,
      )
      await tx.recommendationCowatchGeneration.create({
        data: {
          id: graph.generation,
          projectionVersion: COWATCH_PROJECTION_VERSION,
          lineageVersion: sourceWindow
            ? COWATCH_DURABLE_LINEAGE_VERSION
            : COWATCH_LEGACY_LINEAGE_VERSION,
          featureVersion: COWATCH_FEATURE_VERSION,
          sourceCount: graph.qualifiedOutcomes,
          contributionCount: graph.contributions.length,
          edgeCount: graph.edges.length,
          distinctViewerCount: graph.uniqueViewers,
          windowEnd: sourceWindow?.windowEnd ?? now,
          windowStart: sourceWindow?.windowStart ?? null,
          evaluationAsOf: sourceWindow?.evaluationAsOf ?? null,
          sourceWindowVersion:
            sourceWindow?.version ?? COWATCH_LEGACY_SOURCE_WINDOW_VERSION,
          rawSourceCount: source.length,
          attemptedPairCount: graph.attemptedPairCount,
          terminalDecision: "no_promotion",
          decisionReason,
          publishedAt,
          expiresAt,
        },
      })
      for (let offset = 0; offset < graph.sources.length; offset += 500) {
        await tx.recommendationCowatchSourceContribution.createMany({
          data: graph.sources.slice(offset, offset + 500).map((row) => ({
            id: randomUUID(),
            generationId: graph.generation,
            outcomeId: row.outcomeId,
            eligibilityDecisionId: row.eligibilityDecisionId!,
            eligibilityRevision: row.eligibilityRevision!,
            eligibilityPolicyVersion: row.eligibilityPolicyVersion!,
            viewerProfileId:
              profileByOutcome.get(row.outcomeId)?.profileId ?? null,
            viewerPrivacyGeneration: sourceWindow
              ? (profileByOutcome.get(row.outcomeId)?.privacyGeneration ?? null)
              : null,
            mediaId: row.mediaId,
            sessionDigest: row.sessionDigest,
            viewerKeyDigest: createHash("sha256")
              .update(row.viewerKey)
              .digest("hex"),
            qualityWeight: row.qualityWeight,
            occurredAt: row.occurredAt,
            expiresAt: row.expiresAt < expiresAt ? row.expiresAt : expiresAt,
          })),
        })
      }
      for (let offset = 0; offset < graph.contributions.length; offset += 500) {
        await tx.recommendationCowatchContribution.createMany({
          data: graph.contributions.slice(offset, offset + 500).map((row) => ({
            id: randomUUID(),
            generationId: graph.generation,
            sourceOutcomeId: row.sourceOutcomeId,
            targetOutcomeId: row.targetOutcomeId,
            viewerProfileId:
              profileByOutcome.get(row.sourceOutcomeId)?.profileId ?? null,
            sourceMediaId: row.sourceMediaId,
            targetMediaId: row.targetMediaId,
            sessionDigest: row.sessionDigest,
            viewerKeyDigest: createHash("sha256")
              .update(row.viewerKey)
              .digest("hex"),
            gapMs: row.gapMs,
            qualityWeight: row.qualityWeight,
            recencyWeight: row.recencyWeight,
            effectiveWeight: row.effectiveWeight,
            expiresAt,
          })),
        })
      }
      for (let offset = 0; offset < graph.edges.length; offset += 500) {
        await tx.recommendationCowatchEdge.createMany({
          data: graph.edges.slice(offset, offset + 500).map((edge) => ({
            id: randomUUID(),
            generationId: graph.generation,
            sourceMediaId: edge.sourceMediaId,
            targetMediaId: edge.targetMediaId,
            sessionSupport: edge.sessionSupport,
            distinctViewerSupport: edge.distinctViewerSupport,
            confidence: edge.confidence,
            popularityCorrectedLift: edge.popularityCorrectedLift,
            recencyWeight: edge.recencyWeight,
            qualityWeight: edge.qualityWeight,
            effectiveWeight: edge.effectiveWeight,
            contamination: edge.contamination,
            eligible: edge.eligible,
          })),
        })
      }
      return {
        ...receipt,
        status: "published",
        publishedAt,
        decisionReason,
      }
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 30_000,
    },
  )
}

function describeSourceWindow(now: Date, scope?: CowatchSourceWindow) {
  return (
    scope ?? {
      version: COWATCH_LEGACY_SOURCE_WINDOW_VERSION,
      windowStart: new Date(now.getTime() - SOURCE_WINDOW_DAYS * 86_400_000),
      windowEnd: now,
      evaluationAsOf: now,
    }
  )
}

async function prepareCowatchGeneration(
  tx: Pick<PrismaClient, "$queryRaw">,
  now: Date,
  sourceWindow?: CowatchSourceWindow,
) {
  const source = await loadCowatchSourceRows(tx, now, sourceWindow)
  if (source.length > MAX_SOURCE_ROWS) {
    return {
      status: "source_overflow" as const,
      rawSourceCount: source.length,
      sourceCount: null,
      attemptedPairCount: null,
    }
  }
  const rows: CowatchOutcome[] = source.map((row) => ({
    ...row,
    viewerKey:
      row.profileId == null
        ? `session:${row.sessionDigest}`
        : sourceWindow
          ? `profile:${row.profileId}:${row.privacyGeneration}`
          : `profile:${row.profileId}`,
    qualityWeight: row.qualityWeight ?? 0,
  }))
  try {
    const graph = buildCowatchGraph(
      rows,
      now,
      sourceWindow,
      sourceWindow
        ? COWATCH_DURABLE_LINEAGE_VERSION
        : COWATCH_LEGACY_LINEAGE_VERSION,
    )
    return {
      status: "ready" as const,
      rawSourceCount: source.length,
      sourceCount: graph.qualifiedOutcomes,
      attemptedPairCount: graph.attemptedPairCount,
      source,
      graph,
    }
  } catch (error) {
    if (!(error instanceof CowatchWorkOverflowError)) throw error
    return {
      status: "work_overflow" as const,
      rawSourceCount: source.length,
      sourceCount: error.eligibleSourceCount,
      attemptedPairCount: error.attemptedPairCount,
    }
  }
}

function populationReceipt(
  prepared: Prepared,
  now: Date,
  sourceWindow?: CowatchSourceWindow,
): Omit<CowatchPublication, "status"> {
  return {
    generation: prepared.status === "ready" ? prepared.graph.generation : null,
    rawSourceCount: prepared.rawSourceCount,
    rawSourceCountIsLowerBound: prepared.status === "source_overflow",
    sourceCount: prepared.sourceCount,
    attemptedPairCount: prepared.attemptedPairCount,
    contributionCount:
      prepared.status === "ready" ? prepared.graph.contributions.length : null,
    edgeCount: prepared.status === "ready" ? prepared.graph.edges.length : null,
    publicationRowCount:
      prepared.status === "ready"
        ? 1 +
          prepared.graph.sources.length +
          prepared.graph.contributions.length +
          prepared.graph.edges.length
        : null,
    sourceWindow: describeSourceWindow(now, sourceWindow),
    publishedAt: null,
    terminalDecision: "no_promotion",
    decisionReason:
      prepared.status === "source_overflow"
        ? "source_window_exceeds_bounded_projection"
        : prepared.status === "work_overflow"
          ? "projection_work_exceeds_bound"
          : "complete_bounded_population_preflight",
  }
}
