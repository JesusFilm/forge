// Embeddings service — generates vector embeddings for semantic search.

import type { TranscriptSegment } from "@/lib/vtt"
import type { VideoMetadata } from "@/services/metadata"
import { getOpenrouter } from "@/services/openrouter"
import { writeArtifact } from "@/services/storage"

const EMBEDDING_MODEL = "openai/text-embedding-3-small"
const DEFAULT_MAX_CHUNK_TOKENS = 500
const DEFAULT_OVERLAP_TOKENS = 100
const DEFAULT_MAX_BATCH_CHUNKS = 8
const DEFAULT_MAX_BATCH_TOKENS = 20_000

export type EmbeddingTranscriptInput = {
  text: string
  segments?: TranscriptSegment[]
  language?: string
}

export type EmbeddingChunkMetadata = {
  tokenCount: number
  startTime?: number
  endTime?: number
}

export type EmbeddingChunk = {
  chunkId: string
  text: string
  embedding: number[]
  metadata: EmbeddingChunkMetadata
}

export type MetadataEmbeddingField =
  | "title"
  | "description"
  | "topics"
  | "speakers"
  | "tags"
  | "language"

export type MetadataEmbedding = {
  text: string
  embedding: number[]
  fieldsUsed: MetadataEmbeddingField[]
}

export type EmbeddingsResult = {
  model: string
  dimensions: number
  chunks: EmbeddingChunk[]
  averagedEmbedding: number[]
  metadataEmbedding?: MetadataEmbedding
  metadata: {
    totalChunks: number
    totalTokens: number
    chunkingStrategy: {
      type: "segment-aware" | "plain-text"
      maxChunkTokens: number
      overlapTokens: number
    }
    embeddingDimensions: number
    generatedAt: string
  }
  artifactKeys: string[]
}

export type EmbeddingsOptions = {
  metadata?: VideoMetadata | null
  maxChunkTokens?: number
  overlapTokens?: number
  maxBatchChunks?: number
  maxBatchTokens?: number
  generatedAt?: string
}

type PlannedChunk = {
  chunkId: string
  text: string
  tokenCount: number
  startTime?: number
  endTime?: number
}

export async function generateEmbeddings(
  assetId: string,
  transcript: EmbeddingTranscriptInput,
  options: EmbeddingsOptions = {},
): Promise<EmbeddingsResult> {
  const transcriptText = normalizeTranscriptText(transcript)
  if (!transcriptText) {
    throw new Error("Embeddings require non-empty transcript text")
  }

  const maxChunkTokens = options.maxChunkTokens ?? DEFAULT_MAX_CHUNK_TOKENS
  const overlapTokens = options.overlapTokens ?? DEFAULT_OVERLAP_TOKENS
  const maxBatchChunks = options.maxBatchChunks ?? DEFAULT_MAX_BATCH_CHUNKS
  const maxBatchTokens = options.maxBatchTokens ?? DEFAULT_MAX_BATCH_TOKENS
  const generatedAt = options.generatedAt ?? new Date().toISOString()

  const usesSegmentChunks = hasUsableSegments(transcript.segments)
  const plannedChunks = usesSegmentChunks
    ? planSegmentChunks(transcript.segments ?? [], {
        maxChunkTokens,
        overlapTokens,
      })
    : planPlainTextChunks(transcriptText, {
        maxChunkTokens,
        overlapTokens,
      })

  if (plannedChunks.length === 0) {
    throw new Error("Embeddings require at least one chunk")
  }

  const batches = createBatches(plannedChunks, {
    maxBatchChunks,
    maxBatchTokens,
  })

  const chunkEmbeddings: EmbeddingChunk[] = []
  let dimensions: number | null = null

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index]!
    const batchResult = await generateEmbeddingBatch(batch, {
      expectedDimensions: dimensions,
      batchNumber: index + 1,
      batchCount: batches.length,
    })

    dimensions = batchResult.dimensions
    chunkEmbeddings.push(...batchResult.chunks)
  }

  if (dimensions === null) {
    throw new Error("No embeddings generated")
  }

  const metadataEmbedding = await generateMetadataEmbedding(
    options.metadata,
    dimensions,
  )

  const result: EmbeddingsResult = {
    model: EMBEDDING_MODEL,
    dimensions,
    chunks: chunkEmbeddings,
    averagedEmbedding: averageEmbeddings(chunkEmbeddings),
    ...(metadataEmbedding ? { metadataEmbedding } : {}),
    metadata: {
      totalChunks: chunkEmbeddings.length,
      totalTokens: plannedChunks.reduce(
        (sum, chunk) => sum + chunk.tokenCount,
        0,
      ),
      chunkingStrategy: {
        type: usesSegmentChunks ? "segment-aware" : "plain-text",
        maxChunkTokens,
        overlapTokens,
      },
      embeddingDimensions: dimensions,
      generatedAt,
    },
    artifactKeys: ["embeddings"],
  }

  await writeArtifact({
    assetId,
    artifactType: "embeddings",
    ext: "json",
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  })

  return result
}

