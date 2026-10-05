import { Prisma, type PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { hasPermission } from "@/auth/permissions"
import { ForbiddenError } from "@/services/errors"

const RAW_VISIT_MS = 29 * 86_400_000
const RECENT_CARD_LIMIT = 25

class PrivateClickReadError extends Error {}

type Arm = "control" | "challenger"

export type PrivateClickArm = {
  eligibleVisits: number
  clickedVisits: number
  acceptedSelections: number
  renderedCards: number
  qualifiedImpressions: number
  matchedSelections: number
  unmatchedSelections: number
  playbackClaims: number
  unlinkedDeliveredVisits: number
  cardCtr: number | null
}

export type PrivateClickCard = {
  visitId: string
  assignedArm: Arm
  generationId: string
  requestId: string
  itemId: string
  position: number
  targetMediaId: string
  actualStrategy: string
  privateFallback: boolean
  fallbackReason: string | null
  rendered: boolean
  qualifiedImpression: boolean
  playbackClaimed: boolean
  receivedAt: Date
  late: boolean
}

export type PrivatePrecomputedClickDiagnostics =
  | { status: "unavailable"; reason: string }
  | {
      status: "observed_private_only" | "incomplete_raw_window"
      experimentId: string
      generationId: string
      measurementQualification: "unverified_edge_bot_signal"
      measurementLoss: "unobservable"
      byArm: Record<Arm, PrivateClickArm>
      recentCards: PrivateClickCard[] | null
    }

type CountRow = {
  arm: string
  eligible_visits: bigint
  clicked_visits: bigint
  accepted_selections: bigint
  rendered_cards: bigint
  qualified_impressions: bigint
  matched_selections: bigint
  unmatched_selections: bigint
  playback_claims: bigint
  unlinked_delivered_visits: bigint
}

type CardRow = {
  visit_id: string
  arm: string
  request_id: string
  item_id: string
  position: number
  target_media_id: string
  strategy_version: string
  private_fallback: boolean
  fallback_reason: string | null
  rendered: boolean
  qualified_impression: boolean
  playback_claimed: boolean
  received_at: Date
}

function blankArm(): PrivateClickArm {
  return {
    eligibleVisits: 0,
    clickedVisits: 0,
    acceptedSelections: 0,
    renderedCards: 0,
    qualifiedImpressions: 0,
    matchedSelections: 0,
    unmatchedSelections: 0,
    playbackClaims: 0,
    unlinkedDeliveredVisits: 0,
    cardCtr: null,
  }
}

function count(value: bigint): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number))
    throw new PrivateClickReadError("count_overflow")
  return number
}

