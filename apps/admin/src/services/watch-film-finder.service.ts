import { Prisma, type PrismaClient } from "@prisma/client"

import {
  PUBLIC_CONTENT_SLUG_SQL_PATTERN,
  SERIES_SHAPED_LABELS,
  VISIBLE_DESCENDANT_SQL,
} from "./search-watchability"

/**
 * Watch "find my film" projection (feat-728). Reads a code-allowlisted set of
 * collections and returns one card per visible leaf Video that has a playable
 * Dub in exactly the requested audio language. No search product, embeddings
 * or provider call is involved, and no subtitle fallback: a Video without
 * playable audio in the requested language is simply not a card.
 *
 * The lane ids are the stable contract Web keys its own copy on; the slugs are
 * the only catalog identity Admin trusts, and they live here, never in input.
 */
export const WATCH_FILM_FINDER_LANES = [
  { id: "conversation", collectionSlug: "conversation-starters" },
  { id: "seven-days", collectionSlug: "7-days-with-jesus-walk-with-jesus" },
  { id: "kids", collectionSlug: "storyclubs" },
  { id: "questions", collectionSlug: "do-you-ever-wonder" },
  { id: "getting-started", collectionSlug: "walking-with-jesus-africa" },
  { id: "women", collectionSlug: "rivka" },
  { id: "animated", collectionSlug: "file-zero" },
  { id: "culture", collectionSlug: "retelling-the-good-story" },
] as const

export type WatchFilmFinderLaneId =
  (typeof WATCH_FILM_FINDER_LANES)[number]["id"]

export const WATCH_FILM_FINDER_LANE_IDS = WATCH_FILM_FINDER_LANES.map(
  (lane) => lane.id,
)

export const WATCH_FILM_FINDER_MAX_LANES = WATCH_FILM_FINDER_LANES.length

/** Cards per page, and the default page size. */
export const WATCH_FILM_FINDER_CARD_LIMIT = 24

/**
 * "Up to" runtime caps, matching the prototype's time question. ANY applies no
 * cap. A Dub with no recorded duration cannot satisfy a cap.
 */
export const WATCH_FILM_FINDER_DURATION_MAX_SECONDS = {
  SHORT: 360,
  MEDIUM: 1500,
} as const

export type WatchFilmFinderDuration = "SHORT" | "MEDIUM" | "ANY"

const DURATION_BUCKETS = ["SHORT", "MEDIUM", "ANY"] as const

/**
 * The declared candidate window. Per lane the scan reads at most
 * `CHILDREN_SCAN_LIMIT` visible children of each node, expands at most
 * `CONTAINER_EXPANSION_LIMIT` intermediate series, and keeps the first
 * `LANE_CANDIDATE_LIMIT` distinct visible leaves in canonical relation order.
 * Audio and duration eligibility are applied inside that window, so paging
 * walks one stable sequence and cannot skip an eligible card within it.
 */
const CHILDREN_SCAN_LIMIT = 64
const CONTAINER_EXPANSION_LIMIT = 8
const LANE_CANDIDATE_LIMIT = 64
const MAX_OFFSET = WATCH_FILM_FINDER_MAX_LANES * LANE_CANDIDATE_LIMIT

const PUBLIC_LANGUAGE_SLUG = /^[a-z0-9-]{1,80}$/
const CURSOR = /^v1:(\d{1,4})$/

export type WatchFilmFinderInput = {
  laneIds: readonly WatchFilmFinderLaneId[]
  /** Public Watch language slug; the exact audio language required. */
  languageSlug: string
  duration?: WatchFilmFinderDuration | null
  first?: number | null
  after?: string | null
}

export type WatchFilmFinderCard = {
  laneId: WatchFilmFinderLaneId
  videoId: string
  slug: string
  title: string
  durationSeconds: number | null
  imageUrl: string | null
  /** For a frame thumbnail when the video has no authored artwork. */
  muxPlaybackId: string | null
  /** The playable Dub in the requested audio language. */
  videoDubId: string
}

export type WatchFilmFinderPage = {
  cards: WatchFilmFinderCard[]
  hasNextPage: boolean
  endCursor: string | null
}

