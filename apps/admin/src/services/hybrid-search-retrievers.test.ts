/**
 * Unit tests for hybrid-search retrievers.
 *
 * These tests exercise the mock-Prisma shape so we catch argument-binding
 * and return-shape regressions without requiring a running Postgres.
 * Deeper DB-backed parity testing happens at the orchestrator + route
 * handler level.
 */

import { describe, expect, it, vi, beforeEach } from "vitest"
import {
  calculateVideoSemanticMixedScore,
  mixVideoSemanticEvidenceRows,
  searchVideoSemantic,
  searchVideoSemanticHnswPrototype,
  searchVideoKeyword,
  searchExperienceSemantic,
  searchExperienceKeyword,
  VIDEO_SEMANTIC_HNSW_EF_SEARCH,
  VIDEO_SEMANTIC_HNSW_MAX_SCAN_TUPLES,
} from "./hybrid-search-retrievers"
import { SearchTimingRecorder } from "./hybrid-search-timing"

function mockPrisma() {
  const $queryRaw = vi.fn()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    $queryRaw,
    $executeRaw: vi.fn(),
    $executeRawUnsafe: vi.fn(),
  }
  prisma.$transaction = vi.fn(async (run: (tx: typeof prisma) => unknown) =>
    run(prisma),
  )
  return prisma
}

function latestRawSql(prisma: ReturnType<typeof mockPrisma>): string {
  const call = prisma.$queryRaw.mock.calls.at(-1)
  return (call?.[0] as TemplateStringsArray | undefined)?.join(" ") ?? ""
}

function latestRawValues(prisma: ReturnType<typeof mockPrisma>): unknown[] {
  const call = prisma.$queryRaw.mock.calls.at(-1)
  return (call?.slice(1) ?? []).flatMap((value: unknown) => {
    if (
      value != null &&
      typeof value === "object" &&
      "values" in (value as Record<string, unknown>) &&
      Array.isArray((value as { values: unknown }).values)
    ) {
      return [value, ...(value as { values: unknown[] }).values]
    }
    return [value]
  })
}

/**
 * Renders the full SQL of the latest `$queryRaw` call INCLUDING any
 * interpolated `Prisma.raw(...)` fragments. `latestRawSql` above joins
 * only the static template strings (`call[0]`); a `Prisma.raw` value is
 * passed as an interpolated argument (in `call.slice(1)`), carrying its
 * literal text on `.sql`. Provenance filters are interpolated fragments,
 * so assertions that inspect those predicates fold the fragments back in.
 */
function latestRawSqlWithFragments(
  prisma: ReturnType<typeof mockPrisma>,
): string {
  const strings = latestRawSql(prisma)
  const fragments = latestRawValues(prisma)
    .map((value) =>
      value != null &&
      typeof value === "object" &&
      "sql" in (value as Record<string, unknown>) &&
      typeof (value as { sql: unknown }).sql === "string"
        ? (value as { sql: string }).sql
        : "",
    )
    .join(" ")
  return `${strings} ${fragments}`
}

function sqlBetween(sql: string, start: string, end: string): string {
  const startIndex = sql.indexOf(start)
  expect(startIndex).toBeGreaterThan(-1)
  const endIndex = sql.indexOf(end, startIndex + start.length)
  expect(endIndex).toBeGreaterThan(-1)
  return sql.slice(startIndex, endIndex)
}

