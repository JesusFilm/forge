import { createHash } from "node:crypto"
import type { Core } from "@strapi/strapi"

export type ChunkInput = {
  text: string
  embedding: number[]
}

export type EmbeddingIndexMode = "inspect" | "if_missing" | "override"

export type VideoEmbeddingSummary = {
  videoDocumentId?: string
  resolvedVideoId: number
  hasEmbeddings: boolean
  chunkCount: number
  model?: string
  contentFingerprint?: string
}

export type VideoEmbeddingIndexResult = VideoEmbeddingSummary & {
  status:
    | "missing"
    | "has_embeddings"
    | "applied_missing"
    | "skipped_existing"
    | "override_applied"
}

export type SyncVideoEmbeddingsInput = {
  videoId?: number
  videoDocumentId?: string
  chunks?: ChunkInput[]
  model?: string
  mode: EmbeddingIndexMode
  expectedGeneratedContentFingerprint?: string
  expectedExistingContentFingerprint?: string
}

type ResolvedVideoTarget = {
  resolvedVideoId: number
  videoDocumentId?: string
}

type VideoRow = {
  id: number | string
  document_id?: string | null
  published_at?: string | null
}

type VideoEmbeddingRow = {
  chunk_index: number | string
  chunk_text: string
  model: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KnexInstance = any

type RawExecutor = {
  raw: (
    sql: string,
    bindings?: unknown[],
  ) => Promise<{ rows?: unknown[] } | undefined>
}

// 5 bindings per row -> 50 rows = 250 params (well within PG's 65535 limit)
const BATCH_SIZE = 50

export class EmbeddingIndexError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = code,
  ) {
    super(message)
    this.name = "EmbeddingIndexError"
  }
}

function toNumber(value: number | string | undefined | null): number {
  return typeof value === "number" ? value : Number(value ?? 0)
}