export class WatchFilmFinderInputError extends Error {
  constructor(
    readonly code:
      | "invalid_lanes"
      | "invalid_language"
      | "invalid_duration"
      | "invalid_page_size"
      | "invalid_cursor",
    message: string,
  ) {
    super(message)
    this.name = "WatchFilmFinderInputError"
  }
}

type FinderRow = WatchFilmFinderCard

type NormalizedInput = {
  lanes: Array<(typeof WATCH_FILM_FINDER_LANES)[number]>
  languageSlug: string
  maxSeconds: number | null
  first: number
  offset: number
}

function normalizeInput(input: WatchFilmFinderInput): NormalizedInput {
  const requested = input.laneIds
  if (
    !Array.isArray(requested) ||
    requested.length < 1 ||
    requested.length > WATCH_FILM_FINDER_MAX_LANES
  ) {
    throw new WatchFilmFinderInputError(
      "invalid_lanes",
      `Between 1 and ${WATCH_FILM_FINDER_MAX_LANES} lane ids are required`,
    )
  }
  const lanes: NormalizedInput["lanes"] = []
  for (const id of requested) {
    const lane = WATCH_FILM_FINDER_LANES.find(
      (candidate) => candidate.id === id,
    )
    if (!lane) {
      throw new WatchFilmFinderInputError("invalid_lanes", "Unknown lane id")
    }
    if (!lanes.includes(lane)) lanes.push(lane)
  }

  if (
    typeof input.languageSlug !== "string" ||
    !PUBLIC_LANGUAGE_SLUG.test(input.languageSlug)
  ) {
    throw new WatchFilmFinderInputError(
      "invalid_language",
      "languageSlug must be a public language slug",
    )
  }

  const duration = input.duration ?? "ANY"
  if (!DURATION_BUCKETS.includes(duration)) {
    throw new WatchFilmFinderInputError(
      "invalid_duration",
      "Unknown duration bucket",
    )
  }

  const first = input.first ?? WATCH_FILM_FINDER_CARD_LIMIT
  if (
    !Number.isInteger(first) ||
    first < 1 ||
    first > WATCH_FILM_FINDER_CARD_LIMIT
  ) {
    throw new WatchFilmFinderInputError(
      "invalid_page_size",
      `first must be between 1 and ${WATCH_FILM_FINDER_CARD_LIMIT}`,
    )
  }

  let offset = 0
  if (input.after != null) {
    const match = CURSOR.exec(input.after)
    offset = match ? Number(match[1]) : Number.NaN
    if (!Number.isInteger(offset) || offset > MAX_OFFSET) {
      throw new WatchFilmFinderInputError("invalid_cursor", "Invalid cursor")
    }
  }

  return {
    lanes,
    languageSlug: input.languageSlug,
    maxSeconds:
      duration === "ANY"
        ? null
        : WATCH_FILM_FINDER_DURATION_MAX_SECONDS[duration],
    first,
    offset,
  }
}

/** Canonical relation order: each hop by `order`, then `created_at`, then id. */
const CANONICAL_ORDER = Prisma.sql`
  o1 ASC NULLS LAST, c1 ASC, r1 ASC,
  o2 ASC NULLS LAST, c2 ASC NULLS LAST, r2 ASC NULLS LAST`

/**
 * Child lookup for one hop. The visibility gate is the shared
 * `VISIBLE_DESCENDANT_SQL`, applied to every intermediate and every leaf, so a
 * hidden series cannot carry a visible leaf into a lane.
 */
function hopSql(parentColumn: Prisma.Sql, prefix: "1" | "2") {
  return Prisma.sql`
    SELECT
      descendant_video.id AS video_id,
      descendant_video.label::text AS label,
      relation."order" AS ${Prisma.raw(`o${prefix}`)},
      relation.created_at AS ${Prisma.raw(`c${prefix}`)},
      relation.id AS ${Prisma.raw(`r${prefix}`)}
    FROM video_relation relation
    JOIN video descendant_video
      ON descendant_video.id = relation.child_id
     AND ${VISIBLE_DESCENDANT_SQL}
    WHERE relation.parent_id = ${parentColumn}
    ORDER BY relation."order" ASC NULLS LAST, relation.created_at ASC,
             relation.id ASC
    LIMIT ${CHILDREN_SCAN_LIMIT}`
}

