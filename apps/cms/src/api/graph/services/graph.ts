/**
 * Graph Service
 *
 * Powers the Manager dashboard's semantic graph visualization. Returns
 * `{ nodes, edges }` payloads across four modes:
 *
 *  - hierarchy:         explicit CMS relations (origin -> video -> child video)
 *  - scene-similarity:  KNN over `scene_embeddings` (pgvector cosine)
 *  - video-similarity:  KNN over `transcript_embeddings` (prototype: chunk 0)
 *  - tags:              keyword <-> video <-> origin, per language
 *
 * All queries use raw SQL via knex. Column names are snake_case per Strapi v5.
 * Published rows only (`published_at IS NOT NULL`).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KnexInstance = any

export type GraphNode = {
  id: string
  label: string
  kind: "channel" | "video" | "scene" | "tag" | "language"
  group?: string
  size?: number
  meta?: Record<string, unknown>
}

export type GraphEdge = {
  source: string
  target: string
  kind: "parent" | "similarity" | "tagged" | "variant"
  weight?: number
}

export type GraphPayload = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  meta: {
    mode: "hierarchy" | "scene-similarity" | "video-similarity" | "tags"
    generatedAt: string
    nodeCount: number
    edgeCount: number
    notes?: string[]
  }
}

// ---------------------------------------------------------------------------
// 1. Hierarchy
// ---------------------------------------------------------------------------

type HierarchyVideoRow = {
  id: number
  document_id: string
  core_id: string | null
  title: string | null
  slug: string | null
  label: string | null
  origin_document_id: string | null
  origin_name: string | null
  scene_count: number | string
}

type HierarchyChildRow = {
  parent_document_id: string
  child_document_id: string
}

export async function queryHierarchyGraph(
  knex: KnexInstance,
  opts: { originId?: string; limit: number },
): Promise<GraphPayload> {
  const { originId, limit } = opts
  const bindings: unknown[] = []
  const originFilter = originId ? "AND vo.document_id = ?" : ""
  if (originId) bindings.push(originId)
  bindings.push(limit)

  const videoSql = `
    SELECT
      v.id,
      v.document_id,
      v.core_id,
      v.title,
      v.slug,
      v.label,
      vo.document_id AS origin_document_id,
      vo.name AS origin_name,
      COALESCE(sc.scene_count, 0) AS scene_count
    FROM videos v
    LEFT JOIN videos_origin_lnk vol ON vol.video_id = v.id
    LEFT JOIN video_origins vo
      ON vo.id = vol.video_origin_id AND vo.published_at IS NOT NULL
    LEFT JOIN (
      SELECT video_id, COUNT(*)::int AS scene_count
      FROM scene_embeddings
      GROUP BY video_id
    ) sc ON sc.video_id = v.id
    WHERE v.published_at IS NOT NULL
      ${originFilter}
    ORDER BY v.id
    LIMIT ?
  `

  const videoResult: { rows: HierarchyVideoRow[] } = await knex.raw(
    videoSql,
    bindings,
  )
  const videos = videoResult.rows

  // Child relations: both parent and child must be in the video set.
  const videoIds = videos.map((v) => v.id)
  let childRows: HierarchyChildRow[] = []
  if (videoIds.length > 0) {
    const childResult: { rows: HierarchyChildRow[] } = await knex.raw(
      `
        SELECT
          pv.document_id AS parent_document_id,
          cv.document_id AS child_document_id
        FROM videos_children_lnk vcl
        JOIN videos pv ON pv.id = vcl.video_id
          AND pv.published_at IS NOT NULL
        JOIN videos cv ON cv.id = vcl.inv_video_id
          AND cv.published_at IS NOT NULL
        WHERE vcl.video_id = ANY(?::int[])
          AND vcl.inv_video_id = ANY(?::int[])
      `,
      [videoIds, videoIds],
    )
    childRows = childResult.rows
  }

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const originSeen = new Set<string>()

  for (const v of videos) {
    const originKey = v.origin_document_id
      ? `origin:${v.origin_document_id}`
      : null
    if (originKey && !originSeen.has(originKey)) {
      originSeen.add(originKey)
      nodes.push({
        id: originKey,
        label: v.origin_name ?? "Origin",
        kind: "channel",
        group: originKey,
        size: 8,
      })
    }

    const videoKey = `video:${v.document_id}`
    nodes.push({
      id: videoKey,
      label: v.title ?? v.slug ?? v.core_id ?? v.document_id,
      kind: "video",
      group: originKey ?? "unknown",
      size: Math.min(12, 3 + Math.log2(Number(v.scene_count) + 2)),
      meta: {
        label: v.label,
        slug: v.slug,
        coreId: v.core_id,
        sceneCount: Number(v.scene_count),
      },
    })

    if (originKey) {
      edges.push({
        source: originKey,
        target: videoKey,
        kind: "parent",
      })
    }
  }

  for (const row of childRows) {
    edges.push({
      source: `video:${row.parent_document_id}`,
      target: `video:${row.child_document_id}`,
      kind: "parent",
    })
  }

  return {
    nodes,
    edges,
    meta: {
      mode: "hierarchy",
      generatedAt: new Date().toISOString(),
      nodeCount: nodes.length,
      edgeCount: edges.length,
      notes: originId ? [`filtered by origin=${originId}`] : undefined,
    },
  }
}

// ---------------------------------------------------------------------------
// 2. Scene similarity
// ---------------------------------------------------------------------------

type SceneRow = {
  id: number
  video_id: number
  scene_index: number
  description: string
  start_seconds: number
  end_seconds: number | null
  themes: string[] | null
  video_document_id: string
  video_title: string | null
  origin_document_id: string | null
  origin_name: string | null
}

type SimilarityEdgeRow = {
  source_id: number
  target_id: number
  similarity: number
}

export async function querySceneSimilarityGraph(
  knex: KnexInstance,
  opts: {
    limit: number
    knn: number
    threshold: number
    videoId?: number
  },
): Promise<GraphPayload> {
  const { limit, knn, threshold, videoId } = opts
  const bindings: unknown[] = []
  const videoFilter = videoId ? "AND se.video_id = ?" : ""
  if (videoId) bindings.push(videoId)
  bindings.push(limit)

  const sceneSql = `
    SELECT
      se.id,
      se.video_id,
      se.scene_index,
      se.description,
      se.start_seconds,
      se.end_seconds,
      se.themes,
      v.document_id AS video_document_id,
      v.title AS video_title,
      vo.document_id AS origin_document_id,
      vo.name AS origin_name
    FROM scene_embeddings se
    JOIN videos v ON v.id = se.video_id AND v.published_at IS NOT NULL
    LEFT JOIN videos_origin_lnk vol ON vol.video_id = v.id
    LEFT JOIN video_origins vo
      ON vo.id = vol.video_origin_id AND vo.published_at IS NOT NULL
    WHERE 1=1
      ${videoFilter}
    ORDER BY se.video_id, se.scene_index
    LIMIT ?
  `

  const sceneResult: { rows: SceneRow[] } = await knex.raw(sceneSql, bindings)
  const scenes = sceneResult.rows
  if (scenes.length === 0) {
    return {
      nodes: [],
      edges: [],
      meta: {
        mode: "scene-similarity",
        generatedAt: new Date().toISOString(),
        nodeCount: 0,
        edgeCount: 0,
        notes: ["no scenes found"],
      },
    }
  }

  const sceneIds = scenes.map((s) => s.id)

  // KNN within the sampled scene set. LATERAL join with cosine distance +
  // the HNSW index; self-link filtered; similarity threshold applied.
  const knnResult: { rows: SimilarityEdgeRow[] } = await knex.raw(
    `
      SELECT
        src.id AS source_id,
        nbr.id AS target_id,
        nbr.similarity
      FROM (
        SELECT id, embedding FROM scene_embeddings
        WHERE id = ANY(?::int[])
      ) src
      JOIN LATERAL (
        SELECT
          se2.id,
          1 - (se2.embedding <=> src.embedding) AS similarity
        FROM scene_embeddings se2
        WHERE se2.id = ANY(?::int[])
          AND se2.id <> src.id
        ORDER BY se2.embedding <=> src.embedding
        LIMIT ?
      ) nbr ON true
      WHERE nbr.similarity >= ?
    `,
    [sceneIds, sceneIds, knn, threshold],
  )

  const nodes: GraphNode[] = []
  const originSeen = new Set<string>()
  const sceneIdToKey = new Map<number, string>()

  for (const s of scenes) {
    const originKey = s.origin_document_id
      ? `origin:${s.origin_document_id}`
      : "origin:unknown"
    if (!originSeen.has(originKey)) {
      originSeen.add(originKey)
    }
    const key = `scene:${s.id}`
    sceneIdToKey.set(s.id, key)
    nodes.push({
      id: key,
      label: `${s.video_title ?? s.video_document_id} · scene ${s.scene_index}`,
      kind: "scene",
      group: originKey,
      size: 4,
      meta: {
        description: s.description,
        startSeconds: s.start_seconds,
        endSeconds: s.end_seconds,
        themes: s.themes ?? [],
        videoDocumentId: s.video_document_id,
        originName: s.origin_name,
      },
    })
  }

  // Deduplicate undirected edges (a->b === b->a).
  const edgeSet = new Set<string>()
  const edges: GraphEdge[] = []
  for (const row of knnResult.rows) {
    const a = sceneIdToKey.get(row.source_id)
    const b = sceneIdToKey.get(row.target_id)
    if (!a || !b) continue
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    if (edgeSet.has(key)) continue
    edgeSet.add(key)
    edges.push({
      source: a,
      target: b,
      kind: "similarity",
      weight: Number(row.similarity),
    })
  }

  return {
    nodes,
    edges,
    meta: {
      mode: "scene-similarity",
      generatedAt: new Date().toISOString(),
      nodeCount: nodes.length,
      edgeCount: edges.length,
      notes: [`sample limit=${limit}`, `knn=${knn}`, `threshold=${threshold}`],
    },
  }
}

// ---------------------------------------------------------------------------
// 3. Video similarity (transcript_embeddings, chunk_index=0 proxy)
// ---------------------------------------------------------------------------

type VideoEmbeddingRow = {
  video_id: number
  document_id: string
  title: string | null
  slug: string | null
  origin_document_id: string | null
  origin_name: string | null
}

export async function queryVideoSimilarityGraph(
  knex: KnexInstance,
  opts: { limit: number; knn: number; threshold: number },
): Promise<GraphPayload> {
  const { limit, knn, threshold } = opts

  const videoSql = `
    SELECT
      te.video_id,
      v.document_id,
      v.title,
      v.slug,
      vo.document_id AS origin_document_id,
      vo.name AS origin_name
    FROM transcript_embeddings te
    JOIN videos v ON v.id = te.video_id AND v.published_at IS NOT NULL
    LEFT JOIN videos_origin_lnk vol ON vol.video_id = v.id
    LEFT JOIN video_origins vo
      ON vo.id = vol.video_origin_id AND vo.published_at IS NOT NULL
    WHERE te.chunk_index = 0
    ORDER BY te.video_id
    LIMIT ?
  `

  const videoResult: { rows: VideoEmbeddingRow[] } = await knex.raw(videoSql, [
    limit,
  ])
  const videos = videoResult.rows
  if (videos.length === 0) {
    return {
      nodes: [],
      edges: [],
      meta: {
        mode: "video-similarity",
        generatedAt: new Date().toISOString(),
        nodeCount: 0,
        edgeCount: 0,
        notes: ["no transcript embeddings found"],
      },
    }
  }

  const videoIds = videos.map((v) => v.video_id)

  const knnResult: { rows: SimilarityEdgeRow[] } = await knex.raw(
    `
      SELECT
        src.video_id AS source_id,
        nbr.video_id AS target_id,
        nbr.similarity
      FROM (
        SELECT video_id, embedding FROM transcript_embeddings
        WHERE chunk_index = 0 AND video_id = ANY(?::int[])
      ) src
      JOIN LATERAL (
        SELECT
          te2.video_id,
          1 - (te2.embedding <=> src.embedding) AS similarity
        FROM transcript_embeddings te2
        WHERE te2.chunk_index = 0
          AND te2.video_id = ANY(?::int[])
          AND te2.video_id <> src.video_id
        ORDER BY te2.embedding <=> src.embedding
        LIMIT ?
      ) nbr ON true
      WHERE nbr.similarity >= ?
    `,
    [videoIds, videoIds, knn, threshold],
  )

  const nodes: GraphNode[] = []
  const idToKey = new Map<number, string>()
  for (const v of videos) {
    const originKey = v.origin_document_id
      ? `origin:${v.origin_document_id}`
      : "origin:unknown"
    const key = `video:${v.document_id}`
    idToKey.set(v.video_id, key)
    nodes.push({
      id: key,
      label: v.title ?? v.slug ?? v.document_id,
      kind: "video",
      group: originKey,
      size: 6,
      meta: {
        slug: v.slug,
        originName: v.origin_name,
      },
    })
  }

  const edgeSet = new Set<string>()
  const edges: GraphEdge[] = []
  for (const row of knnResult.rows) {
    const a = idToKey.get(row.source_id)
    const b = idToKey.get(row.target_id)
    if (!a || !b) continue
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    if (edgeSet.has(key)) continue
    edgeSet.add(key)
    edges.push({
      source: a,
      target: b,
      kind: "similarity",
      weight: Number(row.similarity),
    })
  }

  return {
    nodes,
    edges,
    meta: {
      mode: "video-similarity",
      generatedAt: new Date().toISOString(),
      nodeCount: nodes.length,
      edgeCount: edges.length,
      notes: [
        `sample limit=${limit}`,
        `knn=${knn}`,
        `threshold=${threshold}`,
        "prototype: using chunk_index=0 as video vector",
      ],
    },
  }
}

// ---------------------------------------------------------------------------
// 4. Tags
// ---------------------------------------------------------------------------

type TagRow = {
  keyword_id: number
  keyword_core_id: string | null
  value: string | null
  language_bcp_47: string | null
  video_id: number
  video_document_id: string
  video_title: string | null
  origin_document_id: string | null
  origin_name: string | null
}

export async function queryTagsGraph(
  knex: KnexInstance,
  opts: { bcp47: string; limit: number },
): Promise<GraphPayload> {
  const { bcp47, limit } = opts

  const sql = `
    SELECT
      k.id AS keyword_id,
      k.core_id AS keyword_core_id,
      k.value,
      l.bcp_47 AS language_bcp_47,
      v.id AS video_id,
      v.document_id AS video_document_id,
      v.title AS video_title,
      vo.document_id AS origin_document_id,
      vo.name AS origin_name
    FROM videos_keywords_lnk vkl
    JOIN keywords k ON k.id = vkl.keyword_id
      AND k.published_at IS NOT NULL
    JOIN keywords_language_lnk kll ON kll.keyword_id = k.id
    JOIN languages l ON l.id = kll.language_id AND l.bcp_47 = ?
    JOIN videos v ON v.id = vkl.video_id AND v.published_at IS NOT NULL
    LEFT JOIN videos_origin_lnk vol ON vol.video_id = v.id
    LEFT JOIN video_origins vo
      ON vo.id = vol.video_origin_id AND vo.published_at IS NOT NULL
    ORDER BY k.id
    LIMIT ?
  `

  const result: { rows: TagRow[] } = await knex.raw(sql, [bcp47, limit])
  const rows = result.rows

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const originSeen = new Set<string>()
  const videoSeen = new Set<string>()
  const tagSeen = new Set<string>()
  const edgeSeen = new Set<string>()

  for (const r of rows) {
    const originKey = r.origin_document_id
      ? `origin:${r.origin_document_id}`
      : "origin:unknown"
    const videoKey = `video:${r.video_document_id}`
    const tagKey = `tag:${r.keyword_id}`

    if (!originSeen.has(originKey)) {
      originSeen.add(originKey)
      nodes.push({
        id: originKey,
        label: r.origin_name ?? "Origin",
        kind: "channel",
        group: originKey,
        size: 8,
      })
    }
    if (!videoSeen.has(videoKey)) {
      videoSeen.add(videoKey)
      nodes.push({
        id: videoKey,
        label: r.video_title ?? r.video_document_id,
        kind: "video",
        group: originKey,
        size: 4,
      })
      const parentKey = `${originKey}|${videoKey}`
      if (!edgeSeen.has(parentKey)) {
        edgeSeen.add(parentKey)
        edges.push({
          source: originKey,
          target: videoKey,
          kind: "parent",
        })
      }
    }
    if (!tagSeen.has(tagKey)) {
      tagSeen.add(tagKey)
      nodes.push({
        id: tagKey,
        label: r.value ?? r.keyword_core_id ?? String(r.keyword_id),
        kind: "tag",
        group: "tag",
        size: 3,
        meta: {
          bcp47: r.language_bcp_47,
        },
      })
    }

    const tagEdgeKey = `${videoKey}|${tagKey}`
    if (!edgeSeen.has(tagEdgeKey)) {
      edgeSeen.add(tagEdgeKey)
      edges.push({
        source: videoKey,
        target: tagKey,
        kind: "tagged",
      })
    }
  }

  return {
    nodes,
    edges,
    meta: {
      mode: "tags",
      generatedAt: new Date().toISOString(),
      nodeCount: nodes.length,
      edgeCount: edges.length,
      notes: [`bcp47=${bcp47}`, `row limit=${limit}`],
    },
  }
}
