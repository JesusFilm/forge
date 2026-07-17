import { describe, expect, it, vi } from "vitest"

import {
  ingestTranscriptEmbeddings,
  _internals,
} from "@/services/transcript-embedding-ingest.service"
import { searchVideoSemantic } from "@/services/hybrid-search-retrievers"

type StoredTranscript = {
  id: string
  videoId: string
  videoEditionId: string
  language: string
  model: string
  dimensions: number
  embeddingProvider: string | null
  embeddingNativeDimensions: number | null
  embeddingTransformVersion: string | null
  sourceContentHash: string | null
  chunkingType: string
  maxChunkTokens: number
  overlapTokens: number
  totalChunks: number
  totalTokens: number
}

type StoredChunk = {
  id: string
  transcriptId: string
  language: string
  chunkIndex: number
  chunkId: string
  text: string
  rawSourceText: string | null
  embeddingInputText: string | null
  feltNeeds: string[]
  bibleVerses: string[]
  contentSummary: string | null
  tone: string | null
  demographics: string[]
  spiritualContext: string[]
  extractionMetadata: Record<string, unknown> | null
  tokenCount: number
  startSeconds: number | null
  endSeconds: number | null
  model: string
  dimensions: number
  embeddingText: string
}

function parseJsonStringArray(value: string | null | undefined): string[] {
  if (value == null) return []
  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed)) return []
  return parsed.map(String)
}

function parseBase64Json(
  value: string | null | undefined,
): Record<string, unknown> | null {
  if (value == null) return null
  return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as Record<
    string,
    unknown
  >
}

function required(value: string | null | undefined): string {
  if (value == null) throw new Error("expected non-null PG array value")
  return value
}

function stringValue(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== "string") {
    throw new Error(`expected string field ${key}`)
  }
  return value
}

function numberValue(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== "number") {
    throw new Error(`expected number field ${key}`)
  }
  return value
}

function parsePgTextArray(literal: unknown): Array<string | null> {
  if (typeof literal !== "string") {
    throw new Error("expected PG text array literal")
  }
  if (literal === "{}") return []
  if (!literal.startsWith("{") || !literal.endsWith("}")) {
    throw new Error(`invalid PG text array literal: ${literal}`)
  }

  const values: Array<string | null> = []
  let i = 1
  while (i < literal.length - 1) {
    if (literal.startsWith("NULL", i)) {
      values.push(null)
      i += 4
    } else {
      if (literal[i] !== '"') throw new Error("expected quoted PG array item")
      i += 1
      let value = ""
      while (i < literal.length - 1) {
        const char = literal[i]!
        if (char === "\\") {
          value += literal[i + 1] ?? ""
          i += 2
          continue
        }
        if (char === '"') {
          i += 1
          break
        }
        value += char
        i += 1
      }
      values.push(value)
    }

    if (literal[i] === ",") i += 1
  }
  return values
}