describe("searchVideoSemantic", () => {
  let prisma: ReturnType<typeof mockPrisma>

  beforeEach(() => {
    prisma = mockPrisma()
  })

  it("returns a RankedItem-shaped row per DB row", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        video_id: "vid-1",
        video_core_id: "1_Jesus",
        video_slug: "jesus",
        video_title: "Jesus",
        image_url: "https://images.example/jesus.jpg",
        evidence_id: "scene-1",
        evidence_source: "scene",
        scene_description: "Peter denies Jesus",
        start_seconds: 42.5,
        playback_id: "mux-abc",
        source_score: 0.87,
        similarity: 0.87,
        embedding_text: "[0.1,0.2]",
      },
    ])

    const rows = await searchVideoSemantic(prisma, {
      queryEmbedding: "[0.1,0.2]",
      locale: "en",
      limit: 10,
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      resultType: "video",
      resultId: "vid-1",
      videoCoreId: "1_Jesus",
      videoSlug: "jesus",
      videoTitle: "Jesus",
      imageUrl: "https://images.example/jesus.jpg",
      sceneDescription: "Peter denies Jesus",
      startSeconds: 42.5,
      playbackId: "mux-abc",
      similarity: 0.87,
      embeddingText: "[0.1,0.2]",
    })
  })

  it("records the semantic-video DB timing when a recorder is passed", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])
    const timing = new SearchTimingRecorder()

    await searchVideoSemantic(
      prisma,
      {
        queryEmbedding: "[0.1,0.2]",
        locale: "en",
        limit: 10,
      },
      timing,
    )

    expect(timing.snapshotDbTimings()).toEqual([
      expect.objectContaining({
        label: "semantic-video.query",
        status: "fulfilled",
        resultCount: 0,
        elapsedMs: expect.any(Number),
      }),
    ])
  })

  it("maps transcript evidence rows through the same semantic-video result shape", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        video_id: "vid-transcript",
        video_core_id: "core-transcript",
        video_slug: "spoken-story",
        video_title: "Spoken Story",
        image_url: null,
        evidence_id: "chunk-1",
        evidence_source: "transcript",
        scene_description: "The exact spoken phrase from the transcript",
        start_seconds: 123.25,
        playback_id: "mux-transcript",
        source_score: 0.91,
        similarity: 0.91,
        embedding_text: "[0.3,0.4]",
      },
    ])

    const rows = await searchVideoSemantic(prisma, {
      queryEmbedding: "[0.3,0.4]",
      locale: "en",
      limit: 10,
    })

    expect(rows[0]).toMatchObject({
      resultType: "video",
      resultId: "vid-transcript",
      sceneDescription: "The exact spoken phrase from the transcript",
      startSeconds: 123.25,
      playbackId: "mux-transcript",
      similarity: 0.91,
      embeddingText: "[0.3,0.4]",
    })
  })

  it("tolerates null playback_id (no matching dub for (edition, locale))", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        video_id: "vid-2",
        video_core_id: null,
        video_slug: "x",
        video_title: "X",
        image_url: null,
        evidence_id: "scene-2",
        evidence_source: "scene",
        scene_description: "d",
        start_seconds: 0,
        playback_id: null,
        source_score: 0.5,
        similarity: 0.5,
        embedding_text: "[]",
      },
    ])

    const rows = await searchVideoSemantic(prisma, {
      queryEmbedding: "[]",
      locale: "fr",
      limit: 5,
    })

    expect(rows[0]!.playbackId).toBeNull()
    expect(rows[0]!.videoCoreId).toBeNull()
    expect(rows[0]!.imageUrl).toBeNull()
  })

  it("coerces Postgres numeric columns to JS number", async () => {
    // pg returns numeric/float as string on some drivers; we explicitly Number()
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        video_id: "vid-3",
        video_core_id: null,
        video_slug: "",
        video_title: "",
        image_url: null,
        evidence_id: "scene-3",
        evidence_source: "scene",
        scene_description: "",
        start_seconds: "7" as unknown as number,
        playback_id: null,
        source_score: "0.42" as unknown as number,
        similarity: "0.42" as unknown as number,
        embedding_text: "[]",
      },
    ])

    const rows = await searchVideoSemantic(prisma, {
      queryEmbedding: "[]",
      locale: "en",
      limit: 1,
    })

    expect(rows[0]!.startSeconds).toBe(7)
    expect(rows[0]!.similarity).toBeCloseTo(0.42)
  })

  it("allows null transcript timecodes to flow through as null", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        video_id: "vid-no-timecode",
        video_core_id: null,
        video_slug: "",
        video_title: "",
        image_url: null,
        evidence_id: "chunk-no-timecode",
        evidence_source: "transcript",
        scene_description: "Transcript chunk without segment timing",
        start_seconds: null,
        playback_id: null,
        source_score: 0.7,
        similarity: 0.7,
        embedding_text: "[]",
      },
    ])

    const rows = await searchVideoSemantic(prisma, {
      queryEmbedding: "[]",
      locale: "en",
      limit: 1,
    })

    expect(rows[0]!.startSeconds).toBeNull()
  })

  it("queries transcript embeddings only inside the semantic-video retriever", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])

    await searchVideoSemantic(prisma, {
      queryEmbedding: "[0.1,0.2]",
      locale: "en",
      limit: 10,
    })

    const sql = latestRawSql(prisma)
    expect(sql).not.toContain("scene_source AS")
    expect(sql).toContain("transcript_source AS")
    expect(sql).not.toContain("FROM video_scene_locale")
    expect(sql).toContain("FROM video_transcript_chunk vtc")
    expect(sql).not.toContain("UNION ALL")
    expect(sql).not.toContain("semantic-transcript-video")
  })

  it("keeps locale/language, visibility, and non-null embedding gates in SQL", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])

    await searchVideoSemantic(prisma, {
      queryEmbedding: "[0.1,0.2]",
      locale: "fr",
      limit: 10,
    })

    const sql = latestRawSql(prisma)
    expect((sql.match(/v\.deleted_at IS NULL/g) ?? []).length).toBe(1)
    expect((sql.match(/vl_visible\.status = 'published'/g) ?? []).length).toBe(
      1,
    )
    expect((sql.match(/vl_display\.status = 'published'/g) ?? []).length).toBe(
      1,
    )
    const sqlWithFragments = latestRawSqlWithFragments(prisma)
    expect((sqlWithFragments.match(/IS NOT NULL/g) ?? []).length).toBe(1)
    expect(sqlWithFragments).not.toContain("vsl.embedding")
    expect(sqlWithFragments).toContain("vtc.embedding")
    expect(sql).not.toContain("vsl.locale =")
    expect(sql).toContain("vtc.language =")
    expect(sql).toContain("vt.language =")
    expect(sql).toContain("query_embedding AS MATERIALIZED")
    expect(sql).toContain("requested_language AS MATERIALIZED")
    expect(
      latestRawValues(prisma).filter((value) => value === "[0.1,0.2]"),
    ).toHaveLength(1)

    const candidateWindow = sqlBetween(
      sqlWithFragments,
      "visible_semantic_candidates AS",
      "requested_language AS MATERIALIZED",
    )
    const candidateLimitIndex = candidateWindow.lastIndexOf("LIMIT")
    expect(candidateWindow.indexOf("v.deleted_at IS NULL")).toBeLessThan(
      candidateLimitIndex,
    )
    expect(
      candidateWindow.indexOf("vl_visible.status = 'published'"),
    ).toBeLessThan(candidateLimitIndex)
    expect(
      candidateWindow.indexOf("vl_visible.deleted_at IS NULL"),
    ).toBeLessThan(candidateLimitIndex)

    const transcriptSource = sqlBetween(
      sqlWithFragments,
      "transcript_source AS",
      "requested_language AS MATERIALIZED",
    )
    expect(transcriptSource).not.toContain("LATERAL")
    expect(transcriptSource).not.toContain("embedding::text")

    const hydratedTail = sqlWithFragments.slice(
      sqlWithFragments.indexOf("requested_language AS MATERIALIZED"),
    )
    expect(hydratedTail).toContain("LEFT JOIN LATERAL")
    expect(hydratedTail).toContain("JOIN LATERAL")
    expect(hydratedTail).toContain("FROM video_locale vl_display")
    expect(hydratedTail).toMatch(
      /ORDER BY\s+vl_display\.language_core_id ASC NULLS LAST,\s+vl_display\.language_slug ASC NULLS LAST,\s+vl_display\.id ASC/,
    )
    expect(hydratedTail).toContain(
      "vd.language_id IN (SELECT id FROM requested_language)",
    )
    expect(hydratedTail).toContain("vtc_final.embedding::text")
  })

  it("selects best transcript evidence before bounding candidate windows", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])

    await searchVideoSemantic(prisma, {
      queryEmbedding: "[0.1,0.2]",
      locale: "en",
      limit: 5,
    })

    const sql = latestRawSqlWithFragments(prisma)
    expect(sql).not.toContain("SELECT DISTINCT ON (vs.video_id)")
    expect(sql).toContain("SELECT DISTINCT ON (vt.video_id)")
    expect(sql).not.toContain("WITH scene_nn AS MATERIALIZED")
    expect(sql).not.toContain("transcript_nn AS MATERIALIZED")

    const transcriptOrderIndex = sql.indexOf(
      "ORDER BY",
      sql.indexOf("SELECT DISTINCT ON (vt.video_id)"),
    )
    const preCandidateWindow = sqlBetween(
      sql,
      "best_transcript_per_video AS",
      "transcript_source AS",
    )
    expect(preCandidateWindow).not.toContain("LIMIT")

    const transcriptSource = sqlBetween(
      sql,
      "transcript_source AS",
      "requested_language AS MATERIALIZED",
    )
    const transcriptCandidateLimitIndex = transcriptSource.indexOf("LIMIT")
    expect(transcriptOrderIndex).toBeGreaterThan(-1)
    expect(transcriptCandidateLimitIndex).toBeGreaterThan(
      transcriptSource.indexOf("FROM visible_semantic_candidates"),
    )
  })

  it("keeps locale visibility before the candidate limit and display selection after it", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])

    await searchVideoSemantic(prisma, {
      queryEmbedding: "[0.1,0.2]",
      locale: "en",
      limit: 5,
    })

    const sql = latestRawSqlWithFragments(prisma)
    const bestTranscript = sqlBetween(
      sql,
      "best_transcript_per_video AS",
      "visible_semantic_candidates AS",
    )
    expect(bestTranscript).toContain("SELECT DISTINCT ON (vt.video_id)")
    expect(bestTranscript).not.toContain("JOIN video v")
    expect(bestTranscript).not.toContain("video_locale")

    const visibleCandidates = sqlBetween(
      sql,
      "visible_semantic_candidates AS",
      "transcript_source AS",
    )
    expect(visibleCandidates).toContain("JOIN video v")
    expect(visibleCandidates).toContain("WHERE EXISTS")
    expect(visibleCandidates).toContain("FROM video_locale vl_visible")
    expect(visibleCandidates).toContain("vl_visible.status = 'published'")
    expect(visibleCandidates).toContain("vl_visible.deleted_at IS NULL")
    expect(visibleCandidates).not.toContain("JOIN LATERAL")
    expect(visibleCandidates).not.toContain("vl_display")
    expect(visibleCandidates).not.toContain("LIMIT")

    const transcriptSource = sqlBetween(
      sql,
      "transcript_source AS",
      "requested_language AS MATERIALIZED",
    )
    expect(transcriptSource).toContain("FROM visible_semantic_candidates")
    expect(transcriptSource).not.toContain("video_locale")
    expect(transcriptSource.indexOf("LIMIT")).toBeGreaterThan(
      transcriptSource.indexOf("FROM visible_semantic_candidates"),
    )

    const hydratedTail = sql.slice(
      sql.indexOf("requested_language AS MATERIALIZED"),
    )
    expect(hydratedTail).toContain("FROM video_locale vl_display")
    expect(hydratedTail).toContain("vl_display.status = 'published'")
    expect(hydratedTail).toContain("vl_display.deleted_at IS NULL")
    expect(hydratedTail).toMatch(
      /ORDER BY\s+vl_display\.language_core_id ASC NULLS LAST,\s+vl_display\.language_slug ASC NULLS LAST,\s+vl_display\.id ASC/,
    )
    expect(hydratedTail).toMatch(/LIMIT\s+1/)
  })

  it("uses bounded per-source candidate windows after per-video collapse", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])

    await searchVideoSemantic(prisma, {
      queryEmbedding: "[0.1,0.2]",
      locale: "en",
      limit: 7,
    })

    const values = latestRawValues(prisma)
    expect(values.filter((value) => value === 14)).toHaveLength(1)
  })

  it("keeps HNSW-first windows out of the default semantic-video query", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])

    await searchVideoSemantic(prisma, {
      queryEmbedding: "[0.1,0.2]",
      locale: "en",
      limit: 7,
    })

    const sql = latestRawSqlWithFragments(prisma)
    expect(sql).not.toContain("nearest_transcript_chunks")
    expect(sql).not.toContain("source_distance")
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe("searchVideoSemanticHnswPrototype", () => {
  let prisma: ReturnType<typeof mockPrisma>

  beforeEach(() => {
    prisma = mockPrisma()
  })

  it("returns the same RankedItem-shaped rows as the default semantic retriever", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        video_id: "vid-hnsw",
        video_core_id: "core-hnsw",
        video_slug: "hnsw-story",
        video_title: "HNSW Story",
        image_url: null,
        evidence_id: "chunk-hnsw",
        evidence_source: "transcript",
        scene_description: "A matched transcript chunk",
        start_seconds: 12,
        playback_id: "mux-hnsw",
        source_score: 0.83,
        similarity: 0.83,
        embedding_text: "[0.1,0.2]",
      },
    ])

    const rows = await searchVideoSemanticHnswPrototype(prisma, {
      queryEmbedding: "[0.1,0.2]",
      locale: "en",
      limit: 10,
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      resultType: "video",
      resultId: "vid-hnsw",
      videoCoreId: "core-hnsw",
      videoSlug: "hnsw-story",
      videoTitle: "HNSW Story",
      imageUrl: null,
      sceneDescription: "A matched transcript chunk",
      startSeconds: 12,
      playbackId: "mux-hnsw",
      similarity: 0.83,
      embeddingText: "[0.1,0.2]",
    })
  })

  it("records a prototype-specific semantic-video DB timing", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])
    const timing = new SearchTimingRecorder()

    await searchVideoSemanticHnswPrototype(
      prisma,
      {
        queryEmbedding: "[0.1,0.2]",
        locale: "en",
        limit: 10,
      },
      timing,
    )

    expect(timing.snapshotDbTimings()).toEqual([
      expect.objectContaining({
        label: "semantic-video-hnsw.query",
        status: "fulfilled",
        resultCount: 0,
        elapsedMs: expect.any(Number),
      }),
    ])
  })

  it("sets HNSW scan knobs inside the transaction before querying", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])

    await searchVideoSemanticHnswPrototype(prisma, {
      queryEmbedding: "[0.1,0.2]",
      locale: "en",
      limit: 10,
    })

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ maxWait: 5000, timeout: 20_000 }),
    )
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled()
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(3)
    expect(prisma.$executeRaw.mock.calls[0]?.[1]).toBe(
      VIDEO_SEMANTIC_HNSW_EF_SEARCH,
    )
    expect(prisma.$executeRaw.mock.calls[1]?.[0].join("")).toContain(
      "SET LOCAL hnsw.iterative_scan = relaxed_order",
    )
    expect(prisma.$executeRaw.mock.calls[2]?.[1]).toBe(
      VIDEO_SEMANTIC_HNSW_MAX_SCAN_TUPLES,
    )
  })

  it("uses an HNSW-first transcript window before per-video collapse", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])

    await searchVideoSemanticHnswPrototype(prisma, {
      queryEmbedding: "[0.1,0.2]",
      locale: "en",
      limit: 60,
    })

    const sql = latestRawSqlWithFragments(prisma)
    expect(sql).toContain("nearest_transcript_chunks AS MATERIALIZED")
    expect(sql).toContain("FROM video_transcript_chunk vtc")
    expect(sql).toContain("ORDER BY vtc.embedding <=> qe.embedding")
    expect(sql).toContain("SELECT DISTINCT ON (video_id)")

    const nearestWindow = sqlBetween(
      sql,
      "nearest_transcript_chunks AS MATERIALIZED",
      "best_transcript_per_video AS",
    )
    expect(nearestWindow).toContain("LIMIT")
    expect(nearestWindow).toContain("source_distance")

    const bestTranscript = sqlBetween(
      sql,
      "best_transcript_per_video AS",
      "visible_semantic_candidates AS",
    )
    expect(bestTranscript).toContain("FROM nearest_transcript_chunks")
    expect(bestTranscript).toContain("source_distance ASC")
    expect(bestTranscript).not.toContain("video_locale")

    const values = latestRawValues(prisma)
    expect(values).toContain(1200)
    expect(values).toContain(120)
  })

  it("keeps default semantic gates and bounded hydration in the prototype SQL", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])

    await searchVideoSemanticHnswPrototype(prisma, {
      queryEmbedding: "[0.1,0.2]",
      locale: "fr",
      limit: 10,
    })

    const sql = latestRawSqlWithFragments(prisma)
    expect(sql).toContain("vtc.embedding IS NOT NULL")
    expect(sql).toContain("vt.embedding_provider")
    expect(sql).toContain("vt.embedding_native_dimensions")
    expect(sql).toContain("vt.embedding_transform_version IS NULL")
    expect(sql).toContain("vtc.language =")
    expect(sql).toContain("vt.language =")
    expect(sql).toContain("v.deleted_at IS NULL")
    expect(sql).toContain("WHERE EXISTS")
    expect(sql).toContain("FROM video_locale vl_visible")
    expect(sql).toContain("vl_visible.status = 'published'")
    expect(sql).toContain("vl_visible.deleted_at IS NULL")

    const transcriptSource = sqlBetween(
      sql,
      "transcript_source AS",
      "requested_language AS MATERIALIZED",
    )
    expect(transcriptSource).not.toContain("video_locale")
    expect(transcriptSource).not.toContain("embedding::text")

    const hydratedTail = sql.slice(
      sql.indexOf("requested_language AS MATERIALIZED"),
    )
    expect(hydratedTail).toContain("FROM video_locale vl_display")
    expect(hydratedTail).toContain("FROM video_dub vd")
    expect(hydratedTail).toContain("FROM video_image vi2")
    expect(hydratedTail).toContain("vtc_final.embedding::text")
  })
})

