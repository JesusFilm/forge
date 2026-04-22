// Unit tests for indexEditionTranscript.
//
// DB interactions are tested against a stub Prisma client that mirrors
// the call surface we use — $transaction + upsert + $executeRaw. True
// end-to-end verification against a live Postgres with pgvector is
// out of scope for R2 (same infra constraint as R1; see the R2 plan's
// Scope Boundaries for rationale).

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Principal } from "@/auth/principal"
import type { EmbeddingsResult } from "@/services/manager-artifacts.service"
import {
  EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
  indexEditionTranscript,
} from "./transcript-embedding.service"

const SYSTEM = { id: null, role: "SYSTEM" } as const satisfies Principal
const ADMIN = { id: "admin-1", role: "ADMIN" } as const satisfies Principal
const VIEWER = { id: "viewer-1", role: "VIEWER" } as const satisfies Principal

type UpsertCall = { where: unknown; create: unknown; update: unknown }

type StubPrismaTx = {
  videoTranscript: { upsert: ReturnType<typeof vi.fn> }
  videoTranscriptChunk: {
    upsert: ReturnType<typeof vi.fn>
    deleteMany: ReturnType<typeof vi.fn>
  }
  $executeRaw: ReturnType<typeof vi.fn>
}

function buildStubPrisma(opts?: { prunedCount?: number }) {
  const videoTranscriptUpsert = vi.fn(async (args: UpsertCall) => ({
    id: `transcript-${JSON.stringify(args.where)}`,
  }))
  const videoTranscriptChunkUpsert = vi.fn(async (args: UpsertCall) => ({
    id: `chunk-${JSON.stringify(args.where)}`,
  }))
  const videoTranscriptChunkDeleteMany = vi.fn(async () => ({
    count: opts?.prunedCount ?? 0,
  }))
  const executeRaw = vi.fn(async () => 1)

  const tx: StubPrismaTx = {
    videoTranscript: { upsert: videoTranscriptUpsert },
    videoTranscriptChunk: {
      upsert: videoTranscriptChunkUpsert,
      deleteMany: videoTranscriptChunkDeleteMany,
    },
    $executeRaw: executeRaw,
  }

  const prisma = {
    $transaction: vi.fn(
      async (
        fn: (tx: StubPrismaTx) => Promise<void>,
        _opts?: { timeout?: number },
      ) => {
        return fn(tx)
      },
    ),
    ...tx,
  }

  return {
    prisma: prisma as unknown as import("@prisma/client").PrismaClient,
    tx,
    videoTranscriptUpsert,
    videoTranscriptChunkUpsert,
    videoTranscriptChunkDeleteMany,
    executeRaw,
  }
}

function buildArtifact(
  opts?: Partial<EmbeddingsResult> & { chunkCount?: number },
): EmbeddingsResult {
  const chunkCount = opts?.chunkCount ?? 2
  const chunks = Array.from({ length: chunkCount }, (_, i) => ({
    chunkId: `chunk-${i}`,
    text: `transcript chunk ${i}: spoken content of the video`,
    embedding: new Array(EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS).fill(
      0.01 * (i + 1),
    ),
    metadata: {
      tokenCount: 10 + i,
      startTime: i * 5,
      endTime: (i + 1) * 5,
    },
  }))
  return {
    model: "openai/text-embedding-3-small",
    dimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
    chunks,
    averagedEmbedding: new Array(EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS).fill(
      0,
    ),
    metadata: {
      totalChunks: chunkCount,
      totalTokens: chunks.reduce((sum, c) => sum + c.metadata.tokenCount, 0),
      chunkingStrategy: {
        type: "segment-aware",
        maxChunkTokens: 500,
        overlapTokens: 100,
      },
      embeddingDimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
      generatedAt: "2026-04-10T00:00:00.000Z",
    },
    ...opts,
  }
}

