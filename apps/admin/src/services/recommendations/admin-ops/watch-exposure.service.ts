import { Prisma, type PrismaClient } from "@prisma/client"
import { resolveRecommendationOpsWindow } from "./shared"

type ExposureRow = {
  surfaceVersion: string
  position: number
  served: bigint
  rendered: bigint
  eligible: bigint
  selected: bigint
  eligibleSelected: bigint
  selectionWithoutImpression: bigint
  occlusionAware: bigint
  visibilityUnknown: bigint
}

export type WatchExposureBreakdown = {
  surface: string
  block: string
  presentation: string
  placement: string
  policyVersion: string
  position: number
  served: number | null
  rendered: number
  eligible: number
  selected: number
  eligibleSelected: number
  selectionWithoutImpression: number
  repeats: number | null
  duplicateRate: number | null
  ctr: number | null
  occlusionAware: number
  visibilityUnknown: number
}

export type AnonymousWatchExposureBreakdown = {
  rows: WatchExposureBreakdown[]
  truncated: boolean
}

export type WatchExposureRegistryFilter = {
  surface: string
  block: string
  presentation: string
  placement?: string
}

export async function loadWatchExposureBreakdown(
  prisma: PrismaClient,
  rawWindow?: string | string[],
  filter?: WatchExposureRegistryFilter,
): Promise<WatchExposureBreakdown[]> {
  const window = resolveRecommendationOpsWindow(rawWindow)
  const matchingVersions = [
    { version: "watch-for-you-v1", surface: "watch-home", block: "for-you" },
    {
      version: "watch-below-player-v1",
      surface: "watch-video",
      block: "below-player",
    },
  ]
    .filter(
      (identity) =>
        !filter ||
        (identity.surface === filter.surface &&
          identity.block === filter.block &&
          filter.presentation === "recommendation-list" &&
          (filter.placement === undefined || filter.placement === "primary")),
    )
    .map(({ version }) => version)
  const scope = !filter
    ? Prisma.empty
    : matchingVersions.length
      ? Prisma.sql`AND request.surface_version IN (${Prisma.join(matchingVersions)})`
      : Prisma.sql`AND FALSE`
  const rows = await prisma.$queryRaw<ExposureRow[]>`
    SELECT request.surface_version AS "surfaceVersion",
           item.position,
           COUNT(*) AS served,
           COUNT(rendered.id) AS rendered,
           COUNT(impression.id) AS eligible,
           COUNT(selection.id) AS selected,
           COUNT(selection.id) FILTER (
             WHERE impression.id IS NOT NULL
               AND selection.occurred_at >= impression.occurred_at
           ) AS "eligibleSelected",
           COUNT(selection.id) FILTER (
             WHERE impression.id IS NULL OR selection.occurred_at < impression.occurred_at
           ) AS "selectionWithoutImpression",
           COUNT(impression.id) FILTER (
             WHERE impression.visibility_capability = 'occlusion-aware'
           ) AS "occlusionAware",
           COUNT(impression.id) FILTER (
             WHERE impression.visibility_capability IS DISTINCT FROM 'occlusion-aware'
           ) AS "visibilityUnknown"
    FROM recommendation_served_item item
    JOIN recommendation_request request ON request.id = item.request_id
    LEFT JOIN recommendation_rendered_fact rendered
      ON rendered.item_id = item.id AND rendered.received_at < ${window.end}
    LEFT JOIN recommendation_impression impression
      ON impression.item_id = item.id AND impression.received_at < ${window.end}
    LEFT JOIN recommendation_selection selection
      ON selection.item_id = item.id AND selection.received_at < ${window.end}
    WHERE request.created_at >= ${window.start}
      AND request.created_at < ${window.end}
      AND request.surface_version IN ('watch-below-player-v1', 'watch-for-you-v1')
      ${scope}
    GROUP BY request.surface_version, item.position
    ORDER BY request.surface_version, item.position
    LIMIT 64
  `
  return rows.map((row) => {
    const served = Number(row.served)
    const eligible = Number(row.eligible)
    const selected = Number(row.selected)
    const eligibleSelected = Number(row.eligibleSelected)
    const forYou = row.surfaceVersion === "watch-for-you-v1"
    return {
      surface: forYou ? "watch-home" : "watch-video",
      block: forYou ? "for-you" : "below-player",
      presentation: "recommendation-list",
      placement: "primary",
      policyVersion: row.surfaceVersion,
      position: row.position,
      served,
      rendered: Number(row.rendered),
      eligible,
      selected,
      eligibleSelected,
      selectionWithoutImpression: Number(row.selectionWithoutImpression),
      repeats: null,
      duplicateRate: null,
      ctr: eligible > 0 ? eligibleSelected / eligible : null,
      occlusionAware: Number(row.occlusionAware),
      visibilityUnknown: Number(row.visibilityUnknown),
    }
  })
}

type AnonymousExposureRow = {
  served: bigint
  surface: string
  block: string
  presentation: string
  placement: string
  policyVersion: string
  position: number
  rendered: bigint
  eligible: bigint
  selected: bigint
  eligibleSelected: bigint
  repeats: bigint
  duplicates: bigint
  acceptedAttempts: bigint
  occlusionAware: bigint
  visibilityUnknown: bigint
}