function buildMetadataEmbeddingInput(
  metadata: VideoMetadata | null | undefined,
): { text: string; fieldsUsed: MetadataEmbeddingField[] } | null {
  if (!metadata) {
    return null
  }

  const sections: Array<{ field: MetadataEmbeddingField; line: string }> = []
  let hasPrimaryMetadata = false

  function addStringField(
    field: "title" | "description" | "language",
    label: string,
    value: string,
  ) {
    const trimmed = value.trim()
    if (!trimmed) {
      return
    }

    if (field !== "language") {
      hasPrimaryMetadata = true
    }

    sections.push({
      field,
      line: `${label}: ${trimmed}`,
    })
  }

  function addListField(
    field: "topics" | "speakers" | "tags",
    label: string,
    values: string[],
  ) {
    const normalized = values.map((value) => value.trim()).filter(Boolean)
    if (normalized.length === 0) {
      return
    }

    hasPrimaryMetadata = true
    sections.push({
      field,
      line: `${label}: ${normalized.join(", ")}`,
    })
  }

  addStringField("title", "Title", metadata.title)
  addStringField("description", "Description", metadata.description)
  addListField("topics", "Topics", metadata.topics)
  addListField("speakers", "Speakers", metadata.speakers)
  addListField("tags", "Tags", metadata.tags)
  if (hasPrimaryMetadata) {
    addStringField("language", "Language", metadata.language)
  }

  if (!hasPrimaryMetadata) {
    return null
  }

  return {
    text: sections.map((section) => section.line).join("\n"),
    fieldsUsed: sections.map((section) => section.field),
  }
}

function normalizeTranscriptText(transcript: EmbeddingTranscriptInput): string {
  const text = transcript.text.trim()
  if (text) {
    return text
  }

  const segmentsText = (transcript.segments ?? [])
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ")
    .trim()

  return segmentsText
}

function hasUsableSegments(
  segments: TranscriptSegment[] | undefined,
): segments is TranscriptSegment[] {
  return Boolean(segments?.some((segment) => segment.text.trim().length > 0))
}

function estimateTokenCount(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) {
    return 0
  }

  const words = trimmed.split(/\s+/)
  return Math.ceil(words.length / 0.75)
}

function chunkText(
  text: string,
  options: {
    maxChunkTokens: number
    overlapTokens: number
    startTime?: number
    endTime?: number
  },
): Array<Omit<PlannedChunk, "chunkId">> {
  const trimmed = text.trim()
  if (!trimmed) {
    return []
  }

  const words = trimmed.split(/\s+/)
  const wordsPerChunk = Math.max(1, Math.floor(options.maxChunkTokens * 0.75))
  const overlapWords = Math.max(
    0,
    Math.min(wordsPerChunk - 1, Math.floor(options.overlapTokens * 0.75)),
  )
  const step = Math.max(1, wordsPerChunk - overlapWords)
  const chunks: Array<Omit<PlannedChunk, "chunkId">> = []

  for (let start = 0; start < words.length; start += step) {
    const chunkWords = words.slice(start, start + wordsPerChunk)
    if (chunkWords.length === 0) {
      break
    }

    const chunkTextValue = chunkWords.join(" ").trim()
    chunks.push({
      text: chunkTextValue,
      tokenCount: estimateTokenCount(chunkTextValue),
      startTime: options.startTime,
      endTime: options.endTime,
    })

    if (start + wordsPerChunk >= words.length) {
      break
    }
  }

  return chunks
}