describe("searchVideoSemantic embedding column selection", () => {
  let prisma: ReturnType<typeof mockPrisma>

  beforeEach(() => {
    prisma = mockPrisma()
  })

  it("reads vtc.embedding and never scene or removed qwen columns", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])
    await searchVideoSemantic(prisma, {
      queryEmbedding: "[0.1]",
      locale: "en",
      limit: 5,
    })

    const sql = latestRawSqlWithFragments(prisma)
    expect(sql).not.toContain("vsl.embedding")
    expect(sql).toContain("vtc.embedding")
    expect(sql).not.toContain("vsl.embedding_provider")
    expect(sql).toContain("vt.embedding_provider")
    expect(sql).not.toContain("embedding_qwen")
  })
})

describe("semantic retriever provenance gates", () => {
  let prisma: ReturnType<typeof mockPrisma>

  beforeEach(() => {
    prisma = mockPrisma()
  })

  it("requires the approved Qwen-compatible content provenance for video semantic rows", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])
    await searchVideoSemantic(prisma, {
      queryEmbedding: "[0.1]",
      locale: "en",
      limit: 5,
    })

    const sql = latestRawSqlWithFragments(prisma)
    const values = latestRawValues(prisma)
    expect(sql).toContain("vt.embedding_provider")
    expect(sql).toContain("vt.embedding_native_dimensions")
    expect(sql).toContain("vt.embedding_transform_version IS NULL")
    expect(sql).not.toContain("vsl.embedding_provider")
    expect(sql).not.toContain("video_scene_locale")
    expect(values).toContain("jesus-film-ai-gateway")
    expect(values).toContain("embeddings")
    expect(values).toContain(1536)
  })

  it("requires the approved Qwen-compatible content provenance for experience semantic rows", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([])
    await searchExperienceSemantic(prisma, {
      queryEmbedding: "[0.1]",
      locale: "en",
      limit: 5,
    })

    const sql = latestRawSqlWithFragments(prisma)
    const values = latestRawValues(prisma)
    expect(sql).toContain("el.embedding_provider")
    expect(sql).toContain("el.embedding_model")
    expect(sql).toContain("el.embedding_dimensions")
    expect(sql).toContain("el.embedding_native_dimensions")
    expect(sql).toContain("el.embedding_transform_version IS NULL")
    expect(values).toContain("jesus-film-ai-gateway")
    expect(values).toContain("embeddings")
    expect(values).toContain(1536)
  })
})

