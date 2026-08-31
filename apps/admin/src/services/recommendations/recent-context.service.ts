import type { PrismaClient } from "@prisma/client"
import type {
  RecommendationRecentSuppressionReason,
  RecommendationSlateComposition,
} from "./slate"

const RECENT_CONTEXT_WINDOW_DAYS = 7
const MAX_RECENT_CONTEXT_SESSIONS = 8
// Bound ledger work before joining served items and lifecycle facts. A viewer
// may accumulate arbitrarily many issued roots inside the seven-day window;
// only the newest roots per authorized session can influence this request.
export const MAX_RECENT_CONTEXT_REQUESTS_PER_SESSION = 32
const MAX_RECENT_CONTEXT_VIDEOS = 24
const REPEATEDLY_SERVED_THRESHOLD = 2

type RecentContextRow = Readonly<{
  targetMediaId: string
  servedCount: number | bigint
  selected: boolean
  playbackStarted: boolean
}>

export type RecommendationRecentContext = Readonly<{
  videos: NonNullable<RecommendationSlateComposition["recentVideos"]>
}>

/**
 * Resolve only bounded facts from the recommendation-owned ledger. The
 * current operational session is always the narrow base scope. Cross-session
 * context is available only when the caller has already proved that this is a
 * durable personalized execution and the supplied token still names an active
 * profile/privacy generation.
 */
export async function getRecommendationRecentContext(
  prisma: Pick<PrismaClient, "$queryRaw">,
  input: {
    sessionDigest: string
    profileTokenDigest: string | null
    allowDurableProfileLinks: boolean
    now: Date
  },
): Promise<RecommendationRecentContext> {
  if (!/^[a-f0-9]{64}$/.test(input.sessionDigest)) return { videos: [] }
  if (
    input.profileTokenDigest != null &&
    !/^[a-f0-9]{64}$/.test(input.profileTokenDigest)
  ) {
    return { videos: [] }
  }
  const windowStart = new Date(
    input.now.getTime() - RECENT_CONTEXT_WINDOW_DAYS * 86_400_000,
  )
  const rows = await prisma.$queryRaw<RecentContextRow[]>`
    WITH active_profile AS MATERIALIZED (
      SELECT profile.id, profile.privacy_generation
      FROM recommendation_profile profile
      WHERE ${input.profileTokenDigest}::text IS NOT NULL
        AND profile.token_digest = ${input.profileTokenDigest}
        AND profile.state = 'active'
        AND profile.expires_at > ${input.now}
      LIMIT 1
    ),
    durable_sessions AS MATERIALIZED (
      SELECT link.session_digest, link.linked_at AS authorization_start
      FROM active_profile profile
      JOIN recommendation_profile_session_link link
        ON link.profile_id = profile.id
        AND link.privacy_generation = profile.privacy_generation
        AND link.expires_at > ${input.now}
        AND (
          link.session_digest = ${input.sessionDigest}
          OR ${input.allowDurableProfileLinks}
        )
      ORDER BY
        (link.session_digest = ${input.sessionDigest}) DESC,
        link.expires_at DESC,
        link.session_digest
      LIMIT ${MAX_RECENT_CONTEXT_SESSIONS}
    ),
    scoped_sessions AS MATERIALIZED (
      SELECT
        session_digest,
        GREATEST(authorization_start, ${windowStart}) AS authorization_start
      FROM durable_sessions
      UNION ALL
      SELECT
        ${input.sessionDigest}::text AS session_digest,
        ${windowStart}::timestamp AS authorization_start
      WHERE ${input.profileTokenDigest}::text IS NULL
        AND NOT EXISTS (SELECT 1 FROM active_profile)
    ),
    recent_requests AS MATERIALIZED (
      SELECT request.id, request.created_at
      FROM scoped_sessions session
      CROSS JOIN LATERAL (
        SELECT root.id, root.created_at
        FROM recommendation_request root
        WHERE root.session_digest = session.session_digest
          AND root.state = 'issued'
          AND root.result IN ('served', 'fallback')
          AND root.created_at >= session.authorization_start
          AND root.created_at <= ${input.now}
        ORDER BY root.created_at DESC, root.id DESC
        LIMIT ${MAX_RECENT_CONTEXT_REQUESTS_PER_SESSION}
      ) request
    ),
    selected_items AS MATERIALIZED (
      SELECT DISTINCT selection.request_id, selection.item_id
      FROM recent_requests request
      JOIN recommendation_selection selection
        ON selection.request_id = request.id
        AND selection.occurred_at >= ${windowStart}
        AND selection.occurred_at <= ${input.now}
    ),
    started_items AS MATERIALIZED (
      SELECT DISTINCT fact.request_id, fact.item_id
      FROM recent_requests request
      JOIN recommendation_playback_fact fact
        ON fact.request_id = request.id
        AND fact.kind = 'playback_start'
        AND fact.occurred_at >= ${windowStart}
        AND fact.occurred_at <= ${input.now}
    ),
    recent_items AS MATERIALIZED (
      SELECT
        item.target_media_id AS "targetMediaId",
        count(DISTINCT request.id)::int AS "servedCount",
        bool_or(selected.item_id IS NOT NULL) AS selected,
        bool_or(started.item_id IS NOT NULL) AS "playbackStarted",
        max(request.created_at) AS latest_at
      FROM recent_requests request
      JOIN recommendation_served_item item ON item.request_id = request.id
      LEFT JOIN selected_items selected
        ON selected.request_id = item.request_id
        AND selected.item_id = item.id
      LEFT JOIN started_items started
        ON started.request_id = item.request_id
        AND started.item_id = item.id
      GROUP BY item.target_media_id
    )
    SELECT
      "targetMediaId",
      "servedCount",
      selected,
      "playbackStarted"
    FROM recent_items
    WHERE "playbackStarted"
      OR selected
      OR "servedCount" >= ${REPEATEDLY_SERVED_THRESHOLD}
    ORDER BY
      "playbackStarted" DESC,
      selected DESC,
      "servedCount" DESC,
      latest_at DESC,
      "targetMediaId"
    LIMIT ${MAX_RECENT_CONTEXT_VIDEOS}
  `

  const seen = new Set<string>()
  const videos: RecommendationRecentContext["videos"][number][] = []
  for (const row of rows) {
    const targetMediaId = row.targetMediaId.trim().slice(0, 191)
    if (!targetMediaId || seen.has(targetMediaId)) continue
    const reasonCodes: RecommendationRecentSuppressionReason[] = []
    if (row.playbackStarted) reasonCodes.push("recent_playback_start")
    if (row.selected) reasonCodes.push("recent_selection")
    if (Number(row.servedCount) >= REPEATEDLY_SERVED_THRESHOLD) {
      reasonCodes.push("repeatedly_served")
    }
    if (reasonCodes.length === 0) continue
    seen.add(targetMediaId)
    videos.push({ targetMediaId, reasonCodes })
  }
  return { videos }
}