describe("indexEditionTranscript", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("rejects a null (unauthenticated) principal with forbidden", async () => {
    const { prisma } = buildStubPrisma()
    await expect(
      indexEditionTranscript(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        language: "en",
        user: null,
        artifactOverride: buildArtifact(),
      }),
    ).rejects.toMatchObject({
      name: "TranscriptIndexError",
      code: "forbidden",
    })
  })

  it("rejects principals that cannot write derived columns", async () => {
    const { prisma } = buildStubPrisma()
    await expect(
      indexEditionTranscript(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        language: "en",
        user: VIEWER,
        artifactOverride: buildArtifact(),
      }),
    ).rejects.toMatchObject({ code: "forbidden" })
  })

  it("throws missing_cms_video_id when no artifact or id is provided", async () => {
    const { prisma } = buildStubPrisma()
    await expect(
      indexEditionTranscript(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        language: "en",
        user: SYSTEM,
      }),
    ).rejects.toMatchObject({ code: "missing_cms_video_id" })
  })

  it("returns zero counts for an empty artifact without touching the DB", async () => {
    const { prisma, videoTranscriptUpsert, executeRaw } = buildStubPrisma()
    const result = await indexEditionTranscript(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      language: "en",
      user: SYSTEM,
      artifactOverride: buildArtifact({ chunkCount: 0 }),
    })
    expect(result.chunksIndexed).toBe(0)
    expect(result.embeddingsWritten).toBe(0)
    expect(videoTranscriptUpsert).not.toHaveBeenCalled()
    expect(executeRaw).not.toHaveBeenCalled()
  })

  it("rejects an artifact with dimensions != 1536", async () => {
    const { prisma, executeRaw } = buildStubPrisma()
    await expect(
      indexEditionTranscript(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        language: "en",
        user: SYSTEM,
        artifactOverride: buildArtifact({ dimensions: 768 }),
      }),
    ).rejects.toMatchObject({ code: "dimension_mismatch" })
    expect(executeRaw).not.toHaveBeenCalled()
  })

  it("rejects a chunk whose embedding length disagrees with top-level dimensions", async () => {
    const { prisma, executeRaw } = buildStubPrisma()
    const artifact = buildArtifact({ chunkCount: 1 })
    // Corrupt just the one chunk's vector length.
    artifact.chunks[0]!.embedding = new Array(100).fill(0)
    await expect(
      indexEditionTranscript(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        language: "en",
        user: SYSTEM,
        artifactOverride: artifact,
      }),
    ).rejects.toMatchObject({ code: "dimension_mismatch" })
    expect(executeRaw).not.toHaveBeenCalled()
  })

  it("rejects a chunk with empty (whitespace-only) text", async () => {
    const { prisma } = buildStubPrisma()
    const artifact = buildArtifact({ chunkCount: 1 })
    artifact.chunks[0]!.text = "   "
    await expect(
      indexEditionTranscript(prisma, {
        editionId: "edition-1",
        videoId: "video-1",
        coreId: "core-1",
        language: "en",
        user: SYSTEM,
        artifactOverride: artifact,
      }),
    ).rejects.toMatchObject({ code: "empty_chunk_text" })
  })

  it("upserts transcript + chunks inside a transaction and reuses artifact vectors", async () => {
    const {
      prisma,
      videoTranscriptUpsert,
      videoTranscriptChunkUpsert,
      videoTranscriptChunkDeleteMany,
      executeRaw,
    } = buildStubPrisma()

    const result = await indexEditionTranscript(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      language: "en",
      user: ADMIN,
      artifactOverride: buildArtifact({ chunkCount: 3 }),
    })

    expect(result).toMatchObject({
      editionId: "edition-1",
      language: "en",
      chunksIndexed: 3,
      embeddingsWritten: 3,
      chunksPruned: 0,
      model: "openai/text-embedding-3-small",
      dimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
    })
    expect(videoTranscriptUpsert).toHaveBeenCalledTimes(1)
    expect(videoTranscriptChunkDeleteMany).toHaveBeenCalledTimes(1)
    expect(videoTranscriptChunkUpsert).toHaveBeenCalledTimes(3)
    expect(executeRaw).toHaveBeenCalledTimes(3)

    // Chunk text and chunkId flow through verbatim.
    expect(videoTranscriptChunkUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          chunkId: "chunk-0",
          chunkIndex: 0,
          language: "en",
          tokenCount: 10,
          startSeconds: 0,
          endSeconds: 5,
        }),
      }),
    )

    // Artifact's own metadata lands on the parent row.
    expect(videoTranscriptUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          videoEditionId: "edition-1",
          language: "en",
          model: "openai/text-embedding-3-small",
          dimensions: EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS,
          chunkingType: "segment-aware",
          totalChunks: 3,
        }),
      }),
    )
  })

  it("does not call the embedding provider (vector reuse)", async () => {
    // Hard guarantee: the embeddings service must NOT be imported by
    // the transcript indexer. A naive port of R1's scene indexer
    // would accidentally pull it in; this test locks the invariant.
    const embeddingsModule = await import("@/services/embeddings.service")
    const spy = vi.spyOn(embeddingsModule, "generateExperienceEmbedding")

    const { prisma } = buildStubPrisma()
    await indexEditionTranscript(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      language: "en",
      user: SYSTEM,
      artifactOverride: buildArtifact({ chunkCount: 2 }),
    })

    expect(spy).not.toHaveBeenCalled()
  })

  it("warns on model-stamp drift with a structured payload and still writes the vectors", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { prisma, executeRaw } = buildStubPrisma()

    const result = await indexEditionTranscript(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      language: "en",
      user: SYSTEM,
      artifactOverride: buildArtifact({
        chunkCount: 1,
        model: "openai/text-embedding-future-model",
      }),
    })

    expect(result.chunksIndexed).toBe(1)
    expect(result.embeddingsWritten).toBe(1)
    expect(executeRaw).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    // Structured log contract — assert the payload shape, not just the
    // event name, so dropping a field (artifactModel / expected / note)
    // can't silently regress log-based alerting.
    const [payload] = warnSpy.mock.calls[0]!
    const parsed = JSON.parse(String(payload))
    expect(parsed).toMatchObject({
      event: "transcript_model_mismatch",
      artifactModel: "openai/text-embedding-future-model",
    })
    expect(parsed.expected).toEqual(
      expect.arrayContaining([
        "openai/text-embedding-3-small",
        "text-embedding-3-small",
      ]),
    )
    expect(typeof parsed.note).toBe("string")
  })

  it("prunes chunks scoped to the current transcript with the right notIn range", async () => {
    const { prisma, videoTranscriptChunkDeleteMany, videoTranscriptUpsert } =
      buildStubPrisma({ prunedCount: 5 })
    videoTranscriptUpsert.mockResolvedValueOnce({ id: "transcript-abc" })

    const result = await indexEditionTranscript(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      language: "en",
      user: SYSTEM,
      artifactOverride: buildArtifact({ chunkCount: 2 }),
    })

    expect(result.chunksPruned).toBe(5)
    expect(result.chunksIndexed).toBe(2)
    // Guard the prune scope: bounded to this transcript, only chunks
    // outside the incoming [0, 1] range. A bug that inverts `notIn`
    // or drops the transcriptId scope would fail this.
    expect(videoTranscriptChunkDeleteMany).toHaveBeenCalledWith({
      where: {
        transcriptId: "transcript-abc",
        chunkIndex: { notIn: [0, 1] },
      },
    })
  })

  it("refreshes `videoId` on re-index so edition-moves don't strand denormalized rows", async () => {
    const { prisma, videoTranscriptUpsert } = buildStubPrisma()
    await indexEditionTranscript(prisma, {
      editionId: "edition-1",
      videoId: "video-moved-to-B",
      coreId: "core-1",
      language: "en",
      user: SYSTEM,
      artifactOverride: buildArtifact({ chunkCount: 1 }),
    })
    // The parent upsert's `update` clause must include videoId so a
    // re-run after an edition-move updates the denormalized column.
    expect(videoTranscriptUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ videoId: "video-moved-to-B" }),
      }),
    )
  })

  it("is idempotent across repeated invocations against the same artifact", async () => {
    // Fresh stubs per invocation so we can compare the calls in isolation;
    // both runs should see the same upsert where-clauses land.
    const firstRun = buildStubPrisma()
    const firstResult = await indexEditionTranscript(firstRun.prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      language: "en",
      user: SYSTEM,
      artifactOverride: buildArtifact({ chunkCount: 3 }),
    })

    const secondRun = buildStubPrisma()
    const secondResult = await indexEditionTranscript(secondRun.prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      language: "en",
      user: SYSTEM,
      artifactOverride: buildArtifact({ chunkCount: 3 }),
    })

    expect(firstResult.chunksIndexed).toBe(3)
    expect(secondResult.chunksIndexed).toBe(3)
    expect(firstResult.chunksPruned).toBe(0)
    expect(secondResult.chunksPruned).toBe(0)
    // The upsert `where` clauses (the idempotency keys) are identical
    // run-to-run — a refactor that introduced a random chunkId into the
    // where would fail this.
    const firstWheres = firstRun.videoTranscriptChunkUpsert.mock.calls.map(
      (c) => (c[0] as { where: unknown }).where,
    )
    const secondWheres = secondRun.videoTranscriptChunkUpsert.mock.calls.map(
      (c) => (c[0] as { where: unknown }).where,
    )
    expect(secondWheres).toEqual(firstWheres)
  })

  it("writes embeddings via $executeRaw tagged template with ::vector cast", async () => {
    const { prisma, executeRaw } = buildStubPrisma()
    await indexEditionTranscript(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      language: "en",
      user: SYSTEM,
      artifactOverride: buildArtifact({ chunkCount: 1 }),
    })
    expect(executeRaw).toHaveBeenCalledTimes(1)
    const [strings, ...values] = executeRaw.mock.calls[0] as unknown as [
      readonly string[],
      ...unknown[],
    ]
    const rawSql = strings.join("?")
    expect(rawSql).toContain("UPDATE video_transcript_chunk")
    expect(rawSql).toContain("::vector")
    // Vector literal flows through as a bound parameter (pg array
    // syntax), never string-spliced into the SQL.
    expect(typeof values[0]).toBe("string")
    expect(values[0] as string).toMatch(/^\[[0-9.,-]+\]$/)
  })

  it("passes the 30s timeout option to $transaction", async () => {
    const { prisma } = buildStubPrisma()
    await indexEditionTranscript(prisma, {
      editionId: "edition-1",
      videoId: "video-1",
      coreId: "core-1",
      language: "en",
      user: SYSTEM,
      artifactOverride: buildArtifact({ chunkCount: 1 }),
    })
    const txMock = prisma.$transaction as unknown as ReturnType<typeof vi.fn>
    expect(txMock).toHaveBeenCalledTimes(1)
    const [, opts] = txMock.mock.calls[0]!
    expect(opts).toMatchObject({ timeout: 30_000 })
  })
})