function buildContractPrisma() {
  const transcripts = new Map<string, StoredTranscript>()
  const chunks: StoredChunk[] = []

  const queryRaw = vi.fn(async (strings: TemplateStringsArray) => {
    const sql = strings.join(" ")
    if (sql.includes("pg_advisory_xact_lock")) {
      return []
    }

    if (sql.includes("FROM video_dub dub")) {
      return [
        {
          videoId: "video-1",
          videoEditionId: "edition-1",
          coreId: "core-1",
        },
      ]
    }

    if (sql.includes("source_content_hash")) {
      return [...transcripts.values()]
    }

    if (sql.includes("transcript_source AS")) {
      return chunks.map((chunk) => {
        const transcript = transcripts.get(chunk.transcriptId)!
        return {
          video_id: transcript.videoId,
          video_core_id: "core-1",
          video_slug: "spoken-story",
          video_title: "Spoken Story",
          image_url: null,
          evidence_id: chunk.id,
          evidence_source: "transcript",
          scene_description: chunk.text,
          start_seconds: chunk.startSeconds,
          playback_id: "mux-playback-1",
          source_score: 0.93,
          similarity: 0.93,
          embedding_text: chunk.embeddingText,
        }
      })
    }

    return []
  })

  const tx = {
    videoTranscript: {
      upsert: vi.fn(
        async ({
          create,
          update,
        }: {
          create: Record<string, unknown>
          update: Record<string, unknown>
        }) => {
          const id = "transcript-1"
          const existing = transcripts.get(id)
          const next = existing
            ? {
                ...existing,
                videoId: stringValue(update, "videoId"),
                model: stringValue(update, "model"),
                dimensions: numberValue(update, "dimensions"),
                embeddingProvider:
                  typeof update.embeddingProvider === "string"
                    ? update.embeddingProvider
                    : null,
                embeddingNativeDimensions:
                  typeof update.embeddingNativeDimensions === "number"
                    ? update.embeddingNativeDimensions
                    : null,
                embeddingTransformVersion:
                  typeof update.embeddingTransformVersion === "string"
                    ? update.embeddingTransformVersion
                    : null,
                chunkingType: stringValue(update, "chunkingType"),
                maxChunkTokens: numberValue(update, "maxChunkTokens"),
                overlapTokens: numberValue(update, "overlapTokens"),
                totalChunks: numberValue(update, "totalChunks"),
                totalTokens: numberValue(update, "totalTokens"),
                sourceContentHash:
                  typeof update.sourceContentHash === "string"
                    ? update.sourceContentHash
                    : null,
              }
            : {
                id,
                videoId: stringValue(create, "videoId"),
                videoEditionId: stringValue(create, "videoEditionId"),
                language: stringValue(create, "language"),
                model: stringValue(create, "model"),
                dimensions: numberValue(create, "dimensions"),
                embeddingProvider:
                  typeof create.embeddingProvider === "string"
                    ? create.embeddingProvider
                    : null,
                embeddingNativeDimensions:
                  typeof create.embeddingNativeDimensions === "number"
                    ? create.embeddingNativeDimensions
                    : null,
                embeddingTransformVersion:
                  typeof create.embeddingTransformVersion === "string"
                    ? create.embeddingTransformVersion
                    : null,
                sourceContentHash:
                  typeof create.sourceContentHash === "string"
                    ? create.sourceContentHash
                    : null,
                chunkingType: stringValue(create, "chunkingType"),
                maxChunkTokens: numberValue(create, "maxChunkTokens"),
                overlapTokens: numberValue(create, "overlapTokens"),
                totalChunks: numberValue(create, "totalChunks"),
                totalTokens: numberValue(create, "totalTokens"),
              }
          transcripts.set(id, next)
          return { id }
        },
      ),
    },
    videoTranscriptChunk: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    $queryRaw: queryRaw,
    $executeRaw: vi.fn(
      async (
        strings: TemplateStringsArray,
        idsLiteral: string,
        transcriptIdsLiteral: string,
        languagesLiteral: string,
        chunkIndexesLiteral: string,
        chunkIdsLiteral: string,
        textsLiteral: string,
        rawSourceTextsLiteral: string,
        embeddingInputTextsLiteral: string,
        feltNeedsJsonLiteral: string,
        bibleVersesJsonLiteral: string,
        contentSummariesLiteral: string,
        tonesLiteral: string,
        demographicsJsonLiteral: string,
        spiritualContextJsonLiteral: string,
        extractionMetadataBase64Literal: string,
        tokenCountsLiteral: string,
        startSecondsLiteral: string,
        endSecondsLiteral: string,
        modelsLiteral: string,
        dimensionsLiteral: string,
        vectorTextsLiteral: string,
      ) => {
        expect(strings.join(" ")).toContain(
          "INSERT INTO video_transcript_chunk",
        )
        const ids = parsePgTextArray(idsLiteral)
        const transcriptIds = parsePgTextArray(transcriptIdsLiteral)
        const languages = parsePgTextArray(languagesLiteral)
        const chunkIndexes = parsePgTextArray(chunkIndexesLiteral)
        const chunkIds = parsePgTextArray(chunkIdsLiteral)
        const texts = parsePgTextArray(textsLiteral)
        const rawSourceTexts = parsePgTextArray(rawSourceTextsLiteral)
        const embeddingInputTexts = parsePgTextArray(embeddingInputTextsLiteral)
        const feltNeedsJson = parsePgTextArray(feltNeedsJsonLiteral)
        const bibleVersesJson = parsePgTextArray(bibleVersesJsonLiteral)
        const contentSummaries = parsePgTextArray(contentSummariesLiteral)
        const tones = parsePgTextArray(tonesLiteral)
        const demographicsJson = parsePgTextArray(demographicsJsonLiteral)
        const spiritualContextJson = parsePgTextArray(
          spiritualContextJsonLiteral,
        )
        const extractionMetadataBase64 = parsePgTextArray(
          extractionMetadataBase64Literal,
        )
        const tokenCounts = parsePgTextArray(tokenCountsLiteral)
        const startSeconds = parsePgTextArray(startSecondsLiteral)
        const endSeconds = parsePgTextArray(endSecondsLiteral)
        const models = parsePgTextArray(modelsLiteral)
        const dimensions = parsePgTextArray(dimensionsLiteral)
        const vectorTexts = parsePgTextArray(vectorTextsLiteral)

        for (let index = 0; index < ids.length; index += 1) {
          chunks.push({
            id: required(ids[index]),
            transcriptId: required(transcriptIds[index]),
            language: required(languages[index]),
            chunkIndex: Number(chunkIndexes[index]),
            chunkId: required(chunkIds[index]),
            text: required(texts[index]),
            rawSourceText: rawSourceTexts[index] ?? null,
            embeddingInputText: embeddingInputTexts[index] ?? null,
            feltNeeds: parseJsonStringArray(feltNeedsJson[index]),
            bibleVerses: parseJsonStringArray(bibleVersesJson[index]),
            contentSummary: contentSummaries[index] ?? null,
            tone: tones[index] ?? null,
            demographics: parseJsonStringArray(demographicsJson[index]),
            spiritualContext: parseJsonStringArray(spiritualContextJson[index]),
            extractionMetadata: parseBase64Json(
              extractionMetadataBase64[index],
            ),
            tokenCount: Number(tokenCounts[index]),
            startSeconds:
              startSeconds[index] == null ? null : Number(startSeconds[index]),
            endSeconds:
              endSeconds[index] == null ? null : Number(endSeconds[index]),
            model: required(models[index]),
            dimensions: Number(dimensions[index]),
            embeddingText: required(vectorTexts[index]),
          })
        }

        return ids.length
      },
    ),
  }

  const prisma = {
    video: {
      findFirst: vi.fn(async () => ({ id: "video-1", coreId: "core-1" })),
    },
    videoEdition: {
      findFirst: vi.fn(async () => ({ id: "edition-1" })),
    },
    $queryRaw: queryRaw,
    $transaction: vi.fn(
      async (callback: (txArg: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  }

  return { prisma, transcripts, chunks }
}

function contractPayload(overrides?: Record<string, unknown>) {
  const body = {
    target: {
      admin: {
        videoId: "video-1",
        videoEditionId: "edition-1",
        coreId: "core-1",
      },
    },
    language: "en",
    source: {
      text: "The exact spoken phrase from the transcript.",
      segments: [{ start: 12.5, end: 16.25, text: "The exact spoken phrase." }],
      artifactKey: "42/transcript.json",
      provider: "mux",
      generatedAt: "2026-05-25T00:00:00.000Z",
    },
    model: {
      name: "embeddings",
      provider: "jesus-film-ai-gateway",
      dimensions: 1536,
      nativeDimensions: 4096,
      transformVersion: "matryoshka-truncate-1536-v1",
    },
    chunking: {
      type: "segment-aware",
      maxChunkTokens: 500,
      overlapTokens: 100,
      version: "manager-transcript-v1",
    },
    generation: {
      mode: "idempotent",
      generatedAt: "2026-05-25T00:01:00.000Z",
      mastraRunId: "mastra-run-contract",
    },
    chunks: [
      {
        chunkIndex: 0,
        chunkId: "transcript-chunk-0",
        text: "The exact spoken phrase from the transcript.",
        tokenCount: 7,
        startSeconds: 12.5,
        endSeconds: 16.25,
        embedding: new Array(1536).fill(0.0123),
      },
    ],
    ...overrides,
  }
  const source = body.source as Record<string, unknown>
  source.contentHash ??= _internals.sha256Json({
    text: (body.source as { text?: string }).text ?? null,
    segments: (body.source as { segments?: unknown }).segments ?? null,
    chunks: (
      body.chunks as Array<{
        chunkIndex: number
        text: string
        startSeconds?: number
        endSeconds?: number
      }>
    ).map((chunk) => ({
      index: chunk.chunkIndex,
      text: chunk.text,
      startSeconds: chunk.startSeconds ?? null,
      endSeconds: chunk.endSeconds ?? null,
    })),
  })
  return body
}

describe("Mastra transcript ingest contract", () => {
  it("accepts Mastra-shaped output, writes existing transcript vector tables, and feeds existing semantic retrieval", async () => {
    const { prisma, transcripts, chunks } = buildContractPrisma()

    const result = await ingestTranscriptEmbeddings(
      prisma as never,
      contractPayload(),
    )

    expect(result).toMatchObject({
      status: "created",
      target: {
        videoId: "video-1",
        videoEditionId: "edition-1",
        language: "en",
      },
      chunks: 1,
      mastraRunId: "mastra-run-contract",
    })
    expect([...transcripts.values()][0]).toMatchObject({
      videoId: "video-1",
      videoEditionId: "edition-1",
      language: "en",
      model: "embeddings",
      dimensions: 1536,
      embeddingProvider: "jesus-film-ai-gateway",
      embeddingNativeDimensions: 4096,
      embeddingTransformVersion: "matryoshka-truncate-1536-v1",
      totalChunks: 1,
    })
    expect(chunks[0]).toMatchObject({
      transcriptId: "transcript-1",
      language: "en",
      chunkIndex: 0,
      text: "The exact spoken phrase from the transcript.",
      dimensions: 1536,
    })

    const searchRows = await searchVideoSemantic(prisma as never, {
      queryEmbedding: `[${new Array(1536).fill(0.0123).join(",")}]`,
      locale: "en",
      limit: 5,
    })

    expect(searchRows).toHaveLength(1)
    expect(searchRows[0]).toMatchObject({
      resultType: "video",
      resultId: "video-1",
      sceneDescription: "The exact spoken phrase from the transcript.",
      startSeconds: 12.5,
      playbackId: "mux-playback-1",
      embeddingText: chunks[0]!.embeddingText,
    })
  })

  it("accepts Manager-originated external targets without coreId and feeds existing semantic retrieval", async () => {
    const { prisma, transcripts, chunks } = buildContractPrisma()

    const result = await ingestTranscriptEmbeddings(
      prisma as never,
      contractPayload({
        target: {
          external: {
            assetId: "42",
            muxAssetId: "mux-asset-1",
          },
        },
      }),
    )

    expect(result).toMatchObject({
      status: "created",
      target: {
        videoId: "video-1",
        videoEditionId: "edition-1",
        coreId: "core-1",
        language: "en",
      },
      chunks: 1,
    })
    expect(prisma.$queryRaw).toHaveBeenCalled()
    expect([...transcripts.values()][0]).toMatchObject({
      videoId: "video-1",
      videoEditionId: "edition-1",
      language: "en",
    })

    const searchRows = await searchVideoSemantic(prisma as never, {
      queryEmbedding: `[${new Array(1536).fill(0.0123).join(",")}]`,
      locale: "en",
      limit: 5,
    })

    expect(searchRows[0]).toMatchObject({
      resultType: "video",
      resultId: "video-1",
      sceneDescription: "The exact spoken phrase from the transcript.",
      embeddingText: chunks[0]!.embeddingText,
    })
  })
})
