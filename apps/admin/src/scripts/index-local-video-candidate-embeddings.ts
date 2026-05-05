import { PrismaClient } from "@prisma/client"
import { toPgVector } from "@/db/pgvector"
import {
  generateOllamaEmbedding,
  OLLAMA_EMBEDDING_DIMENSIONS,
} from "@/services/ollama-embedding.service"
import { env } from "@/config/env"

const prisma = new PrismaClient()
const locale = process.argv.slice(2).find((arg) => arg !== "--") ?? "en"

type VideoRow = {
  id: string
  slug: string
  title: string | null
  description: string | null
}

function buildSourceText(video: VideoRow) {
  return [video.title, video.description, video.slug]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n")
}

async function ensureTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS video_candidate_embedding (
      video_id TEXT NOT NULL REFERENCES video(id) ON DELETE CASCADE,
      locale TEXT NOT NULL,
      source_text TEXT NOT NULL,
      embedding vector(${OLLAMA_EMBEDDING_DIMENSIONS}),
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL DEFAULT ${OLLAMA_EMBEDDING_DIMENSIONS},
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (video_id, locale)
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS video_candidate_embedding_hnsw
      ON video_candidate_embedding USING hnsw (embedding vector_cosine_ops)
      WHERE embedding IS NOT NULL
  `)
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS video_candidate_embedding_locale_hnsw
      ON video_candidate_embedding USING hnsw (embedding vector_cosine_ops)
      WHERE embedding IS NOT NULL AND locale = 'en'
  `)
}

async function loadVideos() {
  return prisma.$queryRaw<VideoRow[]>`
    SELECT
      v.id,
      v.slug,
      vl.title,
      COALESCE(vl.description, vl.snippet) AS description
    FROM video v
    LEFT JOIN LATERAL (
      SELECT title, description, snippet
      FROM video_locale vl
      WHERE vl.video_id = v.id
      ORDER BY
        CASE WHEN vl.locale = ${locale} THEN 0 ELSE 1 END,
        CASE WHEN vl.status = 'published' THEN 0 ELSE 1 END,
        vl.updated_at DESC
      LIMIT 1
    ) vl ON TRUE
    WHERE v.deleted_at IS NULL
    ORDER BY v.updated_at DESC
  `
}

async function main() {
  await ensureTable()

  const videos = await loadVideos()
  let indexed = 0
  let skipped = 0

  for (const video of videos) {
    const sourceText = buildSourceText(video)
    if (!sourceText) {
      skipped += 1
      continue
    }

    const existing = await prisma.$queryRaw<Array<{ source_text: string }>>`
      SELECT source_text
      FROM video_candidate_embedding
      WHERE video_id = ${video.id}
        AND locale = ${locale}
      LIMIT 1
    `
    if (existing[0]?.source_text === sourceText) {
      skipped += 1
      continue
    }

    const embedding = await generateOllamaEmbedding(sourceText)
    await prisma.$executeRaw`
      INSERT INTO video_candidate_embedding (
        video_id,
        locale,
        source_text,
        embedding,
        model,
        dimensions,
        updated_at
      )
      VALUES (
        ${video.id},
        ${locale},
        ${sourceText},
        ${toPgVector(embedding)}::vector,
        ${env.OLLAMA_EMBEDDING_MODEL ?? "embeddinggemma"},
        ${OLLAMA_EMBEDDING_DIMENSIONS},
        NOW()
      )
      ON CONFLICT (video_id, locale)
      DO UPDATE SET
        source_text = EXCLUDED.source_text,
        embedding = EXCLUDED.embedding,
        model = EXCLUDED.model,
        dimensions = EXCLUDED.dimensions,
        updated_at = NOW()
    `
    indexed += 1
    if (indexed % 50 === 0) {
      console.log(
        `[local-video-embeddings] indexed ${indexed}/${videos.length}`,
      )
    }
  }

  console.log(
    JSON.stringify({
      locale,
      total: videos.length,
      indexed,
      skipped,
      model: env.OLLAMA_EMBEDDING_MODEL ?? "embeddinggemma",
      dimensions: OLLAMA_EMBEDDING_DIMENSIONS,
    }),
  )
}

main()
  .catch((error) => {
    console.error(
      `[local-video-embeddings] failed: ${error instanceof Error ? error.stack : String(error)}`,
    )
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