describe("mixVideoSemanticEvidenceRows", () => {
  const base = {
    video_core_id: null,
    video_slug: "video",
    video_title: "Video",
    image_url: null,
    playback_id: null,
    embedding_text: "[0]",
  }

  it("collapses scene+transcript evidence to one candidate per video", () => {
    const rows = mixVideoSemanticEvidenceRows([
      {
        ...base,
        video_id: "vid-1",
        evidence_id: "scene-1",
        evidence_source: "scene",
        scene_description: "Scene evidence",
        start_seconds: 20,
        source_score: 0.86,
        similarity: 0.86,
      },
      {
        ...base,
        video_id: "vid-1",
        evidence_id: "chunk-1",
        evidence_source: "transcript",
        scene_description: "Transcript evidence",
        start_seconds: 10,
        source_score: 0.84,
        similarity: 0.84,
      },
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      video_id: "vid-1",
      scene_description: "Scene evidence",
      start_seconds: 20,
      embedding_text: "[0]",
    })
    expect(rows[0]!.similarity).toBeGreaterThan(0.86)
  })

  it("takes snippet, timecode, playback, and embedding text from winning transcript evidence", () => {
    const rows = mixVideoSemanticEvidenceRows([
      {
        ...base,
        video_id: "vid-1",
        evidence_id: "scene-1",
        evidence_source: "scene",
        scene_description: "Scene evidence",
        start_seconds: 5,
        playback_id: "scene-playback",
        source_score: 0.8,
        similarity: 0.8,
        embedding_text: "[scene]",
      },
      {
        ...base,
        video_id: "vid-1",
        evidence_id: "chunk-1",
        evidence_source: "transcript",
        scene_description: "Transcript evidence",
        start_seconds: 15,
        playback_id: "transcript-playback",
        source_score: 0.9,
        similarity: 0.9,
        embedding_text: "[transcript]",
      },
    ])

    expect(rows[0]).toMatchObject({
      scene_description: "Transcript evidence",
      start_seconds: 15,
      playback_id: "transcript-playback",
      embedding_text: "[transcript]",
    })
  })

  it("keeps strong single-source videos above weaker mixed videos", () => {
    const rows = mixVideoSemanticEvidenceRows([
      {
        ...base,
        video_id: "single",
        evidence_id: "single-scene",
        evidence_source: "scene",
        scene_description: "Strong scene",
        start_seconds: 0,
        source_score: 0.9,
        similarity: 0.9,
      },
      {
        ...base,
        video_id: "mixed",
        evidence_id: "mixed-scene",
        evidence_source: "scene",
        scene_description: "Mixed scene",
        start_seconds: 0,
        source_score: 0.85,
        similarity: 0.85,
      },
      {
        ...base,
        video_id: "mixed",
        evidence_id: "mixed-chunk",
        evidence_source: "transcript",
        scene_description: "Mixed transcript",
        start_seconds: 1,
        source_score: 0.8,
        similarity: 0.8,
      },
    ])

    expect(rows.map((row) => row.video_id)).toEqual(["single", "mixed"])
  })

  it("uses deterministic tie ordering with scene before transcript and early timecode before id", () => {
    const rows = mixVideoSemanticEvidenceRows([
      {
        ...base,
        video_id: "b",
        evidence_id: "chunk-b",
        evidence_source: "transcript",
        scene_description: "Transcript B",
        start_seconds: 3,
        source_score: 0.8,
        similarity: 0.8,
      },
      {
        ...base,
        video_id: "a",
        evidence_id: "scene-a",
        evidence_source: "scene",
        scene_description: "Scene A",
        start_seconds: 7,
        source_score: 0.8,
        similarity: 0.8,
      },
      {
        ...base,
        video_id: "a",
        evidence_id: "chunk-a",
        evidence_source: "transcript",
        scene_description: "Transcript A",
        start_seconds: 1,
        source_score: 0.8,
        similarity: 0.8,
      },
    ])

    expect(rows.map((row) => row.video_id)).toEqual(["a", "b"])
    expect(rows[0]!.scene_description).toBe("Scene A")
  })

  it("uses video id as the final public tie-breaker for otherwise equal winners", () => {
    const rows = mixVideoSemanticEvidenceRows([
      {
        ...base,
        video_id: "b",
        evidence_id: "chunk-b",
        evidence_source: "transcript",
        scene_description: "Transcript B",
        start_seconds: 3,
        source_score: 0.8,
        similarity: 0.8,
      },
      {
        ...base,
        video_id: "a",
        evidence_id: "chunk-a",
        evidence_source: "transcript",
        scene_description: "Transcript A",
        start_seconds: 3,
        source_score: 0.8,
        similarity: 0.8,
      },
    ])

    expect(rows.map((row) => row.video_id)).toEqual(["a", "b"])
  })
})