function buildFingerprint(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`
}

export function buildGeneratedContentFingerprint(
  model: string,
  chunks: Array<Pick<ChunkInput, "text">>,
): string {
  return buildFingerprint({
    model,
    chunks: chunks.map((chunk, index) => ({
      index,
      text: chunk.text,
    })),
  })
}

function buildSummaryFromRows(
  target: ResolvedVideoTarget,
  rows: VideoEmbeddingRow[],
): VideoEmbeddingSummary {
  const models = Array.from(
    new Set(rows.map((row) => row.model).filter((row): row is string => !!row)),
  )
  const model = models.length === 1 ? models[0] : undefined
  const contentFingerprint =
    rows.length === 0
      ? undefined
      : model
        ? buildGeneratedContentFingerprint(
            model,
            rows.map((row) => ({ text: row.chunk_text })),
          )
        : buildFingerprint(
            rows.map((row) => ({
              index: toNumber(row.chunk_index),
              text: row.chunk_text,
              model: row.model,
            })),
          )

  return {
    videoDocumentId: target.videoDocumentId,
    resolvedVideoId: target.resolvedVideoId,
    hasEmbeddings: rows.length > 0,
    chunkCount: rows.length,
    ...(model ? { model } : {}),
    ...(contentFingerprint ? { contentFingerprint } : {}),
  }
}

async function readVideoRowsByDocumentId(
  strapi: Core.Strapi,
  videoDocumentId: string,
): Promise<VideoRow[]> {
  const knex: KnexInstance = strapi.db.connection
  const result: { rows: VideoRow[] } = await knex.raw(
    `
      SELECT id, document_id, published_at
      FROM videos
      WHERE document_id = ?
      ORDER BY CASE WHEN published_at IS NOT NULL THEN 0 ELSE 1 END, id DESC
    `,
    [videoDocumentId],
  )
  return result.rows ?? []
}

async function readVideoRowById(
  strapi: Core.Strapi,
  videoId: number,
): Promise<VideoRow | null> {
  const knex: KnexInstance = strapi.db.connection
  const result: { rows: VideoRow[] } = await knex.raw(
    `
      SELECT id, document_id, published_at
      FROM videos
      WHERE id = ?
      LIMIT 1
    `,
    [videoId],
  )
  return result.rows[0] ?? null
}

async function resolveVideoTarget(
  strapi: Core.Strapi,
  input: Pick<SyncVideoEmbeddingsInput, "videoId" | "videoDocumentId">,
): Promise<ResolvedVideoTarget> {
  if (typeof input.videoId === "number") {
    const row = await readVideoRowById(strapi, input.videoId)
    if (!row) {
      throw new EmbeddingIndexError(404, "video_not_found", "Video not found")
    }

    if (row.published_at == null) {
      throw new EmbeddingIndexError(
        409,
        "unpublished_video",
        "Video is not published",
      )
    }

    return {
      resolvedVideoId: toNumber(row.id),
      ...(row.document_id ? { videoDocumentId: row.document_id } : {}),
    }
  }

  if (
    typeof input.videoDocumentId === "string" &&
    input.videoDocumentId.trim()
  ) {
    const rows = await readVideoRowsByDocumentId(strapi, input.videoDocumentId)
    if (rows.length === 0) {
      throw new EmbeddingIndexError(404, "video_not_found", "Video not found")
    }

    const publishedRow = rows.find((row) => row.published_at != null)
    if (!publishedRow) {
      throw new EmbeddingIndexError(
        409,
        "unpublished_video",
        "Video is not published",
      )
    }

    return {
      resolvedVideoId: toNumber(publishedRow.id),
      videoDocumentId: publishedRow.document_id ?? input.videoDocumentId,
    }
  }

  throw new EmbeddingIndexError(
    400,
    "invalid_video_target",
    "videoId or videoDocumentId is required",
  )
}

async function readVideoEmbeddingRows(
  strapi: Core.Strapi,
  videoId: number,
): Promise<VideoEmbeddingRow[]> {
  const knex: KnexInstance = strapi.db.connection
  return readVideoEmbeddingRowsFromExecutor(knex, videoId)
}

async function readVideoEmbeddingRowsFromExecutor(
  executor: RawExecutor,
  videoId: number,
): Promise<VideoEmbeddingRow[]> {
  const result = (await executor.raw(
    `
      SELECT chunk_index, chunk_text, model
      FROM video_embeddings
      WHERE video_id = ?
      ORDER BY chunk_index ASC
    `,
    [videoId],
  )) as { rows?: VideoEmbeddingRow[] } | undefined
  return result?.rows ?? []
}

export async function getVideoEmbeddingSummary(
  strapi: Core.Strapi,
  target: Pick<SyncVideoEmbeddingsInput, "videoId" | "videoDocumentId">,
): Promise<VideoEmbeddingSummary> {
  const resolvedTarget = await resolveVideoTarget(strapi, target)
  return readResolvedVideoEmbeddingSummary(strapi, resolvedTarget)
}

async function readResolvedVideoEmbeddingSummary(
  strapi: Core.Strapi,
  target: ResolvedVideoTarget,
): Promise<VideoEmbeddingSummary> {
  const rows = await readVideoEmbeddingRows(strapi, target.resolvedVideoId)
  return buildSummaryFromRows(target, rows)
}

async function readResolvedVideoEmbeddingSummaryFromExecutor(
  executor: RawExecutor,
  target: ResolvedVideoTarget,
): Promise<VideoEmbeddingSummary> {
  const rows = await readVideoEmbeddingRowsFromExecutor(
    executor,
    target.resolvedVideoId,
  )
  return buildSummaryFromRows(target, rows)
}

export async function indexVideoEmbeddings(
  strapi: Core.Strapi,
  videoId: number,
  chunks: ChunkInput[],
  model = "text-embedding-3-small",
): Promise<{ chunksIndexed: number }> {
  const knex: KnexInstance = strapi.db.connection

  await knex.transaction(async (trx: KnexInstance) => {
    await replaceVideoEmbeddings(trx, videoId, chunks, model)
  })

  strapi.log.info(
    `[embedding] Indexed ${chunks.length} chunks for video ${videoId}`,
  )

  return { chunksIndexed: chunks.length }
}

async function replaceVideoEmbeddings(
  executor: RawExecutor,
  videoId: number,
  chunks: ChunkInput[],
  model: string,
): Promise<void> {
  await executor.raw("DELETE FROM video_embeddings WHERE video_id = ?", [
    videoId,
  ])

  for (let offset = 0; offset < chunks.length; offset += BATCH_SIZE) {
    const batch = chunks.slice(offset, offset + BATCH_SIZE)
    const placeholders: string[] = []
    const bindings: unknown[] = []

    for (let i = 0; i < batch.length; i++) {
      const chunk = batch[i]!
      placeholders.push("(?, ?, ?, ?::vector, ?)")
      bindings.push(
        videoId,
        offset + i,
        chunk.text,
        JSON.stringify(chunk.embedding),
        model,
      )
    }

    await executor.raw(
      `INSERT INTO video_embeddings (video_id, chunk_index, chunk_text, embedding, model)
       VALUES ${placeholders.join(", ")}`,
      bindings,
    )
  }
}

async function lockVideoRow(
  executor: RawExecutor,
  videoId: number,
): Promise<void> {
  await executor.raw(
    `
      SELECT id
      FROM videos
      WHERE id = ?
      FOR UPDATE
    `,
    [videoId],
  )
}

export async function syncVideoEmbeddings(
  strapi: Core.Strapi,
  input: SyncVideoEmbeddingsInput,
): Promise<VideoEmbeddingIndexResult> {
  const target = await resolveVideoTarget(strapi, input)

  if (input.mode === "inspect") {
    const currentSummary = await readResolvedVideoEmbeddingSummary(
      strapi,
      target,
    )
    return {
      status: currentSummary.hasEmbeddings ? "has_embeddings" : "missing",
      ...currentSummary,
    }
  }

  const chunks = input.chunks ?? []
  const model = input.model ?? "text-embedding-3-small"

  if (input.mode === "if_missing") {
    const knex: KnexInstance = strapi.db.connection
    return knex.transaction(async (trx: KnexInstance) => {
      await lockVideoRow(trx, target.resolvedVideoId)
      const existingRows = await readVideoEmbeddingRowsFromExecutor(
        trx,
        target.resolvedVideoId,
      )

      if (existingRows.length > 0) {
        return {
          status: "skipped_existing" as const,
          ...buildSummaryFromRows(target, existingRows),
        }
      }

      await replaceVideoEmbeddings(trx, target.resolvedVideoId, chunks, model)
      const appliedRows = await readVideoEmbeddingRowsFromExecutor(
        trx,
        target.resolvedVideoId,
      )
      return {
        status: "applied_missing" as const,
        ...buildSummaryFromRows(target, appliedRows),
      }
    })
  }

  const generatedFingerprint = buildGeneratedContentFingerprint(model, chunks)
  const knex: KnexInstance = strapi.db.connection
  return knex.transaction(async (trx: KnexInstance) => {
    await lockVideoRow(trx, target.resolvedVideoId)

    const currentSummary = await readResolvedVideoEmbeddingSummaryFromExecutor(
      trx,
      target,
    )
    if (
      input.expectedGeneratedContentFingerprint == null ||
      input.expectedGeneratedContentFingerprint !== generatedFingerprint
    ) {
      throw new EmbeddingIndexError(
        409,
        "stale_compare",
        "Generated embedding summary no longer matches the reviewed report",
      )
    }

    if (
      input.expectedExistingContentFingerprint == null ||
      input.expectedExistingContentFingerprint !==
        currentSummary.contentFingerprint
    ) {
      throw new EmbeddingIndexError(
        409,
        "stale_compare",
        "Current CMS embedding summary no longer matches the reviewed report",
      )
    }

    await replaceVideoEmbeddings(trx, target.resolvedVideoId, chunks, model)

    const appliedSummary = await readResolvedVideoEmbeddingSummaryFromExecutor(
      trx,
      target,
    )
    return {
      status: "override_applied" as const,
      ...appliedSummary,
    }
  })
}

export async function getVideoEmbeddingStats(
  strapi: Core.Strapi,
): Promise<{ totalVideos: number; totalChunks: number }> {
  const knex: KnexInstance = strapi.db.connection
  const result: {
    rows: { total_videos: string; total_chunks: string }[]
  } = await knex.raw(`
    SELECT
      COUNT(DISTINCT video_id)::text AS total_videos,
      COUNT(*)::text AS total_chunks
    FROM video_embeddings
  `)
  const row = result.rows[0]
  return {
    totalVideos: Number(row?.total_videos ?? 0),
    totalChunks: Number(row?.total_chunks ?? 0),
  }
}