/** Read only, bounded to retained server-issued visits and their evidence. */
export async function loadPrivatePrecomputedClickDiagnostics(
  prisma: PrismaClient,
  input: { experimentId: string; reviewer: Principal | null; now?: Date },
): Promise<PrivatePrecomputedClickDiagnostics> {
  if (!hasPermission(input.reviewer, "read:recommendation-aggregates"))
    throw new ForbiddenError()
  const now = input.now ?? new Date()
  try {
    const experiment =
      await prisma.recommendationPrecomputedExperiment.findUnique({
        where: { id: input.experimentId },
        select: { id: true, generationId: true, startsAt: true, endsAt: true },
      })
    if (!experiment)
      return { status: "unavailable", reason: "experiment_not_found" }
    const rows = await prisma.$queryRaw<CountRow[]>(Prisma.sql`
      WITH evidence AS (
        SELECT v.id AS visit_id, v.arm, v.delivery_result, link.request_id,
          item.id AS item_id, rendered.id AS rendered_id,
          impression.id AS impression_id, selection.id AS selection_id,
          episode.id AS claimed_episode_id
        FROM recommendation_precomputed_visit v
        LEFT JOIN recommendation_precomputed_visit_request link
          ON link.visit_id = v.id AND link.expires_at > ${now}
        LEFT JOIN recommendation_served_item item
          ON item.request_id = link.request_id
        LEFT JOIN recommendation_rendered_fact rendered
          ON rendered.item_id = item.id
        LEFT JOIN recommendation_impression impression
          ON impression.item_id = item.id
        LEFT JOIN recommendation_selection selection
          ON selection.item_id = item.id AND selection.received_at >= link.created_at
        LEFT JOIN recommendation_playback_episode episode
          ON episode.selection_id = selection.id AND episode.claimed_at IS NOT NULL
        WHERE v.experiment_id = ${experiment.id}
          AND v.eligibility = 'eligible' AND v.expires_at > ${now}
      )
      SELECT arm::text AS arm,
        COUNT(DISTINCT visit_id) AS eligible_visits,
        COUNT(DISTINCT visit_id) FILTER (WHERE selection_id IS NOT NULL) AS clicked_visits,
        COUNT(DISTINCT selection_id) AS accepted_selections,
        COUNT(DISTINCT rendered_id) AS rendered_cards,
        COUNT(DISTINCT impression_id) AS qualified_impressions,
        COUNT(DISTINCT selection_id) FILTER (WHERE impression_id IS NOT NULL) AS matched_selections,
        COUNT(DISTINCT selection_id) FILTER (WHERE impression_id IS NULL) AS unmatched_selections,
        COUNT(DISTINCT claimed_episode_id) AS playback_claims,
        COUNT(DISTINCT visit_id) FILTER (
          WHERE delivery_result IN ('served', 'fallback') AND request_id IS NULL
        ) AS unlinked_delivered_visits
      FROM evidence GROUP BY arm
    `)
    const byArm = { control: blankArm(), challenger: blankArm() }
    for (const row of rows) {
      if (row.arm !== "control" && row.arm !== "challenger")
        return { status: "unavailable", reason: "invalid_arm_row" }
      const arm = byArm[row.arm]
      arm.eligibleVisits = count(row.eligible_visits)
      arm.clickedVisits = count(row.clicked_visits)
      arm.acceptedSelections = count(row.accepted_selections)
      arm.renderedCards = count(row.rendered_cards)
      arm.qualifiedImpressions = count(row.qualified_impressions)
      arm.matchedSelections = count(row.matched_selections)
      arm.unmatchedSelections = count(row.unmatched_selections)
      arm.playbackClaims = count(row.playback_claims)
      arm.unlinkedDeliveredVisits = count(row.unlinked_delivered_visits)
      arm.cardCtr =
        arm.qualifiedImpressions > 0
          ? arm.matchedSelections / arm.qualifiedImpressions
          : null
    }
    const report = {
      status:
        experiment.startsAt.getTime() < now.getTime() - RAW_VISIT_MS
          ? ("incomplete_raw_window" as const)
          : ("observed_private_only" as const),
      experimentId: experiment.id,
      generationId: experiment.generationId,
      measurementQualification: "unverified_edge_bot_signal" as const,
      measurementLoss: "unobservable" as const,
      byArm,
    }
    if (!hasPermission(input.reviewer, "read:recommendation-traces"))
      return { ...report, recentCards: null }
    const cards = await prisma.$queryRaw<CardRow[]>(Prisma.sql`
      SELECT v.id AS visit_id, v.arm::text AS arm,
        request.id AS request_id, item.id AS item_id,
        item.position, item.target_media_id, request.strategy_version,
        (v.arm = 'challenger' AND request.manifest_id <> experiment.challenger_manifest_id)
          AS private_fallback,
        CASE WHEN v.delivery_request_id = request.id AND v.delivery_result = 'fallback'
          THEN v.fallback_reason ELSE NULL END AS fallback_reason,
        rendered.id IS NOT NULL AS rendered,
        impression.id IS NOT NULL AS qualified_impression,
        episode.claimed_at IS NOT NULL AS playback_claimed,
        selection.received_at
      FROM recommendation_precomputed_visit v
      JOIN recommendation_precomputed_experiment experiment
        ON experiment.id = v.experiment_id
      JOIN recommendation_precomputed_visit_request link
        ON link.visit_id = v.id AND link.expires_at > ${now}
      JOIN recommendation_request request ON request.id = link.request_id
      JOIN recommendation_served_item item ON item.request_id = request.id
      JOIN recommendation_selection selection
        ON selection.item_id = item.id AND selection.received_at >= link.created_at
      LEFT JOIN recommendation_rendered_fact rendered ON rendered.item_id = item.id
      LEFT JOIN recommendation_impression impression ON impression.item_id = item.id
      LEFT JOIN recommendation_playback_episode episode ON episode.selection_id = selection.id
      WHERE v.experiment_id = ${experiment.id}
        AND v.eligibility = 'eligible' AND v.expires_at > ${now}
      ORDER BY selection.received_at DESC, selection.id DESC
      LIMIT ${RECENT_CARD_LIMIT}
    `)
    const recentCards: PrivateClickCard[] = cards.map((row) => {
      if (row.arm !== "control" && row.arm !== "challenger")
        throw new PrivateClickReadError("invalid_arm_row")
      return {
        visitId: row.visit_id,
        assignedArm: row.arm,
        generationId: experiment.generationId,
        requestId: row.request_id,
        itemId: row.item_id,
        position: row.position,
        targetMediaId: row.target_media_id,
        actualStrategy: row.strategy_version,
        privateFallback: row.private_fallback,
        fallbackReason: row.fallback_reason,
        rendered: row.rendered,
        qualifiedImpression: row.qualified_impression,
        playbackClaimed: row.playback_claimed,
        receivedAt: row.received_at,
        late: row.received_at > experiment.endsAt,
      }
    })
    return { ...report, recentCards }
  } catch {
    return { status: "unavailable", reason: "measurement_read_unavailable" }
  }
}