export async function loadAnonymousWatchExposureBreakdown(
  prisma: PrismaClient,
  rawWindow?: string | string[],
  filter?: WatchExposureRegistryFilter,
): Promise<AnonymousWatchExposureBreakdown> {
  const window = resolveRecommendationOpsWindow(rawWindow)
  const cohortScope = filter
    ? Prisma.sql`
    AND surface = ${filter.surface} AND block = ${filter.block}
    AND presentation = ${filter.presentation}
    ${filter.placement === undefined ? Prisma.empty : Prisma.sql`AND placement = ${filter.placement}`}
  `
    : Prisma.empty
  const rankedScope = filter
    ? Prisma.sql`
    AND fact.surface = ${filter.surface} AND fact.block = ${filter.block}
    AND fact.presentation = ${filter.presentation}
    ${filter.placement === undefined ? Prisma.empty : Prisma.sql`AND fact.placement = ${filter.placement}`}
  `
    : Prisma.empty
  const rows = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '3000ms'")
      return tx.$queryRaw<AnonymousExposureRow[]>`
    WITH cohort AS (
      SELECT DISTINCT window_id
      FROM watch_surface_exposure
      WHERE occurred_at >= ${window.start}
        AND occurred_at < ${window.end}
        AND received_at < ${window.end}
        ${cohortScope}
    ), ranked AS (
      SELECT fact.*,
             ROW_NUMBER() OVER (
               PARTITION BY fact.window_id, fact.surface, fact.block, fact.presentation, fact.placement,
                            fact.policy_version, fact.position, fact.item_path, fact.kind
               ORDER BY fact.occurred_at, fact.received_at, fact.id
             ) AS ordinal
      FROM watch_surface_exposure fact
      JOIN cohort ON cohort.window_id = fact.window_id
      WHERE fact.occurred_at < ${window.end}
        AND fact.received_at < ${window.end}
        ${rankedScope}
    ), qualified AS (
      SELECT fact.*,
             MIN(fact.occurred_at) FILTER (
               WHERE fact.kind = 'eligible' AND fact.ordinal = 1
                 AND fact.occurred_at >= ${window.start}
             ) OVER (
               PARTITION BY fact.window_id, fact.surface, fact.block, fact.presentation, fact.placement,
                            fact.policy_version, fact.position, fact.item_path
             ) AS first_eligible_at
      FROM ranked fact
    ), facts AS (
      SELECT fact.*,
             CASE WHEN fact.kind = 'selected' AND fact.ordinal = 1
                        AND fact.first_eligible_at <= fact.occurred_at
                  THEN 1 ELSE 0 END AS eligible_selection
      FROM qualified fact
      WHERE fact.occurred_at >= ${window.start}
    )
    SELECT surface, block, presentation, placement,
           policy_version AS "policyVersion", position,
           COUNT(*) FILTER (WHERE kind = 'served' AND ordinal = 1) AS served,
           COUNT(*) FILTER (WHERE kind = 'rendered' AND ordinal = 1) AS rendered,
           COUNT(*) FILTER (WHERE kind = 'eligible' AND ordinal = 1) AS eligible,
           COUNT(*) FILTER (WHERE kind = 'selected' AND ordinal = 1) AS selected,
           COALESCE(SUM(eligible_selection), 0) AS "eligibleSelected",
           COUNT(*) FILTER (WHERE ordinal > 1 AND kind <> 'served') AS repeats,
           COUNT(*) FILTER (WHERE kind <> 'served') AS "acceptedAttempts",
           COALESCE(SUM(duplicate_count) FILTER (WHERE kind <> 'served'), 0) AS duplicates,
           COUNT(*) FILTER (WHERE kind = 'eligible' AND ordinal = 1 AND visibility_capability = 'occlusion-aware') AS "occlusionAware",
           COUNT(*) FILTER (WHERE kind = 'eligible' AND ordinal = 1 AND visibility_capability = 'unknown') AS "visibilityUnknown"
    FROM facts
    GROUP BY surface, block, presentation, placement, policy_version, position
    ORDER BY surface, block, presentation, placement, position, policy_version
    LIMIT 129
    `
    },
    { timeout: 4000 },
  )
  return {
    truncated: rows.length > 128,
    rows: rows.slice(0, 128).map((row) => {
      const eligible = Number(row.eligible)
      const eligibleSelected = Number(row.eligibleSelected)
      const selected = Number(row.selected)
      const duplicates = Number(row.duplicates)
      const acceptedAttempts = Number(row.acceptedAttempts)
      return {
        surface: row.surface,
        block: row.block,
        presentation: row.presentation,
        placement: row.placement,
        policyVersion: row.policyVersion,
        position: row.position,
        served:
          row.policyVersion === "watch-exposure-v2" ? Number(row.served) : null,
        rendered: Number(row.rendered),
        eligible,
        selected,
        eligibleSelected,
        selectionWithoutImpression: selected - eligibleSelected,
        repeats: Number(row.repeats),
        duplicateRate:
          acceptedAttempts + duplicates > 0
            ? duplicates / (acceptedAttempts + duplicates)
            : null,
        ctr: eligible > 0 ? eligibleSelected / eligible : null,
        occlusionAware: Number(row.occlusionAware),
        visibilityUnknown: Number(row.visibilityUnknown),
      }
    }),
  }
}