describe("calculateVideoSemanticMixedScore", () => {
  it("lets close scene+transcript evidence outrank a nearby single-source result", () => {
    const mixed = calculateVideoSemanticMixedScore([0.86, 0.84])
    const single = calculateVideoSemanticMixedScore([0.862])

    expect(mixed).toBeGreaterThan(single)
  })

  it("keeps strong single-source evidence above weaker mixed evidence", () => {
    const single = calculateVideoSemanticMixedScore([0.9])
    const mixed = calculateVideoSemanticMixedScore([0.85, 0.8])

    expect(single).toBeGreaterThan(mixed)
  })

  it("does not boost weak second-source evidence below the agreement threshold", () => {
    const mixed = calculateVideoSemanticMixedScore([0.85, 0.7])

    expect(mixed).toBe(0.85)
  })

  it("caps mixed scores at 1", () => {
    const mixed = calculateVideoSemanticMixedScore([0.999, 0.99])

    expect(mixed).toBe(1)
  })
})

describe("searchVideoKeyword", () => {
  let prisma: ReturnType<typeof mockPrisma>

  beforeEach(() => {
    prisma = mockPrisma()
  })

  it("short-circuits empty query without calling DB", async () => {
    const rows = await searchVideoKeyword(prisma, {
      query: "   ",
      locale: "en",
      limit: 10,
    })
    expect(rows).toEqual([])
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it("returns keyword rows with video-level playbackId but no scene-level fields", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        video_id: "vid-1",
        video_core_id: "1_Jesus",
        video_slug: "jesus",
        video_title: "Jesus",
        image_url: "https://images.example/jesus.jpg",
        description: "Film about Jesus",
        playback_id: "mux-jesus-en",
        rank: 0.0913,
      },
    ])

    const rows = await searchVideoKeyword(prisma, {
      query: "jesus",
      locale: "en",
      limit: 10,
    })

    expect(rows[0]).toMatchObject({
      resultType: "video",
      resultId: "vid-1",
      imageUrl: "https://images.example/jesus.jpg",
      description: "Film about Jesus",
      // playbackId is video-level (any in-locale dub→mux match), so it
      // legitimately surfaces on keyword rows. Scene-level fields
      // (startSeconds, embeddingText) remain semantic-only.
      playbackId: "mux-jesus-en",
      rank: 0.0913,
    })
    expect(
      (rows[0] as unknown as { startSeconds?: unknown }).startSeconds,
    ).toBeUndefined()
    expect(
      (rows[0] as unknown as { embeddingText?: unknown }).embeddingText,
    ).toBeUndefined()
  })

  it("returns playbackId null when no in-locale dub exists", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        video_id: "vid-2",
        video_core_id: "2_NoMux",
        video_slug: "no-mux",
        video_title: "No Mux",
        image_url: null,
        description: null,
        playback_id: null,
        rank: 0.1,
      },
    ])

    const rows = await searchVideoKeyword(prisma, {
      query: "no-mux",
      locale: "en",
      limit: 10,
    })

    expect(rows[0]!.playbackId).toBeNull()
  })
})