function planPlainTextChunks(
  text: string,
  options: {
    maxChunkTokens: number
    overlapTokens: number
  },
): PlannedChunk[] {
  return assignChunkIds(
    chunkText(text, {
      maxChunkTokens: options.maxChunkTokens,
      overlapTokens: options.overlapTokens,
    }),
  )
}

function planSegmentChunks(
  segments: TranscriptSegment[],
  options: {
    maxChunkTokens: number
    overlapTokens: number
  },
): PlannedChunk[] {
  const usableSegments = segments.filter((segment) => segment.text.trim())
  if (usableSegments.length === 0) {
    return []
  }

  const chunks: Array<Omit<PlannedChunk, "chunkId">> = []
  let currentSegments: TranscriptSegment[] = []
  let currentTokens = 0

  for (const segment of usableSegments) {
    const segmentTokens = estimateTokenCount(segment.text)

    if (segmentTokens > options.maxChunkTokens) {
      if (currentSegments.length > 0) {
        chunks.push(buildSegmentChunk(currentSegments))
        currentSegments = []
        currentTokens = 0
      }

      chunks.push(
        ...chunkText(segment.text, {
          maxChunkTokens: options.maxChunkTokens,
          overlapTokens: options.overlapTokens,
          startTime: segment.start,
          endTime: segment.end,
        }),
      )
      continue
    }

    if (
      currentSegments.length > 0 &&
      currentTokens + segmentTokens > options.maxChunkTokens
    ) {
      chunks.push(buildSegmentChunk(currentSegments))
      currentSegments = buildOverlapSegments(
        currentSegments,
        options.overlapTokens,
        options.maxChunkTokens,
      )
      currentTokens = currentSegments.reduce(
        (sum, overlapSegment) => sum + estimateTokenCount(overlapSegment.text),
        0,
      )

      while (
        currentSegments.length > 0 &&
        currentTokens + segmentTokens > options.maxChunkTokens
      ) {
        currentTokens -= estimateTokenCount(currentSegments[0]!.text)
        currentSegments = currentSegments.slice(1)
      }
    }

    currentSegments.push(segment)
    currentTokens += segmentTokens
  }

  if (currentSegments.length > 0) {
    chunks.push(buildSegmentChunk(currentSegments))
  }

  return assignChunkIds(chunks)
}

function buildSegmentChunk(
  segments: TranscriptSegment[],
): Omit<PlannedChunk, "chunkId"> {
  const text = segments
    .map((segment) => segment.text.trim())
    .join(" ")
    .trim()

  return {
    text,
    tokenCount: estimateTokenCount(text),
    startTime: segments[0]!.start,
    endTime: segments[segments.length - 1]!.end,
  }
}

function buildOverlapSegments(
  segments: TranscriptSegment[],
  overlapTokens: number,
  maxChunkTokens: number,
): TranscriptSegment[] {
  if (overlapTokens <= 0) {
    return []
  }

  const overlap: TranscriptSegment[] = []
  let tokenCount = 0

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]!
    overlap.unshift(segment)
    tokenCount += estimateTokenCount(segment.text)

    if (tokenCount >= overlapTokens) {
      break
    }
  }

  while (tokenCount > maxChunkTokens && overlap.length > 0) {
    tokenCount -= estimateTokenCount(overlap[0]!.text)
    overlap.shift()
  }

  return overlap
}

function assignChunkIds(
  chunks: Array<Omit<PlannedChunk, "chunkId">>,
): PlannedChunk[] {
  return chunks.map((chunk, index) => ({
    chunkId: `chunk-${index}`,
    ...chunk,
  }))
}

function createBatches(
  chunks: PlannedChunk[],
  options: {
    maxBatchChunks: number
    maxBatchTokens: number
  },
): PlannedChunk[][] {
  const batches: PlannedChunk[][] = []
  let currentBatch: PlannedChunk[] = []
  let currentTokens = 0

  for (const chunk of chunks) {
    const exceedsChunkCount = currentBatch.length >= options.maxBatchChunks
    const exceedsTokenBudget =
      currentBatch.length > 0 &&
      currentTokens + chunk.tokenCount > options.maxBatchTokens

    if (exceedsChunkCount || exceedsTokenBudget) {
      batches.push(currentBatch)
      currentBatch = []
      currentTokens = 0
    }

    currentBatch.push(chunk)
    currentTokens += chunk.tokenCount
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch)
  }

  return batches
}