export class WatchFilmFinderService {
  constructor(
    private readonly prisma: Pick<PrismaClient, "$queryRaw" | "language">,
  ) {}

  async find(input: WatchFilmFinderInput): Promise<WatchFilmFinderPage> {
    const { lanes, languageSlug, maxSeconds, first, offset } =
      normalizeInput(input)

    const language = await this.prisma.language.findFirst({
      where: { slug: languageSlug, deletedAt: null },
      select: { id: true, slug: true, bcp47: true },
    })
    if (!language) return { cards: [], hasNextPage: false, endCursor: null }

    const requestedLanes = Prisma.join(
      lanes.map(
        (lane, rank) =>
          Prisma.sql`(${rank}::int, ${lane.id}::text, ${lane.collectionSlug}::text)`,
      ),
    )
    const durationCap =
      maxSeconds === null
        ? Prisma.empty
        : Prisma.sql`AND picked.duration <= ${maxSeconds}`

    const rows = await this.prisma.$queryRaw<FinderRow[]>(Prisma.sql`
      WITH requested(lane_rank, lane_id, collection_slug) AS (
        VALUES ${requestedLanes}
      ),
      root AS (
        SELECT requested.lane_rank, requested.lane_id, container.id AS video_id
        FROM requested
        JOIN video container
          ON container.slug = requested.collection_slug
         AND container.deleted_at IS NULL
         AND container.no_index = FALSE
         AND container.slug ~ ${PUBLIC_CONTENT_SLUG_SQL_PATTERN}
         AND NOT ('watch' = ANY(container.restrict_view_platforms))
         AND EXISTS (
           SELECT 1
           FROM video_locale root_locale
           WHERE root_locale.video_id = container.id
             AND root_locale.deleted_at IS NULL
             AND root_locale.status = 'published'
         )
      ),
      level1 AS (
        SELECT root.lane_rank, root.lane_id, hop.video_id, hop.label,
               hop.o1, hop.c1, hop.r1,
               NULL::int AS o2, NULL::timestamp AS c2, NULL::text AS r2
        FROM root
        CROSS JOIN LATERAL (${hopSql(Prisma.sql`root.video_id`, "1")}) hop
      ),
      expanded AS (
        SELECT *
        FROM (
          SELECT level1.*,
                 ROW_NUMBER() OVER (
                   PARTITION BY lane_rank ORDER BY o1 ASC NULLS LAST, c1 ASC, r1 ASC
                 ) AS container_rank
          FROM level1
          WHERE label = ANY(${[...SERIES_SHAPED_LABELS]}::text[])
        ) ranked
        WHERE container_rank <= ${CONTAINER_EXPANSION_LIMIT}
      ),
      level2 AS (
        SELECT expanded.lane_rank, expanded.lane_id, hop.video_id, hop.label,
               expanded.o1, expanded.c1, expanded.r1, hop.o2, hop.c2, hop.r2
        FROM expanded
        CROSS JOIN LATERAL (${hopSql(Prisma.sql`expanded.video_id`, "2")}) hop
      ),
      leaf AS (
        SELECT * FROM level1
        UNION ALL
        SELECT * FROM level2
      ),
      leaf_unique AS (
        SELECT DISTINCT ON (lane_rank, video_id) *
        FROM leaf
        WHERE NOT (COALESCE(label, '') = ANY(${[...SERIES_SHAPED_LABELS]}::text[]))
        ORDER BY lane_rank, video_id, ${CANONICAL_ORDER}
      ),
      windowed AS (
        SELECT leaf_unique.lane_rank, leaf_unique.lane_id,
               leaf_unique.video_id, leaf_unique.rn
        FROM (
          SELECT *,
                 ROW_NUMBER() OVER (
                   PARTITION BY lane_rank ORDER BY ${CANONICAL_ORDER}
                 ) AS rn
          FROM leaf_unique
        ) leaf_unique
        WHERE leaf_unique.rn <= ${LANE_CANDIDATE_LIMIT}
      ),
      eligible AS (
        SELECT DISTINCT ON (windowed.video_id)
          windowed.lane_rank,
          windowed.rn,
          windowed.lane_id AS "laneId",
          windowed.video_id AS "videoId",
          video.slug,
          COALESCE(title.title, video.slug) AS title,
          picked.duration AS "durationSeconds",
          selected_image.image_url AS "imageUrl",
          picked.playback_id AS "muxPlaybackId",
          picked.dub_id AS "videoDubId"
        FROM windowed
        JOIN video ON video.id = windowed.video_id
        JOIN LATERAL (
          SELECT
            dub.id AS dub_id,
            dub.duration,
            NULLIF(BTRIM(mux_video.playback_id), '') AS playback_id
          FROM video_dub dub
          JOIN language dub_language
            ON dub_language.id = dub.language_id
           AND dub_language.deleted_at IS NULL
           AND dub_language.slug = ${language.slug}
          LEFT JOIN video_edition dub_edition
            ON dub_edition.id = dub.video_edition_id
          LEFT JOIN mux_video
            ON mux_video.id = dub.mux_video_id
           AND mux_video.deleted_at IS NULL
          WHERE dub.video_id = windowed.video_id
            AND dub.deleted_at IS NULL
            AND dub.published = TRUE
            AND NULLIF(BTRIM(dub.hls), '') IS NOT NULL
            AND (dub.video_edition_id IS NULL OR dub_edition.deleted_at IS NULL)
          -- Same winner the watch route plays: longest first, id tie-break.
          ORDER BY dub.duration DESC, dub.id ASC
          LIMIT 1
        ) picked ON TRUE
        LEFT JOIN LATERAL (
          SELECT NULLIF(BTRIM(locale.title), '') AS title
          FROM video_locale locale
          WHERE locale.video_id = windowed.video_id
            AND locale.deleted_at IS NULL
            AND locale.status = 'published'
            AND NULLIF(BTRIM(locale.title), '') IS NOT NULL
          ORDER BY
            CASE
              WHEN locale.language_slug = ${language.slug}
                OR locale.locale = ${language.bcp47}::text THEN 0
              WHEN locale.language_slug = 'english' THEN 1
              ELSE 2
            END ASC,
            locale.updated_at DESC,
            locale.id ASC
          LIMIT 1
        ) title ON TRUE
        LEFT JOIN LATERAL (
          SELECT COALESCE(
            NULLIF(BTRIM(image.mobile_cinematic_high), ''),
            NULLIF(BTRIM(image.mobile_cinematic_low), ''),
            NULLIF(BTRIM(image.url), ''),
            NULLIF(BTRIM(image.thumbnail), '')
          ) AS image_url
          FROM video_image image
          WHERE image.video_id = windowed.video_id
            AND image.deleted_at IS NULL
            AND COALESCE(
              NULLIF(BTRIM(image.mobile_cinematic_high), ''),
              NULLIF(BTRIM(image.mobile_cinematic_low), ''),
              NULLIF(BTRIM(image.url), ''),
              NULLIF(BTRIM(image.thumbnail), '')
            ) IS NOT NULL
          ORDER BY
            CASE
              WHEN NULLIF(BTRIM(image.mobile_cinematic_high), '') IS NOT NULL THEN 0
              WHEN NULLIF(BTRIM(image.mobile_cinematic_low), '') IS NOT NULL THEN 1
              WHEN NULLIF(BTRIM(image.url), '') IS NOT NULL THEN 2
              ELSE 3
            END ASC,
            image.updated_at DESC,
            image.id ASC
          LIMIT 1
        ) selected_image ON TRUE
        WHERE TRUE ${durationCap}
        -- One card per Video across lanes: the earliest requested lane wins.
        ORDER BY windowed.video_id, windowed.lane_rank, windowed.rn
      )
      SELECT "laneId", "videoId", slug, title, "durationSeconds", "imageUrl",
             "muxPlaybackId", "videoDubId"
      FROM eligible
      ORDER BY lane_rank ASC, rn ASC
      LIMIT ${first + 1}
      OFFSET ${offset}
    `)

    const hasNextPage = rows.length > first
    return {
      cards: rows.slice(0, first),
      hasNextPage,
      endCursor: hasNextPage ? `v1:${offset + first}` : null,
    }
  }
}