describe("searchExperienceSemantic", () => {
  let prisma: ReturnType<typeof mockPrisma>

  beforeEach(() => {
    prisma = mockPrisma()
  })

  it("uses ExperienceLocale.id as resultId", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        experience_locale_id: "exp-loc-1",
        slug: "easter",
        title: "Easter",
        meta_description: "The resurrection",
        similarity: 0.75,
      },
    ])

    const rows = await searchExperienceSemantic(prisma, {
      queryEmbedding: "[0.1]",
      locale: "en",
      limit: 10,
    })

    expect(rows[0]).toMatchObject({
      resultType: "experience",
      resultId: "exp-loc-1",
      experienceSlug: "easter",
      experienceTitle: "Easter",
      experienceMetaDescription: "The resurrection",
      imageUrl: null,
      similarity: 0.75,
    })
  })

  it("tolerates null meta_description", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        experience_locale_id: "exp-loc-2",
        slug: "christmas",
        title: "Christmas",
        meta_description: null,
        similarity: 0.6,
      },
    ])

    const rows = await searchExperienceSemantic(prisma, {
      queryEmbedding: "[0.1]",
      locale: "en",
      limit: 1,
    })

    expect(rows[0]!.experienceMetaDescription).toBeNull()
  })
})

describe("searchExperienceKeyword", () => {
  let prisma: ReturnType<typeof mockPrisma>

  beforeEach(() => {
    prisma = mockPrisma()
  })

  it("short-circuits empty query without calling DB", async () => {
    const rows = await searchExperienceKeyword(prisma, {
      query: "\t\n ",
      locale: "en",
      limit: 10,
    })
    expect(rows).toEqual([])
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it("returns experience keyword rows with rank", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        experience_locale_id: "exp-loc-1",
        slug: "easter",
        title: "Easter",
        meta_description: "The resurrection",
        rank: 0.12,
      },
    ])

    const rows = await searchExperienceKeyword(prisma, {
      query: "easter",
      locale: "en",
      limit: 5,
    })

    expect(rows[0]).toMatchObject({
      resultType: "experience",
      resultId: "exp-loc-1",
      experienceSlug: "easter",
      experienceTitle: "Easter",
      imageUrl: null,
      rank: 0.12,
    })
  })
})