async function requestEmbeddingVectors(
  input: string[],
  options: {
    expectedDimensions: number | null
    context: string
    itemLabel: string
  },
): Promise<{ embeddings: number[][]; dimensions: number }> {
  const response = await getOpenrouter().embeddings.create({
    model: EMBEDDING_MODEL,
    input,
  })

  const items = Array.isArray(response.data) ? response.data : []
  if (items.length !== input.length) {
    throw new Error(
      `${options.context} returned ${items.length} embeddings for ${input.length} ${options.itemLabel}`,
    )
  }

  const embeddingsByIndex = new Map<number, number[]>()
  let dimensions: number | null = null

  for (const item of items) {
    const index = item?.index
    const embedding = item?.embedding

    if (!Number.isInteger(index) || index < 0 || index >= input.length) {
      throw new Error(`${options.context} returned an invalid response index`)
    }

    if (embeddingsByIndex.has(index)) {
      throw new Error(`${options.context} returned a duplicate response index`)
    }

    if (
      !Array.isArray(embedding) ||
      embedding.length === 0 ||
      embedding.some(
        (value) => typeof value !== "number" || !Number.isFinite(value),
      )
    ) {
      throw new Error(`${options.context} returned an invalid embedding vector`)
    }

    if (dimensions === null) {
      dimensions = embedding.length
    } else if (dimensions !== embedding.length) {
      throw new Error(
        `${options.context} returned inconsistent embedding dimensions`,
      )
    }

    if (
      options.expectedDimensions !== null &&
      options.expectedDimensions !== embedding.length
    ) {
      throw new Error(
        `${options.context} changed embedding dimensions from ${options.expectedDimensions} to ${embedding.length}`,
      )
    }

    embeddingsByIndex.set(index, embedding)
  }

  if (dimensions === null) {
    throw new Error(`${options.context} returned no dimensions`)
  }

  return {
    dimensions,
    embeddings: input.map((_, index) => {
      const embedding = embeddingsByIndex.get(index)
      if (!embedding) {
        throw new Error(
          `${options.context} was missing embedding for input index ${index}`,
        )
      }

      return embedding
    }),
  }
}

async function generateEmbeddingBatch(
  batch: PlannedChunk[],
  options: {
    expectedDimensions: number | null
    batchNumber: number
    batchCount: number
  },
): Promise<{ chunks: EmbeddingChunk[]; dimensions: number }> {
  const { embeddings, dimensions } = await requestEmbeddingVectors(
    batch.map((chunk) => chunk.text),
    {
      expectedDimensions: options.expectedDimensions,
      context: `Embedding batch ${options.batchNumber}/${options.batchCount}`,
      itemLabel: "chunks",
    },
  )

  return {
    dimensions,
    chunks: batch.map((chunk, index) => ({
      chunkId: chunk.chunkId,
      text: chunk.text,
      embedding: embeddings[index]!,
      metadata: {
        tokenCount: chunk.tokenCount,
        startTime: chunk.startTime,
        endTime: chunk.endTime,
      },
    })),
  }
}

async function generateMetadataEmbedding(
  metadata: VideoMetadata | null | undefined,
  expectedDimensions: number,
): Promise<MetadataEmbedding | undefined> {
  const input = buildMetadataEmbeddingInput(metadata)
  if (!input) {
    return undefined
  }

  const { embeddings } = await requestEmbeddingVectors([input.text], {
    expectedDimensions,
    context: "Metadata embedding",
    itemLabel: "inputs",
  })

  return {
    text: input.text,
    embedding: embeddings[0]!,
    fieldsUsed: input.fieldsUsed,
  }
}

function averageEmbeddings(chunks: EmbeddingChunk[]): number[] {
  if (chunks.length === 0) {
    return []
  }

  const dimensions = chunks[0]!.embedding.length
  const averaged = Array.from({ length: dimensions }, () => 0)

  for (const chunk of chunks) {
    for (let index = 0; index < dimensions; index += 1) {
      averaged[index] += chunk.embedding[index]!
    }
  }

  for (let index = 0; index < dimensions; index += 1) {
    averaged[index] /= chunks.length
  }

  return averaged
}
